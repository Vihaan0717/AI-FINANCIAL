/**
 * Account Mapping Service
 * Money Mate AI
 * 
 * Strict architectural principles:
 * 1. Isolates account mappings strictly between 'demo' and 'live' workspaces.
 * 2. Never auto-guesses or infers bank attribution (SBI, Union Bank, credit lines) without explicit user evidence.
 * 3. Persists explicit mappings in IndexedDB (and in-memory for tests/mocking).
 * 4. Provides deterministic lookup and batch-level mapping application.
 */

import type { MaskedAccountMapping, StatementRecord, ReconciliationDecision } from '../types/reconciliation'
import { openDatabase, ACCOUNT_MAPPINGS_STORE_NAME } from '../storage/db'

// In-memory fallback / test store: Map<`${workspace}:${maskedAccountId}`, MaskedAccountMapping>
const inMemoryMappings = new Map<string, MaskedAccountMapping>()

export function clearInMemoryAccountMappings(): void {
  inMemoryMappings.clear()
}

/**
 * Retrieves all stored masked account mappings for a specific workspace.
 */
export async function getAccountMappingsForWorkspace(
  workspace: 'demo' | 'live',
  injectedDb?: IDBDatabase
): Promise<Record<string, MaskedAccountMapping>> {
  const result: Record<string, MaskedAccountMapping> = {}

  // 1. Check in-memory first
  for (const mapping of inMemoryMappings.values()) {
    if (mapping.workspace === workspace) {
      result[mapping.maskedAccountId] = mapping
    }
  }

  // 2. Query IndexedDB if available
  if (typeof window !== 'undefined' && window.indexedDB) {
    try {
      const db = injectedDb || (await openDatabase())
      if (db.objectStoreNames.contains(ACCOUNT_MAPPINGS_STORE_NAME)) {
        const idbMappings = await new Promise<MaskedAccountMapping[]>((resolve, reject) => {
          try {
            const tx = db.transaction([ACCOUNT_MAPPINGS_STORE_NAME], 'readonly')
            const store = tx.objectStore(ACCOUNT_MAPPINGS_STORE_NAME)
            const req = store.getAll()
            req.onsuccess = () => resolve((req.result as MaskedAccountMapping[]) || [])
            req.onerror = () => reject(req.error)
          } catch (err) {
            reject(err)
          }
        })

        for (const mapping of idbMappings) {
          if (mapping.workspace === workspace) {
            result[mapping.maskedAccountId] = mapping
            inMemoryMappings.set(`${workspace}:${mapping.maskedAccountId}`, mapping)
          }
        }
      }
    } catch {
      // Fallback silently to in-memory store in non-browser or mock environments
    }
  }

  return result
}

/**
 * Saves or updates an explicit masked account mapping.
 */
export async function saveAccountMapping(
  mapping: Omit<MaskedAccountMapping, 'createdAt' | 'updatedAt'>,
  injectedDb?: IDBDatabase
): Promise<MaskedAccountMapping> {
  const now = new Date().toISOString()
  const fullMapping: MaskedAccountMapping = {
    ...mapping,
    createdAt: now,
    updatedAt: now,
  }

  const memoryKey = `${mapping.workspace}:${mapping.maskedAccountId}`
  inMemoryMappings.set(memoryKey, fullMapping)

  if (typeof window !== 'undefined' && window.indexedDB) {
    try {
      const db = injectedDb || (await openDatabase())
      if (db.objectStoreNames.contains(ACCOUNT_MAPPINGS_STORE_NAME)) {
        await new Promise<void>((resolve, reject) => {
          try {
            const tx = db.transaction([ACCOUNT_MAPPINGS_STORE_NAME], 'readwrite')
            const store = tx.objectStore(ACCOUNT_MAPPINGS_STORE_NAME)
            const req = store.put(fullMapping)
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error)
          } catch (err) {
            reject(err)
          }
        })
      }
    } catch {
      // Retained in in-memory map
    }
  }

  return fullMapping
}

/**
 * Deletes an account mapping.
 */
export async function deleteAccountMapping(
  workspace: 'demo' | 'live',
  maskedAccountId: string,
  injectedDb?: IDBDatabase
): Promise<void> {
  const memoryKey = `${workspace}:${maskedAccountId}`
  inMemoryMappings.delete(memoryKey)

  if (typeof window !== 'undefined' && window.indexedDB) {
    try {
      const db = injectedDb || (await openDatabase())
      if (db.objectStoreNames.contains(ACCOUNT_MAPPINGS_STORE_NAME)) {
        await new Promise<void>((resolve, reject) => {
          try {
            const tx = db.transaction([ACCOUNT_MAPPINGS_STORE_NAME], 'readwrite')
            const store = tx.objectStore(ACCOUNT_MAPPINGS_STORE_NAME)
            const req = store.delete([workspace, maskedAccountId])
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error)
          } catch (err) {
            reject(err)
          }
        })
      }
    } catch {
      // Ignored
    }
  }
}

/**
 * Resolves account attribution for a list of statement records and updates their decisions.
 * Returns the count of unresolved records.
 */
export function applyAccountMappingsToRecords(
  records: StatementRecord[],
  decisions: Map<string, ReconciliationDecision>,
  mappings: Record<string, MaskedAccountMapping>
): { mappedCount: number; unresolvedCount: number; distinctMasks: string[] } {
  const distinctMasks = new Set<string>()
  let mappedCount = 0
  let unresolvedCount = 0

  for (const record of records) {
    if (record.maskedAccountId) {
      distinctMasks.add(record.maskedAccountId)
    }

    const mask = record.maskedAccountId
    const mapping = mask ? mappings[mask] : undefined

    if (mapping) {
      record.sourceAccountId = mapping.targetAccountId
      record.sourceAccountAlias = mapping.targetAccountAlias
      mappedCount++

      const decision = decisions.get(record.id)
      if (decision) {
        decision.assignedAccountId = mapping.targetAccountId
        decision.assignedAccountAlias = mapping.targetAccountAlias
        // If decision was stuck in needs_review or unmapped, keep or update decisionReason
        if (record.sourceAccountId.startsWith('unmapped:')) {
          record.sourceAccountId = mapping.targetAccountId
          record.sourceAccountAlias = mapping.targetAccountAlias
        }
      }
    } else {
      // If it's an unmapped masked account or starts with unmapped:
      if (record.sourceAccountId.startsWith('unmapped:') || (mask && !record.sourceAccountId)) {
        unresolvedCount++
      }
    }
  }

  return {
    mappedCount,
    unresolvedCount,
    distinctMasks: Array.from(distinctMasks),
  }
}
