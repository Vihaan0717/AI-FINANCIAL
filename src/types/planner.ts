export type RecurrenceFrequency =
  | 'one_time'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'custom'

export type CommitmentType =
  | 'expense'
  | 'savings'
  | 'investment'
  | 'income'
  | 'reminder_only'

export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'cancelled'

export type BillStatus =
  | 'upcoming'
  | 'due'
  | 'overdue'
  | 'paid'
  | 'skipped'
  | 'cancelled'

export type TaskPriority = 'highest' | 'high' | 'medium' | 'low'

export type TaskCategory =
  | 'task'
  | 'appointment'
  | 'important_date'
  | 'bill_reminder'
  | 'general'

export interface RecurringSchedule {
  id: string
  title: string
  category: string
  amountPaise?: number // Integer paise when applicable
  commitmentType: CommitmentType
  frequency: RecurrenceFrequency
  customIntervalDays?: number
  preferredDayOfMonth?: number // e.g. 31 for month-end schedules, preserved across short months
  startDate: string // YYYY-MM-DD
  endDate?: string // YYYY-MM-DD (optional)
  nextDueDate: string // YYYY-MM-DD
  notificationLeadDays?: number // Days before due date to alert (default: 3)
  status: ScheduleStatus
  notes?: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  isDemo?: boolean
}

export interface BillInstance {
  id: string // Stable ID: bill_${scheduleId}_${dueDate} or standalone ID
  scheduleId?: string // Parent recurring schedule ID, if applicable
  title: string
  category: string
  amountPaise?: number // Integer paise
  commitmentType: CommitmentType
  dueDate: string // YYYY-MM-DD
  status: BillStatus
  linkedTransactionId?: string // Financial transaction ID if settled and recorded
  paidDate?: string // YYYY-MM-DD or ISO
  notes?: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  isDemo?: boolean
}

export interface PlannerTask {
  id: string
  title: string
  description?: string
  dueDate: string // YYYY-MM-DD
  dueTime?: string // HH:mm (optional; if missing, treated as all-day task)
  priority: TaskPriority
  category: TaskCategory
  status: 'pending' | 'completed' | 'cancelled'
  completedAt?: string // ISO 8601
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
  reminderLeadMinutes?: number
  linkedBillId?: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  isDemo?: boolean
}

export interface BudgetForecastResult {
  confirmedSpendingPaise: number
  pendingTransactionsPaise: number
  upcomingScheduledExpensesPaise: number
  plannedSavingsPaise: number
  plannedInvestmentPaise: number
  totalUpcomingCommitmentsPaise: number
  projectedTotalSpendingPaise: number
  userBudgetLimitPaise?: number
  hasBudgetConfigured: boolean
  estimatedRemainingBudgetPaise?: number
  estimatedSpendableBufferPaise: number
  overdueBillsCount: number
  dueTodayBillsCount: number
  explanation: string
  warnings: string[]
}

export interface PlannerNotification {
  id: string
  title: string
  message: string
  type: 'bill_overdue' | 'bill_due_today' | 'bill_upcoming' | 'task_reminder'
  dueDate: string
  amountPaise?: number
  linkedId: string // Bill ID or Task ID
  dismissed: boolean
  createdAt: string
}
