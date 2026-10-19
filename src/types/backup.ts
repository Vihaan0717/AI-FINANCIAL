import type { Transaction } from './transaction'
import type { InventoryItem } from './inventory'
import type { ShoppingListItem } from './shopping'
import type { ReceiptInventoryLink } from './receipt'
import type { RecurringSchedule, BillInstance, PlannerTask } from './planner'
import type { Category } from './category'

export const CURRENT_BACKUP_SCHEMA_VERSION = 1
export const BACKUP_APP_VERSION = '0.7.0'

export type BackupDataScope = 'live' | 'demo'

export interface BackupRecordCounts {
  transactions: number
  inventory: number
  shoppingList: number
  receiptLinks: number
  recurringSchedules: number
  billInstances: number
  plannerTasks: number
  dismissedAlerts: number
  categories?: number
}

export interface BackupMetadata {
  schemaVersion: number
  appVersion: string
  exportedAt: string
  dataScope: BackupDataScope
  checksum: string
  recordCounts: BackupRecordCounts
}

export interface DismissedAlertRecord {
  id: string
  dismissedAt: string
}

export interface BackupDataPayload {
  transactions: Transaction[]
  inventory: InventoryItem[]
  shoppingList: ShoppingListItem[]
  receiptLinks: ReceiptInventoryLink[]
  recurringSchedules: RecurringSchedule[]
  billInstances: BillInstance[]
  plannerTasks: PlannerTask[]
  dismissedAlerts: DismissedAlertRecord[]
  categories?: Category[]
  preferences?: Record<string, unknown>
}

export interface MoneyMateBackup {
  metadata: BackupMetadata
  data: BackupDataPayload
}

export interface BackupValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  summary?: {
    schemaVersion: number
    dataScope: BackupDataScope
    exportedAt: string
    recordCounts: BackupRecordCounts
  }
}

export type RestoreMode = 'merge' | 'replace'

export interface RestoreResult {
  success: boolean
  mode: RestoreMode
  targetScope: BackupDataScope
  recordsRestored: BackupRecordCounts
  recordsProcessed: number
  errors: string[]
}
