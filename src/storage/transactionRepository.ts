import type { Transaction } from '../types/transaction'
import { openDatabase, STORE_NAME } from './db'

export interface ITransactionRepository {
  getAll(): Promise<Transaction[]>
  getById(id: string): Promise<Transaction | null>
  add(transaction: Transaction): Promise<void>
  update(transaction: Transaction): Promise<void>
  delete(id: string): Promise<void>
  clear(): Promise<void>
}

/**
 * IndexedDB-backed Transaction Repository for persistent browser storage.
 */
export class IndexedDBTransactionRepository implements ITransactionRepository {
  async getAll(): Promise<Transaction[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async getById(id: string): Promise<Transaction | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async add(transaction: Transaction): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.add(transaction)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async update(transaction: Transaction): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(transaction)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clear(): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

/**
 * In-memory Transaction Repository (useful for testing and environments where IndexedDB is disabled).
 */
export class InMemoryTransactionRepository implements ITransactionRepository {
  private items: Map<string, Transaction> = new Map()

  constructor(initialData?: Transaction[]) {
    if (initialData) {
      initialData.forEach(item => this.items.set(item.id, item))
    }
  }

  async getAll(): Promise<Transaction[]> {
    return Array.from(this.items.values())
  }

  async getById(id: string): Promise<Transaction | null> {
    return this.items.get(id) || null
  }

  async add(transaction: Transaction): Promise<void> {
    if (this.items.has(transaction.id)) {
      throw new Error(`Transaction with id ${transaction.id} already exists.`)
    }
    this.items.set(transaction.id, { ...transaction })
  }

  async update(transaction: Transaction): Promise<void> {
    if (!this.items.has(transaction.id)) {
      throw new Error(`Transaction with id ${transaction.id} not found.`)
    }
    this.items.set(transaction.id, { ...transaction })
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }

  async clear(): Promise<void> {
    this.items.clear()
  }
}

/**
 * Factory function returning the appropriate repository instance.
 */
export function createTransactionRepository(): ITransactionRepository {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return new IndexedDBTransactionRepository()
  }
  return new InMemoryTransactionRepository()
}
