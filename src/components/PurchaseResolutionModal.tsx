import { useState } from 'react'
import { X, ShoppingBag } from 'lucide-react'
import type { ShoppingListItem, PurchaseResolutionOption } from '../types/shopping'
import type { PaymentMethod } from '../types/transaction'
import { paiseToRupeesString, validateAmount } from '../utils/money'

interface PurchaseResolutionModalProps {
  isOpen: boolean
  onClose: () => void
  item: ShoppingListItem | null
  onResolve: (params: {
    itemId: string
    resolution: PurchaseResolutionOption
    quantityPurchased: number
    amountPaise?: number
    paymentMethod: PaymentMethod
    category: string
  }) => Promise<void>
}

export function PurchaseResolutionModal({
  isOpen,
  onClose,
  item,
  onResolve,
}: PurchaseResolutionModalProps) {
  const [resolution, setResolution] = useState<PurchaseResolutionOption>('both')
  const [quantity, setQuantity] = useState<string>('1')
  const [priceRupees, setPriceRupees] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI')
  const [category, setCategory] = useState<string>('Groceries')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!isOpen || !item) return null

  // Prepopulate on initial render
  if (priceRupees === '' && item.estimatedPricePaise) {
    setPriceRupees(paiseToRupeesString(item.estimatedPricePaise * (item.quantity || 1)))
    setQuantity(String(item.quantity || 1))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    const parsedQty = parseFloat(quantity)
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMessage('Quantity must be greater than zero.')
      return
    }

    let amountPaise: number | undefined = undefined
    if (resolution === 'both' || resolution === 'transaction_only') {
      const val = validateAmount(priceRupees)
      if (!val.valid) {
        setErrorMessage(val.error || 'Please provide a valid purchase price.')
        return
      }
      amountPaise = val.paise
    }

    setIsSubmitting(true)
    try {
      await onResolve({
        itemId: item.id,
        resolution,
        quantityPurchased: parsedQty,
        amountPaise,
        paymentMethod,
        category,
      })
      onClose()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to complete item.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="purchase-res-title">
      <div className="modal" style={{ width: 'min(100%, 500px)' }}>
        <header>
          <div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <ShoppingBag size={12} color="var(--bright)" />
              SMART PURCHASE RESOLUTION
            </span>
            <h2 id="purchase-res-title">Mark Purchased: {item.productName}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </header>

        <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
          Select how you want Money Mate to handle this purchase. We never silently create transactions
          or modify stock without your explicit choice.
        </p>

        {errorMessage && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'rgba(248, 113, 113, 0.16)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              color: '#fca5a5',
              fontSize: '11px',
            }}
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ marginTop: '14px' }}>
          {/* Resolution Options */}
          <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: resolution === 'both' ? 'var(--deep)' : 'var(--panel)',
                border: resolution === 'both' ? '1px solid var(--purple)' : '1px solid var(--line)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'both'}
                onChange={() => setResolution('both')}
              />
              <div>
                <b style={{ display: 'block', fontSize: '12px', color: 'var(--text)' }}>
                  Both: Update Inventory & Record Financial Expense
                </b>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  Adds +{item.quantity} {item.unit} to stock and records an expense in your ledger.
                </span>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: resolution === 'inventory_only' ? 'var(--deep)' : 'var(--panel)',
                border: resolution === 'inventory_only' ? '1px solid var(--purple)' : '1px solid var(--line)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'inventory_only'}
                onChange={() => setResolution('inventory_only')}
              />
              <div>
                <b style={{ display: 'block', fontSize: '12px', color: 'var(--text)' }}>
                  Update Inventory Only
                </b>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  Useful if expense was already recorded via UPI scan or cash without a receipt.
                </span>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: resolution === 'transaction_only' ? 'var(--deep)' : 'var(--panel)',
                border: resolution === 'transaction_only' ? '1px solid var(--purple)' : '1px solid var(--line)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'transaction_only'}
                onChange={() => setResolution('transaction_only')}
              />
              <div>
                <b style={{ display: 'block', fontSize: '12px', color: 'var(--text)' }}>
                  Record Financial Expense Only
                </b>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  Records the expense in ledger without modifying your physical inventory count.
                </span>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: resolution === 'neither' ? 'var(--deep)' : 'var(--panel)',
                border: resolution === 'neither' ? '1px solid var(--purple)' : '1px solid var(--line)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'neither'}
                onChange={() => setResolution('neither')}
              />
              <div>
                <b style={{ display: 'block', fontSize: '12px', color: 'var(--text)' }}>
                  Neither (Mark as completed only)
                </b>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  Simply removes from active shopping list without altering stock or ledger.
                </span>
              </div>
            </label>
          </div>

          {/* Conditional Fields based on resolution */}
          {(resolution === 'both' || resolution === 'inventory_only') && (
            <label style={{ marginBottom: '12px' }}>
              Quantity Received ({item.unit})
              <input
                type="number"
                step="any"
                min="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </label>
          )}

          {(resolution === 'both' || resolution === 'transaction_only') && (
            <>
              <div className="form-grid">
                <label>
                  Actual Amount Paid (₹) *
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceRupees}
                    onChange={(e) => setPriceRupees(e.target.value)}
                    required
                  />
                </label>

                <label>
                  Payment Method
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="Cash">Cash</option>
                    <option value="Bank transfer">Bank transfer</option>
                  </select>
                </label>
              </div>

              <label style={{ marginTop: '8px' }}>
                Transaction Category
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="Groceries">Groceries</option>
                  <option value="Shopping">Shopping</option>
                  <option value="Household essentials">Household essentials</option>
                  <option value="Personal care and other essentials">Personal care</option>
                  <option value="Food and pantry">Food and pantry</option>
                  <option value="Other">Other</option>
                </select>
              </label>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <button type="button" className="outline-button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Confirming...' : 'Confirm Resolution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
