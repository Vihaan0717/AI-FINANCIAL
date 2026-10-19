import { describe, it, expect } from 'vitest'
import type { Transaction } from '../src/types/transaction'
import type { BillInstance } from '../src/types/planner'
import {
  calculatePeriodLedger,
  compareSpendingPeriods,
  compareMonthOverMonth,
  compareWeekOverWeek,
  calculateCategorySpendingShifts,
  detectSpendingAnomalies,
  analyzeMerchantSpending,
  calculateNeedsVsWants,
  generateMonthlyReport,
  generateGroundedNarrative,
  generateFinancialIntelligence,
  DEFAULT_CATEGORY_CLASSIFICATION,
} from '../src/utils/insightCalculations'
import { calculateFinancialSummary } from '../src/utils/calculations'
import { formatPaise } from '../src/utils/money'

describe('Money Mate AI — Milestone 6.1–6.2 Financial Intelligence Engine Tests', () => {
  // Helper to make mock transaction
  function makeTx(overrides: Partial<Transaction>): Transaction {
    return {
      id: `tx-${Math.random().toString(36).slice(2, 9)}`,
      type: 'expense',
      amount: 10000, // ₹100.00
      currency: 'INR',
      date: '2026-10-15T10:00:00.000Z',
      description: 'Test transaction',
      category: 'Food & dining',
      paymentMethod: 'UPI',
      status: 'completed',
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
      ...overrides,
    }
  }

  // 1. Month-over-month increase
  it('1. correctly calculates month-over-month increase', () => {
    const txs: Transaction[] = [
      makeTx({ date: '2026-09-10', amount: 50000 }), // Sep: ₹500
      makeTx({ date: '2026-10-12', amount: 80000 }), // Oct: ₹800
    ]
    const comparison = compareMonthOverMonth(txs, 2026, 10)
    expect(comparison.currentSpendingPaise).toBe(80000)
    expect(comparison.previousSpendingPaise).toBe(50000)
    expect(comparison.deltaPaise).toBe(30000)
    expect(comparison.direction).toBe('increased')
    expect(comparison.percentageChangeState).toBe('calculated')
    expect(comparison.percentageChange).toBe(60.0) // (+300 / 500) * 100 = 60.0%
  })

  // 2. Month-over-month decrease
  it('2. correctly calculates month-over-month decrease', () => {
    const txs: Transaction[] = [
      makeTx({ date: '2026-09-10', amount: 100000 }), // Sep: ₹1,000
      makeTx({ date: '2026-10-12', amount: 75000 }),  // Oct: ₹750
    ]
    const comparison = compareMonthOverMonth(txs, 2026, 10)
    expect(comparison.currentSpendingPaise).toBe(75000)
    expect(comparison.previousSpendingPaise).toBe(100000)
    expect(comparison.deltaPaise).toBe(-25000)
    expect(comparison.direction).toBe('decreased')
    expect(comparison.percentageChangeState).toBe('calculated')
    expect(comparison.percentageChange).toBe(-25.0) // (-250 / 1000) * 100 = -25.0%
  })

  // 3. Zero previous spending (new spending; percentage change undefined, never 100%)
  it('3. handles zero previous spending as new_spending with undefined percentage', () => {
    const txs: Transaction[] = [
      makeTx({ date: '2026-10-12', amount: 45000 }), // Oct: ₹450
    ]
    const comparison = compareMonthOverMonth(txs, 2026, 10)
    expect(comparison.currentSpendingPaise).toBe(45000)
    expect(comparison.previousSpendingPaise).toBe(0)
    expect(comparison.deltaPaise).toBe(45000)
    expect(comparison.direction).toBe('increased')
    expect(comparison.percentageChangeState).toBe('new_spending')
    expect(comparison.percentageChange).toBeUndefined() // Explicitly undefined, NOT 100%!
  })

  // 4. Both periods having zero spending
  it('4. handles both periods zero spending as no_change with percentage 0', () => {
    const comparison = compareMonthOverMonth([], 2026, 10)
    expect(comparison.currentSpendingPaise).toBe(0)
    expect(comparison.previousSpendingPaise).toBe(0)
    expect(comparison.deltaPaise).toBe(0)
    expect(comparison.direction).toBe('unchanged')
    expect(comparison.percentageChangeState).toBe('no_change')
    expect(comparison.percentageChange).toBe(0)
  })

  // 5. Week-over-week comparisons
  it('5. correctly calculates week-over-week comparison over rolling 7-day windows', () => {
    const txs: Transaction[] = [
      makeTx({ date: '2026-10-15', amount: 20000 }), // Current week window
      makeTx({ date: '2026-10-17', amount: 30000 }), // Current week window
      makeTx({ date: '2026-10-08', amount: 40000 }), // Prior week window
    ]
    const comparison = compareWeekOverWeek(txs, '2026-10-18T12:00:00.000Z')
    expect(comparison.currentSpendingPaise).toBe(50000)
    expect(comparison.previousSpendingPaise).toBe(40000)
    expect(comparison.deltaPaise).toBe(10000)
    expect(comparison.direction).toBe('increased')
    expect(comparison.percentageChangeState).toBe('calculated')
    expect(comparison.percentageChange).toBe(25.0)
  })

  // 6. Month and year boundaries (January to December of previous year)
  it('6. safely transitions year and month boundaries for January', () => {
    const txs: Transaction[] = [
      makeTx({ date: '2025-12-25', amount: 90000 }), // Dec 2025
      makeTx({ date: '2026-01-05', amount: 60000 }), // Jan 2026
    ]
    const comparison = compareMonthOverMonth(txs, 2026, 1)
    expect(comparison.currentPeriodLabel).toBe('January 2026')
    expect(comparison.previousPeriodLabel).toBe('December 2025')
    expect(comparison.currentSpendingPaise).toBe(60000)
    expect(comparison.previousSpendingPaise).toBe(90000)
    expect(comparison.deltaPaise).toBe(-30000)
    expect(comparison.direction).toBe('decreased')
  })

  // 7. Category attribution accuracy
  it('7. calculates accurate category increase attribution percentages', () => {
    const prevTxs: Transaction[] = [
      makeTx({ category: 'Food & dining', amount: 20000 }), // ₹200
      makeTx({ category: 'Transport', amount: 10000 }),     // ₹100
      makeTx({ category: 'Utilities', amount: 30000 }),     // ₹300
    ]
    const curTxs: Transaction[] = [
      makeTx({ category: 'Food & dining', amount: 50000 }), // +₹300 increase
      makeTx({ category: 'Transport', amount: 20000 }),     // +₹100 increase
      makeTx({ category: 'Utilities', amount: 15000 }),     // -₹150 decrease
    ]
    // Total positive increases = ₹300 + ₹100 = ₹400
    // Food & dining contribution = 300 / 400 * 100 = 75.0%
    // Transport contribution = 100 / 400 * 100 = 25.0%
    const shifts = calculateCategorySpendingShifts(curTxs, prevTxs)
    const foodShift = shifts.find((s) => s.category === 'Food & dining')!
    const transportShift = shifts.find((s) => s.category === 'Transport')!
    const utilShift = shifts.find((s) => s.category === 'Utilities')!

    expect(foodShift.deltaPaise).toBe(30000)
    expect(foodShift.contributionToOverallIncreasePct).toBe(75.0)

    expect(transportShift.deltaPaise).toBe(10000)
    expect(transportShift.contributionToOverallIncreasePct).toBe(25.0)

    expect(utilShift.deltaPaise).toBe(-15000)
    expect(utilShift.contributionToOverallIncreasePct).toBeUndefined()
  })

  // 8. Category attribution behavior when there is no net increase
  it('8. sets contributionToOverallIncreasePct to undefined when no categories increased', () => {
    const prevTxs = [makeTx({ category: 'Shopping', amount: 50000 })]
    const curTxs = [makeTx({ category: 'Shopping', amount: 30000 })] // Decreased
    const shifts = calculateCategorySpendingShifts(curTxs, prevTxs)
    expect(shifts[0].deltaPaise).toBe(-20000)
    expect(shifts[0].contributionToOverallIncreasePct).toBeUndefined()
  })

  // 9. Transfers excluded from spending
  it('9. strictly excludes transfers from confirmed income and expenses', () => {
    const txs: Transaction[] = [
      makeTx({ type: 'transfer', amount: 100000, fromAccount: 'Bank A', toAccount: 'Bank B' }),
      makeTx({ type: 'expense', amount: 15000 }),
    ]
    const ledger = calculatePeriodLedger(txs)
    expect(ledger.grossConfirmedExpensesPaise).toBe(15000)
    expect(ledger.netConfirmedExpensesPaise).toBe(15000)
    expect(ledger.confirmedIncomePaise).toBe(0)
    expect(ledger.categoryExpenses.has('Transfer')).toBe(false)
  })

  // 10. Failed transactions excluded
  it('10. strictly excludes failed transactions from all calculations', () => {
    const txs: Transaction[] = [
      makeTx({ type: 'expense', amount: 50000, status: 'failed' }),
      makeTx({ type: 'expense', amount: 20000, status: 'completed' }),
      makeTx({ type: 'income', amount: 80000, status: 'failed' }),
    ]
    const ledger = calculatePeriodLedger(txs)
    expect(ledger.netConfirmedExpensesPaise).toBe(20000)
    expect(ledger.confirmedIncomePaise).toBe(0)
    expect(ledger.completedExpenses.length).toBe(1)
  })

  // 11. Pending transactions kept separate
  it('11. excludes pending transactions from confirmed calculations', () => {
    const txs: Transaction[] = [
      makeTx({ type: 'expense', amount: 40000, status: 'pending' }),
      makeTx({ type: 'income', amount: 90000, status: 'pending' }),
      makeTx({ type: 'expense', amount: 12000, status: 'completed' }),
    ]
    const ledger = calculatePeriodLedger(txs)
    expect(ledger.netConfirmedExpensesPaise).toBe(12000)
    expect(ledger.confirmedIncomePaise).toBe(0)
  })

  // 12. Refunds correctly associated with expenses
  it('12. associates linked refund with original expense category and lowers it', () => {
    const origExpense = makeTx({ id: 'exp-orig-1', category: 'Shopping', amount: 8000 })
    const refundTx = makeTx({
      id: 'ref-1',
      type: 'refund',
      amount: 3000,
      linkedTransactionId: 'exp-orig-1',
    })
    const ledger = calculatePeriodLedger([origExpense, refundTx])
    expect(ledger.grossConfirmedExpensesPaise).toBe(8000)
    expect(ledger.totalRefundsPaise).toBe(3000)
    expect(ledger.netConfirmedExpensesPaise).toBe(5000)
    expect(ledger.categoryExpenses.get('Shopping')?.paise).toBe(5000)
  })

  // 13. Unallocated refunds handled transparently
  it('13. handles unallocated refunds transparently with data quality warning', () => {
    const exp = makeTx({ amount: 10000, category: 'Food & dining' })
    const unallocatedRefund = makeTx({
      id: 'ref-orphan',
      type: 'refund',
      amount: 2500,
      description: 'Dispute credit refund',
      category: '',
    })
    const ledger = calculatePeriodLedger([exp, unallocatedRefund])
    expect(ledger.netConfirmedExpensesPaise).toBe(7500)
    expect(ledger.unallocatedRefundsPaise).toBe(2500)
    expect(ledger.warnings.length).toBeGreaterThan(0)
    expect(ledger.warnings[0]).toContain('Dispute credit refund')
  })

  // 14. Refunds not counted twice
  it('14. prevents duplicate refund counting if duplicate records exist', () => {
    const exp = makeTx({ id: 'exp-1', category: 'Health', amount: 15000 })
    const ref = makeTx({ id: 'ref-dup', type: 'refund', amount: 5000, linkedTransactionId: 'exp-1' })
    // Passing the exact same refund twice
    const ledger = calculatePeriodLedger([exp, ref, ref])
    expect(ledger.totalRefundsPaise).toBe(5000) // Counted only once
    expect(ledger.netConfirmedExpensesPaise).toBe(10000)
  })

  // 15. Anomaly detection with sufficient history
  it('15. detects spending anomaly using median multiplier with sufficient history', () => {
    // 5 standard expenses of ₹200 and one spike of ₹1,200
    const txs: Transaction[] = [
      makeTx({ id: 't1', category: 'Food & dining', amount: 20000 }),
      makeTx({ id: 't2', category: 'Food & dining', amount: 21000 }),
      makeTx({ id: 't3', category: 'Food & dining', amount: 19000 }),
      makeTx({ id: 't4', category: 'Food & dining', amount: 20000 }),
      makeTx({ id: 't5', category: 'Food & dining', amount: 22000 }),
      makeTx({ id: 't6-spike', category: 'Food & dining', amount: 120000, description: 'Luxury Banquet' }),
    ]
    const result = detectSpendingAnomalies(txs, { minSampleSize: 5, medianMultiplierThreshold: 2.5 })
    expect(result.insufficientHistory).toBe(false)
    expect(result.anomalies.length).toBe(1)
    expect(result.anomalies[0].transactionId).toBe('t6-spike')
    expect(result.anomalies[0].triggerReason).toBe('median_multiple')
    expect(result.anomalies[0].multipleOfMedian).toBeGreaterThanOrEqual(5.0)
  })

  // 16. Insufficient-history behavior
  it('16. clearly flags insufficient history when transaction count is below minimum sample size', () => {
    const txs = [
      makeTx({ category: 'Utilities', amount: 5000 }),
      makeTx({ category: 'Utilities', amount: 6000 }),
    ]
    const result = detectSpendingAnomalies(txs, { minSampleSize: 5 })
    expect(result.insufficientHistory).toBe(true)
    expect(result.anomalies.length).toBe(0)
    expect(result.message).toContain('Insufficient transaction history')
  })

  // 17. Merchant aggregation
  it('17. aggregates merchant volume, frequency, and handles unidentified merchants', () => {
    const txs: Transaction[] = [
      makeTx({ merchant: 'Swiggy', amount: 45000 }),
      makeTx({ merchant: 'Swiggy', amount: 35000 }),
      makeTx({ merchant: 'Amazon India', amount: 150000 }),
      makeTx({ merchant: '', description: '', amount: 5000 }), // Unidentified
    ]
    const res = analyzeMerchantSpending(txs)
    expect(res.uniqueMerchantCount).toBe(2)
    expect(res.topMerchantsBySpend[0].merchant).toBe('Amazon India')
    expect(res.topMerchantsBySpend[0].totalPaise).toBe(150000)

    expect(res.frequentMerchants[0].merchant).toBe('Swiggy')
    expect(res.frequentMerchants[0].transactionCount).toBe(2)
    expect(res.frequentMerchants[0].averagePaise).toBe(40000)

    expect(res.unidentifiedMerchantSpendPaise).toBe(5000)
    expect(res.unidentifiedTransactionCount).toBe(1)
  })

  // 18. Needs-versus-wants classification
  it('18. classifies expenses into needs, wants, and savings according to configuration', () => {
    const txs: Transaction[] = [
      makeTx({ category: 'Groceries', amount: 50000 }),  // Need
      makeTx({ category: 'Utilities', amount: 30000 }),  // Need
      makeTx({ category: 'Shopping', amount: 20000 }),   // Want
      makeTx({ category: 'Investment', amount: 50000 }), // Savings/Investments
      makeTx({ category: 'Transfer', type: 'transfer', amount: 20000 }), // Transfer
    ]
    const split = calculateNeedsVsWants(txs)
    expect(split.needsPaise).toBe(80000)
    expect(split.wantsPaise).toBe(20000)
    expect(split.savingsInvestmentsPaise).toBe(50000)
    expect(split.transfersPaise).toBe(20000)
    // Operational expenses: 80000 + 20000 = 100000 (excludes savings and transfers)
    expect(split.totalOperationalExpensesPaise).toBe(100000)
    expect(split.needsPercentageOfExpenses).toBe(80)
    expect(split.wantsPercentageOfExpenses).toBe(20)
    expect(split.isBenchmark50_30_20Comparable).toBe(true)
  })

  // 19. Unclassified categories remain unclassified
  it('19. does not silently force unclassified categories into needs or wants', () => {
    const txs: Transaction[] = [
      makeTx({ category: 'Crypto Mining Hardware', amount: 40000 }),
      makeTx({ category: 'Groceries', amount: 60000 }),
    ]
    const split = calculateNeedsVsWants(txs)
    expect(split.needsPaise).toBe(60000)
    expect(split.wantsPaise).toBe(0)
    expect(split.unclassifiedPaise).toBe(40000)
    expect(split.unclassifiedCategories).toContain('Crypto Mining Hardware')
    expect(split.isBenchmark50_30_20Comparable).toBe(false)
  })

  // 20. Narrative figures exactly match calculated values
  it('20. generates grounded narrative with figures matching calculated period comparison', () => {
    const prevTxs = [makeTx({ category: 'Food & dining', amount: 40000 })]
    const curTxs = [makeTx({ category: 'Food & dining', amount: 70000 })]

    const monthComp = compareSpendingPeriods(curTxs, prevTxs, {
      currentLabel: 'October 2026',
      previousLabel: 'September 2026',
    })
    const shifts = calculateCategorySpendingShifts(curTxs, prevTxs)
    const needsWants = calculateNeedsVsWants(curTxs)
    const anomalies = detectSpendingAnomalies(curTxs)

    const narrative = generateGroundedNarrative(monthComp, shifts, needsWants, anomalies)

    expect(narrative.headline).toContain('₹300') // delta
    expect(narrative.headline).toContain('75%')  // percentage
    expect(narrative.summaryText).toContain('₹400')
    expect(narrative.summaryText).toContain('₹700')
    expect(narrative.supportingEvidence.currentSpendPaise).toBe(70000)
    expect(narrative.supportingEvidence.previousSpendPaise).toBe(40000)
    expect(narrative.supportingEvidence.deltaPaise).toBe(30000)
  })

  // 21. Empty datasets
  it('21. gracefully processes empty datasets without errors or NaN', () => {
    const report = generateMonthlyReport([], [], 2026, 10)
    expect(report.confirmedIncomePaise).toBe(0)
    expect(report.netConfirmedExpensesPaise).toBe(0)
    expect(report.savingsRatePct).toBeUndefined()
    expect(report.categoryShifts).toEqual([])
    expect(report.topMerchants).toEqual([])
    expect(report.spikesAndAnomalies).toEqual([])
    expect(report.upcomingCommitmentsSummary.upcomingBillsPaise).toBe(0)
  })

  // 22. Existing financial-engine regression checks
  it('22. verifies calculatePeriodLedger produces identical net figures to calculateFinancialSummary', () => {
    const mixedTxs: Transaction[] = [
      makeTx({ id: 'tx-1', type: 'income', amount: 150000 }),
      makeTx({ id: 'tx-2', type: 'expense', category: 'Utilities', amount: 45000 }),
      makeTx({ id: 'tx-3', type: 'expense', category: 'Shopping', amount: 30000 }),
      makeTx({ id: 'tx-4', type: 'refund', category: 'Shopping', amount: 10000, linkedTransactionId: 'tx-3' }),
      makeTx({ id: 'tx-5', type: 'transfer', amount: 25000 }),
      makeTx({ id: 'tx-6', type: 'expense', amount: 12000, status: 'pending' }),
      makeTx({ id: 'tx-7', type: 'expense', amount: 9000, status: 'failed' }),
    ]

    const existingSummary = calculateFinancialSummary(mixedTxs, 0)
    const periodLedger = calculatePeriodLedger(mixedTxs)

    expect(periodLedger.confirmedIncomePaise).toBe(existingSummary.totalConfirmedIncome)
    expect(periodLedger.grossConfirmedExpensesPaise).toBe(existingSummary.grossConfirmedExpenses)
    expect(periodLedger.totalRefundsPaise).toBe(existingSummary.totalRefunds)
    expect(periodLedger.netConfirmedExpensesPaise).toBe(existingSummary.totalConfirmedExpenses)
    expect(periodLedger.netCashFlowPaise).toBe(existingSummary.netCashFlow)
  })

  // 23. Monthly Report upcoming bills and SIP distinction
  it('23. incorporates upcoming bills into monthly report without double-counting settled bills', () => {
    const bills: BillInstance[] = [
      {
        id: 'bill-1',
        title: 'Electricity Bill',
        category: 'Utilities',
        amountPaise: 25000,
        commitmentType: 'expense',
        dueDate: '2026-10-25',
        status: 'upcoming',
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
      {
        id: 'bill-2',
        title: 'Nifty 50 Index SIP',
        category: 'Investment',
        amountPaise: 50000,
        commitmentType: 'savings',
        dueDate: '2026-10-28',
        status: 'upcoming',
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
      {
        id: 'bill-3',
        title: 'Settled Phone Bill',
        category: 'Utilities',
        amountPaise: 99900,
        commitmentType: 'expense',
        dueDate: '2026-10-05',
        status: 'paid', // Should be excluded!
        linkedTransactionId: 'tx-paid-1',
        createdAt: '2026-10-01',
        updatedAt: '2026-10-05',
      },
    ]

    const report = generateMonthlyReport([], bills, 2026, 10)
    expect(report.upcomingCommitmentsSummary.upcomingBillsPaise).toBe(25000)
    expect(report.upcomingCommitmentsSummary.upcomingSipsPaise).toBe(50000)
    expect(report.upcomingCommitmentsSummary.count).toBe(2)
  })

  // 24. Full Orchestrator Integration
  it('24. generateFinancialIntelligence orchestrates all sub-modules without error', () => {
    const txs: Transaction[] = [
      makeTx({ date: '2026-10-02', category: 'Groceries', amount: 35000, merchant: 'D-Mart' }),
      makeTx({ date: '2026-10-05', category: 'Food & dining', amount: 15000, merchant: 'Swiggy' }),
      makeTx({ date: '2026-09-15', category: 'Groceries', amount: 30000, merchant: 'D-Mart' }),
    ]
    const intel = generateFinancialIntelligence(txs, [], { year: 2026, month: 10 })
    expect(intel.monthOverMonth.currentSpendingPaise).toBe(50000)
    expect(intel.monthOverMonth.previousSpendingPaise).toBe(30000)
    expect(intel.categoryShifts.length).toBeGreaterThan(0)
    expect(intel.needsWants.needsPaise).toBe(35000)
    expect(intel.needsWants.wantsPaise).toBe(15000)
    expect(intel.merchantAnalytics.topMerchantsBySpend[0].merchant).toBe('D-Mart')
    expect(intel.narrative.headline).toBeTruthy()
  })

  // 25. Demo vs Live dataset isolation
  it('25. strictly isolates intelligence when switching between demo and live datasets', () => {
    const liveTxs: Transaction[] = [
      makeTx({ id: 'live-1', amount: 120000, date: '2026-10-10', category: 'Rent' }),
    ]
    const demoTxs: Transaction[] = [
      makeTx({ id: 'demo-1', amount: 45000, date: '2026-10-12', category: 'Entertainment' }),
    ]

    const liveIntel = generateFinancialIntelligence(liveTxs, [], { year: 2026, month: 10 })
    const demoIntel = generateFinancialIntelligence(demoTxs, [], { year: 2026, month: 10 })

    expect(liveIntel.monthOverMonth.currentSpendingPaise).toBe(120000)
    expect(demoIntel.monthOverMonth.currentSpendingPaise).toBe(45000)
    expect(liveIntel.categoryShifts.some((c) => c.category === 'Entertainment')).toBe(false)
    expect(demoIntel.categoryShifts.some((c) => c.category === 'Rent')).toBe(false)
  })

  // 26. Recalculation after new transaction added
  it('26. dynamically recomputes intelligence when a new transaction is appended', () => {
    const baseTxs: Transaction[] = [
      makeTx({ id: 'tx-1', amount: 10000, date: '2026-10-01', category: 'Food & dining' }),
    ]
    const intel1 = generateFinancialIntelligence(baseTxs, [], { year: 2026, month: 10 })
    expect(intel1.monthOverMonth.currentSpendingPaise).toBe(10000)

    const updatedTxs = [
      ...baseTxs,
      makeTx({ id: 'tx-2', amount: 25000, date: '2026-10-05', category: 'Food & dining' }),
    ]
    const intel2 = generateFinancialIntelligence(updatedTxs, [], { year: 2026, month: 10 })
    expect(intel2.monthOverMonth.currentSpendingPaise).toBe(35000)
  })

  // 27. Zero-baseline comparisons: new_spending vs no_change vs calculated
  it('27. correctly handles zero-baseline comparisons across all three states', () => {
    // State A: previous = 0, current > 0 -> new_spending
    const cmpNew = compareSpendingPeriods([makeTx({ amount: 5000 })], [], {
      currentLabel: 'Oct 2026',
      previousLabel: 'Sep 2026',
    })
    expect(cmpNew.percentageChangeState).toBe('new_spending')
    expect(cmpNew.percentageChange).toBeUndefined()
    expect(cmpNew.direction).toBe('increased')

    // State B: previous = 0, current = 0 -> no_change
    const cmpNoChange = compareSpendingPeriods([], [], {
      currentLabel: 'Oct 2026',
      previousLabel: 'Sep 2026',
    })
    expect(cmpNoChange.percentageChangeState).toBe('no_change')
    expect(cmpNoChange.percentageChange).toBe(0)
    expect(cmpNoChange.direction).toBe('unchanged')

    // State C: previous > 0, current > 0 -> calculated
    const cmpCalc = compareSpendingPeriods(
      [makeTx({ amount: 15000 })],
      [makeTx({ amount: 10000 })],
      { currentLabel: 'Oct 2026', previousLabel: 'Sep 2026' }
    )
    expect(cmpCalc.percentageChangeState).toBe('calculated')
    expect(cmpCalc.percentageChange).toBe(50)
    expect(cmpCalc.direction).toBe('increased')
  })

  // 28. Pending transactions reported separately
  it('28. keeps pending transactions distinguishable and excluded from confirmed expenses', () => {
    const txs: Transaction[] = [
      makeTx({ id: 'tx-comp', amount: 50000, status: 'completed', date: '2026-10-10' }),
      makeTx({ id: 'tx-pend', amount: 20000, status: 'pending', date: '2026-10-12' }),
    ]
    const ledger = calculatePeriodLedger(txs)
    expect(ledger.netConfirmedExpensesPaise).toBe(50000)
    expect(ledger.pendingExpensesPaise).toBe(20000)
    expect(ledger.confirmedIncomePaise).toBe(0)
  })

  // 29. Failed transactions strictly excluded
  it('29. completely excludes failed transactions from historical spending totals', () => {
    const txs: Transaction[] = [
      makeTx({ id: 'tx-comp', amount: 50000, status: 'completed', date: '2026-10-10' }),
      makeTx({ id: 'tx-fail', amount: 999999, status: 'failed', date: '2026-10-12' }),
    ]
    const ledger = calculatePeriodLedger(txs)
    expect(ledger.netConfirmedExpensesPaise).toBe(50000)
    expect(ledger.pendingExpensesPaise).toBe(0)
  })

  // 30. Unclassified categories are transparently isolated
  it('30. cleanly isolates unclassified categories in Needs vs. Wants calculations', () => {
    const txs: Transaction[] = [
      makeTx({ category: 'Groceries', amount: 40000 }), // Need
      makeTx({ category: 'Entertainment', amount: 20000 }), // Want
      makeTx({ category: 'CryptoAirdropTax', amount: 10000 }), // Unclassified
    ]
    const nw = calculateNeedsVsWants(txs)
    expect(nw.needsPaise).toBe(40000)
    expect(nw.wantsPaise).toBe(20000)
    expect(nw.unclassifiedPaise).toBe(10000)
    expect(nw.unclassifiedCategories).toContain('CryptoAirdropTax')
    expect(nw.unclassifiedPercentageOfExpenses).toBe(14) // 10k / 70k ≈ 14.3% -> rounded 14%
  })

  // 31. Insufficient anomaly history
  it('31. flags insufficientHistory when category sample size is below threshold', () => {
    const txs: Transaction[] = [
      makeTx({ category: 'Gadgets', amount: 5000, date: '2026-10-01' }),
      makeTx({ category: 'Gadgets', amount: 6000, date: '2026-10-02' }),
    ]
    const res = detectSpendingAnomalies(txs, 2026, 10, { minSampleSize: 5 })
    expect(res.insufficientHistory).toBe(true)
    expect(res.anomalies.length).toBe(0)
  })

  // 32. Upcoming bills exclude settled and cancelled bills
  it('32. excludes settled, paid, skipped, and cancelled bills from upcoming commitments', () => {
    const bills: BillInstance[] = [
      {
        id: 'b-active',
        title: 'Electricity',
        category: 'Utilities',
        amountPaise: 15000,
        commitmentType: 'expense',
        dueDate: '2026-10-25',
        status: 'upcoming',
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
      {
        id: 'b-settled',
        title: 'Water Bill',
        category: 'Utilities',
        amountPaise: 8000,
        commitmentType: 'expense',
        dueDate: '2026-10-10',
        status: 'upcoming',
        linkedTransactionId: 'tx-linked-99', // Linked -> should be excluded!
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
      {
        id: 'b-skipped',
        title: 'Gym Membership',
        category: 'Health',
        amountPaise: 20000,
        commitmentType: 'expense',
        dueDate: '2026-10-15',
        status: 'skipped', // Skipped -> should be excluded!
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
    ]
    const report = generateMonthlyReport([], bills, 2026, 10)
    expect(report.upcomingCommitmentsSummary.count).toBe(1)
    expect(report.upcomingCommitmentsSummary.upcomingBillsPaise).toBe(15000)
  })

  // 33. Empty dataset handling
  it('33. gracefully generates monthly report and intelligence on an empty dataset', () => {
    const intel = generateFinancialIntelligence([], [], { year: 2026, month: 10 })
    expect(intel.monthOverMonth.currentSpendingPaise).toBe(0)
    expect(intel.monthOverMonth.previousSpendingPaise).toBe(0)
    expect(intel.monthOverMonth.direction).toBe('unchanged')
    expect(intel.categoryShifts).toEqual([])
    expect(intel.needsWants.needsPaise).toBe(0)
    expect(intel.needsWants.wantsPaise).toBe(0)
    expect(intel.merchantAnalytics.uniqueMerchantCount).toBe(0)
    expect(intel.anomaliesResult.insufficientHistory).toBe(true)
    expect(intel.narrative.summaryText).toBeTruthy()
  })

  // 34. Markdown report generation
  it('34. generates a complete and formatted monthly report markdown string', () => {
    const txs: Transaction[] = [
      makeTx({ type: 'income', amount: 100000, category: 'Salary', date: '2026-10-01' }),
      makeTx({ type: 'expense', amount: 40000, category: 'Groceries', date: '2026-10-05', merchant: 'BigBasket' }),
    ]
    const report = generateMonthlyReport(txs, [], 2026, 10)
    expect(report.confirmedIncomePaise).toBe(100000)
    expect(report.netConfirmedExpensesPaise).toBe(40000)
    expect(report.netSavingsCashFlowPaise).toBe(60000)
    expect(report.savingsRatePct).toBe(60)
  })
})
