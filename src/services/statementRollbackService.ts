/**
 * Safe Batch Rollback Service
 * Money Mate AI — Stage 8.5
 * 
 * Strict architectural rules:
 * 1. Requires explicit validation before any destructive action.
 * 2. Deletes only records created by the specified batch.
 * 3. Never deletes or mutates pre-existing transactions that were merely linked or matched.
 * 4. Strictly blocks rollback if any created transaction was subsequently modified or depended upon.
 * 5. Strictly isolates Demo and Live workspaces: never allows cross-workspace rollback.
 * 6. Repeated rollback attempts are safe and idempotent.
 * 7. Multi-store atomicity: ledger changes and batch status updates are committed together.
 */

import type { Transaction } from '../types/transaction'
import type { ImportBatch } from '../types/reconciliation'
import {
  openDatabase,
  STORE_NAME,
  IMPORT_BATCHES_STORE_NAME,
} from '../storage/db'
import type { InMemoryTransactionRepository } from '../storage/transactionRepository'

export interface RollbackOptions {
  targetScope: 'demo' | 'live'
  db?: IDBDatabase
  inMemoryRepo?: InMemoryTransactionRepository
  mockBatchesStore?: Map<string, ImportBatch>
}

export interface RollbackValidationResult {
  canRollback: boolean
  isAlreadyRolledBack?: boolean
  reason?: string
  batch?: ImportBatch
  affectedTransactions?: Transaction[]
}

export interface RollbackResult {
  success: boolean
  rolledBackBatchId?: string
  restoredCount?: number
  message?: string
  error?: string
}

/**
 * Validates whether a batch can be safely rolled back without data loss or integrity violation.
 */
export async function validateRollbackSafety(
  batchId: string,
  options: RollbackOptions
): Promise<RollbackValidationResult> {
  const { targetScope, db: injectedDb, inMemoryRepo, mockBatchesStore } = options
  const isDemo = targetScope === 'demo'

  let batch: ImportBatch | null = null
  let allTxs: Transaction[] = []

  if (inMemoryRepo) {
    allTxs = (await inMemoryRepo.getAll()).filter((t) => (t.isDemo ?? false) === isDemo)
    batch = mockBatchesStore?.get(batchId) || null
  } else {
    const db = injectedDb || (await openDatabase())

    batch = await new Promise<ImportBatch | null>((resolve, reject) => {
      try {
        const tx = db.transaction(IMPORT_BATCHES_STORE_NAME, 'readonly')
        const store = tx.objectStore(IMPORT_BATCHES_STORE_NAME)
        const req = store.get(batchId)
        req.onsuccess = () => resolve((req.result as ImportBatch) || null)
        req.onerror = () => reject(req.error)
      } catch (err) {
        reject(err)
      }
    })

    allTxs = await new Promise<Transaction[]>((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.getAll()
        req.onsuccess = () => {
          const all = (req.result || []) as Transaction[]
          resolve(all.filter((t) => (t.isDemo ?? false) === isDemo))
        }
        req.onerror = () => reject(req.error)
      } catch (err) {
        reject(err)
      }
    })
  }

  // 1. Batch existence
  if (!batch) {
    return {
      canRollback: false,
      reason: `Import batch with ID "${batchId}" does not exist.`,
    }
  }

  // 2. Idempotent check: already rolled back
  if (batch.commitStatus === 'rolled_back') {
    return {
      canRollback: true,
      isAlreadyRolledBack: true,
      reason: `Batch "${batchId}" was already rolled back on ${batch.recoveryManifest?.rolledBackAt || batch.updatedAt}. Repeated rollback is safe and idempotent.`,
      batch,
    }
  }

  // 3. Status check
  if (batch.commitStatus !== 'committed') {
    return {
      canRollback: false,
      reason: `Cannot rollback batch "${batchId}": Batch status is "${batch.commitStatus}" (must be "committed").`,
    }
  }

  // 4. Workspace isolation check
  const batchIsDemo = batch.isDemo ?? false
  if (batchIsDemo !== isDemo) {
    return {
      canRollback: false,
      reason: `Workspace mismatch: Batch "${batchId}" belongs to ${batchIsDemo ? 'demo' : 'live'} workspace, but target rollback scope is ${targetScope}.`,
    }
  }

  // 5. Recovery manifest verification
  const createdIds = batch.recoveryManifest?.createdTransactionIds || []
  const txMap = new Map<string, Transaction>(allTxs.map((t) => [t.id, t]))
  const affectedTransactions: Transaction[] = []

  for (const txId of createdIds) {
    const tx = txMap.get(txId)
    if (!tx) {
      // Transaction was already removed or doesn't exist
      continue
    }

    affectedTransactions.push(tx)

    // Modification check: Has the transaction been updated since creation?
    if (tx.updatedAt && tx.createdAt && tx.updatedAt !== tx.createdAt) {
      return {
        canRollback: false,
        reason: `Rollback blocked: Transaction "${tx.description}" (${tx.id}) was modified after import (updated at ${tx.updatedAt}). Refusing to delete modified transaction.`,
        batch,
      }
    }

    // Dependency check: Does any subsequent transaction link to this transaction?
    const dependingTx = allTxs.find((t) => t.linkedTransactionId === tx.id)
    if (dependingTx) {
      return {
        canRollback: false,
        reason: `Rollback blocked: Transaction "${tx.description}" (${tx.id}) has a dependent record "${dependingTx.description}" (${dependingTx.id}). Refusing to orphan dependencies.`,
        batch,
      }
    }
  }

  return {
    canRollback: true,
    isAlreadyRolledBack: false,
    batch,
    affectedTransactions,
  }
}

