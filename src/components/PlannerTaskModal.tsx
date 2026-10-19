import { useState, useEffect } from 'react'
import { X, AlertCircle } from 'lucide-react'
import type { PlannerTask, TaskPriority, TaskCategory } from '../types/planner'
import { getTodayDateString } from '../utils/recurrenceEngine'

interface PlannerTaskModalProps {
  isOpen: boolean
  taskToEdit?: PlannerTask | null
  initialDate?: string
  onClose: () => void
  onSave: (task: Omit<PlannerTask, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
}

const CATEGORIES: { label: string; value: TaskCategory }[] = [
  { label: 'Personal Task', value: 'task' },
  { label: 'Appointment / Meeting', value: 'appointment' },
  { label: 'Important Date / Deadline', value: 'important_date' },
  { label: 'Bill Reminder', value: 'bill_reminder' },
  { label: 'General Reminder', value: 'general' },
]

const PRIORITIES: { label: string; value: TaskPriority }[] = [
  { label: 'Highest Priority', value: 'highest' },
  { label: 'High Priority', value: 'high' },
  { label: 'Medium Priority', value: 'medium' },
  { label: 'Low Priority', value: 'low' },
]

export function PlannerTaskModal({
  isOpen,
  taskToEdit,
  initialDate,
  onClose,
  onSave,
}: PlannerTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(initialDate || getTodayDateString())
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [category, setCategory] = useState<TaskCategory>('task')
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('none')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title)
      setDescription(taskToEdit.description || '')
      setDueDate(taskToEdit.dueDate)
      setDueTime(taskToEdit.dueTime || '')
      setPriority(taskToEdit.priority)
      setCategory(taskToEdit.category)
      setRecurrence(taskToEdit.recurrence || 'none')
    } else {
      setTitle('')
      setDescription('')
      setDueDate(initialDate || getTodayDateString())
      setDueTime('')
      setPriority('medium')
      setCategory('task')
      setRecurrence('none')
    }
    setError(null)
  }, [taskToEdit, initialDate, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!title.trim()) {
      setError('Task title is required.')
      return
    }

    if (!dueDate) {
      setError('Due date is required.')
      return
    }

    setSubmitting(true)
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate,
        dueTime: dueTime.trim() || undefined, // undefined -> all-day task
        priority,
        category,
        status: taskToEdit?.status || 'pending',
        recurrence: recurrence !== 'none' ? recurrence : undefined,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save task.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '520px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h3>{taskToEdit ? 'Edit Task or Reminder' : 'New Task or Reminder'}</h3>
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
              Schedule personal tasks, appointments, and deadlines.
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
            <label className="field-label">Title *</label>
            <input
              type="text"
              className="text-input"
              placeholder="e.g. Call dentist, Review insurance quote, Pay electricity bill"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="field-label">Category</label>
              <select
                className="select-input"
                value={category}
                onChange={(e) => setCategory(e.target.value as TaskCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label">Priority</label>
              <select
                className="select-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div>
              <label className="field-label">Due Date *</label>
              <input
                type="date"
                className="text-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label">Time (Optional)</label>
              <input
                type="time"
                className="text-input"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                placeholder="All day"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {dueTime ? `Scheduled at ${dueTime}` : 'All-day task if blank'}
              </span>
            </div>
          </div>

          <div>
            <label className="field-label">Repeat</label>
            <select
              className="select-input"
              value={recurrence}
              onChange={(e) =>
                setRecurrence(e.target.value as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly')
              }
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div>
            <label className="field-label">Description / Notes</label>
            <textarea
              className="text-input"
              rows={2}
              placeholder="Add details, location, or checklist notes..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <footer className="modal-footer" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="ghost-button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Saving...' : taskToEdit ? 'Save Changes' : 'Create Task'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
