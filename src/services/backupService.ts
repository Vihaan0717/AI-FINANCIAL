import type {
  MoneyMateBackup,
  BackupDataScope,
  RestoreMode,
  RestoreResult,
  BackupRecordCounts,
  BackupDataPayload,
} from '../types/backup'
import {
  CURRENT_BACKUP_SCHEMA_VERSION,
  BACKUP_APP_VERSION,
} from '../types/backup'
import type { Transaction } from '../types/transaction'
import type { InventoryItem } from '../types/inventory'
import type { ShoppingListItem } from '../types/shopping'
import type { ReceiptInventoryLink } from '../types/receipt'
import type { RecurringSchedule, BillInstance, PlannerTask } from '../types/planner'
import type { Category } from '../types/category'
import {
  openDatabase,
  STORE_NAME,
  INVENTORY_STORE_NAME,
  SHOPPING_STORE_NAME,
  RECEIPT_LINKS_STORE_NAME,
  SCHEDULES_STORE_NAME,
  BILLS_STORE_NAME,
  TASKS_STORE_NAME,
  DISMISSED_ALERTS_STORE_NAME,
  CATEGORIES_STORE_NAME,
} from '../storage/db'
import { computeBackupChecksum, validateBackupPayload } from '../utils/backupValidation'

export interface ExportBackupOptions {
  dataScope: BackupDataScope
  customPreferences?: Record<string, unknown>
  db?: IDBDatabase
  mockStoreData?: Partial<BackupDataPayload>
}

export interface RestoreBackupOptions {
  mode: RestoreMode
  targetScope: BackupDataScope
  db?: IDBDatabase
  mockStoreData?: Partial<BackupDataPayload>
}

/**
 * Helper to fetch all records from an IndexedDB object store.
 */
function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error || new Error(`Error reading from ${storeName}`))
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * 1. Exports all records across all 8 application stores into a versioned MoneyMate backup.
 * Strips any sensitive credentials/keys and generates an integrity checksum.
 */
