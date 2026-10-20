/**
 * Conservative Matching and Reconciliation Rules Engine
 * Money Mate AI — Stage 8.1
 * 
 * Strict architectural rules:
 * 1. Matching by date and amount alone is NEVER sufficient for automatic merging.
 * 2. Reliable reference match (UTR, RRN, IMPS Ref) + compatible amount + compatible direction = High Confidence.
 * 3. Conflicting references or amount mismatches immediately abort automatic merging and flag conflicts.
 * 4. Weaker heuristic evidence generates review candidates but requires explicit user confirmation.
 * 5. Internal transfers between owned accounts must have matching debit & credit legs on distinct owned accounts.
 * 6. Provenance is preserved: source records are never deleted upon reconciliation.
 */

import type {
  StatementRecord,
  StatementMatchEvaluation,
  MatchEvidenceType,
  MatchConflictType,
  InternalTransferCandidate,
  AccountDefinition,
  CanonicalFinancialEvent,
  BatchRecordCounts,
  ReconciliationDecision,
  ProposedImportSummary,
} from '../types/reconciliation'
import type { PaymentMethod, Transaction } from '../types/transaction'

/** Standard bank clearing settlement window in milliseconds (48 hours) */
export const SETTLEMENT_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * Tokenizes and normalizes text for counterparty similarity checking.
 */
function tokenizeText(text?: string): Set<string> {
  if (!text) return new Set()
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !['pvt', 'ltd', 'limited', 'upi', 'vpa', 'payment', 'transfer', 'bank'].includes(w))
  return new Set(words)
}

/**
 * Calculates Jaccard similarity score between two text strings based on keyword tokens.
 */
export function calculateTextSimilarity(textA?: string, textB?: string): number {
  const tokensA = tokenizeText(textA)
  const tokensB = tokenizeText(textB)
  if (tokensA.size === 0 || tokensB.size === 0) return 0

  let intersection = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection++
    }
  }

  const union = new Set([...tokensA, ...tokensB]).size
  return union > 0 ? intersection / union : 0
}

/**
 * Evaluates match compatibility between two statement records.
 * Follows conservative multi-factor matching principles.
 */
