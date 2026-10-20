/**
 * Canonical Statement Import & Reconciliation Domain Models
 * Money Mate AI — Stage 8.1
 * 
 * Strict architectural principles:
 * 1. Monetary calculations are in integer paise (1 Rupee = 100 paise).
 * 2. Source observations (raw statement rows) are strictly decoupled from Canonical Financial Events.
 * 3. Primary ledger sources (SBI, Union Bank) establish authoritative account debits, credits, and balances.
 * 4. Supplementary UPI apps (PhonePe, Paytm, Slice) provide merchant names, category hints, and payment notes.
 * 5. Conservative matching: never auto-merge solely based on date and amount.
 * 6. Internal transfers between owned accounts are tracked with both legs and excluded from ordinary income/expenses.
 * 7. Privacy: no banking credentials, secrets, or account numbers are ever stored or requested.
 */

import type { TransactionType, PaymentMethod, Transaction } from './transaction'

/** Supported financial statement sources */
export type StatementProvider =
  | 'sbi'
  | 'union_bank'
  | 'phonepe'
  | 'paytm'
  | 'slice'
  | 'generic_csv'

/**
 * Role of the provider in the reconciliation hierarchy:
 * - primary_ledger: Authoritative record of money leaving/entering bank account (e.g. SBI, Union Bank)
 * - enrichment_source: Supplementary application data providing merchant/note context (e.g. PhonePe, Paytm, Slice)
 */
export type StatementProviderRole = 'primary_ledger' | 'enrichment_source'

/** Known institution names for owned accounts */
export type InstitutionName = 'SBI' | 'Union Bank of India' | 'Other'

/** Account type classifications */
export type AccountType = 'savings' | 'current' | 'credit_card' | 'wallet' | 'other'

/**
 * Non-sensitive owned account identity definition.
 * Never stores real account numbers, debit card numbers, or passwords.
 */
export interface AccountDefinition {
  id: string // e.g. 'acc-sbi-primary'
  institution: InstitutionName
  alias: string // e.g. 'SBI Primary Savings'
  accountType: AccountType
  currency: 'INR'
  isOwned: boolean
  isDemo?: boolean
  notes?: string
}

/** Direction of funds flow in a single statement row */
export type TransactionDirection = 'debit' | 'credit'

/** Status of an individual staged statement record */
export type StatementRecordStatus =
  | 'staged' // Raw parsed, awaiting review
  | 'ready' // Validated, ready to be merged/imported
  | 'ignored' // User chose to exclude this record
  | 'imported' // Successfully committed to ledger
  | 'failed' // Validation or import error

/** User review state for a staged record */
export type RecordReviewStatus =
  | 'pending' // Awaiting user confirmation
  | 'approved' // User explicitly accepted
  | 'modified' // User altered category, type, or merchant
  | 'rejected' // User rejected this record

/** Confidence level of cross-source matching */
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'

/** Evidence types used in conservative matching */
export type MatchEvidenceType =
  | 'exact_reference' // Identical reliable UTR, RRN, or IMPS reference
  | 'compatible_amount_direction' // Exact paise match with compatible flow direction
  | 'timestamp_proximity' // Transaction dates within standard settlement/clearing window
  | 'counterparty_similarity' // Merchant name or narration token overlap
  | 'account_transfer_pair' // Matching debit on Account A and credit on Account B
  | 'weak_heuristic' // Nearby date & amount only (review candidate only; NEVER auto-merges)

/** Types of match conflicts that abort automatic merging */
export type MatchConflictType =
  | 'reference_conflict' // Different references on identical amount/date
  | 'direction_mismatch' // Conflicting flow direction where parallel is required
  | 'amount_mismatch' // Reference matches but amounts differ
  | 'account_mismatch' // Transfer between identical account IDs
  | 'competing_match' // Multiple statement records compete for the same ledger transaction

/** Provider-specific metadata that is safe to retain */
export interface StatementRecordMetadata {
  rawNarration?: string
  paymentChannel?: 'UPI' | 'NEFT' | 'IMPS' | 'RTGS' | 'ATM' | 'POS' | 'CARD' | 'NET_BANKING' | 'OTHER'
  chequeOrRefNo?: string
  orderId?: string
  upiId?: string
  categoryHint?: string
  paymentStatus?: string
  terminalId?: string
  customFields?: Record<string, string | number | boolean>
}

