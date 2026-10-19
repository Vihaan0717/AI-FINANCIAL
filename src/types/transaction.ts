export type TransactionType = 'income' | 'expense' | 'transfer' | 'refund'

export type TransactionStatus = 'completed' | 'pending' | 'failed'

export type PaymentMethod = 'UPI' | 'Bank transfer' | 'Card' | 'Cash' | 'Other'

export type TransactionSource = 'manual' | 'receipt' | 'screenshot' | 'csv' | 'demo'

export interface Transaction {
  id: string
  type: TransactionType
  amount: number // Exact integer paise (e.g., 10000 = ₹100.00)
  currency: 'INR'
  date: string // ISO 8601 string (e.g. "2026-10-19T10:30:00.000Z")
  description: string
  merchant?: string
  category: string
  categoryId?: string
  subcategory?: string
  paymentMethod: PaymentMethod
  accountId?: string
  fromAccount?: string // For transfers
  toAccount?: string // For transfers
  status: TransactionStatus
  notes?: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  source?: TransactionSource
  linkedTransactionId?: string // e.g. for refund linking to an original expense
  externalRef?: string // Bank UTR or UPI reference ID
  isDemo?: boolean
}

export type SortField = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

export interface TransactionFilter {
  search?: string
  type?: TransactionType | 'all'
  category?: string | 'all'
  paymentMethod?: PaymentMethod | 'all'
  status?: TransactionStatus | 'all'
  startDate?: string
  endDate?: string
  sortBy?: SortField
}

export interface CategorySummary {
  category: string
  paise: number
  count: number
  percentage: number
  color?: string
}

export interface DailySpendPoint {
  date: string
  day: string
  paise: number
  rupees: number
}

export interface FinancialSummary {
  totalConfirmedIncome: number // paise
  totalConfirmedExpenses: number // paise (gross minus linked refunds)
  grossConfirmedExpenses: number // paise
  netCashFlow: number // paise (income - net expenses)
  totalTransfers: number // paise (strictly excluded from income/expense)
  totalRefunds: number // paise
  totalPendingIncome: number // paise
  totalPendingExpenses: number // paise
  failedCount: number
  categoryTotals: CategorySummary[]
  dailySpending: DailySpendPoint[]
  estimatedSpendable: number // paise
  recordedBalance: number // paise (based on recorded income/expense activity)
  recentTransactions: Transaction[]
}

export interface DuplicateCheckResult {
  isDuplicate: boolean
  match?: Transaction
  reason?: string
  confidence: 'high' | 'medium'
}
