import { useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  RotateCcw,
  Bell,
  Bot,
  CalendarDays,
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Coffee,
  CreditCard,
  Download,
  Edit2,
  Gift,
  HeartPulse,
  House,
  LayoutDashboard,
  Menu,
  Package,
  Pause,
  Play,
  Plus,
  ReceiptText,
  Search,
  Settings,
  Shirt,
  ShoppingBag,
  Sliders,
  Sparkles,
  Square,
  Target,
  Trash2,
  TrendingUp,
  Tv,
  Upload,
  Utensils,
  WalletCards,
  Wrench,
  Zap,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import type { Transaction, PaymentMethod, TransactionStatus, SortField } from './types/transaction'
import type { InventoryItem, InventoryCategory, StockStatus, StockAdjustmentInput } from './types/inventory'
import type { ShoppingListItem, PurchaseResolutionOption } from './types/shopping'
import type { RecurringSchedule, BillInstance, PlannerTask } from './types/planner'
import { formatPaise } from './utils/money'
import { downloadTransactionsCsv } from './utils/csvExport'
import { calculateStockStatus } from './utils/inventoryCalculations'
import { getTodayDateString } from './utils/recurrenceEngine'
import { useTransactions } from './hooks/useTransactions'
import { useInventory } from './hooks/useInventory'
import { useShoppingList } from './hooks/useShoppingList'
import { usePlanner } from './hooks/usePlanner'
import { TransactionModal } from './components/TransactionModal'
import { DeleteConfirmModal } from './components/DeleteConfirmModal'
import { ReceiptCaptureModal, type ConfirmedReceiptInventory } from './components/ReceiptCaptureModal'
import { InventoryItemModal } from './components/InventoryItemModal'
import { StockAdjustmentModal } from './components/StockAdjustmentModal'
import { PurchaseResolutionModal } from './components/PurchaseResolutionModal'
import { AddShoppingItemModal } from './components/AddShoppingItemModal'
import { RecurringScheduleModal } from './components/RecurringScheduleModal'
import { PlannerTaskModal } from './components/PlannerTaskModal'
import { SettleBillModal } from './components/SettleBillModal'
import { CalendarMonthView } from './components/CalendarMonthView'
import { useFinancialInsights } from './hooks/useFinancialInsights'
import { FinancialInsightsView } from './components/FinancialInsightsView'

type Section =
  | 'Dashboard'
  | 'Transactions'
  | 'Budgets & Savings'
  | 'Financial Insights'
  | 'My Inventory'
  | 'Smart Shopping'
  | 'Planner'
  | 'AI Assistant'
  | 'Settings'

const nav: { label: Exclude<Section, 'Settings'>; icon: LucideIcon }[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Transactions', icon: ReceiptText },
  { label: 'Budgets & Savings', icon: Target },
  { label: 'Financial Insights', icon: TrendingUp },
  { label: 'My Inventory', icon: Package },
  { label: 'Smart Shopping', icon: ShoppingBag },
  { label: 'Planner', icon: CalendarDays },
  { label: 'AI Assistant', icon: Bot },
]

function getCategoryIcon(category: string, type: string): LucideIcon {
  if (type === 'transfer') return ArrowLeftRight
  if (type === 'refund') return RotateCcw
  if (type === 'income') return CreditCard

  switch (category) {
    case 'Food & dining':
      return Coffee
    case 'Groceries':
      return Utensils
    case 'Home':
      return House
    case 'Shopping':
      return ShoppingBag
    case 'Health':
      return HeartPulse
    case 'Entertainment':
      return Tv
    case 'Utilities':
      return Zap
    case 'Gift':
      return Gift
    default:
      return Wrench
  }
}

function formatDisplayDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()

    const timeStr = d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })

    if (isToday) {
      return `Today, ${timeStr}`
    }

    const dateFormatted = d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    })
    return `${dateFormatted}, ${timeStr}`
  } catch {
    return dateStr
  }
}