export async function exportBackup(options: ExportBackupOptions): Promise<MoneyMateBackup> {
  const { dataScope, customPreferences, db: injectedDb, mockStoreData } = options

  let payload: BackupDataPayload

  if (mockStoreData) {
    // In-memory data provided (e.g. for unit tests)
    payload = {
      transactions: (mockStoreData.transactions || []).filter((t) =>
        dataScope === 'demo' ? (t.source === 'demo' || t.isDemo) : (t.source !== 'demo' && !t.isDemo)
      ),
      inventory: (mockStoreData.inventory || []).filter((i) =>
        dataScope === 'demo' ? i.isDemo : !i.isDemo
      ),
      shoppingList: (mockStoreData.shoppingList || []).filter((s) =>
        dataScope === 'demo' ? s.isDemo : !s.isDemo
      ),
      receiptLinks: mockStoreData.receiptLinks || [],
      recurringSchedules: (mockStoreData.recurringSchedules || []).filter((s) =>
        dataScope === 'demo' ? s.isDemo : !s.isDemo
      ),
      billInstances: (mockStoreData.billInstances || []).filter((b) =>
        dataScope === 'demo' ? b.isDemo : !b.isDemo
      ),
      plannerTasks: (mockStoreData.plannerTasks || []).filter((t) =>
        dataScope === 'demo' ? t.isDemo : !t.isDemo
      ),
      dismissedAlerts: mockStoreData.dismissedAlerts || [],
      categories: (mockStoreData.categories || []).filter((c) =>
        dataScope === 'demo' ? c.isDemo : !c.isDemo
      ),
      preferences: customPreferences || {},
    }
  } else {
    // Real IndexedDB read
    const db = injectedDb || (await openDatabase())

    const [
      allTxs,
      allInv,
      allShop,
      allLinks,
      allSched,
      allBills,
      allTasks,
      allAlerts,
      allCategories,
    ] = await Promise.all([
      getAllFromStore<Transaction>(db, STORE_NAME),
      getAllFromStore<InventoryItem>(db, INVENTORY_STORE_NAME),
      getAllFromStore<ShoppingListItem>(db, SHOPPING_STORE_NAME),
      getAllFromStore<ReceiptInventoryLink>(db, RECEIPT_LINKS_STORE_NAME),
      getAllFromStore<RecurringSchedule>(db, SCHEDULES_STORE_NAME),
      getAllFromStore<BillInstance>(db, BILLS_STORE_NAME),
      getAllFromStore<PlannerTask>(db, TASKS_STORE_NAME),
      getAllFromStore<any>(db, DISMISSED_ALERTS_STORE_NAME),
      getAllFromStore<Category>(db, CATEGORIES_STORE_NAME),
    ])

    // Filter strictly by requested workspace scope
    payload = {
      transactions: allTxs.filter((t) =>
        dataScope === 'demo' ? (t.source === 'demo' || t.isDemo) : (t.source !== 'demo' && !t.isDemo)
      ),
      inventory: allInv.filter((i) => (dataScope === 'demo' ? i.isDemo : !i.isDemo)),
      shoppingList: allShop.filter((s) => (dataScope === 'demo' ? s.isDemo : !s.isDemo)),
      receiptLinks: allLinks,
      recurringSchedules: allSched.filter((s) => (dataScope === 'demo' ? s.isDemo : !s.isDemo)),
      billInstances: allBills.filter((b) => (dataScope === 'demo' ? b.isDemo : !b.isDemo)),
      plannerTasks: allTasks.filter((t) => (dataScope === 'demo' ? t.isDemo : !t.isDemo)),
      dismissedAlerts: allAlerts.map((a) => ({
        id: typeof a === 'string' ? a : a.id,
        dismissedAt: a.dismissedAt || new Date().toISOString(),
      })),
      categories: allCategories.filter((c) => (dataScope === 'demo' ? c.isDemo : !c.isDemo)),
      preferences: customPreferences || {},
    }
  }

  // Safety sanitization: ensure no API keys or credentials ever leak into the export
  if (payload.preferences) {
    delete (payload.preferences as any).geminiKey
    delete (payload.preferences as any).apiKey
    delete (payload.preferences as any).secret
    delete (payload.preferences as any).token
  }

  const recordCounts: BackupRecordCounts = {
    transactions: payload.transactions.length,
    inventory: payload.inventory.length,
    shoppingList: payload.shoppingList.length,
    receiptLinks: payload.receiptLinks.length,
    recurringSchedules: payload.recurringSchedules.length,
    billInstances: payload.billInstances.length,
    plannerTasks: payload.plannerTasks.length,
    dismissedAlerts: payload.dismissedAlerts.length,
    categories: payload.categories ? payload.categories.length : 0,
  }

  const checksum = computeBackupChecksum(payload)

  return {
    metadata: {
      schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
      appVersion: BACKUP_APP_VERSION,
      exportedAt: new Date().toISOString(),
      dataScope,
      checksum,
      recordCounts,
    },
    data: payload,
  }
}

/**
 * 2. Triggers client-side download of the versioned backup JSON.
 */
