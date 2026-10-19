import type { ShoppingListItem } from '../types/shopping'
import type { ReceiptInventoryLink } from '../types/receipt'
import { openDatabase, SHOPPING_STORE_NAME, RECEIPT_LINKS_STORE_NAME } from './db'

export interface IShoppingRepository {
  getAll(): Promise<ShoppingListItem[]>
  getById(id: string): Promise<ShoppingListItem | null>
  add(item: Omit<ShoppingListItem, 'id' | 'createdAt'>): Promise<ShoppingListItem>
  update(id: string, updates: Partial<ShoppingListItem>): Promise<ShoppingListItem>
  delete(id: string): Promise<void>
  hasReceiptInventoryUpdate(receiptId: string): Promise<boolean>
  recordReceiptInventoryUpdate(link: ReceiptInventoryLink): Promise<void>
  isStoragePersistent(): boolean
}

export class InMemoryShoppingRepository implements IShoppingRepository {
  private items = new Map<string, ShoppingListItem>()
  private receiptLinks = new Map<string, ReceiptInventoryLink>()

  constructor(initialItems: ShoppingListItem[] = []) {
    initialItems.forEach((item) => this.items.set(item.id, item))
  }

  isStoragePersistent(): boolean {
    return false
  }

  async getAll(): Promise<ShoppingListItem[]> {
    return Array.from(this.items.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  async getById(id: string): Promise<ShoppingListItem | null> {
    return this.items.get(id) || null
  }

  async add(itemData: Omit<ShoppingListItem, 'id' | 'createdAt'>): Promise<ShoppingListItem> {
    const now = new Date().toISOString()
    const newItem: ShoppingListItem = {
      ...itemData,
      id: `shop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
    }
    this.items.set(newItem.id, newItem)
    return newItem
  }

  async update(id: string, updates: Partial<ShoppingListItem>): Promise<ShoppingListItem> {
    const existing = this.items.get(id)
    if (!existing) {
      throw new Error(`Shopping list item not found: ${id}`)
    }
    const updated: ShoppingListItem = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.items.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }

  async hasReceiptInventoryUpdate(receiptId: string): Promise<boolean> {
    return this.receiptLinks.has(receiptId)
  }

  async recordReceiptInventoryUpdate(link: ReceiptInventoryLink): Promise<void> {
    this.receiptLinks.set(link.receiptId, link)
  }
}

export class IndexedDBShoppingRepository implements IShoppingRepository {
  isStoragePersistent(): boolean {
    return true
  }

  async getAll(): Promise<ShoppingListItem[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHOPPING_STORE_NAME, 'readonly')
      const store = tx.objectStore(SHOPPING_STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const items = (request.result || []) as ShoppingListItem[]
        items.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        resolve(items)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getById(id: string): Promise<ShoppingListItem | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHOPPING_STORE_NAME, 'readonly')
      const store = tx.objectStore(SHOPPING_STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async add(itemData: Omit<ShoppingListItem, 'id' | 'createdAt'>): Promise<ShoppingListItem> {
    const now = new Date().toISOString()
    const newItem: ShoppingListItem = {
      ...itemData,
      id: `shop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
    }

    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHOPPING_STORE_NAME, 'readwrite')
      const store = tx.objectStore(SHOPPING_STORE_NAME)
      const request = store.add(newItem)

      request.onsuccess = () => resolve(newItem)
      request.onerror = () => reject(request.error)
    })
  }

  async update(id: string, updates: Partial<ShoppingListItem>): Promise<ShoppingListItem> {
    const existing = await this.getById(id)
    if (!existing) {
      throw new Error(`Shopping list item not found: ${id}`)
    }

    const updated: ShoppingListItem = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }

    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHOPPING_STORE_NAME, 'readwrite')
      const store = tx.objectStore(SHOPPING_STORE_NAME)
      const request = store.put(updated)

      request.onsuccess = () => resolve(updated)
      request.onerror = () => reject(request.error)
    })
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHOPPING_STORE_NAME, 'readwrite')
      const store = tx.objectStore(SHOPPING_STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async hasReceiptInventoryUpdate(receiptId: string): Promise<boolean> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECEIPT_LINKS_STORE_NAME, 'readonly')
      const store = tx.objectStore(RECEIPT_LINKS_STORE_NAME)
      const index = store.index('receiptId')
      const request = index.get(receiptId)

      request.onsuccess = () => resolve(!!request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async recordReceiptInventoryUpdate(link: ReceiptInventoryLink): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECEIPT_LINKS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(RECEIPT_LINKS_STORE_NAME)
      const request = store.put(link)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