function TransactionRow({
  item,
  onEdit,
  onDelete,
}: {
  item: Transaction
  onEdit: (t: Transaction) => void
  onDelete: (t: Transaction) => void
}) {
  const Icon = getCategoryIcon(item.category || 'Other', item.type)
  const isIncome = item.type === 'income'
  const isTransfer = item.type === 'transfer'
  const isRefund = item.type === 'refund'

  const sign = isIncome ? '+' : isTransfer ? '⇄' : isRefund ? '↺' : '−'
  const amountClass = isIncome ? 'income' : isTransfer ? 'transfer' : isRefund ? 'refund' : 'expense'

  return (
    <div className="transaction-row">
      <div className={`transaction-icon ${(item.category || 'other').toLowerCase().slice(0, 4)}`}>
        <Icon size={16} />
      </div>

      <div className="transaction-name">
        <strong title={item.description}>{item.description}</strong>
        <span>
          {item.category || 'General'} · {item.paymentMethod || 'UPI'}
          {item.merchant ? ` · ${item.merchant}` : ''}
          {item.status !== 'completed' && (
            <span className={`status-pill ${item.status}`} style={{ marginLeft: '6px' }}>
              {item.status}
            </span>
          )}
        </span>
      </div>

      <span className="transaction-date">{formatDisplayDate(item.date)}</span>

      <strong className={amountClass}>
        {sign}
        {formatPaise(item.amount)}
      </strong>

      <div className="transaction-actions">
        <button
          className="action-btn"
          onClick={() => onEdit(item)}
          aria-label={`Edit ${item.description}`}
          title="Edit transaction"
        >
          <Edit2 size={14} />
        </button>
        <button
          className="action-btn delete"
          onClick={() => onDelete(item)}
          aria-label={`Delete ${item.description}`}
          title="Delete transaction"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function App() {
  const [section, setSection] = useState<Section>('Dashboard')
  const [dark, setDark] = useState(false)
  const [sidebar, setSidebar] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [alerts, setAlerts] = useState(false)
  const [toast, setToast] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [geminiKey, setGeminiKey] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('moneymate_gemini_api_key') || '' : ''
  )

  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([
    {
      from: 'ai',
      text: 'Hello! I monitor your confirmed transactions and upcoming commitments to give you precise, evidence-based recommendations.',
    },
  ])

  // Custom Transaction Engine Hook
  const {
    transactions,
    filteredTransactions,
    summary,
    loading,
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
  } = useTransactions()

  // Personal Inventory Hook (Milestone 4)
  const inventoryHook = useInventory()

  // Smart Shopping Hook (Milestone 4)
  const shoppingHook = useShoppingList()

  // User budget limit in rupees (configurable in UI, persisted in localStorage)
  const [userBudgetLimitRupees, setUserBudgetLimitRupees] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('moneymate_user_budget_rupees') || ''
    }
    return ''
  })

  // Inventory modal states
  const [isInvModalOpen, setIsInvModalOpen] = useState(false)
  const [editingInvItem, setEditingInvItem] = useState<InventoryItem | null>(null)
  const [adjustingInvItem, setAdjustingInvItem] = useState<InventoryItem | null>(null)
  const [deletingInvItem, setDeletingInvItem] = useState<InventoryItem | null>(null)

  // Shopping modal states
  const [isAddShoppingModalOpen, setIsAddShoppingModalOpen] = useState(false)
  const [resolvingShopItem, setResolvingShopItem] = useState<ShoppingListItem | null>(null)
  const [shoppingFilterStatus, setShoppingFilterStatus] = useState<'planned' | 'purchased' | 'all'>('planned')

  // Planner & Recurring Commitments Hook (Milestone 5)
  const userBudgetPaise = userBudgetLimitRupees && !isNaN(parseFloat(userBudgetLimitRupees))
    ? Math.round(parseFloat(userBudgetLimitRupees) * 100)
    : undefined

  const {
    schedules,
    bills,
    tasks,
    notifications,
    forecast,
    storageWarning: plannerStorageWarning,
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
  } = usePlanner({
    isDemoMode,
    transactions,
    userBudgetLimitPaise: userBudgetPaise,
    onRecordTransaction: addTransaction,
  })

  // Financial Insights Engine Hook
  const insightsHook = useFinancialInsights({
    transactions,
    bills,
    isDemoMode,
    userBudgetLimitPaise: userBudgetPaise,
    loading,
  })

  // Planner UI states
  const [plannerTab, setPlannerTab] = useState<'agenda' | 'bills' | 'calendar' | 'forecast'>('agenda')
  const [plannerBillFilter, setPlannerBillFilter] = useState<'all' | 'upcoming' | 'due' | 'overdue' | 'paid'>('all')
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(null)

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<RecurringSchedule | null>(null)

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<PlannerTask | null>(null)

  const [settlingBill, setSettlingBill] = useState<BillInstance | null>(null)

  const handleRequestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      notify('Browser notifications are not supported in this browser.')
      return
    }
    if (Notification.permission === 'granted') {
      notify('Browser reminders are enabled and active!')
      return
    }
    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        notify('Browser reminders enabled successfully!')
      } else {
        notify('Notification permission was denied.')
      }
    } catch {
      notify('Could not enable browser notifications.')
    }
  }

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3500)
  }

  const go = (page: Section) => {
    setSection(page)
    setSidebar(false)
  }

  // Open modal for new entry
  const handleOpenAddModal = () => {
    setEditingTransaction(null)
    setIsModalOpen(true)
  }

  // Open modal for editing
  const handleOpenEditModal = (t: Transaction) => {
    setEditingTransaction(t)
    setIsModalOpen(true)
  }

  // Open delete confirm modal
  const handleOpenDeleteModal = (t: Transaction) => {
    setDeletingTransaction(t)
  }

  // Confirm delete action
  const handleConfirmDelete = async () => {
    if (!deletingTransaction) return
    setIsDeleting(true)
    try {
      await deleteTransaction(deletingTransaction.id)
      notify('Transaction deleted successfully')
      setDeletingTransaction(null)
    } catch (err) {
      console.error(err)
      notify('Failed to delete transaction')
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle saving new or updated transaction
  const handleSaveTransaction = async (
    data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    await addTransaction(data)
    notify(`${data.type === 'income' ? 'Income' : data.type === 'refund' ? 'Refund' : 'Expense'} recorded in database`)
  }

  // Handle saving transaction with confirmed inventory line items (Idempotent receipt-to-inventory bridge)
  const handleSaveReceiptTransaction = async (
    data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>,
    inventoryConfirmed?: ConfirmedReceiptInventory
  ) => {
    // 1. Record single financial transaction
    await addTransaction(data)

    // 2. If inventory items were confirmed:
    if (inventoryConfirmed && inventoryConfirmed.confirmedItems.length > 0) {
      let appliedCount = 0
      for (const item of inventoryConfirmed.confirmedItems) {
        if (item.existingItemId) {
          try {
            await inventoryHook.adjustStock(item.existingItemId, {
              type: 'add',
              amount: item.quantity,
              unit: item.unit,
              reason: `Restocked from receipt scan (${item.name})`,
            })
            appliedCount++
          } catch (e) {
            console.error('Failed to restock existing item:', e)
          }
        } else {
          const match = inventoryHook.items.find(
            (inv) => inv.name.toLowerCase().trim() === item.name.toLowerCase().trim()
          )
          if (match) {
            try {
              await inventoryHook.adjustStock(match.id, {
                type: 'add',
                amount: item.quantity,
                unit: item.unit,
                reason: `Restocked from receipt scan (${item.name})`,
              })
              appliedCount++
            } catch (e) {
              console.error('Failed to restock item:', e)
            }
          } else {
            try {
              await inventoryHook.addItem({
                name: item.name,
                category: item.category,
                quantity: item.quantity,
                unit: item.unit,
                purchasePricePaise: item.unitPricePaise,
                lastPurchaseDate: new Date().toISOString(),
              })
              appliedCount++
            } catch (e) {
              console.error('Failed to create new inventory item:', e)
            }
          }
        }
      }

      await shoppingHook.recordReceiptInventoryUpdate({
        id: `rcpt_link_${inventoryConfirmed.receiptId}`,
        receiptId: inventoryConfirmed.receiptId,
        appliedItemIds: inventoryConfirmed.confirmedItems.map((_, i) => `item_${i}`),
        appliedAt: new Date().toISOString(),
      })

      notify(`1 expense recorded & ${appliedCount} items updated in inventory!`)
      return
    }

    notify(`Receipt expense recorded in database`)
  }

  const handleSaveInventoryItem = async (
    itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    if (editingInvItem) {
      await inventoryHook.updateItem(editingInvItem.id, itemData)
      notify(`Updated "${itemData.name}"`)
    } else {
      await inventoryHook.addItem(itemData)
      notify(`Added "${itemData.name}" to inventory`)
    }
  }

  const handleAdjustStock = async (id: string, adjustment: StockAdjustmentInput) => {
    await inventoryHook.adjustStock(id, adjustment)
    notify(`Stock adjusted successfully`)
  }

  const handleDeleteInventoryItem = async () => {
    if (!deletingInvItem) return
    await inventoryHook.deleteItem(deletingInvItem.id)
    notify(`Deleted "${deletingInvItem.name}"`)
    setDeletingInvItem(null)
  }

  const handleResolvePurchase = async (params: {
    itemId: string
    resolution: PurchaseResolutionOption
    quantityPurchased: number
    amountPaise?: number
    paymentMethod: PaymentMethod
    category: string
  }) => {
    const shopItem = shoppingHook.shoppingList.find((s) => s.id === params.itemId)
    if (!shopItem) return

    if (params.resolution === 'both' || params.resolution === 'inventory_only') {
      if (shopItem.inventoryItemId) {
        try {
          await inventoryHook.adjustStock(shopItem.inventoryItemId, {
            type: 'add',
            amount: params.quantityPurchased,
            unit: shopItem.unit,
            reason: `Restocked via shopping list completion`,
          })
        } catch (e) {
          console.error('Failed to restock item:', e)
        }
      } else {
        await inventoryHook.addItem({
          name: shopItem.productName,
          category: (shopItem.isEssential ? 'Household essentials' : 'Personal care and other essentials') as InventoryCategory,
          quantity: params.quantityPurchased,
          unit: shopItem.unit,
          purchasePricePaise: params.amountPaise,
          lastPurchaseDate: new Date().toISOString(),
        })
      }
    }

    if (params.resolution === 'both' || params.resolution === 'transaction_only') {
      if (params.amountPaise && params.amountPaise > 0) {
        await addTransaction({
          type: 'expense',
          amount: params.amountPaise,
          currency: 'INR',
          date: new Date().toISOString(),
          description: `Purchased ${shopItem.productName} (x${params.quantityPurchased} ${shopItem.unit})`,
          category: params.category || 'Shopping',
          paymentMethod: params.paymentMethod,
          status: 'completed',
          notes: `Completed from shopping list: ${shopItem.reason}`,
          source: 'manual',
        })
      }
    }

    await shoppingHook.updateItem(params.itemId, {
      status: 'purchased',
      updatedAt: new Date().toISOString(),
    })

    notify(`Completed purchase for "${shopItem.productName}"`)
  }

  const handleUpdateTransaction = async (t: Transaction) => {
    await updateTransaction(t)
    notify('Transaction updated successfully')
  }

  // Handle CSV export
  const handleExportCsv = () => {
    if (filteredTransactions.length === 0) {
      notify('No transactions to export')
      return
    }
    downloadTransactionsCsv(filteredTransactions)
    notify(`Exported ${filteredTransactions.length} transactions as CSV`)
  }

  // AI Q&A grounded in authoritative figures
  const askAi = (event: FormEvent) => {
    event.preventDefault()
    if (!question.trim()) return

    const userQ = question.trim()
    setMessages((current) => [...current, { from: 'user', text: userQ }])

    // Generate grounded advice based on exact summary
    let reply = `Based on your ${isDemoMode ? 'demo workspace' : 'confirmed real records'}: you have recorded ${formatPaise(summary.totalConfirmedIncome)} in income and ${formatPaise(summary.totalConfirmedExpenses)} in net expenses. `

    if (userQ.toLowerCase().includes('afford') || userQ.includes('1,200') || userQ.includes('headphones')) {
      const spendable = summary.estimatedSpendable
      if (spendable >= 120000) {
        reply += `You have ${formatPaise(spendable)} estimated spendable money remaining after planned commitments (SIPs and bills). A ₹1,200 purchase is well within your budget!`
      } else {
        reply += `Your estimated spendable money is ${formatPaise(spendable)}, which is tight for a ₹1,200 purchase right now. It is safer to wait until next month's salary.`
      }
    } else if (userQ.toLowerCase().includes('reduce') || userQ.toLowerCase().includes('save')) {
      const topCat = summary.categoryTotals[0]
      if (topCat) {
        reply += `Your highest spending category is ${topCat.category} at ${formatPaise(topCat.paise)} (${topCat.percentage}% of expenses). Reducing non-essential purchases here will yield the fastest savings.`
      } else {
        reply += `Log a few more days of expenses to help me identify specific reduction opportunities for you.`
      }
    } else {
      reply += `Your current net cash flow is ${formatPaise(summary.netCashFlow)}, with ${formatPaise(summary.estimatedSpendable)} estimated spendable after planned bills and savings.`
    }

    setMessages((current) => [...current, { from: 'ai', text: reply }])
    setQuestion('')
  }

  const existingExpenses = transactions.filter((t) => t.type === 'expense')

  /* ------------------- Dashboard Section ------------------- */
  const Dashboard = () => {
    // Spending peak
    const peakDay = summary.dailySpending.reduce(
      (max, curr) => (curr.paise > max.paise ? curr : max),
      { date: '', day: '', paise: 0, rupees: 0 }
    )

    return (
      <>
        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <i />
              YOUR FINANCIAL PULSE
            </div>
            <h1>
              Good evening, Arjun <span>✦</span>
            </h1>
            <p>
              Here’s your money and life at a glance.{' '}
              <b
                style={{
                  cursor: 'pointer',
                  color: isDemoMode ? 'var(--orange)' : 'var(--mint)',
                }}
                onClick={() => toggleDemoMode()}
                title="Click to toggle between Real Data and Demo Data"
              >
                {isDemoMode ? '● Demo workspace (Click for Real)' : '● Live database (IndexedDB)'}
              </b>
            </p>
          </div>
          <div className="heading-actions">
            <button className="outline-button" onClick={() => setIsReceiptModalOpen(true)}>
              <Upload size={15} />
              Scan receipt
            </button>
            <button className="outline-button" onClick={handleExportCsv}>
              <Download size={15} />
              Export CSV
            </button>
            <button className="primary-button" onClick={handleOpenAddModal}>
              <Plus size={17} />
              Record transaction
            </button>
          </div>
        </section>

        {/* Top KPI Cards with exact integer paise calculations */}
        <section className="summary-grid">
          <article className="summary-card balance">
            <div className="summary-label">
              <span>Net Cash Flow / Recorded</span>
              <WalletCards size={18} />
            </div>
            <strong>{formatPaise(summary.recordedBalance)}</strong>
            <div className="card-footer">
              <b>
                <TrendingUp size={13} /> Active
              </b>
              <span>{transactions.length} total entries</span>
            </div>
            <i className="orb a" />
            <i className="orb b" />
          </article>

          <article className="summary-card">
            <div className="summary-label">
              <span>Confirmed Income</span>
              <i className="round green">
                <ArrowDownLeft size={16} />
              </i>
            </div>
            <strong>{formatPaise(summary.totalConfirmedIncome)}</strong>
            <div className="card-footer">
              <span>{summary.totalPendingIncome > 0 ? `+${formatPaise(summary.totalPendingIncome)} pending` : 'All settled'}</span>
            </div>
          </article>

          <article className="summary-card">
            <div className="summary-label">
              <span>Net Confirmed Expenses</span>
              <i className="round orange">
                <ArrowUpRight size={16} />
              </i>
            </div>
            <strong>{formatPaise(summary.totalConfirmedExpenses)}</strong>
            <div className="card-footer muted">
              <span>
                {summary.totalRefunds > 0 ? `${formatPaise(summary.totalRefunds)} refunded` : 'Across categories'}
              </span>
            </div>
          </article>

          <article className="summary-card spendable">
            <div className="summary-label">
              <span>Estimated Spendable</span>
              <i className="round purple">
                <Sparkles size={15} />
              </i>
            </div>
            <strong>{formatPaise(summary.estimatedSpendable)}</strong>
            <div className="card-footer">
              <span>After planned bills & SIPs</span>
            </div>
          </article>
        </section>

        {/* Charts & Breakdown */}
        <section className="dashboard-grid">
          {/* Spending Trend Chart */}
          <article className="panel trend-panel">
            <div className="panel-heading">
              <div>
                <h2>Spending trend</h2>
                <p>{isDemoMode ? 'October 2026 · Demo data' : 'Real-time recorded expenses'}</p>
              </div>
              <span className="status-pill completed">
                {summary.dailySpending.length} active days
              </span>
            </div>

            <div className="chart-stat">
              <div>
                <strong>{formatPaise(summary.totalConfirmedExpenses)}</strong>
                <span>spent in total</span>
              </div>
              {summary.totalRefunds > 0 && (
                <b>
                  <RotateCcw size={12} /> {formatPaise(summary.totalRefunds)} refunded
                </b>
              )}
            </div>

            {summary.dailySpending.length > 0 ? (
              <div className="area-wrap ios-area">
                {peakDay.paise > 0 && (
                  <div className="chart-callout">
                    <b>{formatPaise(peakDay.paise)}</b>
                    <span>{peakDay.day} Oct · peak</span>
                  </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.dailySpending} margin={{ top: 24, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="iosArea" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stopColor="#7d74f7" stopOpacity=".65" />
                        <stop offset=".62" stopColor="#8cc9ff" stopOpacity=".22" />
                        <stop offset="1" stopColor="#b9e3ff" stopOpacity="0" />
                      </linearGradient>
                      <filter id="iosGlow" x="-20%" y="-30%" width="140%" height="160%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <XAxis dataKey="day" hide />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ stroke: 'rgba(104,86,221,.34)', strokeWidth: 1, strokeDasharray: '3 5' }}
                      contentStyle={{
                        background: 'rgba(255,255,255,.92)',
                        border: '1px solid rgba(255,255,255,.9)',
                        borderRadius: 14,
                        color: '#17213b',
                        boxShadow: '0 12px 30px rgba(71,79,126,.18)',
                        fontSize: 11,
                      }}
                      formatter={(val: unknown) => [formatPaise(Number(val) * 100), 'Spent']}
                    />
                    <Area
                      type="monotone"
                      dataKey="rupees"
                      stroke="#7066e8"
                      strokeWidth={3.25}
                      fill="url(#iosArea)"
                      filter="url(#iosGlow)"
                      activeDot={{ r: 5, fill: '#fff', stroke: '#7066e8', strokeWidth: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="chart-empty">No expense entries recorded yet</div>
            )}

            <div className="chart-timeline">
              <span>Start</span>
              <span>Mid</span>
              <span className="active">Current</span>
            </div>
          </article>

          {/* Category Distribution Donut */}
          <article className="panel category-panel">
            <div className="panel-heading">
              <div>
                <h2>By category</h2>
                <p>Where your money went</p>
              </div>
              <button className="text-button" onClick={() => go('Transactions')}>
                View all <ChevronRight size={15} />
              </button>
            </div>

            {summary.categoryTotals.length > 0 ? (
              <div className="category-content">
                <div className="donut">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={summary.categoryTotals}
                        dataKey="paise"
                        innerRadius={50}
                        outerRadius={71}
                        paddingAngle={4}
                        stroke="none"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {summary.categoryTotals.map((item) => (
                          <Cell key={item.category} fill={item.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <span>
                    <b>{formatPaise(summary.totalConfirmedExpenses)}</b>
                    <small>spent</small>
                  </span>
                </div>
                <div className="legend">
                  {summary.categoryTotals.slice(0, 4).map((item) => (
                    <div key={item.category}>
                      <i style={{ background: item.color }} />
                      <span>{item.category}</span>
                      <b>{item.percentage}%</b>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="chart-empty">No categorized expenses recorded</div>
            )}
          </article>

          {/* Recent Activity Panel */}
          <article className="panel recent-panel">
            <div className="panel-heading">
              <div>
                <h2>Recent activity</h2>
                <p>Authoritative local records</p>
              </div>
              <button className="text-button" onClick={() => go('Transactions')}>
                View all <ChevronRight size={15} />
              </button>
            </div>

            {summary.recentTransactions.length > 0 ? (
              <div className="transaction-list">
                {summary.recentTransactions.slice(0, 4).map((item) => (
                  <TransactionRow
                    key={item.id}
                    item={item}
                    onEdit={handleOpenEditModal}
                    onDelete={handleOpenDeleteModal}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 12px' }}>
                <p>No transactions yet</p>
                <button className="primary-button" onClick={handleOpenAddModal}>
                  <Plus size={15} /> Add first entry
                </button>
              </div>
            )}
          </article>

          {/* Budget Health Panel */}
          <article className="panel budget-panel">
            <div className="panel-heading">
              <div>
                <h2>Budget health</h2>
                <p>Tracked against plan</p>
              </div>
              <span className="status-pill completed">Protected</span>
            </div>
            <div className="budget-list">
              {[
                ['Groceries', 68, '#3dd9b3'],
                ['Food & dining', 43, '#9c7cff'],
                ['Transport', 29, '#f6b94d'],
              ].map(([name, value, color]) => (
                <div className="budget-line" key={String(name)}>
                  <div>
                    <span>{name}</span>
                    <b>{value}%</b>
                  </div>
                  <p>
                    <i style={{ width: `${value}%`, background: String(color) }} />
                  </p>
                </div>
              ))}
            </div>
            <button className="wide-button" onClick={() => go('Budgets & Savings')}>
              Open budgets <ChevronRight size={16} />
            </button>
          </article>
        </section>

        {/* Lower Intelligence Grid */}
        <section className="bottom-grid">
          <article className="ai-card">
            <div className="ai-top">
              <div className="ai-avatar">
                <Sparkles size={16} />
              </div>
              <div>
                <b>Money Mate AI</b>
                <span>
                  {isDemoMode ? 'Demo workspace insight' : 'Grounded in IndexedDB records'}
                </span>
              </div>
              <button onClick={() => notify('Insight dismissed for now.')}>
                <X size={15} />
              </button>
            </div>
            <h2>
              Spendable buffer: <em>{formatPaise(summary.estimatedSpendable)}</em>
            </h2>
            <p>
              After accounting for your upcoming ₹5,000 SIP and ₹3,200 commitments, you have ample
              headroom for daily necessities.
            </p>
            <button onClick={() => go('AI Assistant')}>
              See my plan <ChevronRight size={16} />
            </button>
            <i />
          </article>

          <article className="panel commitments">
            <div className="panel-heading">
              <div>
                <h2>Coming up</h2>
                <p>Your next commitments</p>
              </div>
              <button className="text-button" onClick={() => go('Planner')}>
                Planner <ChevronRight size={15} />
              </button>
            </div>
            <Commitment date="23" month="OCT" title="Mobile recharge" detail="Due in 4 days · ₹299" />
            <Commitment date="28" month="OCT" title="Monthly SIP" detail="Due in 9 days · ₹5,000" mint />
          </article>

          <article className="panel commitments">
            <div className="panel-heading">
              <div>
                <h2>Needs attention</h2>
                <p>Inventory signals</p>
              </div>
              <button className="text-button" onClick={() => go('My Inventory')}>
                Inventory <ChevronRight size={15} />
              </button>
            </div>
            <Attention emoji="🧴" title="Shampoo" detail="About 20% remaining" tag="Low" />
            <Attention
              shirt
              title="Formal shirts"
              detail="4 items logged"
              button={() => notify('Added to your smart shopping list.')}
            />
          </article>
        </section>
      </>
    )
  }

  /* ------------------- Transactions Section ------------------- */
  const TransactionsPage = () => {
    return (
      <section className="section-page">
        <PageTitle
          eyebrow="PERSISTENT CASH FLOW"
          title="Transactions"
          text={`Authoritative ledger stored in IndexedDB. (${filteredTransactions.length} of ${transactions.length} records shown)`}
          action={
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="outline-button" onClick={() => setIsReceiptModalOpen(true)}>
                <Upload size={15} />
                Scan receipt
              </button>
              <button className="outline-button" onClick={handleExportCsv}>
                <Download size={15} />
                Export CSV
              </button>
              <button className="primary-button" onClick={handleOpenAddModal}>
                <Plus size={17} />
                Record transaction
              </button>
            </div>
          }
        />

        {/* Filter and Search Bar */}
        <div className="filter-bar">
          {/* Search box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '180px' }}>
            <Search size={16} style={{ color: 'var(--muted)' }} />
            <input
              type="text"
              placeholder="Search description, merchant, notes..."
              value={filters.search || ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              style={{
                width: '100%',
                background: 'transparent',
                border: 0,
                outline: 0,
                color: 'var(--text)',
                fontSize: '11px',
              }}
            />
            {filters.search && (
              <button
                className="action-btn"
                style={{ width: '20px', height: '20px' }}
                onClick={() => setFilters((prev) => ({ ...prev, search: '' }))}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Type Filter Tabs */}
          <div className="filter-tabs">
            {(['all', 'expense', 'income', 'transfer', 'refund'] as const).map((t) => (
              <button
                key={t}
                className={`filter-tab ${filters.type === t ? 'active' : ''}`}
                onClick={() => setFilters((prev) => ({ ...prev, type: t }))}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Category Filter */}
          <select
            value={filters.category || 'all'}
            onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
          >
            <option value="all">All categories</option>
            <option value="Food & dining">Food & dining</option>
            <option value="Groceries">Groceries</option>
            <option value="Home">Home</option>
            <option value="Transport">Transport</option>
            <option value="Shopping">Shopping</option>
            <option value="Utilities">Utilities</option>
            <option value="Health">Health</option>
            <option value="Entertainment">Entertainment</option>
            <option value="Income">Income</option>
            <option value="Transfer">Transfer</option>
          </select>

          {/* Payment Method Filter */}
          <select
            value={filters.paymentMethod || 'all'}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, paymentMethod: e.target.value as PaymentMethod | 'all' }))
            }
          >
            <option value="all">All payment methods</option>
            <option value="UPI">UPI</option>
            <option value="Bank transfer">Bank transfer</option>
            <option value="Card">Card</option>
            <option value="Cash">Cash</option>
          </select>

          {/* Status Filter */}
          <select
            value={filters.status || 'all'}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, status: e.target.value as TransactionStatus | 'all' }))
            }
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed only</option>
            <option value="pending">Pending only</option>
            <option value="failed">Failed only</option>
          </select>

          {/* Sort By */}
          <select
            value={filters.sortBy || 'date-desc'}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, sortBy: e.target.value as SortField }))
            }
          >
            <option value="date-desc">Newest date</option>
            <option value="date-asc">Oldest date</option>
            <option value="amount-desc">Highest amount</option>
            <option value="amount-asc">Lowest amount</option>
          </select>
        </div>

        {/* Transactions Table / List */}
        <article className="panel table-panel">
          <div className="table-head" style={{ gridTemplateColumns: 'minmax(150px, 1fr) 130px 100px 70px' }}>
            <span>Transaction</span>
            <span>Date</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {loading ? (
            <div className="empty-state">
              <p>Loading transactions from IndexedDB...</p>
            </div>
          ) : filteredTransactions.length > 0 ? (
            <div className="transaction-list full">
              {filteredTransactions.map((item) => (
                <TransactionRow
                  key={item.id}
                  item={item}
                  onEdit={handleOpenEditModal}
                  onDelete={handleOpenDeleteModal}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <i>
                <ReceiptText size={26} />
              </i>
              <h3>No transactions found</h3>
              <p>
                {transactions.length === 0
                  ? 'Your local IndexedDB database is empty. Add your first transaction or load starter sample data.'
                  : 'No transactions match the selected filters. Try clearing or relaxing your search criteria.'}
              </p>
              {transactions.length === 0 ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="primary-button" onClick={handleOpenAddModal}>
                    <Plus size={16} /> Record first transaction
                  </button>
                  <button className="outline-button" onClick={loadDemoDataIntoWorkspace}>
                    Load sample records
                  </button>
                </div>
              ) : (
                <button
                  className="outline-button"
                  onClick={() =>
                    setFilters({
                      search: '',
                      type: 'all',
                      category: 'all',
                      paymentMethod: 'all',
                      status: 'all',
                      sortBy: 'date-desc',
                    })
                  }
                >
                  Reset all filters
                </button>
              )}
            </div>
          )}
        </article>
      </section>
    )
  }

  /* ------------------- Other Pages ------------------- */
  const Budgets = () => (
    <section className="section-page">
      <PageTitle
        eyebrow="PLAN WITH PURPOSE"
        title="Budgets & savings"
        text="Give every rupee a job—then see your progress."
        action={
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="primary-button" onClick={() => go('Financial Insights')}>
              <Sparkles size={15} />
              Open Financial Insights
            </button>
            <button className="outline-button" onClick={() => notify('Budget creation arrives in the next milestone.')}>
              <Plus size={15} />
              Create budget
            </button>
          </div>
        }
      />
      <article className="goal">
        <i>
          <Target size={25} />
        </i>
        <div>
          <span>PRIMARY GOAL</span>
          <h2>Emergency fund</h2>
          <p>₹18,500 of ₹60,000 saved · on pace for April 2027</p>
        </div>
        <b>31%</b>
        <em>
          <i />
        </em>
      </article>
      <div className="analytics">
        <article className="panel bars">
          <div className="panel-heading">
            <div>
              <h2>Monthly categories</h2>
              <p>October 2026</p>
            </div>
            <button className="select-button">
              October <ChevronDown size={15} />
            </button>
          </div>
          <div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: 'Food', plan: 6000, used: 2580 },
                  { name: 'Home', plan: 3000, used: 2100 },
                  { name: 'Travel', plan: 2500, used: 720 },
                  { name: 'Fun', plan: 2500, used: 1120 },
                ]}
              >
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8490a9', fontSize: 11 }} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: '#171a27', border: '1px solid #30364b', borderRadius: 10 }} />
                <Bar dataKey="plan" fill="#293147" radius={[5, 5, 0, 0]} />
                <Bar dataKey="used" fill="#8370ee" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p>
            <span>
              <i />
              Budgeted
            </span>
            <span>
              <i />
              Used
            </span>
          </p>
        </article>
        <article className="panel sip">
          <span>NEXT INVESTMENT</span>
          <div>
            <i>
              <CircleDollarSign size={24} />
            </i>
            Index fund SIP
          </div>
          <strong>₹5,000</strong>
          <p>Scheduled for 28 Oct</p>
          <button className="outline-button" onClick={() => go('Planner')}>
            View schedule <ChevronRight size={15} />
          </button>
        </article>
      </div>
    </section>
  )

  const Inventory = () => (
    <section className="section-page">
      <PageTitle
        eyebrow="OWN WITH INTENT"
        title="My inventory"
        text="Track physical possessions and essential consumables to avoid redundant purchases."
        action={
          <button
            className="primary-button"
            onClick={() => {
              setEditingInvItem(null)
              setIsInvModalOpen(true)
            }}
          >
            <Plus size={17} />
            Add item
          </button>
        }
      />

      {/* Storage persistence warning banner if memory-only */}
      {(!inventoryHook.isPersistent || inventoryHook.storageWarning) && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: '#fbbf24',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={16} />
          <span>
            <b>Storage Warning:</b> IndexedDB is unavailable. Inventory changes are currently stored in memory only and
            will <b>not</b> survive a page reload.
          </span>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="inventory-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat
          label="Distinct items"
          value={String(inventoryHook.summary.totalItems)}
          text={`${inventoryHook.summary.totalPhysicalQuantity} physical units`}
        />
        <Stat
          label="In stock"
          value={String(inventoryHook.summary.inStockCount)}
          text="Adequately stocked"
          color="mint"
        />
        <Stat
          label="Running low"
          value={String(inventoryHook.summary.lowStockCount)}
          text="Below min threshold"
          color="orange"
        />
        <Stat
          label="Out of stock"
          value={String(inventoryHook.summary.outOfStockCount)}
          text={
            inventoryHook.summary.expiringSoonCount > 0
              ? `${inventoryHook.summary.expiringSoonCount} expiring soon`
              : 'Zero units remaining'
          }
        />
      </div>

      {/* Filter and Search Toolbox */}
      <div className="toolbox">
        <label>
          <Search size={14} />
          <input
            placeholder="Search items, categories, or notes..."
            value={inventoryHook.filter.search || ''}
            onChange={(e) => inventoryHook.setFilter({ ...inventoryHook.filter, search: e.target.value })}
          />
        </label>

        {/* Category selector */}
        <select
          className="select-button"
          value={inventoryHook.filter.category || 'all'}
          onChange={(e) =>
            inventoryHook.setFilter({
              ...inventoryHook.filter,
              category: e.target.value as InventoryCategory | 'all',
            })
          }
        >
          <option value="all">All Categories</option>
          <option value="Clothing">Clothing</option>
          <option value="Household essentials">Household essentials</option>
          <option value="Food and pantry">Food and pantry</option>
          <option value="Personal care and other essentials">Personal care</option>
        </select>

        {/* Status filter */}
        <select
          className="select-button"
          value={inventoryHook.filter.status || 'all'}
          onChange={(e) =>
            inventoryHook.setFilter({
              ...inventoryHook.filter,
              status: e.target.value as StockStatus | 'expiring_soon' | 'all',
            })
          }
        >
          <option value="all">All Stock Statuses</option>
          <option value="in_stock">In Stock</option>
          <option value="running_low">Running Low</option>
          <option value="out_of_stock">Out of Stock</option>
          <option value="expiring_soon">Expiring Soon</option>
        </select>

        {/* Sort */}
        <select
          className="select-button"
          value={inventoryHook.filter.sortBy || 'updated-desc'}
          onChange={(e) =>
            inventoryHook.setFilter({
              ...inventoryHook.filter,
              sortBy: e.target.value as any,
            })
          }
        >
          <option value="updated-desc">Recently Updated</option>
          <option value="name-asc">Name (A-Z)</option>
          <option value="qty-asc">Quantity (Low to High)</option>
          <option value="qty-desc">Quantity (High to Low)</option>
          <option value="expiry-asc">Expiry Date</option>
        </select>
      </div>

      {/* Inventory Item Cards */}
      {inventoryHook.filteredItems.length === 0 ? (
        <div className="empty-state">
          <i><Package size={26} /></i>
          <h3>No inventory items found</h3>
          <p>Try clearing filters or add your first item to start tracking what you own.</p>
          <button
            className="primary-button"
            onClick={() => {
              setEditingInvItem(null)
              setIsInvModalOpen(true)
            }}
          >
            <Plus size={15} /> Add first item
          </button>
        </div>
      ) : (
        <div className="inv-grid">
          {inventoryHook.filteredItems.map((item) => {
            const statusInfo = calculateStockStatus(item)
            return (
              <div key={item.id} className="inv-card">
                <div>
                  <div className="inv-card-header">
                    <div>
                      <h4 className="inv-card-title">{item.name}</h4>
                      <span className="inv-card-category">{item.category}</span>
                    </div>
                    <span className={`inv-pill ${statusInfo.status}`}>
                      {statusInfo.status === 'in_stock' && '✓ '}
                      {statusInfo.status === 'running_low' && '⚡ '}
                      {statusInfo.status === 'out_of_stock' && '✕ '}
                      {statusInfo.label}
                    </span>
                  </div>

                  <div className="inv-meta-row">
                    <div className="inv-qty">
                      {item.quantity}
                      <small>{item.unit}</small>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      {item.minThreshold !== undefined ? (
                        <span className="inv-threshold">Min threshold: {item.minThreshold} {item.unit}</span>
                      ) : (
                        <span className="inv-threshold" style={{ fontStyle: 'italic' }}>
                          {item.category === 'Clothing' ? 'Durable (No alert)' : 'No threshold'}
                        </span>
                      )}
                    </div>
                  </div>

                  {item.purchasePricePaise !== undefined && (
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                      Est. Unit Price: {formatPaise(item.purchasePricePaise)}
                    </div>
                  )}

                  {item.notes && (
                    <p style={{ margin: '4px 0 0', fontSize: '10px', color: 'var(--muted)', fontStyle: 'italic' }}>
                      {item.notes}
                    </p>
                  )}
                </div>

                <div className="inv-card-actions">
                  <button
                    type="button"
                    className="outline-button"
                    style={{ fontSize: '10px', minHeight: '28px', padding: '0 8px' }}
                    onClick={() => setAdjustingInvItem(item)}
                  >
                    <Sliders size={13} style={{ marginRight: '4px' }} />
                    Adjust Stock
                  </button>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="action-btn"
                      title="Edit Item Details"
                      onClick={() => {
                        setEditingInvItem(item)
                        setIsInvModalOpen(true)
                      }}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      type="button"
                      className="action-btn delete"
                      title="Delete Item"
                      onClick={() => setDeletingInvItem(item)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )

  const Shopping = () => {
    const budgetLimitPaise =
      userBudgetLimitRupees.trim() !== '' ? Math.round(parseFloat(userBudgetLimitRupees) * 100) : undefined
    const budgetEval = shoppingHook.evaluateBudget(transactions, budgetLimitPaise)
    const activePlannedCount = shoppingHook.shoppingList.filter((s) => s.status === 'planned').length

    // Filter shopping items by status
    const displayedItems = shoppingHook.shoppingList.filter((s) => {
      if (shoppingFilterStatus === 'all') return true
      return s.status === shoppingFilterStatus
    })

    return (
      <section className="section-page">
        <PageTitle
          eyebrow="BUY BETTER"
          title="Smart shopping"
          text="Deterministic purchase recommendations grounded in inventory stock levels and financial ledger capacity."
          action={
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="outline-button"
                onClick={async () => {
                  const added = await shoppingHook.syncRecommendationsFromInventory(inventoryHook.items)
                  notify(
                    added > 0
                      ? `Generated ${added} priority recommendations from inventory shortages!`
                      : 'Inventory is adequately stocked. No new recommendations needed.'
                  )
                }}
              >
                <Sparkles size={14} color="var(--mint)" />
                Sync from Inventory
              </button>
              <button
                className="primary-button"
                onClick={() => setIsAddShoppingModalOpen(true)}
              >
                <Plus size={17} />
                Add to list
              </button>
            </div>
          }
        />

        {/* AI Deterministic Priority Hero Banner */}
        <article className="shopping-hero">
          <span>
            <Sparkles size={15} />
            DETERMINISTIC SMART ADVISORY
          </span>
          <h2>
            {activePlannedCount > 0
              ? 'Prioritize out-of-stock essentials before discretionary items.'
              : 'Your essentials are well stocked. Avoid impulse purchases.'}
          </h2>
          <p>
            Recommendations are calculated mathematically from real inventory minimum thresholds and your confirmed ledger
            spending. We never recommend items with sufficient stock.
          </p>
          <div>
            <b>✓ Highest Priority: Out-of-stock essentials</b>
            <b>⚡ High Priority: Consumables below threshold</b>
            <b>⏱ Low: Optional / Clothing</b>
          </div>
        </article>

        {/* Stage 5: Budget-Aware Affordability Evaluation Panel */}
        <div className="budget-summary-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
            <div>
              <b style={{ fontSize: '13px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CircleDollarSign size={16} color="var(--mint)" />
                Budget & Cash Flow Affordability Analysis
              </b>
              <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
                Authoritative calculations comparing planned purchase costs against confirmed ledger records.
              </p>
            </div>

            {/* Configurable Monthly Budget Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 700 }}>MONTHLY BUDGET LIMIT:</span>
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '0 8px' }}>
                <span style={{ color: 'var(--purple)', fontSize: '11px', fontWeight: 800 }}>₹</span>
                <input
                  type="number"
                  placeholder="Not set"
                  value={userBudgetLimitRupees}
                  onChange={(e) => {
                    setUserBudgetLimitRupees(e.target.value)
                    localStorage.setItem('moneymate_user_budget_rupees', e.target.value)
                  }}
                  style={{ width: '90px', border: 0, outline: 0, background: 'transparent', color: 'var(--text)', fontSize: '11px', padding: '6px' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
            <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--card)', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block' }}>Planned Shopping Costs</span>
              <b style={{ fontSize: '15px', color: 'var(--purple)' }}>{formatPaise(budgetEval.plannedShoppingCostsPaise)}</b>
              <small style={{ display: 'block', fontSize: '9px', color: 'var(--muted)' }}>For active planned items</small>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--card)', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block' }}>Confirmed Spending</span>
              <b style={{ fontSize: '15px', color: 'var(--text)' }}>{formatPaise(budgetEval.confirmedSpendingPaise)}</b>
              <small style={{ display: 'block', fontSize: '9px', color: 'var(--muted)' }}>Completed ledger expenses</small>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--card)', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block' }}>Pending Transactions</span>
              <b style={{ fontSize: '15px', color: 'var(--orange)' }}>{formatPaise(budgetEval.pendingTransactionsPaise)}</b>
              <small style={{ display: 'block', fontSize: '9px', color: 'var(--muted)' }}>Unsettled / clearing</small>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--card)', border: '1px solid var(--line)' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block' }}>Estimated Spendable Buffer</span>
              <b style={{ fontSize: '15px', color: 'var(--mint)' }}>{formatPaise(budgetEval.estimatedSpendableBufferPaise)}</b>
              <small style={{ display: 'block', fontSize: '9px', color: 'var(--muted)' }}>Net cash flow minus bills</small>
            </div>
          </div>

          {/* Affordability explanation banner */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              background: budgetEval.isAffordable ? 'rgba(52, 211, 153, 0.12)' : 'rgba(248, 113, 113, 0.12)',
              border: budgetEval.isAffordable ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(248, 113, 113, 0.3)',
              color: budgetEval.isAffordable ? '#6ee7b7' : '#fca5a5',
              fontSize: '11px',
              lineHeight: 1.5,
            }}
          >
            <b>{budgetEval.isAffordable ? '✓ Budget Assessment: ' : '⚠️ Budget Assessment: '}</b>
            {budgetEval.summaryExplanation}
            {budgetEval.warnings.length > 0 && (
              <div style={{ marginTop: '4px', fontSize: '10px', opacity: 0.9 }}>
                {budgetEval.warnings.join(' ')}
              </div>
            )}
          </div>
        </div>

        {/* Status filter tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {(['planned', 'purchased', 'all'] as const).map((tab) => (
            <button
              key={tab}
              className={shoppingFilterStatus === tab ? 'primary-button' : 'outline-button'}
              style={{ minHeight: '30px', fontSize: '11px' }}
              onClick={() => setShoppingFilterStatus(tab)}
            >
              {tab === 'planned' ? `Planned (${activePlannedCount})` : tab === 'purchased' ? 'Purchased' : 'All Items'}
            </button>
          ))}
        </div>

        {/* Shopping list table */}
        <div className="shopping-list">
          {displayedItems.length === 0 ? (
            <div className="empty-state" style={{ padding: '36px 20px' }}>
              <i><ShoppingBag size={24} /></i>
              <h3>No items in this shopping list view</h3>
              <p>Click "Sync from Inventory" to scan for depleted supplies, or manually add items.</p>
            </div>
          ) : (
            displayedItems.map((item) => (
              <article key={item.id}>
                <i className={item.priority === 'highest' ? 'top' : item.priority === 'high' ? 'middle' : 'low'} />
                <p>
                  <b>
                    {item.productName} ({item.quantity} {item.unit})
                  </b>
                  <span>
                    Priority: <b>{item.priority.toUpperCase()}</b> · {item.reason}
                  </span>
                </p>
                <strong>
                  {item.estimatedPricePaise ? formatPaise(item.estimatedPricePaise * item.quantity) : 'Price unrecorded'}
                </strong>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {item.status === 'planned' ? (
                    <>
                      <button
                        type="button"
                        style={{ color: 'var(--mint)', borderColor: 'var(--mint)' }}
                        onClick={() => setResolvingShopItem(item)}
                      >
                        Mark bought
                      </button>
                      <button
                        type="button"
                        className="action-btn delete"
                        onClick={() => shoppingHook.deleteItem(item.id)}
                        title="Remove from list"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '10px', color: 'var(--mint)', fontWeight: 700 }}>✓ Purchased</span>
                      <button
                        type="button"
                        className="action-btn delete"
                        onClick={() => shoppingHook.deleteItem(item.id)}
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    )
  }

  const Planner = () => {
    const todayStr = getTodayDateString()

    // Filter bills based on selected tab and sub-filter
    const filteredBills = bills.filter((b) => {
      if (plannerBillFilter === 'all') return true
      if (plannerBillFilter === 'upcoming') return b.status === 'upcoming'
      if (plannerBillFilter === 'due') return b.status === 'due'
      if (plannerBillFilter === 'overdue') return b.status === 'overdue'
      if (plannerBillFilter === 'paid') return b.status === 'paid'
      return true
    })

    // Filter tasks based on selected date if calendar date is active
    const filteredTasks = tasks.filter((t) => {
      if (calendarSelectedDate) {
        return t.dueDate === calendarSelectedDate
      }
      return true
    })

    const todayBills = bills.filter((b) => b.dueDate === todayStr && b.status !== 'paid' && b.status !== 'skipped')
    const todayTasks = tasks.filter((t) => t.dueDate === todayStr && t.status === 'pending')
    const overdueTasks = tasks.filter((t) => t.dueDate < todayStr && t.status === 'pending')

    return (
      <section className="section-page">
        <PageTitle
          eyebrow="STAY AHEAD"
          title="Personal Planner & Recurring Bills"
          text="Track periodic bills, daily tasks, reminders, and future budget projections with zero guesswork."
          action={
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="outline-button"
                onClick={handleRequestNotificationPermission}
                title="Enable browser reminders"
              >
                <Bell size={15} />
                Alerts
              </button>
              <button
                className="outline-button"
                onClick={() => {
                  setEditingSchedule(null)
                  setIsScheduleModalOpen(true)
                }}
              >
                <Plus size={15} />
                New Recurring Bill
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setEditingTask(null)
                  setIsTaskModalOpen(true)
                }}
              >
                <Plus size={15} />
                New Task / Reminder
              </button>
            </div>
          }
        />

        {plannerStorageWarning && (
          <div className="budget-alert-card warning" style={{ marginBottom: '14px' }}>
            <AlertCircle size={18} />
            <p>{plannerStorageWarning}</p>
          </div>
        )}

        {/* Top Summary Stats */}
        <div className="planner-stats-grid">
          <div className="planner-stat-card">
            <span>OVERDUE COMMITMENTS</span>
            <strong style={{ color: forecast.overdueBillsCount > 0 ? '#ef4444' : 'var(--text)' }}>
              {forecast.overdueBillsCount}
            </strong>
            <p>{forecast.overdueBillsCount > 0 ? 'Requires immediate settlement' : 'All past bills settled'}</p>
          </div>

          <div className="planner-stat-card">
            <span>DUE TODAY</span>
            <strong style={{ color: forecast.dueTodayBillsCount > 0 ? '#f59e0b' : 'var(--text)' }}>
              {forecast.dueTodayBillsCount}
            </strong>
            <p>Commitments due by midnight</p>
          </div>

          <div className="planner-stat-card">
            <span>UPCOMING COMMITMENTS (60D)</span>
            <strong style={{ color: 'var(--brand-mint)' }}>
              {formatPaise(forecast.totalUpcomingCommitmentsPaise)}
            </strong>
            <p>{formatPaise(forecast.upcomingScheduledExpensesPaise)} bills + {formatPaise(forecast.plannedSavingsPaise + forecast.plannedInvestmentPaise)} SIPs</p>
          </div>

          <div className="planner-stat-card">
            <span>ACTIVE TASKS</span>
            <strong>{tasks.filter((t) => t.status === 'pending').length}</strong>
            <p>{overdueTasks.length > 0 ? `${overdueTasks.length} task(s) overdue` : 'On track with tasks'}</p>
          </div>
        </div>

        {/* In-app active notifications banner */}
        {notifications.length > 0 && (
          <div className="alert-banner warning">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bell size={18} style={{ color: '#ef4444' }} />
              <div>
                <strong>Active Reminder: {notifications[0].title}</strong>
                <p style={{ margin: 0, fontSize: '0.82rem' }}>{notifications[0].message}</p>
              </div>
            </div>
            <button
              className="outline-button"
              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              onClick={() => dismissNotification(notifications[0].id)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Navigation Sub-Tabs */}
        <div className="planner-tabs">
          <button
            className={`planner-tab ${plannerTab === 'agenda' ? 'active' : ''}`}
            onClick={() => setPlannerTab('agenda')}
          >
            <Clock size={15} />
            Agenda & Tasks ({todayBills.length + todayTasks.length + overdueTasks.length})
          </button>
          <button
            className={`planner-tab ${plannerTab === 'bills' ? 'active' : ''}`}
            onClick={() => setPlannerTab('bills')}
          >
            <CreditCard size={15} />
            Recurring Bills ({bills.length})
          </button>
          <button
            className={`planner-tab ${plannerTab === 'calendar' ? 'active' : ''}`}
            onClick={() => setPlannerTab('calendar')}
          >
            <CalendarIcon size={15} />
            Interactive Calendar
          </button>
          <button
            className={`planner-tab ${plannerTab === 'forecast' ? 'active' : ''}`}
            onClick={() => setPlannerTab('forecast')}
          >
            <TrendingUp size={15} />
            Budget Forecast
          </button>
        </div>

        {/* View 1: Agenda & Tasks */}
        {plannerTab === 'agenda' && (
          <div className="dashboard-grid">
            <article className="panel" style={{ padding: '20px' }}>
              <div className="panel-heading" style={{ marginBottom: '14px' }}>
                <div>
                  <h2>Today's Focus</h2>
                  <p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>

              {todayBills.length === 0 && todayTasks.length === 0 ? (
                <p className="text-muted" style={{ fontSize: '0.88rem', padding: '12px 0' }}>
                  No bills or tasks due today! You're completely up to date.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {todayBills.map((b) => (
                    <div key={b.id} className="bill-card due" style={{ padding: '12px 14px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="bill-pill due">Due Today</span>
                          <strong>{b.title}</strong>
                        </div>
                        <p className="text-muted" style={{ margin: '3px 0 0', fontSize: '0.8rem' }}>
                          {b.category} · Due today
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <strong style={{ fontSize: '1.05rem' }}>{b.amountPaise ? formatPaise(b.amountPaise) : 'Reminder'}</strong>
                        <button
                          className="primary-button"
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                          onClick={() => setSettlingBill(b)}
                        >
                          Settle
                        </button>
                      </div>
                    </div>
                  ))}

                  {todayTasks.map((t) => (
                    <div key={t.id} className="task-item">
                      <button
                        className="icon-button"
                        style={{ padding: 0, width: '22px', height: '22px' }}
                        onClick={() => toggleTaskComplete(t.id)}
                      >
                        <Square size={18} />
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className={`priority-pill ${t.priority}`}>{t.priority}</span>
                          <strong>{t.title}</strong>
                        </div>
                        {t.description && <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '0.8rem' }}>{t.description}</p>}
                      </div>
                      <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                        {t.dueTime || 'All Day'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Overdue tasks if any */}
              {overdueTasks.length > 0 && (
                <div style={{ marginTop: '22px' }}>
                  <h3 style={{ fontSize: '0.95rem', color: '#ef4444', marginBottom: '8px' }}>Overdue Tasks</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {overdueTasks.map((t) => (
                      <div key={t.id} className="task-item" style={{ borderLeft: '3px solid #ef4444' }}>
                        <button
                          className="icon-button"
                          style={{ padding: 0, width: '22px', height: '22px' }}
                          onClick={() => toggleTaskComplete(t.id)}
                        >
                          <Square size={18} />
                        </button>
                        <div style={{ flex: 1 }}>
                          <strong>{t.title}</strong>
                          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#f87171' }}>
                            Was due on {t.dueDate}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>

            {/* Right column: Task backlog & creation */}
            <article className="panel" style={{ padding: '20px' }}>
              <div className="panel-heading" style={{ marginBottom: '14px' }}>
                <div>
                  <h2>All Tasks & Reminders</h2>
                  <p>{tasks.length} total recorded</p>
                </div>
                <button
                  className="primary-button"
                  style={{ padding: '5px 10px', fontSize: '0.8rem' }}
                  onClick={() => {
                    setEditingTask(null)
                    setIsTaskModalOpen(true)
                  }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>

              {tasks.length === 0 ? (
                <div className="empty-state">
                  <CalendarIcon size={36} />
                  <h3>No tasks yet</h3>
                  <p>Add personal tasks, appointments, and deadlines to stay organized.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '500px', overflowY: 'auto' }}>
                  {tasks.map((t) => (
                    <div key={t.id} className={`task-item ${t.status === 'completed' ? 'completed' : ''}`}>
                      <button
                        className="icon-button"
                        style={{ padding: 0, width: '22px', height: '22px' }}
                        onClick={() => toggleTaskComplete(t.id)}
                      >
                        {t.status === 'completed' ? <CheckSquare size={18} className="text-emerald" /> : <Square size={18} />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className={`priority-pill ${t.priority}`}>{t.priority}</span>
                          <strong>{t.title}</strong>
                        </div>
                        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>
                          Due: {t.dueDate} {t.dueTime ? `at ${t.dueTime}` : '· All day'} · {t.category}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          className="action-btn"
                          onClick={() => {
                            setEditingTask(t)
                            setIsTaskModalOpen(true)
                          }}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button className="action-btn delete" onClick={() => deleteTask(t.id)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        )}

        {/* View 2: Recurring Bills & Schedules */}
        {plannerTab === 'bills' && (
          <div>
            {/* Filter pills */}
            <div className="filter-bar">
              <div className="filter-tabs">
                {(['all', 'upcoming', 'due', 'overdue', 'paid'] as const).map((st) => (
                  <button
                    key={st}
                    className={`filter-tab ${plannerBillFilter === st ? 'active' : ''}`}
                    onClick={() => setPlannerBillFilter(st)}
                  >
                    {st.toUpperCase()} ({bills.filter((b) => st === 'all' || b.status === st).length})
                  </button>
                ))}
              </div>
            </div>

            {/* Bill Instances List */}
            <div style={{ marginBottom: '28px' }}>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 12px' }}>Upcoming Bill Occurrences</h3>
              {filteredBills.length === 0 ? (
                <div className="empty-state">
                  <CreditCard size={36} />
                  <h3>No bills in this view</h3>
                  <p>Create a recurring schedule to automatically project your upcoming payments.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {filteredBills.map((b) => (
                    <div key={b.id} className={`bill-card ${b.status}`}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`bill-pill ${b.status}`}>{b.status}</span>
                          <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--soft)', color: 'var(--muted)' }}>
                            {b.commitmentType}
                          </span>
                          <strong style={{ fontSize: '1rem' }}>{b.title}</strong>
                        </div>
                        <p className="text-muted" style={{ margin: '4px 0 0', fontSize: '0.82rem' }}>
                          Due Date: <strong>{b.dueDate}</strong> · {b.category}
                          {b.linkedTransactionId && ` · Linked to Tx #${b.linkedTransactionId.slice(-6)}`}
                        </p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <strong style={{ fontSize: '1.15rem' }}>
                          {b.amountPaise ? formatPaise(b.amountPaise) : 'No amount'}
                        </strong>

                        {b.status !== 'paid' && b.status !== 'skipped' && b.status !== 'cancelled' ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="primary-button"
                              style={{ padding: '6px 12px' }}
                              onClick={() => setSettlingBill(b)}
                            >
                              Settle / Mark Paid
                            </button>
                            <button
                              className="outline-button"
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              onClick={() => skipBill(b.id)}
                            >
                              Skip
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.85rem', color: b.status === 'paid' ? '#10b981' : 'var(--muted)', fontWeight: 700 }}>
                            {b.status === 'paid' ? '✓ Settled' : 'Skipped'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recurring Schedules Master Configuration */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '1.05rem', margin: 0 }}>Recurring Schedules</h3>
                  <p className="text-muted" style={{ fontSize: '0.82rem', margin: '2px 0 0' }}>
                    Master rule templates used to project upcoming bills.
                  </p>
                </div>
                <button
                  className="outline-button"
                  onClick={() => {
                    setEditingSchedule(null)
                    setIsScheduleModalOpen(true)
                  }}
                >
                  <Plus size={14} /> Add Schedule
                </button>
              </div>

              <div className="inv-grid">
                {schedules.map((s) => (
                  <div key={s.id} className="inv-card">
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>
                          {s.frequency} · {s.category}
                        </span>
                        <span className={`bill-pill ${s.status === 'active' ? 'upcoming' : 'skipped'}`}>
                          {s.status}
                        </span>
                      </div>
                      <h4 style={{ fontSize: '1.05rem', margin: '6px 0 2px' }}>{s.title}</h4>
                      <strong style={{ fontSize: '1.2rem', color: 'var(--brand-mint)' }}>
                        {s.amountPaise ? formatPaise(s.amountPaise) : 'Reminder only'}
                      </strong>
                      <p className="text-muted" style={{ fontSize: '0.8rem', margin: '6px 0 0' }}>
                        Next due: {s.nextDueDate}
                        {s.preferredDayOfMonth ? ` (Day ${s.preferredDayOfMonth})` : ''}
                      </p>
                    </div>

                    <div className="inv-card-actions">
                      {s.status === 'active' ? (
                        <button
                          className="text-button"
                          onClick={() => pauseSchedule(s.id)}
                          style={{ color: '#f59e0b' }}
                        >
                          <Pause size={13} style={{ marginRight: '4px' }} /> Pause
                        </button>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() => resumeSchedule(s.id)}
                          style={{ color: '#10b981' }}
                        >
                          <Play size={13} style={{ marginRight: '4px' }} /> Resume
                        </button>
                      )}

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className="action-btn"
                          onClick={() => {
                            setEditingSchedule(s)
                            setIsScheduleModalOpen(true)
                          }}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button className="action-btn delete" onClick={() => deleteSchedule(s.id)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* View 3: Interactive Calendar */}
        {plannerTab === 'calendar' && (
          <div className="dashboard-grid">
            <div>
              <CalendarMonthView
                bills={bills}
                tasks={tasks}
                selectedDate={calendarSelectedDate}
                onSelectDate={setCalendarSelectedDate}
              />
            </div>

            <article className="panel" style={{ padding: '20px' }}>
              <div className="panel-heading" style={{ marginBottom: '14px' }}>
                <div>
                  <h2>{calendarSelectedDate ? `Commitments on ${calendarSelectedDate}` : 'Upcoming 14 Days'}</h2>
                  <p>Synchronized from your bills & tasks</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredBills
                  .filter((b) => (calendarSelectedDate ? b.dueDate === calendarSelectedDate : true))
                  .slice(0, 10)
                  .map((b) => (
                    <div key={b.id} className="bill-card" style={{ padding: '10px 12px' }}>
                      <div>
                        <strong>{b.title}</strong>
                        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '0.78rem' }}>
                          Due: {b.dueDate} · {b.status}
                        </p>
                      </div>
                      <strong>{b.amountPaise ? formatPaise(b.amountPaise) : 'Reminder'}</strong>
                    </div>
                  ))}

                {filteredTasks
                  .filter((t) => (calendarSelectedDate ? t.dueDate === calendarSelectedDate : true))
                  .slice(0, 10)
                  .map((t) => (
                    <div key={t.id} className="task-item" style={{ padding: '8px 12px' }}>
                      <div style={{ flex: 1 }}>
                        <strong>{t.title}</strong>
                        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '0.75rem' }}>
                          {t.dueDate} {t.dueTime ? `at ${t.dueTime}` : '· All day'}
                        </p>
                      </div>
                      <span className={`priority-pill ${t.priority}`}>{t.priority}</span>
                    </div>
                  ))}
              </div>
            </article>
          </div>
        )}

        {/* View 4: Budget Forecast */}
        {plannerTab === 'forecast' && (
          <div>
            <div className="budget-summary-box">
              <h3 style={{ fontSize: '1.1rem', margin: '0 0 6px' }}>Upcoming Commitment Forecast</h3>
              <p className="text-muted" style={{ fontSize: '0.85rem', margin: '0 0 16px' }}>
                Deterministic projections comparing confirmed ledger expenses, scheduled bills, and planned SIPs.
              </p>

              <div className="summary-grid" style={{ marginBottom: '16px' }}>
                <div className="summary-card">
                  <span className="summary-label">CONFIRMED EXPENSES (LEDGER)</span>
                  <strong>{formatPaise(forecast.confirmedSpendingPaise)}</strong>
                  <p className="card-footer">Actual settled expenses</p>
                </div>

                <div className="summary-card">
                  <span className="summary-label">UPCOMING SCHEDULED EXPENSES</span>
                  <strong style={{ color: '#f59e0b' }}>{formatPaise(forecast.upcomingScheduledExpensesPaise)}</strong>
                  <p className="card-footer">Bills awaiting settlement</p>
                </div>

                <div className="summary-card">
                  <span className="summary-label">PLANNED SIPS & WEALTH</span>
                  <strong style={{ color: 'var(--brand-mint)' }}>
                    {formatPaise(forecast.plannedSavingsPaise + forecast.plannedInvestmentPaise)}
                  </strong>
                  <p className="card-footer">Excluded from regular expenses</p>
                </div>

                <div className="summary-card balance">
                  <span className="summary-label">PROJECTED TOTAL SPEND</span>
                  <strong>{formatPaise(forecast.projectedTotalSpendingPaise)}</strong>
                  <p className="card-footer">Confirmed + Scheduled bills</p>
                </div>
              </div>

              <div className="alert-banner info" style={{ margin: 0 }}>
                <div>
                  <strong>Analysis & Budget Status:</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>{forecast.explanation}</p>
                  {forecast.warnings.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '0.8rem' }}>
                      {forecast.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  const Assistant = () => (
    <section className="section-page">
      <div className="ai-heading">
        <i>
          <Sparkles size={26} />
        </i>
        <div>
          <div className="eyebrow">
            <i />
            EVIDENCE-BASED HELP
          </div>
          <h1>Ask Money Mate</h1>
          <p>Get clear answers grounded in your confirmed ledger data and planned commitments.</p>
        </div>
      </div>
      <div className="chat">
        <article className="panel conversation">
          <header>
            <i>
              <Sparkles size={16} />
            </i>
            <div>
              <b>Money Mate AI</b>
              <span>{isDemoMode ? 'Using demo data' : 'Grounded in IndexedDB ledger'}</span>
            </div>
          </header>
          <main>
            {messages.map((item, index) => (
              <p className={item.from} key={index}>
                {item.text}
              </p>
            ))}
          </main>
          <form onSubmit={askAi}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about a purchase, goal, or bill..."
            />
            <button aria-label="Ask AI">
              <ArrowUpRight size={18} />
            </button>
          </form>
        </article>
        <aside>
          <span>TRY ASKING</span>
          {[
            'Can I afford headphones for ₹1,200?',
            'What can I reduce this week?',
            'How is my cash flow looking?',
          ].map((item) => (
            <button key={item} onClick={() => setQuestion(item)}>
              {item}
              <ChevronRight size={15} />
            </button>
          ))}
          <p>
            AI recommendations explain your financial records. They never make automatic changes to your ledger.
          </p>
        </aside>
      </div>
    </section>
  )

  const SettingsPage = () => (
    <section className="section-page">
      <PageTitle
        eyebrow="PREFERENCES & STORAGE"
        title="Settings"
        text="Manage your local database, active workspace mode, and display themes."
      />
      <article className="panel settings">
        <div>
          <p>
            <b>Appearance</b>
            <span>Choose your preferred colour scheme.</span>
          </p>
          <button onClick={() => setDark(false)} className={!dark ? 'selected' : ''}>
            Light
          </button>
          <button onClick={() => setDark(true)} className={dark ? 'selected' : ''}>
            Dark
          </button>
        </div>

        <div>
          <p>
            <b>Active Workspace Data Mode</b>
            <span>
              {isDemoMode
                ? 'Currently in Demo Mode. Real financial records in IndexedDB are untouched.'
                : 'Currently using Real Data. Transactions are securely stored in your browser IndexedDB.'}
            </span>
          </p>
          <button
            onClick={() => toggleDemoMode()}
            className="outline-button"
            style={{ fontSize: '10px' }}
          >
            Switch to {isDemoMode ? 'Real Data' : 'Demo Mode'}
          </button>
        </div>

        <div>
          <p>
            <b>Sample Data Management</b>
            <span>Import initial starter transactions into your real workspace.</span>
          </p>
          <button
            className="outline-button"
            onClick={async () => {
              await loadDemoDataIntoWorkspace()
              notify('Sample records loaded into your real workspace!')
            }}
          >
            Load samples into Real DB
          </button>
        </div>

        <div>
          <p>
            <b>Clear Real Database</b>
            <span>Permanently delete all real transactions from IndexedDB.</span>
          </p>
          {showClearConfirm ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="outline-button"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                style={{ background: 'linear-gradient(135deg, #f87171, #ef4444)', color: '#fff' }}
                onClick={async () => {
                  await clearAllRealTransactions()
                  setShowClearConfirm(false)
                  notify('Real database cleared')
                }}
              >
                Confirm Clear
              </button>
            </div>
          ) : (
            <button
              className="outline-button"
              style={{ color: '#f87171' }}
              onClick={() => setShowClearConfirm(true)}
            >
              Clear Database
            </button>
          )}
        </div>

        <div>
          <p>
            <b>AI Vision & OCR Engine</b>
            <span>
              {geminiKey
                ? 'Gemini 1.5/2.0 Flash Vision Active (Cloud Multimodal AI)'
                : 'Client-side Tesseract.js Active (100% Free & Private in WebAssembly)'}
            </span>
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="password"
              placeholder="Optional Gemini API Key"
              value={geminiKey}
              onChange={(e) => {
                setGeminiKey(e.target.value)
                localStorage.setItem('moneymate_gemini_api_key', e.target.value)
              }}
              style={{
                height: '32px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid var(--line)',
                background: 'var(--deep)',
                color: 'var(--text)',
                fontSize: '10px',
                width: '180px',
              }}
            />
            {geminiKey && (
              <button
                className="outline-button"
                style={{ fontSize: '10px', minHeight: '32px' }}
                onClick={() => {
                  setGeminiKey('')
                  localStorage.removeItem('moneymate_gemini_api_key')
                  notify('Reset to client-side Tesseract OCR')
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div>
          <p>
            <b>Cloud Connection & Auth</b>
            <span>Supabase sync and multi-device accounts arrive in milestone 9.</span>
          </p>
          <em>Milestone 9</em>
        </div>
      </article>
    </section>
  )

  const views: Record<Section, () => React.JSX.Element> = {
    Dashboard,
    Transactions: TransactionsPage,
    'Budgets & Savings': Budgets,
    'Financial Insights': () => (
      <FinancialInsightsView
        insights={insightsHook}
        onNavigateToTransactions={() => go('Transactions')}
        onNavigateToPlanner={() => go('Planner')}
      />
    ),
    'My Inventory': Inventory,
    'Smart Shopping': Shopping,
    Planner,
    'AI Assistant': Assistant,
    Settings: SettingsPage,
  }

  const View = views[section]

  return (
    <div className={`app ${dark ? 'dark' : 'light'}`}>
      {/* Sidebar Dock */}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="brand">
          <i>
            <Sparkles size={18} />
          </i>
          <b>
            money<span>mate</span>
          </b>
          <button onClick={() => setSidebar(false)}>
            <X size={19} />
          </button>
        </div>
        <nav>
          <span>WORKSPACE</span>
          {nav.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                className={section === item.label ? 'active' : ''}
                onClick={() => go(item.label)}
                aria-label={item.label}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.label === 'AI Assistant' && <i />}
              </button>
            )
          })}
        </nav>
        <footer>
          <button
            className={section === 'Settings' ? 'active' : ''}
            onClick={() => go('Settings')}
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <div>
            <i>A</i>
            <p>
              <b>Arjun Singh</b>
              <span>Free plan</span>
            </p>
            <ChevronDown size={15} />
          </div>
        </footer>
      </aside>

      {sidebar && <button className="scrim" onClick={() => setSidebar(false)} aria-label="Close navigation" />}

      {/* Main View Area */}
      <main>
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setSidebar(true)}>
            <Menu size={20} />
          </button>

          <div className="crumb">
            Money Mate <ChevronRight size={14} />
            <b>{section}</b>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Active Data Mode Indicator Pill */}
            <button
              className={`mode-badge ${isDemoMode ? 'demo' : 'real'}`}
              onClick={() => toggleDemoMode()}
              title="Click to toggle between Real Data and Demo Data"
            >
              <i
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: isDemoMode ? 'var(--orange)' : 'var(--mint)',
                  boxShadow: `0 0 8px ${isDemoMode ? 'var(--orange)' : 'var(--mint)'}`,
                }}
              />
              {isDemoMode ? 'Demo Mode' : 'Live Data'}
            </button>

            <button
              className="theme icon-button"
              onClick={() => setDark((x) => !x)}
              title="Toggle theme"
            >
              {dark ? '◐' : '◑'}
            </button>

            <section className="alert">
              <button className="icon-button" onClick={() => setAlerts((x) => !x)}>
                <Bell size={19} />
                <i />
              </button>
              {alerts && (
                <article>
                  <b>2 items need attention</b>
                  <p>Your mobile recharge and shampoo stock are approaching.</p>
                  <button onClick={() => go('Planner')}>Review now</button>
                </article>
              )}
            </section>

            <button className="ai-button" onClick={() => go('AI Assistant')}>
              <Sparkles size={15} />
              Ask AI
            </button>
          </div>
        </header>

        <div className="content">
          <View />
        </div>
      </main>

      {/* Add / Edit Transaction Modal */}
      <TransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={editingTransaction}
        existingExpenses={existingExpenses}
        onSave={handleSaveTransaction}
        onUpdate={handleUpdateTransaction}
        checkDuplicate={checkDuplicate}
      />

      {/* AI Receipt & Payment Capture Modal */}
      <ReceiptCaptureModal
        isOpen={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        onSaveTransaction={handleSaveReceiptTransaction}
        checkDuplicate={checkDuplicate}
        existingInventory={inventoryHook.items}
        hasReceiptInventoryUpdate={shoppingHook.hasReceiptInventoryUpdate}
      />

      {/* Add / Edit Inventory Item Modal */}
      <InventoryItemModal
        isOpen={isInvModalOpen}
        onClose={() => {
          setIsInvModalOpen(false)
          setEditingInvItem(null)
        }}
        onSave={handleSaveInventoryItem}
        initialItem={editingInvItem}
      />

      {/* Stock Adjustment Modal */}
      <StockAdjustmentModal
        isOpen={!!adjustingInvItem}
        onClose={() => setAdjustingInvItem(null)}
        item={adjustingInvItem}
        onAdjust={handleAdjustStock}
      />

      {/* Add Shopping Item Modal */}
      <AddShoppingItemModal
        isOpen={isAddShoppingModalOpen}
        onClose={() => setIsAddShoppingModalOpen(false)}
        onAdd={async (item) => {
          await shoppingHook.addItem(item)
          notify(`Added "${item.productName}" to shopping list`)
        }}
        existingInventory={inventoryHook.items}
      />

      {/* Smart Purchase Resolution Modal */}
      <PurchaseResolutionModal
        isOpen={!!resolvingShopItem}
        onClose={() => setResolvingShopItem(null)}
        item={resolvingShopItem}
        onResolve={handleResolvePurchase}
      />

      {/* Delete Inventory Item Confirmation Dialog */}
      {deletingInvItem && (
        <div className="backdrop" role="dialog" aria-modal="true">
          <div className="modal" style={{ width: 'min(100%, 420px)' }}>
            <header>
              <h2>Delete Inventory Item?</h2>
              <button className="icon-button" onClick={() => setDeletingInvItem(null)} aria-label="Close dialog">
                <X size={20} />
              </button>
            </header>
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '14px 0' }}>
              Are you sure you want to delete <b>{deletingInvItem.name}</b>? This action will remove the item from your inventory records.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="outline-button" onClick={() => setDeletingInvItem(null)}>
                Cancel
              </button>
              <button
                className="primary-button"
                style={{ background: '#ef4444', borderColor: '#ef4444' }}
                onClick={handleDeleteInventoryItem}
              >
                Delete Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recurring Schedule Modal */}
      <RecurringScheduleModal
        isOpen={isScheduleModalOpen}
        scheduleToEdit={editingSchedule}
        onClose={() => {
          setIsScheduleModalOpen(false)
          setEditingSchedule(null)
        }}
        onSave={async (data) => {
          if (editingSchedule) {
            await updateSchedule(editingSchedule.id, data)
            notify('Recurring schedule updated')
          } else {
            await addSchedule(data)
            notify('Recurring schedule created')
          }
        }}
      />

      {/* Planner Task Modal */}
      <PlannerTaskModal
        isOpen={isTaskModalOpen}
        taskToEdit={editingTask}
        initialDate={calendarSelectedDate || undefined}
        onClose={() => {
          setIsTaskModalOpen(false)
          setEditingTask(null)
        }}
        onSave={async (data) => {
          if (editingTask) {
            await updateTask(editingTask.id, data)
            notify('Task updated')
          } else {
            await addTask(data)
            notify('Task created')
          }
        }}
      />

      {/* Settle Bill Modal */}
      <SettleBillModal
        isOpen={!!settlingBill}
        bill={settlingBill}
        onClose={() => setSettlingBill(null)}
        onConfirm={async (options) => {
          if (settlingBill) {
            await settleBill(settlingBill.id, options)
            notify(
              options.recordTransaction
                ? 'Bill marked paid & expense recorded in ledger'
                : 'Bill marked paid (no transaction created)'
            )
          }
        }}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        transaction={deletingTransaction}
        onClose={() => setDeletingTransaction(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="toast">
          <i>✓</i>
          {toast}
        </div>
      )}
    </div>
  )
}

function PageTitle({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string
  title: string
  text: string
  action?: React.ReactNode
}) {
  return (
    <header className="page-heading standard">
      <div>
        <div className="eyebrow">
          <i />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </header>
  )
}

function Commitment({
  date,
  month,
  title,
  detail,
  mint,
}: {
  date: string
  month: string
  title: string
  detail: string
  mint?: boolean
}) {
  return (
    <div className="commit">
      <i className={mint ? 'mint' : ''}>
        <b>{date}</b>
        <small>{month}</small>
      </i>
      <p>
        <b>{title}</b>
        <span>{detail}</span>
      </p>
      <ChevronRight size={17} />
    </div>
  )
}

function Attention({
  emoji,
  shirt,
  title,
  detail,
  tag,
  button,
}: {
  emoji?: string
  shirt?: boolean
  title: string
  detail: string
  tag?: string
  button?: () => void
}) {
  return (
    <div className="commit attention">
      <i>{shirt ? <Shirt size={19} /> : emoji}</i>
      <p>
        <b>{title}</b>
        <span>{detail}</span>
      </p>
      {tag ? <em>{tag}</em> : <button onClick={button}>Add list</button>}
    </div>
  )
}

function Stat({
  label,
  value,
  text,
  color,
}: {
  label: string
  value: string
  text: string
  color?: string
}) {
  return (
    <article>
      <span>{label}</span>
      <strong className={color}>{value}</strong>
      <p>{text}</p>
    </article>
  )
}

export default App
