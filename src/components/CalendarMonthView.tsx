import { useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import type { BillInstance, PlannerTask } from '../types/planner'
import {
  getDaysInMonth,
  formatLocalDateString,
  getTodayDateString,
  parseLocalDateString,
} from '../utils/recurrenceEngine'

interface CalendarMonthViewProps {
  bills: BillInstance[]
  tasks: PlannerTask[]
  selectedDate: string | null
  onSelectDate: (dateStr: string | null) => void
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const DAYS_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function CalendarMonthView({
  bills,
  tasks,
  selectedDate,
  onSelectDate,
}: CalendarMonthViewProps) {
  const todayStr = getTodayDateString()
  const todayParts = parseLocalDateString(todayStr)

  const [currentYear, setCurrentYear] = useState(todayParts.year)
  const [currentMonth, setCurrentMonth] = useState(todayParts.month) // 1-indexed

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12)
      setCurrentYear((y) => y - 1)
    } else {
      setCurrentMonth((m) => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1)
      setCurrentYear((y) => y + 1)
    } else {
      setCurrentMonth((m) => m + 1)
    }
  }

  const handleJumpToday = () => {
    setCurrentYear(todayParts.year)
    setCurrentMonth(todayParts.month)
    onSelectDate(todayStr)
  }

  // Days in current month
  const totalDays = getDaysInMonth(currentYear, currentMonth)

  // Determine starting weekday of 1st day of month
  // JS Date getDay(): 0 = Sun, 1 = Mon ... 6 = Sat
  // We want Monday = 0, Sunday = 6
  const firstDayJs = new Date(currentYear, currentMonth - 1, 1).getDay()
  const startOffset = firstDayJs === 0 ? 6 : firstDayJs - 1

  // Map bills and tasks by date
  const eventsByDate = new Map<string, { billCount: number; taskCount: number; hasOverdue: boolean }>()

  for (const b of bills) {
    const existing = eventsByDate.get(b.dueDate) || { billCount: 0, taskCount: 0, hasOverdue: false }
    existing.billCount++
    if (b.status === 'overdue') existing.hasOverdue = true
    eventsByDate.set(b.dueDate, existing)
  }

  for (const t of tasks) {
    const existing = eventsByDate.get(t.dueDate) || { billCount: 0, taskCount: 0, hasOverdue: false }
    existing.taskCount++
    eventsByDate.set(t.dueDate, existing)
  }

  return (
    <article className="panel calendar" style={{ padding: '1.25rem' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="icon-button"
            onClick={handlePrevMonth}
            aria-label="Previous month"
            title="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, minWidth: '150px', textAlign: 'center' }}>
            {MONTH_NAMES[currentMonth - 1]} {currentYear}
          </h2>
          <button
            className="icon-button"
            onClick={handleNextMonth}
            aria-label="Next month"
            title="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          className="ghost-button"
          onClick={handleJumpToday}
          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
        >
          <CalendarIcon size={13} style={{ marginRight: '4px' }} />
          Today
        </button>
      </header>

      {/* Weekday headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          textAlign: 'center',
          fontWeight: 600,
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          marginBottom: '0.5rem',
        }}
      >
        {DAYS_HEADER.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {/* Calendar Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '4px',
          textAlign: 'center',
        }}
      >
        {/* Leading empty cells */}
        {Array.from({ length: startOffset }).map((_, i) => (
          <div key={`empty-${i}`} style={{ height: '38px' }} />
        ))}

        {/* Days of month */}
        {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
          const dateStr = formatLocalDateString(currentYear, currentMonth, day)
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const ev = eventsByDate.get(dateStr)

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : dateStr)}
              style={{
                height: '38px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                border: isSelected
                  ? '2px solid var(--brand-purple)'
                  : isToday
                  ? '1px solid var(--brand-mint)'
                  : '1px solid transparent',
                background: isSelected
                  ? 'rgba(139, 92, 246, 0.15)'
                  : isToday
                  ? 'rgba(61, 217, 179, 0.08)'
                  : 'transparent',
                cursor: 'pointer',
                color: isToday ? 'var(--brand-mint)' : 'var(--text-main)',
                fontWeight: isToday || isSelected ? 700 : 500,
                fontSize: '0.85rem',
                position: 'relative',
                transition: 'all 0.15s ease',
              }}
              title={`${dateStr}${ev ? ` (${ev.billCount} bills, ${ev.taskCount} tasks)` : ''}`}
            >
              <span>{day}</span>
              {ev && (
                <div style={{ display: 'flex', gap: '3px', marginTop: '2px' }}>
                  {ev.billCount > 0 && (
                    <span
                      style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        backgroundColor: ev.hasOverdue ? '#f87171' : '#f6b94d',
                      }}
                    />
                  )}
                  {ev.taskCount > 0 && (
                    <span
                      style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        backgroundColor: '#8b5cf6',
                      }}
                    />
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {selectedDate && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            background: 'var(--bg-subtle, rgba(255,255,255,0.03))',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.8rem',
          }}
        >
          <span>
            Filtered to <strong>{selectedDate}</strong>
          </span>
          <button
            className="ghost-button"
            onClick={() => onSelectDate(null)}
            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
          >
            Clear Filter
          </button>
        </div>
      )}
    </article>
  )
}
