import { useState, useEffect, useCallback, useMemo } from 'react'
import type {
  RecurringSchedule,
  BillInstance,
  PlannerTask,
  PlannerNotification,
  BudgetForecastResult,
} from '../types/planner'
import type { Transaction, PaymentMethod } from '../types/transaction'
import {
  type IPlannerRepository,
  IndexedDBPlannerRepository,
  InMemoryPlannerRepository,
} from '../storage/plannerRepository'
import { DEMO_RECURRING_SCHEDULES, DEMO_PLANNER_TASKS } from '../utils/demoPlanner'
import {
  generateUpcomingInstances,
  getTodayDateString,
  calculateNextDueDate,
} from '../utils/recurrenceEngine'
import {
  forecastBudgetWithCommitments,
  getActivePlannerNotifications,
} from '../utils/plannerCalculations'

interface UsePlannerOptions {
  isDemoMode: boolean
  transactions: Transaction[]
  userBudgetLimitPaise?: number
  onRecordTransaction?: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Transaction>
}

export function usePlanner({
  isDemoMode,
  transactions,
  userBudgetLimitPaise,
  onRecordTransaction,
}: UsePlannerOptions) {
  const [repository, setRepository] = useState<IPlannerRepository>(() => new InMemoryPlannerRepository())
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([])
  const [bills, setBills] = useState<BillInstance[]>([])
  const [tasks, setTasks] = useState<PlannerTask[]>([])
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)

  // Initialize repository
  useEffect(() => {
    let isMounted = true
    try {
      if (typeof window !== 'undefined' && window.indexedDB) {
        const idbRepo = new IndexedDBPlannerRepository()
        if (isMounted) {
          setRepository(idbRepo)
          setStorageWarning(null)
        }
      } else {
        if (isMounted) {
          setRepository(new InMemoryPlannerRepository())
          setStorageWarning('IndexedDB is unavailable. Planner records will not persist across browser reloads.')
        }
      }
    } catch {
      if (isMounted) {
        setRepository(new InMemoryPlannerRepository())
        setStorageWarning('IndexedDB initialization failed. Running in memory-only mode.')
      }
    }
    return () => {
      isMounted = false
    }
  }, [])

  // Load schedules, bills, tasks from repository or demo data
  const refreshData = useCallback(async () => {
    setLoading(true)
    try {
      const todayStr = getTodayDateString()
      // Horizon: 60 days ahead
      const horizonDate = new Date()
      horizonDate.setDate(horizonDate.getDate() + 60)
      const horizonStr = `${horizonDate.getFullYear()}-${String(horizonDate.getMonth() + 1).padStart(2, '0')}-${String(horizonDate.getDate()).padStart(2, '0')}`

      if (isDemoMode) {
        // Pre-generate demo bills
        const demoBills: BillInstance[] = []
        for (const sched of DEMO_RECURRING_SCHEDULES) {
          const generated = generateUpcomingInstances(sched, horizonStr, [], todayStr)
          demoBills.push(...generated)
        }
        setSchedules(DEMO_RECURRING_SCHEDULES)
        setBills(demoBills)
        setTasks(DEMO_PLANNER_TASKS)
        setDismissedAlertIds([])
      } else {
        const [loadedScheds, loadedBills, loadedTasks, dismissed] = await Promise.all([
          repository.getSchedules({ isDemo: false }),
          repository.getBills({ isDemo: false }),
          repository.getTasks({ isDemo: false }),
          repository.getDismissedAlertIds(),
        ])

        // Automatically generate missing upcoming instances for active schedules
        let allBills = [...loadedBills]
        const newBillsToPersist: BillInstance[] = []

        for (const sched of loadedScheds) {
          if (sched.status === 'active') {
            const instances = generateUpcomingInstances(sched, horizonStr, allBills, todayStr)
            for (const inst of instances) {
              if (!allBills.some((b) => b.id === inst.id)) {
                allBills.push(inst)
                newBillsToPersist.push(inst)
              }
            }
          }
        }

        if (newBillsToPersist.length > 0) {
          await repository.bulkUpsertBills(newBillsToPersist)
        }

        setSchedules(loadedScheds)
        setBills(allBills.sort((a, b) => a.dueDate.localeCompare(b.dueDate)))
        setTasks(loadedTasks)
        setDismissedAlertIds(dismissed)
      }
    } catch (err) {
      console.error('Error refreshing planner data:', err)
    } finally {
      setLoading(false)
    }
  }, [repository, isDemoMode])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  // Schedule CRUD
  const addSchedule = useCallback(
    async (scheduleData: Omit<RecurringSchedule, 'id' | 'createdAt' | 'updatedAt'>) => {
      const todayStr = getTodayDateString()
      const horizonDate = new Date()
      horizonDate.setDate(horizonDate.getDate() + 60)
      const horizonStr = `${horizonDate.getFullYear()}-${String(horizonDate.getMonth() + 1).padStart(2, '0')}-${String(horizonDate.getDate()).padStart(2, '0')}`

      if (isDemoMode) {
        const now = new Date().toISOString()
        const newSched: RecurringSchedule = {
          ...scheduleData,
          id: `sched_demo_${Date.now()}`,
          isDemo: true,
          createdAt: now,
          updatedAt: now,
        }
        const generated = generateUpcomingInstances(newSched, horizonStr, [], todayStr)
        setSchedules((prev) => [...prev, newSched])
        setBills((prev) => [...prev, ...generated].sort((a, b) => a.dueDate.localeCompare(b.dueDate)))
        return newSched
      }

      const created = await repository.createSchedule({
        ...scheduleData,
        isDemo: false,
      })
      const instances = generateUpcomingInstances(created, horizonStr, [], todayStr)
      if (instances.length > 0) {
        await repository.bulkUpsertBills(instances)
      }
      await refreshData()
      return created
    },
    [isDemoMode, repository, refreshData]
  )

  const updateSchedule = useCallback(
    async (id: string, updates: Partial<RecurringSchedule>) => {
      if (isDemoMode) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s))
        )
        return
      }
      await repository.updateSchedule(id, updates)
      await refreshData()
    },
    [isDemoMode, repository, refreshData]
  )

  const pauseSchedule = useCallback(
    async (id: string) => {
      await updateSchedule(id, { status: 'paused' })
    },
    [updateSchedule]
  )

  const resumeSchedule = useCallback(
    async (id: string) => {
      await updateSchedule(id, { status: 'active' })
    },
    [updateSchedule]
  )

  const deleteSchedule = useCallback(
    async (id: string) => {
      if (isDemoMode) {
        setSchedules((prev) => prev.filter((s) => s.id !== id))
        setBills((prev) => prev.filter((b) => b.scheduleId !== id))
        return
      }
      await repository.deleteSchedule(id)
      await refreshData()
    },
    [isDemoMode, repository, refreshData]
  )

  // Bill Actions
  const settleBill = useCallback(
    async (
      billId: string,
      options: {
        recordTransaction: boolean
        paymentMethod?: PaymentMethod
        category?: string
        notes?: string
      }
    ) => {
      const bill = bills.find((b) => b.id === billId)
      if (!bill) throw new Error(`Bill instance not found: ${billId}`)

      let createdTxId: string | undefined = undefined

      // If user requested recording an expense in ledger
      if (options.recordTransaction && onRecordTransaction && bill.amountPaise && bill.amountPaise > 0) {
        // Prevent duplicate transaction if already linked or already settled!
        if (bill.linkedTransactionId || bill.status === 'paid') {
          throw new Error('This bill has already been settled and linked to a financial transaction.')
        }

        const tx = await onRecordTransaction({
          type: 'expense',
          amount: bill.amountPaise,
          currency: 'INR',
          date: new Date().toISOString(),
          description: `Bill Payment: ${bill.title}`,
          category: options.category || bill.category || 'Utilities',
          paymentMethod: options.paymentMethod || 'UPI',
          status: 'completed',
          notes: options.notes || bill.notes,
        })
        createdTxId = tx.id
      }

      const now = new Date().toISOString()
      const updates: Partial<BillInstance> = {
        status: 'paid',
        paidDate: now,
        linkedTransactionId: createdTxId || bill.linkedTransactionId,
        updatedAt: now,
      }

      if (isDemoMode) {
        setBills((prev) => prev.map((b) => (b.id === billId ? { ...b, ...updates } : b)))
      } else {
        await repository.updateBill(billId, updates)

        // Advance parent schedule nextDueDate if applicable
        if (bill.scheduleId) {
          const parent = schedules.find((s) => s.id === bill.scheduleId)
          if (parent && parent.nextDueDate <= bill.dueDate) {
            const nextDue = calculateNextDueDate(bill.dueDate, parent.frequency, {
              preferredDayOfMonth: parent.preferredDayOfMonth,
              customIntervalDays: parent.customIntervalDays,
            })
            await repository.updateSchedule(parent.id, { nextDueDate: nextDue })
          }
        }
        await refreshData()
      }
    },
    [bills, onRecordTransaction, isDemoMode, repository, schedules, refreshData]
  )

  const skipBill = useCallback(
    async (billId: string) => {
      if (isDemoMode) {
        setBills((prev) =>
          prev.map((b) => (b.id === billId ? { ...b, status: 'skipped', updatedAt: new Date().toISOString() } : b))
        )
        return
      }
      await repository.updateBill(billId, { status: 'skipped', updatedAt: new Date().toISOString() })
      await refreshData()
    },
    [isDemoMode, repository, refreshData]
  )

  // Task CRUD
  const addTask = useCallback(
    async (taskData: Omit<PlannerTask, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (isDemoMode) {
        const now = new Date().toISOString()
        const newTask: PlannerTask = {
          ...taskData,
          id: `task_demo_${Date.now()}`,
          isDemo: true,
          createdAt: now,
          updatedAt: now,
        }
        setTasks((prev) => [...prev, newTask])
        return newTask
      }
      const created = await repository.createTask({ ...taskData, isDemo: false })
      await refreshData()
      return created
    },
    [isDemoMode, repository, refreshData]
  )

  const updateTask = useCallback(
    async (id: string, updates: Partial<PlannerTask>) => {
      if (isDemoMode) {
        setTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t))
        )
        return
      }
      await repository.updateTask(id, updates)
      await refreshData()
    },
    [isDemoMode, repository, refreshData]
  )

  const toggleTaskComplete = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id)
      if (!task) return
      const nextStatus = task.status === 'completed' ? 'pending' : 'completed'
      const completedAt = nextStatus === 'completed' ? new Date().toISOString() : undefined
      await updateTask(id, { status: nextStatus, completedAt })
    },
    [tasks, updateTask]
  )

  const deleteTask = useCallback(
    async (id: string) => {
      if (isDemoMode) {
        setTasks((prev) => prev.filter((t) => t.id !== id))
        return
      }
      await repository.deleteTask(id)
      await refreshData()
    },
    [isDemoMode, repository, refreshData]
  )

  // Notification dismissal
  const dismissNotification = useCallback(
    async (id: string) => {
      setDismissedAlertIds((prev) => [...prev, id])
      if (!isDemoMode) {
        await repository.dismissAlert(id)
      }
    },
    [isDemoMode, repository]
  )

  // Derived budget forecast
  const forecast: BudgetForecastResult = useMemo(() => {
    return forecastBudgetWithCommitments(transactions, bills, userBudgetLimitPaise)
  }, [transactions, bills, userBudgetLimitPaise])

  // Derived in-app notifications
  const notifications: PlannerNotification[] = useMemo(() => {
    return getActivePlannerNotifications(bills, tasks, dismissedAlertIds)
  }, [bills, tasks, dismissedAlertIds])

  return {
    schedules,
    bills,
    tasks,
    notifications,
    forecast,
    loading,
    storagePersistent: repository.isStoragePersistent(),
    storageWarning,
    addSchedule,
    updateSchedule,
    pauseSchedule,
    resumeSchedule,
    deleteSchedule,
    settleBill,
    skipBill,
    addTask,
    updateTask,
    toggleTaskComplete,
    deleteTask,
    dismissNotification,
    refreshData,
  }
}
