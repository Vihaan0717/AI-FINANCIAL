import { useState, useEffect } from 'react'
import { X, AlertCircle } from 'lucide-react'
import type {
  RecurringSchedule,
  RecurrenceFrequency,
  CommitmentType,
} from '../types/planner'
import { rupeesToPaise } from '../utils/money'
import { getTodayDateString } from '../utils/recurrenceEngine'

interface RecurringScheduleModalProps {
  isOpen: boolean
  scheduleToEdit?: RecurringSchedule | null
  onClose: () => void
  onSave: (
    schedule: Omit<RecurringSchedule, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>
}

const COMMITMENT_TYPES: { label: string; value: CommitmentType; desc: string }[] = [
  { label: 'Expense', value: 'expense', desc: 'Bills, rent, subscriptions' },
  { label: 'Savings SIP', value: 'savings', desc: 'Emergency fund, recurring deposits' },
  { label: 'Investment Contribution', value: 'investment', desc: 'Mutual fund SIP, stocks' },
  { label: 'Expected Income', value: 'income', desc: 'Salary, freelance retainer' },
  { label: 'Reminder Only', value: 'reminder_only', desc: 'Non-monetary commitment' },
]

const FREQUENCIES: { label: string; value: RecurrenceFrequency }[] = [
  { label: 'Monthly', value: 'monthly' },
  { label: 'Every two weeks (Biweekly)', value: 'biweekly' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Every three months (Quarterly)', value: 'quarterly' },
  { label: 'Yearly', value: 'yearly' },
  { label: 'Daily', value: 'daily' },
  { label: 'One-time', value: 'one_time' },
  { label: 'Custom Interval', value: 'custom' },
]

export function RecurringScheduleModal({
  isOpen,
  scheduleToEdit,
  onClose,
  onSave,
}: RecurringScheduleModalProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Utilities')
  const [amountRupees, setAmountRupees] = useState('')
  const [commitmentType, setCommitmentType] = useState<CommitmentType>('expense')
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly')
  const [customDays, setCustomDays] = useState('30')
  const [startDate, setStartDate] = useState(getTodayDateString())
  const [endDate, setEndDate] = useState('')
  const [leadDays, setLeadDays] = useState('3')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (scheduleToEdit) {
      setTitle(scheduleToEdit.title)
      setCategory(scheduleToEdit.category)
      setAmountRupees(
        scheduleToEdit.amountPaise !== undefined
          ? (scheduleToEdit.amountPaise / 100).toString()
          : ''
      )
      setCommitmentType(scheduleToEdit.commitmentType)
      setFrequency(scheduleToEdit.frequency)
      setCustomDays(scheduleToEdit.customIntervalDays?.toString() || '30')
      setStartDate(scheduleToEdit.startDate)
      setEndDate(scheduleToEdit.endDate || '')
      setLeadDays(scheduleToEdit.notificationLeadDays?.toString() || '3')
      setNotes(scheduleToEdit.notes || '')
    } else {
      setTitle('')
      setCategory('Utilities')
      setAmountRupees('')
      setCommitmentType('expense')
      setFrequency('monthly')
      setCustomDays('30')
      setStartDate(getTodayDateString())
      setEndDate('')
      setLeadDays('3')
      setNotes('')
    }
    setError(null)
  }, [scheduleToEdit, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('Schedule title is required.')
      return
    }

    if (!startDate) {
      setError('Start date is required.')
      return
    }

    let parsedAmountPaise: number | undefined = undefined
    if (commitmentType !== 'reminder_only') {
      const num = parseFloat(amountRupees)
      if (isNaN(num) || num < 0) {
        setError('Please enter a valid, non-negative monetary amount.')
        return
      }
      parsedAmountPaise = rupeesToPaise(num)
    }

    const preferredDay = parseInt(startDate.slice(8, 10), 10)

    setSubmitting(true)
    try {
      await onSave({
        title: title.trim(),
        category,
        amountPaise: parsedAmountPaise,
        commitmentType,
        frequency,
        customIntervalDays: frequency === 'custom' ? parseInt(customDays, 10) || 30 : undefined,
        preferredDayOfMonth: preferredDay,
        startDate,
        endDate: endDate || undefined,
        nextDueDate: startDate,
        notificationLeadDays: parseInt(leadDays, 10) || 3,
        status: scheduleToEdit?.status || 'active',
        notes: notes.trim() || undefined,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save recurring schedule.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '580px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h3>{scheduleToEdit ? 'Edit Recurring Schedule' : 'New Recurring Commitment'}</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
              Automate tracking for rent, bills, SIPs, and periodic commitments.
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </header>

        {error && (
          <div className="budget-alert-card warning" style={{ margin: '1rem 0' }}>
            <AlertCircle size={18} />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="field-label">Commitment Title *</label>
            <input
              type="text"
              className="text-input"
              placeholder="e.g. House Rent, Mobile Recharge, Nifty 50 SIP"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="field-label">Commitment Type</label>
              <select
                className="select-input"
                value={commitmentType}
                onChange={(e) => setCommitmentType(e.target.value as CommitmentType)}
              >
                {COMMITMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label">Category</label>
              <select
                className="select-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="Home">Home & Rent</option>
                <option value="Utilities">Utilities & Bills</option>
                <option value="Investment">Investment & Wealth</option>
                <option value="Food & dining">Food & Groceries</option>
                <option value="Transport">Transport & Auto</option>
                <option value="Health">Health & Insurance</option>
                <option value="Entertainment">Entertainment & Subs</option>
                <option value="Income">Income / Retainer</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          {commitmentType !== 'reminder_only' && (
            <div>
              <label className="field-label">Amount (₹) *</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }}>
                  ₹
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="text-input"
                  style={{ paddingLeft: '28px' }}
                  placeholder="0.00"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="field-label">Recurrence Frequency</label>
              <select
                className="select-input"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {frequency === 'custom' ? (
              <div>
                <label className="field-label">Interval (Days)</label>
                <input
                  type="number"
                  min="1"
                  className="text-input"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <label className="field-label">Alert Lead Time (Days)</label>
                <select
                  className="select-input"
                  value={leadDays}
                  onChange={(e) => setLeadDays(e.target.value)}
                >
                  <option value="0">On due date only</option>
                  <option value="1">1 day before</option>
                  <option value="2">2 days before</option>
                  <option value="3">3 days before</option>
                  <option value="5">5 days before</option>
                  <option value="7">1 week before</option>
                </select>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="field-label">Start Date *</label>
              <input
                type="date"
                className="text-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label">End Date (Optional)</label>
              <input
                type="date"
                className="text-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="field-label">Notes (Optional)</label>
            <textarea
              className="text-input"
              rows={2}
              placeholder="e.g. Landlord account details, policy number, billing link"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <footer className="modal-footer" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="ghost-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Saving...' : scheduleToEdit ? 'Save Changes' : 'Create Schedule'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
