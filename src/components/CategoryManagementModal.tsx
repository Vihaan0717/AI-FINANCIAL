import { useState, useMemo, type FormEvent } from 'react'
import {
  X,
  Search,
  Plus,
  Edit2,
  Archive,
  RefreshCw,
  Trash2,
  Tag,
  AlertCircle,
  Check,
  Shield,
  Layers,
} from 'lucide-react'
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
import { getLucideCategoryIcon } from '../utils/categoryIcons'
import { CategoryService } from '../services/categoryService'

interface CategoryManagementModalProps {
  isOpen: boolean
  onClose: () => void
  categories: Category[]
  onAddCategory?: (input: CategoryCreateInput) => Promise<Category>
  onCreateCategory?: (input: CategoryCreateInput) => Promise<Category>
  onUpdateCategory: (id: string, updates: CategoryUpdateInput) => Promise<Category>
  onRenameCategory?: (id: string, newName: string) => Promise<Category>
  onArchiveCategory: (id: string) => Promise<Category>
  onRestoreCategory: (id: string) => Promise<Category>
  onDeleteCategory: (id: string, options?: { isCategoryInUse?: (catId: string, name: string) => Promise<boolean> | boolean }) => Promise<void>
  isCategoryInUse?: (catId: string, name: string) => Promise<boolean> | boolean
  notify: (msg: string) => void
  currentScope?: 'live' | 'demo'
}

type TabFilter = 'all' | 'expense' | 'income' | 'archived'

