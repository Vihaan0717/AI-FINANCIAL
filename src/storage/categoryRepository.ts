import type { Category } from '../types/category'
import type { TransactionType } from '../types/transaction'
import { DEFAULT_CATEGORIES } from '../types/category'
import { openDatabase, CATEGORIES_STORE_NAME } from './db'

export interface CategoryFilter {
  isDemo?: boolean
  type?: TransactionType | 'all'
  includeArchived?: boolean
}

export interface ICategoryRepository {
  getAll(filter?: CategoryFilter): Promise<Category[]>
  getById(id: string): Promise<Category | null>
  save(category: Category): Promise<void>
  saveAll(categories: Category[]): Promise<void>
  delete(id: string): Promise<void>
  clear(isDemo?: boolean): Promise<void>
  ensureSeeded(isDemo?: boolean): Promise<Category[]>
}

/**
 * IndexedDB Category Repository.
 */
export class IndexedDBCategoryRepository implements ICategoryRepository {
  async ensureSeeded(isDemo?: boolean): Promise<Category[]> {
    const existing = await this.getAll({ isDemo, includeArchived: true })
    if (existing.length === 0) {
      const seeded = DEFAULT_CATEGORIES.map((cat) => ({
        ...cat,
        id: isDemo ? `demo-${cat.id}` : cat.id,
        isDemo: !!isDemo,
      }))
      await this.saveAll(seeded)
      return seeded
    }
    return existing
  }

  async getAll(filter?: CategoryFilter): Promise<Category[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CATEGORIES_STORE_NAME, 'readonly')
      const store = tx.objectStore(CATEGORIES_STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        let results: Category[] = request.result || []

        if (filter?.isDemo !== undefined) {
          results = results.filter((c) => !!c.isDemo === filter.isDemo)
        }
        if (filter?.type && filter.type !== 'all') {
          results = results.filter((c) => c.type === filter.type)
        }
        if (!filter?.includeArchived) {
          results = results.filter((c) => !c.isArchived)
        }

        resolve(results)
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getById(id: string): Promise<Category | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CATEGORIES_STORE_NAME, 'readonly')
      const store = tx.objectStore(CATEGORIES_STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async save(category: Category): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CATEGORIES_STORE_NAME, 'readwrite')
      const store = tx.objectStore(CATEGORIES_STORE_NAME)
      const request = store.put(category)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async saveAll(categories: Category[]): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CATEGORIES_STORE_NAME, 'readwrite')
      const store = tx.objectStore(CATEGORIES_STORE_NAME)

      for (const cat of categories) {
        store.put(cat)
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async delete(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CATEGORIES_STORE_NAME, 'readwrite')
      const store = tx.objectStore(CATEGORIES_STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async clear(isDemo?: boolean): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CATEGORIES_STORE_NAME, 'readwrite')
      const store = tx.objectStore(CATEGORIES_STORE_NAME)

      if (isDemo === undefined) {
        const req = store.clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      } else {
        const req = store.openCursor()
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
          if (cursor) {
            if (!!cursor.value.isDemo === isDemo) {
              cursor.delete()
            }
            cursor.continue()
          } else {
            resolve()
          }
        }
        req.onerror = () => reject(req.error)
      }
    })
  }
}

/**
 * In-memory Category Repository for testing and node environments.
 */
export class InMemoryCategoryRepository implements ICategoryRepository {
  private categories: Map<string, Category> = new Map()

  constructor(initialData?: Category[]) {
    if (initialData) {
      initialData.forEach((c) => this.categories.set(c.id, { ...c }))
    }
  }

  async ensureSeeded(isDemo?: boolean): Promise<Category[]> {
    const existing = await this.getAll({ isDemo, includeArchived: true })
    if (existing.length === 0) {
      const seeded = DEFAULT_CATEGORIES.map((c) => ({
        ...c,
        id: isDemo ? `demo-${c.id}` : c.id,
        isDemo: !!isDemo,
      }))
      await this.saveAll(seeded)
      return seeded
    }
    return existing
  }

  async getAll(filter?: CategoryFilter): Promise<Category[]> {
    let list = Array.from(this.categories.values())

    if (filter?.isDemo !== undefined) {
      list = list.filter((c) => !!c.isDemo === filter.isDemo)
    }
    if (filter?.type && filter.type !== 'all') {
      list = list.filter((c) => c.type === filter.type)
    }
    if (!filter?.includeArchived) {
      list = list.filter((c) => !c.isArchived)
    }

    return list.map((c) => ({ ...c }))
  }

  async getById(id: string): Promise<Category | null> {
    const found = this.categories.get(id)
    return found ? { ...found } : null
  }

  async save(category: Category): Promise<void> {
    this.categories.set(category.id, { ...category })
  }

  async saveAll(categories: Category[]): Promise<void> {
    for (const cat of categories) {
      this.categories.set(cat.id, { ...cat })
    }
  }

  async delete(id: string): Promise<void> {
    this.categories.delete(id)
  }

  async clear(isDemo?: boolean): Promise<void> {
    if (isDemo === undefined) {
      this.categories.clear()
    } else {
      for (const [id, c] of this.categories.entries()) {
        if (!!c.isDemo === isDemo) {
          this.categories.delete(id)
        }
      }
    }
  }
}

export function createCategoryRepository(): ICategoryRepository {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return new IndexedDBCategoryRepository()
  }
  return new InMemoryCategoryRepository()
}
