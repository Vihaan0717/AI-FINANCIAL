import type {
  Category,
  CategoryCreateInput,
  CategoryUpdateInput,
  CategoryClassification,
} from '../types/category'
import {
  ALLOWED_CATEGORY_ICONS,
  CURATED_CATEGORY_COLORS,
} from '../types/category'
import type { ICategoryRepository, CategoryFilter } from '../storage/categoryRepository'
import type { CategoryClassificationMap } from '../types/insights'
import { DEFAULT_CATEGORY_CLASSIFICATION } from '../utils/insightCalculations'

export const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/

export interface CategoryValidationError {
  field: string
  message: string
}

export class CategoryService {
  private repo: ICategoryRepository

  constructor(repo: ICategoryRepository) {
    this.repo = repo
  }

  /**
   * Normalizes a name for comparison (lowercased and whitespace collapsed).
   */
  static normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLowerCase()
  }

  /**
   * Validates color string format.
   */
  static isValidColor(color: string): boolean {
    return HEX_COLOR_REGEX.test(color)
  }

  /**
   * Validates if icon is present in the predefined safe icon allowlist.
   */
  static isValidIcon(icon: string): boolean {
    return (ALLOWED_CATEGORY_ICONS as readonly string[]).includes(icon)
  }

  /**
   * Retrieves categories based on filter, ensuring repository is seeded if empty.
   */
  async listCategories(filter?: CategoryFilter): Promise<Category[]> {
    await this.repo.ensureSeeded(filter?.isDemo)
    return this.repo.getAll(filter)
  }

  /**
   * Retrieves a single category by ID.
   */
  async getCategoryById(id: string): Promise<Category | null> {
    return this.repo.getById(id)
  }

  /**
   * Retrieves active (non-archived) categories for a given type and scope.
   */
  async getActiveCategories(type?: 'expense' | 'income' | 'all', isDemo?: boolean): Promise<Category[]> {
    return this.listCategories({ type, isDemo, includeArchived: false })
  }

  /**
   * Retrieves all categories matching the given filter.
   */
  async getAllCategories(filter?: CategoryFilter): Promise<Category[]> {
    return this.listCategories(filter)
  }

  /**
   * Creates a new user category with validation.
   */
  async createCategory(input: CategoryCreateInput): Promise<Category> {
    const trimmedName = input.name ? input.name.trim() : ''
    if (!trimmedName) {
      throw new Error('Category name cannot be empty.')
    }

    if (trimmedName.length > 40) {
      throw new Error('Category name must be 40 characters or fewer.')
    }

    const type = input.type || 'expense'
    if (type !== 'expense' && type !== 'income') {
      throw new Error('Category type must be either "expense" or "income".')
    }

    const icon = input.icon || (type === 'income' ? 'Coins' : 'ShoppingBag')
    if (!CategoryService.isValidIcon(icon)) {
      throw new Error(`Invalid icon identifier "${icon}". Must be an allowed Lucide icon.`)
    }

    const color = input.color || CURATED_CATEGORY_COLORS[0]
    if (!CategoryService.isValidColor(color)) {
      throw new Error(`Invalid color "${color}". Must be a valid hex color code (e.g. #3b82f6).`)
    }

    // Check duplicate active name within same transaction type
    const normalizedNew = CategoryService.normalizeName(trimmedName)
    const existing = await this.repo.getAll({ isDemo: input.isDemo, type, includeArchived: false })
    const duplicate = existing.find(
      (c) => CategoryService.normalizeName(c.name) === normalizedNew
    )

    if (duplicate) {
      throw new Error(
        `An active ${type} category named "${trimmedName}" already exists. Category names must be unique per type.`
      )
    }

    const defaultClassification: CategoryClassification =
      type === 'income' ? 'savings_investments' : 'wants'

    const now = new Date().toISOString()
    const idSlug = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cat'
    const uniqueSuffix = Date.now().toString(36)
    const id = `cat-${type.slice(0, 3)}-${idSlug}-${uniqueSuffix}`

    const newCategory: Category = {
      id,
      name: trimmedName,
      type,
      icon,
      color,
      description: input.description?.trim(),
      classification: input.classification || defaultClassification,
      isBuiltIn: false,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      isDemo: !!input.isDemo,
    }

    await this.repo.save(newCategory)
    return newCategory
  }

  /**
   * Updates an existing category presentation, name, icon, color, or classification.
   */
  async updateCategory(id: string, updates: CategoryUpdateInput): Promise<Category> {
    const existing = await this.repo.getById(id)
    if (!existing) {
      throw new Error(`Category with ID "${id}" not found.`)
    }

    const now = new Date().toISOString()
    let updatedName = existing.name

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim()
      if (!trimmed) {
        throw new Error('Category name cannot be empty.')
      }
      if (trimmed.length > 40) {
        throw new Error('Category name must be 40 characters or fewer.')
      }

      // If name changed, check uniqueness among active categories of same type
      if (CategoryService.normalizeName(trimmed) !== CategoryService.normalizeName(existing.name)) {
        const siblings = await this.repo.getAll({
          isDemo: existing.isDemo,
          type: existing.type,
          includeArchived: false,
        })
        const conflict = siblings.find(
          (c) => c.id !== existing.id && CategoryService.normalizeName(c.name) === CategoryService.normalizeName(trimmed)
        )
        if (conflict) {
          throw new Error(
            `An active ${existing.type} category named "${trimmed}" already exists.`
          )
        }
      }
      updatedName = trimmed
    }

    let updatedIcon = existing.icon
    if (updates.icon !== undefined) {
      if (!CategoryService.isValidIcon(updates.icon)) {
        throw new Error(`Invalid icon identifier "${updates.icon}".`)
      }
      updatedIcon = updates.icon
    }

    let updatedColor = existing.color
    if (updates.color !== undefined) {
      if (!CategoryService.isValidColor(updates.color)) {
        throw new Error(`Invalid color "${updates.color}". Must be a valid hex code.`)
      }
      updatedColor = updates.color
    }

    const updatedCategory: Category = {
      ...existing,
      name: updatedName,
      icon: updatedIcon,
      color: updatedColor,
      description: updates.description !== undefined ? updates.description.trim() : existing.description,
      classification: updates.classification || existing.classification,
      isArchived: updates.isArchived !== undefined ? updates.isArchived : existing.isArchived,
      updatedAt: now,
    }

    await this.repo.save(updatedCategory)
    return updatedCategory
  }

  /**
   * Renames a category without altering its stable unique ID.
   */
  async renameCategory(id: string, newName: string): Promise<Category> {
    return this.updateCategory(id, { name: newName })
  }

  /**
   * Archives a category so it cannot be used for new transactions,
   * while completely preserving historical records and reports.
   */
  async archiveCategory(id: string): Promise<Category> {
    return this.updateCategory(id, { isArchived: true })
  }

  /**
   * Restores an archived category to active status.
   */
  async restoreCategory(id: string): Promise<Category> {
    const existing = await this.repo.getById(id)
    if (!existing) {
      throw new Error(`Category with ID "${id}" not found.`)
    }

    // Check if another active category has the same name
    const siblings = await this.repo.getAll({
      isDemo: existing.isDemo,
      type: existing.type,
      includeArchived: false,
    })
    const conflict = siblings.find(
      (c) =>
        c.id !== existing.id &&
        CategoryService.normalizeName(c.name) === CategoryService.normalizeName(existing.name)
    )
    if (conflict) {
      throw new Error(
        `Cannot restore category: Another active ${existing.type} category named "${existing.name}" already exists.`
      )
    }

    return this.updateCategory(id, { isArchived: false })
  }

  /**
   * Permanently deletes a custom category.
   * Built-in categories CANNOT be deleted.
   * Categories in use should be archived, not deleted.
   */
  async deleteCategory(
    id: string,
    options?: { isCategoryInUse?: (catId: string, name: string) => Promise<boolean> }
  ): Promise<void> {
    const existing = await this.repo.getById(id)
    if (!existing) {
      return
    }

    if (existing.isBuiltIn) {
      throw new Error(
        `Built-in category "${existing.name}" cannot be deleted. You may archive it instead.`
      )
    }

    if (options?.isCategoryInUse) {
      const inUse = await options.isCategoryInUse(existing.id, existing.name)
      if (inUse) {
        throw new Error(
          `Category "${existing.name}" is referenced by existing transactions. Please archive it instead of deleting to protect historical ledger integrity.`
        )
      }
    }

    await this.repo.delete(id)
  }

  /**
   * Resolves a category by ID or name against a category collection with safe fallback.
   */
  static resolveCategory(nameOrId: string, categories: Category[]): Category {
    if (!nameOrId) {
      return {
        id: 'cat-fallback-unassigned',
        name: 'Uncategorized',
        type: 'expense',
        icon: 'Wrench',
        color: '#64748b',
        classification: 'unclassified',
        isBuiltIn: false,
        isArchived: false,
        createdAt: '',
        updatedAt: '',
      }
    }

    // 1. Direct ID match
    const byId = categories.find((c) => c.id === nameOrId)
    if (byId) return byId

    // 2. Case-insensitive Name match
    const normalized = CategoryService.normalizeName(nameOrId)
    const byName = categories.find((c) => CategoryService.normalizeName(c.name) === normalized)
    if (byName) return byName

    // 3. Fallback for legacy or custom external categories
    return {
      id: `cat-legacy-${normalized.replace(/[^a-z0-9]+/g, '-') || 'unknown'}`,
      name: nameOrId,
      type: 'expense',
      icon: 'Wrench',
      color: '#64748b',
      classification: 'unclassified',
      isBuiltIn: false,
      isArchived: false,
      createdAt: '',
      updatedAt: '',
    }
  }

  /**
   * Builds a dynamic classification map for Financial Insights
   * based on user's current categories, merging with defaults.
   */
  static buildClassificationMap(categories: Category[]): CategoryClassificationMap {
    const map: CategoryClassificationMap = { ...DEFAULT_CATEGORY_CLASSIFICATION }
    for (const cat of categories) {
      if (cat.name && cat.classification) {
        map[cat.name] = cat.classification
      }
    }
    return map
  }
}
