/**
 * Statement Coverage and Timeline Tracking Service
 * Money Mate AI — Financial History Consolidation
 * 
 * Strict architectural rules:
 * 1. Tracks statement coverage per account without cross-account contamination.
 * 2. Compares consecutive statements' opening and closing balances.
 * 3. Identifies intervening gaps and overlapping statement periods.
 * 4. Never claims completeness based solely on earliest and latest dates if gaps exist.
 * 5. Strictly read-only analysis over imported batch audit trails.
 */

import type {
  ImportBatch,
  StatementCoverageReport,
  AccountStatementCoverage,
  StatementGap,
  StatementOverlap,
  CoverageStatus,
} from '../types/reconciliation'

export interface EvaluateStatementCoverageOptions {
  targetStartDate?: string // Default '2025-10-01'
  targetEndDate?: string // Default '2026-10-20'
  toleranceDaysForConsecutive?: number // Default 1 day
}

/**
 * Evaluates the multi-statement coverage, timeline gaps, overlaps, and balance continuity
 * across all committed batches for each account.
 */
export function evaluateStatementCoverage(
  batches: ImportBatch[],
  options: EvaluateStatementCoverageOptions = {}
): StatementCoverageReport {
  const targetStartDate = options.targetStartDate || '2025-10-01'
  const targetEndDate = options.targetEndDate || '2026-10-20'
  const toleranceDays = options.toleranceDaysForConsecutive ?? 1

  // Only consider active committed batches (exclude rolled back or draft batches)
  const committedBatches = batches.filter((b) => b.commitStatus === 'committed' && b.auditReport)

  // Group batches by account ID
  const batchesByAccount = new Map<string, ImportBatch[]>()
  for (const b of committedBatches) {
    const accId = b.sourceAccountId || 'unknown-account'
    const list = batchesByAccount.get(accId) || []
    list.push(b)
    batchesByAccount.set(accId, list)
  }

  const accountCoverages: Record<string, AccountStatementCoverage> = {}
  let totalGapsCount = 0
  let totalOverlapsCount = 0
  let totalUnresolvedDiscrepancyCount = 0

  for (const [accountId, accBatches] of batchesByAccount.entries()) {
    const accountAlias = accBatches[0].sourceAccountAlias || accountId

    // Sort batches by first transaction date / start date ascending
    const sortedBatches = [...accBatches].sort((a, b) => {
      const dateA = a.auditReport?.firstTransactionDate || a.createdAt
      const dateB = b.auditReport?.firstTransactionDate || b.createdAt
      return new Date(dateA).getTime() - new Date(dateB).getTime()
    })

    const gaps: StatementGap[] = []
    const overlaps: StatementOverlap[] = []
    let hasBalanceDiscrepancy = false
    let hasInconclusiveBatch = false

    const batchSummaries = sortedBatches.map((b) => {
      const report = b.auditReport!
      if (!report.isReconciliationConclusive) {
        hasInconclusiveBatch = true
      }
      return {
        batchId: b.id,
        fileName: b.fileMetadata?.fileName || 'statement',
        startDate: report.statementStartDate || report.firstTransactionDate,
        endDate: report.statementEndDate || report.lastTransactionDate,
        firstTxDate: report.firstTransactionDate,
        lastTxDate: report.lastTransactionDate,
        openingBalancePaise: report.beginningBalancePaise,
        closingBalancePaise: report.statementClosingBalancePaise,
        isConclusive: report.isReconciliationConclusive,
        commitStatus: b.commitStatus,
      }
    })

    // Analyze transitions between consecutive batches
    for (let i = 0; i < sortedBatches.length - 1; i++) {
      const current = sortedBatches[i]
      const next = sortedBatches[i + 1]

      const currentEnd = current.auditReport?.lastTransactionDate || current.auditReport?.statementEndDate
      const nextStart = next.auditReport?.firstTransactionDate || next.auditReport?.statementStartDate

      if (currentEnd && nextStart) {
        const timeCurrentEnd = new Date(currentEnd).getTime()
        const timeNextStart = new Date(nextStart).getTime()
        const diffDays = Math.round((timeNextStart - timeCurrentEnd) / (1000 * 60 * 60 * 24))

        // Check 1: Overlap (next statement starts before current statement ends)
        if (diffDays < 0) {
          overlaps.push({
            accountId,
            accountAlias,
            batchIdA: current.id,
            batchIdB: next.id,
            overlapStartDate: nextStart,
            overlapEndDate: currentEnd,
            overlapDays: Math.abs(diffDays),
            notes: `Overlapping date range detected between "${current.fileMetadata?.fileName}" and "${next.fileMetadata?.fileName}". Ensure transactions in overlap are reconciled.`,
          })
          totalOverlapsCount++
        }

        // Check 2: Gap (more than toleranceDays between consecutive statements)
        if (diffDays > toleranceDays) {
          const currentClosing = current.auditReport?.statementClosingBalancePaise
          const nextOpening = next.auditReport?.beginningBalancePaise

          let balanceDiff: number | undefined
          let isDiscrepancy = false
          if (currentClosing !== undefined && nextOpening !== undefined) {
            balanceDiff = nextOpening - currentClosing
            if (balanceDiff !== 0) {
              isDiscrepancy = true
              hasBalanceDiscrepancy = true
              totalUnresolvedDiscrepancyCount++
            }
          }

          gaps.push({
            accountId,
            accountAlias,
            previousBatchId: current.id,
            previousEndDate: currentEnd,
            previousClosingBalancePaise: currentClosing,
            nextBatchId: next.id,
            nextStartDate: nextStart,
            nextOpeningBalancePaise: nextOpening,
            gapDays: diffDays,
            balanceDiscrepancyPaise: balanceDiff,
            isBalanceDiscrepancy: isDiscrepancy,
          })
          totalGapsCount++
        } else if (diffDays >= 0 && diffDays <= toleranceDays) {
          // Consecutive transition without calendar gap: Verify balance continuity
          const currentClosing = current.auditReport?.statementClosingBalancePaise
          const nextOpening = next.auditReport?.beginningBalancePaise
          if (currentClosing !== undefined && nextOpening !== undefined && currentClosing !== nextOpening) {
            hasBalanceDiscrepancy = true
            totalUnresolvedDiscrepancyCount++
            gaps.push({
              accountId,
              accountAlias,
              previousBatchId: current.id,
              previousEndDate: currentEnd,
              previousClosingBalancePaise: currentClosing,
              nextBatchId: next.id,
              nextStartDate: nextStart,
              nextOpeningBalancePaise: nextOpening,
              gapDays: 0,
              balanceDiscrepancyPaise: nextOpening - currentClosing,
              isBalanceDiscrepancy: true,
            })
          }
        }
      }
    }

    // Determine account coverage status
    const earliestTx = batchSummaries[0]?.firstTxDate
    const latestTx = batchSummaries[batchSummaries.length - 1]?.lastTxDate

    let coverageStatus: CoverageStatus = 'unknown'
    let statusReason = ''

    if (batchSummaries.length === 0) {
      coverageStatus = 'unknown'
      statusReason = 'No statement batches imported for this account.'
    } else if (hasBalanceDiscrepancy) {
      coverageStatus = 'unresolved_discrepancy'
      statusReason = 'Consecutive statement opening and closing balances do not match.'
    } else if (gaps.length > 0) {
      coverageStatus = 'partial'
      statusReason = `${gaps.length} gap(s) detected between consecutive statements.`
    } else if (earliestTx && latestTx) {
      const earliestDay = earliestTx.slice(0, 10)
      const latestDay = latestTx.slice(0, 10)
      const targetStartDay = targetStartDate.slice(0, 10)
      const targetEndDay = targetEndDate.slice(0, 10)

      const startsBeforeTarget = earliestDay <= targetStartDay
      const endsAfterTarget = latestDay >= targetEndDay

      if (startsBeforeTarget && endsAfterTarget) {
        coverageStatus = hasInconclusiveBatch ? 'partial' : 'complete_verified'
        statusReason = hasInconclusiveBatch
          ? 'Date range covered, but one or more statements lack conclusive balance reconciliation.'
          : 'Complete contiguous coverage across target history.'
      } else {
        coverageStatus = 'partial'
        statusReason = `Covers ${earliestDay} to ${latestDay}. Target range ${targetStartDay} to ${targetEndDay} is partially uncovered.`
      }
    } else {
      coverageStatus = 'partial'
      statusReason = 'Partial statement data available.'
    }

    accountCoverages[accountId] = {
      accountId,
      accountAlias,
      totalBatches: sortedBatches.length,
      earliestDate: earliestTx,
      latestDate: latestTx,
      batches: batchSummaries,
      gaps,
      overlaps,
      coverageStatus,
      statusReason,
    }
  }

  // Determine Overall Status across all accounts
  let overallStatus: CoverageStatus = 'unknown'
  let overallStatusReason = ''

  const accountKeys = Object.keys(accountCoverages)
  if (accountKeys.length === 0) {
    overallStatus = 'unknown'
    overallStatusReason = 'No accounts have imported statement history.'
  } else if (totalUnresolvedDiscrepancyCount > 0) {
    overallStatus = 'unresolved_discrepancy'
    overallStatusReason = `${totalUnresolvedDiscrepancyCount} balance discrepancy(ies) between consecutive statements.`
  } else if (accountKeys.every((k) => accountCoverages[k].coverageStatus === 'complete_verified')) {
    overallStatus = 'complete_verified'
    overallStatusReason = `All ${accountKeys.length} active account(s) have verified, unbroken coverage for ${targetStartDate} to ${targetEndDate}.`
  } else {
    overallStatus = 'partial'
    overallStatusReason = `${accountKeys.length} account(s) evaluated; partial or missing periods exist relative to target ${targetStartDate} to ${targetEndDate}.`
  }

  return {
    targetStartDate,
    targetEndDate,
    overallStatus,
    overallStatusReason,
    accountCoverages,
    totalGaps: totalGapsCount,
    totalOverlaps: totalOverlapsCount,
    unresolvedDiscrepancyCount: totalUnresolvedDiscrepancyCount,
  }
}
