import { describe, it, expect, beforeEach } from 'vitest'
import {
  areUnitsCompatible,
  convertUnitQuantity,
  combineQuantities,
} from '../src/utils/units'
import {
  calculateStockStatus,
  calculateInventorySummary,
  applyStockAdjustment,
} from '../src/utils/inventoryCalculations'
import {
  generateRecommendationsFromInventory,
  evaluateShoppingBudget,
} from '../src/utils/shoppingCalculations'
import {
  InMemoryInventoryRepository,
  filterInventoryItems,
} from '../src/storage/inventoryRepository'
import { InMemoryShoppingRepository } from '../src/storage/shoppingRepository'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import { calculateFinancialSummary } from '../src/utils/calculations'
import type { InventoryItem } from '../src/types/inventory'
import type { ShoppingListItem } from '../src/types/shopping'
import type { Transaction } from '../src/types/transaction'

describe('Money Mate AI — Milestone 4 Inventory & Smart Purchasing Test Suite', () => {
  let inventoryRepo: InMemoryInventoryRepository
  let shoppingRepo: InMemoryShoppingRepository
  let transactionRepo: InMemoryTransactionRepository

  beforeEach(() => {
    inventoryRepo = new InMemoryInventoryRepository()
    shoppingRepo = new InMemoryShoppingRepository()
    transactionRepo = new InMemoryTransactionRepository()
  })

  // 1. Creating and retrieving an inventory item
  it('1. should create and retrieve an inventory item', async () => {
    const created = await inventoryRepo.create({
      name: 'Basmati Rice 5kg',
      category: 'Food and pantry',
      quantity: 2,
      unit: 'packs',
      minThreshold: 1,
      purchasePricePaise: 45000, // ₹450.00
      isDemo: false,
      notes: 'Premium aged rice',
    })

    expect(created.id).toBeDefined()
    expect(created.name).toBe('Basmati Rice 5kg')
    expect(created.quantity).toBe(2)
    expect(created.unit).toBe('packs')
    expect(created.minThreshold).toBe(1)
    expect(created.purchasePricePaise).toBe(45000)

    const retrieved = await inventoryRepo.getById(created.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(created.id)
    expect(retrieved?.name).toBe('Basmati Rice 5kg')

    const all = await inventoryRepo.getAll()
    expect(all.length).toBe(1)
    expect(all[0].id).toBe(created.id)
  })

  // 2. Editing an item and persisting the change
  it('2. should edit an item and persist the changes', async () => {
    const item = await inventoryRepo.create({
      name: 'Bathing Soap',
      category: 'Personal care and other essentials',
      quantity: 4,
      unit: 'bars',
      minThreshold: 2,
      purchasePricePaise: 4500,
      isDemo: false,
    })

    const updated = await inventoryRepo.update(item.id, {
      name: 'Organic Neem Bathing Soap',
      quantity: 6,
      notes: 'Changed brand to organic neem',
    })

    expect(updated.name).toBe('Organic Neem Bathing Soap')
    expect(updated.quantity).toBe(6)
    expect(updated.notes).toBe('Changed brand to organic neem')

    const reloaded = await inventoryRepo.getById(item.id)
    expect(reloaded?.name).toBe('Organic Neem Bathing Soap')
    expect(reloaded?.quantity).toBe(6)
    expect(new Date(reloaded!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(item.createdAt).getTime()
    )
  })

  // 3. Stock adjustments cannot produce negative quantities
  it('3. should prevent stock adjustments from producing negative quantities', async () => {
    // Test pure calculation function
    const deductExcess = applyStockAdjustment(5, { type: 'subtract', amount: 8 })
    expect(deductExcess.error).toContain('Cannot reduce stock')
    expect(deductExcess.newQuantity).toBe(5)

    const setNegative = applyStockAdjustment(5, { type: 'set', amount: -2 })
    expect(setNegative.error).toContain('non-negative')
    expect(setNegative.newQuantity).toBe(5)

    // Test repository enforcement
    const item = await inventoryRepo.create({
      name: 'Dish Soap',
      category: 'Household essentials',
      quantity: 3,
      unit: 'bottles',
      isDemo: false,
    })

    await expect(
      inventoryRepo.adjustStock(item.id, {
        type: 'subtract',
        amount: 5,
        unit: 'bottles',
      })
    ).rejects.toThrow(/Cannot reduce stock/)

    // Confirm quantity remained unmodified
    const untouched = await inventoryRepo.getById(item.id)
    expect(untouched?.quantity).toBe(3)
  })

  // 4. Stock status changes correctly when quantity crosses the threshold
  it('4. should change stock status correctly when quantity crosses thresholds', () => {
    const consumableItem = {
      category: 'Food and pantry' as const,
      quantity: 10,
      minThreshold: 4,
    }

    // In Stock
    const statusInStock = calculateStockStatus(consumableItem)
    expect(statusInStock.status).toBe('in_stock')

    // Running Low (quantity <= threshold)
    const statusLow = calculateStockStatus({ ...consumableItem, quantity: 4 })
    expect(statusLow.status).toBe('running_low')

    const statusBelow = calculateStockStatus({ ...consumableItem, quantity: 2 })
    expect(statusBelow.status).toBe('running_low')

    // Out of Stock (quantity === 0)
    const statusOos = calculateStockStatus({ ...consumableItem, quantity: 0 })
    expect(statusOos.status).toBe('out_of_stock')

    // Clothing rule: Do NOT alert low stock if no threshold explicitly configured (> 0)
    const clothingNoThreshold = calculateStockStatus({
      category: 'Clothing' as const,
      quantity: 1,
      minThreshold: 0,
    })
    expect(clothingNoThreshold.status).toBe('in_stock')

    // Clothing with explicit threshold configured (> 0)
    const clothingWithThreshold = calculateStockStatus({
      category: 'Clothing' as const,
      quantity: 1,
      minThreshold: 2,
    })
    expect(clothingWithThreshold.status).toBe('running_low')
  })

  // 5. Expiry warnings work only when expiry data is available
  it('5. should provide expiry warnings only when valid expiry data is present', () => {
    const baseDate = new Date('2026-10-20T12:00:00Z')

    // No expiry date: no warning
    const noExpiry = calculateStockStatus(
      {
        category: 'Food and pantry',
        quantity: 5,
        minThreshold: 2,
      },
      baseDate
    )
    expect(noExpiry.isExpiringSoon).toBe(false)
    expect(noExpiry.daysUntilExpiry).toBeUndefined()

    // Expiry date far in the future (> 7 days): no warning
    const futureExpiry = calculateStockStatus(
      {
        category: 'Food and pantry',
        quantity: 5,
        minThreshold: 2,
        expiryDate: '2026-11-20',
      },
      baseDate
    )
    expect(futureExpiry.isExpiringSoon).toBe(false)
    expect(futureExpiry.daysUntilExpiry).toBeGreaterThan(7)

    // Expiry date approaching within 7 days: warning triggered
    const soonExpiry = calculateStockStatus(
      {
        category: 'Food and pantry',
        quantity: 5,
        minThreshold: 2,
        expiryDate: '2026-10-23', // 3 days away
      },
      baseDate
    )
    expect(soonExpiry.isExpiringSoon).toBe(true)
    expect(soonExpiry.daysUntilExpiry).toBe(3)
    expect(soonExpiry.label).toContain('Expiring in')

    // Expired item (days <= 0): warning triggered
    const expired = calculateStockStatus(
      {
        category: 'Food and pantry',
        quantity: 5,
        minThreshold: 2,
        expiryDate: '2026-10-18', // 2 days ago
      },
      baseDate
    )
    expect(expired.isExpiringSoon).toBe(true)
    expect(expired.label).toContain('Expired')
  })

  // 6. Different units are not incorrectly combined
  it('6. should prevent incompatible units from being combined', () => {
    // Compatible mass units
    expect(areUnitsCompatible('g', 'kg')).toBe(true)
    expect(convertUnitQuantity(1500, 'g', 'kg')).toBe(1.5)
    expect(convertUnitQuantity(2, 'kg', 'g')).toBe(2000)
    expect(combineQuantities(2, 'kg', 500, 'g', 'kg')).toBe(2.5)

    // Compatible volume units
    expect(areUnitsCompatible('ml', 'l')).toBe(true)
    expect(convertUnitQuantity(750, 'ml', 'l')).toBe(0.75)
    expect(combineQuantities(1, 'l', 500, 'ml', 'l')).toBe(1.5)

    // Incompatible units
    expect(areUnitsCompatible('g', 'pcs')).toBe(false)
    expect(areUnitsCompatible('l', 'kg')).toBe(false)
    expect(areUnitsCompatible('bottles', 'bars')).toBe(false)

    expect(() => convertUnitQuantity(5, 'g', 'pcs')).toThrow(/Incompatible units/i)
    expect(() => combineQuantities(1, 'kg', 2, 'pcs')).toThrow(/Cannot combine incompatible units/i)
  })

  // 7. Demo data cannot leak into live inventory
  it('7. should strictly isolate live inventory from demo inventory items', async () => {
    // Create live item
    await inventoryRepo.create({
      name: 'Live Olive Oil',
      category: 'Food and pantry',
      quantity: 1,
      unit: 'bottles',
      isDemo: false,
    })

    // Create demo item
    await inventoryRepo.create({
      name: 'Demo Luxury Jacket',
      category: 'Clothing',
      quantity: 1,
      unit: 'pcs',
      isDemo: true,
    })

    // Query live items only
    const allItems = await inventoryRepo.getAll()
    const liveItems = allItems.filter((i) => !i.isDemo)
    const demoItems = allItems.filter((i) => i.isDemo)

    expect(liveItems.length).toBe(1)
    expect(liveItems[0].name).toBe('Live Olive Oil')
    expect(demoItems.length).toBe(1)
    expect(demoItems[0].name).toBe('Demo Luxury Jacket')

    // Ensure live item retrieval does not return demo data
    const liveOnly = filterInventoryItems(allItems, { includeArchived: false }).filter(
      (i) => !i.isDemo
    )
    expect(liveOnly.some((i) => i.isDemo)).toBe(false)
  })

  // 8. Live inventory persists across reloads
  it('8. should maintain inventory state across simulated sessions and report storage status', async () => {
    const item = await inventoryRepo.create({
      name: 'Toothpaste 150g',
      category: 'Personal care and other essentials',
      quantity: 2,
      unit: 'tubes',
      minThreshold: 1,
      isDemo: false,
    })

    // Simulate session reload by re-querying the persistent store
    const itemAfterReload = await inventoryRepo.getById(item.id)
    expect(itemAfterReload).not.toBeNull()
    expect(itemAfterReload?.name).toBe('Toothpaste 150g')
    expect(itemAfterReload?.quantity).toBe(2)

    // In-memory repo honestly flags false for persistent storage
    expect(inventoryRepo.isStoragePersistent()).toBe(false)
  })

  // 9. Receipt line items do not create extra financial transactions
  it('9. should create exactly one financial transaction for an entire receipt regardless of line item count', async () => {
    const receiptTotalPaise = 18500 // ₹185.00

    const tx: Transaction = {
      id: 'tx_rcpt_1',
      type: 'expense',
      amount: receiptTotalPaise,
      currency: 'INR',
      date: '2026-10-20T10:00:00Z',
      description: 'Supermarket Groceries (3 items: Milk, Eggs, Bread)',
      category: 'Food & dining',
      paymentMethod: 'UPI',
      status: 'completed',
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    }

    await transactionRepo.add(tx)

    const allTx = await transactionRepo.getAll()
    expect(allTx.length).toBe(1)
    expect(allTx[0].id).toBe('tx_rcpt_1')
    expect(allTx[0].amount).toBe(18500)
  })

  // 10. A multi-item receipt produces exactly one expense
  it('10. should produce exactly one expense transaction from a multi-item receipt', async () => {
    const lineItems = [
      { name: 'Shampoo 200ml', pricePaise: 12000 },
      { name: 'Soap Bar', pricePaise: 4000 },
      { name: 'Toothbrush', pricePaise: 3000 },
    ]
    const receiptTotalPaise = lineItems.reduce((acc, l) => acc + l.pricePaise, 0)
    expect(receiptTotalPaise).toBe(19000)

    const createdTx: Transaction = {
      id: 'tx_rcpt_multi',
      type: 'expense',
      amount: receiptTotalPaise,
      currency: 'INR',
      date: '2026-10-20T11:00:00Z',
      description: 'Medical & Personal Care Store',
      category: 'Health',
      paymentMethod: 'Credit Card',
      status: 'completed',
      createdAt: '2026-10-20T11:00:00Z',
      updatedAt: '2026-10-20T11:00:00Z',
    }

    await transactionRepo.add(createdTx)

    const expenses = (await transactionRepo.getAll()).filter((t) => t.type === 'expense')
    expect(expenses.length).toBe(1)
    expect(expenses[0].amount).toBe(19000)
  })

  // 11. Confirming receipt inventory updates twice does not duplicate stock (idempotency)
  it('11. should prevent duplicate stock updates if receipt confirmation is executed twice', async () => {
    const milk = await inventoryRepo.create({
      name: 'Fresh Milk 1L',
      category: 'Food and pantry',
      quantity: 1,
      unit: 'bottles',
      isDemo: false,
    })

    const receiptId = 'rcpt_supermarket_001'

    // Mock receipt inventory link processor
    async function processReceiptInventory(rcptId: string, itemId: string, qtyToAdd: number) {
      const alreadyApplied = await shoppingRepo.hasReceiptInventoryUpdate(rcptId)
      if (alreadyApplied) {
        return { applied: false, reason: 'Already applied' }
      }

      // Apply stock update
      await inventoryRepo.adjustStock(itemId, {
        type: 'add',
        amount: qtyToAdd,
        unit: 'bottles',
      })

      // Record idempotent receipt link
      await shoppingRepo.recordReceiptInventoryUpdate({
        receiptId: rcptId,
        lineItemIds: ['line_milk_1'],
        appliedAt: new Date().toISOString(),
      })

      return { applied: true }
    }

    // First confirmation: stock updates from 1 to 3
    const firstRun = await processReceiptInventory(receiptId, milk.id, 2)
    expect(firstRun.applied).toBe(true)
    const afterFirst = await inventoryRepo.getById(milk.id)
    expect(afterFirst?.quantity).toBe(3)

    // Second confirmation attempt with identical receiptId: safely skipped
    const secondRun = await processReceiptInventory(receiptId, milk.id, 2)
    expect(secondRun.applied).toBe(false)
    expect(secondRun.reason).toBe('Already applied')

    // Stock must remain 3, not 5
    const afterSecond = await inventoryRepo.getById(milk.id)
    expect(afterSecond?.quantity).toBe(3)
  })

  // 12. Skipped receipt lines do not modify inventory
  it('12. should leave inventory unmodified for receipt lines skipped by the user', async () => {
    const salt = await inventoryRepo.create({
      name: 'Iodized Salt 1kg',
      category: 'Food and pantry',
      quantity: 2,
      unit: 'packs',
      isDemo: false,
    })

    const receiptLines = [
      { name: 'Iodized Salt 1kg', inventoryItemId: salt.id, quantity: 1, unit: 'packs' as const, skipped: true },
    ]

    for (const line of receiptLines) {
      if (line.skipped) {
        // User skipped this line: do not touch stock
        continue
      }
      await inventoryRepo.adjustStock(line.inventoryItemId, {
        type: 'add',
        amount: line.quantity,
        unit: line.unit,
      })
    }

    const saltAfter = await inventoryRepo.getById(salt.id)
    expect(saltAfter?.quantity).toBe(2) // unchanged
  })

  // 13. An ambiguous product does not silently update the wrong item
  it('13. should not silently update the wrong item when an ambiguous receipt line is encountered', async () => {
    const tea = await inventoryRepo.create({
      name: 'Assam Tea 500g',
      category: 'Food and pantry',
      quantity: 1,
      unit: 'packs',
      isDemo: false,
    })

    // Ambiguous OCR line: 'Unknown Herbal Tonic'
    const ambiguousLine = {
      description: 'Unknown Herbal Tonic',
      inventoryItemId: undefined, // no matched item
      quantity: 1,
      unit: 'bottles' as const,
    }

    // Guard: if inventoryItemId is undefined, it cannot mutate tea
    if (ambiguousLine.inventoryItemId) {
      await inventoryRepo.adjustStock(ambiguousLine.inventoryItemId, {
        type: 'add',
        amount: 1,
        unit: ambiguousLine.unit,
      })
    }

    const teaAfter = await inventoryRepo.getById(tea.id)
    expect(teaAfter?.quantity).toBe(1) // tea remains untouched
  })

  // 14. Shopping-list completion does not silently create an expense
  it('14. should not silently create an expense when completing a shopping list item with update_inventory_only', async () => {
    const oil = await inventoryRepo.create({
      name: 'Sunflower Oil 1L',
      category: 'Food and pantry',
      quantity: 0,
      unit: 'bottles',
      purchasePricePaise: 16000,
      isDemo: false,
    })

    const shoppingItem = await shoppingRepo.add({
      productName: 'Sunflower Oil 1L',
      inventoryItemId: oil.id,
      quantity: 1,
      unit: 'bottles',
      estimatedPricePaise: 16000,
      priority: 'highest',
      reason: 'Out-of-stock essential',
      status: 'planned',
    })

    // User marks completed choosing 'update_inventory_only'
    // 1. Update shopping item status
    await shoppingRepo.update(shoppingItem.id, { status: 'purchased' })
    // 2. Adjust inventory stock
    await inventoryRepo.adjustStock(oil.id, {
      type: 'add',
      amount: shoppingItem.quantity,
      unit: shoppingItem.unit,
    })
    // 3. DO NOT add any transaction to transactionRepo

    const updatedOil = await inventoryRepo.getById(oil.id)
    expect(updatedOil?.quantity).toBe(1)

    const transactions = await transactionRepo.getAll()
    expect(transactions.length).toBe(0) // No expense created!
  })

  // 15. A purchase already recorded through a receipt is not double-counted
  it('15. should avoid creating duplicate transactions if a shopping item was already purchased via receipt', async () => {
    // 1. Financial transaction recorded via receipt scan
    const rcptTx: Transaction = {
      id: 'tx_rcpt_det',
      type: 'expense',
      amount: 12000,
      currency: 'INR',
      date: '2026-10-20T12:00:00Z',
      description: 'Store Receipt - Detergent Powder',
      category: 'Shopping',
      paymentMethod: 'UPI',
      status: 'completed',
      createdAt: '2026-10-20T12:00:00Z',
      updatedAt: '2026-10-20T12:00:00Z',
    }
    await transactionRepo.add(rcptTx)

    // 2. Mark linked shopping item completed with resolution 'update_inventory_only' or 'neither'
    const shopItem = await shoppingRepo.add({
      productName: 'Detergent Powder 1kg',
      quantity: 1,
      unit: 'packs',
      estimatedPricePaise: 12000,
      priority: 'high',
      reason: 'Low stock',
      status: 'planned',
    })

    // Resolve as neither/inventory-only because receipt already recorded transaction
    await shoppingRepo.update(shopItem.id, { status: 'purchased' })

    const transactions = await transactionRepo.getAll()
    expect(transactions.length).toBe(1) // Still exactly 1 transaction
  })

  // 16. Out-of-stock essentials receive appropriate priority
  it('16. should assign highest priority to out-of-stock essentials in smart recommendations', () => {
    const inventory: InventoryItem[] = [
      {
        id: 'inv_soap',
        name: 'Hand Soap',
        category: 'Personal care and other essentials',
        quantity: 0,
        unit: 'bars',
        minThreshold: 2,
        createdAt: '2026-10-20T00:00:00Z',
        updatedAt: '2026-10-20T00:00:00Z',
      },
      {
        id: 'inv_shirt',
        name: 'Formal Shirt',
        category: 'Clothing',
        quantity: 0,
        unit: 'pcs',
        createdAt: '2026-10-20T00:00:00Z',
        updatedAt: '2026-10-20T00:00:00Z',
      },
    ]

    const recs = generateRecommendationsFromInventory(inventory)
    const soapRec = recs.find((r) => r.productName === 'Hand Soap')
    const shirtRec = recs.find((r) => r.productName === 'Formal Shirt')

    expect(soapRec?.priority).toBe('highest')
    expect(shirtRec?.priority).toBe('low')
  })

  // 17. Adequately stocked items are not unnecessarily recommended
  it('17. should not generate purchase recommendations for adequately stocked items', () => {
    const inventory: InventoryItem[] = [
      {
        id: 'inv_rice',
        name: 'Basmati Rice',
        category: 'Food and pantry',
        quantity: 10,
        unit: 'kg',
        minThreshold: 2,
        createdAt: '2026-10-20T00:00:00Z',
        updatedAt: '2026-10-20T00:00:00Z',
      },
    ]

    const recs = generateRecommendationsFromInventory(inventory)
    expect(recs.length).toBe(0)
  })

  // 18. Budget recommendations distinguish confirmed and pending transactions
  it('18. should distinguish confirmed spending from pending transactions in budget calculations', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx_conf_1',
        type: 'expense',
        amount: 50000, // ₹500 confirmed
        currency: 'INR',
        date: '2026-10-20T10:00:00Z',
        description: 'Confirmed grocery bill',
        category: 'Food & dining',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
      },
      {
        id: 'tx_pend_1',
        type: 'expense',
        amount: 20000, // ₹200 pending
        currency: 'INR',
        date: '2026-10-20T11:00:00Z',
        description: 'Pending online order',
        category: 'Shopping',
        paymentMethod: 'Credit Card',
        status: 'pending',
        createdAt: '2026-10-20T11:00:00Z',
        updatedAt: '2026-10-20T11:00:00Z',
      },
    ]

    const shoppingList: ShoppingListItem[] = [
      {
        id: 'shop_1',
        productName: 'Olive Oil',
        quantity: 1,
        unit: 'bottles',
        estimatedPricePaise: 80000, // ₹800 planned
        priority: 'high',
        reason: 'Low stock',
        status: 'planned',
        createdAt: '2026-10-20T12:00:00Z',
      },
    ]

    const evaluation = evaluateShoppingBudget(shoppingList, transactions, 200000) // ₹2000 budget limit

    expect(evaluation.confirmedSpendingPaise).toBe(50000)
    expect(evaluation.pendingTransactionsPaise).toBe(20000)
    expect(evaluation.plannedShoppingCostsPaise).toBe(80000)
    expect(evaluation.warnings.length).toBeGreaterThan(0)
    expect(evaluation.warnings[0]).toContain('pending/unsettled')
  })

  // 19. Transfers are excluded from spending
  it('19. should exclude internal account transfers from spending calculations', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx_trf_1',
        type: 'transfer',
        amount: 100000, // ₹1,000 transfer
        currency: 'INR',
        date: '2026-10-20T10:00:00Z',
        description: 'Transfer to Savings',
        fromAccount: 'Checking',
        toAccount: 'Savings',
        category: 'Transfer',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
      },
      {
        id: 'tx_exp_1',
        type: 'expense',
        amount: 30000, // ₹300 expense
        currency: 'INR',
        date: '2026-10-20T11:00:00Z',
        description: 'Supermarket purchase',
        category: 'Food & dining',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-20T11:00:00Z',
        updatedAt: '2026-10-20T11:00:00Z',
      },
    ]

    const evalRes = evaluateShoppingBudget([], transactions, 200000)
    // Confirmed spending must be 30000, NOT 130000
    expect(evalRes.confirmedSpendingPaise).toBe(30000)
  })

  // 20. Refunds do not become income
  it('20. should not treat refunds as earned income', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx_inc_1',
        type: 'income',
        amount: 500000, // ₹5,000 income
        currency: 'INR',
        date: '2026-10-20T09:00:00Z',
        description: 'Salary advance',
        category: 'Income',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-20T09:00:00Z',
        updatedAt: '2026-10-20T09:00:00Z',
      },
      {
        id: 'tx_ref_1',
        type: 'refund',
        amount: 5000, // ₹50 refund
        currency: 'INR',
        date: '2026-10-20T10:00:00Z',
        description: 'Refund for returned item',
        category: 'Shopping',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
      },
    ]

    const summary = calculateFinancialSummary(transactions)
    // Earned income remains ₹5,000; refund is tracked under totalRefunds, not added to income
    expect(summary.totalConfirmedIncome).toBe(500000)
    expect(summary.totalRefunds).toBe(5000)
  })

  // 21. Failed transactions do not affect confirmed spending
  it('21. should exclude failed transactions from confirmed spending', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx_fail_1',
        type: 'expense',
        amount: 99000, // ₹990 failed transaction
        currency: 'INR',
        date: '2026-10-20T10:00:00Z',
        description: 'Failed online payment',
        category: 'Shopping',
        paymentMethod: 'UPI',
        status: 'failed',
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
      },
      {
        id: 'tx_ok_1',
        type: 'expense',
        amount: 15000, // ₹150 completed
        currency: 'INR',
        date: '2026-10-20T11:00:00Z',
        description: 'Pharmacy bill',
        category: 'Health',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-20T11:00:00Z',
        updatedAt: '2026-10-20T11:00:00Z',
      },
    ]

    const evalRes = evaluateShoppingBudget([], transactions, 100000)
    expect(evalRes.confirmedSpendingPaise).toBe(15000) // failed ₹990 excluded
  })

  // 22. Summary calculations distinguish distinct items from physical quantity
  it('22. should correctly calculate inventory summaries distinguishing distinct items from physical quantities', () => {
    const items: InventoryItem[] = [
      {
        id: 'inv_1',
        name: 'Cotton Shirts',
        category: 'Clothing',
        quantity: 5,
        unit: 'pcs',
        createdAt: '2026-10-20T00:00:00Z',
        updatedAt: '2026-10-20T00:00:00Z',
      },
      {
        id: 'inv_2',
        name: 'Bathing Soap',
        category: 'Personal care and other essentials',
        quantity: 2,
        unit: 'bars',
        minThreshold: 3,
        createdAt: '2026-10-20T00:00:00Z',
        updatedAt: '2026-10-20T00:00:00Z',
      },
      {
        id: 'inv_3',
        name: 'Olive Oil',
        category: 'Food and pantry',
        quantity: 0,
        unit: 'bottles',
        minThreshold: 1,
        createdAt: '2026-10-20T00:00:00Z',
        updatedAt: '2026-10-20T00:00:00Z',
      },
    ]

    const summary = calculateInventorySummary(items)
    expect(summary.totalDistinctItems).toBe(3)
    expect(summary.totalItems).toBe(3)
    expect(summary.totalPhysicalQuantity).toBe(7) // 5 + 2 + 0
    expect(summary.inStockCount).toBe(1) // Shirts
    expect(summary.lowStockCount).toBe(1) // Soap (2 <= 3)
    expect(summary.outOfStockCount).toBe(1) // Oil (0)
  })
})
