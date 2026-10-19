import type { Transaction } from '../types/transaction'
import type {
  BillInstance,
  PlannerTask,
  BudgetForecastResult,
  PlannerNotification,
} from '../types/planner'
import { calculateFinancialSummary } from './calculations'
import { addPaise, subtractPaise, formatPaise } from './money'
import { getTodayDateString, parseLocalDateString } from './recurrenceEngine'

/**
 * Calculates a deterministic budget forecast incorporating upcoming recurring commitments.
 * Strict rules:
 * - Authoritative transaction engine remains source of truth for confirmed spending.
 * - Confirmed expenses, pending transactions, and scheduled commitments are distinguished.
 * - Savings and investment contributions are separated from ordinary operational expenses.
 * - Bills already paid or linked to a transaction are NEVER double-counted.
 * - Projections are never described as actual bank balances.
 * - Missing budgets are clearly stated rather than fabricated.
 */
export function forecastBudgetWithCommitments(
  transactions: Transaction[],
  bills: BillInstance[],
  userBudgetLimitPaise?: number,
  todayStr: string = getTodayDateString()
): BudgetForecastResult {
  const financialSummary = calculateFinancialSummary(transactions)
  const confirmedSpendingPaise = financialSummary.totalConfirmedExpenses
  const pendingTransactionsPaise = financialSummary.totalPendingExpenses
  const estimatedSpendableBufferPaise = financialSummary.estimatedSpendable

  let upcomingScheduledExpensesPaise = 0
  let plannedSavingsPaise = 0
  let plannedInvestmentPaise = 0
  let overdueBillsCount = 0
  let dueTodayBillsCount = 0

  // Filter bills for active upcoming commitments
  for (const b of bills) {
    // If bill was already paid, skipped, cancelled, or linked to an existing financial transaction,
    // do not count it as an upcoming commitment!
    if (b.status === 'paid' || b.status === 'skipped' || b.status === 'cancelled' || b.linkedTransactionId) {
      continue
    }

    if (b.status === 'overdue' || b.dueDate < todayStr) {
      overdueBillsCount++
    } else if (b.status === 'due' || b.dueDate === todayStr) {
      dueTodayBillsCount++
    }

    const amount = b.amountPaise || 0

    if (b.commitmentType === 'expense') {
      upcomingScheduledExpensesPaise = addPaise(upcomingScheduledExpensesPaise, amount)
    } else if (b.commitmentType === 'savings') {
      plannedSavingsPaise = addPaise(plannedSavingsPaise, amount)
    } else if (b.commitmentType === 'investment') {
      plannedInvestmentPaise = addPaise(plannedInvestmentPaise, amount)
    }
  }

  const totalUpcomingCommitmentsPaise = addPaise(
    upcomingScheduledExpensesPaise,
    addPaise(plannedSavingsPaise, plannedInvestmentPaise)
  )

  const projectedTotalSpendingPaise = addPaise(
    confirmedSpendingPaise,
    upcomingScheduledExpensesPaise
  )

  const hasBudgetConfigured =
    userBudgetLimitPaise !== undefined &&
    Number.isFinite(userBudgetLimitPaise) &&
    userBudgetLimitPaise > 0

  const warnings: string[] = []
  let explanation = ''
  let estimatedRemainingBudgetPaise: number | undefined = undefined

  if (overdueBillsCount > 0) {
    warnings.push(`You have ${overdueBillsCount} overdue commitment(s) requiring immediate attention.`)
  }

  if (dueTodayBillsCount > 0) {
    warnings.push(`${dueTodayBillsCount} commitment(s) are due today.`)
  }

  if (pendingTransactionsPaise > 0) {
    warnings.push(
      `${formatPaise(pendingTransactionsPaise)} in pending transactions is awaiting bank settlement.`
    )
  }

  if (hasBudgetConfigured) {
    const budget = userBudgetLimitPaise!
    estimatedRemainingBudgetPaise = subtractPaise(budget, projectedTotalSpendingPaise)

    if (projectedTotalSpendingPaise <= budget) {
      explanation = `Within budget: Confirmed spending (${formatPaise(
        confirmedSpendingPaise
      )}) + Upcoming expenses (${formatPaise(
        upcomingScheduledExpensesPaise
      )}) leaves ${formatPaise(estimatedRemainingBudgetPaise)} of your ₹${(budget / 100).toFixed(0)} limit.`
    } else {
      const overage = subtractPaise(projectedTotalSpendingPaise, budget)
      explanation = `Upcoming commitments project your spending to exceed your budget limit by ${formatPaise(
        overage
      )}. Confirmed spending is currently ${formatPaise(confirmedSpendingPaise)}.`
    }
  } else {
    explanation = `Budget limit is not configured. Confirmed spending is ${formatPaise(
      confirmedSpendingPaise
    )}, with ${formatPaise(upcomingScheduledExpensesPaise)} in upcoming scheduled expenses and ${formatPaise(
      plannedSavingsPaise + plannedInvestmentPaise
    )} in planned savings/investments.`
  }

  return {
    confirmedSpendingPaise,
    pendingTransactionsPaise,
    upcomingScheduledExpensesPaise,
    plannedSavingsPaise,
    plannedInvestmentPaise,
    totalUpcomingCommitmentsPaise,
    projectedTotalSpendingPaise,
    userBudgetLimitPaise: hasBudgetConfigured ? userBudgetLimitPaise : undefined,
    hasBudgetConfigured,
    estimatedRemainingBudgetPaise,
    estimatedSpendableBufferPaise,
    overdueBillsCount,
    dueTodayBillsCount,
    explanation,
    warnings,
  }
}

