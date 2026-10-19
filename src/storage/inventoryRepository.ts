import type {
  InventoryItem,
  InventoryFilter,
  StockAdjustmentInput,
} from '../types/inventory'
import { openDatabase, INVENTORY_STORE_NAME } from './db'
import { applyStockAdjustment, calculateStockStatus } from '../utils/inventoryCalculations'
import { areUnitsCompatible, convertUnitQuantity } from '../utils/units'

export interface IInventoryRepository {
  getAll(filter?: InventoryFilter): Promise<InventoryItem[]>
  getById(id: string): Promise<InventoryItem | null>
  create(item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<InventoryItem>
  update(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem>
  adjustStock(id: string, adjustment: StockAdjustmentInput): Promise<InventoryItem>
  delete(id: string): Promise<void>
  archive(id: string, archived: boolean): Promise<InventoryItem>
  isStoragePersistent(): boolean
}

/**
 * Filter helper for memory and IndexedDB queries
 */
export function filterInventoryItems(
  items: InventoryItem[],
  filter?: InventoryFilter
): InventoryItem[] {
  if (!filter) return items

  let result = [...items]

  // Filter archived unless explicitly included
  if (!filter.includeArchived) {
    result = result.filter((item) => !item.archived)
  }

  // Search filter (name, notes)
  if (filter.search && filter.search.trim()) {
    const q = filter.search.toLowerCase().trim()
    result = result.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.notes && item.notes.toLowerCase().includes(q))
    )
  }

  // Category filter
  if (filter.category && filter.category !== 'all') {
    result = result.filter((item) => item.category === filter.category)
  }

  // Status filter
  if (filter.status && filter.status !== 'all') {
    result = result.filter((item) => {
      const { status, isExpiringSoon } = calculateStockStatus(item)
      if (filter.status === 'expiring_soon') {
        return isExpiringSoon
      }
      return status === filter.status
    })
  }

  // Sort
  if (filter.sortBy) {
    switch (filter.sortBy) {
      case 'name-asc':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'name-desc':
        result.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'qty-asc':
        result.sort((a, b) => a.quantity - b.quantity)
        break
      case 'qty-desc':
        result.sort((a, b) => b.quantity - a.quantity)
        break
      case 'expiry-asc':
        result.sort((a, b) => {
          if (!a.expiryDate) return 1
          if (!b.expiryDate) return -1
          return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
        })
        break
      case 'updated-desc':
      default:
        result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        break
    }
  } else {
    // Default sort by updatedAt desc
    result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  return result
}

/**
 * In-Memory Inventory Repository (used for unit tests and fallback if IndexedDB is unavailable)
 */
export class InMemoryInventoryRepository implements IInventoryRepository {
  private items = new Map<string, InventoryItem>()

  constructor(initialItems: InventoryItem[] = []) {
    initialItems.forEach((item) => this.items.set(item.id, item))
  }

  isStoragePersistent(): boolean {
    return false
  }

  async getAll(filter?: InventoryFilter): Promise<InventoryItem[]> {
    return filterInventoryItems(Array.from(this.items.values()), filter)
  }

  async getById(id: string): Promise<InventoryItem | null> {
    return this.items.get(id) || null
  }

