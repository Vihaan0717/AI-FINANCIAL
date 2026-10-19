import { useState, useEffect, useMemo, type FormEvent } from 'react'
import {
  X,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  RotateCcw,
  Plus,
  Save,
  AlertTriangle,
} from 'lucide-react'
import type {
  Transaction,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  DuplicateCheckResult,
} from '../types/transaction'
import type { Category } from '../types/category'
import { validateAmount, paiseToRupees } from '../utils/money'

interface TransactionModalProps {
  isOpen: boolean
  onClose: () => void
  initialData?: Transaction | null
  existingExpenses?: Transaction[]
  availableCategories?: Category[]
  onSave: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  onUpdate?: (transaction: Transaction) => Promise<void>
  checkDuplicate: (candidate: {
    amount: number
    type: string
    date: string
    merchant?: string
    description?: string
    externalRef?: string
    id?: string
  }) => DuplicateCheckResult
}

const DEFAULT_EXPENSE_CATEGORIES = [
  'Food & dining',
  'Groceries',
  'Home',
  'Transport',
  'Shopping',
  'Utilities',
  'Health',
  'Entertainment',
  'Other',
]

const DEFAULT_INCOME_CATEGORIES = [
  'Income',
  'Salary',
  'Freelance',
  'Investment',
  'Gift',
  'Other',
]

