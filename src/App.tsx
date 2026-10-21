import { useState, useMemo, useEffect, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowLeft,
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
  Database,
  Download,
  Edit2,
  FileSpreadsheet,
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
  ShieldCheck,
  ShoppingBag,
  Sliders,
  Sparkles,
  Square,
  Target,
  Tag,
  Trash2,
  TrendingUp,
  Tv,
  Upload,
  Utensils,
  Wrench,
  Zap,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import './liquid-glass.css'
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
import { BackupModal } from './components/BackupModal'
import { CategoryManagementModal } from './components/CategoryManagementModal'
import { ReconciliationModal } from './components/ReconciliationModal'
import { AuthOnboardingModal } from './components/AuthOnboardingModal'
import { TransactionDetailModal } from './components/TransactionDetailModal'
import { useCategories } from './hooks/useCategories'
import { useAuth } from './hooks/useAuth'
import {
  AuthLayout,
  WelcomeScreen,
  RegisterScreen,
  LoginScreen,
  OtpVerifyScreen,
  ResetPasswordScreen,
  AppIntroSlides,
} from './components/auth'
import { getLucideCategoryIcon } from './utils/categoryIcons'
import type { Category } from './types/category'
import type { RestoreResult } from './types/backup'

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

function getCategoryIcon(category: string, type: string, categoryMap?: Map<string, Category>): LucideIcon {
  if (categoryMap && category) {
    const match = categoryMap.get(category.toLowerCase())
    if (match) {
      return getLucideCategoryIcon(match.icon)
    }
  }

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

function splitDisplayDate(dateStr: string): { date: string; time: string } {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return { date: dateStr, time: '' }
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    return { date, time }
  } catch {
    return { date: dateStr, time: '' }
  }
}

function TransactionRow({
  item,
  onEdit,
  onDelete: _onDelete,
  onSelect,
  categoryMap,
  isTableView = false,
}: {
  item: Transaction
  onEdit?: (t: Transaction) => void
  onDelete?: (t: Transaction) => void
  onSelect?: (t: Transaction) => void
  categoryMap?: Map<string, Category>
  isTableView?: boolean
}) {
  const Icon = getCategoryIcon(item.category || 'Other', item.type, categoryMap)
  const matchedCategory = categoryMap?.get((item.category || '').toLowerCase())
  const categoryColor = matchedCategory?.color
  const isIncome = item.type === 'income'
  const isTransfer = item.type === 'transfer'
  const isRefund = item.type === 'refund'

  // Refined spaced sign so symbols never collide with ₹
  const sign = isIncome ? '+ ' : isTransfer ? '⇄ ' : isRefund ? '+ ' : '− '
  const amountClass = isIncome ? 'income' : isTransfer ? 'transfer' : isRefund ? 'refund' : 'expense'
  const { date: displayDate, time: displayTime } = splitDisplayDate(item.date)

  const handleRowClick = () => {
    if (onSelect) {
      onSelect(item)
    } else if (onEdit) {
      onEdit(item)
    }
  }

  if (isTableView) {
    return (
      <div
        className="transaction-row liquid-tx-grid liquid-tx-row"
        onClick={handleRowClick}
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        title="Tap to view details, edit, or delete"
      >
        {/* Col 1: Transaction Main (Icon + Description + Category/Payment) */}
        <div className="liquid-tx-col-main" style={{ minWidth: 0, flex: '1 1 0%' }}>
          <div
            className={`transaction-icon ${(item.category || 'other').toLowerCase().slice(0, 4)}`}
            style={categoryColor ? { backgroundColor: `${categoryColor}20`, color: categoryColor } : undefined}
          >
            <Icon size={16} />
          </div>
          <div className="transaction-name" style={{ minWidth: 0, flex: '1 1 0%' }}>
            <strong className="transaction-title">{item.description}</strong>
            <div className="transaction-meta">
              <span>{item.category || 'General'}</span>
              <span className="dot-sep">·</span>
              <span>{item.paymentMethod || 'UPI'}</span>
              <span className="dot-sep">·</span>
              <span className="transaction-date-text">{displayDate}</span>
              {isRefund && (
                <span className="status-pill completed" style={{ marginLeft: '4px' }}>
                  Refund
                </span>
              )}
              {item.status && item.status !== 'completed' && (
                <span className={`status-pill ${item.status}`} style={{ marginLeft: '4px' }}>
                  {item.status}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Col 2: Date slot - Dedicated Column (hidden on mobile) */}
        <div className="liquid-tx-col-date">
          <span>{displayDate}</span>
          {displayTime && <small>{displayTime}</small>}
        </div>

        {/* Col 3: Amount slot - Dedicated Column (strictly right-aligned) */}
        <div className="liquid-tx-col-amount" style={{ marginLeft: 'auto', textAlign: 'right', justifySelf: 'end' }}>
          <strong className={`transaction-amount ${amountClass}`} style={{ textAlign: 'right' }}>
            {sign}{formatPaise(item.amount)}
          </strong>
        </div>
      </div>
    )
  }

  return (
    <div
      className="transaction-row"
      onClick={handleRowClick}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      title="Tap to view details, edit, or delete"
    >
      <div
        className={`transaction-icon ${(item.category || 'other').toLowerCase().slice(0, 4)}`}
        style={categoryColor ? { backgroundColor: `${categoryColor}20`, color: categoryColor } : undefined}
      >
        <Icon size={16} />
      </div>

      <div className="transaction-name" style={{ minWidth: 0, flex: '1 1 0%' }}>
        <strong className="transaction-title">{item.description}</strong>
        <div className="transaction-meta">
          <span>{item.category || 'General'}</span>
          <span className="dot-sep">·</span>
          <span>{item.paymentMethod || 'UPI'}</span>
          <span className="dot-sep">·</span>
          <span className="transaction-date-text">{formatDisplayDate(item.date)}</span>
          {isRefund && (
            <span className="status-pill completed" style={{ marginLeft: '4px' }}>
              Refund
            </span>
          )}
          {item.status && item.status !== 'completed' && (
            <span className={`status-pill ${item.status}`} style={{ marginLeft: '4px' }}>
              {item.status}
            </span>
          )}
        </div>
      </div>

      <div className="transaction-right" style={{ marginLeft: 'auto', textAlign: 'right', justifySelf: 'end' }}>
        <strong className={`transaction-amount ${amountClass}`} style={{ textAlign: 'right' }}>
          {sign}{formatPaise(item.amount)}
        </strong>
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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const auth = useAuth()
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const [authModalTab, setAuthModalTab] = useState<'onboarding' | 'auth'>('onboarding')
  const [authScreen, setAuthScreen] = useState<'welcome' | 'register' | 'login' | 'otp_verify' | 'forgot_password'>('welcome')
  const [pendingOtpEmail, setPendingOtpEmail] = useState<string>('')
  const [otpType, setOtpType] = useState<'email' | 'signup'>('email')
  const [hasCompletedIntro, setHasCompletedIntro] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('moneymate_intro_completed') === 'true'
    }
    return false
  })
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('moneymate_guest_session') === 'true'
    }
    return false
  })
  const [selectedDetailTransaction, setSelectedDetailTransaction] = useState<Transaction | null>(null)
  const [userDisplayName, setUserDisplayName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('moneymate_display_name') || ''
    }
    return ''
  })

  // Dynamic user name based on logged-in Supabase account or custom display name
  const effectiveUserName = useMemo(() => {
    if (auth.isAuthenticated && auth.user) {
      const metaName = auth.user.user_metadata?.full_name || auth.user.user_metadata?.name
      if (metaName) return metaName
      if (userDisplayName) return userDisplayName
      if (auth.user.email) {
        const prefix = auth.user.email.split('@')[0]
        return prefix
          .split(/[._-]/)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
      }
    }
    return userDisplayName || 'Arjun Singh'
  }, [auth.isAuthenticated, auth.user, userDisplayName])

  // Dynamic local time-of-day greeting (Morning / Afternoon / Evening)
  const timeGreeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour >= 4 && hour < 12) return 'Good morning'
    if (hour >= 12 && hour < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])

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
    purgeMockDataFromRealDB,
    reclassifyTransfers,
    clearAllRealTransactions,
    refresh: refreshTransactions,
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

  // Configurable Emergency Fund savings target
  const [emergencyGoalRupees, setEmergencyGoalRupees] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('moneymate_emergency_goal_rupees')
      if (saved && !isNaN(parseInt(saved, 10))) return parseInt(saved, 10)
    }
    return 60000
  })

  // Category specific budget targets
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('moneymate_category_budgets')
        if (saved) return JSON.parse(saved)
      } catch {
        // ignore
      }
    }
    return {}
  })

  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false)
  const [editingBudgetCategory, setEditingBudgetCategory] = useState<string | null>(null)

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
    refreshData: refreshPlannerData,
  } = usePlanner({
    isDemoMode,
    transactions,
    userBudgetLimitPaise: userBudgetPaise,
    onRecordTransaction: addTransaction,
  })

  // Category Engine Hook (Milestone 7.2)
  const categoryHook = useCategories(isDemoMode)
  const categoryMap = categoryHook.categoryMap
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)

  const isCategoryInUse = async (categoryId: string, categoryName: string): Promise<boolean> => {
    return transactions.some(
      (t) => t.categoryId === categoryId || t.category?.toLowerCase() === categoryName.toLowerCase()
    )
  }

  // Financial Insights Engine Hook
  const insightsHook = useFinancialInsights({
    transactions,
    bills,
    isDemoMode,
    userBudgetLimitPaise: userBudgetPaise,
    loading,
    classificationMap: categoryHook.classificationMap,
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
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false)
  const [isReconciliationModalOpen, setIsReconciliationModalOpen] = useState(false)

  const handleRestoreComplete = async (result: RestoreResult) => {
    await refreshTransactions()
    await inventoryHook.reload()
    await shoppingHook.reload()
    await refreshPlannerData()
    await categoryHook.reload()
    notify(
      `Database ${result.mode === 'replace' ? 'replaced' : 'merged'} successfully (${result.recordsProcessed} records processed)`
    )
  }

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
    const [analyticsTab, setAnalyticsTab] = useState<'cashflow' | 'categories'>('cashflow')
    const [waveHoverIndex, setWaveHoverIndex] = useState<number | null>(null)

    // Authentic last 7 days spending wave data
    const last7DaysWaveData = useMemo(() => {
      let refDate = new Date()
      const expenseDates = transactions
        .filter((t) => t.type === 'expense')
        .map((t) => new Date(t.date).getTime())
        .filter((t) => !isNaN(t))
      if (expenseDates.length > 0) {
        refDate = new Date(Math.max(...expenseDates))
      }

      const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

      const expenseMap = new Map<string, number>()
      transactions.forEach((t) => {
        if (t.type === 'expense') {
          const key = t.date.includes('T') ? t.date.split('T')[0] : t.date.slice(0, 10)
          expenseMap.set(key, (expenseMap.get(key) || 0) + t.amount)
        }
      })

      const days: {
        dateStr: string
        dayLabel: string
        fullDay: string
        dateFormatted: string
        amountPaise: number
        rupees: number
      }[] = []

      for (let i = 6; i >= 0; i--) {
        const d = new Date(refDate)
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().slice(0, 10)
        const dayOfWeek = d.getDay()
        const amountPaise = expenseMap.get(dateStr) || 0
        days.push({
          dateStr,
          dayLabel: dayLetters[dayOfWeek],
          fullDay: dayNames[dayOfWeek],
          dateFormatted: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          amountPaise,
          rupees: Math.round(amountPaise / 100),
        })
      }

      return days
    }, [transactions])

    const wavePoints = useMemo(() => {
      const maxVal = Math.max(...last7DaysWaveData.map((d) => d.amountPaise), 1)
      const width = 320
      const padX = 14
      const usableW = width - padX * 2
      const stepX = usableW / 6

      return last7DaysWaveData.map((d, i) => {
        const x = padX + i * stepX
        const ratio = d.amountPaise / maxVal
        const y = 85 - ratio * 55
        return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ...d }
      })
    }, [last7DaysWaveData])

    const { waveAreaPath, waveLinePath } = useMemo(() => {
      if (wavePoints.length === 0) return { waveAreaPath: '', waveLinePath: '' }
      let linePath = `M ${wavePoints[0].x} ${wavePoints[0].y}`
      for (let i = 0; i < wavePoints.length - 1; i++) {
        const p0 = wavePoints[i]
        const p1 = wavePoints[i + 1]
        const cpx1 = ((p0.x + p1.x) / 2).toFixed(1)
        const cpx2 = ((p0.x + p1.x) / 2).toFixed(1)
        linePath += ` C ${cpx1} ${p0.y}, ${cpx2} ${p1.y}, ${p1.x} ${p1.y}`
      }
      const areaPath = `${linePath} L ${wavePoints[wavePoints.length - 1].x} 110 L ${wavePoints[0].x} 110 Z`
      return { waveAreaPath: areaPath, waveLinePath: linePath }
    }, [wavePoints])

    const last7DaysTotalPaise = useMemo(() => {
      return last7DaysWaveData.reduce((sum, d) => sum + d.amountPaise, 0)
    }, [last7DaysWaveData])

    const activeWaveIndex = waveHoverIndex !== null ? waveHoverIndex : 6
    const activePoint = wavePoints[activeWaveIndex] || wavePoints[0]

    const cashFlowBarData = useMemo(() => {
      const dayMap = new Map<string, { date: string; label: string; incomePaise: number; expensePaise: number }>()
      const sorted = [...transactions]
        .filter((t) => t.status === 'completed')
        .sort((a, b) => a.date.localeCompare(b.date))

      sorted.forEach((t) => {
        const dateKey = t.date.includes('T') ? t.date.split('T')[0] : t.date
        const dObj = new Date(dateKey)
        const label = !isNaN(dObj.getTime())
          ? dObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
          : dateKey.slice(5, 10)

        if (!dayMap.has(dateKey)) {
          dayMap.set(dateKey, { date: dateKey, label, incomePaise: 0, expensePaise: 0 })
        }
        const entry = dayMap.get(dateKey)!
        if (t.type === 'income') entry.incomePaise += t.amount
        else if (t.type === 'expense') entry.expensePaise += t.amount
      })

      const entries = Array.from(dayMap.values())
      const slice = entries.length > 10 ? entries.slice(-10) : entries
      return slice.map((e) => ({
        name: e.label,
        income: Math.round(e.incomePaise / 100),
        expense: Math.round(e.expensePaise / 100),
        net: Math.round((e.incomePaise - e.expensePaise) / 100),
      }))
    }, [transactions])

    const budgetStats = useMemo(() => {
      const topCategories = summary.categoryTotals.slice(0, 3)
      const defaults = [
        { name: 'Groceries', pct: 68, color: '#ff9f5a' },
        { name: 'Food & dining', pct: 43, color: '#6c8cff' },
        { name: 'Transport', pct: 29, color: '#22c3a6' },
      ]
      if (topCategories.length === 0) return defaults
      return defaults.map((d, i) => {
        const cat = topCategories[i]
        return cat
          ? { name: cat.category, pct: cat.percentage || d.pct, color: cat.color || d.color }
          : d
      })
    }, [summary.categoryTotals])

    const dashOffset = (pct: number) => (163.4 * pct / 100).toFixed(1)

    // Upcoming dues: planner upcoming instances or fallback
    const upcomingDues = useMemo(() => {
      return [
        {
          day: '23',
          month: 'OCT',
          name: 'Mobile recharge',
          when: 'Due in 4 days',
          amt: '₹299',
          colorClass: 'orange',
        },
        {
          day: '28',
          month: 'OCT',
          name: 'Monthly SIP',
          when: 'Due in 9 days',
          amt: '₹5,000',
          colorClass: 'teal',
        },
      ]
    }, [])

    return (
      <div className="liquid-dashboard-container">
        {/* Top User Greeting Header */}
        <div className="liquid-header">
          <div
            className="liquid-avatar"
            onClick={() => {
              setAuthModalTab('auth')
              setIsAuthModalOpen(true)
            }}
            style={{ cursor: 'pointer' }}
            title={auth.isAuthenticated && auth.user?.email ? `Signed in as ${auth.user.email}` : 'Sign In / Register'}
          >
            {effectiveUserName.charAt(0).toUpperCase() || 'A'}
          </div>
          <div
            className="liquid-header-info"
            onClick={() => {
              setAuthModalTab('auth')
              setIsAuthModalOpen(true)
            }}
            style={{ cursor: 'pointer' }}
          >
            <div className="liquid-greeting">{timeGreeting}</div>
            <div className="liquid-username">{effectiveUserName}</div>
          </div>
          <div className="liquid-header-actions">
            <button
              className="liquid-ai-round-btn"
              onClick={() => go('AI Assistant')}
              aria-label="Ask AI"
              title="Ask AI Assistant"
            >
              <Sparkles size={20} />
            </button>
            <button
              className="liquid-ai-round-btn"
              onClick={() => setIsDrawerOpen(true)}
              aria-label="All Modules"
              title="All Modules"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>

        <div className="liquid-dashboard-grid">
          {/* Left Column on Desktop */}
          <div className="liquid-dashboard-col-left">
            {/* Hero Card: Estimated Spendable with Liquid Waves */}
            <div className="liquid-hero-card">
              <div className="liquid-hero-waves-wrapper" aria-hidden="true">
                <svg className="liquid-hero-wave-layer wave-1" viewBox="0 0 708 90" preserveAspectRatio="none">
                  <path d="M0 50 C40 20 80 20 120 45 C160 70 200 70 240 40 C280 15 320 25 354 50 C394 20 434 20 474 45 C514 70 554 70 594 40 C634 15 674 25 708 50 L708 90 L0 90Z" fill="rgba(255,255,255,.14)" />
                </svg>
                <svg className="liquid-hero-wave-layer wave-2" viewBox="0 0 708 90" preserveAspectRatio="none">
                  <path d="M0 62 C50 40 90 45 130 62 C170 80 220 75 260 55 C300 38 330 45 354 62 C404 40 444 45 484 62 C524 80 574 75 614 55 C654 38 684 45 708 62 L708 90 L0 90Z" fill="rgba(255,255,255,.18)" />
                </svg>
              </div>
              <div>
                <div className="liquid-hero-top">
                  <span className="liquid-hero-label">Estimated spendable</span>
                  <span className="liquid-hero-badge">Protected</span>
                </div>
                <div className="liquid-hero-amount">
                  {formatPaise(summary.estimatedSpendable)}
                </div>
                <div className="liquid-hero-sub">After planned bills &amp; SIPs</div>
              </div>

              <div className="liquid-hero-pill-row">
                <div className="liquid-hero-pill">
                  <span className="liquid-hero-pill-icon income">
                    <ArrowDownLeft size={15} strokeWidth={2.5} />
                  </span>
                  <div>
                    <div className="liquid-hero-pill-label">Income</div>
                    <div className="liquid-hero-pill-val">{formatPaise(summary.totalConfirmedIncome)}</div>
                  </div>
                </div>
                <div className="liquid-hero-pill">
                  <span className="liquid-hero-pill-icon expense">
                    <ArrowUpRight size={15} strokeWidth={2.5} />
                  </span>
                  <div>
                    <div className="liquid-hero-pill-label">Expenses</div>
                    <div className="liquid-hero-pill-val">{formatPaise(summary.totalConfirmedExpenses)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 Action Buttons Grid */}
            <div className="liquid-actions-grid">
              <button
                className="liquid-action-button scan"
                onClick={() => setIsReceiptModalOpen(true)}
                aria-label="Scan receipt"
                title="Scan paper receipt or digital bill"
              >
                <Upload size={22} strokeWidth={2} />
                Scan
              </button>
              <button
                id="dash-import-statement-btn"
                className="liquid-action-button import"
                onClick={() => setIsReconciliationModalOpen(true)}
                aria-label="Import statement"
                title="Upload Bank or UPI statements (PDF/CSV)"
              >
                <FileSpreadsheet size={22} strokeWidth={2} />
                Import
              </button>
              <button
                className="liquid-action-button export"
                onClick={handleExportCsv}
                aria-label="Export CSV"
                title="Download authoritative ledger CSV"
              >
                <Download size={22} strokeWidth={2} />
                Export
              </button>
              <button
                className="liquid-action-button add"
                onClick={handleOpenAddModal}
                aria-label="Add transaction"
                title="Record transaction"
              >
                <Plus size={22} strokeWidth={2} />
                Add
              </button>
            </div>

            {/* Recent Activity Card */}
            <div className="liquid-recent-card">
              <div className="liquid-recent-header">
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#1f1a3d' }}>Recent activity</div>
                  <div style={{ fontSize: '12px', color: '#5b5780' }}>Authoritative local records</div>
                </div>
                <button className="liquid-link-btn" onClick={() => go('Transactions')}>
                  View all <ChevronRight size={14} />
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
                      onSelect={setSelectedDetailTransaction}
                      categoryMap={categoryMap}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '18px 12px' }}>
                  <p>No transactions recorded yet</p>
                  <button className="primary-button" onClick={handleOpenAddModal}>
                    <Plus size={15} /> Add first entry
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column on Desktop */}
          <div className="liquid-dashboard-col-right">
            {/* Spending Trend Wave Card */}
            <div className="liquid-card liquid-trend-card">
              <div className="liquid-trend-header">
                <div>
                  <div className="liquid-trend-title">Spending trend</div>
                  <div className="liquid-trend-sub">Last 7 days</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="liquid-trend-amount">
                    {activePoint
                      ? formatPaise(activePoint.amountPaise)
                      : formatPaise(last7DaysTotalPaise)}
                  </div>
                  <div className="liquid-trend-metric" style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 600 }}>
                    {activePoint
                      ? `${activePoint.fullDay}, ${activePoint.dateFormatted}`
                      : `${formatPaise(last7DaysTotalPaise)} 7-day total`}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <div style={{ display: 'flex', background: 'rgba(148, 163, 184, 0.15)', borderRadius: 10, padding: 2, gap: 2 }}>
                  <button
                    type="button"
                    onClick={() => setAnalyticsTab('cashflow')}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 8,
                      fontSize: '10px',
                      fontWeight: 700,
                      border: 'none',
                      background: analyticsTab === 'cashflow' ? '#ffffff' : 'transparent',
                      color: analyticsTab === 'cashflow' ? '#6d3fe0' : '#5b5780',
                      boxShadow: analyticsTab === 'cashflow' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    }}
                  >
                    Wave
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsTab('categories')}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 8,
                      fontSize: '10px',
                      fontWeight: 700,
                      border: 'none',
                      background: analyticsTab === 'categories' ? '#ffffff' : 'transparent',
                      color: analyticsTab === 'categories' ? '#6d3fe0' : '#5b5780',
                      boxShadow: analyticsTab === 'categories' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    }}
                  >
                    Inflow/Outflow
                  </button>
                </div>
              </div>

              {analyticsTab === 'cashflow' ? (
                <>
                  <div
                    className="liquid-wave-interactive-wrap"
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                      setWaveHoverIndex(Math.min(6, Math.max(0, Math.round(relX * 6))))
                    }}
                    onTouchMove={(e) => {
                      if (e.touches[0]) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const relX = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width))
                        setWaveHoverIndex(Math.min(6, Math.max(0, Math.round(relX * 6))))
                      }
                    }}
                    onMouseLeave={() => setWaveHoverIndex(null)}
                    onTouchEnd={() => setWaveHoverIndex(null)}
                    style={{ position: 'relative', width: '100%', height: '110px', marginTop: '6px', cursor: 'crosshair' }}
                  >
                    {/* Floating liquid glass tooltip anchored to active point */}
                    {activePoint && (
                      <div
                        className="liquid-wave-tooltip"
                        style={{
                          position: 'absolute',
                          left: `${(activePoint.x / 320) * 100}%`,
                          top: `${Math.max(4, activePoint.y - 36)}px`,
                          transform: 'translate(-50%, -100%)',
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                          zIndex: 10,
                        }}
                      >
                        <span style={{ fontSize: '10px', color: '#6d6796', display: 'block' }}>
                          {activePoint.fullDay}, {activePoint.dateFormatted}
                        </span>
                        <strong style={{ fontSize: '12px', color: '#1e1b4b', fontWeight: 800 }}>
                          {formatPaise(activePoint.amountPaise)}
                        </strong>
                      </div>
                    )}

                    <svg
                      width="100%"
                      height="110"
                      viewBox="0 0 320 110"
                      preserveAspectRatio="none"
                      style={{ display: 'block' }}
                      role="img"
                      aria-label="Interactive 7-day spending wave"
                    >
                      <defs>
                        <linearGradient id="lgWv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.55" />
                          <stop offset="60%" stopColor="#8b5cf6" stopOpacity="0.18" />
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="lgWl" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#38bdf8" />
                          <stop offset="45%" stopColor="#8b5cf6" />
                          <stop offset="100%" stopColor="#ec4899" />
                        </linearGradient>
                        <filter id="waveGlow" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#8b5cf6" floodOpacity="0.4" />
                        </filter>
                      </defs>
                      {/* Wave fill area */}
                      <path d={waveAreaPath} fill="url(#lgWv)" />
                      {/* Wave stroke line */}
                      <path
                        d={waveLinePath}
                        fill="none"
                        stroke="url(#lgWl)"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        filter="url(#waveGlow)"
                      />
                      {/* Interactive Crosshair & Cursor Anchor */}
                      {activePoint && (
                        <>
                          <line
                            x1={activePoint.x}
                            y1={activePoint.y}
                            x2={activePoint.x}
                            y2={110}
                            stroke="#8b5cf6"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                            opacity="0.8"
                          />
                          {/* Outer pulse aura */}
                          <circle
                            cx={activePoint.x}
                            cy={activePoint.y}
                            r="10"
                            fill="#8b5cf6"
                            fillOpacity="0.18"
                          />
                          {/* Inner glowing dot */}
                          <circle
                            cx={activePoint.x}
                            cy={activePoint.y}
                            r="5.5"
                            fill="#ffffff"
                            stroke="#8b5cf6"
                            strokeWidth="3"
                            style={{ filter: 'drop-shadow(0 2px 4px rgba(139,92,246,0.5))' }}
                          />
                        </>
                      )}
                    </svg>
                  </div>

                  {/* Synchronized 7 Day Pills */}
                  <div className="liquid-trend-days">
                    {last7DaysWaveData.map((d, i) => (
                      <button
                        key={`${d.dateStr}-${i}`}
                        type="button"
                        onClick={() => setWaveHoverIndex(i)}
                        onMouseEnter={() => setWaveHoverIndex(i)}
                        className={`liquid-trend-day ${i === activeWaveIndex ? 'active' : ''}`}
                        title={`${d.fullDay}, ${d.dateFormatted}: ${formatPaise(d.amountPaise)}`}
                        style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                      >
                        {d.dayLabel}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ width: '100%', height: 130 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={
                        cashFlowBarData.length > 0
                          ? cashFlowBarData
                          : [
                              { name: '1 Oct', income: 15000, expense: 4200, net: 10800 },
                              { name: '5 Oct', income: 12000, expense: 6800, net: 5200 },
                              { name: '10 Oct', income: 28000, expense: 11500, net: 16500 },
                              { name: '15 Oct', income: 9000, expense: 7400, net: 1600 },
                              { name: '20 Oct', income: 38000, expense: 14200, net: 23800 },
                            ]
                      }
                      margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="waveIncomeGradLg" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#0b6b4a" stopOpacity="0.55" />
                          <stop offset="1" stopColor="#0b6b4a" stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id="waveExpenseGradLg" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.6" />
                          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="name" stroke="#5b5780" fontSize={10} tickLine={false} />
                      <YAxis stroke="#5b5780" fontSize={10} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                      <Tooltip
                        formatter={(value: any, name: any) => [
                          `₹${Number(value).toLocaleString('en-IN')}`,
                          name === 'income' ? 'Income' : 'Expense',
                        ]}
                        contentStyle={{
                          background: 'rgba(255, 255, 255, 0.95)',
                          border: '1px solid rgba(255, 255, 255, 0.9)',
                          borderRadius: '14px',
                          color: '#1f1a3d',
                          fontSize: '11px',
                        }}
                      />
                      <Area type="monotone" dataKey="income" stroke="#0b6b4a" strokeWidth={2.5} fill="url(#waveIncomeGradLg)" />
                      <Area type="monotone" dataKey="expense" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#waveExpenseGradLg)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Budget Health Card with 3D Liquid Glass Core */}
            <div className="liquid-card liquid-budget-card" onClick={() => go('Budgets & Savings')} style={{ cursor: 'pointer' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', color: '#1f1a3d' }}>
                Budget health
              </div>
              <div className="liquid-budget-rings">
                {budgetStats.map((g, i) => (
                  <div key={g.name} className="liquid-budget-ring-item">
                    <div className="liquid-ring-box">
                      <svg width="76" height="76" viewBox="0 0 64 64" aria-hidden="true">
                        <defs>
                          {/* Radial Liquid Glass 3D Sphere Core */}
                          <radialGradient id={`liquidGlassCore-${i}`} cx="35%" cy="30%" r="70%">
                            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                            <stop offset="35%" stopColor={g.color} stopOpacity="0.22" />
                            <stop offset="85%" stopColor={g.color} stopOpacity="0.38" />
                            <stop offset="100%" stopColor={g.color} stopOpacity="0.12" />
                          </radialGradient>
                          <linearGradient id={`ringGrad-${i}`} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor={g.color} />
                            <stop offset="100%" stopColor="#a855f7" />
                          </linearGradient>
                          <filter id={`ringGlow-${i}`} x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={g.color} floodOpacity="0.35" />
                          </filter>
                        </defs>
                        {/* 3D Liquid Glass Inside Orb */}
                        <circle cx="32" cy="32" r="21" fill={`url(#liquidGlassCore-${i})`} />
                        {/* Specular Light Reflection Crescent */}
                        <ellipse cx="32" cy="20" rx="12" ry="5" fill="#ffffff" fillOpacity="0.5" />
                        {/* Glass edge rim */}
                        <circle cx="32" cy="32" r="21" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.8" />
                        {/* Track ring */}
                        <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(139,92,246,0.12)" strokeWidth="7" />
                        {/* Active Progress Arc with Liquid Glow */}
                        <circle
                          cx="32"
                          cy="32"
                          r="26"
                          fill="none"
                          stroke={`url(#ringGrad-${i})`}
                          strokeWidth="7"
                          strokeLinecap="round"
                          strokeDasharray={`${dashOffset(g.pct)} 163.4`}
                          transform="rotate(-90 32 32)"
                          filter={`url(#ringGlow-${i})`}
                        />
                      </svg>
                      <div className="liquid-ring-val" style={{ zIndex: 2 }}>{g.pct}%</div>
                    </div>
                    <div className="liquid-ring-name">{g.name}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Money Mate AI Card */}
            <div className="liquid-ai-card" onClick={() => go('AI Assistant')}>
              <div className="liquid-ai-icon-box">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="liquid-ai-title">Money Mate AI</div>
                <div className="liquid-ai-desc">
                  You have headroom after your upcoming ₹5,000 SIP and ₹3,200 commitments.
                </div>
              </div>
            </div>

            {/* Upcoming Dues (2 Cards) */}
            <div className="liquid-dues-grid">
              {upcomingDues.map((u) => (
                <div key={u.name} className={`liquid-due-card ${u.colorClass}`} onClick={() => go('Planner')}>
                  <div className="liquid-due-day">{u.day} {u.month}</div>
                  <div className="liquid-due-name">{u.name}</div>
                  <div className="liquid-due-when">{u.when}</div>
                  <div className="liquid-due-amt">{u.amt}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
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
              <button
                id="tx-manage-categories-btn"
                className="outline-button"
                onClick={() => setIsCategoryModalOpen(true)}
              >
                <Tag size={15} />
                Categories
              </button>
              <button className="outline-button" onClick={() => setIsReceiptModalOpen(true)}>
                <Upload size={15} />
                Scan receipt
              </button>
              <button
                id="tx-import-statement-btn"
                className="outline-button"
                onClick={() => setIsReconciliationModalOpen(true)}
              >
                <FileSpreadsheet size={15} />
                Import statement
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
            {categoryHook.categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name} {c.isArchived ? '(Archived)' : ''}
              </option>
            ))}
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
        <article className="panel table-panel liquid-tx-container">
          <div className="table-head liquid-tx-grid liquid-tx-head">
            <span className="liquid-tx-col-main">Transaction</span>
            <span className="liquid-tx-col-date">Date</span>
            <span className="liquid-tx-col-amount" style={{ textAlign: 'right', justifySelf: 'end', marginLeft: 'auto' }}>Amount</span>
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
                  onSelect={setSelectedDetailTransaction}
                  categoryMap={categoryMap}
                  isTableView={true}
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
                  <button className="outline-button" onClick={() => toggleDemoMode(true)}>
                    Preview Demo Sandbox
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
  /* ------------------- Budgets & Savings Page (Animated Liquid Glass) ------------------- */
  const Budgets = () => {
    const [budgetWaveView, setBudgetWaveView] = useState<'category' | 'trajectory'>('category')

    // Real-time Database Goal & Savings Stats
    const currentSavedRupees = Math.max(0, Math.round(summary.netCashFlow / 100))
    const savingsGoalPct = Math.min(100, Math.round((currentSavedRupees / emergencyGoalRupees) * 100))

    // Total monthly budget in rupees
    const totalBudgetRupees = userBudgetPaise ? Math.round(userBudgetPaise / 100) : 45000
    const totalSpentRupees = Math.round(summary.totalConfirmedExpenses / 100)

    // Real-time upcoming investment / SIP from Planner
    const upcomingInvestment = useMemo(() => {
      const foundBill = bills.find(
        (b) =>
          (b.status === 'upcoming' || b.status === 'due') &&
          (b.category?.toLowerCase().includes('sip') ||
            b.category?.toLowerCase().includes('invest') ||
            b.title?.toLowerCase().includes('sip'))
      )
      if (foundBill) {
        return {
          title: foundBill.title,
          amountPaise: foundBill.amountPaise,
          dueDate: `Due on ${new Date(foundBill.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
          isReal: true,
        }
      }
      const foundSched = schedules.find(
        (s) =>
          s.status === 'active' &&
          (s.category?.toLowerCase().includes('sip') ||
            s.category?.toLowerCase().includes('invest') ||
            s.title?.toLowerCase().includes('sip'))
      )
      if (foundSched) {
        return {
          title: foundSched.title,
          amountPaise: foundSched.amountPaise,
          dueDate: `Every ${foundSched.preferredDayOfMonth || 28}th`,
          isReal: true,
        }
      }
      const anyUpcoming = bills.find((b) => b.status === 'upcoming' || b.status === 'due')
      if (anyUpcoming) {
        return {
          title: anyUpcoming.title,
          amountPaise: anyUpcoming.amountPaise,
          dueDate: `Due on ${new Date(anyUpcoming.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
          isReal: true,
        }
      }
      return {
        title: 'Monthly Index SIP',
        amountPaise: 500000,
        dueDate: 'Scheduled 28th',
        isReal: false,
      }
    }, [bills, schedules])

    // Real-time category wave data
    const categoryWaveData = useMemo(() => {
      if (summary.categoryTotals.length > 0) {
        return summary.categoryTotals.map((c) => {
          const spent = Math.round(c.paise / 100)
          const customBudget = categoryBudgets[c.category]
          const budget = customBudget !== undefined
            ? customBudget
            : Math.max(Math.round(totalBudgetRupees * (c.percentage / 100 || 0.15)), Math.round(spent * 1.25))
          return {
            name: c.category,
            spent,
            budget,
            percentage: c.percentage,
            color: c.color || '#8b5cf6',
            count: c.count,
          }
        })
      }
      return [
        { name: 'Food & Dining', spent: 3450, budget: 6000, percentage: 38, color: '#ff9f5a', count: 14 },
        { name: 'Groceries', spent: 2890, budget: 4500, percentage: 32, color: '#6c8cff', count: 9 },
        { name: 'Transport', spent: 1200, budget: 2500, percentage: 14, color: '#22c3a6', count: 6 },
        { name: 'Shopping', spent: 980, budget: 2000, percentage: 11, color: '#ec4899', count: 4 },
        { name: 'Entertainment', spent: 540, budget: 1500, percentage: 5, color: '#a855f7', count: 2 },
      ]
    }, [summary.categoryTotals, categoryBudgets, totalBudgetRupees])

    // Trajectory wave data across daily spending
    const trajectoryWaveData = useMemo(() => {
      if (summary.dailySpending.length > 0) {
        return summary.dailySpending.map((d) => ({
          name: d.day || d.date.slice(-5),
          spent: Math.round(d.paise / 100),
          budget: Math.round(totalBudgetRupees / 30),
        }))
      }
      return [
        { name: 'Mon', spent: 450, budget: 1500 },
        { name: 'Tue', spent: 890, budget: 1500 },
        { name: 'Wed', spent: 320, budget: 1500 },
        { name: 'Thu', spent: 1250, budget: 1500 },
        { name: 'Fri', spent: 670, budget: 1500 },
        { name: 'Sat', spent: 1840, budget: 1500 },
        { name: 'Sun', spent: 510, budget: 1500 },
      ]
    }, [summary.dailySpending, totalBudgetRupees])

    return (
      <section className="section-page budget-page-container">
        {/* Page Title & Actions */}
        <PageTitle
          eyebrow="PLAN WITH PURPOSE"
          title="Budgets & savings"
          text="Live, database-synced category wave analytics, goals, and recurring investments."
          action={
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="primary-button" onClick={() => setIsBudgetModalOpen(true)}>
                <Sliders size={15} />
                Adjust Budgets &amp; Goals
              </button>
              <button className="outline-button" onClick={() => go('Financial Insights')}>
                <Sparkles size={15} />
                Open Insights
              </button>
            </div>
          }
        />

        {/* Primary Goal: Emergency Fund & Net Savings Hero Card */}
        <div className="budget-hero-goal">
          <svg className="budget-hero-wave-bg" viewBox="0 0 700 90" preserveAspectRatio="none" aria-hidden="true">
            <path
              d="M0 45 C100 15 200 65 350 40 C500 15 600 60 700 35 L700 90 L0 90Z"
              fill="url(#goalWaveGradient)"
            />
            <defs>
              <linearGradient id="goalWaveGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#c026d3" stopOpacity="0.3" />
              </linearGradient>
            </defs>
          </svg>

          <div className="budget-hero-content">
            <div className="budget-hero-top">
              <div>
                <span className="budget-goal-badge">
                  <Target size={13} /> PRIMARY GOAL
                </span>
                <h2 style={{ fontSize: '22px', fontWeight: 800, margin: '6px 0 2px', color: '#1f1a3d' }}>
                  Emergency fund
                </h2>
                <p style={{ margin: 0, fontSize: '12px', color: '#5b5780' }}>
                  ₹{currentSavedRupees.toLocaleString('en-IN')} of ₹{emergencyGoalRupees.toLocaleString('en-IN')} saved
                  {' · '}
                  <span style={{ color: savingsGoalPct >= 50 ? '#0b6b4a' : '#6d3fe0', fontWeight: 700 }}>
                    {savingsGoalPct >= 100 ? 'Goal fully achieved!' : `${savingsGoalPct}% funded`}
                  </span>
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                <span className="budget-live-indicator">
                  <i className="live-dot" /> Live DB Sync
                </span>
                <button
                  type="button"
                  onClick={() => setIsBudgetModalOpen(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6d3fe0',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: 0,
                  }}
                >
                  <Edit2 size={12} /> Edit Target
                </button>
              </div>
            </div>

            {/* Fluid Progress Bar with Animated Liquid Ripple */}
            <div className="budget-progress-track">
              <div
                className="budget-progress-fill"
                style={{ width: `${Math.max(4, savingsGoalPct)}%` }}
              />
            </div>

            {/* Quick Stat Pill Grid */}
            <div className="budget-hero-stats">
              <div className="budget-stat-box">
                <div className="budget-stat-label">Net Saved (Ledger)</div>
                <div className="budget-stat-value mint">₹{currentSavedRupees.toLocaleString('en-IN')}</div>
              </div>
              <div className="budget-stat-box">
                <div className="budget-stat-label">Total Monthly Budget</div>
                <div className="budget-stat-value">₹{totalBudgetRupees.toLocaleString('en-IN')}</div>
              </div>
              <div className="budget-stat-box">
                <div className="budget-stat-label">Spent This Month</div>
                <div className="budget-stat-value highlight">{formatPaise(summary.totalConfirmedExpenses)}</div>
              </div>
              <div className="budget-stat-box">
                <div className="budget-stat-label">Budget Headroom</div>
                <div className="budget-stat-value" style={{ color: totalSpentRupees > totalBudgetRupees ? '#ef4444' : '#0b6b4a' }}>
                  {totalSpentRupees > totalBudgetRupees ? '-' : ''}₹{Math.abs(totalBudgetRupees - totalSpentRupees).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2-Column Main Wave Analytics & SIP Section */}
        <div className="budget-main-grid">
          
          {/* Monthly Categories Wave Presentation Card */}
          <div className="budget-wave-panel">
            <div className="budget-wave-header">
              <div className="budget-wave-title">
                <h2>Monthly categories wave</h2>
                <p>Transparent spline wave presentation of spent vs planned allocations</p>
              </div>

              <div className="budget-wave-toggle-group">
                <button
                  type="button"
                  className={`budget-wave-toggle-btn ${budgetWaveView === 'category' ? 'active' : ''}`}
                  onClick={() => setBudgetWaveView('category')}
                >
                  Category Wave
                </button>
                <button
                  type="button"
                  className={`budget-wave-toggle-btn ${budgetWaveView === 'trajectory' ? 'active' : ''}`}
                  onClick={() => setBudgetWaveView('trajectory')}
                >
                  Daily Flow
                </button>
              </div>
            </div>

            {/* The Transparent SVG Wave Chart */}
            <div className="budget-wave-chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={budgetWaveView === 'category' ? categoryWaveData : trajectoryWaveData}
                  margin={{ top: 14, right: 38, left: 14, bottom: 26 }}
                >
                  <defs>
                    <linearGradient id="waveSpentGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.65} />
                      <stop offset="50%" stopColor="#38bdf8" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="waveBudgetGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff8fb1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#ff8fb1" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    padding={{ left: 16, right: 32 }}
                    interval={0}
                    tick={{ fill: '#5b5780', fontSize: 11, fontWeight: 550 }}
                  />
                  <YAxis hide />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null
                      const d = payload[0].payload
                      return (
                        <div
                          style={{
                            background: 'rgba(255, 255, 255, 0.92)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255, 255, 255, 0.95)',
                            borderRadius: '14px',
                            padding: '10px 14px',
                            boxShadow: '0 10px 25px rgba(109, 63, 224, 0.18)',
                            fontSize: '12px',
                          }}
                        >
                          <div style={{ fontWeight: 800, color: '#1f1a3d', marginBottom: '4px' }}>
                            {d.name}
                          </div>
                          <div style={{ color: '#6d3fe0', fontWeight: 700 }}>
                            Spent: ₹{(d.spent || 0).toLocaleString('en-IN')}
                          </div>
                          <div style={{ color: '#5b5780' }}>
                            Planned: ₹{(d.budget || 0).toLocaleString('en-IN')}
                          </div>
                          {d.percentage !== undefined && (
                            <div style={{ color: '#0b6b4a', fontSize: '10px', marginTop: '2px', fontWeight: 600 }}>
                              {d.percentage}% of total expenses
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  {/* Budget Reference Wave */}
                  <Area
                    type="natural"
                    dataKey="budget"
                    stroke="#ff8fb1"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    fill="url(#waveBudgetGradient)"
                  />
                  {/* Actual Spent Fluid Wave */}
                  <Area
                    type="natural"
                    dataKey="spent"
                    stroke="#8b5cf6"
                    strokeWidth={3.5}
                    fill="url(#waveSpentGradient)"
                    dot={{ fill: '#ffffff', stroke: '#8b5cf6', strokeWidth: 2, r: 4 }}
                    activeDot={{ fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 3, r: 7 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Wave Legend */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '18px', fontSize: '11px', color: '#5b5780', fontWeight: 600 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <i style={{ width: '12px', height: '3px', borderRadius: '2px', background: '#8b5cf6' }} />
                Actual Spent Wave
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <i style={{ width: '12px', height: '2px', borderRadius: '2px', background: '#ff8fb1', borderTop: '1px dashed #ff8fb1' }} />
                Budget Guideline Wave
              </span>
            </div>
          </div>

          {/* Right Column: Next Investment / SIP Card */}
          <div className="budget-sip-card">
            <div>
              <div className="budget-sip-top">
                <div className="budget-sip-icon">
                  <CircleDollarSign size={24} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#0b6b4a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    NEXT INVESTMENT / SIP
                  </div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#1f1a3d' }}>
                    {upcomingInvestment.title}
                  </h3>
                </div>
              </div>

              <div className="budget-sip-amount">
                {formatPaise(upcomingInvestment.amountPaise ?? 0)}
              </div>
              <p className="budget-sip-desc">
                {upcomingInvestment.dueDate}
                {upcomingInvestment.isReal && ' · Synchronized from Planner'}
              </p>

              <div style={{ padding: '12px', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(255, 255, 255, 0.9)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
                  <span style={{ color: '#5b5780' }}>Monthly Investment Pace</span>
                  <strong style={{ color: '#0b6b4a' }}>On Schedule</strong>
                </div>
                <div style={{ height: '6px', borderRadius: '999px', background: 'rgba(148, 163, 184, 0.2)', overflow: 'hidden' }}>
                  <div style={{ width: '85%', height: '100%', background: 'linear-gradient(90deg, #10b981, #06b6d4)' }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="outline-button"
                style={{ flex: 1, padding: '10px 12px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}
                onClick={() => go('Planner')}
              >
                View in Planner <ChevronRight size={14} />
              </button>
              <button
                className="primary-button"
                style={{ padding: '10px 12px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}
                onClick={() => {
                  setEditingSchedule(null)
                  setIsScheduleModalOpen(true)
                }}
                title="Create a new recurring SIP or commitment"
              >
                <Plus size={14} /> Add SIP
              </button>
            </div>
          </div>
        </div>

        {/* Category Budget Cards Grid */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#1f1a3d' }}>
              Category Allocations &amp; Real-Time Tracking
            </h3>
            <span style={{ fontSize: '12px', color: '#5b5780' }}>
              Click any category card to configure its limit
            </span>
          </div>

          <div className="budget-categories-grid">
            {categoryWaveData.map((cat) => {
              const spentPct = Math.min(100, Math.round((cat.spent / (cat.budget || 1)) * 100))
              const isExceeded = cat.spent > cat.budget
              const isWarning = spentPct >= 80 && !isExceeded
              const badgeClass = isExceeded ? 'exceeded' : isWarning ? 'warning' : 'safe'
              const badgeText = isExceeded ? 'Exceeded' : isWarning ? 'Near Limit' : 'On Track'

              return (
                <div
                  key={cat.name}
                  className="budget-category-card"
                  onClick={() => {
                    setEditingBudgetCategory(cat.name)
                    setIsBudgetModalOpen(true)
                  }}
                  title="Click to customize category budget"
                >
                  <div className="budget-category-header">
                    <div className="budget-cat-left">
                      <div
                        className="budget-cat-icon"
                        style={{
                          background: `${cat.color}22`,
                          color: cat.color,
                        }}
                      >
                        <Tag size={18} />
                      </div>
                      <div>
                        <div className="budget-cat-name">{cat.name}</div>
                        <div className="budget-cat-count">{cat.count} transactions recorded</div>
                      </div>
                    </div>
                    <span className={`budget-cat-badge ${badgeClass}`}>{badgeText}</span>
                  </div>

                  <div className="budget-cat-bar-wrap">
                    <div
                      className="budget-cat-bar-fill"
                      style={{
                        width: `${spentPct}%`,
                        background: isExceeded
                          ? '#ef4444'
                          : isWarning
                          ? '#f59e0b'
                          : `linear-gradient(90deg, ${cat.color}, #38bdf8)`,
                      }}
                    />
                  </div>

                  <div className="budget-cat-footer">
                    <span>
                      Spent: <strong>₹{cat.spent.toLocaleString('en-IN')}</strong>
                    </span>
                    <span>
                      Budget: <strong>₹{cat.budget.toLocaleString('en-IN')}</strong>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    )
  }

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
            <b>Purge Mock & Sample Data</b>
            <span>Safely delete all mock, demo, and starter data from your real database, preserving only authentic imports.</span>
          </p>
          <button
            className="outline-button"
            onClick={async () => {
              const purged = await purgeMockDataFromRealDB()
              notify(
                purged > 0
                  ? `Successfully purged ${purged} mock records from your database!`
                  : 'Workspace clean: No mock data was found.'
              )
            }}
          >
            Purge Mock Data
          </button>
        </div>

        <div>
          <p>
            <b>Re-classify Transfers & Fix Double-Counting</b>
            <span>Re-evaluate existing records to ensure inter-account movements, card repayments, and personal credits are excluded from income/expense totals.</span>
          </p>
          <button
            className="outline-button"
            onClick={async () => {
              const healed = await reclassifyTransfers()
              notify(
                healed > 0
                  ? `Successfully reclassified ${healed} transactions as transfers. Double-counting eliminated!`
                  : 'All transactions are already accurately classified.'
              )
            }}
          >
            Re-classify Transfers
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
            <b>Financial Categories</b>
            <span>
              Customize income and expense categories, icons, colors, and 50/30/20 needs vs. wants classifications.
            </span>
          </p>
          <button
            id="open-categories-modal-btn"
            className="primary-button"
            style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setIsCategoryModalOpen(true)}
          >
            <Tag size={13} />
            Manage Categories
          </button>
        </div>

        <div>
          <p>
            <b>Data Backup & Recovery</b>
            <span>
              Export an integrity-verified JSON backup of all 9 database stores (including categories), or restore/merge an existing backup.
            </span>
          </p>
          <button
            id="open-backup-modal-btn"
            className="primary-button"
            style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setIsBackupModalOpen(true)}
          >
            <Database size={13} />
            Backup & Recovery
          </button>
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
            <b>Personal Profile & Name</b>
            <span>The name shown on the dashboard greeting ({timeGreeting}) and financial reports.</span>
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="e.g. Arjun Singh"
              value={userDisplayName}
              onChange={(e) => {
                setUserDisplayName(e.target.value)
                localStorage.setItem('moneymate_display_name', e.target.value)
              }}
              style={{
                height: '32px',
                padding: '0 10px',
                borderRadius: '8px',
                border: '1px solid var(--line)',
                background: 'var(--deep)',
                color: 'var(--text)',
                fontSize: '11px',
                width: '160px',
              }}
            />
            {userDisplayName && (
              <button
                className="outline-button"
                style={{ fontSize: '10px', minHeight: '32px' }}
                onClick={() => {
                  setUserDisplayName('')
                  localStorage.removeItem('moneymate_display_name')
                  notify('Display name reset')
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div>
          <p>
            <b>FinanceAI Onboarding Slides</b>
            <span>Re-experience the 3-step dynamic living orb presentation, goals selection, and AI planner.</span>
          </p>
          <button
            className="outline-button"
            id="btn-replay-intro-slides"
            style={{ fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => {
              sessionStorage.removeItem('moneymate_intro_completed')
              setHasCompletedIntro(false)
            }}
          >
            <Sparkles size={13} />
            Replay Intro Slides
          </button>
        </div>

        <div>
          <p>
            <b>Cloud Account & Security</b>
            <span>
              {auth.isAuthenticated && auth.user?.email
                ? `Signed in as ${effectiveUserName} (${auth.user.email}) · Multi-device cloud sync active with Supabase Row-Level Security.`
                : 'Local Offline Mode (Guest). Transactions are stored securely in browser IndexedDB. Sign in or register to sync across devices.'}
            </span>
          </p>
          {auth.isAuthenticated ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#0b6b4a',
                  background: '#c9f7e3',
                  padding: '4px 8px',
                  borderRadius: '6px',
                }}
              >
                Synced
              </span>
              <button
                className="outline-button"
                style={{
                  color: '#ef4444',
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                  fontSize: '11px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onClick={async () => {
                  await auth.signOut()
                  sessionStorage.removeItem('moneymate_guest_session')
                  sessionStorage.removeItem('moneymate_intro_completed')
                  setHasCompletedIntro(false)
                  setIsGuestMode(false)
                  setAuthScreen('welcome')
                  notify('Logged out successfully.')
                }}
              >
                Log Out
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="outline-button"
                style={{ fontSize: '11px', fontWeight: 600 }}
                onClick={() => {
                  sessionStorage.removeItem('moneymate_guest_session')
                  sessionStorage.removeItem('moneymate_intro_completed')
                  setHasCompletedIntro(false)
                  setIsGuestMode(false)
                  setAuthScreen('welcome')
                }}
              >
                Exit Guest Mode
              </button>
              <button
                className="primary-button"
                style={{ fontSize: '11px', fontWeight: 700 }}
                onClick={() => {
                  sessionStorage.removeItem('moneymate_guest_session')
                  sessionStorage.removeItem('moneymate_intro_completed')
                  setHasCompletedIntro(false)
                  setIsGuestMode(false)
                  setAuthScreen('login')
                }}
              >
                Sign In
              </button>
            </div>
          )}
        </div>

        <div>
          <p>
            <b>App Feature Slides</b>
            <span>
              Explore the swipeable iOS presentation slides detailing AI receipt scanning, cash flow waves, and pantry sync.
            </span>
          </p>
          <button
            className="outline-button"
            style={{ fontSize: '11px', fontWeight: 700 }}
            onClick={() => {
              setHasCompletedIntro(false)
            }}
          >
            View Feature Slides
          </button>
        </div>

        <div>
          <p>
            <b>Developer Information</b>
            <span>
              Money Mate AI is engineered with private on-device intelligence and iOS Liquid Glass architecture.
            </span>
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#7c3aed',
                background: 'rgba(124, 58, 237, 0.12)',
                padding: '5px 12px',
                borderRadius: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ShieldCheck size={13} />
              Developed by KANNALAB (KL)
            </span>
          </div>
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

  const tabIndexMap: Partial<Record<Section, number>> = {
    Dashboard: 0,
    Transactions: 1,
    'Budgets & Savings': 2,
    Planner: 3,
    'AI Assistant': 4,
  }
  const currentTabIndex = tabIndexMap[section] ?? 0

  const View = views[section]

  // 1. Session resolution loading state (Splash)
  if (auth.loading) {
    return (
      <div className={`auth-page-root ${dark ? 'dark' : 'light'}`} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="auth-ambient" aria-hidden="true">
          <div className="auth-orb auth-orb-1" />
          <div className="auth-orb auth-orb-2" />
        </div>
        <div className="auth-loading-splash" style={{ textAlign: 'center', position: 'relative', zIndex: 2 }}>
          <div className="auth-spinner" style={{ width: 44, height: 44, borderWidth: 3, margin: '0 auto 16px' }} />
          <p style={{ fontSize: '14px', fontWeight: 600, color: dark ? '#cbd5e1' : '#475569' }}>
            Restoring your secure session...
          </p>
        </div>
      </div>
    )
  }

  // 2. Dedicated separate authentication experience for signed-out users
  if (!auth.isAuthenticated && !isGuestMode) {
    return (
      <AuthLayout dark={dark} onToggleTheme={() => setDark((prev) => !prev)}>
        {authScreen === 'welcome' && (
          <WelcomeScreen
            onGetStarted={() => setAuthScreen('register')}
            onSignIn={() => setAuthScreen('login')}
          />
        )}
        {authScreen === 'register' && (
          <RegisterScreen
            onBack={() => setAuthScreen('welcome')}
            onNavigateToLogin={() => setAuthScreen('login')}
            onRequireOtp={(email) => {
              setPendingOtpEmail(email)
              setOtpType('signup')
              setAuthScreen('otp_verify')
            }}
            onSuccess={() => {
              sessionStorage.setItem('moneymate_guest_session', 'true')
              setIsGuestMode(true)
              notify('Account created successfully!')
            }}
          />
        )}
        {authScreen === 'login' && (
          <LoginScreen
            onBack={() => setAuthScreen('welcome')}
            onNavigateToRegister={() => setAuthScreen('register')}
            onForgotPassword={() => setAuthScreen('forgot_password')}
            onRequireOtp={(email) => {
              setPendingOtpEmail(email)
              setOtpType('email')
              setAuthScreen('otp_verify')
            }}
            onSuccess={() => {
              sessionStorage.setItem('moneymate_guest_session', 'true')
              setIsGuestMode(true)
              notify('Welcome back!')
            }}
          />
        )}
        {authScreen === 'otp_verify' && (
          <OtpVerifyScreen
            email={pendingOtpEmail}
            otpType={otpType}
            onBack={() => setAuthScreen(otpType === 'signup' ? 'register' : 'login')}
            onSuccess={() => {
              sessionStorage.setItem('moneymate_guest_session', 'true')
              setIsGuestMode(true)
              notify('Gmail verified successfully!')
            }}
          />
        )}
        {authScreen === 'forgot_password' && (
          <ResetPasswordScreen onBackToLogin={() => setAuthScreen('login')} />
        )}
      </AuthLayout>
    )
  }

  // 3. Dedicated post-auth instruction slides shown after registration or login complete
  if ((auth.isAuthenticated || isGuestMode) && !hasCompletedIntro) {
    return (
      <AppIntroSlides
        onComplete={() => {
          sessionStorage.setItem('moneymate_intro_completed', 'true')
          setHasCompletedIntro(true)
          notify('Welcome to Money Mate!')
        }}
        onSkip={() => {
          sessionStorage.setItem('moneymate_intro_completed', 'true')
          setHasCompletedIntro(true)
        }}
      />
    )
  }

  return (
    <div className={`app ${dark ? 'dark' : 'light'} liquid-page-root`}>
      {/* Ambient Floating Glow Orbs */}
      <div className="liquid-ambient-container" aria-hidden="true">
        <div className="liquid-orb liquid-orb-1" />
        <div className="liquid-orb liquid-orb-2" />
        <div className="liquid-orb liquid-orb-3" />
        <div className="liquid-orb liquid-orb-4" />
      </div>

      {/* SVG Goo Filter for Bottom Nav Indicator */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id="goo" x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b" />
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
          </filter>
        </defs>
      </svg>

      {/* Sidebar Dock */}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="brand">
          <i>
            <Sparkles size={18} />
          </i>
          <div>
            <b style={{ display: 'block', lineHeight: 1.1 }}>
              money<span>mate</span>
            </b>
            <small style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: '#8b5cf6', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              KL · KANNALAB
            </small>
          </div>
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
            <span
              className="mode-badge real"
              title="Authoritative Live IndexedDB Ledger"
            >
              <i
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--mint)',
                  boxShadow: '0 0 8px var(--mint)',
                }}
              />
              Live Data
            </span>

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
          {section === 'Dashboard' ? (
            <View />
          ) : (
            <div className="liquid-view-container">
              <div className="liquid-subpage-header">
                <button
                  className="liquid-action-button"
                  style={{
                    width: 'auto',
                    padding: '8px 16px',
                    flexDirection: 'row',
                    gap: '8px',
                    minHeight: 'unset',
                    cursor: 'pointer',
                  }}
                  onClick={() => go('Dashboard')}
                >
                  <ArrowLeft size={16} />
                  <span>Back to Dashboard</span>
                </button>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="liquid-ai-round-btn"
                    onClick={() => setIsDrawerOpen(true)}
                    title="All Modules"
                  >
                    <Menu size={18} />
                  </button>
                </div>
              </div>
              <View />
            </div>
          )}
        </div>
      </main>

      {/* Liquid Glass Floating Bottom Navigation Bar */}
      <nav aria-label="Main" className="liquid-bottom-nav">
        <div className="liquid-goo-layer">
          <div
            className="liquid-goo-indicator blob-a"
            style={{ left: `calc(${currentTabIndex} * 20% + (20% - 64px) / 2)` }}
          />
          <div
            className="liquid-goo-indicator blob-b"
            style={{ left: `calc(${currentTabIndex} * 20% + (20% - 64px) / 2)` }}
          />
        </div>
        <div className="liquid-nav-grid">
          <button
            className={`liquid-nav-btn ${currentTabIndex === 0 ? 'active' : ''}`}
            onClick={() => go('Dashboard')}
            aria-label="Home"
          >
            <House size={22} strokeWidth={1.9} />
            <span>Home</span>
          </button>
          <button
            className={`liquid-nav-btn ${currentTabIndex === 1 ? 'active' : ''}`}
            onClick={() => go('Transactions')}
            aria-label="Activity"
          >
            <ReceiptText size={22} strokeWidth={1.9} />
            <span>Activity</span>
          </button>
          <button
            className={`liquid-nav-btn ${currentTabIndex === 2 ? 'active' : ''}`}
            onClick={() => go('Budgets & Savings')}
            aria-label="Budgets"
          >
            <Target size={22} strokeWidth={1.9} />
            <span>Budgets</span>
          </button>
          <button
            className={`liquid-nav-btn ${currentTabIndex === 3 ? 'active' : ''}`}
            onClick={() => go('Planner')}
            aria-label="Plan"
          >
            <CalendarDays size={22} strokeWidth={1.9} />
            <span>Plan</span>
          </button>
          <button
            className={`liquid-nav-btn ${currentTabIndex === 4 ? 'active' : ''}`}
            onClick={() => go('AI Assistant')}
            aria-label="AI"
          >
            <Sparkles size={22} strokeWidth={1.9} />
            <span>AI</span>
          </button>
        </div>
      </nav>

      {/* Quick Modules Liquid Drawer */}
      {isDrawerOpen && (
        <div
          className="liquid-drawer-backdrop"
          onClick={() => setIsDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="liquid-drawer-sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} color="#6d3fe0" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1f1a3d' }}>
                  All Modules
                </h3>
              </div>
              <button
                className="liquid-ai-round-btn"
                style={{ width: '32px', height: '32px' }}
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="liquid-drawer-grid">
              <button
                className={`liquid-drawer-item ${section === 'Dashboard' ? 'active' : ''}`}
                onClick={() => { go('Dashboard'); setIsDrawerOpen(false) }}
              >
                <House size={20} />
                <span>Dashboard</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'Transactions' ? 'active' : ''}`}
                onClick={() => { go('Transactions'); setIsDrawerOpen(false) }}
              >
                <ReceiptText size={20} />
                <span>Transactions</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'Budgets & Savings' ? 'active' : ''}`}
                onClick={() => { go('Budgets & Savings'); setIsDrawerOpen(false) }}
              >
                <Target size={20} />
                <span>Budgets</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'Financial Insights' ? 'active' : ''}`}
                onClick={() => { go('Financial Insights'); setIsDrawerOpen(false) }}
              >
                <TrendingUp size={20} />
                <span>Insights</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'My Inventory' ? 'active' : ''}`}
                onClick={() => { go('My Inventory'); setIsDrawerOpen(false) }}
              >
                <Package size={20} />
                <span>Inventory</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'Smart Shopping' ? 'active' : ''}`}
                onClick={() => { go('Smart Shopping'); setIsDrawerOpen(false) }}
              >
                <ShoppingBag size={20} />
                <span>Shopping</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'Planner' ? 'active' : ''}`}
                onClick={() => { go('Planner'); setIsDrawerOpen(false) }}
              >
                <CalendarDays size={20} />
                <span>Planner</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'AI Assistant' ? 'active' : ''}`}
                onClick={() => { go('AI Assistant'); setIsDrawerOpen(false) }}
              >
                <Bot size={20} />
                <span>Money Mate AI</span>
              </button>
              <button
                className={`liquid-drawer-item ${section === 'Settings' ? 'active' : ''}`}
                onClick={() => { go('Settings'); setIsDrawerOpen(false) }}
              >
                <Settings size={20} />
                <span>Settings</span>
              </button>
              <button
                className="liquid-drawer-item"
                onClick={() => { setIsCategoryModalOpen(true); setIsDrawerOpen(false) }}
              >
                <Tag size={20} />
                <span>Categories</span>
              </button>
              <button
                className="liquid-drawer-item"
                onClick={() => { setIsBackupModalOpen(true); setIsDrawerOpen(false) }}
              >
                <Database size={20} />
                <span>Backup</span>
              </button>
              <button
                className="liquid-drawer-item"
                onClick={() => { setIsReconciliationModalOpen(true); setIsDrawerOpen(false) }}
              >
                <Upload size={20} />
                <span>Import</span>
              </button>
              <button
                className="liquid-drawer-item"
                onClick={() => {
                  setAuthModalTab('onboarding')
                  setIsAuthModalOpen(true)
                  setIsDrawerOpen(false)
                }}
              >
                <Sparkles size={20} />
                <span>Feature Slides</span>
              </button>
            </div>

            {/* Account Card in Drawer */}
            <div
              style={{
                marginTop: '14px',
                padding: '12px 14px',
                borderRadius: '16px',
                background: 'rgba(109, 63, 224, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #7d72ea, #aa7fe7)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '13px',
                    flexShrink: 0,
                  }}
                >
                  {auth.isAuthenticated && auth.user?.email
                    ? auth.user.email.charAt(0).toUpperCase()
                    : 'G'}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#1f1a3d',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {auth.isAuthenticated && auth.user?.email
                      ? auth.user.email
                      : 'Guest Mode'}
                  </div>
                  <div style={{ fontSize: '10px', color: '#6d6796' }}>
                    {auth.isAuthenticated ? 'Supabase RLS Active' : 'Offline IndexedDB'}
                  </div>
                </div>
              </div>

              {auth.isAuthenticated ? (
                <button
                  className="outline-button"
                  style={{
                    fontSize: '10px',
                    color: '#ef4444',
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                    padding: '4px 10px',
                    minHeight: '28px',
                  }}
                  onClick={async () => {
                    await auth.signOut()
                    sessionStorage.removeItem('moneymate_guest_session')
                    sessionStorage.removeItem('moneymate_intro_completed')
                    setHasCompletedIntro(false)
                    setIsGuestMode(false)
                    setAuthScreen('welcome')
                    notify('Logged out successfully')
                    setIsDrawerOpen(false)
                  }}
                >
                  Log Out
                </button>
              ) : (
                <button
                  className="primary-button"
                  style={{
                    fontSize: '10px',
                    padding: '4px 12px',
                    minHeight: '28px',
                  }}
                  onClick={() => {
                    sessionStorage.removeItem('moneymate_guest_session')
                    setIsGuestMode(false)
                    setAuthScreen('login')
                    setIsDrawerOpen(false)
                  }}
                >
                  Sign In
                </button>
              )}
            </div>

            <div style={{ textAlign: 'center', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', fontSize: '10px', color: '#8d96ac', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
              <ShieldCheck size={12} color="#8b5cf6" />
              <span>Developed by KANNALAB (KL)</span>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Transaction Modal */}
      <TransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={editingTransaction}
        existingExpenses={existingExpenses}
        onSave={handleSaveTransaction}
        onUpdate={handleUpdateTransaction}
        checkDuplicate={checkDuplicate}
        availableCategories={categoryHook.categories}
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

      {/* Milestone 7.6: Data Backup & Recovery Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        currentScope={isDemoMode ? 'demo' : 'live'}
        onRestoreComplete={handleRestoreComplete}
        notify={notify}
      />

      {/* Milestone 7.2: Category Management Modal */}
      <CategoryManagementModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={categoryHook.categories}
        onCreateCategory={categoryHook.createCategory}
        onUpdateCategory={categoryHook.updateCategory}
        onRenameCategory={categoryHook.renameCategory}
        onArchiveCategory={categoryHook.archiveCategory}
        onRestoreCategory={categoryHook.restoreCategory}
        onDeleteCategory={categoryHook.deleteCategory}
        isCategoryInUse={isCategoryInUse}
        notify={notify}
        currentScope={isDemoMode ? 'demo' : 'live'}
      />

      {/* Stage 8.3 & 8.4: Statement Import & Interactive Reconciliation Modal */}
      <ReconciliationModal
        isOpen={isReconciliationModalOpen}
        onClose={() => setIsReconciliationModalOpen(false)}
        isDemoMode={isDemoMode}
        existingTransactions={transactions}
        categories={categoryHook.categories}
        notify={notify}
        onCommitSuccess={refreshTransactions}
      />

      {/* Dynamic Budget & Savings Goal Modal */}
      <BudgetGoalModal
        isOpen={isBudgetModalOpen}
        onClose={() => {
          setIsBudgetModalOpen(false)
          setEditingBudgetCategory(null)
        }}
        totalBudgetRupees={userBudgetPaise ? Math.round(userBudgetPaise / 100) : 45000}
        emergencyGoalRupees={emergencyGoalRupees}
        categoryBudgets={categoryBudgets}
        categories={categoryHook.categories}
        initialCategory={editingBudgetCategory}
        onSave={(data) => {
          setUserBudgetLimitRupees(data.totalBudget.toString())
          setEmergencyGoalRupees(data.emergencyGoal)
          setCategoryBudgets(data.categoryBudgets)
          if (typeof window !== 'undefined') {
            localStorage.setItem('moneymate_user_budget_rupees', data.totalBudget.toString())
            localStorage.setItem('moneymate_emergency_goal_rupees', data.emergencyGoal.toString())
            localStorage.setItem('moneymate_category_budgets', JSON.stringify(data.categoryBudgets))
          }
          notify('Budgets & savings goals updated successfully!')
        }}
      />

      {/* iOS Registration & Login Onboarding Modal */}
      <AuthOnboardingModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialTab={authModalTab}
        initialAuthMode="signin"
        onSuccess={() => {
          notify(auth.isAuthenticated ? 'Account updated' : 'Welcome to Money Mate!')
        }}
      />

      {/* Transaction Quick Actions & Detail Pop-up */}
      <TransactionDetailModal
        transaction={selectedDetailTransaction}
        onClose={() => setSelectedDetailTransaction(null)}
        onEdit={(t) => {
          setSelectedDetailTransaction(null)
          handleOpenEditModal(t)
        }}
        onDelete={(t) => {
          setSelectedDetailTransaction(null)
          handleOpenDeleteModal(t)
        }}
        categoryMap={categoryMap}
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

function BudgetGoalModal({
  isOpen,
  onClose,
  totalBudgetRupees,
  emergencyGoalRupees,
  categoryBudgets,
  categories,
  onSave,
  initialCategory,
}: {
  isOpen: boolean
  onClose: () => void
  totalBudgetRupees: number
  emergencyGoalRupees: number
  categoryBudgets: Record<string, number>
  categories: Category[]
  onSave: (data: {
    totalBudget: number
    emergencyGoal: number
    categoryBudgets: Record<string, number>
  }) => void
  initialCategory?: string | null
}) {
  const [totalBudget, setTotalBudget] = useState(totalBudgetRupees.toString())
  const [emergencyGoal, setEmergencyGoal] = useState(emergencyGoalRupees.toString())
  const [catLimits, setCatLimits] = useState<Record<string, string>>(() => {
    const res: Record<string, string> = {}
    categories.forEach((c) => {
      res[c.name] = (categoryBudgets[c.name] ?? Math.round(totalBudgetRupees * 0.15)).toString()
    })
    return res
  })

  useEffect(() => {
    if (isOpen) {
      setTotalBudget(totalBudgetRupees.toString())
      setEmergencyGoal(emergencyGoalRupees.toString())
      const res: Record<string, string> = {}
      categories.forEach((c) => {
        res[c.name] = (categoryBudgets[c.name] ?? Math.round(totalBudgetRupees * 0.15)).toString()
      })
      setCatLimits(res)
    }
  }, [isOpen, totalBudgetRupees, emergencyGoalRupees, categoryBudgets, categories])

  if (!isOpen) return null

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const parsedTotal = parseInt(totalBudget, 10) || totalBudgetRupees
    const parsedGoal = parseInt(emergencyGoal, 10) || emergencyGoalRupees
    const parsedCats: Record<string, number> = {}
    Object.entries(catLimits).forEach(([k, v]) => {
      const num = parseInt(v, 10)
      if (!isNaN(num) && num > 0) parsedCats[k] = num
    })
    onSave({
      totalBudget: parsedTotal,
      emergencyGoal: parsedGoal,
      categoryBudgets: parsedCats,
    })
    onClose()
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true">
      <div className="modal" style={{ width: 'min(100%, 460px)', maxHeight: '90vh', overflowY: 'auto' }}>
        <header>
          <div>
            <span>CONFIGURABLE LIMITS</span>
            <h2>Adjust Budgets &amp; Goals</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSave} style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#aeb6ca', marginBottom: '6px' }}>
              Overall Monthly Spend Limit (₹)
            </label>
            <input
              type="number"
              min="1000"
              step="500"
              value={totalBudget}
              onChange={(e) => setTotalBudget(e.target.value)}
              placeholder="e.g. 45000"
              required
            />
            <small style={{ fontSize: '10px', color: '#8d96ac', marginTop: '4px', display: 'block' }}>
              Used across dashboards and planner headroom projections.
            </small>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#aeb6ca', marginBottom: '6px' }}>
              Primary Goal: Emergency Fund Target (₹)
            </label>
            <input
              type="number"
              min="5000"
              step="1000"
              value={emergencyGoal}
              onChange={(e) => setEmergencyGoal(e.target.value)}
              placeholder="e.g. 60000"
              required
            />
            <small style={{ fontSize: '10px', color: '#8d96ac', marginTop: '4px', display: 'block' }}>
              Compared against your net confirmed ledger savings.
            </small>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#aeb6ca', marginBottom: '8px' }}>
              Category Allocations (₹)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
              {categories.filter((c) => c.type === 'expense').map((cat) => (
                <div
                  key={cat.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    background: initialCategory === cat.name ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                    padding: '6px 10px',
                    borderRadius: '8px',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#eff1fa', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: cat.color }} />
                    {cat.name}
                  </span>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    style={{ width: '110px', height: '30px', textAlign: 'right', fontSize: '12px' }}
                    value={catLimits[cat.name] ?? ''}
                    onChange={(e) => setCatLimits((prev) => ({ ...prev, [cat.name]: e.target.value }))}
                    placeholder="Limit"
                  />
                </div>
              ))}
            </div>
          </div>

          <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
            <button type="button" className="outline-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Save All Limits
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

export default App