  async create(itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<InventoryItem> {
    if (!Number.isFinite(itemData.quantity) || itemData.quantity < 0) {
      throw new Error(`Inventory quantity must be a non-negative finite number. Received: ${itemData.quantity}`)
    }

    const now = new Date().toISOString()
    const newItem: InventoryItem = {
      ...itemData,
      id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
      updatedAt: now,
      archived: !!itemData.archived,
    }

    this.items.set(newItem.id, newItem)
    return newItem
  }

  async update(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem> {
    const existing = this.items.get(id)
    if (!existing) {
      throw new Error(`Inventory item not found: ${id}`)
    }

    if (updates.quantity !== undefined && (!Number.isFinite(updates.quantity) || updates.quantity < 0)) {
      throw new Error(`Quantity must be a non-negative finite number. Received: ${updates.quantity}`)
    }

    const updated: InventoryItem = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }

    this.items.set(id, updated)
    return updated
  }

  async adjustStock(id: string, adjustment: StockAdjustmentInput): Promise<InventoryItem> {
    const item = await this.getById(id)
    if (!item) {
      throw new Error(`Inventory item not found: ${id}`)
    }

    // Check unit compatibility
    if (!areUnitsCompatible(adjustment.unit, item.unit)) {
      throw new Error(`Cannot adjust stock: unit "${adjustment.unit}" is incompatible with item unit "${item.unit}".`)
    }

    // Convert adjustment amount to item's native unit if needed
    const normalizedAmount = convertUnitQuantity(adjustment.amount, adjustment.unit, item.unit)

    const result = applyStockAdjustment(item.quantity, {
      type: adjustment.type,
      amount: normalizedAmount,
    })

    if (result.error) {
      throw new Error(result.error)
    }

    return this.update(id, { quantity: result.newQuantity })
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }

  async archive(id: string, archived: boolean): Promise<InventoryItem> {
    return this.update(id, { archived })
  }
}

/**
 * IndexedDB-backed Inventory Repository
 */
export class IndexedDBInventoryRepository implements IInventoryRepository {
  isStoragePersistent(): boolean {
    return true
  }

  async getAll(filter?: InventoryFilter): Promise<InventoryItem[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INVENTORY_STORE_NAME, 'readonly')
      const store = tx.objectStore(INVENTORY_STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const items = (request.result || []) as InventoryItem[]
        resolve(filterInventoryItems(items, filter))
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getById(id: string): Promise<InventoryItem | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INVENTORY_STORE_NAME, 'readonly')
      const store = tx.objectStore(INVENTORY_STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async create(itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<InventoryItem> {
    if (!Number.isFinite(itemData.quantity) || itemData.quantity < 0) {
      throw new Error(`Inventory quantity must be a non-negative finite number. Received: ${itemData.quantity}`)
    }

    const now = new Date().toISOString()
    const newItem: InventoryItem = {
      ...itemData,
      id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
      updatedAt: now,
      archived: !!itemData.archived,
    }

    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INVENTORY_STORE_NAME, 'readwrite')
      const store = tx.objectStore(INVENTORY_STORE_NAME)
      const request = store.add(newItem)

      request.onsuccess = () => resolve(newItem)
      request.onerror = () => reject(request.error)
    })
  }

  async update(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem> {
    const existing = await this.getById(id)
    if (!existing) {
      throw new Error(`Inventory item not found: ${id}`)
    }

    if (updates.quantity !== undefined && (!Number.isFinite(updates.quantity) || updates.quantity < 0)) {
      throw new Error(`Quantity must be a non-negative finite number. Received: ${updates.quantity}`)
    }

    const updated: InventoryItem = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }

    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INVENTORY_STORE_NAME, 'readwrite')
      const store = tx.objectStore(INVENTORY_STORE_NAME)
      const request = store.put(updated)

      request.onsuccess = () => resolve(updated)
      request.onerror = () => reject(request.error)
    })
  }

  async adjustStock(id: string, adjustment: StockAdjustmentInput): Promise<InventoryItem> {
    const item = await this.getById(id)
    if (!item) {
      throw new Error(`Inventory item not found: ${id}`)
    }

    if (!areUnitsCompatible(adjustment.unit, item.unit)) {
      throw new Error(`Cannot adjust stock: unit "${adjustment.unit}" is incompatible with item unit "${item.unit}".`)
    }

    const normalizedAmount = convertUnitQuantity(adjustment.amount, adjustment.unit, item.unit)

    const result = applyStockAdjustment(item.quantity, {
      type: adjustment.type,
      amount: normalizedAmount,
    })

    if (result.error) {
      throw new Error(result.error)
    }

    return this.update(id, { quantity: result.newQuantity })
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INVENTORY_STORE_NAME, 'readwrite')
      const store = tx.objectStore(INVENTORY_STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async archive(id: string, archived: boolean): Promise<InventoryItem> {
    return this.update(id, { archived })
  }
}