/**
 * Gathers active in-app notifications for due bills and pending tasks,
 * excluding previously dismissed alerts.
 */
export function getActivePlannerNotifications(
  bills: BillInstance[],
  tasks: PlannerTask[],
  dismissedIds: string[] = [],
  todayStr: string = getTodayDateString()
): PlannerNotification[] {
  const dismissedSet = new Set(dismissedIds)
  const notifications: PlannerNotification[] = []
  const todayParts = parseLocalDateString(todayStr)
  const todayDate = new Date(todayParts.year, todayParts.month - 1, todayParts.day)

  // 1. Process Bills
  for (const b of bills) {
    if (b.status === 'paid' || b.status === 'skipped' || b.status === 'cancelled') {
      continue
    }

    const billParts = parseLocalDateString(b.dueDate)
    const billDate = new Date(billParts.year, billParts.month - 1, billParts.day)
    const diffDays = Math.round((billDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))

    let type: PlannerNotification['type'] | null = null
    let message = ''

    if (diffDays < 0) {
      type = 'bill_overdue'
      message = `Overdue by ${Math.abs(diffDays)} day(s): ${b.title}${
        b.amountPaise ? ` (${formatPaise(b.amountPaise)})` : ''
      }`
    } else if (diffDays === 0) {
      type = 'bill_due_today'
      message = `Due today: ${b.title}${b.amountPaise ? ` (${formatPaise(b.amountPaise)})` : ''}`
    } else if (diffDays <= 3) {
      type = 'bill_upcoming'
      message = `Due in ${diffDays} day(s) on ${b.dueDate}: ${b.title}${
        b.amountPaise ? ` (${formatPaise(b.amountPaise)})` : ''
      }`
    }

    if (type) {
      const alertId = `alert_bill_${b.id}_${type}`
      if (!dismissedSet.has(alertId)) {
        notifications.push({
          id: alertId,
          title: type === 'bill_overdue' ? 'Overdue Bill' : type === 'bill_due_today' ? 'Bill Due Today' : 'Upcoming Bill',
          message,
          type,
          dueDate: b.dueDate,
          amountPaise: b.amountPaise,
          linkedId: b.id,
          dismissed: false,
          createdAt: new Date().toISOString(),
        })
      }
    }
  }

  // 2. Process Tasks
  for (const t of tasks) {
    if (t.status === 'completed' || t.status === 'cancelled') {
      continue
    }

    const taskParts = parseLocalDateString(t.dueDate)
    const taskDate = new Date(taskParts.year, taskParts.month - 1, taskParts.day)
    const diffDays = Math.round((taskDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays <= 0) {
      const alertId = `alert_task_${t.id}`
      if (!dismissedSet.has(alertId)) {
        notifications.push({
          id: alertId,
          title: diffDays < 0 ? 'Overdue Task' : 'Task Due Today',
          message: diffDays < 0 ? `Overdue task: ${t.title}` : `Due today: ${t.title}${t.dueTime ? ` at ${t.dueTime}` : ''}`,
          type: 'task_reminder',
          dueDate: t.dueDate,
          linkedId: t.id,
          dismissed: false,
          createdAt: new Date().toISOString(),
        })
      }
    }
  }

  return notifications.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}
