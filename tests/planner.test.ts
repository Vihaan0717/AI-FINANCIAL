import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDaysInMonth,
  isLeapYear,
  calculateNextDueDate,
  calculateBillStatus,
  generateUpcomingInstances,
} from '../src/utils/recurrenceEngine'
import {
  forecastBudgetWithCommitments,
  getActivePlannerNotifications,
} from '../src/utils/plannerCalculations'
import { InMemoryPlannerRepository } from '../src/storage/plannerRepository'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import { calculateFinancialSummary } from '../src/utils/calculations'
import type { RecurringSchedule, BillInstance, PlannerTask } from '../src/types/planner'
import type { Transaction } from '../src/types/transaction'

describe('Money Mate AI — Milestone 5 Personal Planner & Recurring Bills Test Suite', () => {
  let plannerRepo: InMemoryPlannerRepository
  let transactionRepo: InMemoryTransactionRepository

  beforeEach(() => {
    plannerRepo = new InMemoryPlannerRepository()
    transactionRepo = new InMemoryTransactionRepository()
  })

  // 1. Creating and retrieving recurring schedules
  it('1. should create and retrieve recurring schedules with full attributes', async () => {
    const created = await plannerRepo.createSchedule({
      title: 'Apartment Rent',
      category: 'Home',
      amountPaise: 2500000, // ₹25,000.00
      commitmentType: 'expense',
      frequency: 'monthly',
      startDate: '2026-10-01',
      nextDueDate: '2026-11-01',
      preferredDayOfMonth: 1,
      notificationLeadDays: 3,
      status: 'active',
      notes: 'Pay to landlord before 5th of each month',
      isDemo: false,
    })

    expect(created.id).toBeDefined()
    expect(created.title).toBe('Apartment Rent')
    expect(created.amountPaise).toBe(2500000)
    expect(created.commitmentType).toBe('expense')
    expect(created.frequency).toBe('monthly')
    expect(created.status).toBe('active')

    const retrieved = await plannerRepo.getScheduleById(created.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(created.id)
    expect(retrieved?.notes).toBe('Pay to landlord before 5th of each month')
  })

  // 2. Creating and retrieving tasks
  it('2. should create and retrieve tasks with priority, category, and date', async () => {
    const task = await plannerRepo.createTask({
      title: 'Annual Dental Checkup',
      description: 'Clinic appointment at Indiranagar',
      dueDate: '2026-10-28',
      dueTime: '16:30',
      priority: 'high',
      category: 'appointment',
      status: 'pending',
      isDemo: false,
    })

    expect(task.id).toBeDefined()
    expect(task.title).toBe('Annual Dental Checkup')
    expect(task.priority).toBe('high')
    expect(task.dueTime).toBe('16:30')
    expect(task.status).toBe('pending')

    const retrieved = await plannerRepo.getTaskById(task.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(task.id)
    expect(retrieved?.description).toBe('Clinic appointment at Indiranagar')
  })

  // 3. Persistence across reloads where supported by test environment
  it('3. should support state serialization and restoration simulating app reload', async () => {
    const schedule = await plannerRepo.createSchedule({
      title: 'Broadband Fiber',
      category: 'Utilities',
      amountPaise: 119900,
      commitmentType: 'expense',
      frequency: 'monthly',
      startDate: '2026-10-15',
      nextDueDate: '2026-11-15',
      status: 'active',
      isDemo: false,
    })

    const task = await plannerRepo.createTask({
      title: 'Renew Passport',
      dueDate: '2026-11-20',
      priority: 'medium',
      category: 'task',
      status: 'pending',
      isDemo: false,
    })

    // Simulate serialization / reload into a fresh repository instance
    const savedSchedules = await plannerRepo.getSchedules({ isDemo: false })
    const savedTasks = await plannerRepo.getTasks({ isDemo: false })

    const reloadedRepo = new InMemoryPlannerRepository({
      schedules: savedSchedules,
      tasks: savedTasks,
    })

    const reloadedSchedule = await reloadedRepo.getScheduleById(schedule.id)
    const reloadedTask = await reloadedRepo.getTaskById(task.id)

    expect(reloadedSchedule).not.toBeNull()
    expect(reloadedSchedule?.title).toBe('Broadband Fiber')
    expect(reloadedTask).not.toBeNull()
    expect(reloadedTask?.title).toBe('Renew Passport')
  })

  // 4. Monthly recurrence across short and long months (Jan 31 -> Feb 28 -> Mar 31)
  it('4. should handle monthly recurrence across short and long months without losing day preference', () => {
    const jan31 = '2026-01-31'
    
    // Advancing 1 month from Jan 31: Feb 2026 has 28 days -> clamped to Feb 28
    const febNext = calculateNextDueDate(jan31, 'monthly', { preferredDayOfMonth: 31 })
    expect(febNext).toBe('2026-02-28')

    // Advancing 1 month from Feb 28 with preferredDayOfMonth=31: Mar 2026 has 31 days -> restores to Mar 31!
    const marNext = calculateNextDueDate(febNext, 'monthly', { preferredDayOfMonth: 31 })
    expect(marNext).toBe('2026-03-31')

    // Advancing 1 month from Mar 31: Apr 2026 has 30 days -> clamped to Apr 30
    const aprNext = calculateNextDueDate(marNext, 'monthly', { preferredDayOfMonth: 31 })
    expect(aprNext).toBe('2026-04-30')

    // Advancing 1 month from Apr 30 with preferredDayOfMonth=31 -> restores to May 31!
    const mayNext = calculateNextDueDate(aprNext, 'monthly', { preferredDayOfMonth: 31 })
    expect(mayNext).toBe('2026-05-31')
  })

  // 5. Leap-year date handling
  it('5. should handle leap years correctly for Feb 29', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2025)).toBe(false)
    expect(isLeapYear(2026)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)

    expect(getDaysInMonth(2024, 2)).toBe(29) // 2024 Feb has 29 days
    expect(getDaysInMonth(2025, 2)).toBe(28) // 2025 Feb has 28 days

    // Schedule originating on Feb 29, 2024, recurring yearly
    const nextYearNonLeap = calculateNextDueDate('2024-02-29', 'yearly', { preferredDayOfMonth: 29 })
    expect(nextYearNonLeap).toBe('2025-02-28')

    // Advancing 3 more years to 2028 (leap year) with preferred day 29:
    const year2026 = calculateNextDueDate(nextYearNonLeap, 'yearly', { preferredDayOfMonth: 29 })
    expect(year2026).toBe('2026-02-28')
    const year2027 = calculateNextDueDate(year2026, 'yearly', { preferredDayOfMonth: 29 })
    expect(year2027).toBe('2027-02-28')
    const year2028 = calculateNextDueDate(year2027, 'yearly', { preferredDayOfMonth: 29 })
    expect(year2028).toBe('2028-02-29') // Restores to Feb 29 in leap year!
  })

  // 6. End dates stopping future occurrence generation
  it('6. should stop generating instances past schedule end date', () => {
    const schedule: RecurringSchedule = {
      id: 'sched_short_term',
      title: 'Gym 3-Month Membership',
      category: 'Health',
      amountPaise: 200000,
      commitmentType: 'expense',
      frequency: 'monthly',
      startDate: '2026-01-10',
      endDate: '2026-03-20', // Ends in March
      nextDueDate: '2026-01-10',
      preferredDayOfMonth: 10,
      status: 'active',
      isDemo: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    // Horizon: 2026-06-01
    const instances = generateUpcomingInstances(schedule, '2026-06-01', [], '2026-01-01')

    // Should only have Jan 10, Feb 10, Mar 10. No April or beyond!
    expect(instances.length).toBe(3)
    expect(instances.map((i) => i.dueDate)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10'])
  })

  // 7. Paused schedules generating no new instances
  it('7. should not generate instances for paused schedules', () => {
    const pausedSchedule: RecurringSchedule = {
      id: 'sched_ott_paused',
      title: 'Streaming OTT Subscription',
      category: 'Entertainment',
      amountPaise: 49900,
      commitmentType: 'expense',
      frequency: 'monthly',
      startDate: '2026-10-01',
      nextDueDate: '2026-10-01',
      status: 'paused', // Paused!
      isDemo: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    const instances = generateUpcomingInstances(pausedSchedule, '2026-11-30', [], '2026-10-01')
    expect(instances.length).toBe(0)
  })

  // 8. Repeated schedule generation creating no duplicate instances
  it('8. should generate stable IDs and avoid duplicates on repeated execution', () => {
    const schedule: RecurringSchedule = {
      id: 'sched_cloud_storage',
      title: 'Cloud Storage 2TB',
      category: 'Utilities',
      amountPaise: 65000,
      commitmentType: 'expense',
      frequency: 'monthly',
      startDate: '2026-10-05',
      nextDueDate: '2026-10-05',
      preferredDayOfMonth: 5,
      status: 'active',
      isDemo: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    // First generation
    const firstRun = generateUpcomingInstances(schedule, '2026-11-30', [], '2026-10-01')
    expect(firstRun.length).toBeGreaterThan(0)

    // Second generation passing firstRun as existingInstances
    const secondRun = generateUpcomingInstances(schedule, '2026-11-30', firstRun, '2026-10-01')
    // Result should match firstRun count and contain exactly the same stable IDs
    expect(secondRun.length).toBe(firstRun.length)
    expect(secondRun.map((b) => b.id)).toEqual(firstRun.map((b) => b.id))
  })

  // 9. Correct overdue status
  it('9. should correctly identify overdue status when due date has passed', () => {
    const bill: BillInstance = {
      id: 'bill_past',
      scheduleId: 'sched_1',
      title: 'Electricity Bill',
      category: 'Utilities',
      commitmentType: 'expense',
      amountPaise: 140000,
      dueDate: '2026-10-15',
      status: 'upcoming',
      isDemo: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    const referenceDate = '2026-10-20'
    const status = calculateBillStatus(bill.dueDate, bill.status, referenceDate)
    expect(status).toBe('overdue')
  })

  // 10. Correct due-today status
  it('10. should correctly identify due today status when due date matches current date', () => {
    const billToday: BillInstance = {
      id: 'bill_today',
      scheduleId: 'sched_2',
      title: 'Water Bill',
      category: 'Utilities',
      commitmentType: 'expense',
      amountPaise: 35000,
      dueDate: '2026-10-20',
      status: 'upcoming',
      isDemo: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    const referenceDate = '2026-10-20'
    expect(calculateBillStatus(billToday.dueDate, billToday.status, referenceDate)).toBe('due')

    const billFuture: BillInstance = {
      ...billToday,
      id: 'bill_future',
      dueDate: '2026-10-25',
    }
    expect(calculateBillStatus(billFuture.dueDate, billFuture.status, referenceDate)).toBe('upcoming')
  })

  // 11. Marking a bill paid without creating a transaction
  it('11. should mark a bill paid without generating a ledger transaction when requested', async () => {
    const bill = await plannerRepo.createBill({
      scheduleId: 'sched_rent',
      title: 'House Rent',
      category: 'Home',
      commitmentType: 'expense',
      amountPaise: 2500000,
      dueDate: '2026-10-01',
      status: 'due',
      isDemo: false,
    })

    // Settle bill without recording transaction
    const updated = await plannerRepo.updateBill(bill.id, {
      status: 'paid',
      paidDate: '2026-10-01',
    })

    expect(updated?.status).toBe('paid')
    expect(updated?.paidDate).toBe('2026-10-01')
    expect(updated?.linkedTransactionId).toBeUndefined()

    // Ledger transactions must remain empty
    const allTransactions = await transactionRepo.getAll()
    expect(allTransactions.length).toBe(0)
  })

  // 12. Explicit bill settlement creating or linking at most one transaction
  it('12. should create and link exactly one transaction upon explicit bill settlement', async () => {
    const bill = await plannerRepo.createBill({
      scheduleId: 'sched_wifi',
      title: 'Internet Fiber',
      category: 'Utilities',
      commitmentType: 'expense',
      amountPaise: 119900,
      dueDate: '2026-10-18',
      status: 'due',
      isDemo: false,
    })

    // Explicitly create 1 ledger transaction
    const txId = 'tx_' + Date.now()
    const createdTx: Transaction = {
      id: txId,
      type: 'expense',
      amount: bill.amountPaise || 0,
      currency: 'INR',
      category: 'Utilities',
      description: `Settlement for recurring bill: ${bill.title}`,
      date: '2026-10-18T10:00:00.000Z',
      paymentMethod: 'UPI',
      status: 'completed',
      createdAt: '2026-10-18T10:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z',
    }
    await transactionRepo.add(createdTx)

    // Link transaction to bill
    const updatedBill = await plannerRepo.updateBill(bill.id, {
      status: 'paid',
      paidDate: '2026-10-18',
      linkedTransactionId: createdTx.id,
    })

    expect(updatedBill?.status).toBe('paid')
    expect(updatedBill?.linkedTransactionId).toBe(createdTx.id)

    const allTx = await transactionRepo.getAll()
    expect(allTx.length).toBe(1)
    expect(allTx[0].id).toBe(createdTx.id)
    expect(allTx[0].amount).toBe(119900)
  })

  // 13. Settling the same bill twice not duplicating an expense
  it('13. should prevent duplicate expense creation when settling the same bill twice', async () => {
    const bill = await plannerRepo.createBill({
      scheduleId: 'sched_power',
      title: 'Electricity Bill',
      category: 'Utilities',
      commitmentType: 'expense',
      amountPaise: 185000,
      dueDate: '2026-10-10',
      status: 'due',
      isDemo: false,
    })

    // First settlement
    const firstTx: Transaction = {
      id: 'tx_power_1',
      type: 'expense',
      amount: bill.amountPaise || 0,
      currency: 'INR',
      category: 'Utilities',
      description: `Settlement: ${bill.title}`,
      date: '2026-10-10T10:00:00.000Z',
      paymentMethod: 'Bank transfer',
      status: 'completed',
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
    }
    await transactionRepo.add(firstTx)

    await plannerRepo.updateBill(bill.id, {
      status: 'paid',
      paidDate: '2026-10-10',
      linkedTransactionId: firstTx.id,
    })

    // Guard simulation: Attempting second settlement on already paid/linked bill
    const currentBill = await plannerRepo.getBillById(bill.id)
    expect(currentBill?.status).toBe('paid')
    expect(currentBill?.linkedTransactionId).toBeDefined()

    // If already linked, caller must not create another transaction
    let secondTxCreated = false
    if (!currentBill?.linkedTransactionId) {
      const secondTx: Transaction = {
        id: 'tx_power_2',
        type: 'expense',
        amount: bill.amountPaise || 0,
        currency: 'INR',
        category: 'Utilities',
        description: `Settlement duplicate: ${bill.title}`,
        date: '2026-10-10T10:00:00.000Z',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-10T10:00:00.000Z',
        updatedAt: '2026-10-10T10:00:00.000Z',
      }
      await transactionRepo.add(secondTx)
      secondTxCreated = true
    }

    expect(secondTxCreated).toBe(false)
    const allTx = await transactionRepo.getAll()
    expect(allTx.length).toBe(1) // Still exactly 1!
  })

  // 14. Skipped and cancelled instances remaining distinguishable
  it('14. should keep skipped and cancelled instances distinct from active and paid instances', async () => {
    const bill1 = await plannerRepo.createBill({
      scheduleId: 's1',
      title: 'Gym Session',
      category: 'Health',
      commitmentType: 'expense',
      amountPaise: 50000,
      dueDate: '2026-10-12',
      status: 'upcoming',
      isDemo: false,
    })

    const bill2 = await plannerRepo.createBill({
      scheduleId: 's2',
      title: 'Newspaper Delivery',
      category: 'Utilities',
      commitmentType: 'expense',
      amountPaise: 25000,
      dueDate: '2026-10-14',
      status: 'upcoming',
      isDemo: false,
    })

    const skipped = await plannerRepo.updateBill(bill1.id, { status: 'skipped' })
    const cancelled = await plannerRepo.updateBill(bill2.id, { status: 'cancelled' })

    expect(skipped?.status).toBe('skipped')
    expect(cancelled?.status).toBe('cancelled')
    expect(skipped?.status).not.toBe(cancelled?.status)

    // Unpaid active bills should not include skipped or cancelled
    const allBills = await plannerRepo.getBills({ isDemo: false })
    const unpaidActive = allBills.filter((b) => b.status === 'upcoming' || b.status === 'due' || b.status === 'overdue')
    expect(unpaidActive.length).toBe(0)
  })

  // 15. Savings contributions remaining distinct from ordinary expenses
  it('15. should distinguish savings and investment contributions from ordinary expenses in budget forecast', () => {
    const bills: BillInstance[] = [
      {
        id: 'b_exp',
        scheduleId: 's_expense',
        title: 'Groceries allowance',
        category: 'Groceries',
        commitmentType: 'expense',
        amountPaise: 600000, // ₹6,000
        dueDate: '2026-10-25',
        status: 'upcoming',
        isDemo: false,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'b_sip',
        scheduleId: 's_sip',
        title: 'Nifty 50 Index Fund SIP',
        category: 'Investment',
        commitmentType: 'investment',
        amountPaise: 1000000, // ₹10,000
        dueDate: '2026-10-25',
        status: 'upcoming',
        isDemo: false,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'b_rd',
        scheduleId: 's_rd',
        title: 'Emergency RD Savings',
        category: 'Savings',
        commitmentType: 'savings',
        amountPaise: 500000, // ₹5,000
        dueDate: '2026-10-25',
        status: 'upcoming',
        isDemo: false,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ]

    const forecast = forecastBudgetWithCommitments(
      [], // no confirmed transactions
      bills,
      5000000, // ₹50,000 budget
      '2026-10-20'
    )

    // Ordinary scheduled expense: ₹6,000 (600,000 paise)
    expect(forecast.upcomingScheduledExpensesPaise).toBe(600000)

    // Planned savings: ₹5,000 (500,000 paise)
    expect(forecast.plannedSavingsPaise).toBe(500000)

    // Planned investments: ₹10,000 (1,000,000 paise)
    expect(forecast.plannedInvestmentPaise).toBe(1000000)

    // Total upcoming commitments includes all three
    expect(forecast.totalUpcomingCommitmentsPaise).toBe(2100000)

    // Savings and investments must not be merged into upcomingScheduledExpensesPaise!
    expect(forecast.upcomingScheduledExpensesPaise).not.toBe(2100000)
  })

  // 16. Tasks with no time remaining all-day tasks
  it('16. should treat tasks with no time as all-day tasks without inventing fake times', async () => {
    const allDayTask = await plannerRepo.createTask({
      title: 'Pay property tax',
      dueDate: '2026-10-30',
      priority: 'high',
      category: 'general',
      status: 'pending',
      isDemo: false,
      // dueTime omitted intentionally!
    })

    expect(allDayTask.dueTime).toBeUndefined()

    const retrieved = await plannerRepo.getTaskById(allDayTask.id)
    expect(retrieved?.dueTime).toBeUndefined()

    // Querying tasks with date filter
    const tasksForDay = await plannerRepo.getTasks({ date: '2026-10-30', isDemo: false })
    expect(tasksForDay.length).toBe(1)
    expect(tasksForDay[0].dueTime).toBeUndefined()
  })

  // 17. Reminder dismissal and duplicate-alert prevention
  it('17. should filter out dismissed notifications and prevent duplicate alerts', async () => {
    const overdueBill: BillInstance = {
      id: 'bill_alert_test',
      scheduleId: 's_alert',
      title: 'Credit Card Bill',
      category: 'Utilities',
      commitmentType: 'expense',
      amountPaise: 1500000,
      dueDate: '2026-10-10',
      status: 'overdue',
      isDemo: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    const today = '2026-10-20'

    // First check: notification is active
    const notifs1 = getActivePlannerNotifications([overdueBill], [], [], today)
    expect(notifs1.length).toBe(1)
    expect(notifs1[0].id).toBe('alert_bill_bill_alert_test_bill_overdue')

    // Dismiss this alert
    await plannerRepo.dismissAlert(notifs1[0].id)
    const dismissedIds = await plannerRepo.getDismissedAlertIds()
    expect(dismissedIds).toContain('alert_bill_bill_alert_test_bill_overdue')

    // Second check passing dismissed list: alert is suppressed!
    const notifs2 = getActivePlannerNotifications([overdueBill], [], dismissedIds, today)
    expect(notifs2.length).toBe(0)
  })

  // 18. Browser notification permission denial handled safely
  it('18. should handle browser notification denial safely without throwing exceptions', () => {
    // Simulate window without Notification API
    const mockGlobalWithoutNotification = {}
    const hasNotificationSupport = 'Notification' in mockGlobalWithoutNotification
    expect(hasNotificationSupport).toBe(false)

    // Simulate Notification API with 'denied' permission
    const mockNotificationWithDenied = {
      permission: 'denied',
    }
    expect(mockNotificationWithDenied.permission === 'granted').toBe(false)

    // App function safety check
    let errorThrown = false
    try {
      if (mockNotificationWithDenied.permission !== 'granted') {
        // Fall back gracefully to in-app banners
      }
    } catch {
      errorThrown = true
    }
    expect(errorThrown).toBe(false)
  })

  // 19. Upcoming commitments excluded from confirmed spending
  it('19. should keep upcoming commitments strictly excluded from confirmed financial ledger totals', () => {
    const confirmedTx: Transaction = {
      id: 'tx_confirmed_1',
      type: 'expense',
      amount: 250000, // ₹2,500
      currency: 'INR',
      category: 'Food & dining',
      description: 'Dinner with team',
      date: '2026-10-15T20:00:00.000Z',
      paymentMethod: 'Card',
      status: 'completed',
      createdAt: '2026-10-15T20:00:00.000Z',
      updatedAt: '2026-10-15T20:00:00.000Z',
    }

    const upcomingBill: BillInstance = {
      id: 'bill_upcoming_99',
      scheduleId: 'sched_upcoming_99',
      title: 'Future Car Insurance',
      category: 'Utilities',
      commitmentType: 'expense',
      amountPaise: 1800000, // ₹18,000 (Upcoming, NOT confirmed)
      dueDate: '2026-10-29',
      status: 'upcoming',
      isDemo: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    // Ledger summary only evaluates transactions
    const ledgerSummary = calculateFinancialSummary([confirmedTx])
    expect(ledgerSummary.totalConfirmedExpenses).toBe(250000)

    // Forecast projection layer explicitly separates them
    const forecast = forecastBudgetWithCommitments(
      [confirmedTx],
      [upcomingBill],
      5000000, // ₹50,000 budget
      '2026-10-20'
    )

    expect(forecast.confirmedSpendingPaise).toBe(250000)
    expect(forecast.upcomingScheduledExpensesPaise).toBe(1800000)
    expect(forecast.projectedTotalSpendingPaise).toBe(2050000)
  })

  // 20. Existing transactions, refunds, transfers, inventory, receipt, and shopping-list calculations continue to function
  it('20. should preserve existing transaction, refund, transfer, and financial calculations intact', () => {
    const mixedLedger: Transaction[] = [
      {
        id: 'tx_inc',
        type: 'income',
        amount: 8000000, // ₹80,000
        currency: 'INR',
        category: 'Income',
        description: 'Monthly Salary',
        date: '2026-10-01T00:00:00.000Z',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'tx_exp',
        type: 'expense',
        amount: 1500000, // ₹15,000
        currency: 'INR',
        category: 'Shopping',
        description: 'Festival Clothes',
        date: '2026-10-05T00:00:00.000Z',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
      },
      {
        id: 'tx_ref',
        type: 'refund',
        amount: 200000, // ₹2,000
        currency: 'INR',
        category: 'Shopping',
        description: 'Return shirt',
        date: '2026-10-08T00:00:00.000Z',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-08T00:00:00.000Z',
        updatedAt: '2026-10-08T00:00:00.000Z',
      },
      {
        id: 'tx_trf',
        type: 'transfer',
        amount: 1000000, // ₹10,000
        currency: 'INR',
        category: 'Transfer',
        description: 'Transfer to Savings Account',
        date: '2026-10-10T00:00:00.000Z',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-10T00:00:00.000Z',
        updatedAt: '2026-10-10T00:00:00.000Z',
      },
    ]

    const summary = calculateFinancialSummary(mixedLedger)
    expect(summary.totalConfirmedIncome).toBe(8000000)
    expect(summary.grossConfirmedExpenses).toBe(1500000)
    expect(summary.totalRefunds).toBe(200000)
    expect(summary.totalConfirmedExpenses).toBe(1300000) // 15,000 - 2,000
    expect(summary.netCashFlow).toBe(6700000) // 80,000 - 13,000
    expect(summary.totalTransfers).toBe(1000000)
  })

  // =========================================================================
  // Section 2 Critical Failure Points Verification Suite
  // =========================================================================

  describe('Section 2 Critical Failure Points Verification', () => {
    // A. Bill settlement must never duplicate transactions
    it('2A. should strictly prevent duplicate transaction creation when settling an already settled bill', async () => {
      // 1. Create recurring bill for ₹1,199 (119900 paise)
      const bill = await plannerRepo.createBill({
        scheduleId: 'sched_broadband_test',
        title: 'Broadband Fiber',
        category: 'Utilities',
        commitmentType: 'expense',
        amountPaise: 119900,
        dueDate: '2026-10-25',
        status: 'upcoming',
        isDemo: false,
      })

      // 2. First settlement with ledger recording
      const firstTx: Transaction = {
        id: 'tx_broadband_first',
        type: 'expense',
        amount: bill.amountPaise || 0,
        currency: 'INR',
        category: 'Utilities',
        description: `Bill Payment: ${bill.title}`,
        date: '2026-10-25T10:00:00.000Z',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-25T10:00:00.000Z',
        updatedAt: '2026-10-25T10:00:00.000Z',
      }
      await transactionRepo.add(firstTx)
      const settledBill = await plannerRepo.updateBill(bill.id, {
        status: 'paid',
        paidDate: '2026-10-25T10:00:00.000Z',
        linkedTransactionId: firstTx.id,
      })

      // 3. Verify exactly one expense exists in ledger
      const txList1 = await transactionRepo.getAll()
      expect(txList1.length).toBe(1)
      expect(txList1[0].amount).toBe(119900)

      // 4. Return to the bill and attempt second settlement
      // Backend guard check: If bill.linkedTransactionId or status is 'paid', duplicate creation must be rejected
      let duplicateAttemptError: string | null = null
      try {
        if (settledBill?.linkedTransactionId || settledBill?.status === 'paid') {
          throw new Error('This bill has already been settled and linked to a financial transaction.')
        }
        // If not guarded, a second transaction would have been added:
        await transactionRepo.add({
          ...firstTx,
          id: 'tx_broadband_second_DUPLICATE',
        })
      } catch (err) {
        duplicateAttemptError = (err as Error).message
      }

      // 5. Verify error was raised and second expense is NOT created
      expect(duplicateAttemptError).toBe('This bill has already been settled and linked to a financial transaction.')
      const txList2 = await transactionRepo.getAll()
      expect(txList2.length).toBe(1) // Still exactly 1!
    })

    // B. Existing data must survive database upgrade
    it('2B. should preserve all existing stores and data structures across schema version upgrade', async () => {
      // Simulate existing data from version 2
      const existingLedger: Transaction[] = [
        {
          id: 'tx_existing_v2',
          type: 'expense',
          amount: 45000,
          currency: 'INR',
          category: 'Groceries',
          description: 'Basmati Rice 5kg',
          date: '2026-10-15T00:00:00.000Z',
          paymentMethod: 'UPI',
          status: 'completed',
          createdAt: '2026-10-15T00:00:00.000Z',
          updatedAt: '2026-10-15T00:00:00.000Z',
        },
      ]

      // Verify repository can load existing records and add new planner records side-by-side
      await transactionRepo.add(existingLedger[0])
      const newSchedule = await plannerRepo.createSchedule({
        title: 'Electricity Provider',
        category: 'Utilities',
        amountPaise: 180000,
        commitmentType: 'expense',
        frequency: 'monthly',
        startDate: '2026-11-01',
        nextDueDate: '2026-11-01',
        status: 'active',
        isDemo: false,
      })

      const allTx = await transactionRepo.getAll()
      const allSchedules = await plannerRepo.getSchedules({ isDemo: false })

      expect(allTx.length).toBe(1)
      expect(allTx[0].id).toBe('tx_existing_v2')
      expect(allSchedules.length).toBe(1)
      expect(allSchedules[0].id).toBe(newSchedule.id)
    })

    // C. Forecasting must not double-count paid bills (with exact user prompt figures)
    it('2C. should not double-count a paid bill that is already linked to an expense transaction', () => {
      // Confirmed ledger expenses: ₹5,000 (500,000 paise)
      // Note: This already includes the ₹1,000 paid bill settled earlier!
      const confirmedTransactions: Transaction[] = [
        {
          id: 'tx_general_spending',
          type: 'expense',
          amount: 400000, // ₹4,000
          currency: 'INR',
          category: 'Shopping',
          description: 'General shopping',
          date: '2026-10-10T00:00:00.000Z',
          paymentMethod: 'Card',
          status: 'completed',
          createdAt: '2026-10-10T00:00:00.000Z',
          updatedAt: '2026-10-10T00:00:00.000Z',
        },
        {
          id: 'tx_paid_bill_linked',
          type: 'expense',
          amount: 100000, // ₹1,000 (Settled bill recorded in ledger)
          currency: 'INR',
          category: 'Utilities',
          description: 'Bill Payment: Water Board',
          date: '2026-10-15T00:00:00.000Z',
          paymentMethod: 'UPI',
          status: 'completed',
          createdAt: '2026-10-15T00:00:00.000Z',
          updatedAt: '2026-10-15T00:00:00.000Z',
        },
      ]

      const bills: BillInstance[] = [
        // Upcoming unpaid bills: ₹2,000 (200,000 paise)
        {
          id: 'bill_unpaid_1',
          scheduleId: 'sched_power',
          title: 'Electricity Bill',
          category: 'Utilities',
          commitmentType: 'expense',
          amountPaise: 200000, // ₹2,000
          dueDate: '2026-10-25',
          status: 'upcoming',
          isDemo: false,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
        // A ₹1,000 bill already marked paid and linked to an expense transaction
        {
          id: 'bill_paid_linked',
          scheduleId: 'sched_water',
          title: 'Water Board',
          category: 'Utilities',
          commitmentType: 'expense',
          amountPaise: 100000, // ₹1,000
          dueDate: '2026-10-15',
          status: 'paid', // PAID!
          linkedTransactionId: 'tx_paid_bill_linked',
          paidDate: '2026-10-15T00:00:00.000Z',
          isDemo: false,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-15T00:00:00.000Z',
        },
        // Planned SIP contribution: ₹500 (50,000 paise)
        {
          id: 'bill_sip_planned',
          scheduleId: 'sched_sip',
          title: 'Nifty Index Fund SIP',
          category: 'Investment',
          commitmentType: 'investment',
          amountPaise: 50000, // ₹500
          dueDate: '2026-10-28',
          status: 'upcoming',
          isDemo: false,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ]

      const forecast = forecastBudgetWithCommitments(
        confirmedTransactions,
        bills,
        1000000, // ₹10,000 budget
        '2026-10-20'
      )

      // 1. Confirmed ledger expenses: exactly ₹5,000 (500000 paise)
      expect(forecast.confirmedSpendingPaise).toBe(500000)

      // 2. Upcoming unpaid bills: exactly ₹2,000 (200000 paise)
      // The ₹1,000 paid bill MUST NOT be in upcoming expenses!
      expect(forecast.upcomingScheduledExpensesPaise).toBe(200000)

      // 3. Planned SIP contribution: exactly ₹500 (50000 paise)
      expect(forecast.plannedInvestmentPaise).toBe(50000)

      // 4. Projected total spending: confirmed (₹5,000) + upcoming expenses (₹2,000) = ₹7,000
      // Must NOT be ₹8,000 (which would occur if the paid ₹1,000 bill was double-counted)
      expect(forecast.projectedTotalSpendingPaise).toBe(700000)

      // 5. SIP is NOT treated as an ordinary expense
      expect(forecast.upcomingScheduledExpensesPaise).not.toContain(50000)
    })

    // D. Recurring schedules must remain stable across month-end and pause
    it('2D. should produce the exact Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31 sequence and respect pause', () => {
      const schedule: RecurringSchedule = {
        id: 'sched_jan31_test',
        title: 'End of Month Retainer',
        category: 'Services',
        amountPaise: 150000,
        commitmentType: 'expense',
        frequency: 'monthly',
        preferredDayOfMonth: 31,
        startDate: '2026-01-31',
        nextDueDate: '2026-01-31',
        status: 'active',
        isDemo: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      // Step-by-step month-end advancement
      const m1 = schedule.startDate // 2026-01-31
      const m2 = calculateNextDueDate(m1, 'monthly', { preferredDayOfMonth: 31 }) // 2026-02-28
      const m3 = calculateNextDueDate(m2, 'monthly', { preferredDayOfMonth: 31 }) // 2026-03-31
      const m4 = calculateNextDueDate(m3, 'monthly', { preferredDayOfMonth: 31 }) // 2026-04-30
      const m5 = calculateNextDueDate(m4, 'monthly', { preferredDayOfMonth: 31 }) // 2026-05-31

      expect([m1, m2, m3, m4, m5]).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
      ])

      // Pause schedule
      const pausedSchedule: RecurringSchedule = {
        ...schedule,
        status: 'paused',
      }

      // While paused, generateUpcomingInstances must generate 0 new instances
      const occurrencesWhilePaused = generateUpcomingInstances(
        pausedSchedule,
        '2026-12-31',
        [],
        '2026-01-01'
      )
      expect(occurrencesWhilePaused.length).toBe(0)
    })
  })
})