export function TransactionModal({
  isOpen,
  onClose,
  initialData,
  existingExpenses = [],
  availableCategories,
  onSave,
  onUpdate,
  checkDuplicate,
}: TransactionModalProps) {
  const [type, setType] = useState<TransactionType>('expense')
  const [amountInput, setAmountInput] = useState<string>('')
  const [category, setCategory] = useState<string>('Food & dining')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI')
  const [description, setDescription] = useState<string>('')
  const [merchant, setMerchant] = useState<string>('')
  const [status, setStatus] = useState<TransactionStatus>('completed')
  const [date, setDate] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [externalRef, setExternalRef] = useState<string>('')
  const [fromAccount, setFromAccount] = useState<string>('Checking Account')
  const [toAccount, setToAccount] = useState<string>('Savings Reserve')
  const [linkedTransactionId, setLinkedTransactionId] = useState<string>('')

  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null)

  // Populate form on edit mode or reset on new entry
  useEffect(() => {
    if (initialData) {
      setType(initialData.type)
      setAmountInput(String(paiseToRupees(initialData.amount)))
      setCategory(initialData.category)
      setPaymentMethod(initialData.paymentMethod)
      setDescription(initialData.description)
      setMerchant(initialData.merchant || '')
      setStatus(initialData.status)
      setDate(new Date(initialData.date).toISOString().slice(0, 16))
      setNotes(initialData.notes || '')
      setExternalRef(initialData.externalRef || '')
      setFromAccount(initialData.fromAccount || 'Checking Account')
      setToAccount(initialData.toAccount || 'Savings Reserve')
      setLinkedTransactionId(initialData.linkedTransactionId || '')
    } else {
      setType('expense')
      setAmountInput('')
      setCategory('Food & dining')
      setPaymentMethod('UPI')
      setDescription('')
      setMerchant('')
      setStatus('completed')
      // Current local datetime
      const now = new Date()
      const tzOffset = now.getTimezoneOffset() * 60000
      const localISOTime = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16)
      setDate(localISOTime)
      setNotes('')
      setExternalRef('')
      setFromAccount('Checking Account')
      setToAccount('Savings Reserve')
      setLinkedTransactionId('')
    }
    setFormError(null)
    setDuplicateWarning(null)
  }, [initialData, isOpen])

  // Adjust default category when type changes
  const handleTypeChange = (newType: TransactionType) => {
    setType(newType)
    if (newType === 'income') {
      setCategory('Income')
    } else if (newType === 'transfer') {
      setCategory('Transfer')
    } else if (newType === 'refund') {
      setCategory('Groceries')
    } else {
      setCategory('Food & dining')
    }
  }

  // Determine available options for current type
  const categoryOptions = useMemo(() => {
    if (type === 'transfer') {
      return [{ id: 'transfer', name: 'Transfer', isArchived: false }]
    }

    if (availableCategories && availableCategories.length > 0) {
      const targetType = type === 'income' ? 'income' : 'expense'
      const activeCats: { id: string; name: string; rawName?: string; isArchived: boolean }[] = availableCategories
        .filter((c) => c.type === targetType && !c.isArchived)
        .map((c) => ({ id: c.id, name: c.name, isArchived: false }))

      // If editing existing transaction, preserve its category even if archived or legacy
      if (initialData?.category) {
        const found = activeCats.find((c) => c.name.toLowerCase() === initialData.category.toLowerCase())
        if (!found) {
          const archivedCat = availableCategories.find(
            (c) => c.name.toLowerCase() === initialData.category.toLowerCase()
          )
          activeCats.unshift({
            id: archivedCat?.id || 'legacy',
            name: `${initialData.category} (${archivedCat?.isArchived ? 'Archived' : 'Legacy'})`,
            rawName: initialData.category,
            isArchived: true,
          })
        }
      }
      return activeCats
    }

    const defaultNames = type === 'income' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES
    return defaultNames.map((name) => ({ id: name, name, isArchived: false }))
  }, [type, availableCategories, initialData])

  if (!isOpen) return null

  const handleSubmit = async (e: FormEvent, bypassDuplicateCheck = false) => {
    e.preventDefault()
    setFormError(null)

    // Validate amount
    const valResult = validateAmount(amountInput)
    if (!valResult.valid) {
      setFormError(valResult.error || 'Please enter a valid amount.')
      return
    }

    if (!description.trim()) {
      setFormError('Please enter a description for this entry.')
      return
    }

    const transactionDate = date ? new Date(date).toISOString() : new Date().toISOString()

    // Duplicate detection check (only for new transactions or when not bypassing)
    if (!bypassDuplicateCheck && !initialData) {
      const dupCheck = checkDuplicate({
        amount: valResult.paise,
        type,
        date: transactionDate,
        merchant: merchant.trim() || undefined,
        description: description.trim(),
        externalRef: externalRef.trim() || undefined,
      })

      if (dupCheck.isDuplicate) {
        setDuplicateWarning(dupCheck)
        return
      }
    }

    setIsSubmitting(true)
    try {
      const matchedCat = availableCategories?.find(
        (c) =>
          c.name.toLowerCase() === category.toLowerCase() &&
          (c.type === type || (type === 'refund' && c.type === 'expense'))
      )

      const payload: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
        type,
        amount: valResult.paise,
        currency: 'INR',
        date: transactionDate,
        description: description.trim(),
        merchant: merchant.trim() || undefined,
        category,
        categoryId: matchedCat?.id || initialData?.categoryId,
        paymentMethod,
        status,
        notes: notes.trim() || undefined,
        externalRef: externalRef.trim() || undefined,
        fromAccount: type === 'transfer' ? fromAccount : undefined,
        toAccount: type === 'transfer' ? toAccount : undefined,
        linkedTransactionId: type === 'refund' && linkedTransactionId ? linkedTransactionId : undefined,
        source: 'manual',
      }

      if (initialData && onUpdate) {
        await onUpdate({
          ...payload,
          id: initialData.id,
          createdAt: initialData.createdAt,
          updatedAt: new Date().toISOString(),
        })
      } else {
        await onSave(payload)
      }

      onClose()
    } catch (err) {
      console.error('Error saving transaction:', err)
      setFormError(err instanceof Error ? err.message : 'Failed to save transaction')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <form className="modal" onSubmit={(e) => handleSubmit(e, false)}>
        <header>
          <div>
            <span>{initialData ? 'EDIT ENTRY' : 'NEW ENTRY'}</span>
            <h2 id="modal-title">{initialData ? 'Edit transaction' : 'Record transaction'}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
        </header>

        {/* Duplicate warning notification banner */}
        {duplicateWarning && (
          <div
            style={{
              marginTop: '14px',
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'rgba(255, 170, 0, 0.14)',
              border: '1px solid rgba(255, 170, 0, 0.4)',
              color: '#ffb36a',
              fontSize: '11px',
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}>
              <AlertTriangle size={16} />
              <span>Potential Duplicate Detected</span>
            </div>
            <p style={{ margin: '6px 0 10px', color: 'var(--text2)' }}>
              {duplicateWarning.reason}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="outline-button"
                style={{ minHeight: '28px', fontSize: '10px' }}
                onClick={() => setDuplicateWarning(null)}
              >
                Review details
              </button>
              <button
                type="button"
                className="primary-button"
                style={{
                  minHeight: '28px',
                  fontSize: '10px',
                  background: 'linear-gradient(135deg, #f6b94d, #ea9628)',
                }}
                onClick={(e) => handleSubmit(e, true)}
                disabled={isSubmitting}
              >
                Save anyway
              </button>
            </div>
          </div>
        )}

        {/* Error notification */}
        {formError && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(248, 113, 113, 0.16)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              color: '#fca5a5',
              fontSize: '11px',
            }}
          >
            {formError}
          </div>
        )}

        {/* Transaction Type Selector */}
        <section
          className="type"
          style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', margin: '14px 0 12px' }}
        >
          <label>
            <input
              name="type"
              type="radio"
              value="expense"
              checked={type === 'expense'}
              onChange={() => handleTypeChange('expense')}
            />
            <span style={{ padding: '8px 4px', fontSize: '9px' }}>
              <ArrowUpRight size={13} />
              Expense
            </span>
          </label>
          <label>
            <input
              name="type"
              type="radio"
              value="income"
              checked={type === 'income'}
              onChange={() => handleTypeChange('income')}
            />
            <span style={{ padding: '8px 4px', fontSize: '9px' }}>
              <ArrowDownLeft size={13} />
              Income
            </span>
          </label>
          <label>
            <input
              name="type"
              type="radio"
              value="transfer"
              checked={type === 'transfer'}
              onChange={() => handleTypeChange('transfer')}
            />
            <span style={{ padding: '8px 4px', fontSize: '9px' }}>
              <ArrowLeftRight size={13} />
              Transfer
            </span>
          </label>
          <label>
            <input
              name="type"
              type="radio"
              value="refund"
              checked={type === 'refund'}
              onChange={() => handleTypeChange('refund')}
            />
            <span style={{ padding: '8px 4px', fontSize: '9px' }}>
              <RotateCcw size={13} />
              Refund
            </span>
          </label>
        </section>

        {/* Amount Input */}
        <label>
          Amount (INR)
          <div>
            <span>₹</span>
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              required
              autoFocus
            />
          </div>
        </label>

        {/* Form Grid: Category / Method */}
        <section className="form-grid">
          <label>
            Category
            <select
              name="category"
              id="transaction-category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categoryOptions.map((opt: { id: string; name: string; rawName?: string; isArchived: boolean }) => (
                <option key={opt.id} value={opt.rawName || opt.name}>
                  {opt.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Payment method
            <select
              name="method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            >
              <option value="UPI">UPI</option>
              <option value="Bank transfer">Bank transfer</option>
              <option value="Card">Card</option>
              <option value="Cash">Cash</option>
              <option value="Other">Other</option>
            </select>
          </label>
        </section>

        {/* Date & Time + Status */}
        <section className="form-grid">
          <label>
            Date and time
            <input
              name="date"
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>

          <label>
            Status
            <select
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TransactionStatus)}
            >
              <option value="completed">Completed (Confirmed)</option>
              <option value="pending">Pending (Unsettled)</option>
              <option value="failed">Failed (Excluded)</option>
            </select>
          </label>
        </section>

        {/* Transfer Specific: From / To Account */}
        {type === 'transfer' && (
          <section className="form-grid">
            <label>
              From Account
              <input
                placeholder="e.g. HDFC Checking"
                value={fromAccount}
                onChange={(e) => setFromAccount(e.target.value)}
              />
            </label>
            <label>
              To Account
              <input
                placeholder="e.g. SBI Savings"
                value={toAccount}
                onChange={(e) => setToAccount(e.target.value)}
              />
            </label>
          </section>
        )}

        {/* Refund Specific: Link to Original Purchase */}
        {type === 'refund' && existingExpenses.length > 0 && (
          <label>
            Link to original purchase (Optional)
            <select
              value={linkedTransactionId}
              onChange={(e) => setLinkedTransactionId(e.target.value)}
            >
              <option value="">-- No specific linked expense --</option>
              {existingExpenses.slice(0, 15).map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.description} (₹{exp.amount / 100} on {new Date(exp.date).toLocaleDateString('en-IN')})
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Description & Merchant */}
        <section className="form-grid">
          <label>
            Description
            <input
              name="description"
              placeholder="e.g. Fresh Basket weekly groceries"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>

          <label>
            Merchant / Recipient (Optional)
            <input
              name="merchant"
              placeholder="e.g. Fresh Basket"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </label>
        </section>

        {/* Reference ID / External Ref */}
        <label>
          Reference / UTR ID (Optional)
          <input
            name="externalRef"
            placeholder="e.g. UPI/26101901042 or Bank UTR"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
          />
        </label>

        {/* Notes */}
        <label>
          Notes (Optional)
          <input
            name="notes"
            placeholder="Additional context or receipts notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <footer>
          <button
            type="button"
            className="outline-button"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={isSubmitting}
          >
            {initialData ? <Save size={16} /> : <Plus size={16} />}
            {isSubmitting ? 'Saving...' : initialData ? 'Update transaction' : 'Save transaction'}
          </button>
        </footer>
      </form>
    </div>
  )
}
