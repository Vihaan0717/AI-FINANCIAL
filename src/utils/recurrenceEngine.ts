import type {
  RecurringSchedule,
  BillInstance,
  RecurrenceFrequency,
  BillStatus,
} from '../types/planner'

/**
 * Returns number of days in a given month (month is 1-indexed: 1 = Jan, 12 = Dec).
 * Properly accounts for leap years.
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * Checks if a given year is a leap year.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Parses YYYY-MM-DD into year, month (1-indexed), and day safely without UTC shifts.
 */
export function parseLocalDateString(dateStr: string): { year: number; month: number; day: number } {
  const parts = dateStr.slice(0, 10).split('-').map(Number)
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    const fallback = new Date()
    return {
      year: fallback.getFullYear(),
      month: fallback.getMonth() + 1,
      day: fallback.getDate(),
    }
  }
  return { year: parts[0], month: parts[1], day: parts[2] }
}

/**
 * Formats year, month, and day into YYYY-MM-DD.
 */
export function formatLocalDateString(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0')
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Gets today's date in local YYYY-MM-DD format.
 */
export function getTodayDateString(referenceDate: Date = new Date()): string {
  return formatLocalDateString(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
    referenceDate.getDate()
  )
}

/**
 * Calculates the next due date based on frequency and calendar-safe rules.
 * Preserves preferredDayOfMonth so that month-end dates (e.g. Jan 31 -> Feb 28 -> Mar 31)
 * never permanently drift into earlier days of the month.
 */
export function calculateNextDueDate(
  currentDateStr: string,
  frequency: RecurrenceFrequency,
  options?:
    | number
    | {
        preferredDayOfMonth?: number
        customIntervalDays?: number
      }
): string {
  const { year, month, day } = parseLocalDateString(currentDateStr)
  const preferredDay =
    typeof options === 'number'
      ? options
      : options?.preferredDayOfMonth ?? day
  const customInterval =
    typeof options === 'object' ? options?.customIntervalDays : undefined

  switch (frequency) {
    case 'one_time':
      return currentDateStr

    case 'daily': {
      const d = new Date(year, month - 1, day)
      d.setDate(d.getDate() + 1)
      return formatLocalDateString(d.getFullYear(), d.getMonth() + 1, d.getDate())
    }

    case 'weekly': {
      const d = new Date(year, month - 1, day)
      d.setDate(d.getDate() + 7)
      return formatLocalDateString(d.getFullYear(), d.getMonth() + 1, d.getDate())
    }

    case 'biweekly': {
      const d = new Date(year, month - 1, day)
      d.setDate(d.getDate() + 14)
      return formatLocalDateString(d.getFullYear(), d.getMonth() + 1, d.getDate())
    }

    case 'monthly': {
      let targetMonth = month + 1
      let targetYear = year
      if (targetMonth > 12) {
        targetMonth = 1
        targetYear += 1
      }
      const daysInTarget = getDaysInMonth(targetYear, targetMonth)
      const targetDay = Math.min(preferredDay, daysInTarget)
      return formatLocalDateString(targetYear, targetMonth, targetDay)
    }

    case 'quarterly': {
      let targetMonth = month + 3
      let targetYear = year
      if (targetMonth > 12) {
        targetMonth -= 12
        targetYear += 1
      }
      const daysInTarget = getDaysInMonth(targetYear, targetMonth)
      const targetDay = Math.min(preferredDay, daysInTarget)
      return formatLocalDateString(targetYear, targetMonth, targetDay)
    }

    case 'yearly': {
      const targetYear = year + 1
      const targetMonth = month
      const daysInTarget = getDaysInMonth(targetYear, targetMonth)
      const targetDay = Math.min(preferredDay, daysInTarget)
      return formatLocalDateString(targetYear, targetMonth, targetDay)
    }

    case 'custom': {
      const interval = Math.max(1, customInterval || 1)
      const d = new Date(year, month - 1, day)
      d.setDate(d.getDate() + interval)
      return formatLocalDateString(d.getFullYear(), d.getMonth() + 1, d.getDate())
    }

    default:
      return currentDateStr
  }
}

/**
 * Computes status of a bill occurrence relative to today.
 */
export function calculateBillStatus(
  dueDateStr: string,
  currentStatus?: BillStatus,
  todayStr: string = getTodayDateString()
): BillStatus {
  // Retain terminal statuses
  if (currentStatus === 'paid' || currentStatus === 'skipped' || currentStatus === 'cancelled') {
    return currentStatus
  }

  if (dueDateStr < todayStr) {
    return 'overdue'
  }
  if (dueDateStr === todayStr) {
    return 'due'
  }
  return 'upcoming'
}

/**
 * Generates upcoming bill instances up to a planning horizon.
 * - Enforces stable identities to avoid duplicates.
 * - Stops generation if schedule is paused, completed, or cancelled.
 * - Respects schedule start and end dates.
 * - Only generates the instances required for the horizon.
 */
export function generateUpcomingInstances(
  schedule: RecurringSchedule,
  horizonEndDate: string,
  existingInstances: BillInstance[] = [],
  todayStr: string = getTodayDateString()
): BillInstance[] {
  // If schedule is paused, completed, or cancelled, do not generate new upcoming instances
  if (schedule.status === 'paused' || schedule.status === 'completed' || schedule.status === 'cancelled') {
    return existingInstances.filter((inst) => inst.scheduleId === schedule.id)
  }

  const existingMap = new Map<string, BillInstance>()
  for (const inst of existingInstances) {
    if (inst.scheduleId === schedule.id) {
      existingMap.set(inst.dueDate, inst)
    }
  }

  const result: BillInstance[] = []
  const preferredDay = schedule.preferredDayOfMonth ?? parseLocalDateString(schedule.startDate).day
  let cursor = schedule.startDate
  let count = 0
  const MAX_OCCURRENCES = 120

  while (count < MAX_OCCURRENCES) {
    count++

    // Stop if past schedule end date
    if (schedule.endDate && cursor > schedule.endDate) {
      break
    }

    // Stop if past the horizon end date
    if (cursor > horizonEndDate) {
      break
    }

    const stableId = `bill_${schedule.id}_${cursor}`
    const existing = existingMap.get(cursor)

    if (existing) {
      // Update status if it wasn't settled, skipped, or cancelled
      const updatedStatus = calculateBillStatus(cursor, existing.status, todayStr)
      result.push({
        ...existing,
        status: updatedStatus,
        updatedAt: existing.updatedAt || new Date().toISOString(),
      })
    } else {
      // Create new instance
      const status = calculateBillStatus(cursor, undefined, todayStr)
      const now = new Date().toISOString()
      result.push({
        id: stableId,
        scheduleId: schedule.id,
        title: schedule.title,
        category: schedule.category,
        amountPaise: schedule.amountPaise,
        commitmentType: schedule.commitmentType,
        dueDate: cursor,
        status,
        createdAt: now,
        updatedAt: now,
        isDemo: schedule.isDemo,
      })
    }

    if (schedule.frequency === 'one_time') {
      break
    }

    const next = calculateNextDueDate(cursor, schedule.frequency, {
      preferredDayOfMonth: preferredDay,
      customIntervalDays: schedule.customIntervalDays,
    })

    if (next <= cursor) {
      // Safety against infinite loop
      break
    }

    cursor = next
  }

  return result
}