/**
 * Executes a verified, atomic rollback of an imported batch.
 */
export async function executeBatchRollback(
  batchId: string,
  options: RollbackOptions
): Promise<RollbackResult> {
  const { db: injectedDb, inMemoryRepo, mockBatchesStore } = options

  // Validate rollback safety first
  const validation = await validateRollbackSafety(batchId, options)
  if (!validation.canRollback) {
    return {
      success: false,
      error: validation.reason || 'Rollback rejected due to safety violations.',
    }
  }

  const batch = validation.batch!

  // Idempotent early exit if already rolled back
  if (validation.isAlreadyRolledBack) {
    return {
      success: true,
      rolledBackBatchId: batchId,
      restoredCount: 0,
      message: validation.reason,
    }
  }

  const createdIds = batch.recoveryManifest?.createdTransactionIds || []
  const nowIso = new Date().toISOString()

  // Update batch model status and manifest
  const updatedBatch: ImportBatch = {
    ...batch,
    commitStatus: 'rolled_back',
    recoveryManifest: {
      ...batch.recoveryManifest!,
      rolledBackAt: nowIso,
      restoredCount: createdIds.length,
    },
    updatedAt: nowIso,
  }

  if (inMemoryRepo) {
    // In-memory testing execution
    for (const txId of createdIds) {
      await inMemoryRepo.delete(txId)
    }
    if (mockBatchesStore) {
      mockBatchesStore.set(batchId, updatedBatch)
    }
  } else {
    // Multi-store IndexedDB atomic transaction
    const db = injectedDb || (await openDatabase())

    await new Promise<void>((resolve, reject) => {
      try {
        const idbTx = db.transaction([STORE_NAME, IMPORT_BATCHES_STORE_NAME], 'readwrite')
        const txStore = idbTx.objectStore(STORE_NAME)
        const batchStore = idbTx.objectStore(IMPORT_BATCHES_STORE_NAME)

        idbTx.oncomplete = () => resolve()
        idbTx.onerror = () => reject(idbTx.error || new Error('Failed to execute rollback in IndexedDB.'))
        idbTx.onabort = () => reject(new Error('Rollback transaction was aborted.'))

        // Delete all transactions created by this batch
        for (const txId of createdIds) {
          txStore.delete(txId)
        }

        // Update the batch status to 'rolled_back'
        batchStore.put(updatedBatch)
      } catch (err) {
        reject(err)
      }
    })
  }

  return {
    success: true,
    rolledBackBatchId: batchId,
    restoredCount: createdIds.length,
    message: `Batch "${batchId}" successfully rolled back. Removed ${createdIds.length} newly created transactions.`,
  }
}