/**
 * Canonical Normalized Statement Record.
 * Represents an individual row parsed from a statement file before final ledger commitment.
 */
export interface StatementRecord {
  id: string // Unique staging ID, e.g. 'stg-rec-172938192-001'
  batchId: string // Reference to parent ImportBatch ID
  sourceProvider: StatementProvider
  sourceProviderRole: StatementProviderRole
  sourceAccountId: string // Reference to AccountDefinition.id
  sourceAccountAlias: string
  maskedAccountId?: string // Raw masked account identifier from statement (e.g. 'XXXX5200', 'XXXX2051', 'XXXXXX3938')
  statementFileId: string
  originalRowIndex?: number // 1-based index of row in source file

  // Original raw textual data (preserved for provenance and audit)
  originalReference?: string
  normalizedReference?: string // Cleaned alphanumeric reference (e.g., UTR / RRN)
  rawDateText: string
  parsedDate?: string // ISO 8601 string
  rawDescription: string
  cleanDescription: string
  counterparty?: string

  // Exact monetary representation in integer paise
  amountPaise: number // Non-negative integer paise
  debitPaise?: number // Explicit debit amount if direction === 'debit'
  creditPaise?: number // Explicit credit amount if direction === 'credit'
  signedAmountPaise: number // Negative for debit, positive for credit
  currency: 'INR'
  direction: TransactionDirection
  balanceAfterPaise?: number // Closing balance reported by bank in paise

  metadata: StatementRecordMetadata
  warnings: string[]
  errors: string[]

  // Proposed financial classification
  proposedType: TransactionType // 'expense' | 'income' | 'transfer' | 'refund'
  proposedCategory: string
  proposedCategoryId?: string

  // Reconciliation state
  status: StatementRecordStatus
  reviewStatus: RecordReviewStatus
  matchCandidateIds: string[]
  matchedEventId?: string
  matchConfidence: MatchConfidence

  isDemo?: boolean
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
}

/** Lifecycle of a unified financial event */
export type FinancialEventStatus =
  | 'unreviewed'
  | 'candidate'
  | 'user_confirmed'
  | 'imported'
  | 'rejected'

/** Detailed provenance tracing how a canonical event was constructed */
export interface FinancialEventProvenance {
  primarySourceRecordId: string
  primaryProvider: StatementProvider
  enrichmentSourceRecordIds: string[]
  enrichmentProviders: StatementProvider[]
  matchEvidence: MatchEvidenceType[]
  matchConfidence: MatchConfidence
  userConfirmedAt?: string
  reconciliationNotes: string[]
}

/**
 * Canonical Financial Event.
 * Represents a single real-world economic event (e.g. one ₹300 grocery expense),
 * potentially supported by multiple source observations (e.g. SBI bank statement debit + PhonePe transaction).
 */
export interface CanonicalFinancialEvent {
  id: string // Unique event ID, e.g. 'cfe-...'
  eventType: TransactionType // 'expense' | 'income' | 'transfer' | 'refund'
  amountPaise: number // Non-negative integer paise
  currency: 'INR'
  date: string // ISO 8601 string
  description: string
  merchant?: string
  category: string
  categoryId?: string
  paymentMethod: PaymentMethod
  sourceAccountId: string
  sourceAccountAlias: string
  destinationAccountId?: string // Used for internal transfers
  destinationAccountAlias?: string // Used for internal transfers
  reference?: string
  notes?: string

  status: FinancialEventStatus
  isInternalTransfer: boolean
  isRefundOrReversal: boolean
  linkedOriginalEventId?: string // If refund, links to original expense event

  provenance: FinancialEventProvenance
  resultingTransactionId?: string // Populated once committed into Transaction ledger

