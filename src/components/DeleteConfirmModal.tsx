import { X, Trash2, AlertTriangle } from 'lucide-react'
import type { Transaction } from '../types/transaction'
import { formatPaise } from '../utils/money'

interface DeleteConfirmModalProps {
  transaction: Transaction | null
  onClose: () => void
  onConfirm: () => void
  isDeleting: boolean
}

export function DeleteConfirmModal({
  transaction,
  onClose,
  onConfirm,
  isDeleting,
}: DeleteConfirmModalProps) {
  if (!transaction) return null

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
      <div className="modal delete-modal">
        <header>
          <div>
            <span style={{ color: '#ff6b6b' }}>CONFIRM REMOVAL</span>
            <h2 id="delete-dialog-title">Delete transaction?</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>

        <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text2)', lineHeight: 1.6 }}>
          <p>
            Are you sure you want to permanently delete this transaction? All dependent dashboards, charts, and budget calculations will recalculate immediately.
          </p>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'var(--hover)',
              marginTop: '12px',
              display: 'grid',
              gap: '4px',
            }}
          >
            <b style={{ color: 'var(--text)', fontSize: '13px' }}>{transaction.description}</b>
            <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
              {transaction.category} · {transaction.paymentMethod} · {new Date(transaction.date).toLocaleDateString('en-IN')}
            </span>
            <strong style={{ color: transaction.type === 'income' ? 'var(--mint)' : 'var(--text)', marginTop: '4px' }}>
              {transaction.type === 'income' ? '+' : '−'}{formatPaise(transaction.amount)}
            </strong>
          </div>

          {transaction.type === 'expense' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '12px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'rgba(255, 170, 0, 0.12)',
                color: '#ffb36a',
                fontSize: '11px',
              }}
            >
              <AlertTriangle size={15} />
              <span>If any refunds reference this expense, their linkages will be severed.</span>
            </div>
          )}
        </div>

        <footer>
          <button
            type="button"
            className="outline-button"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            style={{
              background: 'linear-gradient(135deg, #f87171, #ef4444)',
              color: '#fff',
            }}
            onClick={onConfirm}
            disabled={isDeleting}
          >
            <Trash2 size={15} />
            {isDeleting ? 'Deleting...' : 'Delete permanently'}
          </button>
        </footer>
      </div>
    </div>
  )
}