export function downloadBackupFile(backup: MoneyMateBackup, customFilename?: string): void {
  const jsonString = JSON.stringify(backup, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const dateStr = backup.metadata.exportedAt.slice(0, 10)
  const defaultFilename = `moneymate-backup-${backup.metadata.dataScope}-${dateStr}.json`
  const filename = customFilename || defaultFilename

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 3. Restores application records from a verified backup.
 * Supports both non-destructive Merge and clean Replace modes.
 * Strictly verifies schema, checksum, and Demo/Live workspace isolation before touching records.
 */
export async function restoreBackup(
  backupCandidate: unknown,
  options: RestoreBackupOptions
): Promise<RestoreResult> {
  const { mode, targetScope, db: injectedDb, mockStoreData } = options

  // Step 1: Pre-flight Validation
  const validation = validateBackupPayload(backupCandidate, { expectedScope: targetScope })
  if (!validation.isValid) {
    return {
      success: false,
      mode,
      targetScope,
      recordsRestored: {
        transactions: 0,
        inventory: 0,
        shoppingList: 0,
        receiptLinks: 0,
        recurringSchedules: 0,
        billInstances: 0,
        plannerTasks: 0,
        dismissedAlerts: 0,
      },
      recordsProcessed: 0,
      errors: validation.errors,
    }
  }

  const backup = backupCandidate as MoneyMateBackup
  const data = backup.data

  // If in-memory mock is provided (e.g. unit tests)
  if (mockStoreData) {
    return applyRestorationToMock(mockStoreData, data, mode, targetScope)
  }

  // Real IndexedDB execution
  const db = injectedDb || (await openDatabase())
  const storeNames = [
    STORE_NAME,
    INVENTORY_STORE_NAME,
    SHOPPING_STORE_NAME,
    RECEIPT_LINKS_STORE_NAME,
    SCHEDULES_STORE_NAME,
    BILLS_STORE_NAME,
    TASKS_STORE_NAME,
    DISMISSED_ALERTS_STORE_NAME,
    CATEGORIES_STORE_NAME,
  ]

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite')
    tx.onerror = () => reject(tx.error || new Error('Database transaction failed during restore.'))

    const recordsRestored: BackupRecordCounts = {
      transactions: 0,
      inventory: 0,
      shoppingList: 0,
      receiptLinks: 0,
      recurringSchedules: 0,
      billInstances: 0,
      plannerTasks: 0,
      dismissedAlerts: 0,
      categories: 0,
    }

    // A. Replace Mode: Clear target scope records
    if (mode === 'replace') {
      for (const name of storeNames) {
        const store = tx.objectStore(name)
        // If live, delete where !isDemo; if demo, delete where isDemo
        const req = store.openCursor()
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
          if (cursor) {
            const val = cursor.value
            const recordScope = val.isDemo ? 'demo' : 'live'
            if (recordScope === targetScope || name === RECEIPT_LINKS_STORE_NAME || name === DISMISSED_ALERTS_STORE_NAME) {
              cursor.delete()
            }
            cursor.continue()
          }
        }
      }
    }

    // B. Bulk Insert / Upsert into respective stores
    const txStore = tx.objectStore(STORE_NAME)
    for (const t of data.transactions) {
      const scopedT = { ...t, isDemo: targetScope === 'demo' }
      txStore.put(scopedT)
      recordsRestored.transactions++
    }

    const invStore = tx.objectStore(INVENTORY_STORE_NAME)
    for (const item of data.inventory) {
      const scopedInv = { ...item, isDemo: targetScope === 'demo' }
      invStore.put(scopedInv)
      recordsRestored.inventory++
    }

    const shopStore = tx.objectStore(SHOPPING_STORE_NAME)
    for (const s of data.shoppingList) {
      const scopedShop = { ...s, isDemo: targetScope === 'demo' }
      shopStore.put(scopedShop)
      recordsRestored.shoppingList++
    }

    const linkStore = tx.objectStore(RECEIPT_LINKS_STORE_NAME)
    for (const l of data.receiptLinks) {
      linkStore.put(l)
      recordsRestored.receiptLinks++
    }

    const schedStore = tx.objectStore(SCHEDULES_STORE_NAME)
    for (const s of data.recurringSchedules) {
      const scopedSched = { ...s, isDemo: targetScope === 'demo' }
      schedStore.put(scopedSched)
      recordsRestored.recurringSchedules++
    }

    const billStore = tx.objectStore(BILLS_STORE_NAME)
    for (const b of data.billInstances) {
      const scopedBill = { ...b, isDemo: targetScope === 'demo' }
      billStore.put(scopedBill)
      recordsRestored.billInstances++
    }

    const taskStore = tx.objectStore(TASKS_STORE_NAME)
    for (const t of data.plannerTasks) {
      const scopedTask = { ...t, isDemo: targetScope === 'demo' }
      taskStore.put(scopedTask)
      recordsRestored.plannerTasks++
    }

    const alertStore = tx.objectStore(DISMISSED_ALERTS_STORE_NAME)
    for (const a of data.dismissedAlerts) {
      alertStore.put(a)
      recordsRestored.dismissedAlerts++
    }

    if (data.categories && Array.isArray(data.categories)) {
      const catStore = tx.objectStore(CATEGORIES_STORE_NAME)
      for (const c of data.categories) {
        const scopedCat = { ...c, isDemo: targetScope === 'demo' }
        catStore.put(scopedCat)
        recordsRestored.categories = (recordsRestored.categories || 0) + 1
      }
    }

    tx.oncomplete = () => {
      const recordsProcessed = Object.values(recordsRestored).reduce((a, b) => a + b, 0)
      resolve({
        success: true,
        mode,
        targetScope,
        recordsRestored,
        recordsProcessed,
        errors: [],
      })
    }
  })
}

/**
 * Pure In-Memory restoration applier for fast unit testing.
 */