  isDemo?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Model representing a candidate transfer between two owned accounts
 * (e.g. Transfer from SBI account to Union Bank account).
 */
export interface InternalTransferCandidate {
  id: string // e.g. 'trf-cand-...'
  debitRecordId: string
  creditRecordId: string
  fromAccountId: string
  fromAccountAlias: string
  toAccountId: string
  toAccountAlias: string
  amountPaise: number
  date: string
  reference?: string
  confidence: MatchConfidence
  matchEvidence: MatchEvidenceType[]
  matchReason: string
  status: 'pending' | 'confirmed' | 'rejected'
}

/** Validation and parsing status of an import batch */
export type BatchValidationStatus = 'pending' | 'valid' | 'has_warnings' | 'invalid'

/** Review progress of an import batch */
export type BatchReviewStatus = 'unreviewed' | 'partially_reviewed' | 'fully_reviewed'

/** Commitment status of an import batch */
export type BatchCommitStatus = 'draft' | 'committed' | 'partially_committed' | 'rolled_back'

/** Safe file metadata without storing raw statement contents */
export interface BatchFileMetadata {
  fileName: string
  fileSizeBytes: number
  fileHash: string // SHA-256 hash for idempotency checking
  mimeType: string
  detectedFormat: 'csv' | 'pdf' | 'unknown'
}

/** Aggregated count of records within a batch */
export interface BatchRecordCounts {
  total: number
  valid: number
  warnings: number
  errors: number
  ready: number
  ignored: number
  imported: number
}

/** Failure diagnostic details */
export interface BatchFailureDetails {
  reason: string
  timestamp: string
  step: string
  context?: string
}

/** Rollback tracking manifest for safe atomic undo */
export interface BatchRollbackManifest {
  batchId: string
  workspace?: 'demo' | 'live'
  createdTransactionIds: string[]
  updatedTransactionIds: string[]
  snapshotId?: string
  rolledBackAt?: string
  restoredCount: number
  priorValues?: Record<string, Partial<Transaction>>
}

/**
 * Detailed post-import reconciliation audit report.
 * Money Mate AI — Stage 8.5
 */
export interface PostImportAuditReport {
  batchId: string
  timestamp: string
  workspace: 'demo' | 'live'
  sourceProvider: StatementProvider
  sourceAccountId: string
  sourceAccountAlias: string
  totalRowsParsed: number
  acceptedAndImportedCount: number
  skippedDuplicatesCount: number
  retainedUnresolvedCount: number
  pendingCount: number
  failedCount: number
  reversalsCount: number
  refundsCount: number
  transfersCount: number
  recordsRequiringReviewCount: number
  beginningBalancePaise?: number
  statementClosingBalancePaise?: number
  reconstructedClosingBalancePaise?: number
  balanceDifferencePaise?: number
  isReconciliationConclusive: boolean
  reconciliationStatusReason: string
  /** Earliest and latest parsed transaction dates in the batch */
  firstTransactionDate?: string
  lastTransactionDate?: string
  statementStartDate?: string
  statementEndDate?: string
  /** Breakdown of transactions assigned per internal account */
  accountAttributionSummary?: Record<string, { count: number; totalPaise: number; maskedIdentifiers: string[] }>
}

/** Coverage status of an account or target timeline */
export type CoverageStatus =
  | 'complete_verified'
  | 'partial'
  | 'unresolved_discrepancy'
  | 'unknown'

/** Gap detected between consecutive statements for the same account */
export interface StatementGap {
  accountId: string
  accountAlias: string
  previousBatchId: string
  previousEndDate: string
  previousClosingBalancePaise?: number
  nextBatchId: string
  nextStartDate: string
  nextOpeningBalancePaise?: number
  gapDays: number
  balanceDiscrepancyPaise?: number
  isBalanceDiscrepancy: boolean
}

/** Overlap detected between statements for the same account */
export interface StatementOverlap {
  accountId: string
  accountAlias: string
  batchIdA: string
  batchIdB: string
  overlapStartDate: string
  overlapEndDate: string
  overlapDays: number
  notes: string
}

/** Statement coverage per account across historical batches */
export interface AccountStatementCoverage {
  accountId: string
  accountAlias: string
  totalBatches: number
  earliestDate?: string
  latestDate?: string
  batches: {
    batchId: string
    fileName: string
    startDate?: string
    endDate?: string
    firstTxDate?: string
    lastTxDate?: string
    openingBalancePaise?: number
    closingBalancePaise?: number
    isConclusive: boolean
    commitStatus: BatchCommitStatus
  }[]
  gaps: StatementGap[]
  overlaps: StatementOverlap[]
  coverageStatus: CoverageStatus
  statusReason: string
}

/** Comprehensive statement history and readiness coverage report */
export interface StatementCoverageReport {
  targetStartDate: string // e.g. '2025-10-01'
  targetEndDate: string // e.g. '2026-10-20'
  overallStatus: CoverageStatus
  overallStatusReason: string
  accountCoverages: Record<string, AccountStatementCoverage>
  totalGaps: number
  totalOverlaps: number
  unresolvedDiscrepancyCount: number
}

/**
 * Import Batch Model.
 * Encapsulates an entire statement ingestion session with validation, review,
 * idempotency, and rollback metadata.
 */
export interface ImportBatch {
  id: string // e.g. 'imp-batch-...'
  sourceProvider: StatementProvider
  sourceAccountId: string
  sourceAccountAlias: string
  fileMetadata: BatchFileMetadata
  recordCounts: BatchRecordCounts
  validationStatus: BatchValidationStatus
  reviewStatus: BatchReviewStatus
  commitStatus: BatchCommitStatus
  idempotencyKey: string // Typically `${fileHash}_${sourceAccountId}_${workspace}`
  failureDetails?: BatchFailureDetails
  recoveryManifest?: BatchRollbackManifest
  auditReport?: PostImportAuditReport
  isDemo?: boolean
  createdAt: string
  updatedAt: string
}

/** Result of evaluating match compatibility between two records */
export interface StatementMatchEvaluation {
  isMatchCandidate: boolean
  confidence: MatchConfidence
  evidence: MatchEvidenceType[]
  conflicts: MatchConflictType[]
  reason: string
  canAutoMerge: boolean // Strict: true ONLY if strong reference match and 0 conflicts
}

/**
 * Interactive Reconciliation Decision States
 * Money Mate AI — Stage 8.4
 */
export type ReconciliationDecisionState =
  | 'unreviewed'
  | 'suggested_match'
  | 'confirmed_match'
  | 'rejected_match'
  | 'conflicting'
  | 'unmatched'
  | 'classification_required'
  | 'ready_for_import'

/**
 * Explicit mapping between a statement's masked account identifier (e.g. 'XXXX5200')
 * and an internal ledger account record (e.g. 'acc-sbi-primary').
 */
export interface MaskedAccountMapping {
  maskedAccountId: string // Raw identifier from statement (e.g., 'XXXX5200')
  targetAccountId: string // Internal AccountDefinition.id
  targetAccountAlias: string
  provider: StatementProvider
  workspace: 'demo' | 'live'
  confirmedBy: 'user_explicit' | 'persisted_rule'
  notes?: string
  createdAt: string
  updatedAt: string
}

/**
 * Account Mapping Registry State
 */
export type AccountMappingMap = Record<string, MaskedAccountMapping>

/**
 * User action on a reconciliation item
 */
export type ReconciliationUserAction =
  | 'confirm_match'
  | 'reject_match'
  | 'mark_review'
  | 'change_classification'
  | 'confirm_transfer'
  | 'reject_transfer'
  | 'reset'
  | 'approve_new'

/**
 * In-memory decision tracking for a single staged statement observation
 */
export interface ReconciliationDecision {
  recordId: string
  state: ReconciliationDecisionState
  userAction?: ReconciliationUserAction
  matchedLedgerTxId?: string
  matchedRecordId?: string // Link to another staged observation (e.g., transfer leg or enrichment)
  proposedType: TransactionType | 'reversal' | 'needs_review'
  proposedCategory: string
  proposedCategoryId?: string
  assignedAccountId?: string // Explicit mapped target account ID
  assignedAccountAlias?: string
  isInternalTransfer?: boolean
  transferDestinationAccountId?: string
  transferDestinationAccountAlias?: string
  evidence: MatchEvidenceType[]
  conflicts: MatchConflictType[]
  decisionReason: string
  isConfirmed: boolean
  updatedAt: string
}

/**
 * In-memory summary of proposed import effects prior to ledger commitment
 */
export interface ProposedImportSummary {
  totalSourceObservations: number
  confirmedLinksCount: number
  potentialDuplicatesRequiringReview: number
  conflictingCount: number
  unmatchedCount: number
  unresolvedClassificationCount: number
  unresolvedAccountMappingCount?: number
  proposedNewEventsCount: number
  proposedTransfersCount: number
  proposedTransfersPaise: number
  proposedRefundsCount: number
  proposedRefundsPaise: number
  proposedIncomeCount: number
  proposedIncomePaise: number
  proposedExpensesCount: number
  proposedExpensesPaise: number
  rejectedSourceRowsCount: number
}

/**
 * Filter categories for interactive review tab bar
 */
export type ReconciliationFilter =
  | 'all'
  | 'suggested_matches'
  | 'unmatched_bank'
  | 'unmatched_upi'
  | 'internal_transfers'
  | 'conflicts'
  | 'rejected_rows'
  | 'confirmed'
