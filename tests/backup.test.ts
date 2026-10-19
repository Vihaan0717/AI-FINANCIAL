import { describe, it, expect } from 'vitest'
import type { MoneyMateBackup, BackupDataPayload } from '../src/types/backup'
import { CURRENT_BACKUP_SCHEMA_VERSION, BACKUP_APP_VERSION } from '../src/types/backup'
import {
  computeBackupChecksum,
  validateBackupPayload,
} from '../src/utils/backupValidation'
import { exportBackup, restoreBackup } from '../src/services/backupService'
import type { Transaction } from '../src/types/transaction'
import type { InventoryItem } from '../src/types/inventory'
import type { RecurringSchedule, BillInstance, PlannerTask } from '../src/types/planner'

describe('Money Mate AI — Milestone 7.6 Backup & Recovery Test Suite', () => {
  // Helper to create valid baseline dataset
  function createSamplePayload(): BackupDataPayload {
    const transactions: Transaction[] = [
      {
        id: 'tx-live-1',
        type: 'income',
        amount: 8500000, // ₹85,000.00
        currency: 'INR',
        date: '2026-10-01',
        description: 'Monthly Salary',
        category: 'Salary',
        paymentMethod: 'Bank Transfer',
        status: 'completed',
        isDemo: false,
        createdAt: '2026-10-01T09:00:00Z',
        updatedAt: '2026-10-01T09:00:00Z',
      },
      {
        id: 'tx-live-2',
        type: 'expense',
        amount: 450000, // ₹4,500.00
        currency: 'INR',
        date: '2026-10-05',
        description: 'Supermarket Groceries',
        category: 'Groceries',
        paymentMethod: 'UPI',
        status: 'completed',
        isDemo: false,
        createdAt: '2026-10-05T12:00:00Z',
        updatedAt: '2026-10-05T12:00:00Z',
      },
    ]

    const inventory: InventoryItem[] = [
      {
        id: 'inv-1',
        name: 'Basmati Rice 5kg',
        category: 'Groceries',
        currentStock: 2,
        minimumStock: 1,
        unit: 'packet',
        location: 'Kitchen Pantry',
        costPerUnitPaise: 45000,
        isDemo: false,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
      },
    ]

    const shoppingList = [
      {
        id: 'shop-1',
        productName: 'Olive Oil 1L',
        category: 'Groceries',
        quantity: 1,
        unit: 'bottle',
        priority: 'high' as const,
        status: 'to_buy' as const,
        inventoryItemId: 'inv-1',
        isDemo: false,
        createdAt: '2026-10-02T10:00:00Z',
        updatedAt: '2026-10-02T10:00:00Z',
      },
    ]

    const receiptLinks = [
      {
        id: 'link-1',
        receiptId: 'receipt-2026-10-05',
        inventoryItemId: 'inv-1',
        quantityAdded: 2,
        dateAdded: '2026-10-05T12:30:00Z',
      },
    ]

    const recurringSchedules: RecurringSchedule[] = [
      {
        id: 'sched-1',
        title: 'High-Speed Broadband',
        category: 'Utilities',
        amountPaise: 99900,
        commitmentType: 'expense',
        frequency: 'monthly',
        startDate: '2026-10-01',
        nextDueDate: '2026-11-01',
        preferredDayOfMonth: 1,
        notificationLeadDays: 3,
        status: 'active',
        isDemo: false,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
      },
    ]

    const billInstances: BillInstance[] = [
      {
        id: 'bill-1',
        scheduleId: 'sched-1',
        title: 'High-Speed Broadband - Oct',
        category: 'Utilities',
        amountPaise: 99900,
        commitmentType: 'expense',
        dueDate: '2026-10-01',
        status: 'paid',
        linkedTransactionId: 'tx-live-2',
        isDemo: false,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
      },
    ]

    const plannerTasks: PlannerTask[] = [
      {
        id: 'task-1',
        title: 'Submit Tax Invoices',
        category: 'Finance',
        taskType: 'todo',
        priority: 'high',
        dueDate: '2026-10-25',
        status: 'pending',
        isDemo: false,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
      },
    ]

    const dismissedAlerts = [
      { id: 'alert-bill-sched-1', dismissedAt: '2026-10-02T10:00:00Z' },
    ]

    return {
      transactions,
      inventory,
      shoppingList,
      receiptLinks,
      recurringSchedules,
      billInstances,
      plannerTasks,
      dismissedAlerts,
    }
  }

  // 1. Export populated database
  it('1. exports a populated database with schemaVersion, counts, and valid checksum', async () => {
    const sample = createSamplePayload()
    const backup = await exportBackup({
      dataScope: 'live',
      mockStoreData: sample,
    })

    expect(backup.metadata.schemaVersion).toBe(CURRENT_BACKUP_SCHEMA_VERSION)
    expect(backup.metadata.appVersion).toBe(BACKUP_APP_VERSION)
    expect(backup.metadata.dataScope).toBe('live')
    expect(backup.metadata.recordCounts.transactions).toBe(2)
    expect(backup.metadata.recordCounts.inventory).toBe(1)
    expect(backup.metadata.recordCounts.recurringSchedules).toBe(1)
    expect(backup.metadata.recordCounts.billInstances).toBe(1)
    expect(backup.metadata.checksum).toBe(computeBackupChecksum(backup.data))

    const validation = validateBackupPayload(backup, { expectedScope: 'live' })
    expect(validation.isValid).toBe(true)
    expect(validation.errors).toHaveLength(0)
  })

  // 2. Import into empty test database and compare records
  it('2. imports backup into empty database and restores all records', async () => {
    const sample = createSamplePayload()
    const backup = await exportBackup({
      dataScope: 'live',
      mockStoreData: sample,
    })

    const emptyStore: Partial<BackupDataPayload> = {
      transactions: [],
      inventory: [],
      shoppingList: [],
      receiptLinks: [],
      recurringSchedules: [],
      billInstances: [],
      plannerTasks: [],
      dismissedAlerts: [],
    }

    const res = await restoreBackup(backup, {
      mode: 'replace',
      targetScope: 'live',
      mockStoreData: emptyStore,
    })

    expect(res.success).toBe(true)
    expect(res.recordsRestored.transactions).toBe(2)
    expect(res.recordsRestored.inventory).toBe(1)
    expect(emptyStore.transactions).toHaveLength(2)
    expect(emptyStore.transactions![0].amount).toBe(8500000)
    expect(emptyStore.billInstances![0].linkedTransactionId).toBe('tx-live-2')
  })

  // 3. Merge idempotency: merging twice does not duplicate records
  it('3. merges the same backup twice without duplicating records', async () => {
    const sample = createSamplePayload()
    const backup = await exportBackup({
      dataScope: 'live',
      mockStoreData: sample,
    })

    const targetStore: Partial<BackupDataPayload> = {
      transactions: [],
      inventory: [],
      shoppingList: [],
      receiptLinks: [],
      recurringSchedules: [],
      billInstances: [],
      plannerTasks: [],
      dismissedAlerts: [],
    }

    // Merge 1st time
    await restoreBackup(backup, {
      mode: 'merge',
      targetScope: 'live',
      mockStoreData: targetStore,
    })
    expect(targetStore.transactions).toHaveLength(2)

    // Merge 2nd time
    await restoreBackup(backup, {
      mode: 'merge',
      targetScope: 'live',
      mockStoreData: targetStore,
    })
    expect(targetStore.transactions).toHaveLength(2)
    expect(targetStore.inventory).toHaveLength(1)
    expect(targetStore.billInstances).toHaveLength(1)
  })

  // 4. Reject malformed JSON without modifying existing records
  it('4. rejects malformed payload and preserves existing records intact', async () => {
    const targetStore: Partial<BackupDataPayload> = {
      transactions: [
        {
          id: 'existing-tx',
          type: 'expense',
          amount: 5000,
          currency: 'INR',
          date: '2026-10-10',
          description: 'Keep me',
          status: 'completed',
          createdAt: '',
          updatedAt: '',
        },
      ],
    }

    const malformedBackup = { invalid: true, metadata: null }
    const res = await restoreBackup(malformedBackup, {
      mode: 'replace',
      targetScope: 'live',
      mockStoreData: targetStore,
    })

    expect(res.success).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    // Original records preserved!
    expect(targetStore.transactions).toHaveLength(1)
    expect(targetStore.transactions![0].description).toBe('Keep me')
  })

  // 5. Reject unsupported schema versions
  it('5. rejects unsupported schema versions (e.g. version 99)', async () => {
    const sample = createSamplePayload()
    const backup = await exportBackup({
      dataScope: 'live',
      mockStoreData: sample,
    })
    const altered = {
      ...backup,
      metadata: { ...backup.metadata, schemaVersion: 99 },
    }

    const validation = validateBackupPayload(altered, { expectedScope: 'live' })
    expect(validation.isValid).toBe(false)
    expect(validation.errors.some((e) => e.includes('Unsupported backup schema version'))).toBe(true)
  })

  // 6. Reject duplicate record identifiers within the backup
  it('6. detects and rejects duplicate IDs within backup collections', () => {
    const sample = createSamplePayload()
    // Duplicate transaction id
    sample.transactions.push({
      ...sample.transactions[0],
      description: 'Accidental Duplicate ID',
    })

    const candidate: MoneyMateBackup = {
      metadata: {
        schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
        appVersion: BACKUP_APP_VERSION,
        exportedAt: new Date().toISOString(),
        dataScope: 'live',
        checksum: computeBackupChecksum(sample),
        recordCounts: {
          transactions: 3,
          inventory: 1,
          shoppingList: 1,
          receiptLinks: 1,
          recurringSchedules: 1,
          billInstances: 1,
          plannerTasks: 1,
          dismissedAlerts: 1,
        },
      },
      data: sample,
    }

    const validation = validateBackupPayload(candidate)
    expect(validation.isValid).toBe(false)
    expect(validation.errors.some((e) => e.includes('Duplicate ID'))).toBe(true)
  })

  // 7. Reject corrupt checksum
  it('7. rejects tampered payload with checksum mismatch', async () => {
    const sample = createSamplePayload()
    const backup = await exportBackup({
      dataScope: 'live',
      mockStoreData: sample,
    })

    // Alter data without updating checksum
    backup.data.transactions[0].amount = 999999999

    const validation = validateBackupPayload(backup)
    expect(validation.isValid).toBe(false)
    expect(validation.errors.some((e) => e.includes('Checksum mismatch'))).toBe(true)
  })

  // 8. Reject invalid monetary precision (floating-point or negative paise)
  it('8. strictly rejects floating-point or negative amounts', () => {
    const sample = createSamplePayload()
    // Float amount
    sample.transactions[0].amount = 499.99

    const candidate: MoneyMateBackup = {
      metadata: {
        schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
        appVersion: BACKUP_APP_VERSION,
        exportedAt: new Date().toISOString(),
        dataScope: 'live',
        checksum: computeBackupChecksum(sample),
        recordCounts: {
          transactions: 2,
          inventory: 1,
          shoppingList: 1,
          receiptLinks: 1,
          recurringSchedules: 1,
          billInstances: 1,
          plannerTasks: 1,
          dismissedAlerts: 1,
        },
      },
      data: sample,
    }

    const validation = validateBackupPayload(candidate)
    expect(validation.isValid).toBe(false)
    expect(validation.errors.some((e) => e.includes('Amount must be a non-negative integer in paise'))).toBe(true)
  })

  // 9. Demo and Live isolation
  it('9. strictly rejects attempts to restore Demo backup into Live workspace', async () => {
    const sample = createSamplePayload()
    const demoBackup = await exportBackup({
      dataScope: 'demo',
      mockStoreData: {
        ...sample,
        transactions: sample.transactions.map((t) => ({ ...t, isDemo: true })),
      },
    })

    const targetStore: Partial<BackupDataPayload> = { transactions: [] }
    const res = await restoreBackup(demoBackup, {
      mode: 'replace',
      targetScope: 'live', // Workspace mismatch!
      mockStoreData: targetStore,
    })

    expect(res.success).toBe(false)
    expect(res.errors.some((e) => e.includes('Workspace mismatch'))).toBe(true)
  })

  // 10. Secrets protection
  it('10. strips secrets and rejects backups containing sensitive credentials', () => {
    const sample = createSamplePayload()
    sample.preferences = {
      moneymate_gemini_api_key: 'AIzaSyFakeSecretKeyThatMustNeverBeExported',
    }

    const candidate: MoneyMateBackup = {
      metadata: {
        schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
        appVersion: BACKUP_APP_VERSION,
        exportedAt: new Date().toISOString(),
        dataScope: 'live',
        checksum: computeBackupChecksum(sample),
        recordCounts: {
          transactions: 2,
          inventory: 1,
          shoppingList: 1,
          receiptLinks: 1,
          recurringSchedules: 1,
          billInstances: 1,
          plannerTasks: 1,
          dismissedAlerts: 1,
        },
      },
      data: sample,
    }

    const validation = validateBackupPayload(candidate)
    expect(validation.isValid).toBe(false)
    expect(validation.errors.some((e) => e.includes('sensitive API keys'))).toBe(true)
  })

  // 11. Referential integrity: linkedTransactionId and receipt links
  it('11. verifies referential relationships between bills, transactions, and inventory', async () => {
    const sample = createSamplePayload()
    const backup = await exportBackup({
      dataScope: 'live',
      mockStoreData: sample,
    })

    const validation = validateBackupPayload(backup)
    expect(validation.isValid).toBe(true)
    // No broken reference warnings on valid payload
    expect(validation.warnings).toHaveLength(0)

    // Alter bill to point to non-existent transaction
    backup.data.billInstances[0].linkedTransactionId = 'tx-ghost-999'
    const tamperedValidation = validateBackupPayload(backup, { skipChecksumValidation: true })
    expect(tamperedValidation.warnings.some((w) => w.includes('tx-ghost-999'))).toBe(true)
  })
})
