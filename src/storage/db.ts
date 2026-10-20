const DB_NAME = 'MoneyMateDB'
const DB_VERSION = 6

const STORES = {
  TRANSACTIONS: 'transactions',
  INVENTORY: 'inventory',
  SHOPPING_LIST: 'shopping_list',
  RECEIPT_LINKS: 'receipt_inventory_links',
  RECURRING_SCHEDULES: 'recurring_schedules',
  BILL_INSTANCES: 'bill_instances',
  PLANNER_TASKS: 'planner_tasks',
  DISMISSED_ALERTS: 'dismissed_alerts',
  CATEGORIES: 'categories',
  IMPORT_BATCHES: 'import_batches',
  ACCOUNT_MAPPINGS: 'account_mappings',
} as const

export const STORE_NAME = STORES.TRANSACTIONS
export const INVENTORY_STORE_NAME = STORES.INVENTORY
export const SHOPPING_STORE_NAME = STORES.SHOPPING_LIST
export const RECEIPT_LINKS_STORE_NAME = STORES.RECEIPT_LINKS
export const SCHEDULES_STORE_NAME = STORES.RECURRING_SCHEDULES
export const BILLS_STORE_NAME = STORES.BILL_INSTANCES
export const TASKS_STORE_NAME = STORES.PLANNER_TASKS
export const DISMISSED_ALERTS_STORE_NAME = STORES.DISMISSED_ALERTS
export const CATEGORIES_STORE_NAME = STORES.CATEGORIES
export const IMPORT_BATCHES_STORE_NAME = STORES.IMPORT_BATCHES
export const ACCOUNT_MAPPINGS_STORE_NAME = STORES.ACCOUNT_MAPPINGS

/**
 * Opens or initializes the MoneyMateDB IndexedDB database.
 * Safe migration: existing stores and transaction data are never destroyed or recreated.
 */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not available in this environment.'))
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // 1. Transactions store (Version 1)
      if (!db.objectStoreNames.contains(STORES.TRANSACTIONS)) {
        const store = db.createObjectStore(STORES.TRANSACTIONS, { keyPath: 'id' })
        store.createIndex('date', 'date', { unique: false })
        store.createIndex('type', 'type', { unique: false })
        store.createIndex('category', 'category', { unique: false })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('externalRef', 'externalRef', { unique: false })
      }

      // 2. Inventory store (Version 2)
      if (!db.objectStoreNames.contains(STORES.INVENTORY)) {
        const invStore = db.createObjectStore(STORES.INVENTORY, { keyPath: 'id' })
        invStore.createIndex('category', 'category', { unique: false })
        invStore.createIndex('name', 'name', { unique: false })
        invStore.createIndex('updatedAt', 'updatedAt', { unique: false })
        invStore.createIndex('isDemo', 'isDemo', { unique: false })
      }

      // 3. Shopping List store (Version 2)
      if (!db.objectStoreNames.contains(STORES.SHOPPING_LIST)) {
        const shopStore = db.createObjectStore(STORES.SHOPPING_LIST, { keyPath: 'id' })
        shopStore.createIndex('status', 'status', { unique: false })
        shopStore.createIndex('priority', 'priority', { unique: false })
        shopStore.createIndex('inventoryItemId', 'inventoryItemId', { unique: false })
        shopStore.createIndex('isDemo', 'isDemo', { unique: false })
      }

      // 4. Receipt to Inventory Links (Idempotency store) (Version 2)
      if (!db.objectStoreNames.contains(STORES.RECEIPT_LINKS)) {
        const linkStore = db.createObjectStore(STORES.RECEIPT_LINKS, { keyPath: 'id' })
        linkStore.createIndex('receiptId', 'receiptId', { unique: false })
      }

      // 5. Recurring Schedules store (Version 3)
      if (!db.objectStoreNames.contains(STORES.RECURRING_SCHEDULES)) {
        const schedStore = db.createObjectStore(STORES.RECURRING_SCHEDULES, { keyPath: 'id' })
        schedStore.createIndex('status', 'status', { unique: false })
        schedStore.createIndex('nextDueDate', 'nextDueDate', { unique: false })
        schedStore.createIndex('commitmentType', 'commitmentType', { unique: false })
        schedStore.createIndex('isDemo', 'isDemo', { unique: false })
      }

      // 6. Bill Instances store (Version 3)
      if (!db.objectStoreNames.contains(STORES.BILL_INSTANCES)) {
        const billStore = db.createObjectStore(STORES.BILL_INSTANCES, { keyPath: 'id' })
        billStore.createIndex('scheduleId', 'scheduleId', { unique: false })
        billStore.createIndex('dueDate', 'dueDate', { unique: false })
        billStore.createIndex('status', 'status', { unique: false })
        billStore.createIndex('isDemo', 'isDemo', { unique: false })
      }

      // 7. Planner Tasks store (Version 3)
      if (!db.objectStoreNames.contains(STORES.PLANNER_TASKS)) {
        const taskStore = db.createObjectStore(STORES.PLANNER_TASKS, { keyPath: 'id' })
        taskStore.createIndex('dueDate', 'dueDate', { unique: false })
        taskStore.createIndex('status', 'status', { unique: false })
        taskStore.createIndex('priority', 'priority', { unique: false })
        taskStore.createIndex('isDemo', 'isDemo', { unique: false })
      }

      // 8. Dismissed Alerts store (Version 3)
      if (!db.objectStoreNames.contains(STORES.DISMISSED_ALERTS)) {
        db.createObjectStore(STORES.DISMISSED_ALERTS, { keyPath: 'id' })
      }

      // 9. Categories store (Version 4)
      if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
        const catStore = db.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' })
        catStore.createIndex('type', 'type', { unique: false })
        catStore.createIndex('name', 'name', { unique: false })
        catStore.createIndex('isArchived', 'isArchived', { unique: false })
        catStore.createIndex('isDemo', 'isDemo', { unique: false })
      }

      // 10. Import Batches store (Version 5)
      if (!db.objectStoreNames.contains(STORES.IMPORT_BATCHES)) {
        const batchStore = db.createObjectStore(STORES.IMPORT_BATCHES, { keyPath: 'id' })
        batchStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: false })
        batchStore.createIndex('sourceAccountId', 'sourceAccountId', { unique: false })
        batchStore.createIndex('sourceProvider', 'sourceProvider', { unique: false })
        batchStore.createIndex('isDemo', 'isDemo', { unique: false })
        batchStore.createIndex('createdAt', 'createdAt', { unique: false })
      }

      // 11. Account Mappings store (Version 6)
      if (!db.objectStoreNames.contains(STORES.ACCOUNT_MAPPINGS)) {
        const mappingStore = db.createObjectStore(STORES.ACCOUNT_MAPPINGS, { keyPath: ['workspace', 'maskedAccountId'] })
        mappingStore.createIndex('workspace', 'workspace', { unique: false })
        mappingStore.createIndex('maskedAccountId', 'maskedAccountId', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'))
  })
}
