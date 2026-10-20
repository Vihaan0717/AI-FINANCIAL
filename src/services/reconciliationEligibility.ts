/**
 * Central Reconciliation Eligibility Service
 * Money Mate AI — Stage 8.5
 * 
 * Strict architectural principles:
 * 1. Independent of UI components so eligibility can be tested deterministically.
 * 2. Rejects unreviewed, conflicting, unconfirmed, unclassified, or invalid records.
 * 3. Never treats an unmatched record as eligible merely because the parser accepted it.
 * 4. Confirmed duplicate matches to existing ledger records do not create new financial transactions.
 * 5. Requires explicit user approval for rejected matches to become separate transactions.
 * 6. Preserves exact integer paise and account isolation (Demo vs Live).
 */

import type {
  StatementRecord,
  ReconciliationDecision,
} from '../types/reconciliation'

export type RecordImportAction =
  | 'create_transaction'
  | 'create_transfer'
  | 'skip_confirmed_duplicate'

export interface RecordEligibilityResult {
  isEligible: boolean
  action?: RecordImportAction
  rejectionReason?: string
}

export interface BatchEligibilitySummary {
  isBatchEligible: boolean
  totalEvaluated: number
  eligibleCount: number
  toCreateCount: number
  toSkipDuplicateCount: number
  transferCount: number
  unresolvedCount: number
  rejectionReasons: { recordId: string; reason: string }[]
}

/**
 * Validates the strict import eligibility of an individual statement record and its user decision.
 */
export function validateImportEligibility(
  record: StatementRecord,
  decision: ReconciliationDecision | undefined,
  expectedWorkspace: 'demo' | 'live'
): RecordEligibilityResult {
  // 1. Workspace isolation
  const recordIsDemo = record.isDemo ?? (expectedWorkspace === 'demo')
  const expectedIsDemo = expectedWorkspace === 'demo'
  if (recordIsDemo !== expectedIsDemo) {
    return {
      isEligible: false,
      rejectionReason: `Workspace mismatch: record is tagged for ${recordIsDemo ? 'demo' : 'live'}, but active session is ${expectedWorkspace}.`,
    }
  }

  // 2. Monetary amount verification (strict positive integer paise)
  if (
    typeof record.amountPaise !== 'number' ||
    !Number.isInteger(record.amountPaise) ||
    record.amountPaise <= 0
  ) {
    return {
      isEligible: false,
      rejectionReason: `Invalid monetary amount (${record.amountPaise}). Ledger requires a positive integer in paise.`,
    }
  }

  // 3. Date validation
  if (!record.parsedDate || isNaN(new Date(record.parsedDate).getTime())) {
    return {
      isEligible: false,
      rejectionReason: `Invalid or missing transaction date: "${record.rawDateText || 'undefined'}".`,
    }
  }

  // 4. Required account information and mapping resolution
  const effectiveAccountId = decision?.assignedAccountId || record.sourceAccountId
  const effectiveAccountAlias = decision?.assignedAccountAlias || record.sourceAccountAlias

  if (
    !effectiveAccountId ||
    !effectiveAccountAlias ||
    effectiveAccountId.startsWith('unmapped:') ||
    effectiveAccountId === 'unmapped'
  ) {
    const maskInfo = record.maskedAccountId ? ` for masked identifier "${record.maskedAccountId}"` : ''
    return {
      isEligible: false,
      rejectionReason: `Unresolved account mapping${maskInfo}. Explicit user account assignment is required before commit.`,
    }
  }

  // 5. Decision presence
  if (!decision) {
    return {
      isEligible: false,
      rejectionReason: 'Missing reconciliation decision. Record must be reviewed before import.',
    }
  }

  // 6. Unresolved conflicts
  if (
    decision.state === 'conflicting' ||
    (decision.conflicts && decision.conflicts.length > 0)
  ) {
    const conflictList = decision.conflicts?.join(', ') || 'unresolved conflict'
    return {
      isEligible: false,
      rejectionReason: `Record has unresolved conflicts (${conflictList}). Resolve conflicts before importing.`,
    }
  }

  // 7. Unconfirmed suggested match
  if (
    decision.state === 'suggested_match' ||
    (!decision.isConfirmed && Boolean(decision.matchedLedgerTxId))
  ) {
    return {
      isEligible: false,
      rejectionReason: 'Record has an unconfirmed suggested match candidate. Explicit confirmation or separation required.',
    }
  }

  // 8. Unresolved classification (Category check)
  const category = decision.proposedCategory || record.proposedCategory
  if (
    decision.state === 'classification_required' ||
    !category ||
    category.trim() === '' ||
    category === 'Uncategorized' ||
    category === 'Other'
  ) {
    return {
      isEligible: false,
      rejectionReason: 'Record has an unresolved classification. Please select an approved category before importing.',
    }
  }

  // 9. Unreviewed state
  if (decision.state === 'unreviewed') {
    return {
      isEligible: false,
      rejectionReason: 'Record is in unreviewed state. Review is required prior to ledger commitment.',
    }
  }

  // 10. Transfer consistency
  if (decision.isInternalTransfer) {
    if (!decision.transferDestinationAccountId || !decision.transferDestinationAccountAlias) {
      return {
        isEligible: false,
        rejectionReason: 'Internal transfer record is missing destination account identity.',
      }
    }
    if (decision.transferDestinationAccountId === record.sourceAccountId) {
      return {
        isEligible: false,
        rejectionReason: 'Internal transfer source and destination accounts cannot be identical.',
      }
    }
    if (!decision.isConfirmed && decision.state !== 'ready_for_import') {
      return {
        isEligible: false,
        rejectionReason: 'Internal transfer candidate requires explicit user confirmation before commitment.',
      }
    }
    return {
      isEligible: true,
      action: 'create_transfer',
    }
  }

  // 11. Confirmed duplicate match
  if (decision.state === 'confirmed_match') {
    // If matched to an existing ledger transaction, it must NOT create another transaction!
    return {
      isEligible: true,
      action: 'skip_confirmed_duplicate',
    }
  }

  // 12. Rejected match
  if (decision.state === 'rejected_match') {
    // A rejected match may become a separate transaction only after the user explicitly approves importing it
    if (!decision.isConfirmed && decision.userAction !== 'reject_match') {
      return {
        isEligible: false,
        rejectionReason: 'Rejected match requires explicit user confirmation to import as a separate transaction.',
      }
    }
    return {
      isEligible: true,
      action: 'create_transaction',
    }
  }

  // 13. Unmatched records
  if (decision.state === 'unmatched') {
    // An unmatched record is NOT automatically eligible merely because parser accepted it
    if (!decision.isConfirmed && decision.userAction !== 'approve_new' && decision.userAction !== 'mark_review') {
      return {
        isEligible: false,
        rejectionReason: 'Unmatched record must be explicitly approved/confirmed before ledger import.',
      }
    }
    return {
      isEligible: true,
      action: 'create_transaction',
    }
  }

  // 14. Explicitly ready for import
  if (decision.state === 'ready_for_import') {
    return {
      isEligible: true,
      action: 'create_transaction',
    }
  }

  // Fallback rejection
  return {
    isEligible: false,
    rejectionReason: `Unsupported decision state "${decision.state}". Record cannot be committed.`,
  }
}

