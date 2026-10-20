/**
 * Atomic Statement Commitment Service
 * Money Mate AI — Stage 8.5
 * 
 * Strict architectural guarantees:
 * 1. Atomic IndexedDB commitment: all new transactions and the ImportBatch metadata (with rollback manifest)
 *    are committed together in a single read-write transaction.
 * 2. If any step fails, zero partial changes remain in the ledger.
 * 3. Strict idempotency: blocks duplicate batch commitment and prevents duplicate externalRef injection.
 * 4. Exact integer paise calculations: no floating-point math.
 * 5. Complete workspace isolation: Demo and Live data stores are strictly segregated.
 * 6. Correct transaction semantics: transfers, refunds, reversals, failed, and pending records
 *    are classified accurately and never inflate income or expense totals.
 */

import type { Transaction, TransactionType, TransactionStatus, PaymentMethod } from '../types/transaction'
import type {
  StatementRecord,
  ReconciliationDecision,
  ImportBatch,
  BatchFileMetadata,
  BatchRollbackManifest,
  PostImportAuditReport,
  StatementProvider,
} from '../types/reconciliation'
import {
  openDatabase,
  STORE_NAME,
  IMPORT_BATCHES_STORE_NAME,
} from '../storage/db'
import {
  validateImportEligibility,
  type RecordEligibilityResult,
} from './reconciliationEligibility'
import type { InMemoryTransactionRepository } from '../storage/transactionRepository'

export interface CommitStatementBatchOptions {
  workspace: 'demo' | 'live'
  records: StatementRecord[]
  decisions: Map<string, ReconciliationDecision>
  batchMetadata: BatchFileMetadata
  sourceProvider: StatementProvider
  sourceAccountId: string
  sourceAccountAlias: string
  beginningBalancePaise?: number
  statementClosingBalancePaise?: number
  allowReimportOfRolledBack?: boolean // Deliberate explicit user action allowing re-import of a previously rolled-back file
  db?: IDBDatabase
  inMemoryRepo?: InMemoryTransactionRepository
  mockBatchesStore?: Map<string, ImportBatch>
}

export interface CommitStatementBatchResult {
  success: boolean
  batch?: ImportBatch
  auditReport?: PostImportAuditReport
  createdTransactionIds?: string[]
  skippedDuplicatesCount?: number
  error?: string
  diagnostics?: string[]
}

/**
 * Deterministic fast file content hash for idempotency checking.
 * Supports string text and binary Uint8Array buffers (e.g. PDFs).
 */
