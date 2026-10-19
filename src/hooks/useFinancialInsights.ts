import { useState, useMemo, useCallback } from 'react'
import type { Transaction } from '../types/transaction'
import type { BillInstance } from '../types/planner'
import type {
  FinancialIntelligence,
  MonthlyFinancialReport,
  PeriodComparison,
  CategorySpendingShift,
  NeedsWantsBreakdown,
  AnomalyDetectionResult,
  MerchantAnalysisResult,
  GroundedInsightNarrative,
  CategoryClassificationMap,
} from '../types/insights'
import {
  generateFinancialIntelligence,
  generateMonthlyReport,
  formatMonthLabel,
  extractLocalDate,
} from '../utils/insightCalculations'
import { parseLocalDateString, getTodayDateString } from '../utils/recurrenceEngine'
import { formatPaise } from '../utils/money'

export interface UseFinancialInsightsOptions {
  transactions: Transaction[]
  bills?: BillInstance[]
  isDemoMode: boolean
  userBudgetLimitPaise?: number
  classificationMap?: CategoryClassificationMap
  initialYear?: number
  initialMonth?: number // 1-12
  loading?: boolean
}

export interface PeriodOption {
  year: number
  month: number
  label: string
}

export interface UseFinancialInsightsReturn {
  // Period navigation
  selectedYear: number
  selectedMonth: number
  selectedMonthLabel: string
  availablePeriods: PeriodOption[]
  setSelectedPeriod: (year: number, month: number) => void
  goToPreviousMonth: () => void
  goToNextMonth: () => void
  resetToCurrentMonth: () => void

  // Intelligence calculations
  intelligence: FinancialIntelligence
  monthlyReport: MonthlyFinancialReport
  monthOverMonth: PeriodComparison
  weekOverWeek: PeriodComparison
  categoryShifts: CategorySpendingShift[]
  needsWants: NeedsWantsBreakdown
  anomaliesResult: AnomalyDetectionResult
  merchantAnalytics: MerchantAnalysisResult
  narrative: GroundedInsightNarrative

  // Status flags
  loading: boolean
  isEmpty: boolean
  hasNoTransactionsInPeriod: boolean
  insufficientHistory: boolean
  dataQualityWarnings: string[]
  isDemoMode: boolean

  // Client-side report export
  exportMonthlyReportMarkdown: () => string
  downloadMonthlyReport: (customFilename?: string) => void
}

/**
 * Custom React Hook for Financial Insights.
 * Purely consumes existing authoritative ledger transactions and planner bills.
 * Respects Demo/Live isolation with zero state duplication.
 */
