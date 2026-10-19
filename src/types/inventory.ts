export type InventoryCategory =
  | 'Clothing'
  | 'Household essentials'
  | 'Food and pantry'
  | 'Personal care and other essentials'

export type InventoryUnit =
  | 'pcs'
  | 'bars'
  | 'bottles'
  | 'tubes'
  | 'packs'
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'

export type StockStatus = 'out_of_stock' | 'running_low' | 'in_stock'

export interface ExpectedConsumption {
  amount: number
  period: 'daily' | 'weekly'
}

export interface InventoryItem {
  id: string
  name: string
  category: InventoryCategory
  quantity: number // Finite, non-negative
  unit: InventoryUnit
  minThreshold?: number // Finite, non-negative threshold
  purchasePricePaise?: number // Integer paise
  lastPurchaseDate?: string // ISO 8601
  expiryDate?: string // ISO 8601
  expectedConsumptionRate?: ExpectedConsumption
  notes?: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  archived?: boolean
  linkedTransactionId?: string // Optional link to purchase transaction
  isDemo?: boolean // Ensure demo data never leaks into live data
}

export interface StockStatusResult {
  status: StockStatus
  isExpiringSoon: boolean
  daysUntilExpiry?: number
  label: string
}

export interface InventorySummary {
  totalItems: number // Total distinct items
  totalDistinctItems: number // Total distinct items (alias)
  totalPhysicalQuantity: number
  inStockCount: number
  lowStockCount: number
  outOfStockCount: number
  expiringSoonCount: number
  categoryCounts: Record<InventoryCategory, number>
}

export interface InventoryFilter {
  search?: string
  category?: InventoryCategory | 'all'
  status?: StockStatus | 'expiring_soon' | 'all'
  sortBy?: 'name-asc' | 'name-desc' | 'qty-asc' | 'qty-desc' | 'expiry-asc' | 'updated-desc'
  includeArchived?: boolean
}

export interface StockAdjustmentInput {
  type: 'set' | 'add' | 'subtract'
  amount: number
  unit: InventoryUnit
  reason?: string
}
