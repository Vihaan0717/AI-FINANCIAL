import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { X, Sliders, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { InventoryItem, InventoryUnit, StockAdjustmentInput } from '../types/inventory'
import { areUnitsCompatible, convertUnitQuantity, SUPPORTED_UNITS } from '../utils/units'
import { applyStockAdjustment } from '../utils/inventoryCalculations'

interface StockAdjustmentModalProps {
  isOpen: boolean
  onClose: () => void
  item: InventoryItem | null
  onAdjust: (id: string, adjustment: StockAdjustmentInput) => Promise<void>
}

export function StockAdjustmentModal({
  isOpen,
  onClose,
  item,
  onAdjust,
}: StockAdjustmentModalProps) {
  const [type, setType] = useState<'add' | 'subtract' | 'set'>('add')
  const [amountStr, setAmountStr] = useState('1')
  const [unit, setUnit] = useState<InventoryUnit>('pcs')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (item) {
      setUnit(item.unit)
      setAmountStr('1')
      setType('add')
      setReason('')
      setErrorMessage(null)
    }
  }, [item, isOpen])

  // Unit compatibility check
  const isCompatible = useMemo(() => {
    if (!item) return true
    return areUnitsCompatible(unit, item.unit)
  }, [item, unit])

  // Projected stock preview
  const preview = useMemo(() => {
    if (!item || !isCompatible) return null
    const amt = parseFloat(amountStr)
    if (isNaN(amt) || amt < 0) return null

    try {
      const normalizedAmount = convertUnitQuantity(amt, unit, item.unit)
      const res = applyStockAdjustment(item.quantity, {
        type,
        amount: normalizedAmount,
      })
      return res
    } catch (err) {
      return { newQuantity: item.quantity, error: err instanceof Error ? err.message : 'Invalid adjustment' }
    }
  }, [item, isCompatible, amountStr, unit, type])

  if (!isOpen || !item) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!isCompatible) {
      setErrorMessage(`Cannot combine incompatible units: "${unit}" and "${item.unit}".`)
      return
    }

    const amt = parseFloat(amountStr)
    if (isNaN(amt) || amt < 0) {
      setErrorMessage('Amount must be a non-negative number.')
      return
    }

    if (preview?.error) {
      setErrorMessage(preview.error)
      return
    }

    setIsSubmitting(true)
    try {
      await onAdjust(item.id, {
        type,
        amount: amt,
        unit,
        reason: reason.trim() || undefined,
      })
      onClose()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to adjust stock.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="stock-adj-title">
      <div className="modal" style={{ width: 'min(100%, 480px)' }}>
        <header>
          <div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Sliders size={12} color="var(--bright)" />
              STOCK CONTROL
            </span>
            <h2 id="stock-adj-title">Adjust Stock: {item.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </header>

        <div
          style={{
            margin: '14px 0',
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'var(--deep)',
            border: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Current Quantity</span>
            <b style={{ display: 'block', fontSize: '16px', color: 'var(--text)' }}>
              {item.quantity} {item.unit}
            </b>
          </div>
          <span
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '6px',
              background: 'var(--hover)',
              color: 'var(--text2)',
            }}
          >
            {item.category}
          </span>
        </div>

        {errorMessage && (
          <div
            style={{
              marginBottom: '12px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(248, 113, 113, 0.16)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              color: '#fca5a5',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={15} />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Mode Switcher */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '6px',
              marginBottom: '14px',
            }}
          >
            <button
              type="button"
              className={type === 'add' ? 'primary-button' : 'outline-button'}
              style={{ justifyContent: 'center', minHeight: '38px', fontSize: '12px' }}
              onClick={() => setType('add')}
            >
              + Add Stock
            </button>
            <button
              type="button"
              className={type === 'subtract' ? 'primary-button' : 'outline-button'}
              style={{ justifyContent: 'center', minHeight: '38px', fontSize: '12px' }}
              onClick={() => setType('subtract')}
            >
              - Use / Deduct
            </button>
            <button
              type="button"
              className={type === 'set' ? 'primary-button' : 'outline-button'}
              style={{ justifyContent: 'center', minHeight: '38px', fontSize: '12px' }}
              onClick={() => setType('set')}
            >
              = Set Exact
            </button>
          </div>

          <div className="form-grid">
            <label>
              Adjustment Quantity *
              <input
                type="number"
                step="any"
                min="0"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                required
              />
            </label>

            <label>
              Unit *
              <select value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)}>
                {SUPPORTED_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u} {!areUnitsCompatible(u, item.unit) ? '(Incompatible)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!isCompatible && (
            <div
              style={{
                margin: '8px 0',
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'rgba(248, 113, 113, 0.1)',
                color: '#f87171',
                fontSize: '11px',
              }}
            >
              ⚠️ Unit "{unit}" cannot be combined with item unit "{item.unit}".
            </div>
          )}

          {/* Live Result Preview */}
          {isCompatible && preview && (
            <div
              style={{
                margin: '10px 0',
                padding: '10px 12px',
                borderRadius: '8px',
                background: preview.error ? 'rgba(248, 113, 113, 0.1)' : 'rgba(52, 211, 153, 0.1)',
                border: preview.error
                  ? '1px solid rgba(248, 113, 113, 0.3)'
                  : '1px solid rgba(52, 211, 153, 0.3)',
                fontSize: '11px',
                color: preview.error ? '#fca5a5' : '#6ee7b7',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {preview.error ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
              <span>
                {preview.error
                  ? preview.error
                  : `Preview: ${item.quantity} ${item.unit} → ${preview.newQuantity} ${item.unit}`}
              </span>
            </div>
          )}

          <label style={{ marginTop: '10px' }}>
            Reason / Activity Note
            <input
              type="text"
              placeholder="e.g. Weekly grocery restock, used for laundry, physical count correction"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button type="button" className="outline-button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={isSubmitting || !isCompatible || !!preview?.error}
            >
              {isSubmitting ? 'Applying...' : 'Apply Stock Change'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