/**
 * Evaluates the entire draft batch for overall commitment eligibility.
 */
export function evaluateBatchEligibility(
  records: StatementRecord[],
  decisions: Map<string, ReconciliationDecision>,
  expectedWorkspace: 'demo' | 'live'
): BatchEligibilitySummary {
  let eligibleCount = 0
  let toCreateCount = 0
  let toSkipDuplicateCount = 0
  let transferCount = 0
  let unresolvedCount = 0
  const rejectionReasons: { recordId: string; reason: string }[] = []

  const handledTransferPairIds = new Set<string>()

  for (const record of records) {
    const decision = decisions.get(record.id)
    const result = validateImportEligibility(record, decision, expectedWorkspace)

    if (!result.isEligible) {
      unresolvedCount++
      rejectionReasons.push({
        recordId: record.id,
        reason: result.rejectionReason || 'Ineligible record',
      })
    } else {
      eligibleCount++
      if (result.action === 'skip_confirmed_duplicate') {
        toSkipDuplicateCount++
      } else if (result.action === 'create_transfer') {
        if (!handledTransferPairIds.has(record.id)) {
          transferCount++
          handledTransferPairIds.add(record.id)
          if (decision?.matchedRecordId) {
            handledTransferPairIds.add(decision.matchedRecordId)
          }
        }
      } else {
        toCreateCount++
      }
    }
  }

  return {
    isBatchEligible: unresolvedCount === 0,
    totalEvaluated: records.length,
    eligibleCount,
    toCreateCount,
    toSkipDuplicateCount,
    transferCount,
    unresolvedCount,
    rejectionReasons,
  }
}
