import { describe, it, expect, beforeEach } from 'vitest'
import { CategoryService } from '../src/services/categoryService'
import { InMemoryCategoryRepository } from '../src/storage/categoryRepository'
import type { Category, CategoryCreateInput } from '../src/types/category'
import type { Transaction } from '../src/types/transaction'
import { calculateFinancialSummary } from '../src/utils/calculations'
import {
  calculateNeedsVsWants,
  generateMonthlyReport,
} from '../src/utils/insightCalculations'
import {
  validateBackupPayload,
  computeBackupChecksum,
} from '../src/utils/backupValidation'
import type { BackupDataPayload, MoneyMateBackup } from '../src/types/backup'
import { CURRENT_BACKUP_SCHEMA_VERSION, BACKUP_APP_VERSION } from '../src/types/backup'

describe('Money Mate AI — Stage 7.2: Configurable Categories Test Suite', () => {
  let repo: InMemoryCategoryRepository
  let service: CategoryService

  beforeEach(async () => {
    repo = new InMemoryCategoryRepository()
    await repo.ensureSeeded(false)
    service = new CategoryService(repo)
  })

  describe('1. Category Creation & Validation', () => {
    it('creates a valid expense category with custom icon, color, and classification', async () => {
      const input: CategoryCreateInput = {
        name: 'Online Subscriptions',
        type: 'expense',
        icon: 'Tv',
        color: '#3b82f6',
        description: 'Netflix, Spotify, Cloud Storage',
        classification: 'wants',
        isDemo: false,
      }

      const created = await service.createCategory(input)

      expect(created.id).toBeDefined()
      expect(created.id.startsWith('cat-exp-')).toBe(true)
      expect(created.name).toBe('Online Subscriptions')
      expect(created.type).toBe('expense')
      expect(created.icon).toBe('Tv')
      expect(created.color).toBe('#3b82f6')
      expect(created.classification).toBe('wants')
      expect(created.isBuiltIn).toBe(false)
      expect(created.isArchived).toBe(false)
      expect(created.createdAt).toBeDefined()
      expect(created.updatedAt).toBeDefined()
    })

    it('creates a valid income category', async () => {
      const input: CategoryCreateInput = {
        name: 'Dividends & Stocks',
        type: 'income',
        icon: 'TrendingUp',
        color: '#10b981',
        description: 'Quarterly stock dividends',
        classification: 'savings_investments',
        isDemo: false,
      }

      const created = await service.createCategory(input)

      expect(created.id).toBeDefined()
      expect(created.name).toBe('Dividends & Stocks')
      expect(created.type).toBe('income')
      expect(created.classification).toBe('savings_investments')
    })

    it('rejects category creation with an empty name or whitespace-only name', async () => {
      await expect(
        service.createCategory({
          name: '   ',
          type: 'expense',
        })
      ).rejects.toThrow('Category name cannot be empty.')
    })

    it('rejects category names that exceed maximum length (40 chars)', async () => {
      await expect(
        service.createCategory({
          name: 'This category name is intentionally far too long for personal finance usage',
          type: 'expense',
        })
      ).rejects.toThrow('Category name must be 40 characters or fewer.')
    })

    it('rejects duplicate active category names of the same transaction type (case-insensitive & trimmed)', async () => {
      // Existing built-in expense: 'Food & dining'
      await expect(
        service.createCategory({
          name: '  food & dining  ',
          type: 'expense',
        })
      ).rejects.toThrow('An active expense category named "food & dining" already exists.')
    })

    it('allows identical category names across different transaction types', async () => {
      // Create 'Consulting' expense
      await service.createCategory({
        name: 'Consulting',
        type: 'expense',
      })

      // Create 'Consulting' income (should be allowed)
      const incomeCat = await service.createCategory({
        name: 'Consulting',
        type: 'income',
      })

      expect(incomeCat.name).toBe('Consulting')
      expect(incomeCat.type).toBe('income')
    })

    it('rejects invalid icon identifiers not in the allowlist', async () => {
      await expect(
        service.createCategory({
          name: 'Dangerous Script',
          type: 'expense',
          icon: '<script>alert(1)</script>',
        })
      ).rejects.toThrow('Invalid icon identifier')
    })

    it('rejects invalid color formats (must be valid 3 or 6 digit hex code)', async () => {
      await expect(
        service.createCategory({
          name: 'Bad Color',
          type: 'expense',
          color: 'blue; background: red',
        })
      ).rejects.toThrow('Invalid color')
    })
  })

  describe('2. Renaming, Archiving, and Deletion Lifecycle', () => {
    it('renames a category without altering its stable unique ID', async () => {
      const custom = await service.createCategory({
        name: 'Gym',
        type: 'expense',
        icon: 'Dumbbell',
      })

      const originalId = custom.id

      const renamed = await service.renameCategory(originalId, 'Fitness & Crossfit')

      expect(renamed.id).toBe(originalId)
      expect(renamed.name).toBe('Fitness & Crossfit')

      const fetched = await repo.getById(originalId)
      expect(fetched?.name).toBe('Fitness & Crossfit')
      expect(fetched?.id).toBe(originalId)
    })

    it('archives a category and excludes it from active categories while keeping record', async () => {
      const custom = await service.createCategory({
        name: 'Old Club',
        type: 'expense',
      })

      const archived = await service.archiveCategory(custom.id)
      expect(archived.isArchived).toBe(true)

      const activeList = await service.getActiveCategories('expense', false)
      expect(activeList.some((c) => c.id === custom.id)).toBe(false)

      const allList = await service.getAllCategories({ includeArchived: true, isDemo: false })
      expect(allList.some((c) => c.id === custom.id && c.isArchived)).toBe(true)
    })

    it('restores an archived category back to active status', async () => {
      const custom = await service.createCategory({
        name: 'Seasonal Pass',
        type: 'expense',
      })

      await service.archiveCategory(custom.id)
      const restored = await service.restoreCategory(custom.id)

      expect(restored.isArchived).toBe(false)

      const activeList = await service.getActiveCategories('expense', false)
      expect(activeList.some((c) => c.id === custom.id)).toBe(true)
    })

    it('prevents permanent deletion of built-in system categories', async () => {
      const builtIns = await repo.getAll({ includeArchived: true, isDemo: false })
      const builtIn = builtIns.find((c) => c.isBuiltIn)
      expect(builtIn).toBeDefined()

      await expect(
        service.deleteCategory(builtIn!.id)
      ).rejects.toThrow('Built-in category')
    })

    it('prevents deletion of a custom category if transactions are using it', async () => {
      const custom = await service.createCategory({
        name: 'Custom Project',
        type: 'expense',
      })

      // Mock transaction checker indicating the category is in use
      const isCategoryInUse = async (id: string, name: string) => {
        return id === custom.id || name === custom.name
      }

      await expect(
        service.deleteCategory(custom.id, { isCategoryInUse })
      ).rejects.toThrow('referenced by existing transactions')
    })

    it('successfully deletes an unused custom category', async () => {
      const custom = await service.createCategory({
        name: 'Unused Temporary',
        type: 'expense',
      })

      const isCategoryInUse = async () => false
      await service.deleteCategory(custom.id, { isCategoryInUse })

      const fetched = await repo.getById(custom.id)
      expect(fetched).toBeNull()
    })
  })

  describe('3. Legacy and Unknown Category Resolution', () => {
    it('resolves category by ID', async () => {
      const cats = await repo.getAll({ includeArchived: true, isDemo: false })
      const first = cats[0]

      const resolved = CategoryService.resolveCategory(first.id, cats)
      expect(resolved.id).toBe(first.id)
      expect(resolved.name).toBe(first.name)
    })

    it('resolves category by name case-insensitively', async () => {
      const cats = await repo.getAll({ includeArchived: true, isDemo: false })
      const resolved = CategoryService.resolveCategory('FOOD & DINING', cats)

      expect(resolved.name).toBe('Food & dining')
    })

    it('falls back safely to default fallback when category is unknown', () => {
      const cats: Category[] = []
      const resolved = CategoryService.resolveCategory('NonExistentCrypticCategory', cats)

      expect(resolved.id.startsWith('cat-legacy-')).toBe(true)
      expect(resolved.name).toBe('NonExistentCrypticCategory')
      expect(resolved.classification).toBe('unclassified')
    })
  })

  describe('4. Demo vs Live Scope Isolation', () => {
    it('seeds and isolates demo categories from live categories', async () => {
      await repo.ensureSeeded(true) // Seed demo

      const liveCats = await repo.getAll({ isDemo: false, includeArchived: true })
      const demoCats = await repo.getAll({ isDemo: true, includeArchived: true })

      expect(liveCats.length).toBeGreaterThan(0)
      expect(demoCats.length).toBeGreaterThan(0)
      expect(liveCats.every((c) => !c.isDemo)).toBe(true)
      expect(demoCats.every((c) => c.isDemo)).toBe(true)

      // Add category only to Demo
      await service.createCategory({
        name: 'Demo Exclusive Expense',
        type: 'expense',
        isDemo: true,
      })

      const liveCheck = await repo.getAll({ isDemo: false, includeArchived: true })
      expect(liveCheck.some((c) => c.name === 'Demo Exclusive Expense')).toBe(false)

      const demoCheck = await repo.getAll({ isDemo: true, includeArchived: true })
      expect(demoCheck.some((c) => c.name === 'Demo Exclusive Expense')).toBe(true)
    })
  })

  describe('5. Historical Transactions & Financial Calculations Integrity', () => {
    it('preserves existing financial summary calculations using legacy category names', () => {
      const transactions: Transaction[] = [
        {
          id: 'tx-1',
          type: 'income',
          amount: 5000000, // ₹50,000
          currency: 'INR',
          date: '2026-10-01',
          description: 'Salary',
          category: 'Salary',
          paymentMethod: 'Bank transfer',
          status: 'completed',
          isDemo: false,
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
        {
          id: 'tx-2',
          type: 'expense',
          amount: 150000, // ₹1,500
          currency: 'INR',
          date: '2026-10-02',
          description: 'Groceries',
          category: 'Groceries',
          paymentMethod: 'UPI',
          status: 'completed',
          isDemo: false,
          createdAt: '2026-10-02T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
        },
      ]

      const summary = calculateFinancialSummary(transactions)
      expect(summary.totalConfirmedIncome).toBe(5000000)
      expect(summary.totalConfirmedExpenses).toBe(150000)
      expect(summary.netCashFlow).toBe(4850000)
    })

    it('dynamically respects custom needs/wants classification map without altering ledger amounts', async () => {
      const transactions: Transaction[] = [
        {
          id: 'tx-custom-cat',
          type: 'expense',
          amount: 200000, // ₹2,000
          currency: 'INR',
          date: '2026-10-10',
          description: 'Special Subscription',
          category: 'Special Subscription',
          paymentMethod: 'Card',
          status: 'completed',
          isDemo: false,
          createdAt: '2026-10-10T00:00:00Z',
          updatedAt: '2026-10-10T00:00:00Z',
        },
      ]

      // Initially classify as 'wants'
      const customCategory: Category = {
        id: 'cat-special',
        name: 'Special Subscription',
        type: 'expense',
        icon: 'Tv',
        color: '#3b82f6',
        classification: 'wants',
        isBuiltIn: false,
        isArchived: false,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      }

      let classMap = CategoryService.buildClassificationMap([customCategory])
      let breakdown = calculateNeedsVsWants(transactions, classMap)

      expect(breakdown.wantsPaise).toBe(200000)
      expect(breakdown.needsPaise).toBe(0)

      // Reclassify as 'needs'
      customCategory.classification = 'needs'
      classMap = CategoryService.buildClassificationMap([customCategory])
      breakdown = calculateNeedsVsWants(transactions, classMap)

      expect(breakdown.needsPaise).toBe(200000)
      expect(breakdown.wantsPaise).toBe(0)
      expect(breakdown.totalOperationalExpensesPaise).toBe(200000) // Ledger amount unchanged!
    })

    it('archived categories continue to be counted in historical monthly reports', async () => {
      const custom = await service.createCategory({
        name: 'Archived Tech Gadget',
        type: 'expense',
        classification: 'wants',
      })

      const transactions: Transaction[] = [
        {
          id: 'tx-archived-1',
          type: 'expense',
          amount: 350000, // ₹3,500
          currency: 'INR',
          date: '2026-10-05',
          description: 'Bought old gadget',
          category: 'Archived Tech Gadget',
          categoryId: custom.id,
          paymentMethod: 'UPI',
          status: 'completed',
          isDemo: false,
          createdAt: '2026-10-05T00:00:00Z',
          updatedAt: '2026-10-05T00:00:00Z',
        },
      ]

      // Archive the category
      await service.archiveCategory(custom.id)

      const report = generateMonthlyReport(transactions, [], 2026, 10)
      expect(report.netConfirmedExpensesPaise).toBe(350000)
      expect(report.categoryShifts.some((s) => s.category === 'Archived Tech Gadget')).toBe(true)
    })
  })

  describe('6. Backup & Restore Compatibility', () => {
    it('validates a backup payload containing categories', () => {
      const customCat: Category = {
        id: 'cat-custom-1',
        name: 'Art Supplies',
        type: 'expense',
        icon: 'Sparkles',
        color: '#ec4899',
        classification: 'wants',
        isBuiltIn: false,
        isArchived: false,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
        isDemo: false,
      }

      const payload: BackupDataPayload = {
        transactions: [],
        inventory: [],
        shoppingList: [],
        receiptLinks: [],
        recurringSchedules: [],
        billInstances: [],
        plannerTasks: [],
        dismissedAlerts: [],
        categories: [customCat],
      }

      const checksum = computeBackupChecksum(payload)
      const backup: MoneyMateBackup = {
        metadata: {
          schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
          appVersion: BACKUP_APP_VERSION,
          exportedAt: '2026-10-20T00:00:00Z',
          dataScope: 'live',
          checksum,
          recordCounts: {
            transactions: 0,
            inventory: 0,
            shoppingList: 0,
            receiptLinks: 0,
            recurringSchedules: 0,
            billInstances: 0,
            plannerTasks: 0,
            dismissedAlerts: 0,
            categories: 1,
          },
        },
        data: payload,
      }

      const validation = validateBackupPayload(backup)
      expect(validation.isValid).toBe(true)
      expect(validation.summary?.recordCounts.categories).toBe(1)
    })

    it('rejects backup if category record is malformed (missing id or name)', () => {
      const invalidCat = {
        id: '',
        name: '',
      } as any

      const payload: BackupDataPayload = {
        transactions: [],
        inventory: [],
        shoppingList: [],
        receiptLinks: [],
        recurringSchedules: [],
        billInstances: [],
        plannerTasks: [],
        dismissedAlerts: [],
        categories: [invalidCat],
      }

      const checksum = computeBackupChecksum(payload)
      const backup: MoneyMateBackup = {
        metadata: {
          schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
          appVersion: BACKUP_APP_VERSION,
          exportedAt: '2026-10-20T00:00:00Z',
          dataScope: 'live',
          checksum,
          recordCounts: {
            transactions: 0,
            inventory: 0,
            shoppingList: 0,
            receiptLinks: 0,
            recurringSchedules: 0,
            billInstances: 0,
            plannerTasks: 0,
            dismissedAlerts: 0,
            categories: 1,
          },
        },
        data: payload,
      }

      const validation = validateBackupPayload(backup)
      expect(validation.isValid).toBe(false)
      expect(validation.errors.some((e) => e.includes('categories'))).toBe(true)
    })
  })
})
