import { useState, useEffect, useMemo, useCallback } from 'react'
import type {
  Transaction,
  TransactionFilter,
  FinancialSummary,
  DuplicateCheckResult,
} from '../types/transaction'
import { createTransactionRepository } from '../storage/transactionRepository'
import { calculateFinancialSummary } from '../utils/calculations'
import { detectDuplicate } from '../utils/duplicateDetector'
import { DEMO_TRANSACTIONS } from '../utils/demoData'

const repo = createTransactionRepository()

/**
 * Identifies if a transaction originates from sample/mock/demo data.
 */
export function isMockTransaction(t: Transaction): boolean {
  if (t.id.startsWith('demo-') || t.id.startsWith('real-demo-')) return true
  if (t.source === 'demo' || t.isDemo === true) return true
  // Test/dummy transactions created during UI automated testing
  if (
    /^(?:notebook return discount|checking to savings|consulting pay|office notebook)\b/i.test(
      t.description.trim()
    )
  ) {
    return true
  }
  return DEMO_TRANSACTIONS.some(
    (d) =>
      d.id === t.id ||
      (d.amount === t.amount &&
        d.description.toLowerCase() === t.description.toLowerCase() &&
        Boolean(d.externalRef && t.externalRef && d.externalRef === t.externalRef))
  )
}

/**
 * Identifies if an existing transaction is an inter-account transfer, credit card
 * repayment, or personal P2P receipt that should be classified as 'transfer'
 * to avoid double-counting in income or expenses.
 */
export function shouldReclassifyAsTransfer(t: Transaction): boolean {
  if (t.type === 'transfer') return false
  const text = `${t.description || ''} ${t.merchant || ''} ${t.notes || ''}`

  if (t.type === 'expense') {
    // Self transfers and internal account movements
    if (/(?:transfer to|transfer from|to own|self transfer)\b/i.test(text)) {
      return true
    }
    // Card and loan repayments (e.g. Slice, credit card bill payments)
    if (/slice small finance bank|slice credit|credit card|card payment|loan repayment|emi payment/i.test(text)) {
      return true
    }
  } else if (t.type === 'income') {
    const isExplicitIncome = /salary|payroll|dividend|interest|pension|stipend|client retainer|client invoice|consulting fee/i.test(text)
    // If it's a P2P incoming receipt, self transfer, or general UPI personal receipt not verified as earned income
    if (!isExplicitIncome) {
      if (
        /(?:received from|transfer from|self transfer|from own|p2p)\b/i.test(text) ||
        /statement import (?:phonepe|paytm)/i.test(t.notes || '')
      ) {
        return true
      }
    }
  }
  return false
}

