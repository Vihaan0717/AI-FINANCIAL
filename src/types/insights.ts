export type PercentageChangeState = 'calculated' | 'new_spending' | 'no_change'
export type ChangeDirection = 'increased' | 'decreased' | 'unchanged'

export interface PeriodComparison {
  periodType: 'month' | 'week' | 'custom'
  currentPeriodLabel: string
  previousPeriodLabel: string
  currentSpendingPaise: number
  previousSpendingPaise: number
  deltaPaise: number
  direction: ChangeDirection
  percentageChangeState: PercentageChangeState
  /** Exact percentage (rounded to 1 decimal place). Undefined if baseline was 0 and current is positive (new spending). */
  percentageChange?: number
  currentIncomePaise: number
  previousIncomePaise: number
  netCashFlowDeltaPaise: number
  transactionCountCurrent: number
  transactionCountPrevious: number
}

export interface CategorySpendingShift {
  category: string
  currentPaise: number
  previousPaise: number
  deltaPaise: number
  direction: ChangeDirection
  percentageChangeState: PercentageChangeState
  percentageChange?: number
  /**
   * Proportion (0-100) that this category's increase contributed to the total positive increases across categories.
   * Undefined if there was no increase in this category or no overall positive category increases.
   */
  contributionToOverallIncreasePct?: number
  transactionCount: number
}

export type AnomalyTriggerReason =
  | 'median_multiple'
  | 'category_percentage_spike'
  | 'large_single_purchase'

export interface SpendingAnomaly {
  transactionId: string
  date: string
  description: string
  merchant?: string
  category: string
  amountPaise: number
  triggerReason: AnomalyTriggerReason
  explanation: string
  categoryBaselineMedianPaise?: number
  multipleOfMedian?: number
  categoryTotalPaise?: number
  percentageOfCategorySpend?: number
}

export interface AnomalyDetectionOptions {
  /** Minimum completed transactions in category required before statistical anomaly detection runs (default: 5). */
  minSampleSize?: number
  /** Multiplier of median amount to flag as an anomaly (default: 2.5). */
  medianMultiplierThreshold?: number
  /** Percentage of category's total monthly spend in a single purchase to flag (default: 35). */
  categorySpendPercentageThreshold?: number
}

export interface AnomalyDetectionResult {
  anomalies: SpendingAnomaly[]
  insufficientHistory: boolean
  evaluatedTransactionCount: number
  message?: string
}

export interface MerchantSpendingStats {
  merchant: string
  totalPaise: number
  transactionCount: number
  averagePaise: number
  topCategory: string
  lastVisitedDate: string
}

export interface MerchantAnalysisResult {
  topMerchantsBySpend: MerchantSpendingStats[]
  frequentMerchants: MerchantSpendingStats[]
  uniqueMerchantCount: number
  unidentifiedMerchantSpendPaise: number
  unidentifiedTransactionCount: number
}

export type NeedsWantsCategoryGroup =
  | 'needs'
  | 'wants'
  | 'savings_investments'
  | 'transfers'
  | 'unclassified'

export type CategoryClassificationMap = Record<string, NeedsWantsCategoryGroup>

export interface NeedsWantsBreakdown {
  needsPaise: number
  wantsPaise: number
  savingsInvestmentsPaise: number
  transfersPaise: number
  unclassifiedPaise: number
  /** Sum of needs + wants + unclassified operational consumption expenses. Excludes savings and transfers. */
  totalOperationalExpensesPaise: number
  needsPercentageOfExpenses: number
  wantsPercentageOfExpenses: number
  unclassifiedPercentageOfExpenses: number
  /** Percentage of net confirmed income allocated to savings and investments. Undefined if income is 0. */
  savingsPercentageOfIncome?: number
  isBenchmark50_30_20Comparable: boolean
  unclassifiedCategories: string[]
}

export interface MonthlyFinancialReport {
  year: number
  month: number // 1-12
  monthLabel: string
  confirmedIncomePaise: number
  grossConfirmedExpensesPaise: number
  refundsPaise: number
  netConfirmedExpensesPaise: number
  netSavingsCashFlowPaise: number
  /** Net cash flow divided by confirmed income, as a percentage. Undefined if income is 0. */
  savingsRatePct?: number
  categoryShifts: CategorySpendingShift[]
  needsWants: NeedsWantsBreakdown
  topMerchants: MerchantSpendingStats[]
  spikesAndAnomalies: SpendingAnomaly[]
  upcomingCommitmentsSummary: {
    upcomingBillsPaise: number
    upcomingSipsPaise: number
    count: number
  }
  dataQualityWarnings: string[]
}

export interface GroundedInsightNarrative {
  headline: string
  summaryText: string
  driverExplanations: string[]
  actionableSuggestions: string[]
  supportingEvidence: {
    currentSpendPaise: number
    previousSpendPaise: number
    deltaPaise: number
    topDriverCategory?: string
    topDriverDeltaPaise?: number
    topDriverContributionPct?: number
    anomalyCount: number
    needsPct: number
    wantsPct: number
  }
}

export interface FinancialIntelligence {
  monthOverMonth: PeriodComparison
  weekOverWeek: PeriodComparison
  categoryShifts: CategorySpendingShift[]
  needsWants: NeedsWantsBreakdown
  anomaliesResult: AnomalyDetectionResult
  merchantAnalytics: MerchantAnalysisResult
  monthlyReport: MonthlyFinancialReport
  narrative: GroundedInsightNarrative
  dataQualityWarnings: string[]
}
