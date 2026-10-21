import React from 'react'
import {
  X,
  Edit2,
  Trash2,
  Calendar,
  CreditCard,
  CheckCircle2,
} from 'lucide-react'
import type { Transaction } from '../types/transaction'
import type { Category } from '../types/category'
import { formatPaise } from '../utils/money'
import { getLucideCategoryIcon } from '../utils/categoryIcons'

function splitDisplayDate(dateStr: string): { date: string; time: string } {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return { date: dateStr, time: '' }
    const dateFormatted = d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    const timeFormatted = d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return { date: dateFormatted, time: timeFormatted }
  } catch {
    return { date: dateStr, time: '' }
  }
}

interface TransactionDetailModalProps {
  transaction: Transaction | null
  onClose: () => void
  onEdit: (t: Transaction) => void
  onDelete: (t: Transaction) => void
  categoryMap?: Map<string, Category>
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  transaction,
  onClose,
  onEdit,
  onDelete,
  categoryMap,
}) => {
  if (!transaction) return null

  const isIncome = transaction.type === 'income'
  const isTransfer = transaction.type === 'transfer'
  const isRefund = transaction.type === 'refund'

  const sign = isIncome ? '+ ' : isTransfer ? '⇄ ' : isRefund ? '+ ' : '− '
  const amountColor = isIncome
    ? '#059669'
    : isTransfer
    ? '#2563eb'
    : isRefund
    ? '#059669'
    : '#1f1a3d'

  const typeBadgeColor = isIncome
    ? { bg: 'rgba(16, 185, 129, 0.12)', text: '#059669', label: 'Income' }
    : isTransfer
    ? { bg: 'rgba(59, 130, 246, 0.12)', text: '#2563eb', label: 'Transfer' }
    : isRefund
    ? { bg: 'rgba(16, 185, 129, 0.12)', text: '#059669', label: 'Refund' }
    : { bg: 'rgba(109, 63, 224, 0.12)', text: '#6d3fe0', label: 'Expense' }

  const matchedCat = categoryMap?.get((transaction.category || '').toLowerCase())
  const categoryColor = matchedCat?.color || '#6d3fe0'
  const IconComponent = matchedCat?.icon
    ? getLucideCategoryIcon(matchedCat.icon)
    : getLucideCategoryIcon('ShoppingBag')

  const { date: displayDate, time: displayTime } = splitDisplayDate(transaction.date)

  return (
    <div
      className="liquid-auth-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 110 }}
    >
      <div
        className="liquid-auth-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '420px', padding: '24px 20px' }}
      >
        {/* Header with Close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '12px',
                background: `${categoryColor}18`,
                color: categoryColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconComponent size={20} />
            </div>
            <div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: '#6d6796',
                }}
              >
                {transaction.category || 'General'}
              </span>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10px',
                  fontWeight: 700,
                  background: typeBadgeColor.bg,
                  color: typeBadgeColor.text,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  marginLeft: '8px',
                }}
              >
                {typeBadgeColor.label}
              </div>
            </div>
          </div>

          <button
            className="liquid-auth-close-btn"
            onClick={onClose}
            aria-label="Close details"
            style={{ position: 'static' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Big Amount Section */}
        <div
          style={{
            textAlign: 'center',
            padding: '16px 12px',
            background: 'rgba(255, 255, 255, 0.65)',
            borderRadius: '20px',
            border: '1px solid rgba(139, 92, 246, 0.14)',
            marginBottom: '18px',
          }}
        >
          <div
            style={{
              fontSize: '32px',
              fontWeight: 800,
              color: amountColor,
              letterSpacing: '-0.03em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {sign}{formatPaise(transaction.amount)}
          </div>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: '#1f1a3d',
              marginTop: '4px',
              wordBreak: 'break-word',
            }}
          >
            {transaction.description}
          </div>
        </div>

        {/* Info Grid */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            background: 'rgba(255, 255, 255, 0.5)',
            borderRadius: '16px',
            padding: '14px 16px',
            border: '1px solid rgba(220, 215, 245, 0.7)',
            marginBottom: '20px',
          }}
        >
          {/* Date & Time */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6d6796' }}>
              <Calendar size={14} /> Date & Time
            </span>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1f1a3d' }}>
              {displayDate} {displayTime ? `· ${displayTime}` : ''}
            </span>
          </div>

          {/* Payment Method */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6d6796' }}>
              <CreditCard size={14} /> Payment Method
            </span>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1f1a3d' }}>
              {transaction.paymentMethod || 'UPI'}
            </span>
          </div>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6d6796' }}>
              <CheckCircle2 size={14} /> Status
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'capitalize',
                color: transaction.status === 'pending' ? '#d97706' : '#059669',
              }}
            >
              {transaction.status || 'Completed'}
            </span>
          </div>

          {/* Notes if present */}
          {transaction.notes && (
            <div style={{ borderTop: '1px solid rgba(139, 92, 246, 0.1)', paddingTop: '8px', marginTop: '2px' }}>
              <span style={{ fontSize: '11px', color: '#6d6796', display: 'block', marginBottom: '2px' }}>
                Notes / Reference:
              </span>
              <p style={{ margin: 0, fontSize: '12px', color: '#3b3561', fontStyle: 'italic' }}>
                {transaction.notes}
              </p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          <button
            className="liquid-auth-submit-btn"
            style={{
              height: '46px',
              fontSize: '13.5px',
            }}
            onClick={() => {
              onClose()
              onEdit(transaction)
            }}
          >
            <Edit2 size={16} />
            <span>Edit Transaction</span>
          </button>

          <button
            className="outline-button"
            style={{
              height: '42px',
              color: '#ef4444',
              borderColor: 'rgba(239, 68, 68, 0.3)',
              background: 'rgba(254, 242, 242, 0.7)',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
            onClick={() => {
              onClose()
              onDelete(transaction)
            }}
          >
            <Trash2 size={15} />
            <span>Delete Transaction</span>
          </button>
        </div>
      </div>
    </div>
  )
}