export function useTransactions() {
  const [realTransactions, setRealTransactions] = useState<Transaction[]>([])
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('moneymate_is_demo_mode')
      return saved !== null ? saved === 'true' : false
    }
    return false
  })
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [filters, setFilters] = useState<TransactionFilter>({
    search: '',
    type: 'all',
    category: 'all',
    paymentMethod: 'all',
    status: 'all',
    sortBy: 'date-desc',
  })

  // Load real transactions from IndexedDB on startup
  const loadTransactions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await repo.getAll()

      // Strict Live Workspace Hygiene: Automatically clean out any contaminated mock data
      const mockItems = data.filter(isMockTransaction)
      if (mockItems.length > 0) {
        for (const m of mockItems) {
          try {
            await repo.delete(m.id)
          } catch {
            // Ignore error
          }
        }
      }

      const realOnly = data.filter((t) => !isMockTransaction(t))

      // Anti-Double-Counting Auto-Healing: Re-classify any previously imported records
      // where transfers, card repayments, or P2P receipts were saved as income or expense
      const healedTransactions: Transaction[] = []
      let hadHealedUpdates = false

      for (const t of realOnly) {
        if (shouldReclassifyAsTransfer(t)) {
          hadHealedUpdates = true
          const updated: Transaction = {
            ...t,
            type: 'transfer',
            category: 'Transfer',
            updatedAt: new Date().toISOString(),
          }
          healedTransactions.push(updated)
          try {
            await repo.update(updated)
          } catch {
            // Non-blocking update failure
          }
        } else {
          healedTransactions.push(t)
        }
      }

      setRealTransactions(hadHealedUpdates ? healedTransactions : realOnly)
    } catch (err) {
      console.error('Failed to load transactions from IndexedDB:', err)
      setError('Could not access local storage database. Any changes may be temporary.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  // Current active dataset depending on mode
  const currentTransactions = useMemo(() => {
    return isDemoMode ? DEMO_TRANSACTIONS : realTransactions
  }, [isDemoMode, realTransactions])

  // Single authoritative calculation source
  const summary: FinancialSummary = useMemo(() => {
    return calculateFinancialSummary(currentTransactions)
  }, [currentTransactions])

  // Filtered & sorted transactions
  const filteredTransactions = useMemo(() => {
    let result = [...currentTransactions]

    // Search query
    if (filters.search && filters.search.trim() !== '') {
      const query = filters.search.trim().toLowerCase()
      result = result.filter(
        (t) =>
          t.description.toLowerCase().includes(query) ||
          (t.merchant && t.merchant.toLowerCase().includes(query)) ||
          t.category.toLowerCase().includes(query) ||
          (t.notes && t.notes.toLowerCase().includes(query)) ||
          (t.externalRef && t.externalRef.toLowerCase().includes(query))
      )
    }

    // Filter by type
    if (filters.type && filters.type !== 'all') {
      result = result.filter((t) => t.type === filters.type)
    }

    // Filter by category
    if (filters.category && filters.category !== 'all') {
      result = result.filter((t) => t.category === filters.category)
    }

    // Filter by payment method
    if (filters.paymentMethod && filters.paymentMethod !== 'all') {
      result = result.filter((t) => t.paymentMethod === filters.paymentMethod)
    }

    // Filter by status
    if (filters.status && filters.status !== 'all') {
      result = result.filter((t) => t.status === filters.status)
    }

    // Filter by date range
    if (filters.startDate) {
      const start = new Date(filters.startDate).getTime()
      result = result.filter((t) => new Date(t.date).getTime() >= start)
    }
    if (filters.endDate) {
      // Include the entire end day
      const end = new Date(filters.endDate)
      end.setHours(23, 59, 59, 999)
      result = result.filter((t) => new Date(t.date).getTime() <= end.getTime())
    }

    // Sorting
    result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'date-asc':
          return new Date(a.date).getTime() - new Date(b.date).getTime()
        case 'amount-desc':
          return b.amount - a.amount
        case 'amount-asc':
          return a.amount - b.amount
        case 'date-desc':
        default:
          return new Date(b.date).getTime() - new Date(a.date).getTime()
      }
    })

    return result
  }, [currentTransactions, filters])

  // Duplicate check helper
  const checkDuplicate = useCallback(
    (candidate: {
      amount: number
      type: string
      date: string
      merchant?: string
      description?: string
      externalRef?: string
      id?: string
    }): DuplicateCheckResult => {
      return detectDuplicate(candidate, currentTransactions)
    },
    [currentTransactions]
  )

  // Add transaction
  const addTransaction = useCallback(
    async (
      data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<Transaction> => {
      const now = new Date().toISOString()
      const newTransaction: Transaction = {
        ...data,
        id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        createdAt: now,
        updatedAt: now,
      }

      if (isDemoMode) {
        // If in demo mode, switch to real mode with this transaction so user doesn't lose entry
        setIsDemoMode(false)
        if (typeof window !== 'undefined') {
          localStorage.setItem('moneymate_is_demo_mode', 'false')
        }
      }

      await repo.add(newTransaction)
      setRealTransactions((prev) => [newTransaction, ...prev])
      return newTransaction
    },
    [isDemoMode]
  )

  // Update existing transaction
  const updateTransaction = useCallback(
    async (transaction: Transaction): Promise<void> => {
      const updated: Transaction = {
        ...transaction,
        updatedAt: new Date().toISOString(),
      }

      if (isDemoMode) {
        // Apply in demo mode view or alert
        setRealTransactions((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t))
        )
        return
      }

      await repo.update(updated)
      setRealTransactions((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      )
    },
    [isDemoMode]
  )

  // Delete transaction
  const deleteTransaction = useCallback(
    async (id: string): Promise<void> => {
      if (!isDemoMode) {
        await repo.delete(id)
      }
      setRealTransactions((prev) => prev.filter((t) => t.id !== id))
    },
    [isDemoMode]
  )

  // Toggle demo mode
  const toggleDemoMode = useCallback((targetMode?: boolean) => {
    setIsDemoMode((prev) => {
      const next = targetMode !== undefined ? targetMode : !prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('moneymate_is_demo_mode', String(next))
      }
      return next
    })
  }, [])

  // Load starter data into real workspace if user explicitly requests
  const loadDemoDataIntoWorkspace = useCallback(async () => {
    for (const item of DEMO_TRANSACTIONS) {
      const cleanItem: Transaction = {
        ...item,
        id: `real-${item.id}`,
        source: 'manual',
      }
      await repo.add(cleanItem)
    }
    await loadTransactions()
    setIsDemoMode(false)
    if (typeof window !== 'undefined') {
      localStorage.setItem('moneymate_is_demo_mode', 'false')
    }
  }, [loadTransactions])

  // Explicitly purge mock data from real database
  const purgeMockDataFromRealDB = useCallback(async (): Promise<number> => {
    try {
      const data = await repo.getAll()
      const mockItems = data.filter(isMockTransaction)
      for (const m of mockItems) {
        await repo.delete(m.id)
      }
      setRealTransactions((prev) => prev.filter((t) => !isMockTransaction(t)))
      return mockItems.length
    } catch (err) {
      console.error('Failed to purge mock transactions:', err)
      return 0
    }
  }, [])

  // Clear real database
  const clearAllRealTransactions = useCallback(async () => {
    await repo.clear()
    setRealTransactions([])
  }, [])

  // Reclassify transfers & fix double-counting on demand
  const reclassifyTransfers = useCallback(async (): Promise<number> => {
    try {
      const data = await repo.getAll()
      let updatedCount = 0
      for (const t of data) {
        if (!isMockTransaction(t) && shouldReclassifyAsTransfer(t)) {
          const updated: Transaction = {
            ...t,
            type: 'transfer',
            category: 'Transfer',
            updatedAt: new Date().toISOString(),
          }
          await repo.update(updated)
          updatedCount++
        }
      }
      await loadTransactions()
      return updatedCount
    } catch (err) {
      console.error('Failed to reclassify transfers:', err)
      return 0
    }
  }, [loadTransactions])

  return {
    transactions: currentTransactions,
    realTransactions,
    filteredTransactions,
    summary,
    loading,
    error,
    isDemoMode,
    filters,
    setFilters,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    checkDuplicate,
    toggleDemoMode,
    loadDemoDataIntoWorkspace,
    purgeMockDataFromRealDB,
    reclassifyTransfers,
    clearAllRealTransactions,
    refresh: loadTransactions,
  }
}
