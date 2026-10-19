import { describe, it, expect, beforeEach } from 'vitest'
import {
  rupeesToPaise,
  paiseToRupees,
  formatPaise,
  validateAmount,
  addPaise,
  subtractPaise,
} from '../src/utils/money'
import { calculateFinancialSummary } from '../src/utils/calculations'
import { detectDuplicate } from '../src/utils/duplicateDetector'
import { escapeCsvCell, generateTransactionsCsv } from '../src/utils/csvExport'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import type { Transaction } from '../src/types/transaction'

describe('Money Mate AI — Milestone 2 Transaction Engine Test Suite', () => {
  let sampleExpense: Transaction
  let sampleIncome: Transaction
  let sampleTransfer: Transaction
  let sampleRefund: Transaction

  beforeEach(() => {
    sampleIncome = {
      id: 'tx-inc-1',
      type: 'income',
      amount: 10000, // ₹100.00
      currency: 'INR',
      date: '2026-10-19T10:00:00.000Z',
      description: 'Consulting client payment',
      category: 'Income',
      paymentMethod: 'Bank transfer',
      status: 'completed',
      createdAt: '2026-10-19T10:00:00.000Z',
      updatedAt: '2026-10-19T10:00:00.000Z',
    }

    sampleExpense = {
      id: 'tx-exp-1',
      type: 'expense',
      amount: 3000, // ₹30.00
      currency: 'INR',
      date: '2026-10-19T11:00:00.000Z',
      description: 'Office stationery & supplies',
      category: 'Shopping',
      paymentMethod: 'UPI',
      status: 'completed',
      createdAt: '2026-10-19T11:00:00.000Z',
      updatedAt: '2026-10-19T11:00:00.000Z',
    }

    sampleTransfer = {
      id: 'tx-trf-1',
      type: 'transfer',
      amount: 2000, // ₹20.00
      currency: 'INR',
      date: '2026-10-19T12:00:00.000Z',
      description: 'Transfer from Checking to Savings Reserve',
      fromAccount: 'HDFC Checking',
      toAccount: 'SBI Savings',
      category: 'Transfer',
      paymentMethod: 'Bank transfer',
      status: 'completed',
      createdAt: '2026-10-19T12:00:00.000Z',
      updatedAt: '2026-10-19T12:00:00.000Z',
    }

    sampleRefund = {
      id: 'tx-ref-1',
      type: 'refund',
      amount: 1000, // ₹10.00
      currency: 'INR',
      date: '2026-10-19T13:00:00.000Z',
      description: 'Partial refund for returned stationery',
      category: 'Shopping',
      paymentMethod: 'UPI',
      status: 'completed',
      linkedTransactionId: 'tx-exp-1',
      createdAt: '2026-10-19T13:00:00.000Z',
      updatedAt: '2026-10-19T13:00:00.000Z',
    }
  })

  // 1. Income calculations
  it('1. correctly calculates total confirmed income', () => {
    const secondIncome: Transaction = {
      ...sampleIncome,
      id: 'tx-inc-2',
      amount: 5050, // ₹50.50
    }
    const summary = calculateFinancialSummary([sampleIncome, secondIncome], 0)
    expect(summary.totalConfirmedIncome).toBe(15050) // ₹150.50
  })

  // 2. Expense calculations
  it('2. correctly calculates gross and net confirmed expenses', () => {
    const summary = calculateFinancialSummary([sampleExpense], 0)
    expect(summary.grossConfirmedExpenses).toBe(3000)
    expect(summary.totalConfirmedExpenses).toBe(3000)
    expect(summary.netCashFlow).toBe(-3000)
  })

  // 3. Transfer exclusion from income and expenses
  it('3. strictly excludes internal transfers between accounts from income and expenses', () => {
    const summary = calculateFinancialSummary([sampleIncome, sampleExpense, sampleTransfer], 0)
    // Transfer amount of ₹20 (2000 paise) must NOT inflate income or expenses
    expect(summary.totalConfirmedIncome).toBe(10000) // Exactly ₹100
    expect(summary.totalConfirmedExpenses).toBe(3000) // Exactly ₹30
    expect(summary.totalTransfers).toBe(2000) // Tracked separately
    expect(summary.netCashFlow).toBe(7000) // ₹100 - ₹30 = ₹70
  })

  // 4. Refund accounting
  it('4. applies refund as an expense offset and does not classify it as earned income', () => {
    // ₹100 income, ₹30 expense, ₹20 transfer, ₹10 linked refund
    // Expected net financial activity = ₹100 income - (₹30 - ₹10) net expense = ₹80 (8000 paise)
    const summary = calculateFinancialSummary([sampleIncome, sampleExpense, sampleTransfer, sampleRefund], 0)
    expect(summary.totalConfirmedIncome).toBe(10000)
    expect(summary.grossConfirmedExpenses).toBe(3000)
    expect(summary.totalRefunds).toBe(1000)
    expect(summary.totalConfirmedExpenses).toBe(2000) // Net expense: ₹20
    expect(summary.netCashFlow).toBe(8000) // Exactly ₹80 net cash flow!
  })

  // 5. Failed transaction exclusion
  it('5. strictly excludes failed transactions from confirmed and pending totals', () => {
    const failedExpense: Transaction = {
      ...sampleExpense,
      id: 'tx-failed-1',
      status: 'failed',
      amount: 999999,
    }
    const failedIncome: Transaction = {
      ...sampleIncome,
      id: 'tx-failed-2',
      status: 'failed',
      amount: 888888,
    }
    const summary = calculateFinancialSummary([sampleIncome, sampleExpense, failedExpense, failedIncome], 0)
    expect(summary.totalConfirmedIncome).toBe(10000)
    expect(summary.totalConfirmedExpenses).toBe(3000)
    expect(summary.failedCount).toBe(2)
  })

  // 6. Pending transaction handling
  it('6. separates pending transactions without altering confirmed totals or net cash flow', () => {
    const pendingExpense: Transaction = {
      ...sampleExpense,
      id: 'tx-pending-1',
      status: 'pending',
      amount: 4500, // ₹45.00
    }
    const pendingIncome: Transaction = {
      ...sampleIncome,
      id: 'tx-pending-2',
      status: 'pending',
      amount: 6000, // ₹60.00
    }
    const summary = calculateFinancialSummary([sampleIncome, sampleExpense, pendingExpense, pendingIncome], 0)
    expect(summary.totalConfirmedIncome).toBe(10000)
    expect(summary.totalConfirmedExpenses).toBe(3000)
    expect(summary.netCashFlow).toBe(7000)
    expect(summary.totalPendingIncome).toBe(6000)
    expect(summary.totalPendingExpenses).toBe(4500)
  })

  // 7. Exact paise arithmetic and currency formatting
  it('7. accurately computes integer paise arithmetic without floating-point errors', () => {
    // 0.1 + 0.2 in JS float is 0.30000000000000004
    // In paise: 10 + 20 = 30
    const p1 = rupeesToPaise('0.10')
    const p2 = rupeesToPaise('0.20')
    expect(p1).toBe(10)
    expect(p2).toBe(20)
    expect(addPaise(p1, p2)).toBe(30)
    expect(paiseToRupees(30)).toBe(0.3)
    expect(formatPaise(12550)).toContain('125.50')
    expect(formatPaise(1000000)).toContain('10,000')
  })

  // 8. Invalid amount rejection
  it('8. rejects invalid, non-finite, negative, or unsupported precision monetary values', () => {
    expect(() => rupeesToPaise(-15)).toThrow()
    expect(() => rupeesToPaise(NaN)).toThrow()
    expect(() => rupeesToPaise(Infinity)).toThrow()
    expect(() => rupeesToPaise('abc')).toThrow()
    expect(() => rupeesToPaise('12.345')).toThrow() // Exceeds 2 decimal precision

    const valRes = validateAmount('-50')
    expect(valRes.valid).toBe(false)
    expect(valRes.error).toBeDefined()

    const zeroRes = validateAmount('0')
    expect(zeroRes.valid).toBe(false)
  })

  // 9. Creating transactions
  it('9. adds a new transaction to the repository', async () => {
    const repo = new InMemoryTransactionRepository()
    await repo.add(sampleIncome)
    const all = await repo.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('tx-inc-1')
  })

  // 10. Editing transactions
  it('10. edits an existing transaction and updates stored values', async () => {
    const repo = new InMemoryTransactionRepository([sampleExpense])
    const updated: Transaction = {
      ...sampleExpense,
      amount: 4500, // Update from ₹30 to ₹45
      description: 'Updated stationery order',
    }
    await repo.update(updated)
    const fetched = await repo.getById('tx-exp-1')
    expect(fetched?.amount).toBe(4500)
    expect(fetched?.description).toBe('Updated stationery order')
  })

  // 11. Deleting transactions
  it('11. deletes a transaction and leaves repository consistent', async () => {
    const repo = new InMemoryTransactionRepository([sampleIncome, sampleExpense])
    await repo.delete('tx-exp-1')
    const all = await repo.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('tx-inc-1')
    const deleted = await repo.getById('tx-exp-1')
    expect(deleted).toBeNull()
  })

  // 12. Persistent storage across reloads
  it('12. maintains consistent state across repository operations', async () => {
    const repo = new InMemoryTransactionRepository()
    await repo.add(sampleIncome)
    await repo.add(sampleExpense)
    await repo.add(sampleTransfer)

    const list1 = await repo.getAll()
    expect(list1).toHaveLength(3)

    // Simulate reload by creating new repository instance with same persistent state
    const repoReloaded = new InMemoryTransactionRepository(list1)
    const list2 = await repoReloaded.getAll()
    expect(list2).toHaveLength(3)
    expect(list2.find((t) => t.id === 'tx-trf-1')?.amount).toBe(2000)
  })

  // 13. Duplicate detection
  it('13. detects potential duplicate transactions without blocking legitimate repeat purchases', () => {
    const existingList: Transaction[] = [
      {
        ...sampleExpense,
        externalRef: 'UPI/UTR123456',
        merchant: 'Blue Tokai Coffee',
      },
    ]

    // High confidence: same external reference
    const dupRef = detectDuplicate(
      {
        amount: 3000,
        type: 'expense',
        date: '2026-10-19T14:00:00.000Z',
        externalRef: 'UPI/UTR123456',
      },
      existingList
    )
    expect(dupRef.isDuplicate).toBe(true)
    expect(dupRef.confidence).toBe('high')

    // Medium confidence: same amount, same date, same merchant
    const dupMerchant = detectDuplicate(
      {
        amount: 3000,
        type: 'expense',
        date: '2026-10-19T12:00:00.000Z', // 1 hour apart
        merchant: 'Blue Tokai Coffee',
        description: 'Office stationery & supplies',
      },
      existingList
    )
    expect(dupMerchant.isDuplicate).toBe(true)
    expect(dupMerchant.confidence).toBe('medium')

    // Legitimate repeated purchase: different day, different merchant -> NOT a duplicate!
    const legitRepeat = detectDuplicate(
      {
        amount: 3000,
        type: 'expense',
        date: '2026-10-25T11:00:00.000Z', // 6 days later
        merchant: 'Chai Point',
        description: 'Snacks for team',
      },
      existingList
    )
    expect(legitRepeat.isDuplicate).toBe(false)
  })

  // 14. Combined search and filters
  it('14. correctly filters and searches transactions', () => {
    const items: Transaction[] = [
      sampleIncome, // ₹100, Income, Bank transfer
      sampleExpense, // ₹30, Shopping, UPI
      sampleTransfer, // ₹20, Transfer, Bank transfer
      sampleRefund, // ₹10, Shopping, UPI
    ]

    // Search for "stationery"
    const searchMatch = items.filter(
      (t) =>
        t.description.toLowerCase().includes('stationery') ||
        t.category.toLowerCase().includes('stationery')
    )
    expect(searchMatch).toHaveLength(2) // sampleExpense and sampleRefund

    // Filter by type: 'income'
    const incomeOnly = items.filter((t) => t.type === 'income')
    expect(incomeOnly).toHaveLength(1)

    // Filter by payment method: 'UPI'
    const upiOnly = items.filter((t) => t.paymentMethod === 'UPI')
    expect(upiOnly).toHaveLength(2)
  })

  // 15. CSV escaping and export
  it('15. correctly escapes commas, quotes, and produces valid RFC 4180 CSV with UTF-8 BOM', () => {
    expect(escapeCsvCell('Regular text')).toBe('Regular text')
    expect(escapeCsvCell('Text, with comma')).toBe('"Text, with comma"')
    expect(escapeCsvCell('Text with "quotes"')).toBe('"Text with ""quotes"""')
    expect(escapeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"')

    const complexTransaction: Transaction = {
      ...sampleExpense,
      description: 'Groceries, fruits & "organic" tea',
      notes: 'Contains newline\nand comma, notes',
    }

    const csv = generateTransactionsCsv([complexTransaction])
    // Must start with UTF-8 BOM
    expect(csv.startsWith('\uFEFF')).toBe(true)
    // Check header present
    expect(csv).toContain('Transaction ID,Date,Type,Amount (INR)')
    // Check amount converted to rupees
    expect(csv).toContain('30.00')
    // Check properly escaped description
    expect(csv).toContain('"Groceries, fruits & ""organic"" tea"')
  })
})
