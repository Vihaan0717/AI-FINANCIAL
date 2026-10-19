import type {
  MoneyMateBackup,
  BackupDataPayload,
  BackupValidationResult,
  BackupDataScope,
} from '../types/backup'
import { CURRENT_BACKUP_SCHEMA_VERSION } from '../types/backup'

/**
 * Deterministic 56-bit FNV-1a / Murmur hybrid checksum generator.
 * Zero-dependency, synchronous, and cross-platform (Node.js, Browser, Workers).
 */
export function computeBackupChecksum(data: unknown): string {
  const str = JSON.stringify(data)
  let h1 = 0xdeadbeef
  let h2 = 0x41c64e6d
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

export interface ValidateBackupOptions {
  expectedScope?: BackupDataScope
  skipChecksumValidation?: boolean
}

/**
 * Thoroughly validates candidate backup data prior to ingestion.
 * Ensures structural validity, integer-paise precision, unique IDs, referential integrity,
 * and strict Demo/Live workspace isolation.
 */
export function validateBackupPayload(
  candidate: unknown,
  options?: ValidateBackupOptions
): BackupValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. Basic Type Structure
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      isValid: false,
      errors: ['Invalid backup: Payload must be a non-null JSON object.'],
      warnings: [],
    }
  }

  const raw = candidate as Partial<MoneyMateBackup>

  // 2. Metadata Verification
  if (!raw.metadata || typeof raw.metadata !== 'object') {
    return {
      isValid: false,
      errors: ['Invalid backup: Missing "metadata" header object.'],
      warnings: [],
    }
  }

  const meta = raw.metadata

  // Schema version validation
  if (typeof meta.schemaVersion !== 'number') {
    errors.push('Invalid metadata: "schemaVersion" must be a number.')
  } else if (meta.schemaVersion !== CURRENT_BACKUP_SCHEMA_VERSION) {
    errors.push(
      `Unsupported backup schema version (${meta.schemaVersion}). This version of Money Mate AI supports version ${CURRENT_BACKUP_SCHEMA_VERSION}.`
    )
  }

  // Data scope validation
  if (meta.dataScope !== 'live' && meta.dataScope !== 'demo') {
    errors.push(`Invalid metadata: "dataScope" must be either "live" or "demo", received "${meta.dataScope}".`)
  } else if (options?.expectedScope && meta.dataScope !== options.expectedScope) {
    errors.push(
      `Workspace mismatch: Attempted to restore a "${meta.dataScope}" backup into a "${options.expectedScope}" workspace. Workspace boundaries must be preserved.`
    )
  }

  // Check data container
  if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    errors.push('Invalid backup: Missing or malformed "data" container.')
    return { isValid: false, errors, warnings }
  }

  const data = raw.data as Partial<BackupDataPayload>

  // 3. Checksum Verification
  if (!options?.skipChecksumValidation) {
    if (!meta.checksum || typeof meta.checksum !== 'string') {
      errors.push('Invalid metadata: Missing "checksum" field.')
    } else {
      const computed = computeBackupChecksum(data)
      if (meta.checksum !== computed) {
        errors.push(
          `Backup integrity verification failed: Checksum mismatch. The file content may be corrupted or altered.`
        )
      }
    }
  }

  // 4. Secrets Security Check
  const rawJsonString = JSON.stringify(candidate)
  if (/moneymate_gemini_api_key|gemini_api_key|ai_api_key/i.test(rawJsonString)) {
    errors.push('Security violation: Backup contains sensitive API keys. Import rejected to protect user privacy.')
  }

  // Helper ID tracker to detect intra-collection duplicates
  function checkCollectionIds(items: unknown[] | undefined, collectionName: string): Set<string> {
    const idSet = new Set<string>()
    if (!Array.isArray(items)) {
      errors.push(`Invalid data payload: "${collectionName}" must be an array.`)
      return idSet
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || typeof item !== 'object') {
        errors.push(`Item #${i} in "${collectionName}" is not an object.`)
        continue
      }
      const id = (item as any).id
      if (!id || typeof id !== 'string' || id.trim() === '') {
        errors.push(`Item #${i} in "${collectionName}" is missing a valid non-empty string "id".`)
      } else if (idSet.has(id)) {
        errors.push(`Duplicate ID "${id}" detected in "${collectionName}".`)
      } else {
        idSet.add(id)
      }
    }
    return idSet
  }

  // 5. Transactions Collection Validation
  const txIdSet = checkCollectionIds(data.transactions, 'transactions')
  if (Array.isArray(data.transactions)) {
    for (const t of data.transactions) {
      if (!['income', 'expense', 'transfer', 'refund'].includes(t.type)) {
        errors.push(`Transaction "${t.id}" has invalid type "${t.type}".`)
      }

      // Strict integer-paise verification
      if (typeof t.amount !== 'number' || !Number.isInteger(t.amount) || t.amount < 0) {
        errors.push(
          `Transaction "${t.id}" has invalid amount "${t.amount}". Amount must be a non-negative integer in paise.`
        )
      }

      if (!t.date || typeof t.date !== 'string') {
        errors.push(`Transaction "${t.id}" has invalid or missing "date".`)
      }

      if (!['completed', 'pending', 'failed'].includes(t.status)) {
        errors.push(`Transaction "${t.id}" has invalid status "${t.status}".`)
      }
    }
  }

  // 6. Inventory Collection Validation
  const invIdSet = checkCollectionIds(data.inventory, 'inventory')
  if (Array.isArray(data.inventory)) {
    for (const item of data.inventory) {
      if (!item.name || typeof item.name !== 'string') {
        errors.push(`Inventory item "${item.id}" is missing a valid "name".`)
      }
      const stock = item.quantity !== undefined ? item.quantity : item.currentStock
      if (typeof stock !== 'number' || !Number.isFinite(stock) || stock < 0) {
        errors.push(`Inventory item "${item.id}" has invalid quantity/stock "${stock}". Must be >= 0.`)
      }
    }
  }

  // 7. Shopping List Collection Validation
  checkCollectionIds(data.shoppingList, 'shoppingList')
  if (Array.isArray(data.shoppingList)) {
    for (const s of data.shoppingList) {
      if (!s.productName || typeof s.productName !== 'string') {
        errors.push(`Shopping item "${s.id}" is missing a valid "productName".`)
      }
      const validStatuses = ['planned', 'purchased', 'skipped', 'cancelled', 'to_buy', 'bought']
      if (!validStatuses.includes(s.status)) {
        errors.push(`Shopping item "${s.id}" has invalid status "${s.status}".`)
      }
      if (s.inventoryItemId && !invIdSet.has(s.inventoryItemId)) {
        warnings.push(
          `Shopping item "${s.id}" references inventory item "${s.inventoryItemId}" which is not present in this backup.`
        )
      }
    }
  }

  // 8. Recurring Schedules Collection Validation
  const scheduleIdSet = checkCollectionIds(data.recurringSchedules, 'recurringSchedules')
  if (Array.isArray(data.recurringSchedules)) {
    for (const s of data.recurringSchedules) {
      if (!s.title || typeof s.title !== 'string') {
        errors.push(`Recurring schedule "${s.id}" is missing "title".`)
      }
      if (typeof s.amountPaise !== 'number' || !Number.isInteger(s.amountPaise) || s.amountPaise < 0) {
        errors.push(
          `Schedule "${s.id}" has invalid amountPaise "${s.amountPaise}". Must be non-negative integer paise.`
        )
      }
      if (!['one_time', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'].includes(s.frequency)) {
        errors.push(`Schedule "${s.id}" has invalid recurrence frequency "${s.frequency}".`)
      }
    }
  }

  // 9. Bill Instances Collection Validation
  checkCollectionIds(data.billInstances, 'billInstances')
  if (Array.isArray(data.billInstances)) {
    for (const b of data.billInstances) {
      if (!b.scheduleId || typeof b.scheduleId !== 'string') {
        errors.push(`Bill instance "${b.id}" is missing "scheduleId".`)
      } else if (!scheduleIdSet.has(b.scheduleId)) {
        warnings.push(`Bill instance "${b.id}" references schedule "${b.scheduleId}" not found in backup.`)
      }
      if (typeof b.amountPaise !== 'number' || !Number.isInteger(b.amountPaise) || b.amountPaise < 0) {
        errors.push(`Bill instance "${b.id}" has invalid amountPaise "${b.amountPaise}". Must be integer paise >= 0.`)
      }
      if (!['upcoming', 'due', 'overdue', 'paid', 'skipped', 'cancelled'].includes(b.status)) {
        errors.push(`Bill instance "${b.id}" has invalid status "${b.status}".`)
      }
      if (b.linkedTransactionId && !txIdSet.has(b.linkedTransactionId)) {
        warnings.push(
          `Bill instance "${b.id}" references linkedTransactionId "${b.linkedTransactionId}" not found in backup.`
        )
      }
    }
  }

  // 10. Planner Tasks Collection Validation
  checkCollectionIds(data.plannerTasks, 'plannerTasks')
  if (Array.isArray(data.plannerTasks)) {
    for (const t of data.plannerTasks) {
      if (!t.title || typeof t.title !== 'string') {
        errors.push(`Planner task "${t.id}" is missing "title".`)
      }
      if (!['pending', 'completed', 'cancelled'].includes(t.status)) {
        errors.push(`Planner task "${t.id}" has invalid status "${t.status}".`)
      }
    }
  }

  // 11. Receipt Inventory Links Collection Validation
  checkCollectionIds(data.receiptLinks, 'receiptLinks')
  if (Array.isArray(data.receiptLinks)) {
    for (const l of data.receiptLinks) {
      if (!l.receiptId || typeof l.receiptId !== 'string') {
        errors.push(`Receipt link "${l.id}" has missing or invalid "receiptId".`)
      }
      if (l.inventoryItemId && !invIdSet.has(l.inventoryItemId)) {
        warnings.push(
          `Receipt link "${l.id}" references inventory item "${l.inventoryItemId}" which is absent in this backup.`
        )
      }
      if (Array.isArray(l.appliedItemIds)) {
        for (const itemId of l.appliedItemIds) {
          if (!invIdSet.has(itemId)) {
            warnings.push(
              `Receipt link "${l.id}" references inventory item "${itemId}" which is absent in this backup.`
            )
          }
        }
      }
    }
  }

  // 12. Dismissed Alerts Validation
  checkCollectionIds(data.dismissedAlerts, 'dismissedAlerts')

  // 13. Categories Validation (Optional for backward compatibility)
  if (data.categories !== undefined) {
    if (!Array.isArray(data.categories)) {
      errors.push('Collection "categories" must be an array.')
    } else {
      checkCollectionIds(data.categories, 'categories')
      for (const cat of data.categories) {
        if (!cat.name || typeof cat.name !== 'string') {
          errors.push(`Category "${cat.id}" has missing or invalid "name".`)
        }
        if (cat.type !== 'expense' && cat.type !== 'income') {
          errors.push(`Category "${cat.id}" has invalid type "${cat.type}". Must be "expense" or "income".`)
        }
      }
    }
  }

  const isValid = errors.length === 0

  return {
    isValid,
    errors,
    warnings,
    summary: isValid
      ? {
          schemaVersion: meta.schemaVersion,
          dataScope: meta.dataScope,
          exportedAt: meta.exportedAt,
          recordCounts: {
            transactions: data.transactions?.length || 0,
            inventory: data.inventory?.length || 0,
            shoppingList: data.shoppingList?.length || 0,
            receiptLinks: data.receiptLinks?.length || 0,
            recurringSchedules: data.recurringSchedules?.length || 0,
            billInstances: data.billInstances?.length || 0,
            plannerTasks: data.plannerTasks?.length || 0,
            dismissedAlerts: data.dismissedAlerts?.length || 0,
            categories: data.categories?.length || 0,
          },
        }
      : undefined,
  }
}