export function evaluateStatementRecordMatch(
  recordA: StatementRecord,
  recordB: StatementRecord
): StatementMatchEvaluation {
  const evidence: MatchEvidenceType[] = []
  const conflicts: MatchConflictType[] = []

  // Check 1: Conflicting references
  // If both records carry a normalized reference and they do NOT match, this is a hard reference conflict.
  if (
    recordA.normalizedReference &&
    recordB.normalizedReference &&
    recordA.normalizedReference !== recordB.normalizedReference
  ) {
    conflicts.push('reference_conflict')
  }

  // Check 2: Direction Compatibility
  // When reconciling two records of the same single expense (e.g. Bank debit + UPI app payment),
  // directions must be compatible (both debits or both credits).
  if (recordA.direction !== recordB.direction) {
    conflicts.push('direction_mismatch')
  }

  // Check 3: Amount Verification
  if (recordA.amountPaise !== recordB.amountPaise) {
    conflicts.push('amount_mismatch')
  } else {
    evidence.push('compatible_amount_direction')
  }

  // Check 4: Proximity Check
  let isWithinSettlementWindow = false
  if (recordA.parsedDate && recordB.parsedDate) {
    const timeA = new Date(recordA.parsedDate).getTime()
    const timeB = new Date(recordB.parsedDate).getTime()
    const diffMs = Math.abs(timeA - timeB)
    if (!isNaN(diffMs) && diffMs <= SETTLEMENT_WINDOW_MS) {
      isWithinSettlementWindow = true
      evidence.push('timestamp_proximity')
    }
  }

  // Check 5: Counterparty Text Similarity
  const similarity = calculateTextSimilarity(
    `${recordA.cleanDescription} ${recordA.counterparty || ''}`,
    `${recordB.cleanDescription} ${recordB.counterparty || ''}`
  )
  if (similarity >= 0.3) {
    evidence.push('counterparty_similarity')
  }

  // Hard Conflicts Guardrail:
  if (conflicts.length > 0) {
    return {
      isMatchCandidate: false,
      confidence: 'none',
      evidence,
      conflicts,
      reason: `Match rejected due to conflicts: ${conflicts.join(', ')}.`,
      canAutoMerge: false,
    }
  }

  // Strong Match Case:
  // Both have matching normalized references AND exact amount AND within clearing window
  const hasMatchingReference =
    Boolean(recordA.normalizedReference && recordB.normalizedReference) &&
    recordA.normalizedReference === recordB.normalizedReference

  if (hasMatchingReference) {
    evidence.push('exact_reference')
    return {
      isMatchCandidate: true,
      confidence: 'high',
      evidence,
      conflicts: [],
      reason: `High confidence match: verified identical reference (${recordA.normalizedReference}) and exact amount ₹${(recordA.amountPaise / 100).toFixed(2)}.`,
      canAutoMerge: isWithinSettlementWindow,
    }
  }

  // Weak Match Heuristic Case:
  // Same amount + within settlement window + similar counterparty, but NO shared reference
  if (isWithinSettlementWindow && evidence.includes('counterparty_similarity')) {
    evidence.push('weak_heuristic')
    return {
      isMatchCandidate: true,
      confidence: 'medium',
      evidence,
      conflicts: [],
      reason: `Review candidate: matching amount and similar counterparty within clearing window, but lacks verified reference. Requires user confirmation.`,
      canAutoMerge: false, // Strict: NEVER auto-merge without verified reference
    }
  }

  // Same amount + same date, BUT no reference match and no counterparty overlap
  // Rule: Do NOT auto-merge solely based on date and amount.
  if (isWithinSettlementWindow) {
    evidence.push('weak_heuristic')
    return {
      isMatchCandidate: false,
      confidence: 'low',
      evidence,
      conflicts: [],
      reason: `Same amount on nearby dates, but counterparty and reference do not match. Kept as distinct independent records to prevent false deduplication.`,
      canAutoMerge: false,
    }
  }

  return {
    isMatchCandidate: false,
    confidence: 'none',
    evidence,
    conflicts,
    reason: 'No matching criteria met.',
    canAutoMerge: false,
  }
}

/**
 * Evaluates whether a debit on Account A and a credit on Account B represent
 * an internal transfer between user-owned accounts (e.g. SBI to Union Bank).
 */
export function evaluateTransferCandidate(
  debitRecord: StatementRecord,
  creditRecord: StatementRecord,
  ownedAccounts: Map<string, AccountDefinition>
): InternalTransferCandidate | null {
  // 1. Must be debit on one side and credit on the other
  if (debitRecord.direction !== 'debit' || creditRecord.direction !== 'credit') {
    return null
  }

  // 2. Exact amount match in integer paise
  if (debitRecord.amountPaise !== creditRecord.amountPaise || debitRecord.amountPaise <= 0) {
    return null
  }

  // 3. Must be distinct accounts
  if (debitRecord.sourceAccountId === creditRecord.sourceAccountId) {
    return null
  }

  // 4. Both accounts must be registered owned accounts
  const fromAcc = ownedAccounts.get(debitRecord.sourceAccountId)
  const toAcc = ownedAccounts.get(creditRecord.sourceAccountId)
  if (!fromAcc?.isOwned || !toAcc?.isOwned) {
    return null
  }

  // 5. Proximity check (clearing window)
  if (!debitRecord.parsedDate || !creditRecord.parsedDate) {
    return null
  }
  const timeDebit = new Date(debitRecord.parsedDate).getTime()
  const timeCredit = new Date(creditRecord.parsedDate).getTime()
  const timeDiffMs = Math.abs(timeDebit - timeCredit)
  if (isNaN(timeDiffMs) || timeDiffMs > SETTLEMENT_WINDOW_MS) {
    return null
  }

  // 6. Conflicting reference check
  if (
    debitRecord.normalizedReference &&
    creditRecord.normalizedReference &&
    debitRecord.normalizedReference !== creditRecord.normalizedReference
  ) {
    return null
  }

  // 7. Evidence evaluation
  const matchEvidence: MatchEvidenceType[] = [
    'account_transfer_pair',
    'compatible_amount_direction',
    'timestamp_proximity',
  ]

  let confidence: 'high' | 'medium' = 'medium'
  let matchReason = `Compatible debit and credit of ₹${(debitRecord.amountPaise / 100).toFixed(2)} between owned accounts ${fromAcc.alias} and ${toAcc.alias}.`

  if (
    debitRecord.normalizedReference &&
    creditRecord.normalizedReference &&
    debitRecord.normalizedReference === creditRecord.normalizedReference
  ) {
    matchEvidence.push('exact_reference')
    confidence = 'high'
    matchReason += ` Verified matching transfer reference (${debitRecord.normalizedReference}).`
  }

  return {
    id: `trf-cand-${debitRecord.id}-${creditRecord.id}`,
    debitRecordId: debitRecord.id,
    creditRecordId: creditRecord.id,
    fromAccountId: fromAcc.id,
    fromAccountAlias: fromAcc.alias,
    toAccountId: toAcc.id,
    toAccountAlias: toAcc.alias,
    amountPaise: debitRecord.amountPaise,
    date: debitRecord.parsedDate,
    reference: debitRecord.normalizedReference || creditRecord.normalizedReference,
    confidence,
    matchEvidence,
    matchReason,
    status: 'pending',
  }
}

