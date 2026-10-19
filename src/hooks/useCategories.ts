import { useState, useEffect, useCallback, useMemo } from 'react'
import type {
  Category,
  CategoryCreateInput,
  CategoryUpdateInput,
} from '../types/category'
import {
  createCategoryRepository,
  type ICategoryRepository,
} from '../storage/categoryRepository'
import { CategoryService } from '../services/categoryService'
import type { CategoryClassificationMap } from '../types/insights'

const repo: ICategoryRepository = createCategoryRepository()
const service = new CategoryService(repo)

export function useCategories(isDemoMode: boolean = false) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const list = await service.listCategories({ isDemo: isDemoMode, includeArchived: true })
      setCategories(list)
    } catch (err: any) {
      console.error('Failed to load categories:', err)
      setError(err.message || 'Could not load categories.')
    } finally {
      setLoading(false)
    }
  }, [isDemoMode])

  useEffect(() => {
    reload()
  }, [reload])

  const activeCategories = useMemo(
    () => categories.filter((c) => !c.isArchived),
    [categories]
  )

  const archivedCategories = useMemo(
    () => categories.filter((c) => c.isArchived),
    [categories]
  )

  const expenseCategories = useMemo(
    () => activeCategories.filter((c) => c.type === 'expense'),
    [activeCategories]
  )

  const incomeCategories = useMemo(
    () => activeCategories.filter((c) => c.type === 'income'),
    [activeCategories]
  )

  const classificationMap: CategoryClassificationMap = useMemo(
    () => CategoryService.buildClassificationMap(categories),
    [categories]
  )

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>()
    for (const cat of categories) {
      map.set(cat.name.toLowerCase(), cat)
      map.set(cat.id.toLowerCase(), cat)
    }
    return map
  }, [categories])

  const addCategory = useCallback(
    async (input: CategoryCreateInput): Promise<Category> => {
      const created = await service.createCategory({
        ...input,
        isDemo: isDemoMode,
      })
      await reload()
      return created
    },
    [isDemoMode, reload, service]
  )

  const updateCategory = useCallback(
    async (id: string, updates: CategoryUpdateInput): Promise<Category> => {
      const updated = await service.updateCategory(id, updates)
      await reload()
      return updated
    },
    [reload, service]
  )

  const renameCategory = useCallback(
    async (id: string, newName: string): Promise<Category> => {
      const renamed = await service.renameCategory(id, newName)
      await reload()
      return renamed
    },
    [reload, service]
  )

  const archiveCategory = useCallback(
    async (id: string): Promise<Category> => {
      const archived = await service.archiveCategory(id)
      await reload()
      return archived
    },
    [reload, service]
  )

  const restoreCategory = useCallback(
    async (id: string): Promise<Category> => {
      const restored = await service.restoreCategory(id)
      await reload()
      return restored
    },
    [reload, service]
  )

  const deleteCategory = useCallback(
    async (
      id: string,
      options?: { isCategoryInUse?: (catId: string, name: string) => Promise<boolean> | boolean }
    ): Promise<void> => {
      await service.deleteCategory(id, options as any)
      await reload()
    },
    [reload, service]
  )

  const resolveCategory = useCallback(
    (nameOrId: string): Category => {
      return CategoryService.resolveCategory(nameOrId, categories)
    },
    [categories]
  )

  return {
    categories,
    activeCategories,
    archivedCategories,
    expenseCategories,
    incomeCategories,
    categoryMap,
    classificationMap,
    loading,
    error,
    addCategory,
    createCategory: addCategory,
    updateCategory,
    renameCategory,
    archiveCategory,
    restoreCategory,
    deleteCategory,
    resolveCategory,
    reload,
  }
}
