import type {
  RecurringSchedule,
  BillInstance,
  PlannerTask,
  ScheduleStatus,
  BillStatus,
} from '../types/planner'
import {
  openDatabase,
  SCHEDULES_STORE_NAME,
  BILLS_STORE_NAME,
  TASKS_STORE_NAME,
  DISMISSED_ALERTS_STORE_NAME,
} from './db'

export interface IPlannerRepository {
  // Schedules
  getSchedules(filter?: { isDemo?: boolean; status?: ScheduleStatus }): Promise<RecurringSchedule[]>
  getScheduleById(id: string): Promise<RecurringSchedule | null>
  createSchedule(schedule: Omit<RecurringSchedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<RecurringSchedule>
  updateSchedule(id: string, updates: Partial<RecurringSchedule>): Promise<RecurringSchedule>
  deleteSchedule(id: string): Promise<void>

  // Bills
  getBills(filter?: {
    isDemo?: boolean
    status?: BillStatus
    startDate?: string
    endDate?: string
  }): Promise<BillInstance[]>
  getBillById(id: string): Promise<BillInstance | null>
  createBill(bill: Omit<BillInstance, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<BillInstance>
  updateBill(id: string, updates: Partial<BillInstance>): Promise<BillInstance>
  deleteBill(id: string): Promise<void>
  bulkUpsertBills(bills: BillInstance[]): Promise<void>

  // Tasks
  getTasks(filter?: {
    isDemo?: boolean
    status?: 'pending' | 'completed' | 'cancelled'
    date?: string
  }): Promise<PlannerTask[]>
  getTaskById(id: string): Promise<PlannerTask | null>
  createTask(task: Omit<PlannerTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlannerTask>
  updateTask(id: string, updates: Partial<PlannerTask>): Promise<PlannerTask>
  deleteTask(id: string): Promise<void>

  // Dismissed alerts
  getDismissedAlertIds(): Promise<string[]>
  dismissAlert(id: string): Promise<void>

  isStoragePersistent(): boolean
}

/**
 * In-Memory Planner Repository (used for tests and fallback if IndexedDB is unavailable)
 */
export class InMemoryPlannerRepository implements IPlannerRepository {
  private schedules = new Map<string, RecurringSchedule>()
  private bills = new Map<string, BillInstance>()
  private tasks = new Map<string, PlannerTask>()
  private dismissedAlerts = new Set<string>()

  constructor(initialData?: {
    schedules?: RecurringSchedule[]
    bills?: BillInstance[]
    tasks?: PlannerTask[]
  }) {
    initialData?.schedules?.forEach((s) => this.schedules.set(s.id, s))
    initialData?.bills?.forEach((b) => this.bills.set(b.id, b))
    initialData?.tasks?.forEach((t) => this.tasks.set(t.id, t))
  }

  isStoragePersistent(): boolean {
    return false
  }

  // Schedules
  async getSchedules(filter?: { isDemo?: boolean; status?: ScheduleStatus }): Promise<RecurringSchedule[]> {
    let result = Array.from(this.schedules.values())
    if (filter?.isDemo !== undefined) {
      result = result.filter((s) => !!s.isDemo === filter.isDemo)
    }
    if (filter?.status) {
      result = result.filter((s) => s.status === filter.status)
    }
    return result.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
  }

  async getScheduleById(id: string): Promise<RecurringSchedule | null> {
    return this.schedules.get(id) || null
  }

  async createSchedule(
    data: Omit<RecurringSchedule, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<RecurringSchedule> {
    const now = new Date().toISOString()
    const item: RecurringSchedule = {
      ...data,
      id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    }
    this.schedules.set(item.id, item)
    return item
  }

  async updateSchedule(id: string, updates: Partial<RecurringSchedule>): Promise<RecurringSchedule> {
    const existing = this.schedules.get(id)
    if (!existing) throw new Error(`Schedule not found: ${id}`)
    const updated: RecurringSchedule = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.schedules.set(id, updated)
    return updated
  }

  async deleteSchedule(id: string): Promise<void> {
    this.schedules.delete(id)
  }

  // Bills
  async getBills(filter?: {
    isDemo?: boolean
    status?: BillStatus
    startDate?: string
    endDate?: string
  }): Promise<BillInstance[]> {
    let result = Array.from(this.bills.values())
    if (filter?.isDemo !== undefined) {
      result = result.filter((b) => !!b.isDemo === filter.isDemo)
    }
    if (filter?.status) {
      result = result.filter((b) => b.status === filter.status)
    }
    if (filter?.startDate) {
      result = result.filter((b) => b.dueDate >= filter.startDate!)
    }
    if (filter?.endDate) {
      result = result.filter((b) => b.dueDate <= filter.endDate!)
    }
    return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  async getBillById(id: string): Promise<BillInstance | null> {
    return this.bills.get(id) || null
  }

  async createBill(
    data: Omit<BillInstance, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<BillInstance> {
    const now = new Date().toISOString()
    const id = data.id || `bill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    const item: BillInstance = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.bills.set(item.id, item)
    return item
  }

  async updateBill(id: string, updates: Partial<BillInstance>): Promise<BillInstance> {
    const existing = this.bills.get(id)
    if (!existing) throw new Error(`Bill not found: ${id}`)
    const updated: BillInstance = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.bills.set(id, updated)
    return updated
  }

  async deleteBill(id: string): Promise<void> {
    this.bills.delete(id)
  }

  async bulkUpsertBills(bills: BillInstance[]): Promise<void> {
    for (const b of bills) {
      this.bills.set(b.id, b)
    }
  }

  // Tasks
  async getTasks(filter?: {
    isDemo?: boolean
    status?: 'pending' | 'completed' | 'cancelled'
    date?: string
  }): Promise<PlannerTask[]> {
    let result = Array.from(this.tasks.values())
    if (filter?.isDemo !== undefined) {
      result = result.filter((t) => !!t.isDemo === filter.isDemo)
    }
    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status)
    }
    if (filter?.date) {
      result = result.filter((t) => t.dueDate === filter.date)
    }
    return result.sort((a, b) => {
      const cmp = a.dueDate.localeCompare(b.dueDate)
      if (cmp !== 0) return cmp
      return (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99')
    })
  }

  async getTaskById(id: string): Promise<PlannerTask | null> {
    return this.tasks.get(id) || null
  }

  async createTask(data: Omit<PlannerTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlannerTask> {
    const now = new Date().toISOString()
    const item: PlannerTask = {
      ...data,
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(item.id, item)
    return item
  }

  async updateTask(id: string, updates: Partial<PlannerTask>): Promise<PlannerTask> {
    const existing = this.tasks.get(id)
    if (!existing) throw new Error(`Task not found: ${id}`)
    const updated: PlannerTask = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    this.tasks.set(id, updated)
    return updated
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks.delete(id)
  }

  // Dismissed Alerts
  async getDismissedAlertIds(): Promise<string[]> {
    return Array.from(this.dismissedAlerts)
  }

  async dismissAlert(id: string): Promise<void> {
    this.dismissedAlerts.add(id)
  }
}

/**
 * IndexedDB Planner Repository for persistent browser storage
 */
export class IndexedDBPlannerRepository implements IPlannerRepository {
  isStoragePersistent(): boolean {
    return true
  }

  // Schedules
  async getSchedules(filter?: { isDemo?: boolean; status?: ScheduleStatus }): Promise<RecurringSchedule[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEDULES_STORE_NAME, 'readonly')
      const store = tx.objectStore(SCHEDULES_STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        let items = (request.result || []) as RecurringSchedule[]
        if (filter?.isDemo !== undefined) {
          items = items.filter((s) => !!s.isDemo === filter.isDemo)
        }
        if (filter?.status) {
          items = items.filter((s) => s.status === filter.status)
        }
        items.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
        resolve(items)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getScheduleById(id: string): Promise<RecurringSchedule | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEDULES_STORE_NAME, 'readonly')
      const store = tx.objectStore(SCHEDULES_STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async createSchedule(
    data: Omit<RecurringSchedule, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<RecurringSchedule> {
    const now = new Date().toISOString()
    const item: RecurringSchedule = {
      ...data,
      id: `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    }
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEDULES_STORE_NAME, 'readwrite')
      const store = tx.objectStore(SCHEDULES_STORE_NAME)
      const request = store.add(item)

      request.onsuccess = () => resolve(item)
      request.onerror = () => reject(request.error)
    })
  }

  async updateSchedule(id: string, updates: Partial<RecurringSchedule>): Promise<RecurringSchedule> {
    const existing = await this.getScheduleById(id)
    if (!existing) throw new Error(`Schedule not found: ${id}`)
    const updated: RecurringSchedule = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEDULES_STORE_NAME, 'readwrite')
      const store = tx.objectStore(SCHEDULES_STORE_NAME)
      const request = store.put(updated)

      request.onsuccess = () => resolve(updated)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteSchedule(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SCHEDULES_STORE_NAME, 'readwrite')
      const store = tx.objectStore(SCHEDULES_STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Bills
  async getBills(filter?: {
    isDemo?: boolean
    status?: BillStatus
    startDate?: string
    endDate?: string
  }): Promise<BillInstance[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BILLS_STORE_NAME, 'readonly')
      const store = tx.objectStore(BILLS_STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        let items = (request.result || []) as BillInstance[]
        if (filter?.isDemo !== undefined) {
          items = items.filter((b) => !!b.isDemo === filter.isDemo)
        }
        if (filter?.status) {
          items = items.filter((b) => b.status === filter.status)
        }
        if (filter?.startDate) {
          items = items.filter((b) => b.dueDate >= filter.startDate!)
        }
        if (filter?.endDate) {
          items = items.filter((b) => b.dueDate <= filter.endDate!)
        }
        items.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        resolve(items)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getBillById(id: string): Promise<BillInstance | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BILLS_STORE_NAME, 'readonly')
      const store = tx.objectStore(BILLS_STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async createBill(
    data: Omit<BillInstance, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<BillInstance> {
    const now = new Date().toISOString()
    const id = data.id || `bill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    const item: BillInstance = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    }
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BILLS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(BILLS_STORE_NAME)
      const request = store.add(item)

      request.onsuccess = () => resolve(item)
      request.onerror = () => reject(request.error)
    })
  }

  async updateBill(id: string, updates: Partial<BillInstance>): Promise<BillInstance> {
    const existing = await this.getBillById(id)
    if (!existing) throw new Error(`Bill not found: ${id}`)
    const updated: BillInstance = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BILLS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(BILLS_STORE_NAME)
      const request = store.put(updated)

      request.onsuccess = () => resolve(updated)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteBill(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BILLS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(BILLS_STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async bulkUpsertBills(bills: BillInstance[]): Promise<void> {
    if (bills.length === 0) return
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BILLS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(BILLS_STORE_NAME)
      for (const b of bills) {
        store.put(b)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  // Tasks
  async getTasks(filter?: {
    isDemo?: boolean
    status?: 'pending' | 'completed' | 'cancelled'
    date?: string
  }): Promise<PlannerTask[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TASKS_STORE_NAME, 'readonly')
      const store = tx.objectStore(TASKS_STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        let items = (request.result || []) as PlannerTask[]
        if (filter?.isDemo !== undefined) {
          items = items.filter((t) => !!t.isDemo === filter.isDemo)
        }
        if (filter?.status) {
          items = items.filter((t) => t.status === filter.status)
        }
        if (filter?.date) {
          items = items.filter((t) => t.dueDate === filter.date)
        }
        items.sort((a, b) => {
          const cmp = a.dueDate.localeCompare(b.dueDate)
          if (cmp !== 0) return cmp
          return (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99')
        })
        resolve(items)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async getTaskById(id: string): Promise<PlannerTask | null> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TASKS_STORE_NAME, 'readonly')
      const store = tx.objectStore(TASKS_STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async createTask(data: Omit<PlannerTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<PlannerTask> {
    const now = new Date().toISOString()
    const item: PlannerTask = {
      ...data,
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    }
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TASKS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(TASKS_STORE_NAME)
      const request = store.add(item)

      request.onsuccess = () => resolve(item)
      request.onerror = () => reject(request.error)
    })
  }

  async updateTask(id: string, updates: Partial<PlannerTask>): Promise<PlannerTask> {
    const existing = await this.getTaskById(id)
    if (!existing) throw new Error(`Task not found: ${id}`)
    const updated: PlannerTask = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TASKS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(TASKS_STORE_NAME)
      const request = store.put(updated)

      request.onsuccess = () => resolve(updated)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteTask(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TASKS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(TASKS_STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Dismissed Alerts
  async getDismissedAlertIds(): Promise<string[]> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DISMISSED_ALERTS_STORE_NAME, 'readonly')
      const store = tx.objectStore(DISMISSED_ALERTS_STORE_NAME)
      const request = store.getAllKeys()

      request.onsuccess = () => resolve((request.result || []) as string[])
      request.onerror = () => reject(request.error)
    })
  }

  async dismissAlert(id: string): Promise<void> {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DISMISSED_ALERTS_STORE_NAME, 'readwrite')
      const store = tx.objectStore(DISMISSED_ALERTS_STORE_NAME)
      const request = store.put({ id, dismissedAt: new Date().toISOString() })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