export function computeFileHash(content: string | Uint8Array): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c64e6d
  const len = typeof content === 'string' ? content.length : content.byteLength
  for (let i = 0; i < len; i++) {
    const ch = typeof content === 'string' ? content.charCodeAt(i) : content[i]
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 'hash_' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

// In-process concurrency lock to prevent simultaneous commits on the same batch key
const activeCommitLocks = new Set<string>()

/**
 * Commits an approved statement reconciliation draft into the persistent ledger.
 */
export async function commitStatementBatch(
  options: CommitStatementBatchOptions
): Promise<CommitStatementBatchResult> {
  const {
    workspace,
    records,
    decisions,
    batchMetadata,
    sourceProvider,
    sourceAccountId,
    sourceAccountAlias,
    beginningBalancePaise,
    statementClosingBalancePaise,
    db: injectedDb,
    inMemoryRepo,
    mockBatchesStore,
  } = options

  const isDemo = workspace === 'demo'
  const idempotencyKey = `${batchMetadata.fileHash}_${sourceAccountId}_${workspace}`

  // 1. Concurrency guard
  if (activeCommitLocks.has(idempotencyKey)) {
    return {
      success: false,
      error: 'A commit operation is currently in progress for this statement. Concurrent commit rejected.',
    }
  }

  activeCommitLocks.add(idempotencyKey)

  try {
    // 2. Preliminary validation of draft input
    if (!records || records.length === 0) {
      return {
        success: false,
        error: 'No statement records provided for commitment.',
      }
    }

    // 3. Central Eligibility Check
    const eligibleRecords: {
      record: StatementRecord
      decision: ReconciliationDecision
      eligibility: RecordEligibilityResult
    }[] = []

    const ineligibleDiagnostics: string[] = []

    for (const record of records) {
      const decision = decisions.get(record.id)
      const eligibility = validateImportEligibility(record, decision, workspace)

      if (!eligibility.isEligible) {
        ineligibleDiagnostics.push(`Row ${record.originalRowIndex || record.id}: ${eligibility.rejectionReason}`)
      } else {
        eligibleRecords.push({
          record,
          decision: decision!,
          eligibility,
        })
      }
    }

    if (ineligibleDiagnostics.length > 0) {
      return {
        success: false,
        error: `Import aborted: ${ineligibleDiagnostics.length} records failed strict eligibility criteria.`,
        diagnostics: ineligibleDiagnostics,
      }
    }

    // 4. Fetch existing transactions to verify idempotency and reference conflicts
    let existingTxs: Transaction[] = []
    let existingBatches: ImportBatch[] = []

    if (inMemoryRepo) {
      existingTxs = (await inMemoryRepo.getAll()).filter((t) => (workspace === 'demo' ? t.isDemo : !t.isDemo))
      if (mockBatchesStore) {
        existingBatches = Array.from(mockBatchesStore.values()).filter((b) => (workspace === 'demo' ? b.isDemo : !b.isDemo))
      }
    } else {
      const db = injectedDb || (await openDatabase())
      existingTxs = await new Promise<Transaction[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.getAll()
        req.onsuccess = () => {
          const all = (req.result || []) as Transaction[]
          resolve(all.filter((t) => (workspace === 'demo' ? t.isDemo : !t.isDemo)))
        }
        req.onerror = () => reject(req.error)
      })

      existingBatches = await new Promise<ImportBatch[]>((resolve, reject) => {
        const tx = db.transaction(IMPORT_BATCHES_STORE_NAME, 'readonly')
        const store = tx.objectStore(IMPORT_BATCHES_STORE_NAME)
        const req = store.getAll()
        req.onsuccess = () => {
          const all = (req.result || []) as ImportBatch[]
          resolve(all.filter((b) => (workspace === 'demo' ? b.isDemo : !b.isDemo)))
        }
        req.onerror = () => reject(req.error)
      })
    }

    // 5. Idempotency Check: Existing Batch
    // Strict statement file deduplication: The exact same statement file (identical content hash)
    // must NEVER be imported more than once into the same workspace, even if the user changes
    // account mappings or selected account ID.
    const duplicateCommittedBatch = existingBatches.find(
      (b) =>
        (b.idempotencyKey === idempotencyKey || b.fileMetadata?.fileHash === batchMetadata.fileHash) &&
        b.commitStatus === 'committed'
    )
    if (duplicateCommittedBatch) {
      return {
        success: false,
        error: `Idempotency violation: This statement file has already been imported (Batch ID: ${duplicateCommittedBatch.id}). Re-importing duplicate file aborted.`,
      }
    }

    // Check if this file was previously rolled back
    const rolledBackBatch = existingBatches.find(
      (b) =>
        (b.idempotencyKey === idempotencyKey || b.fileMetadata?.fileHash === batchMetadata.fileHash) &&
        b.commitStatus === 'rolled_back'
    )
    if (rolledBackBatch && !options.allowReimportOfRolledBack) {
      return {
        success: false,
        error: `Statement file was previously imported and rolled back (Batch ID: ${rolledBackBatch.id}). Deliberate user confirmation (allowReimportOfRolledBack) is required to re-import.`,
      }
    }

    // 6. External reference conflict check against existing ledger
    const existingRefMap = new Map<string, Transaction>()
    for (const tx of existingTxs) {
      if (tx.externalRef) {
        existingRefMap.set(tx.externalRef, tx)
      }
    }

    for (const item of eligibleRecords) {
      const ref = item.record.normalizedReference || item.record.originalReference
      if (ref && existingRefMap.has(ref)) {
        const matchedTx = existingRefMap.get(ref)!
        // If not explicitly approved as confirmed_match / duplicate, this is an unexpected conflict!
        if (
          item.decision.state !== 'confirmed_match' ||
          item.eligibility.action !== 'skip_confirmed_duplicate'
        ) {
          return {
            success: false,
            error: `Conflicting external reference detected: Reference "${ref}" already exists on transaction "${matchedTx.description}" (${matchedTx.id}). Commitment aborted.`,
          }
        }
      }
    }

    // 7. Prepare Batch Record and Transactions
    const batchId = `imp-batch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const nowIso = new Date().toISOString()

    const transactionsToInsert: Transaction[] = []
    const createdTransactionIds: string[] = []
    let skippedDuplicatesCount = 0
    let transfersCount = 0
    let refundsCount = 0
    let pendingCount = 0
    let failedCount = 0
    let reversalsCount = 0

    // Intra-batch transfer deduplication set
    const handledTransferPairIds = new Set<string>()

    for (let i = 0; i < eligibleRecords.length; i++) {
      const { record, decision, eligibility } = eligibleRecords[i]

      // Case A: Skip confirmed duplicate
      if (eligibility.action === 'skip_confirmed_duplicate') {
        skippedDuplicatesCount++
        continue
      }

      // Case B: Internal transfer between accounts
      if (eligibility.action === 'create_transfer') {
        if (handledTransferPairIds.has(record.id)) {
          // Already created from the other leg
          continue
        }

        handledTransferPairIds.add(record.id)
        if (decision.matchedRecordId) {
          handledTransferPairIds.add(decision.matchedRecordId)
        }

        transfersCount++
        const txId = `tx-imp-${batchId}-trf-${i + 1}`
        createdTransactionIds.push(txId)

        const effectiveAccountId = decision.assignedAccountId || record.sourceAccountId
        const fromAlias = record.direction === 'debit' ? (decision.assignedAccountAlias || record.sourceAccountAlias) : (decision.transferDestinationAccountAlias || 'Unknown Account')
        const toAlias = record.direction === 'credit' ? (decision.assignedAccountAlias || record.sourceAccountAlias) : (decision.transferDestinationAccountAlias || 'Unknown Account')

        const transferTx: Transaction = {
          id: txId,
          type: 'transfer',
          amount: record.amountPaise,
          currency: 'INR',
          date: record.parsedDate || nowIso,
          description: `Internal Transfer: ${fromAlias} → ${toAlias}`,
          category: 'Transfer',
          paymentMethod: 'Bank transfer',
          accountId: effectiveAccountId,
          fromAccount: fromAlias,
          toAccount: toAlias,
          status: 'completed',
          notes: `[Statement Import ${sourceProvider.toUpperCase()}] ${record.cleanDescription || record.rawDescription}`,
          source: 'csv',
          externalRef: record.normalizedReference || record.originalReference || undefined,
          importBatchId: batchId,
          sourceRowId: record.id,
          isDemo,
          createdAt: nowIso,
          updatedAt: nowIso,
        }

        transactionsToInsert.push(transferTx)
        continue
      }

      // Case C: New financial transaction (Income, Expense, Refund, Failed, Pending)
      const txId = `tx-imp-${batchId}-${i + 1}`
      createdTransactionIds.push(txId)

      let txType: TransactionType = 'expense'
      let txStatus: TransactionStatus = 'completed'

      // Failed / Reversal status
      if (record.status === 'failed' || decision.proposedType === 'reversal') {
        txStatus = 'failed'
        failedCount++
        if (decision.proposedType === 'reversal') {
          reversalsCount++
        }
      } else if (record.metadata.paymentStatus?.toLowerCase() === 'pending') {
        txStatus = 'pending'
        pendingCount++
      }

      // Type determination
      if (decision.proposedType === 'refund') {
        txType = 'refund'
        refundsCount++
      } else if (decision.proposedType === 'transfer' || record.proposedType === 'transfer') {
        txType = 'transfer'
        transfersCount++
      } else if (decision.proposedType === 'income' || record.proposedType === 'income') {
        txType = 'income'
      } else {
        txType = 'expense'
      }

      const paymentMethod: PaymentMethod =
        record.metadata.paymentChannel === 'UPI' ||
        ['phonepe', 'paytm', 'slice'].includes(sourceProvider)
          ? 'UPI'
          : 'Bank transfer'

      const effectiveAccountId = decision.assignedAccountId || record.sourceAccountId

      const newTx: Transaction = {
        id: txId,
        type: txType,
        amount: record.amountPaise,
        currency: 'INR',
        date: record.parsedDate || nowIso,
        description: record.cleanDescription || record.rawDescription,
        merchant: record.counterparty || undefined,
        category: decision.proposedCategory || record.proposedCategory,
        categoryId: decision.proposedCategoryId || record.proposedCategoryId,
        paymentMethod,
        accountId: effectiveAccountId,
        status: txStatus,
        notes: `[Statement Import ${sourceProvider.toUpperCase()}] ${record.metadata.rawNarration || record.rawDescription}`,
        source: 'csv',
        externalRef: record.normalizedReference || record.originalReference || undefined,
        importBatchId: batchId,
        sourceRowId: record.id,
        isDemo,
        createdAt: nowIso,
        updatedAt: nowIso,
      }

      transactionsToInsert.push(newTx)
    }

    // 8. Reconstruct Closing Balance & Generate Post-Import Audit Report
    let netSettledSignedPaise = 0
    const accountAttributionSummary: Record<string, { count: number; totalPaise: number; maskedIdentifiers: string[] }> = {}

    for (const tx of transactionsToInsert) {
      // Record account attribution breakdown
      const accId = tx.accountId || 'unassigned'
      if (!accountAttributionSummary[accId]) {
        accountAttributionSummary[accId] = { count: 0, totalPaise: 0, maskedIdentifiers: [] }
      }
      accountAttributionSummary[accId].count++
      accountAttributionSummary[accId].totalPaise += tx.amount

      if (tx.status !== 'completed') continue
      if (tx.type === 'income') {
        netSettledSignedPaise += tx.amount
      } else if (tx.type === 'expense') {
        netSettledSignedPaise -= tx.amount
      } else if (tx.type === 'refund') {
        netSettledSignedPaise += tx.amount // Refund returns money to account
      }
      // Internal transfers do not change overall net balance, though per-account balances adjust
    }

    // Associate masked identifiers into summary
    for (const item of eligibleRecords) {
      const accId = item.decision.assignedAccountId || item.record.sourceAccountId || 'unassigned'
      if (item.record.maskedAccountId && accountAttributionSummary[accId]) {
        if (!accountAttributionSummary[accId].maskedIdentifiers.includes(item.record.maskedAccountId)) {
          accountAttributionSummary[accId].maskedIdentifiers.push(item.record.maskedAccountId)
        }
      }
    }

    let reconstructedClosingBalancePaise: number | undefined
    let balanceDifferencePaise: number | undefined
    let isReconciliationConclusive = false
    let reconciliationStatusReason = 'Reconciliation evaluation incomplete.'

    if (beginningBalancePaise !== undefined) {
      reconstructedClosingBalancePaise = beginningBalancePaise + netSettledSignedPaise
      if (statementClosingBalancePaise !== undefined) {
        balanceDifferencePaise = statementClosingBalancePaise - reconstructedClosingBalancePaise
        if (balanceDifferencePaise === 0) {
          isReconciliationConclusive = true
          reconciliationStatusReason = 'Conclusive: Statement opening balance and reconstructed transactions perfectly match closing balance (0 paise variance).'
        } else {
          isReconciliationConclusive = false
          reconciliationStatusReason = `Unresolved variance: Reconstructed balance differs from statement closing balance by ${(balanceDifferencePaise / 100).toFixed(2)} INR.`
        }
      } else {
        isReconciliationConclusive = false
        reconciliationStatusReason = 'Incomplete balance data: Statement does not specify a closing balance.'
      }
    } else {
      isReconciliationConclusive = false
      reconciliationStatusReason = 'Incomplete balance coverage: Statement does not specify a reliable beginning balance.'
    }

    // Compute earliest and latest transaction dates in the batch
    const validDates = records
      .map((r) => r.parsedDate)
      .filter((d): d is string => typeof d === 'string' && d.length > 0 && !isNaN(new Date(d).getTime()))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())

    const firstTransactionDate = validDates[0]
    const lastTransactionDate = validDates[validDates.length - 1]

    const auditReport: PostImportAuditReport = {
      batchId,
      timestamp: nowIso,
      workspace,
      sourceProvider,
      sourceAccountId,
      sourceAccountAlias,
      totalRowsParsed: records.length,
      acceptedAndImportedCount: transactionsToInsert.length,
      skippedDuplicatesCount,
      retainedUnresolvedCount: 0,
      pendingCount,
      failedCount,
      reversalsCount,
      refundsCount,
      transfersCount,
      recordsRequiringReviewCount: 0,
      beginningBalancePaise,
      statementClosingBalancePaise,
      reconstructedClosingBalancePaise,
      balanceDifferencePaise,
      isReconciliationConclusive,
      reconciliationStatusReason,
      firstTransactionDate,
      lastTransactionDate,
      accountAttributionSummary,
    }

    // 9. Construct Rollback Manifest & ImportBatch Model
    const recoveryManifest: BatchRollbackManifest = {
      batchId,
      workspace,
      createdTransactionIds,
      updatedTransactionIds: [],
      rolledBackAt: undefined,
      restoredCount: 0,
    }

    const importBatch: ImportBatch = {
      id: batchId,
      sourceProvider,
      sourceAccountId,
      sourceAccountAlias,
      fileMetadata: batchMetadata,
      recordCounts: {
        total: records.length,
        valid: eligibleRecords.length,
        warnings: 0,
        errors: 0,
        ready: eligibleRecords.length,
        ignored: 0,
        imported: transactionsToInsert.length,
      },
      validationStatus: 'valid',
      reviewStatus: 'fully_reviewed',
      commitStatus: 'committed',
      idempotencyKey,
      recoveryManifest,
      auditReport,
      isDemo,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    // 10. Atomic Multi-Store Commitment
    if (inMemoryRepo) {
      // In-memory testing execution with snapshot rollback protocol
      const originalTxs = await inMemoryRepo.getAll()
      try {
        for (const tx of transactionsToInsert) {
          await inMemoryRepo.add(tx)
        }
        if (mockBatchesStore) {
          mockBatchesStore.set(batchId, importBatch)
        }
      } catch (memErr) {
        // Rollback memory repository
        await inMemoryRepo.clear()
        for (const otx of originalTxs) {
          await inMemoryRepo.add(otx)
        }
        if (mockBatchesStore) {
          mockBatchesStore.delete(batchId)
        }
        return {
          success: false,
          error: `Memory commit failed and was rolled back: ${(memErr as Error).message}`,
        }
      }
    } else {
      // Real IndexedDB multi-store transaction: commits transactions & batch manifest in a single read-write tx
      const db = injectedDb || (await openDatabase())

      await new Promise<void>((resolve, reject) => {
        const idbTx = db.transaction([STORE_NAME, IMPORT_BATCHES_STORE_NAME], 'readwrite')
        const txStore = idbTx.objectStore(STORE_NAME)
        const batchStore = idbTx.objectStore(IMPORT_BATCHES_STORE_NAME)

        idbTx.oncomplete = () => resolve()
        idbTx.onerror = () => reject(idbTx.error || new Error('IndexedDB multi-store transaction aborted.'))
        idbTx.onabort = () => reject(new Error('IndexedDB transaction was aborted. Zero partial changes committed.'))

        // Write all transactions
        for (const tx of transactionsToInsert) {
          txStore.add(tx)
        }

        // Write import batch metadata
        batchStore.add(importBatch)
      })
    }

    return {
      success: true,
      batch: importBatch,
      auditReport,
      createdTransactionIds,
      skippedDuplicatesCount,
    }
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || 'Unexpected failure during statement import commitment.',
    }
  } finally {
    activeCommitLocks.delete(idempotencyKey)
  }
}

/**
 * Retrieves all import batches for the specified workspace.
 */
export async function getImportBatches(
  workspace: 'demo' | 'live',
  db?: IDBDatabase,
  mockBatchesStore?: Map<string, ImportBatch>
): Promise<ImportBatch[]> {
  const isDemo = workspace === 'demo'
  if (mockBatchesStore) {
    return Array.from(mockBatchesStore.values())
      .filter((b) => (b.isDemo ?? false) === isDemo)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  const database = db || (await openDatabase())
  return new Promise((resolve, reject) => {
    try {
      const tx = database.transaction(IMPORT_BATCHES_STORE_NAME, 'readonly')
      const store = tx.objectStore(IMPORT_BATCHES_STORE_NAME)
      const req = store.getAll()
      req.onsuccess = () => {
        const all = (req.result || []) as ImportBatch[]
        resolve(
          all
            .filter((b) => (b.isDemo ?? false) === isDemo)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        )
      }
      req.onerror = () => reject(req.error)
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Retrieves a single import batch by ID.
 */
export async function getImportBatchById(
  batchId: string,
  db?: IDBDatabase,
  mockBatchesStore?: Map<string, ImportBatch>
): Promise<ImportBatch | null> {
  if (mockBatchesStore) {
    return mockBatchesStore.get(batchId) || null
  }

  const database = db || (await openDatabase())
  return new Promise((resolve, reject) => {
    try {
      const tx = database.transaction(IMPORT_BATCHES_STORE_NAME, 'readonly')
      const store = tx.objectStore(IMPORT_BATCHES_STORE_NAME)
      const req = store.get(batchId)
      req.onsuccess = () => resolve((req.result as ImportBatch) || null)
      req.onerror = () => reject(req.error)
    } catch (err) {
      reject(err)
    }
  })
}