/**
 * Builds a Canonical Financial Event from an authoritative primary record (e.g. bank debit)
 * and optional enrichment records (e.g. PhonePe transaction).
 * Preserves strict provenance and accounting semantics.
 */
export function buildCanonicalFinancialEvent(
  primaryRecord: StatementRecord,
  enrichmentRecords: StatementRecord[] = [],
  options?: {
    isInternalTransfer?: boolean
    destinationAccountId?: string
    destinationAccountAlias?: string
    notes?: string
  }
): CanonicalFinancialEvent {
  // Enrich merchant from secondary records if primary lacks clean counterparty
  const enrichmentWithMerchant = enrichmentRecords.find((r) => Boolean(r.counterparty))
  const resolvedMerchant = enrichmentWithMerchant?.counterparty || primaryRecord.counterparty

  // Enrich notes from secondary records
  const additionalNotes = enrichmentRecords
    .map((r) => r.cleanDescription || r.rawDescription)
    .filter(Boolean)
    .join(' | ')

  const combinedNotes = [options?.notes, additionalNotes].filter(Boolean).join('; ')

  const paymentMethod: PaymentMethod = primaryRecord.metadata.paymentChannel === 'UPI' ? 'UPI' : 'Bank transfer'

  return {
    id: `cfe-${primaryRecord.id}`,
    eventType: options?.isInternalTransfer ? 'transfer' : primaryRecord.proposedType,
    amountPaise: primaryRecord.amountPaise,
    currency: 'INR',
    date: primaryRecord.parsedDate || new Date().toISOString(),
    description: resolvedMerchant || primaryRecord.cleanDescription || primaryRecord.rawDescription,
    merchant: resolvedMerchant,
    category: primaryRecord.proposedCategory || 'Other',
    categoryId: primaryRecord.proposedCategoryId,
    paymentMethod,
    sourceAccountId: primaryRecord.sourceAccountId,
    sourceAccountAlias: primaryRecord.sourceAccountAlias,
    destinationAccountId: options?.destinationAccountId,
    destinationAccountAlias: options?.destinationAccountAlias,
    reference: primaryRecord.normalizedReference || primaryRecord.originalReference,
    notes: combinedNotes || undefined,
    status: 'unreviewed',
    isInternalTransfer: Boolean(options?.isInternalTransfer),
    isRefundOrReversal: primaryRecord.proposedType === 'refund',
    provenance: {
      primarySourceRecordId: primaryRecord.id,
      primaryProvider: primaryRecord.sourceProvider,
      enrichmentSourceRecordIds: enrichmentRecords.map((r) => r.id),
      enrichmentProviders: enrichmentRecords.map((r) => r.sourceProvider),
      matchEvidence: ['compatible_amount_direction'],
      matchConfidence: enrichmentRecords.length > 0 ? 'high' : 'none',
      reconciliationNotes: [
        `Primary authoritative ledger record: ${primaryRecord.sourceAccountAlias} (${primaryRecord.sourceProvider})`,
        ...enrichmentRecords.map(
          (r) => `Enriched via ${r.sourceProvider} (Record ID: ${r.id}, Merchant: "${r.counterparty || 'N/A'}")`
        ),
      ],
    },
    isDemo: primaryRecord.isDemo,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Aggregates statistics for an import batch.
 */
export function calculateBatchStatistics(records: StatementRecord[]): BatchRecordCounts {
  const counts: BatchRecordCounts = {
    total: records.length,
    valid: 0,
    warnings: 0,
    errors: 0,
    ready: 0,
    ignored: 0,
    imported: 0,
  }

  for (const r of records) {
    if (r.errors.length > 0) {
      counts.errors++
    } else {
      counts.valid++
    }

    if (r.warnings.length > 0) {
      counts.warnings++
    }

    if (r.status === 'ready') counts.ready++
    if (r.status === 'ignored') counts.ignored++
    if (r.status === 'imported') counts.imported++
  }

  return counts
}

/**
 * Evaluates a single statement record against the existing ledger transactions
 * following Stage 8.4 conservative multi-factor matching principles.
 * A suggested match is NEVER automatically confirmed.
 */
export function evaluateRecordAgainstLedger(
  record: StatementRecord,
  existingTransactions: Transaction[]
): ReconciliationDecision {
  const now = new Date().toISOString()

  // Base fallback decision
  const baseDecision: ReconciliationDecision = {
    recordId: record.id,
    state: 'unmatched',
    proposedType: record.status === 'failed' ? 'reversal' : record.proposedType,
    proposedCategory: record.proposedCategory || 'Other',
    proposedCategoryId: record.proposedCategoryId,
    evidence: [],
    conflicts: [],
    decisionReason: 'Unmatched observation. No existing ledger duplicate detected.',
    isConfirmed: false,
    updatedAt: now,
  }

  // Check 1: Explicit Reference Match against ledger externalRef
  if (record.normalizedReference) {
    const matchingTx = existingTransactions.find(
      (t) =>
        t.externalRef &&
        t.externalRef.toLowerCase().trim() === record.normalizedReference?.toLowerCase().trim()
    )

    if (matchingTx) {
      // 1a. Amount conflict check
      if (matchingTx.amount !== record.amountPaise) {
        return {
          ...baseDecision,
          state: 'conflicting',
          matchedLedgerTxId: matchingTx.id,
          conflicts: ['amount_mismatch'],
          evidence: ['exact_reference'],
          decisionReason: `Conflicting amounts: Reference (${record.normalizedReference}) matches ledger transaction "${matchingTx.description}", but statement amount is ₹${(record.amountPaise / 100).toFixed(2)} while ledger amount is ₹${(matchingTx.amount / 100).toFixed(2)}.`,
        }
      }

      // 1b. Direction conflict check
      const isRecordDebit = record.direction === 'debit'
      const isTxExpense = matchingTx.type === 'expense'
      const isRecordCredit = record.direction === 'credit'
      const isTxIncomeOrRefund = matchingTx.type === 'income' || matchingTx.type === 'refund'

      if ((isRecordDebit && !isTxExpense) || (isRecordCredit && !isTxIncomeOrRefund)) {
        return {
          ...baseDecision,
          state: 'conflicting',
          matchedLedgerTxId: matchingTx.id,
          conflicts: ['direction_mismatch'],
          evidence: ['exact_reference', 'compatible_amount_direction'],
          decisionReason: `Conflicting flow direction: Reference matches ledger transaction "${matchingTx.description}", but statement direction (${record.direction}) contradicts ledger type (${matchingTx.type}).`,
        }
      }

      // 1c. High-confidence candidate (Must still be explicitly confirmed by user)
      return {
        ...baseDecision,
        state: 'suggested_match',
        matchedLedgerTxId: matchingTx.id,
        evidence: ['exact_reference', 'compatible_amount_direction'],
        decisionReason: `High-confidence match candidate: Identical reference (${record.normalizedReference}) and exact amount ₹${(record.amountPaise / 100).toFixed(2)} on ledger transaction "${matchingTx.description}". Requires user confirmation.`,
      }
    }
  }

  // Check 2: Check for conflicting reference on identical amount and nearby dates
  if (record.parsedDate && record.normalizedReference) {
    const recordTime = new Date(record.parsedDate).getTime()
    const conflictingRefTx = existingTransactions.find((t) => {
      if (t.amount !== record.amountPaise) return false
      if (!t.externalRef || t.externalRef.toLowerCase().trim() === record.normalizedReference?.toLowerCase().trim()) return false
      const txTime = new Date(t.date).getTime()
      const timeDiff = Math.abs(recordTime - txTime)
      return !isNaN(timeDiff) && timeDiff <= SETTLEMENT_WINDOW_MS
    })

    if (conflictingRefTx) {
      // Two payments on same date & amount but different references:
      // Rule: Keep separate unless there is sufficient evidence. Flag as distinct unmatched record.
      return {
        ...baseDecision,
        state: 'unmatched',
        evidence: ['compatible_amount_direction'],
        conflicts: [],
        decisionReason: `Distinct transaction: Same amount on nearby date as "${conflictingRefTx.description}", but carries distinct reference (${record.normalizedReference} vs ${conflictingRefTx.externalRef}). Kept separate.`,
      }
    }
  }

  // Check 3: Weak Heuristic Proximity Check (Amount + Date + Merchant overlap, NO conflicting references)
  if (record.parsedDate) {
    const recordTime = new Date(record.parsedDate).getTime()
    const probableTx = existingTransactions.find((t) => {
      if (t.amount !== record.amountPaise) return false
      // Cannot match if either side has an incompatible reference
      if (record.normalizedReference && t.externalRef && record.normalizedReference !== t.externalRef) {
        return false
      }
      const txTime = new Date(t.date).getTime()
      const timeDiff = Math.abs(recordTime - txTime)
      if (isNaN(timeDiff) || timeDiff > SETTLEMENT_WINDOW_MS) return false

      const isRecordDebit = record.direction === 'debit'
      const isTxExpense = t.type === 'expense'
      const isRecordCredit = record.direction === 'credit'
      const isTxIncomeOrRefund = t.type === 'income' || t.type === 'refund'
      if ((isRecordDebit && !isTxExpense) || (isRecordCredit && !isTxIncomeOrRefund)) {
        return false
      }

      const merchantA = (t.merchant || t.description || '').toLowerCase()
      const merchantB = (record.counterparty || record.cleanDescription || '').toLowerCase()
      const similarity = calculateTextSimilarity(merchantA, merchantB)
      return similarity >= 0.3 || merchantA.includes(merchantB) || merchantB.includes(merchantA)
    })

    if (probableTx) {
      return {
        ...baseDecision,
        state: 'suggested_match',
        matchedLedgerTxId: probableTx.id,
        evidence: ['compatible_amount_direction', 'timestamp_proximity', 'counterparty_similarity', 'weak_heuristic'],
        decisionReason: `Possible match candidate: Matching amount ₹${(record.amountPaise / 100).toFixed(2)} and similar merchant within settlement window of ledger transaction "${probableTx.description}". Requires user confirmation.`,
      }
    }
  }

  // Check 4: Failed / Reversal Transaction
  if (record.status === 'failed' || record.metadata.paymentStatus === 'Failed') {
    return {
      ...baseDecision,
      state: 'ready_for_import',
      proposedType: 'reversal',
      decisionReason: 'Failed payment observation. Excluded from confirmed spending.',
    }
  }

  // Check 5: Classification Required (Missing category or ambiguous direction)
  if (!record.proposedCategory || record.proposedCategory === 'Other' || record.proposedCategory === 'Uncategorized') {
    return {
      ...baseDecision,
      state: 'classification_required',
      decisionReason: 'Classification required: Please select an appropriate financial category.',
    }
  }

  // Default: Unmatched, ready for review
  return {
    ...baseDecision,
    state: 'unmatched',
    decisionReason: 'Unmatched observation. Ready to import as new transaction.',
  }
}

/**
 * Creates initial reconciliation decisions for all staged records in a batch,
 * checking against both existing ledger transactions and intra-batch transfer candidates.
 */
export function createInitialReconciliationDecisions(
  records: StatementRecord[],
  existingTransactions: Transaction[],
  ownedAccounts?: Map<string, AccountDefinition>
): Map<string, ReconciliationDecision> {
  const decisions = new Map<string, ReconciliationDecision>()
  const transferPairedIds = new Set<string>()

  // 1. Detect candidate internal transfers within the imported batch
  if (ownedAccounts && ownedAccounts.size > 1) {
    for (let i = 0; i < records.length; i++) {
      const recA = records[i]
      if (transferPairedIds.has(recA.id)) continue

      for (let j = i + 1; j < records.length; j++) {
        const recB = records[j]
        if (transferPairedIds.has(recB.id)) continue

        const transfer =
          recA.direction === 'debit'
            ? evaluateTransferCandidate(recA, recB, ownedAccounts)
            : evaluateTransferCandidate(recB, recA, ownedAccounts)

        if (transfer) {
          const debitRec = recA.direction === 'debit' ? recA : recB
          const creditRec = recA.direction === 'credit' ? recA : recB

          transferPairedIds.add(debitRec.id)
          transferPairedIds.add(creditRec.id)

          const now = new Date().toISOString()
          decisions.set(debitRec.id, {
            recordId: debitRec.id,
            state: 'suggested_match',
            matchedRecordId: creditRec.id,
            proposedType: 'transfer',
            proposedCategory: 'Transfer',
            isInternalTransfer: true,
            transferDestinationAccountId: creditRec.sourceAccountId,
            transferDestinationAccountAlias: creditRec.sourceAccountAlias,
            evidence: transfer.matchEvidence,
            conflicts: [],
            decisionReason: transfer.matchReason,
            isConfirmed: false,
            updatedAt: now,
          })

          decisions.set(creditRec.id, {
            recordId: creditRec.id,
            state: 'suggested_match',
            matchedRecordId: debitRec.id,
            proposedType: 'transfer',
            proposedCategory: 'Transfer',
            isInternalTransfer: true,
            transferDestinationAccountId: debitRec.sourceAccountId,
            transferDestinationAccountAlias: debitRec.sourceAccountAlias,
            evidence: transfer.matchEvidence,
            conflicts: [],
            decisionReason: transfer.matchReason,
            isConfirmed: false,
            updatedAt: now,
          })

          break
        }
      }
    }
  }

  // 2. Evaluate remaining records against existing ledger
  for (const record of records) {
    if (decisions.has(record.id)) continue
    const decision = evaluateRecordAgainstLedger(record, existingTransactions)
    decisions.set(record.id, decision)
  }

  // 3. Competing Match Protection:
  // If multiple statement records in the same batch compete for the same ledger transaction,
  // do NOT allow ambiguous auto-pairing or duplicate confirmation! Flag all competing candidates
  // as conflicting so the user must explicitly decide which record matches or separate them.
  const ledgerMatchUsage = new Map<string, string[]>()
  for (const [recordId, dec] of decisions.entries()) {
    if (dec.matchedLedgerTxId) {
      const existingList = ledgerMatchUsage.get(dec.matchedLedgerTxId) || []
      existingList.push(recordId)
      ledgerMatchUsage.set(dec.matchedLedgerTxId, existingList)
    }
  }

  for (const [ledgerTxId, competingRecordIds] of ledgerMatchUsage.entries()) {
    if (competingRecordIds.length > 1) {
      const matchedTx = existingTransactions.find((t) => t.id === ledgerTxId)
      const desc = matchedTx?.description || ledgerTxId
      for (const recId of competingRecordIds) {
        const dec = decisions.get(recId)!
        dec.state = 'conflicting'
        dec.conflicts = Array.from(new Set([...(dec.conflicts || []), 'competing_match']))
        dec.isConfirmed = false
        dec.decisionReason = `Multiple statement records (${competingRecordIds.length}) compete for the same ledger transaction "${desc}". User review required to resolve ambiguity.`
      }
    }
  }

  return decisions
}

/**
 * Calculates in-memory proposed import summary using integer paise.
 * Strictly read-only; never touches actual ledger balances.
 */
export function calculateProposedImportSummary(
  records: StatementRecord[],
  decisions: Map<string, ReconciliationDecision>,
  rejectedRowsCount: number
): ProposedImportSummary {
  const summary: ProposedImportSummary = {
    totalSourceObservations: records.length,
    confirmedLinksCount: 0,
    potentialDuplicatesRequiringReview: 0,
    conflictingCount: 0,
    unmatchedCount: 0,
    unresolvedClassificationCount: 0,
    unresolvedAccountMappingCount: 0,
    proposedNewEventsCount: 0,
    proposedTransfersCount: 0,
    proposedTransfersPaise: 0,
    proposedRefundsCount: 0,
    proposedRefundsPaise: 0,
    proposedIncomeCount: 0,
    proposedIncomePaise: 0,
    proposedExpensesCount: 0,
    proposedExpensesPaise: 0,
    rejectedSourceRowsCount: rejectedRowsCount,
  }

  const handledTransferPairIds = new Set<string>()

  for (const record of records) {
    const decision = decisions.get(record.id)
    const state = decision?.state || 'unreviewed'

    const effectiveAcc = decision?.assignedAccountId || record.sourceAccountId
    if (!effectiveAcc || effectiveAcc.startsWith('unmapped:') || effectiveAcc === 'unmapped') {
      summary.unresolvedAccountMappingCount = (summary.unresolvedAccountMappingCount || 0) + 1
    }

    switch (state) {
      case 'confirmed_match': {
        summary.confirmedLinksCount++
        if (decision?.isInternalTransfer) {
          // Internal transfer leg
          if (!handledTransferPairIds.has(record.id)) {
            summary.proposedTransfersCount++
            summary.proposedTransfersPaise += record.amountPaise
            handledTransferPairIds.add(record.id)
            if (decision.matchedRecordId) {
              handledTransferPairIds.add(decision.matchedRecordId)
            }
          }
          // Internal transfers are strictly excluded from income and expenses!
        }
        // Confirmed duplicates of existing ledger transactions do NOT create new events
        break
      }

      case 'suggested_match':
        summary.potentialDuplicatesRequiringReview++
        break

      case 'conflicting':
        summary.conflictingCount++
        break

      case 'classification_required':
        summary.unresolvedClassificationCount++
        break

      case 'unmatched':
      case 'ready_for_import':
      case 'rejected_match': {
        summary.unmatchedCount++
        summary.proposedNewEventsCount++

        const pType = decision?.proposedType || record.proposedType

        if (pType === 'reversal' || record.status === 'failed') {
          // Failed or reversal payments must NOT inflate confirmed spending!
          break
        }

        if (pType === 'transfer') {
          summary.proposedTransfersCount++
          summary.proposedTransfersPaise += record.amountPaise
        } else if (pType === 'refund') {
          // Refunds do not become ordinary income
          summary.proposedRefundsCount++
          summary.proposedRefundsPaise += record.amountPaise
        } else if (pType === 'income') {
          summary.proposedIncomeCount++
          summary.proposedIncomePaise += record.amountPaise
        } else {
          // Expense
          summary.proposedExpensesCount++
          summary.proposedExpensesPaise += record.amountPaise
        }
        break
      }

      case 'unreviewed':
      default:
        summary.unresolvedClassificationCount++
        break
    }
  }

  return summary
}
