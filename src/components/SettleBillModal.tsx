import { useState } from 'react'
import { X, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react'
import type { BillInstance } from '../types/planner'
import type { PaymentMethod } from '../types/transaction'
import { formatPaise } from '../utils/money'

interface SettleBillModalProps {
  isOpen: boolean
  bill: BillInstance | null
  onClose: () => void
  onConfirm: (options: {
    recordTransaction: boolean
    paymentMethod?: PaymentMethod
    category?: string
    notes?: string
  }) => Promise<void>
}

const PAYMENT_METHODS: PaymentMethod[] = [
  'UPI',
  'Bank transfer',
  'Card',
  'Cash',
  'Other',
]

export function SettleBillModal({
  isOpen,
  bill,
  onClose,
  onConfirm,
}: SettleBillModalProps) {
  const [recordTransaction, setRecordTransaction] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI')
  const [category, setCategory] = useState(bill?.category || 'Utilities')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen || !bill) return null

  const isAlreadyLinked = !!bill.linkedTransactionId
  const hasAmount = bill.amountPaise !== undefined && bill.amountPaise > 0
  const isOrdinaryExpense = bill.commitmentType === 'expense'

  const handleConfirm = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await onConfirm({
        recordTransaction: recordTransaction && hasAmount && !isAlreadyLinked,
        paymentMethod,
        category,
        notes: notes.trim() || undefined,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to settle bill.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '500px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle size={22} className="text-emerald" />
            <div>
              <h3>Mark Bill as Paid</h3>
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                Confirm settlement for {bill.title}
              </p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </header>

        {error && (
          <div className="budget-alert-card warning" style={{ margin: '1rem 0' }}>
            <AlertTriangle size={18} />
            <p>{error}</p>
          </div>
        )}

        <div style={{ margin: '1rem 0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Bill summary card */}
          <div className="inv-card" style={{ padding: '1rem', background: 'var(--bg-subtle, rgba(255,255,255,0.03))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{bill.title}</strong>
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                  Due: {bill.dueDate} · {bill.category}
                  {!isOrdinaryExpense && ` · (${bill.commitmentType})`}
                </p>
              </div>
              <strong style={{ fontSize: '1.25rem', color: 'var(--text-main)' }}>
                {bill.amountPaise ? formatPaise(bill.amountPaise) : 'No amount'}
              </strong>
            </div>
          </div>

          {isAlreadyLinked ? (
            <div className="budget-alert-card info">
              <ShieldCheck size={18} />
              <p>
                This bill was already linked to transaction #{bill.linkedTransactionId}. Marking it paid again will not create a duplicate transaction.
              </p>
            </div>
          ) : hasAmount ? (
            <div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={recordTransaction}
                  onChange={(e) => setRecordTransaction(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--brand-mint)' }}
                />
                Record this payment in my financial transaction ledger
              </label>

              {recordTransaction ? (
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="field-label">Payment Method</label>
                      <select
                        className="select-input"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="field-label">Ledger Category</label>
                      <select
                        className="select-input"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="Utilities">Utilities</option>
                        <option value="Home">Home & Rent</option>
                        <option value="Investment">Investment</option>
                        <option value="Health">Health</option>
                        <option value="Entertainment">Entertainment</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-muted" style={{ fontSize: '0.8rem' }}>
                    ✓ Exactly 1 financial expense of {formatPaise(bill.amountPaise!)} will be recorded and linked to this bill.
                  </p>
                </div>
              ) : (
                <p className="text-muted" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
                  ℹ️ The bill status will update to Paid, but no expense transaction will be logged in your ledger.
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
              ℹ️ This is a reminder-only commitment without a monetary value. Marking it paid will simply update its status.
            </p>
          )}

          <div>
            <label className="field-label">Notes (Optional)</label>
            <input
              type="text"
              className="text-input"
              placeholder="e.g. Transaction UTR, receipt number"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="ghost-button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? 'Confirming...' : 'Confirm Paid'}
          </button>
        </footer>
      </div>
    </div>
  )
}
