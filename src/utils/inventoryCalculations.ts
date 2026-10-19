import type {
  InventoryItem,
  StockStatusResult,
  StockStatus,
  InventorySummary,
  InventoryCategory,
} from '../types/inventory'

/**
 * Calculates the stock status and expiry warning for an inventory item.
 * Strict rules:
 * - Quantities must be non-negative.
 * - Out of Stock: quantity === 0.
 * - Running Low:
 *    - For consumables ('Household essentials', 'Food and pantry', 'Personal care and other essentials'),
 *      triggered when minThreshold is defined and quantity <= minThreshold.
 *    - For 'Clothing', NEVER automatically alert low-stock unless user explicitly configured a minThreshold > 0.
 * - In Stock: quantity > (minThreshold ?? 0) or quantity > 0.
 * - Expiry warnings work ONLY when expiry date data is present. Never hallucinate or assume expiry.
 */
export function calculateStockStatus(
  item: Pick<InventoryItem, 'category' | 'quantity' | 'minThreshold' | 'expiryDate'>,
  now: Date = new Date()
): StockStatusResult {
  const qty = Math.max(0, Number(item.quantity) || 0)

  // 1. Determine base stock status
  let status: StockStatus = 'in_stock'

  if (qty === 0) {
    status = 'out_of_stock'
  } else if (item.minThreshold !== undefined && item.minThreshold > 0 && qty <= item.minThreshold) {
    // If category is Clothing, threshold must be explicitly > 0
    status = 'running_low'
  } else if (item.category !== 'Clothing' && item.minThreshold !== undefined && qty <= item.minThreshold) {
    status = 'running_low'
  }

  // 2. Determine expiry status (ONLY if expiryDate exists)
  let isExpiringSoon = false
  let daysUntilExpiry: number | undefined = undefined

  if (item.expiryDate && item.expiryDate.trim() !== '') {
    const exp = new Date(item.expiryDate)
    if (!isNaN(exp.getTime())) {
      const diffMs = exp.getTime() - now.getTime()
      daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      // Alert if expired (<= 0 days) or within 7 days
      if (daysUntilExpiry <= 7) {
        isExpiringSoon = true
      }
    }
  }

  let label = 'In Stock'
  if (status === 'out_of_stock') {
    label = 'Out of Stock'
  } else if (status === 'running_low') {
    label = 'Running Low'
  }

  if (isExpiringSoon && daysUntilExpiry !== undefined) {
    if (daysUntilExpiry <= 0) {
      label += ' · Expired'
    } else {
      label += ` · Expiring in ${daysUntilExpiry}d`
    }
  }

  return {
    status,
    isExpiringSoon,
    daysUntilExpiry,
    label,
  }
}

/**
 * Aggregates statistics across an inventory list.
 * Accurately distinguishes total distinct items from total physical quantity.
 */
export function calculateInventorySummary(
  items: InventoryItem[],
  now: Date = new Date()
): InventorySummary {
  const activeItems = items.filter((item) => !item.archived)

  let totalPhysicalQuantity = 0
  let inStockCount = 0
  let lowStockCount = 0
  let outOfStockCount = 0
  let expiringSoonCount = 0

  const categoryCounts: Record<InventoryCategory, number> = {
    'Clothing': 0,
    'Household essentials': 0,
    'Food and pantry': 0,
    'Personal care and other essentials': 0,
  }

  for (const item of activeItems) {
    totalPhysicalQuantity += Number(item.quantity) || 0
    if (categoryCounts[item.category] !== undefined) {
      categoryCounts[item.category]++
    }

    const res = calculateStockStatus(item, now)
    if (res.status === 'out_of_stock') {
      outOfStockCount++
    } else if (res.status === 'running_low') {
      lowStockCount++
    } else {
      inStockCount++
    }

    if (res.isExpiringSoon) {
      expiringSoonCount++
    }
  }

  return {
    totalItems: activeItems.length,
    totalDistinctItems: activeItems.length,
    totalPhysicalQuantity: Number(totalPhysicalQuantity.toFixed(2)),
    inStockCount,
    lowStockCount,
    outOfStockCount,
    expiringSoonCount,
    categoryCounts,
  }
}

/**
 * Validates and calculates stock adjustment.
 * Strictly prevents negative quantities.
 */
export function applyStockAdjustment(
  currentQuantity: number,
  adjustment: { type: 'set' | 'add' | 'subtract'; amount: number }
): { newQuantity: number; error?: string } {
  if (!Number.isFinite(adjustment.amount) || adjustment.amount < 0) {
    return { newQuantity: currentQuantity, error: 'Adjustment amount must be a finite, non-negative number.' }
  }

  let next = currentQuantity
  if (adjustment.type === 'set') {
    next = adjustment.amount
  } else if (adjustment.type === 'add') {
    next = currentQuantity + adjustment.amount
  } else if (adjustment.type === 'subtract') {
    if (currentQuantity < adjustment.amount) {
      return {
        newQuantity: currentQuantity,
        error: `Cannot reduce stock by ${adjustment.amount}: only ${currentQuantity} available. Stock cannot be negative.`,
      }
    }
    next = currentQuantity - adjustment.amount
  }

  if (next < 0) {
    return {
      newQuantity: currentQuantity,
      error: 'Stock quantity cannot be negative.',
    }
  }

  return { newQuantity: Number(next.toFixed(4)) }
}