export function useFinancialInsights({
  transactions,
  bills = [],
  isDemoMode,
  userBudgetLimitPaise,
  classificationMap,
  initialYear,
  initialMonth,
  loading = false,
}: UseFinancialInsightsOptions): UseFinancialInsightsReturn {
  // 1. Determine active reference date
  const todayParts = useMemo(() => parseLocalDateString(getTodayDateString()), [])
  const [selectedYear, setSelectedYear] = useState<number>(initialYear ?? todayParts.year)
  const [selectedMonth, setSelectedMonth] = useState<number>(initialMonth ?? todayParts.month)

  const selectedMonthLabel = useMemo(
    () => formatMonthLabel(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  )

  // 2. Compute available historical and upcoming periods
  const availablePeriods = useMemo<PeriodOption[]>(() => {
    const periodSet = new Set<string>()

    // Current month is always available
    const curKey = `${todayParts.year}-${todayParts.month}`
    periodSet.add(curKey)

    // Add months from transactions
    for (const t of transactions) {
      if (t.status === 'completed' || t.status === 'pending') {
        const d = extractLocalDate(t.date)
        const yr = parseInt(d.slice(0, 4), 10)
        const mo = parseInt(d.slice(5, 7), 10)
        if (!isNaN(yr) && !isNaN(mo)) {
          periodSet.add(`${yr}-${mo}`)
        }
      }
    }

    // Add past 6 months if not already present
    for (let i = 1; i <= 6; i++) {
      let m = todayParts.month - i
      let y = todayParts.year
      while (m <= 0) {
        m += 12
        y -= 1
      }
      periodSet.add(`${y}-${m}`)
    }

    const list: PeriodOption[] = Array.from(periodSet).map((k) => {
      const [y, m] = k.split('-').map(Number)
      return { year: y, month: m, label: formatMonthLabel(y, m) }
    })

    // Sort descending (newest month first)
    list.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      return b.month - a.month
    })

    return list
  }, [transactions, todayParts.year, todayParts.month])

  // Navigation handlers
  const setSelectedPeriod = useCallback((year: number, month: number) => {
    setSelectedYear(year)
    setSelectedMonth(month)
  }, [])

  const goToPreviousMonth = useCallback(() => {
    setSelectedMonth((prevM) => {
      if (prevM === 1) {
        setSelectedYear((prevY) => prevY - 1)
        return 12
      }
      return prevM - 1
    })
  }, [])

  const goToNextMonth = useCallback(() => {
    setSelectedMonth((prevM) => {
      if (prevM === 12) {
        setSelectedYear((prevY) => prevY + 1)
        return 1
      }
      return prevM + 1
    })
  }, [])

  const resetToCurrentMonth = useCallback(() => {
    setSelectedYear(todayParts.year)
    setSelectedMonth(todayParts.month)
  }, [todayParts.year, todayParts.month])

  // 3. Compute Financial Intelligence (memoized)
  const intelligence = useMemo(() => {
    return generateFinancialIntelligence(transactions, bills, {
      year: selectedYear,
      month: selectedMonth,
      classificationMap,
    })
  }, [transactions, bills, selectedYear, selectedMonth, classificationMap])

  const monthlyReport = useMemo(() => {
    return generateMonthlyReport(
      transactions,
      bills,
      selectedYear,
      selectedMonth,
      classificationMap
    )
  }, [transactions, bills, selectedYear, selectedMonth, classificationMap])

  // 4. Status flags
  const isEmpty = transactions.length === 0
  const currentPrefix = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
  const hasNoTransactionsInPeriod = useMemo(() => {
    return !transactions.some(
      (t) => extractLocalDate(t.date).startsWith(currentPrefix) && t.status === 'completed'
    )
  }, [transactions, currentPrefix])

  const insufficientHistory = intelligence.anomaliesResult.insufficientHistory

  // 5. Generate Markdown Report for free download
  const exportMonthlyReportMarkdown = useCallback((): string => {
    const lines: string[] = []
    lines.push(`# Money Mate AI — Financial Report`)
    lines.push(`**Reporting Period:** ${selectedMonthLabel}`)
    lines.push(`**Workspace Mode:** ${isDemoMode ? 'Demo Workspace' : 'Live Data'}`)
    lines.push(`**Generated:** ${new Date().toLocaleString('en-IN')}`)
    lines.push(`\n---\n`)

    lines.push(`## 1. Executive Cash Flow Summary`)
    lines.push(`- **Confirmed Income:** ${formatPaise(monthlyReport.confirmedIncomePaise)}`)
    lines.push(`- **Gross Confirmed Expenses:** ${formatPaise(monthlyReport.grossConfirmedExpensesPaise)}`)
    lines.push(`- **Refunds Credited:** ${formatPaise(monthlyReport.refundsPaise)}`)
    lines.push(`- **Net Confirmed Expenses:** ${formatPaise(monthlyReport.netConfirmedExpensesPaise)}`)
    lines.push(`- **Net Cash Flow:** ${formatPaise(monthlyReport.netSavingsCashFlowPaise)}`)
    if (monthlyReport.savingsRatePct !== undefined) {
      lines.push(`- **Savings Rate:** ${monthlyReport.savingsRatePct}%`)
    }
    if (userBudgetLimitPaise !== undefined && userBudgetLimitPaise > 0) {
      lines.push(`- **Monthly Budget Target:** ${formatPaise(userBudgetLimitPaise)}`)
      const budgetVariance = userBudgetLimitPaise - monthlyReport.netConfirmedExpensesPaise
      lines.push(`- **Budget Variance:** ${budgetVariance >= 0 ? 'Under budget by ' : 'Over budget by '}${formatPaise(Math.abs(budgetVariance))}`)
    }
    lines.push(`\n---\n`)

    lines.push(`## 2. Period Comparisons`)
    lines.push(`### Month-over-Month (${selectedMonthLabel} vs. ${intelligence.monthOverMonth.previousPeriodLabel})`)
    lines.push(`- Previous Spending: ${formatPaise(intelligence.monthOverMonth.previousSpendingPaise)}`)
    lines.push(`- Current Spending: ${formatPaise(intelligence.monthOverMonth.currentSpendingPaise)}`)
    lines.push(
      `- Change: ${formatPaise(Math.abs(intelligence.monthOverMonth.deltaPaise))} (${intelligence.monthOverMonth.direction})`
    )
    if (intelligence.monthOverMonth.percentageChangeState === 'calculated') {
      lines.push(`- Percentage Change: ${intelligence.monthOverMonth.percentageChange}%`)
    } else if (intelligence.monthOverMonth.percentageChangeState === 'new_spending') {
      lines.push(`- Percentage Change: New spending (no prior baseline)`)
    } else {
      lines.push(`- Percentage Change: No change`)
    }

    lines.push(`\n### Week-over-Week (${intelligence.weekOverWeek.currentPeriodLabel})`)
    lines.push(`- Current 7-Day Spending: ${formatPaise(intelligence.weekOverWeek.currentSpendingPaise)}`)
    lines.push(`- Prior 7-Day Spending: ${formatPaise(intelligence.weekOverWeek.previousSpendingPaise)}`)
    lines.push(
      `- Delta: ${formatPaise(Math.abs(intelligence.weekOverWeek.deltaPaise))} (${intelligence.weekOverWeek.direction})`
    )
    lines.push(`\n---\n`)

    lines.push(`## 3. Needs vs. Wants Breakdown`)
    lines.push(`- **Essential Needs:** ${formatPaise(monthlyReport.needsWants.needsPaise)} (${monthlyReport.needsWants.needsPercentageOfExpenses}%)`)
    lines.push(`- **Discretionary Wants:** ${formatPaise(monthlyReport.needsWants.wantsPaise)} (${monthlyReport.needsWants.wantsPercentageOfExpenses}%)`)
    lines.push(`- **Savings & Investments:** ${formatPaise(monthlyReport.needsWants.savingsInvestmentsPaise)}`)
    lines.push(`- **Transfers:** ${formatPaise(monthlyReport.needsWants.transfersPaise)}`)
    if (monthlyReport.needsWants.unclassifiedPaise > 0) {
      lines.push(`- **Unclassified Spend:** ${formatPaise(monthlyReport.needsWants.unclassifiedPaise)} (${monthlyReport.needsWants.unclassifiedPercentageOfExpenses}%)`)
    }
    lines.push(`\n---\n`)

    lines.push(`## 4. Category Shifts & Drivers`)
    if (monthlyReport.categoryShifts.length === 0) {
      lines.push(`*No category records for this period.*`)
    } else {
      lines.push(`| Category | Current Period | Previous Period | Delta | Direction | Attribution |`)
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`)
      for (const s of monthlyReport.categoryShifts) {
        const contrib = s.contributionToOverallIncreasePct !== undefined ? `${s.contributionToOverallIncreasePct}% of increase` : '-'
        lines.push(
          `| ${s.category} | ${formatPaise(s.currentPaise)} | ${formatPaise(s.previousPaise)} | ${formatPaise(Math.abs(s.deltaPaise))} | ${s.direction} | ${contrib} |`
        )
      }
    }
    lines.push(`\n---\n`)

    lines.push(`## 5. Top Merchants & Vendors`)
    if (monthlyReport.topMerchants.length === 0) {
      lines.push(`*No merchant records in this period.*`)
    } else {
      lines.push(`| Merchant | Total Spend | Orders/Visits | Avg. Per Transaction | Top Category |`)
      lines.push(`| :--- | :--- | :--- | :--- | :--- |`)
      for (const m of monthlyReport.topMerchants) {
        lines.push(
          `| ${m.merchant} | ${formatPaise(m.totalPaise)} | ${m.transactionCount} | ${formatPaise(m.averagePaise)} | ${m.topCategory} |`
        )
      }
    }
    lines.push(`\n---\n`)

    lines.push(`## 6. Spending Anomalies & Heuristic Alerts`)
    if (monthlyReport.spikesAndAnomalies.length === 0) {
      lines.push(`*No spending spikes or anomalies detected.*`)
    } else {
      for (const a of monthlyReport.spikesAndAnomalies) {
        lines.push(`- **${a.date}:** ${a.description} (${formatPaise(a.amountPaise)}) in *${a.category}* — ${a.explanation}`)
      }
    }
    lines.push(`\n---\n`)

    lines.push(`## 7. Upcoming Commitments (Projected)`)
    lines.push(`- Upcoming Scheduled Bills: ${formatPaise(monthlyReport.upcomingCommitmentsSummary.upcomingBillsPaise)}`)
    lines.push(`- Upcoming Planned SIPs: ${formatPaise(monthlyReport.upcomingCommitmentsSummary.upcomingSipsPaise)}`)
    lines.push(`- Active Commitments Count: ${monthlyReport.upcomingCommitmentsSummary.count}`)
    lines.push(`\n---\n`)

    lines.push(`## 8. Financial Intelligence Narrative`)
    lines.push(`**${intelligence.narrative.headline}**\n`)
    lines.push(`${intelligence.narrative.summaryText}\n`)
    if (intelligence.narrative.driverExplanations.length > 0) {
      lines.push(`**Key Drivers:**`)
      for (const d of intelligence.narrative.driverExplanations) {
        lines.push(`- ${d}`)
      }
    }
    if (intelligence.narrative.actionableSuggestions.length > 0) {
      lines.push(`\n**Actionable Suggestions:**`)
      for (const s of intelligence.narrative.actionableSuggestions) {
        lines.push(`- ${s}`)
      }
    }

    if (monthlyReport.dataQualityWarnings.length > 0) {
      lines.push(`\n---\n### Data Quality & Auditing Notes`)
      for (const w of monthlyReport.dataQualityWarnings) {
        lines.push(`- ⚠️ ${w}`)
      }
    }

    return lines.join('\n')
  }, [selectedMonthLabel, isDemoMode, monthlyReport, intelligence])

  const downloadMonthlyReport = useCallback(
    (customFilename?: string) => {
      const content = exportMonthlyReportMarkdown()
      const filename =
        customFilename ||
        `MoneyMate_Report_${selectedYear}_${String(selectedMonth).padStart(2, '0')}.md`

      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    },
    [exportMonthlyReportMarkdown, selectedYear, selectedMonth]
  )

  return {
    selectedYear,
    selectedMonth,
    selectedMonthLabel,
    availablePeriods,
    setSelectedPeriod,
    goToPreviousMonth,
    goToNextMonth,
    resetToCurrentMonth,
    intelligence,
    monthlyReport,
    monthOverMonth: intelligence.monthOverMonth,
    weekOverWeek: intelligence.weekOverWeek,
    categoryShifts: intelligence.categoryShifts,
    needsWants: intelligence.needsWants,
    anomaliesResult: intelligence.anomaliesResult,
    merchantAnalytics: intelligence.merchantAnalytics,
    narrative: intelligence.narrative,
    loading,
    isEmpty,
    hasNoTransactionsInPeriod,
    insufficientHistory,
    dataQualityWarnings: intelligence.dataQualityWarnings,
    isDemoMode,
    exportMonthlyReportMarkdown,
    downloadMonthlyReport,
  }
}