export function CategoryManagementModal({
  isOpen,
  onClose,
  categories,
  onAddCategory,
  onCreateCategory,
  onUpdateCategory,
  onArchiveCategory,
  onRestoreCategory,
  onDeleteCategory,
  isCategoryInUse,
  notify,
  currentScope = 'live',
}: CategoryManagementModalProps) {
  const addCategoryFn = onAddCategory || onCreateCategory
  const [tab, setTab] = useState<TabFilter>('all')
  const [search, setSearch] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)

  // Form State
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'expense' | 'income'>('expense')
  const [formIcon, setFormIcon] = useState<string>('Coffee')
  const [formColor, setFormColor] = useState<string>(CURATED_CATEGORY_COLORS[0])
  const [formDescription, setFormDescription] = useState('')
  const [formClassification, setFormClassification] = useState<CategoryClassification>('wants')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Delete Confirm State
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Filter Categories
  const filteredCategories = useMemo(() => {
    return categories.filter((c) => {
      // Tab filter
      if (tab === 'expense') {
        if (c.type !== 'expense' || c.isArchived) return false
      } else if (tab === 'income') {
        if (c.type !== 'income' || c.isArchived) return false
      } else if (tab === 'archived') {
        if (!c.isArchived) return false
      } else {
        // 'all' shows all active categories
        if (c.isArchived) return false
      }

      // Search filter
      if (search.trim()) {
        const query = search.toLowerCase()
        const matchesName = c.name.toLowerCase().includes(query)
        const matchesDesc = (c.description || '').toLowerCase().includes(query)
        if (!matchesName && !matchesDesc) return false
      }

      return true
    })
  }, [categories, tab, search])

  if (!isOpen) return null

  // Open Form for Create
  const handleOpenCreate = () => {
    setEditingCategory(null)
    setFormName('')
    setFormType(tab === 'income' ? 'income' : 'expense')
    setFormIcon(tab === 'income' ? 'Coins' : 'Coffee')
    setFormColor(CURATED_CATEGORY_COLORS[0])
    setFormDescription('')
    setFormClassification(tab === 'income' ? 'savings_investments' : 'wants')
    setFormError(null)
    setIsFormOpen(true)
  }

  // Open Form for Edit
  const handleOpenEdit = (cat: Category) => {
    setEditingCategory(cat)
    setFormName(cat.name)
    setFormType(cat.type as 'expense' | 'income')
    setFormIcon(cat.icon)
    setFormColor(cat.color)
    setFormDescription(cat.description || '')
    setFormClassification(cat.classification)
    setFormError(null)
    setIsFormOpen(true)
  }

  // Form Submit
  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const trimmed = formName.trim()
    if (!trimmed) {
      setFormError('Category name cannot be empty.')
      return
    }

    // Name uniqueness check within active siblings of same type
    const normalizedNew = CategoryService.normalizeName(trimmed)
    const conflict = categories.find(
      (c) =>
        !c.isArchived &&
        c.type === formType &&
        c.id !== editingCategory?.id &&
        CategoryService.normalizeName(c.name) === normalizedNew
    )

    if (conflict) {
      setFormError(
        `An active ${formType} category named "${trimmed}" already exists.`
      )
      return
    }

    try {
      setIsSubmitting(true)
      if (editingCategory) {
        await onUpdateCategory(editingCategory.id, {
          name: trimmed,
          icon: formIcon,
          color: formColor,
          description: formDescription,
          classification: formClassification,
        })
        notify(`Updated category "${trimmed}".`)
      } else if (addCategoryFn) {
        await addCategoryFn({
          name: trimmed,
          type: formType,
          icon: formIcon,
          color: formColor,
          description: formDescription,
          classification: formClassification,
        })
        notify(`Created ${formType} category "${trimmed}".`)
      }
      setIsFormOpen(false)
    } catch (err: any) {
      setFormError(err.message || 'Failed to save category.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Archive / Restore Handler
  const handleToggleArchive = async (cat: Category) => {
    try {
      if (cat.isArchived) {
        await onRestoreCategory(cat.id)
        notify(`Restored category "${cat.name}".`)
      } else {
        await onArchiveCategory(cat.id)
        notify(`Archived category "${cat.name}". Historical transactions are preserved.`)
      }
    } catch (err: any) {
      notify(err.message || 'Operation failed.')
    }
  }

  // Delete Category Confirm
  const handleConfirmDelete = async () => {
    if (!categoryToDelete) return
    setDeleteError(null)
    try {
      setIsDeleting(true)
      await onDeleteCategory(categoryToDelete.id, { isCategoryInUse })
      notify(`Deleted custom category "${categoryToDelete.name}".`)
      setCategoryToDelete(null)
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete category.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true">
      <div
        className="modal"
        style={{
          width: 'min(100%, 640px)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--blue)',
              }}
            >
              <Tag size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '17px', margin: 0, fontWeight: 700 }}>Financial Categories</h2>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Personalize categories, icons, colors, and needs/wants classification · Scope: {currentScope}
              </span>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </header>

        {/* Action Bar: Search, Tabs, New Button */}
        <div style={{ padding: '14px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted)',
                }}
              />
              <input
                type="text"
                className="text-input"
                id="search-category-input"
                placeholder="Search categories..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '32px', height: '36px', fontSize: '13px' }}
              />
            </div>
            <button
              className="primary-btn"
              id="create-category-btn"
              onClick={handleOpenCreate}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                height: '36px',
                padding: '0 14px',
                fontSize: '13px',
                whiteSpace: 'nowrap',
              }}
            >
              <Plus size={15} />
              <span>New Category</span>
            </button>
          </div>

          {/* Filter Pills */}
          <div className="planner-tabs" style={{ margin: 0 }}>
            <button
              className={`planner-tab ${tab === 'all' ? 'active' : ''}`}
              id="tab-all-categories"
              onClick={() => setTab('all')}
            >
              Active ({categories.filter((c) => !c.isArchived).length})
            </button>
            <button
              className={`planner-tab ${tab === 'expense' ? 'active' : ''}`}
              id="tab-expense-categories"
              onClick={() => setTab('expense')}
            >
              Expenses ({categories.filter((c) => c.type === 'expense' && !c.isArchived).length})
            </button>
            <button
              className={`planner-tab ${tab === 'income' ? 'active' : ''}`}
              id="tab-income-categories"
              onClick={() => setTab('income')}
            >
              Income ({categories.filter((c) => c.type === 'income' && !c.isArchived).length})
            </button>
            <button
              className={`planner-tab ${tab === 'archived' ? 'active' : ''}`}
              id="tab-archived-categories"
              onClick={() => setTab('archived')}
            >
              Archived ({categories.filter((c) => c.isArchived).length})
            </button>
          </div>
        </div>

        {/* Category List */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
          {filteredCategories.length === 0 ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: 'var(--muted)',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '8px',
                border: '1px dashed var(--border)',
              }}
            >
              <Layers size={32} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
              <p style={{ margin: '0 0 6px', fontWeight: 600 }}>No categories found</p>
              <p style={{ margin: 0, fontSize: '12px' }}>
                {search
                  ? `No matching categories for "${search}".`
                  : tab === 'archived'
                  ? 'No archived categories.'
                  : 'Get started by creating a custom category.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredCategories.map((cat) => {
                const IconComponent = getLucideCategoryIcon(cat.icon)
                return (
                  <div
                    key={cat.id}
                    className="category-item-row"
                    id={`cat-row-${cat.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border)',
                      opacity: cat.isArchived ? 0.6 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '8px',
                          background: `${cat.color}20`,
                          border: `1px solid ${cat.color}40`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: cat.color,
                          flexShrink: 0,
                        }}
                      >
                        <IconComponent size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: '14px',
                              color: 'var(--text)',
                              textDecoration: cat.isArchived ? 'line-through' : 'none',
                            }}
                          >
                            {cat.name}
                          </span>
                          <span
                            className={`badge ${cat.type === 'expense' ? 'badge-expense' : 'badge-income'}`}
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              textTransform: 'capitalize',
                              background: cat.type === 'expense' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: cat.type === 'expense' ? '#ef4444' : '#10b981',
                            }}
                          >
                            {cat.type}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: 'rgba(255, 255, 255, 0.06)',
                              color: 'var(--muted)',
                              textTransform: 'capitalize',
                            }}
                          >
                            {cat.classification.replace('_', ' ')}
                          </span>
                          {cat.isBuiltIn && (
                            <span
                              style={{
                                fontSize: '10px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                color: 'var(--muted)',
                              }}
                              title="System Built-in Category"
                            >
                              <Shield size={10} />
                              Built-in
                            </span>
                          )}
                          {cat.isArchived && (
                            <span
                              style={{
                                fontSize: '10px',
                                color: '#eab308',
                                background: 'rgba(234, 179, 8, 0.1)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              Archived
                            </span>
                          )}
                        </div>
                        {cat.description && (
                          <div
                            style={{
                              fontSize: '11px',
                              color: 'var(--muted)',
                              marginTop: '2px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '340px',
                            }}
                          >
                            {cat.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        className="action-btn"
                        id={`edit-cat-${cat.id}`}
                        onClick={() => handleOpenEdit(cat)}
                        aria-label={`Edit ${cat.name}`}
                        title="Edit presentation"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="action-btn"
                        id={`archive-cat-${cat.id}`}
                        onClick={() => handleToggleArchive(cat)}
                        aria-label={cat.isArchived ? `Restore ${cat.name}` : `Archive ${cat.name}`}
                        title={cat.isArchived ? 'Restore category' : 'Archive category (preserves historical data)'}
                      >
                        {cat.isArchived ? <RefreshCw size={14} /> : <Archive size={14} />}
                      </button>
                      {!cat.isBuiltIn && (
                        <button
                          className="action-btn delete"
                          id={`delete-cat-${cat.id}`}
                          onClick={() => {
                            setCategoryToDelete(cat)
                            setDeleteError(null)
                          }}
                          aria-label={`Delete ${cat.name}`}
                          title="Delete custom category"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal Footer Note */}
        <div
          style={{
            marginTop: '12px',
            paddingTop: '10px',
            borderTop: '1px solid var(--border)',
            fontSize: '11px',
            color: 'var(--muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Historical transactions retain their category references even when renamed or archived.</span>
          <button className="secondary-btn" onClick={onClose} style={{ padding: '4px 12px', fontSize: '12px' }}>
            Close
          </button>
        </div>
      </div>

      {/* CREATE / EDIT CATEGORY SUB-MODAL */}
      {isFormOpen && (
        <div className="backdrop" style={{ zIndex: 1100 }}>
          <div
            className="modal"
            style={{ width: 'min(100%, 480px)', maxHeight: '90vh', overflowY: 'auto' }}
            id="category-form-modal"
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
              }}
            >
              <h3 style={{ fontSize: '16px', margin: 0, fontWeight: 700 }}>
                {editingCategory ? `Edit Category: ${editingCategory.name}` : 'Create New Category'}
              </h3>
              <button
                className="icon-button"
                onClick={() => setIsFormOpen(false)}
                aria-label="Close category form"
              >
                <X size={18} />
              </button>
            </header>

            {formError && (
              <div
                id="category-form-error"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #ef4444',
                  borderRadius: '6px',
                  color: '#ef4444',
                  fontSize: '12px',
                  marginBottom: '14px',
                }}
              >
                <AlertCircle size={16} />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Category Name */}
              <div>
                <label className="field-label" htmlFor="category-name-input">
                  Category Name *
                </label>
                <input
                  type="text"
                  id="category-name-input"
                  className="text-input"
                  placeholder="e.g. Pet Care, Subscriptions, Fitness"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  maxLength={40}
                  required
                />
              </div>

              {/* Transaction Type (Expense vs Income) */}
              <div>
                <label className="field-label">Transaction Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    id="type-select-expense"
                    className={`planner-tab ${formType === 'expense' ? 'active' : ''}`}
                    onClick={() => {
                      if (!editingCategory?.isBuiltIn) {
                        setFormType('expense')
                        if (formClassification === 'savings_investments') {
                          setFormClassification('wants')
                        }
                      }
                    }}
                    style={{
                      height: '38px',
                      justifyContent: 'center',
                      opacity: editingCategory?.isBuiltIn ? 0.6 : 1,
                      cursor: editingCategory?.isBuiltIn ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    id="type-select-income"
                    className={`planner-tab ${formType === 'income' ? 'active' : ''}`}
                    onClick={() => {
                      if (!editingCategory?.isBuiltIn) {
                        setFormType('income')
                        setFormClassification('savings_investments')
                      }
                    }}
                    style={{
                      height: '38px',
                      justifyContent: 'center',
                      opacity: editingCategory?.isBuiltIn ? 0.6 : 1,
                      cursor: editingCategory?.isBuiltIn ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Income
                  </button>
                </div>
              </div>

              {/* Needs / Wants Classification */}
              <div>
                <label className="field-label" htmlFor="category-classification-select">
                  50/30/20 Insights Classification
                </label>
                <select
                  id="category-classification-select"
                  className="select-input"
                  value={formClassification}
                  onChange={(e) => setFormClassification(e.target.value as CategoryClassification)}
                >
                  <option value="needs">Needs (Essential Living)</option>
                  <option value="wants">Wants (Discretionary & Lifestyle)</option>
                  <option value="savings_investments">Savings & Investments</option>
                  <option value="unclassified">Unclassified</option>
                </select>
                <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
                  Used for monthly Financial Insights breakdown without altering ledger amounts.
                </span>
              </div>

              {/* Icon Picker */}
              <div>
                <label className="field-label">Category Icon</label>
                <div
                  id="category-icon-picker"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '6px',
                    maxHeight: '130px',
                    overflowY: 'auto',
                    padding: '6px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                  }}
                >
                  {ALLOWED_CATEGORY_ICONS.map((iconName) => {
                    const IconComp = getLucideCategoryIcon(iconName)
                    const isSelected = formIcon === iconName
                    return (
                      <button
                        type="button"
                        key={iconName}
                        id={`icon-choice-${iconName}`}
                        onClick={() => setFormIcon(iconName)}
                        aria-label={`Select icon ${iconName}`}
                        title={iconName}
                        style={{
                          width: '100%',
                          aspectRatio: '1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '6px',
                          border: isSelected ? '2px solid var(--blue)' : '1px solid transparent',
                          background: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                          color: isSelected ? 'var(--blue)' : 'var(--muted)',
                          cursor: 'pointer',
                        }}
                      >
                        <IconComp size={18} />
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Color Picker */}
              <div>
                <label className="field-label">Category Color</label>
                <div
                  id="category-color-picker"
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}
                >
                  {CURATED_CATEGORY_COLORS.map((color) => {
                    const isSelected = formColor.toLowerCase() === color.toLowerCase()
                    return (
                      <button
                        type="button"
                        key={color}
                        id={`color-choice-${color.replace('#', '')}`}
                        onClick={() => setFormColor(color)}
                        aria-label={`Select color ${color}`}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: color,
                          border: isSelected ? '2px solid #fff' : '2px solid transparent',
                          boxShadow: isSelected ? '0 0 8px rgba(255,255,255,0.4)' : 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isSelected && <Check size={14} color="#fff" />}
                      </button>
                    )
                  })}
                  <input
                    type="text"
                    id="category-color-hex-input"
                    className="text-input"
                    placeholder="#3b82f6"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    style={{ width: '90px', height: '28px', fontSize: '12px', padding: '0 8px' }}
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="field-label" htmlFor="category-desc-input">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  id="category-desc-input"
                  className="text-input"
                  placeholder="Notes about what belongs in this category"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  maxLength={100}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setIsFormOpen(false)}
                  style={{ height: '36px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="save-category-btn"
                  className="primary-btn"
                  disabled={isSubmitting}
                  style={{ height: '36px' }}
                >
                  {isSubmitting ? 'Saving...' : editingCategory ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION DIALOG */}
      {categoryToDelete && (
        <div className="backdrop" style={{ zIndex: 1200 }}>
          <div className="modal" style={{ width: 'min(100%, 420px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ef4444', marginBottom: '12px' }}>
              <AlertCircle size={22} />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Delete Category?</h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text)', margin: '0 0 10px' }}>
              Are you sure you want to permanently delete <strong>"{categoryToDelete.name}"</strong>?
            </p>
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '0 0 14px' }}>
              If you have historical transactions using this category, consider <strong>archiving</strong> it instead so past records remain properly categorized.
            </p>

            {deleteError && (
              <div
                id="delete-category-error"
                style={{
                  padding: '8px 10px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid #ef4444',
                  borderRadius: '6px',
                  color: '#ef4444',
                  fontSize: '12px',
                  marginBottom: '12px',
                }}
              >
                {deleteError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                className="secondary-btn"
                onClick={() => setCategoryToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                id="confirm-delete-category-btn"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                style={{ background: '#ef4444', borderColor: '#ef4444' }}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
