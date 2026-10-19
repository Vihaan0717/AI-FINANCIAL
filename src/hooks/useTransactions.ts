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
      setRealTransactions(data)
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

  // Clear real database
  const clearAllRealTransactions = useCallback(async () => {
    await repo.clear()
    setRealTransactions([])
  }, [])

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
    clearAllRealTransactions,
    refresh: loadTransactions,
  }
}
