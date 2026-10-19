import { useState, useEffect, useMemo, useCallback } from 'react'
import type {
  InventoryItem,
  InventoryFilter,
  InventorySummary,
  StockAdjustmentInput,
} from '../types/inventory'
import {
  IndexedDBInventoryRepository,
  InMemoryInventoryRepository,
  type IInventoryRepository,
  filterInventoryItems,
} from '../storage/inventoryRepository'
import { calculateInventorySummary } from '../utils/inventoryCalculations'
import { DEMO_INVENTORY_ITEMS } from '../utils/demoInventory'

// Try creating IndexedDB repo, fallback to InMemory if unavailable
let repoInstance: IInventoryRepository
let isDbPersistent = true

try {
  repoInstance = new IndexedDBInventoryRepository()
} catch {
  repoInstance = new InMemoryInventoryRepository()
  isDbPersistent = false
}

export function useInventory() {
  const [realItems, setRealItems] = useState<InventoryItem[]>([])
  const [isDemoMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('moneymate_is_demo_mode')
      return saved !== null ? saved === 'true' : false
    }
    return false
  })
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)

  const [filter, setFilter] = useState<InventoryFilter>({
    search: '',
    category: 'all',
    status: 'all',
    sortBy: 'updated-desc',
    includeArchived: false,
  })

  // Load items from repository
  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await repoInstance.getAll()
      setRealItems(data)
      if (!isDbPersistent || !repoInstance.isStoragePersistent()) {
        setStorageWarning('IndexedDB is unavailable. Items are held in temporary memory and will not survive a reload.')
      }
    } catch (err) {
      console.error('Failed to load inventory from IndexedDB:', err)
      // Fallback to in-memory repository
      repoInstance = new InMemoryInventoryRepository()
      isDbPersistent = false
      setStorageWarning('IndexedDB storage failed. Changes will NOT survive browser reload.')
      setRealItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  // Active items based on demo/live mode
  const currentItems = useMemo(() => {
    return isDemoMode ? DEMO_INVENTORY_ITEMS : realItems
  }, [isDemoMode, realItems])

  // Summary statistics calculated deterministically
  const summary: InventorySummary = useMemo(() => {
    return calculateInventorySummary(currentItems)
  }, [currentItems])

  // Filtered & sorted view
  const filteredItems = useMemo(() => {
    return filterInventoryItems(currentItems, filter)
  }, [currentItems, filter])

  // CRUD actions
  const addItem = async (
    itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<InventoryItem> => {
    if (isDemoMode) {
      const demoNew: InventoryItem = {
        ...itemData,
        id: `demo_inv_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDemo: true,
      }
      setRealItems((prev) => [demoNew, ...prev])
      return demoNew
    }

    const created = await repoInstance.create(itemData)
    setRealItems((prev) => [created, ...prev])
    return created
  }

  const updateItem = async (
    id: string,
    updates: Partial<InventoryItem>
  ): Promise<InventoryItem> => {
    if (isDemoMode) {
      let updated: InventoryItem | null = null
      setRealItems((prev) =>
        prev.map((it) => {
          if (it.id === id) {
            updated = { ...it, ...updates, updatedAt: new Date().toISOString() }
            return updated
          }
          return it
        })
      )
      if (!updated) throw new Error('Item not found')
      return updated
    }

    const updated = await repoInstance.update(id, updates)
    setRealItems((prev) => prev.map((it) => (it.id === id ? updated : it)))
    return updated
  }

  const adjustStock = async (
    id: string,
    adjustment: StockAdjustmentInput
  ): Promise<InventoryItem> => {
    if (isDemoMode) {
      const target = currentItems.find((it) => it.id === id)
      if (!target) throw new Error('Item not found')
      // Validate
      const memRepo = new InMemoryInventoryRepository([target])
      const res = await memRepo.adjustStock(id, adjustment)
      setRealItems((prev) => prev.map((it) => (it.id === id ? res : it)))
      return res
    }

    const updated = await repoInstance.adjustStock(id, adjustment)
    setRealItems((prev) => prev.map((it) => (it.id === id ? updated : it)))
    return updated
  }

  const deleteItem = async (id: string): Promise<void> => {
    if (isDemoMode) {
      setRealItems((prev) => prev.filter((it) => it.id !== id))
      return
    }

    await repoInstance.delete(id)
    setRealItems((prev) => prev.filter((it) => it.id !== id))
  }

  const archiveItem = async (id: string, archived: boolean): Promise<InventoryItem> => {
    return updateItem(id, { archived })
  }

  return {
    items: currentItems,
    filteredItems,
    summary,
    filter,
    setFilter,
    loading,
    error,
    storageWarning,
    isPersistent: isDbPersistent,
    addItem,
    updateItem,
    adjustStock,
    deleteItem,
    archiveItem,
    reload: loadItems,
  }
}
