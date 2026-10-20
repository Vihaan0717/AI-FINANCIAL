import type { FinancialSummary, Transaction, CategorySummary, DailySpendPoint } from '../types/transaction'
import { addPaise, subtractPaise } from './money'

// Consistent category colors for charts
export const CATEGORY_COLORS: Record<string, string> = {
  'Food & dining': '#3dd9b3',
  'Groceries': '#65e6c7',
  'Home': '#8b5cf6',
  'Transport': '#f6b94d',
  'Shopping': '#e879f9',
  'Utilities': '#60a5fa',
  'Health': '#f87171',
  'Entertainment': '#a78bfa',
  'Investment': '#34d399',
  'Income': '#10b981',
  'Transfer': '#64748b',
  'Other': '#94a3b8',
}

/**
 * Calculates authoritative financial statistics from a set of transactions.
 * Strict rules:
 * - Only 'completed' transactions affect confirmed income, expenses, and cash flow.
 * - 'pending' transactions are reported separately and do not alter confirmed totals.
 * - 'failed' transactions are strictly excluded from confirmed and pending totals.
 * - 'transfer' transactions move money between user's accounts and are EXCLUDED from income/expenses.
 * - 'refund' transactions reduce expenses (never counted as earned income).
 */
export function calculateFinancialSummary(
  transactions: Transaction[],
  plannedCommitmentsPaise: number = 820000 // Default demo commitment ₹8,200 (₹5,000 SIP + ₹3,200 bills)
): FinancialSummary {
  let totalConfirmedIncome = 0
  let grossConfirmedExpenses = 0
  let totalTransfers = 0
  let totalRefunds = 0
  let totalPendingIncome = 0
  let totalPendingExpenses = 0
  let failedCount = 0

  // Category aggregations for completed expenses
  const categoryMap = new Map<string, { paise: number; count: number }>()
  // Daily aggregations
  const dailyMap = new Map<string, number>()

  // Map of original expenses for linked refund attribution
  const expenseById = new Map<string, Transaction>()
  for (const t of transactions) {
    if (t.type === 'expense') {
      expenseById.set(t.id, t)
    }
  }

  // First pass: Process income, expenses, transfers, pending, failed
  for (const t of transactions) {
    if (t.status === 'failed') {
      failedCount++
      continue
    }

    if (t.status === 'pending') {
      if (t.type === 'income') {
        totalPendingIncome = addPaise(totalPendingIncome, t.amount)
      } else if (t.type === 'expense') {
        totalPendingExpenses = addPaise(totalPendingExpenses, t.amount)
      }
      continue
    }

    // Now process 'completed' status
    switch (t.type) {
      case 'income':
        totalConfirmedIncome = addPaise(totalConfirmedIncome, t.amount)
        break

      case 'expense':
        // Guard against double-counting: If an expense transaction is linked to another existing
        // expense transaction in the same dataset (e.g. an enriched UPI observation referencing an underlying bank debit),
        // we count the primary transaction and do not inflate gross expenses.
        if (t.linkedTransactionId && expenseById.has(t.linkedTransactionId)) {
          break
        }

        grossConfirmedExpenses = addPaise(grossConfirmedExpenses, t.amount)
        
        // Category tracking
        const cat = t.category || 'Other'
        const existingCat = categoryMap.get(cat) || { paise: 0, count: 0 }
        categoryMap.set(cat, {
          paise: addPaise(existingCat.paise, t.amount),
          count: existingCat.count + 1,
        })

        // Daily trend tracking (YYYY-MM-DD)
        const dateKey = t.date.slice(0, 10)
        dailyMap.set(dateKey, addPaise(dailyMap.get(dateKey) || 0, t.amount))
        break

      case 'transfer':
        // Internal transfers do NOT affect income or expenses
        totalTransfers = addPaise(totalTransfers, t.amount)
        break

      case 'refund':
        // Refunds offset expenses
        totalRefunds = addPaise(totalRefunds, t.amount)

        // If linked to an original expense, reduce that specific category's expense
        if (t.linkedTransactionId && expenseById.has(t.linkedTransactionId)) {
          const original = expenseById.get(t.linkedTransactionId)!
          const origCat = original.category || 'Other'
          const existing = categoryMap.get(origCat)
          if (existing) {
            categoryMap.set(origCat, {
              paise: Math.max(0, subtractPaise(existing.paise, t.amount)),
              count: existing.count,
            })
          }
        } else if (t.category && categoryMap.has(t.category)) {
          // If category specified directly on refund, reduce that category
          const existing = categoryMap.get(t.category)!
          categoryMap.set(t.category, {
            paise: Math.max(0, subtractPaise(existing.paise, t.amount)),
            count: existing.count,
          })
        }
        break
    }
  }

  // Excess/unabsorbed refunds: when refunds exceed recorded expenses in this period
  const unabsorbedRefundsPaise = totalRefunds > grossConfirmedExpenses
    ? subtractPaise(totalRefunds, grossConfirmedExpenses)
    : 0

  // Net confirmed expenses after all completed refunds (display metric, non-negative)
  const totalConfirmedExpenses = Math.max(0, subtractPaise(grossConfirmedExpenses, totalRefunds))

  // Net cash flow = confirmed income + total refunds - gross confirmed expenses
  // Accurately reflects true net cash position even when refunds exceed period expenses
  const netCashFlow = subtractPaise(
    addPaise(totalConfirmedIncome, totalRefunds),
    grossConfirmedExpenses
  )

  // Estimated spendable = net cash flow minus upcoming commitments
  const estimatedSpendable = Math.max(0, subtractPaise(netCashFlow, plannedCommitmentsPaise))

  // Build category totals with percentage
  const categoryTotals: CategorySummary[] = []
  categoryMap.forEach((val, key) => {
    const percentage = totalConfirmedExpenses > 0
      ? Math.round((val.paise / totalConfirmedExpenses) * 100)
      : 0
    categoryTotals.push({
      category: key,
      paise: val.paise,
      count: val.count,
      percentage,
      color: CATEGORY_COLORS[key] || CATEGORY_COLORS['Other'],
    })
  })
  categoryTotals.sort((a, b) => b.paise - a.paise)

  // Build daily spending points
  const dailySpending: DailySpendPoint[] = []
  Array.from(dailyMap.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .forEach(([date, paise]) => {
      const day = date.slice(8, 10)
      dailySpending.push({
        date,
        day,
        paise,
        rupees: paise / 100,
      })
    })

  // Sort recent completed/pending transactions by date desc
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return {
    totalConfirmedIncome,
    totalConfirmedExpenses,
    grossConfirmedExpenses,
    netCashFlow,
    totalTransfers,
    totalRefunds,
    unabsorbedRefundsPaise,
    totalPendingIncome,
    totalPendingExpenses,
    failedCount,
    categoryTotals,
    dailySpending,
    estimatedSpendable,
    recordedBalance: netCashFlow,
    recentTransactions,
  }
}
