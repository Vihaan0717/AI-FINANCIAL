import { useState, useEffect, type FormEvent } from 'react'
import { X, Sparkles, AlertCircle } from 'lucide-react'
import type { InventoryItem, InventoryCategory, InventoryUnit } from '../types/inventory'
import { SUPPORTED_UNITS } from '../utils/units'
import { validateAmount, paiseToRupeesString } from '../utils/money'

interface InventoryItemModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  initialItem?: InventoryItem | null
}

const CATEGORIES: InventoryCategory[] = [
  'Clothing',
  'Household essentials',
  'Food and pantry',
  'Personal care and other essentials',
]

export function InventoryItemModal({
  isOpen,
  onClose,
  onSave,
  initialItem,
}: InventoryItemModalProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<InventoryCategory>('Household essentials')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<InventoryUnit>('pcs')
  const [minThreshold, setMinThreshold] = useState('')
  const [priceRupees, setPriceRupees] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (initialItem) {
      setName(initialItem.name)
      setCategory(initialItem.category)
      setQuantity(String(initialItem.quantity))
      setUnit(initialItem.unit)
      setMinThreshold(initialItem.minThreshold !== undefined ? String(initialItem.minThreshold) : '')
      setPriceRupees(
        initialItem.purchasePricePaise !== undefined
          ? paiseToRupeesString(initialItem.purchasePricePaise)
          : ''
      )
      setExpiryDate(initialItem.expiryDate ? initialItem.expiryDate.slice(0, 10) : '')
      setNotes(initialItem.notes || '')
    } else {
      setName('')
      setCategory('Household essentials')
      setQuantity('1')
      setUnit('pcs')
      setMinThreshold('')
      setPriceRupees('')
      setExpiryDate('')
      setNotes('')
    }
    setErrorMessage(null)
  }, [initialItem, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!name.trim()) {
      setErrorMessage('Item name is required.')
      return
    }

    const parsedQty = parseFloat(quantity)
    if (isNaN(parsedQty) || !Number.isFinite(parsedQty) || parsedQty < 0) {
      setErrorMessage('Quantity must be a valid non-negative number.')
      return
    }

    let parsedThreshold: number | undefined = undefined
    if (minThreshold.trim() !== '') {
      const t = parseFloat(minThreshold)
      if (isNaN(t) || !Number.isFinite(t) || t < 0) {
        setErrorMessage('Minimum threshold must be a valid non-negative number.')
        return
      }
      parsedThreshold = t
    }

    let purchasePricePaise: number | undefined = undefined
    if (priceRupees.trim() !== '') {
      const val = validateAmount(priceRupees)
      if (!val.valid) {
        setErrorMessage(val.error || 'Invalid purchase price.')
        return
      }
      purchasePricePaise = val.paise
    }

    setIsSubmitting(true)
    try {
      await onSave({
        name: name.trim(),
        category,
        quantity: parsedQty,
        unit,
        minThreshold: parsedThreshold,
        purchasePricePaise,
        expiryDate: expiryDate.trim() ? new Date(expiryDate).toISOString() : undefined,
        notes: notes.trim() || undefined,
      })
      onClose()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="inv-item-modal-title">
      <div className="modal" style={{ width: 'min(100%, 540px)', maxHeight: '90vh', overflowY: 'auto' }}>
        <header>
          <div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Sparkles size={12} color="var(--bright)" />
              INVENTORY MANAGEMENT
            </span>
            <h2 id="inv-item-modal-title">{initialItem ? 'Edit Inventory Item' : 'Add New Item'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </header>

        {errorMessage && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(248, 113, 113, 0.16)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              color: '#fca5a5',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={15} />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
          <label>
            Item Name *
            <input
              type="text"
              placeholder="e.g. Ariel Matic Detergent, Blue Oxford Shirt"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <div className="form-grid">
            <label>
              Category *
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as InventoryCategory)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Unit *
              <select value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)}>
                {SUPPORTED_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-grid">
            <label>
              Quantity on Hand *
              <input
                type="number"
                step="any"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </label>

            <label>
              Min Stock Threshold
              <input
                type="number"
                step="any"
                min="0"
                placeholder={category === 'Clothing' ? 'Optional (No auto-alert)' : 'Alerts when below'}
                value={minThreshold}
                onChange={(e) => setMinThreshold(e.target.value)}
              />
            </label>
          </div>

          <div className="form-grid">
            <label>
              Estimated / Last Price (₹)
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 350.00"
                value={priceRupees}
                onChange={(e) => setPriceRupees(e.target.value)}
              />
            </label>

            <label>
              Expiry Date (if applicable)
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </label>
          </div>

          <label>
            Notes
            <textarea
              placeholder="Brand, size, specific storage location, or comments..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
            <button type="button" className="outline-button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : initialItem ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