function applyRestorationToMock(
  mockStore: Partial<BackupDataPayload>,
  backupData: BackupDataPayload,
  mode: RestoreMode,
  targetScope: BackupDataScope
): RestoreResult {
  const recordsRestored: BackupRecordCounts = {
    transactions: 0,
    inventory: 0,
    shoppingList: 0,
    receiptLinks: 0,
    recurringSchedules: 0,
    billInstances: 0,
    plannerTasks: 0,
    dismissedAlerts: 0,
    categories: 0,
  }

  function applyCollection<T extends { id: string; isDemo?: boolean; updatedAt?: string }>(
    targetArray: T[] | undefined,
    incoming: T[],
    counterKey: keyof BackupRecordCounts
  ): T[] {
    let result: T[] = targetArray ? [...targetArray] : []

    if (mode === 'replace') {
      // Remove all records matching targetScope
      result = result.filter((item) => (targetScope === 'demo' ? !item.isDemo : item.isDemo))
    }

    const indexMap = new Map<string, number>()
    result.forEach((item, idx) => indexMap.set(item.id, idx))

    for (const item of incoming) {
      const scoped = { ...item, isDemo: targetScope === 'demo' }
      if (indexMap.has(scoped.id)) {
        if (mode === 'replace') {
          const idx = indexMap.get(scoped.id)!
          result[idx] = scoped
          recordsRestored[counterKey]++
        } else {
          // Merge mode: conflict resolution policy
          // Update only if incoming has newer updatedAt timestamp, otherwise preserve existing
          const idx = indexMap.get(scoped.id)!
          const existing = result[idx]
          if (scoped.updatedAt && existing.updatedAt && scoped.updatedAt > existing.updatedAt) {
            result[idx] = scoped
          }
          recordsRestored[counterKey]++
        }
      } else {
        result.push(scoped)
        indexMap.set(scoped.id, result.length - 1)
        recordsRestored[counterKey]++
      }
    }

    return result
  }

  mockStore.transactions = applyCollection(
    mockStore.transactions as any,
    backupData.transactions as any,
    'transactions'
  )
  mockStore.inventory = applyCollection(
    mockStore.inventory as any,
    backupData.inventory as any,
    'inventory'
  )
  mockStore.shoppingList = applyCollection(
    mockStore.shoppingList as any,
    backupData.shoppingList as any,
    'shoppingList'
  )
  mockStore.recurringSchedules = applyCollection(
    mockStore.recurringSchedules as any,
    backupData.recurringSchedules as any,
    'recurringSchedules'
  )
  mockStore.billInstances = applyCollection(
    mockStore.billInstances as any,
    backupData.billInstances as any,
    'billInstances'
  )
  mockStore.plannerTasks = applyCollection(
    mockStore.plannerTasks as any,
    backupData.plannerTasks as any,
    'plannerTasks'
  )
  if (backupData.categories) {
    mockStore.categories = applyCollection(
      mockStore.categories as any,
      backupData.categories as any,
      'categories'
    )
  }

  // Handle receipt links and alerts
  if (mode === 'replace') {
    mockStore.receiptLinks = [...backupData.receiptLinks]
    mockStore.dismissedAlerts = [...backupData.dismissedAlerts]
  } else {
    const existingLinks = new Set((mockStore.receiptLinks || []).map((l) => l.id))
    for (const l of backupData.receiptLinks) {
      if (!existingLinks.has(l.id)) {
        mockStore.receiptLinks = mockStore.receiptLinks || []
        mockStore.receiptLinks.push(l)
        existingLinks.add(l.id)
      }
    }
    const existingAlerts = new Set((mockStore.dismissedAlerts || []).map((a) => a.id))
    for (const a of backupData.dismissedAlerts) {
      if (!existingAlerts.has(a.id)) {
        mockStore.dismissedAlerts = mockStore.dismissedAlerts || []
        mockStore.dismissedAlerts.push(a)
        existingAlerts.add(a.id)
      }
    }
  }

  recordsRestored.receiptLinks = backupData.receiptLinks.length
  recordsRestored.dismissedAlerts = backupData.dismissedAlerts.length

  const recordsProcessed = Object.values(recordsRestored).reduce((a, b) => a + b, 0)

  return {
    success: true,
    mode,
    targetScope,
    recordsRestored,
    recordsProcessed,
    errors: [],
  }
}
