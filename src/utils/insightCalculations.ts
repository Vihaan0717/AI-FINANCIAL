import type { Transaction } from '../types/transaction'
import type { BillInstance } from '../types/planner'
import type {
  PeriodComparison,
  CategorySpendingShift,
  SpendingAnomaly,
  AnomalyDetectionOptions,
  AnomalyDetectionResult,
  MerchantSpendingStats,
  MerchantAnalysisResult,
  NeedsWantsBreakdown,
  CategoryClassificationMap,
  MonthlyFinancialReport,
  GroundedInsightNarrative,
  FinancialIntelligence,
} from '../types/insights'
import { addPaise, subtractPaise, formatPaise } from './money'
import {
  parseLocalDateString,
  getTodayDateString,
} from './recurrenceEngine'

/**
 * Standard default classification map.
 * Any category not present in this map is treated as 'unclassified',
 * preventing arbitrary user categories from being silently misclassified.
 */
export const DEFAULT_CATEGORY_CLASSIFICATION: CategoryClassificationMap = {
  'Groceries': 'needs',
  'Home': 'needs',
  'Utilities': 'needs',
  'Health': 'needs',
  'Transport': 'needs',
  'Food & dining': 'wants',
  'Shopping': 'wants',
  'Entertainment': 'wants',
  'Gift': 'wants',
  'Investment': 'savings_investments',
  'Transfer': 'transfers',
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Helper: Formats month and year into human-readable label (e.g. "October 2026").
 */
export function formatMonthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/**
 * Extracts the calendar date string (YYYY-MM-DD) from an ISO or date string.
 */
export function extractLocalDate(dateStr: string): string {
  return dateStr.slice(0, 10)
}

/**
 * Internal helper to calculate net category-level expenses and totals for a set of transactions.
 * Strict accounting rules:
 * - Only 'completed' transactions are counted.
 * - 'pending' and 'failed' are strictly excluded.
 * - 'transfer' is excluded from income and expenses.
 * - 'refund' offsets expenses and is never counted as income.
 * - Linked refunds reduce their original expense category down to a floor of 0.
 * - Unallocated refunds offset gross expenses and are transparently recorded.
 */
export function calculatePeriodLedger(transactions: Transaction[]): {
  confirmedIncomePaise: number
  grossConfirmedExpensesPaise: number
  totalRefundsPaise: number
  netConfirmedExpensesPaise: number
  netCashFlowPaise: number
  pendingExpensesPaise: number
  pendingIncomePaise: number
  categoryExpenses: Map<string, { paise: number; count: number }>
  completedExpenses: Transaction[]
  unallocatedRefundsPaise: number
  warnings: string[]
} {
  let confirmedIncomePaise = 0
  let grossConfirmedExpensesPaise = 0
  let totalRefundsPaise = 0
  let unallocatedRefundsPaise = 0
  let pendingExpensesPaise = 0
  let pendingIncomePaise = 0
  const warnings: string[] = []

  const categoryExpenses = new Map<string, { paise: number; count: number }>()
  const completedExpenses: Transaction[] = []
  const expenseById = new Map<string, Transaction>()
  const processedRefundIds = new Set<string>()

  // 1. Index completed expenses and track pending
  for (const t of transactions) {
    if (t.status === 'completed' && t.type === 'expense') {
      expenseById.set(t.id, t)
      completedExpenses.push(t)
      grossConfirmedExpensesPaise = addPaise(grossConfirmedExpensesPaise, t.amount)

      const cat = t.category || 'Other'
      const existing = categoryExpenses.get(cat) || { paise: 0, count: 0 }
      categoryExpenses.set(cat, {
        paise: addPaise(existing.paise, t.amount),
        count: existing.count + 1,
      })
    } else if (t.status === 'completed' && t.type === 'income') {
      confirmedIncomePaise = addPaise(confirmedIncomePaise, t.amount)
    } else if (t.status === 'pending') {
      if (t.type === 'expense') {
        pendingExpensesPaise = addPaise(pendingExpensesPaise, t.amount)
      } else if (t.type === 'income') {
        pendingIncomePaise = addPaise(pendingIncomePaise, t.amount)
      }
    }
  }

  // 2. Process completed refunds (idempotently, preventing duplicate adjustments)
  for (const t of transactions) {
    if (t.status !== 'completed' || t.type !== 'refund') {
      continue
    }

    if (processedRefundIds.has(t.id)) {
      continue
    }
    processedRefundIds.add(t.id)

    totalRefundsPaise = addPaise(totalRefundsPaise, t.amount)

    // Case A: Linked to an original expense
    if (t.linkedTransactionId && expenseById.has(t.linkedTransactionId)) {
      const orig = expenseById.get(t.linkedTransactionId)!
      const cat = orig.category || 'Other'
      const existing = categoryExpenses.get(cat)
      if (existing) {
        categoryExpenses.set(cat, {
          paise: Math.max(0, subtractPaise(existing.paise, t.amount)),
          count: existing.count,
        })
      }
    } else if (t.category && categoryExpenses.has(t.category)) {
      // Case B: Direct category on refund
      const existing = categoryExpenses.get(t.category)!
      categoryExpenses.set(t.category, {
        paise: Math.max(0, subtractPaise(existing.paise, t.amount)),
        count: existing.count,
      })
    } else {
      // Case C: Unallocated refund
      unallocatedRefundsPaise = addPaise(unallocatedRefundsPaise, t.amount)
      warnings.push(
        `Refund of ${formatPaise(t.amount)} ("${t.description}") is not linked to an original expense in this period.`
      )
    }
  }

  const netConfirmedExpensesPaise = Math.max(0, subtractPaise(grossConfirmedExpensesPaise, totalRefundsPaise))
  const netCashFlowPaise = subtractPaise(confirmedIncomePaise, netConfirmedExpensesPaise)

  return {
    confirmedIncomePaise,
    grossConfirmedExpensesPaise,
    totalRefundsPaise,
    netConfirmedExpensesPaise,
    netCashFlowPaise,
    pendingExpensesPaise,
    pendingIncomePaise,
    categoryExpenses,
    completedExpenses,
    unallocatedRefundsPaise,
    warnings,
  }
}

/**
 * 1. Compares two arbitrary spending periods (Current vs. Previous).
 * Handles zero baselines explicitly without misleading 100% fabrications.
 */
export function compareSpendingPeriods(
  currentTransactions: Transaction[],
  previousTransactions: Transaction[],
  options: {
    periodType?: 'month' | 'week' | 'custom'
    currentLabel: string
    previousLabel: string
  }
): PeriodComparison {
  const currentLedger = calculatePeriodLedger(currentTransactions)
  const previousLedger = calculatePeriodLedger(previousTransactions)

  const cSpend = currentLedger.netConfirmedExpensesPaise
  const pSpend = previousLedger.netConfirmedExpensesPaise
  const deltaPaise = subtractPaise(cSpend, pSpend)

  let direction: 'increased' | 'decreased' | 'unchanged' = 'unchanged'
  if (deltaPaise > 0) direction = 'increased'
  else if (deltaPaise < 0) direction = 'decreased'

  let percentageChangeState: 'calculated' | 'new_spending' | 'no_change'
  let percentageChange: number | undefined = undefined

  if (pSpend === 0 && cSpend === 0) {
    percentageChangeState = 'no_change'
    percentageChange = 0
  } else if (pSpend === 0 && cSpend > 0) {
    percentageChangeState = 'new_spending'
    percentageChange = undefined // Zero baseline: percentage change is undefined, never 100%
  } else {
    percentageChangeState = 'calculated'
    percentageChange = Number(((deltaPaise / pSpend) * 100).toFixed(1))
  }

  const netCashFlowDeltaPaise = subtractPaise(
    currentLedger.netCashFlowPaise,
    previousLedger.netCashFlowPaise
  )

  return {
    periodType: options.periodType || 'custom',
    currentPeriodLabel: options.currentLabel,
    previousPeriodLabel: options.previousLabel,
    currentSpendingPaise: cSpend,
    previousSpendingPaise: pSpend,
    deltaPaise,
    direction,
    percentageChangeState,
    percentageChange,
    currentIncomePaise: currentLedger.confirmedIncomePaise,
    previousIncomePaise: previousLedger.confirmedIncomePaise,
    netCashFlowDeltaPaise,
    transactionCountCurrent: currentLedger.completedExpenses.length,
    transactionCountPrevious: previousLedger.completedExpenses.length,
  }
}

/**
 * Month-over-Month Spending Comparison with calendar-safe year and month boundaries.
 */
export function compareMonthOverMonth(
  transactions: Transaction[],
  targetYear: number,
  targetMonth: number // 1-12
): PeriodComparison {
  const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear
  const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1

  const currentPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`
  const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`

  const currentTx = transactions.filter((t) => extractLocalDate(t.date).startsWith(currentPrefix))
  const prevTx = transactions.filter((t) => extractLocalDate(t.date).startsWith(prevPrefix))

  return compareSpendingPeriods(currentTx, prevTx, {
    periodType: 'month',
    currentLabel: formatMonthLabel(targetYear, targetMonth),
    previousLabel: formatMonthLabel(prevYear, prevMonth),
  })
}

/**
 * Week-over-Week Spending Comparison (Past 7 days vs Previous 7 days).
 */
export function compareWeekOverWeek(
  transactions: Transaction[],
  referenceDateStr?: string
): PeriodComparison {
  const refDate = referenceDateStr
    ? new Date(referenceDateStr)
    : new Date()

  // Current week: [ref - 6 days, ref]
  const curEnd = new Date(refDate)
  const curStart = new Date(refDate)
  curStart.setDate(curStart.getDate() - 6)

  // Previous week: [ref - 13 days, ref - 7 days]
  const prevEnd = new Date(refDate)
  prevEnd.setDate(prevEnd.getDate() - 7)
  const prevStart = new Date(refDate)
  prevStart.setDate(prevStart.getDate() - 13)

  const curStartStr = curStart.toISOString().slice(0, 10)
  const curEndStr = curEnd.toISOString().slice(0, 10)
  const prevStartStr = prevStart.toISOString().slice(0, 10)
  const prevEndStr = prevEnd.toISOString().slice(0, 10)

  const currentTx = transactions.filter((t) => {
    const d = extractLocalDate(t.date)
    return d >= curStartStr && d <= curEndStr
  })

  const prevTx = transactions.filter((t) => {
    const d = extractLocalDate(t.date)
    return d >= prevStartStr && d <= prevEndStr
  })

  return compareSpendingPeriods(currentTx, prevTx, {
    periodType: 'week',
    currentLabel: `Past 7 Days (${curStartStr} to ${curEndStr})`,
    previousLabel: `Prior 7 Days (${prevStartStr} to ${prevEndStr})`,
  })
}

/**
 * 3. Category-level Spending Changes and Attribution.
 * Explains which categories shifted and their proportion of overall positive spending increases.
 */
export function calculateCategorySpendingShifts(
  currentTransactions: Transaction[],
  previousTransactions: Transaction[]
): CategorySpendingShift[] {
  const currentLedger = calculatePeriodLedger(currentTransactions)
  const previousLedger = calculatePeriodLedger(previousTransactions)

  const allCategories = new Set<string>([
    ...currentLedger.categoryExpenses.keys(),
    ...previousLedger.categoryExpenses.keys(),
  ])

  const shifts: CategorySpendingShift[] = []
  let totalPositiveIncreasesPaise = 0

  for (const cat of allCategories) {
    const c = currentLedger.categoryExpenses.get(cat)?.paise || 0
    const p = previousLedger.categoryExpenses.get(cat)?.paise || 0
    const count = currentLedger.categoryExpenses.get(cat)?.count || 0
    const deltaPaise = subtractPaise(c, p)

    if (deltaPaise > 0) {
      totalPositiveIncreasesPaise = addPaise(totalPositiveIncreasesPaise, deltaPaise)
    }

    let direction: 'increased' | 'decreased' | 'unchanged' = 'unchanged'
    if (deltaPaise > 0) direction = 'increased'
    else if (deltaPaise < 0) direction = 'decreased'

    let percentageChangeState: 'calculated' | 'new_spending' | 'no_change'
    let percentageChange: number | undefined = undefined

    if (p === 0 && c === 0) {
      percentageChangeState = 'no_change'
      percentageChange = 0
    } else if (p === 0 && c > 0) {
      percentageChangeState = 'new_spending'
      percentageChange = undefined
    } else {
      percentageChangeState = 'calculated'
      percentageChange = Number(((deltaPaise / p) * 100).toFixed(1))
    }

    shifts.push({
      category: cat,
      currentPaise: c,
      previousPaise: p,
      deltaPaise,
      direction,
      percentageChangeState,
      percentageChange,
      transactionCount: count,
    })
  }

  // Calculate proportional attribution for positive increases
  for (const shift of shifts) {
    if (shift.deltaPaise > 0 && totalPositiveIncreasesPaise > 0) {
      shift.contributionToOverallIncreasePct = Number(
        ((shift.deltaPaise / totalPositiveIncreasesPaise) * 100).toFixed(1)
      )
    } else {
      shift.contributionToOverallIncreasePct = undefined
    }
  }

  // Sort by largest absolute spending shift descending
  shifts.sort((a, b) => Math.abs(b.deltaPaise) - Math.abs(a.deltaPaise))
  return shifts
}

/**
 * 4. Spending Anomaly Detection.
 * Uses configurable median multiplier and category spending proportion as heuristic indicators.
 * Explicitly distinguishes insufficient history states.
 */
export function detectSpendingAnomalies(
  transactions: Transaction[],
  options?: AnomalyDetectionOptions
): AnomalyDetectionResult {
  const minSampleSize = options?.minSampleSize ?? 5
  const medianMultiplier = options?.medianMultiplierThreshold ?? 2.5
  const categoryPctThreshold = options?.categorySpendPercentageThreshold ?? 35

  const completedExpenses = transactions.filter(
    (t) => t.status === 'completed' && t.type === 'expense'
  )

  if (completedExpenses.length === 0) {
    return {
      anomalies: [],
      insufficientHistory: true,
      evaluatedTransactionCount: 0,
      message: 'No completed expenses available for anomaly evaluation.',
    }
  }

  // Group by category
  const byCategory = new Map<string, Transaction[]>()
  for (const t of completedExpenses) {
    const cat = t.category || 'Other'
    const list = byCategory.get(cat) || []
    list.push(t)
    byCategory.set(cat, list)
  }

  const anomalies: SpendingAnomaly[] = []
  let totalEvaluatedCount = 0
  let hadInsufficientHistory = false

  byCategory.forEach((items, category) => {
    if (items.length < minSampleSize) {
      hadInsufficientHistory = true
      return
    }

    totalEvaluatedCount += items.length

    // 1. Calculate median amount
    const sortedAmounts = items.map((i) => i.amount).sort((a, b) => a - b)
    const mid = Math.floor(sortedAmounts.length / 2)
    const medianPaise =
      sortedAmounts.length % 2 === 1
        ? sortedAmounts[mid]
        : Math.round((sortedAmounts[mid - 1] + sortedAmounts[mid]) / 2)

    // 2. Calculate category total spend
    const categoryTotalPaise = items.reduce((acc, curr) => acc + curr.amount, 0)

    for (const item of items) {
      const isMedianMultiple = item.amount >= Math.round(medianPaise * medianMultiplier)
      const pctOfCategory =
        categoryTotalPaise > 0
          ? Number(((item.amount / categoryTotalPaise) * 100).toFixed(1))
          : 0
      const isPctSpike = pctOfCategory >= categoryPctThreshold

      if (isMedianMultiple || isPctSpike) {
        const multiple = Number((item.amount / (medianPaise || 1)).toFixed(1))
        let reason: 'median_multiple' | 'category_percentage_spike' | 'large_single_purchase' = 'median_multiple'
        let explanation = ''

        if (isMedianMultiple && isPctSpike) {
          reason = 'median_multiple'
          explanation = `${formatPaise(item.amount)} is ${multiple}x the median ${category} expense (${formatPaise(medianPaise)}) and accounts for ${pctOfCategory}% of ${category} spending.`
        } else if (isMedianMultiple) {
          reason = 'median_multiple'
          explanation = `${formatPaise(item.amount)} is ${multiple}x the median ${category} expense (${formatPaise(medianPaise)}).`
        } else {
          reason = 'category_percentage_spike'
          explanation = `${formatPaise(item.amount)} accounts for ${pctOfCategory}% of all ${category} spending.`
        }

        anomalies.push({
          transactionId: item.id,
          date: extractLocalDate(item.date),
          description: item.description,
          merchant: item.merchant,
          category,
          amountPaise: item.amount,
          triggerReason: reason,
          explanation,
          categoryBaselineMedianPaise: medianPaise,
          multipleOfMedian: multiple,
          categoryTotalPaise,
          percentageOfCategorySpend: pctOfCategory,
        })
      }
    }
  })

  // Sort anomalies by highest amount descending
  anomalies.sort((a, b) => b.amountPaise - a.amountPaise)

  return {
    anomalies,
    insufficientHistory: hadInsufficientHistory && totalEvaluatedCount === 0,
    evaluatedTransactionCount: totalEvaluatedCount,
    message:
      totalEvaluatedCount === 0
        ? `Insufficient transaction history (each category requires at least ${minSampleSize} completed transactions to establish a statistical baseline).`
        : undefined,
  }
}

/**
 * 5. Merchant Spending & Transaction-Frequency Analysis.
 */
export function analyzeMerchantSpending(transactions: Transaction[]): MerchantAnalysisResult {
  const completedExpenses = transactions.filter(
    (t) => t.status === 'completed' && t.type === 'expense'
  )

  const merchantMap = new Map<
    string,
    {
      totalPaise: number
      count: number
      categories: Map<string, number>
      lastDate: string
    }
  >()

  let unidentifiedMerchantSpendPaise = 0
  let unidentifiedTransactionCount = 0

  for (const t of completedExpenses) {
    const rawMerchant = t.merchant?.trim()
    const rawDesc = t.description?.trim()

    // Determine merchant identifier
    let mKey = rawMerchant
    if (!mKey && rawDesc) {
      // Heuristic fallback if merchant field is absent but description has clear identifier
      mKey = rawDesc
    }

    if (!mKey) {
      unidentifiedMerchantSpendPaise = addPaise(unidentifiedMerchantSpendPaise, t.amount)
      unidentifiedTransactionCount++
      continue
    }

    const existing = merchantMap.get(mKey) || {
      totalPaise: 0,
      count: 0,
      categories: new Map<string, number>(),
      lastDate: '',
    }

    const tDate = extractLocalDate(t.date)
    existing.totalPaise = addPaise(existing.totalPaise, t.amount)
    existing.count += 1
    if (!existing.lastDate || tDate > existing.lastDate) {
      existing.lastDate = tDate
    }

    const cat = t.category || 'Other'
    existing.categories.set(cat, (existing.categories.get(cat) || 0) + 1)
    merchantMap.set(mKey, existing)
  }

  const allStats: MerchantSpendingStats[] = []
  merchantMap.forEach((val, merchant) => {
    // Find top category
    let topCat = 'General'
    let maxCatCount = 0
    val.categories.forEach((cnt, c) => {
      if (cnt > maxCatCount) {
        maxCatCount = cnt
        topCat = c
      }
    })

    allStats.push({
      merchant,
      totalPaise: val.totalPaise,
      transactionCount: val.count,
      averagePaise: Math.round(val.totalPaise / val.count),
      topCategory: topCat,
      lastVisitedDate: val.lastDate,
    })
  })

  // Top by volume
  const topMerchantsBySpend = [...allStats].sort((a, b) => b.totalPaise - a.totalPaise)
  // Top by frequency
  const frequentMerchants = [...allStats].sort((a, b) => b.transactionCount - a.transactionCount)

  return {
    topMerchantsBySpend: topMerchantsBySpend.slice(0, 10),
    frequentMerchants: frequentMerchants.slice(0, 10),
    uniqueMerchantCount: allStats.length,
    unidentifiedMerchantSpendPaise,
    unidentifiedTransactionCount,
  }
}

/**
 * 6. Configurable Needs-versus-Wants Classification.
 * Strictly separates operational consumption from savings and transfers.
 * Unclassified categories remain explicitly 'unclassified'.
 */
export function calculateNeedsVsWants(
  transactions: Transaction[],
  customMap?: CategoryClassificationMap
): NeedsWantsBreakdown {
  const map: CategoryClassificationMap = {
    ...DEFAULT_CATEGORY_CLASSIFICATION,
    ...(customMap || {}),
  }

  let needsPaise = 0
  let wantsPaise = 0
  let savingsInvestmentsPaise = 0
  let transfersPaise = 0
  let unclassifiedPaise = 0
  let confirmedIncomePaise = 0

  const unclassifiedSet = new Set<string>()

  for (const t of transactions) {
    if (t.status !== 'completed') continue

    if (t.type === 'income') {
      confirmedIncomePaise = addPaise(confirmedIncomePaise, t.amount)
      continue
    }

    if (t.type === 'transfer') {
      transfersPaise = addPaise(transfersPaise, t.amount)
      continue
    }

    if (t.type === 'expense') {
      const cat = t.category || 'Other'
      const group = map[cat] || 'unclassified'

      switch (group) {
        case 'needs':
          needsPaise = addPaise(needsPaise, t.amount)
          break
        case 'wants':
          wantsPaise = addPaise(wantsPaise, t.amount)
          break
        case 'savings_investments':
          savingsInvestmentsPaise = addPaise(savingsInvestmentsPaise, t.amount)
          break
        case 'transfers':
          transfersPaise = addPaise(transfersPaise, t.amount)
          break
        case 'unclassified':
        default:
          unclassifiedPaise = addPaise(unclassifiedPaise, t.amount)
          unclassifiedSet.add(cat)
          break
      }
    }
  }

  // Operational expenses sum only needs + wants + unclassified consumption
  const totalOperationalExpensesPaise = addPaise(
    needsPaise,
    addPaise(wantsPaise, unclassifiedPaise)
  )

  let needsPercentageOfExpenses = 0
  let wantsPercentageOfExpenses = 0
  let unclassifiedPercentageOfExpenses = 0

  if (totalOperationalExpensesPaise > 0) {
    needsPercentageOfExpenses = Math.round((needsPaise / totalOperationalExpensesPaise) * 100)
    wantsPercentageOfExpenses = Math.round((wantsPaise / totalOperationalExpensesPaise) * 100)
    unclassifiedPercentageOfExpenses = Math.max(
      0,
      100 - needsPercentageOfExpenses - wantsPercentageOfExpenses
    )
  }

  const savingsPercentageOfIncome =
    confirmedIncomePaise > 0
      ? Math.round((savingsInvestmentsPaise / confirmedIncomePaise) * 100)
      : undefined

  const isBenchmark50_30_20Comparable =
    unclassifiedPaise === 0 && totalOperationalExpensesPaise > 0

  return {
    needsPaise,
    wantsPaise,
    savingsInvestmentsPaise,
    transfersPaise,
    unclassifiedPaise,
    totalOperationalExpensesPaise,
    needsPercentageOfExpenses,
    wantsPercentageOfExpenses,
    unclassifiedPercentageOfExpenses,
    savingsPercentageOfIncome,
    isBenchmark50_30_20Comparable,
    unclassifiedCategories: Array.from(unclassifiedSet),
  }
}

/**
 * 7. Monthly Financial Report Generation.
 * Produces an authoritative, grounded summary of income, expenses, commitments, and habits for a given calendar month.
 */
export function generateMonthlyReport(
  transactions: Transaction[],
  bills: BillInstance[] = [],
  year: number,
  month: number
): MonthlyFinancialReport {
  const currentPrefix = `${year}-${String(month).padStart(2, '0')}`
  const monthTransactions = transactions.filter((t) =>
    extractLocalDate(t.date).startsWith(currentPrefix)
  )

  const ledger = calculatePeriodLedger(monthTransactions)

  // Prior month transactions for category shifts
  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`
  const prevTransactions = transactions.filter((t) =>
    extractLocalDate(t.date).startsWith(prevPrefix)
  )

  const categoryShifts = calculateCategorySpendingShifts(monthTransactions, prevTransactions)
  const needsWants = calculateNeedsVsWants(monthTransactions)
  const merchantAnalytics = analyzeMerchantSpending(monthTransactions)
  const anomaliesResult = detectSpendingAnomalies(monthTransactions)

  // Upcoming commitments from bills (exclude settled, skipped, cancelled, or linked bills)
  let upcomingBillsPaise = 0
  let upcomingSipsPaise = 0
  let activeBillCount = 0

  for (const b of bills) {
    if (
      b.status === 'paid' ||
      b.status === 'skipped' ||
      b.status === 'cancelled' ||
      b.linkedTransactionId
    ) {
      continue
    }

    if (b.dueDate.startsWith(currentPrefix)) {
      activeBillCount++
      const amt = b.amountPaise || 0
      if (b.commitmentType === 'expense') {
        upcomingBillsPaise = addPaise(upcomingBillsPaise, amt)
      } else if (b.commitmentType === 'savings' || b.commitmentType === 'investment') {
        upcomingSipsPaise = addPaise(upcomingSipsPaise, amt)
      }
    }
  }

  const savingsRatePct =
    ledger.confirmedIncomePaise > 0
      ? Number(((ledger.netCashFlowPaise / ledger.confirmedIncomePaise) * 100).toFixed(1))
      : undefined

  const warnings = [...ledger.warnings]
  if (needsWants.unclassifiedCategories.length > 0) {
    warnings.push(
      `Unclassified spending of ${formatPaise(needsWants.unclassifiedPaise)} detected across: ${needsWants.unclassifiedCategories.join(', ')}.`
    )
  }

  return {
    year,
    month,
    monthLabel: formatMonthLabel(year, month),
    confirmedIncomePaise: ledger.confirmedIncomePaise,
    grossConfirmedExpensesPaise: ledger.grossConfirmedExpensesPaise,
    refundsPaise: ledger.totalRefundsPaise,
    netConfirmedExpensesPaise: ledger.netConfirmedExpensesPaise,
    netSavingsCashFlowPaise: ledger.netCashFlowPaise,
    savingsRatePct,
    categoryShifts,
    needsWants,
    topMerchants: merchantAnalytics.topMerchantsBySpend,
    spikesAndAnomalies: anomaliesResult.anomalies,
    upcomingCommitmentsSummary: {
      upcomingBillsPaise,
      upcomingSipsPaise,
      count: activeBillCount,
    },
    dataQualityWarnings: warnings,
  }
}

/**
 * 8. Deterministic, Evidence-Grounded Narrative Generation.
 * Synthesizes computed figures into an objective explanation without hallucinations or invented totals.
 */
export function generateGroundedNarrative(
  monthComparison: PeriodComparison,
  categoryShifts: CategorySpendingShift[],
  needsWants: NeedsWantsBreakdown,
  anomaliesResult: AnomalyDetectionResult
): GroundedInsightNarrative {
  const cSpend = monthComparison.currentSpendingPaise
  const pSpend = monthComparison.previousSpendingPaise
  const delta = monthComparison.deltaPaise
  const currentLabel = monthComparison.currentPeriodLabel
  const prevLabel = monthComparison.previousPeriodLabel

  let headline = ''
  let summaryText = ''

  if (monthComparison.percentageChangeState === 'new_spending') {
    headline = `You recorded ${formatPaise(cSpend)} in spending for ${currentLabel}.`
    summaryText = `This is your first recorded spending period with no previous baseline in ${prevLabel}.`
  } else if (monthComparison.percentageChangeState === 'no_change') {
    headline = `Your spending in ${currentLabel} matched ${prevLabel} exactly at ${formatPaise(cSpend)}.`
    summaryText = `Net spending remained steady with no change period-over-period.`
  } else if (monthComparison.direction === 'increased') {
    const pct = monthComparison.percentageChange ?? 0
    headline = `Spending increased by ${formatPaise(delta)} (${pct}%) in ${currentLabel}.`
    summaryText = `Net expenses rose from ${formatPaise(pSpend)} in ${prevLabel} to ${formatPaise(cSpend)} in ${currentLabel}.`
  } else {
    const absDelta = Math.abs(delta)
    const pct = Math.abs(monthComparison.percentageChange ?? 0)
    headline = `Spending decreased by ${formatPaise(absDelta)} (${pct}%) in ${currentLabel}.`
    summaryText = `You reduced net expenses from ${formatPaise(pSpend)} in ${prevLabel} to ${formatPaise(cSpend)} in ${currentLabel}.`
  }

  // Find top driver category of increase (if any)
  const driverExplanations: string[] = []
  const actionableSuggestions: string[] = []

  const topIncreaseCategory = categoryShifts.find((s) => s.deltaPaise > 0)
  if (topIncreaseCategory && monthComparison.direction === 'increased') {
    const contrib = topIncreaseCategory.contributionToOverallIncreasePct
    const contribText = contrib !== undefined ? ` (driving ${contrib}% of total increases)` : ''
    driverExplanations.push(
      `Top spending increase: ${topIncreaseCategory.category} grew by ${formatPaise(topIncreaseCategory.deltaPaise)} to ${formatPaise(topIncreaseCategory.currentPaise)}${contribText}.`
    )
  }

  // Needs vs Wants narrative
  if (needsWants.totalOperationalExpensesPaise > 0) {
    driverExplanations.push(
      `Budget split: ${needsWants.needsPercentageOfExpenses}% allocated to essentials (needs) and ${needsWants.wantsPercentageOfExpenses}% to discretionary spending (wants).`
    )

    if (needsWants.wantsPercentageOfExpenses > 40) {
      actionableSuggestions.push(
        `Discretionary spending is at ${needsWants.wantsPercentageOfExpenses}%. Trimming non-essential purchases like dining and entertainment could accelerate your savings reserve.`
      )
    }
  }

  // Anomalies narrative
  if (anomaliesResult.anomalies.length > 0) {
    const topAnomaly = anomaliesResult.anomalies[0]
    driverExplanations.push(
      `Notable transaction spike: ${topAnomaly.description} (${formatPaise(topAnomaly.amountPaise)}) in ${topAnomaly.category} (${topAnomaly.explanation}).`
    )
    actionableSuggestions.push(
      `Review large transactions like ${topAnomaly.description} (${formatPaise(topAnomaly.amountPaise)}) to ensure they align with your planned commitments.`
    )
  }

  if (actionableSuggestions.length === 0) {
    actionableSuggestions.push(
      `Maintain regular logging of transactions and recurring commitments to keep cash flow projections accurate.`
    )
  }

  return {
    headline,
    summaryText,
    driverExplanations,
    actionableSuggestions,
    supportingEvidence: {
      currentSpendPaise: cSpend,
      previousSpendPaise: pSpend,
      deltaPaise: delta,
      topDriverCategory: topIncreaseCategory?.category,
      topDriverDeltaPaise: topIncreaseCategory?.deltaPaise,
      topDriverContributionPct: topIncreaseCategory?.contributionToOverallIncreasePct,
      anomalyCount: anomaliesResult.anomalies.length,
      needsPct: needsWants.needsPercentageOfExpenses,
      wantsPct: needsWants.wantsPercentageOfExpenses,
    },
  }
}

/**
 * Top-level Orchestrator: Assembles complete Financial Intelligence for a workspace.
 */
export function generateFinancialIntelligence(
  transactions: Transaction[],
  bills: BillInstance[] = [],
  options?: {
    year?: number
    month?: number
    anomalyOptions?: AnomalyDetectionOptions
    classificationMap?: CategoryClassificationMap
  }
): FinancialIntelligence {
  const todayParts = parseLocalDateString(getTodayDateString())
  const targetYear = options?.year ?? todayParts.year
  const targetMonth = options?.month ?? todayParts.month

  const monthOverMonth = compareMonthOverMonth(transactions, targetYear, targetMonth)
  const weekOverWeek = compareWeekOverWeek(transactions)

  // Current month transactions for focused breakdown
  const currentPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`
  const currentMonthTx = transactions.filter((t) =>
    extractLocalDate(t.date).startsWith(currentPrefix)
  )

  const prevYear = targetMonth === 1 ? targetYear - 1 : targetYear
  const prevMonth = targetMonth === 1 ? 12 : targetMonth - 1
  const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`
  const prevMonthTx = transactions.filter((t) =>
    extractLocalDate(t.date).startsWith(prevPrefix)
  )

  const categoryShifts = calculateCategorySpendingShifts(currentMonthTx, prevMonthTx)
  const needsWants = calculateNeedsVsWants(currentMonthTx, options?.classificationMap)
  const anomaliesResult = detectSpendingAnomalies(currentMonthTx, options?.anomalyOptions)
  const merchantAnalytics = analyzeMerchantSpending(currentMonthTx)
  const monthlyReport = generateMonthlyReport(transactions, bills, targetYear, targetMonth)

  const narrative = generateGroundedNarrative(
    monthOverMonth,
    categoryShifts,
    needsWants,
    anomaliesResult
  )

  const warnings = [...monthlyReport.dataQualityWarnings]
  if (anomaliesResult.insufficientHistory) {
    warnings.push('Insufficient historical records for statistical anomaly evaluation.')
  }

  return {
    monthOverMonth,
    weekOverWeek,
    categoryShifts,
    needsWants,
    anomaliesResult,
    merchantAnalytics,
    monthlyReport,
    narrative,
    dataQualityWarnings: warnings,
  }
}
