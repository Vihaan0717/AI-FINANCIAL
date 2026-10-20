import { useState, useRef, useMemo, useEffect, Fragment, type ChangeEvent, type DragEvent } from 'react'
import {
  UploadCloud,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  RotateCcw,
  Search,
  ShieldCheck,
  Info,
  ArrowRightLeft,
  Check,
  HelpCircle,
  Sparkles,
  LayoutGrid,
  Layers,
  Table2,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react'
import './ReconciliationModal.css'
import type {
  StatementProvider,
  ReconciliationDecision,
  ReconciliationDecisionState,
  ProposedImportSummary,
  AccountDefinition,
  ImportBatch,
  MaskedAccountMapping,
} from '../types/reconciliation'
import type { StatementParserResult } from '../utils/statementParsers/parserTypes'
import { parseStatementCsv, parseStatementPdf } from '../utils/statementParsers'
import {
  createInitialReconciliationDecisions,
  calculateProposedImportSummary,
  evaluateRecordAgainstLedger,
} from '../utils/reconciliationRules'
import { formatPaise } from '../utils/money'
import type { Transaction, TransactionType } from '../types/transaction'
import { DEFAULT_CATEGORIES, type Category } from '../types/category'
import { evaluateBatchEligibility } from '../services/reconciliationEligibility'
import { commitStatementBatch, computeFileHash } from '../services/statementImportService'
import { executeBatchRollback } from '../services/statementRollbackService'
import {
  getAccountMappingsForWorkspace,
  saveAccountMapping,
} from '../services/accountMappingService'

interface ReconciliationModalProps {
  isOpen: boolean
  onClose: () => void
  isDemoMode: boolean
  existingTransactions?: Transaction[]
  categories?: Category[]
  notify: (msg: string) => void
  onCommitSuccess?: () => void
}

const PROVIDER_OPTIONS: { value: StatementProvider | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto-detect (Recommended)' },
  { value: 'sbi', label: 'State Bank of India (SBI)' },
  { value: 'union_bank', label: 'Union Bank of India' },
  { value: 'phonepe', label: 'PhonePe (PDF / CSV)' },
  { value: 'paytm', label: 'Paytm' },
  { value: 'slice', label: 'Slice' },
  { value: 'generic_csv', label: 'Generic CSV' },
]

const ACCOUNT_OPTIONS: AccountDefinition[] = [
  {
    id: 'acc-sbi-primary',
    institution: 'SBI',
    alias: 'SBI Primary Savings',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
  },
  {
    id: 'acc-union-savings',
    institution: 'Union Bank of India',
    alias: 'Union Bank Operating',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
  },
  {
    id: 'acc-phonepe-linked',
    institution: 'Other',
    alias: 'PhonePe (Linked Bank)',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
  },
  {
    id: 'acc-paytm-linked',
    institution: 'Other',
    alias: 'Paytm (Linked Bank)',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
  },
  {
    id: 'acc-slice-linked',
    institution: 'Other',
    alias: 'Slice (Linked Card/UPI)',
    accountType: 'credit_card',
    currency: 'INR',
    isOwned: true,
  },
  {
    id: 'acc-generic',
    institution: 'Other',
    alias: 'Generic Account',
    accountType: 'other',
    currency: 'INR',
    isOwned: true,
  },
]

const OWNED_ACCOUNTS_MAP = new Map<string, AccountDefinition>(
  ACCOUNT_OPTIONS.map((acc) => [acc.id, acc])
)

function getSmartCategory(
  description: string,
  counterparty: string | undefined,
  direction: 'debit' | 'credit'
): string {
  const text = `${description} ${counterparty || ''}`.toLowerCase()
  if (direction === 'credit') {
    if (/salary|payroll|bonus|employer/i.test(text)) return 'Salary'
    if (/dividend|interest|stock|mf|mutual|fund/i.test(text)) return 'Investments'
    return 'Salary'
  }
  if (/swiggy|zomato|food|restaurant|cafe|coffee|dining|tea|snacks|burger|pizza/i.test(text)) return 'Food & dining'
  if (/grocery|supermarket|mart|dmart|blinkit|zepto|bigbasket|instamart|milk|provisions/i.test(text)) return 'Groceries'
  if (/uber|ola|rapido|metro|petrol|fuel|transport|travel|train|irctc|bus/i.test(text)) return 'Transport'
  if (/recharge|bill|electricity|bescom|airtel|jio|broadband|water|gas|utility/i.test(text)) return 'Bills & utilities'
  if (/medical|pharmacy|hospital|apollo|1mg|doctor|clinic/i.test(text)) return 'Healthcare'
  if (/movie|cinema|netflix|spotify|prime|pvr|entertainment/i.test(text)) return 'Entertainment'
  if (/rent|maintenance|home|flat/i.test(text)) return 'Home'
  return 'Shopping'
}

export function renderStateBadge(state: ReconciliationDecisionState) {
  switch (state) {
    case 'suggested_match':
      return (
        <span className="recon-decision-badge suggested">
          <HelpCircle size={12} /> Suggested Match
        </span>
      )
    case 'confirmed_match':
      return (
        <span className="recon-decision-badge confirmed">
          <CheckCircle2 size={12} /> Confirmed Link
        </span>
      )
    case 'rejected_match':
      return (
        <span className="recon-decision-badge rejected">
          <Check size={12} /> Keep Separate
        </span>
      )
    case 'conflicting':
      return (
        <span className="recon-decision-badge conflicting">
          <AlertTriangle size={12} /> Conflict
        </span>
      )
    case 'classification_required':
      return (
        <span className="recon-decision-badge needs_review">
          <Info size={12} /> Needs Review
        </span>
      )
    case 'ready_for_import':
      return (
        <span className="recon-decision-badge confirmed" style={{ background: 'rgba(16, 185, 129, 0.14)', color: '#059669', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
          <Check size={12} /> Ready to Import
        </span>
      )
    case 'unmatched':
    default:
      return (
        <span className="recon-decision-badge unmatched">
          New Event
        </span>
      )
  }
}

function formatSignedPaise(amountPaise: number, direction: 'debit' | 'credit'): string {
  const isDebit = direction === 'debit'
  const signed = isDebit ? -amountPaise : amountPaise
  const formatted = formatPaise(signed, { showSign: true })
  return formatted.replace(/^([+−])(₹)/, '$1 $2')
}

type ReviewTab =
  | 'all'
  | 'suggested_matches'
  | 'unmatched_bank'
  | 'unmatched_upi'
  | 'internal_transfers'
  | 'conflicts'
  | 'confirmed'
  | 'summary'
  | 'rejected'
  | 'warnings'

export function ReconciliationModal({
  isOpen,
  onClose,
  isDemoMode,
  existingTransactions = [],
  categories = DEFAULT_CATEGORIES,
  notify,
  onCommitSuccess,
}: ReconciliationModalProps) {
  // All hooks must be called before conditional return
  const [selectedProvider, setSelectedProvider] = useState<StatementProvider | 'auto'>('auto')
  const [selectedAccountId, setSelectedAccountId] = useState<string>('acc-sbi-primary')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileHash, setFileHash] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [parserResult, setParserResult] = useState<StatementParserResult | null>(null)
  const [userDecisions, setUserDecisions] = useState<Map<string, ReconciliationDecision>>(new Map())
  const [activeTab, setActiveTab] = useState<ReviewTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [directionFilter, setDirectionFilter] = useState<'all' | 'debit' | 'credit' | 'debits' | 'credits'>('all')
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'slide' | 'table'>('cards')
  const [slideIndex, setSlideIndex] = useState(0)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [quickFilter, setQuickFilter] = useState<'all' | 'needs_review' | 'debits' | 'credits' | 'ready'>('all')
  const [modifiedRecordIds, setModifiedRecordIds] = useState<Set<string>>(new Set())

  const [accountMappings, setAccountMappings] = useState<Record<string, MaskedAccountMapping>>({})

  // Load account mappings for active workspace
  useEffect(() => {
    let isMounted = true
    getAccountMappingsForWorkspace(isDemoMode ? 'demo' : 'live').then((mappings) => {
      if (isMounted) {
        setAccountMappings(mappings)
      }
    })
    return () => {
      isMounted = false
    }
  }, [isDemoMode])

  // Stage 8.5 Commit & Rollback states
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [committedBatch, setCommittedBatch] = useState<ImportBatch | null>(null)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false)
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null)

  // Auto-detected statement file from Downloads
  const [detectedLocalFile, setDetectedLocalFile] = useState<{
    fileName: string
    fileSize: number
    base64: string
  } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    fetch('/api/local-statement')
      .then((res) => {
        if (!res.ok) throw new Error('Not found')
        return res.json()
      })
      .then((data) => {
        if (data?.success && data?.base64) {
          setDetectedLocalFile(data)
        }
      })
      .catch(() => {
        setDetectedLocalFile(null)
      })
  }, [isOpen])

  const fileInputRef = useRef<HTMLInputElement>(null)

  // In-memory proposed import summary using exact integer paise
  const proposedSummary: ProposedImportSummary | null = useMemo(() => {
    if (!parserResult) return null
    return calculateProposedImportSummary(
      parserResult.records,
      userDecisions,
      parserResult.rejectedRows.length
    )
  }, [parserResult, userDecisions])

  // Central batch eligibility evaluation (Stage 8.5)
  const batchEligibility = useMemo(() => {
    if (!parserResult) return null
    return evaluateBatchEligibility(
      parserResult.records,
      userDecisions,
      isDemoMode ? 'demo' : 'live'
    )
  }, [parserResult, userDecisions, isDemoMode])

  // Unresolved masked account summaries for 1-click batch mapping banner
  const unresolvedMaskSummaries = useMemo(() => {
    if (!parserResult) return []
    const maskCounts = new Map<string, number>()
    for (const rec of parserResult.records) {
      const dec = userDecisions.get(rec.id)
      const effectiveAccountId = dec?.assignedAccountId || rec.sourceAccountId
      if (effectiveAccountId.startsWith('unmapped:')) {
        const mask = rec.maskedAccountId || effectiveAccountId.replace('unmapped:', '')
        maskCounts.set(mask, (maskCounts.get(mask) || 0) + 1)
      }
    }
    return Array.from(maskCounts.entries()).map(([mask, count]) => ({ mask, count }))
  }, [parserResult, userDecisions])

  // Count metrics for tabs
  const tabCounts = useMemo(() => {
    if (!parserResult) {
      return {
        all: 0,
        suggested_matches: 0,
        unmatched_bank: 0,
        unmatched_upi: 0,
        internal_transfers: 0,
        conflicts: 0,
        confirmed: 0,
        rejected: 0,
        warnings: 0,
      }
    }

    let suggested_matches = 0
    let unmatched_bank = 0
    let unmatched_upi = 0
    let internal_transfers = 0
    let conflicts = 0
    let confirmed = 0

    for (const rec of parserResult.records) {
      const decision = userDecisions.get(rec.id)
      const state = decision?.state || 'unreviewed'

      if (state === 'confirmed_match' || state === 'rejected_match') {
        confirmed++
      } else if (state === 'suggested_match') {
        if (decision?.isInternalTransfer) {
          internal_transfers++
        } else {
          suggested_matches++
        }
      } else if (state === 'conflicting') {
        conflicts++
      } else if (
        state === 'unmatched' ||
        state === 'ready_for_import' ||
        state === 'classification_required'
      ) {
        if (rec.sourceProviderRole === 'primary_ledger') {
          unmatched_bank++
        } else {
          unmatched_upi++
        }
      }
    }

    return {
      all: parserResult.records.length,
      suggested_matches,
      unmatched_bank,
      unmatched_upi,
      internal_transfers,
      conflicts,
      confirmed,
      rejected: parserResult.rejectedRows.length,
      warnings: parserResult.warnings.length,
    }
  }, [parserResult, userDecisions])

  // Filtered records for current tab and search
  const filteredRecords = useMemo(() => {
    if (!parserResult) return []

    return parserResult.records.filter((rec) => {
      const decision = userDecisions.get(rec.id)
      const state = decision?.state || 'unreviewed'

      // Tab filtering
      switch (activeTab) {
        case 'suggested_matches':
          if (state !== 'suggested_match' || decision?.isInternalTransfer) return false
          break
        case 'unmatched_bank':
          if (
            (state !== 'unmatched' && state !== 'ready_for_import' && state !== 'classification_required') ||
            rec.sourceProviderRole !== 'primary_ledger'
          )
            return false
          break
        case 'unmatched_upi':
          if (
            (state !== 'unmatched' && state !== 'ready_for_import' && state !== 'classification_required') ||
            rec.sourceProviderRole !== 'enrichment_source'
          )
            return false
          break
        case 'internal_transfers':
          if (!decision?.isInternalTransfer) return false
          break
        case 'conflicts':
          if (state !== 'conflicting') return false
          break
        case 'confirmed':
          if (state !== 'confirmed_match' && state !== 'rejected_match') return false
          break
        case 'all':
        default:
          break
      }

      // Quick filter
      if (quickFilter === 'needs_review') {
        if (
          state !== 'classification_required' &&
          state !== 'unreviewed' &&
          state !== 'suggested_match' &&
          state !== 'conflicting'
        ) {
          return false
        }
      } else if (quickFilter === 'debits') {
        if (rec.direction !== 'debit') return false
      } else if (quickFilter === 'credits') {
        if (rec.direction !== 'credit') return false
      } else if (quickFilter === 'ready') {
        if (state !== 'ready_for_import' && state !== 'confirmed_match') return false
      }

      // Direction filtering
      if (directionFilter !== 'all' && rec.direction !== directionFilter) {
        return false
      }

      // Text query filtering
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesDesc = rec.cleanDescription.toLowerCase().includes(q)
        const matchesMerchant = rec.counterparty?.toLowerCase().includes(q)
        const matchesRef =
          rec.normalizedReference?.toLowerCase().includes(q) ||
          rec.originalReference?.toLowerCase().includes(q)
        if (!matchesDesc && !matchesMerchant && !matchesRef) {
          return false
        }
      }

      return true
    })
  }, [parserResult, activeTab, quickFilter, directionFilter, searchQuery, userDecisions])

  // Quick counts for automation pills
  const quickCounts = useMemo(() => {
    if (!parserResult) return { all: 0, needs_review: 0, debits: 0, credits: 0, ready: 0 }
    let needs_review = 0
    let debits = 0
    let credits = 0
    let ready = 0

    for (const rec of parserResult.records) {
      const dec = userDecisions.get(rec.id)
      const st = dec?.state || 'unreviewed'
      if (rec.direction === 'debit') debits++
      if (rec.direction === 'credit') credits++
      if (
        st === 'classification_required' ||
        st === 'unreviewed' ||
        st === 'suggested_match' ||
        st === 'conflicting'
      ) {
        needs_review++
      }
      if (st === 'ready_for_import' || st === 'confirmed_match') {
        ready++
      }
    }

    return {
      all: parserResult.records.length,
      needs_review,
      debits,
      credits,
      ready,
    }
  }, [parserResult, userDecisions])

  // Reset slide index on filter change
  useEffect(() => {
    setSlideIndex(0)
  }, [activeTab, quickFilter, directionFilter, searchQuery])

  // Slide Deck keyboard navigation (Space / Enter / ArrowLeft / ArrowRight)
  useEffect(() => {
    if (!isOpen || viewMode !== 'slide' || filteredRecords.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA'
      ) {
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSlideIndex((prev) => Math.max(0, prev - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSlideIndex((prev) => Math.min(filteredRecords.length - 1, prev + 1))
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        const currentRec = filteredRecords[slideIndex]
        if (currentRec) {
          handleApproveRecord(currentRec.id)
          if (slideIndex < filteredRecords.length - 1) {
            setSlideIndex((prev) => prev + 1)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, viewMode, filteredRecords, slideIndex])

  // Process selected statement file (CSV or PDF)
  const handleFileProcess = async (file: File) => {
    const isPdf =
      file.name.toLowerCase().endsWith('.pdf') ||
      file.type === 'application/pdf'
    const isCsv =
      file.name.toLowerCase().endsWith('.csv') ||
      file.type === 'text/csv' ||
      file.type === 'text/plain'

    if (!isPdf && !isCsv) {
      notify('Please select a valid statement file (.csv or .pdf).')
      return
    }

    setSelectedFile(file)
    setIsParsing(true)

    try {
      const account = ACCOUNT_OPTIONS.find((a) => a.id === selectedAccountId)
      let result: StatementParserResult

      if (isPdf) {
        const arrayBuffer = await file.arrayBuffer()
        const u8Array = new Uint8Array(arrayBuffer)
        const computedHash = computeFileHash(u8Array)
        setFileHash(computedHash)
        setFileContent('')
        setCommitError(null)
        setCommittedBatch(null)
        setRollbackMessage(null)
        setShowRollbackConfirm(false)

        result = await parseStatementPdf(u8Array, {
          selectedProvider: selectedProvider === 'auto' ? undefined : selectedProvider,
          sourceAccountId: selectedAccountId,
          sourceAccountAlias: account?.alias || 'Selected Account',
          statementFileId: file.name,
          isDemo: isDemoMode,
          accountMappings,
        })
      } else {
        const text = await file.text()
        setFileContent(text)
        const computedHash = computeFileHash(text)
        setFileHash(computedHash)
        setCommitError(null)
        setCommittedBatch(null)
        setRollbackMessage(null)
        setShowRollbackConfirm(false)

        result = parseStatementCsv(text, {
          selectedProvider: selectedProvider === 'auto' ? undefined : selectedProvider,
          sourceAccountId: selectedAccountId,
          sourceAccountAlias: account?.alias || 'Selected Account',
          statementFileId: file.name,
          isDemo: isDemoMode,
          accountMappings,
        })
      }

      // Auto-detect and link masked accounts to the selected owned account
      const targetAccount = ACCOUNT_OPTIONS.find((a) => a.id === selectedAccountId) || ACCOUNT_OPTIONS[0]
      const unmappedMasks = new Set<string>()
      for (const rec of result.records) {
        if (rec.sourceAccountId.startsWith('unmapped:')) {
          const mask = rec.maskedAccountId || rec.sourceAccountId.replace('unmapped:', '')
          unmappedMasks.add(mask)
          rec.sourceAccountId = targetAccount.id
          rec.sourceAccountAlias = targetAccount.alias
        }
      }
      for (const mask of unmappedMasks) {
        saveAccountMapping({
          maskedAccountId: mask,
          targetAccountId: targetAccount.id,
          targetAccountAlias: targetAccount.alias,
          provider: 'phonepe',
          workspace: isDemoMode ? 'demo' : 'live',
          confirmedBy: 'user_explicit',
          notes: `Auto-linked ${mask} to ${targetAccount.alias}`,
        }).catch(console.error)
      }

      // Generate initial in-memory reconciliation decisions
      const initialDecisions = createInitialReconciliationDecisions(
        result.records,
        existingTransactions,
        OWNED_ACCOUNTS_MAP
      )

      // Auto-approve all unmatched records immediately — zero-effort import flow
      let autoApprovedCount = 0
      for (const [id, dec] of initialDecisions.entries()) {
        const rec = result.records.find((r) => r.id === id)
        const cat = dec.proposedCategory || rec?.proposedCategory
        const validCat =
          cat && cat.trim() !== '' && cat !== 'Uncategorized' && cat !== 'Other'
            ? cat
            : getSmartCategory(rec?.cleanDescription || '', rec?.counterparty, rec?.direction || 'debit')

        if (
          dec.state === 'unmatched' ||
          dec.state === 'classification_required'
        ) {
          initialDecisions.set(id, {
            ...dec,
            assignedAccountId: dec.assignedAccountId || rec?.sourceAccountId || targetAccount.id,
            assignedAccountAlias: dec.assignedAccountAlias || rec?.sourceAccountAlias || targetAccount.alias,
            proposedCategory: validCat,
            state: 'ready_for_import',
            isConfirmed: true,
            userAction: 'approve_new',
            decisionReason: 'Auto-approved for 1-click import.',
            updatedAt: new Date().toISOString(),
          })
          autoApprovedCount++
        } else {
          initialDecisions.set(id, {
            ...dec,
            assignedAccountId: dec.assignedAccountId || rec?.sourceAccountId || targetAccount.id,
            assignedAccountAlias: dec.assignedAccountAlias || rec?.sourceAccountAlias || targetAccount.alias,
            proposedCategory: validCat,
          })
        }
      }

      setParserResult(result)
      setUserDecisions(initialDecisions)
      setActiveTab('all')
      notify(
        `✓ ${result.records.length} transactions ready — ${autoApprovedCount} auto-approved for 1-click import!`
      )

    } catch (err: any) {
      console.error('Statement parsing failed:', err)
      notify(`Parsing error: ${err.message || 'Failed to read statement file'}`)
    } finally {
      setIsParsing(false)
    }
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileProcess(file)
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileProcess(file)
    }
  }

  const handleLoadDetectedFile = async () => {
    if (!detectedLocalFile) return
    setIsParsing(true)
    try {
      const binaryString = atob(detectedLocalFile.base64)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const fileObj = new File([bytes], detectedLocalFile.fileName, {
        type: detectedLocalFile.fileName.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : 'text/csv',
      })
      await handleFileProcess(fileObj)
    } catch (err: any) {
      notify(err.message || 'Failed to auto-load statement from Downloads')
    } finally {
      setIsParsing(false)
    }
  }

  // Interactive Review User Actions (In-Memory Only)
  const handleConfirmMatch = (recordId: string) => {
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(recordId)
      if (existing) {
        updated.set(recordId, {
          ...existing,
          state: 'confirmed_match',
          isConfirmed: true,
          userAction: 'confirm_match',
          decisionReason: existing.isInternalTransfer
            ? 'User confirmed internal transfer between owned accounts.'
            : 'User explicitly confirmed match against existing ledger transaction.',
          updatedAt: new Date().toISOString(),
        })

        // If transfer pair, also confirm the companion leg
        if (existing.isInternalTransfer && existing.matchedRecordId) {
          const companion = updated.get(existing.matchedRecordId)
          if (companion) {
            updated.set(existing.matchedRecordId, {
              ...companion,
              state: 'confirmed_match',
              isConfirmed: true,
              userAction: 'confirm_match',
              decisionReason: 'User confirmed companion transfer leg.',
              updatedAt: new Date().toISOString(),
            })
          }
        }
      }
      return updated
    })
    notify('Match confirmed in draft.')
  }

  const handleRejectMatch = (recordId: string) => {
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(recordId)
      if (existing) {
        updated.set(recordId, {
          ...existing,
          state: 'rejected_match',
          isConfirmed: true,
          userAction: 'reject_match',
          decisionReason:
            'User rejected proposed match. Record will be imported as an independent new transaction.',
          updatedAt: new Date().toISOString(),
        })

        // If companion leg was paired as transfer, separate it
        if (existing.isInternalTransfer && existing.matchedRecordId) {
          const companion = updated.get(existing.matchedRecordId)
          if (companion) {
            updated.set(existing.matchedRecordId, {
              ...companion,
              state: 'rejected_match',
              isConfirmed: true,
              userAction: 'reject_transfer',
              decisionReason: 'Companion transfer leg decoupled by user.',
              updatedAt: new Date().toISOString(),
            })
          }
        }
      }
      return updated
    })
    notify('Match rejected. Record kept as separate independent transaction.')
  }

  const handleMarkReview = (recordId: string) => {
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(recordId)
      if (existing) {
        updated.set(recordId, {
          ...existing,
          state: 'classification_required',
          isConfirmed: false,
          userAction: 'mark_review',
          decisionReason: 'Marked for manual classification review.',
          updatedAt: new Date().toISOString(),
        })
      }
      return updated
    })
    notify('Record marked for review.')
  }

  const handleApproveRecord = (recordId: string) => {
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(recordId)
      if (existing) {
        updated.set(recordId, {
          ...existing,
          state: 'ready_for_import',
          isConfirmed: true,
          userAction: 'approve_new',
          decisionReason: 'User explicitly approved record for ledger import.',
          updatedAt: new Date().toISOString(),
        })
      }
      return updated
    })
    notify('Record explicitly approved for import.')
  }

  const handleApproveAllNew = () => {
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      let count = 0
      for (const [id, dec] of updated.entries()) {
        // Approve ALL unmatched/classification_required records — category can be edited post-import
        if (
          dec.state === 'unmatched' ||
          dec.state === 'ready_for_import' ||
          dec.state === 'classification_required'
        ) {
          const rec = parserResult?.records.find((r) => r.id === id)
          const cat =
            dec.proposedCategory &&
            dec.proposedCategory !== 'Other' &&
            dec.proposedCategory !== 'Uncategorized'
              ? dec.proposedCategory
              : getSmartCategory(rec?.cleanDescription || '', rec?.counterparty, rec?.direction || 'debit')

          let nextType = dec.proposedType || (rec?.direction === 'credit' ? 'income' : 'expense')
          let isInternal = dec.isInternalTransfer
          // If marked as transfer but missing destination account, treat as regular P2P expense or income
          if ((nextType === 'transfer' || isInternal) && !dec.transferDestinationAccountId) {
            nextType = rec?.direction === 'credit' ? 'income' : 'expense'
            isInternal = false
          }

          updated.set(id, {
            ...dec,
            proposedType: nextType,
            isInternalTransfer: isInternal,
            proposedCategory: cat,
            state: 'ready_for_import',
            isConfirmed: true,
            userAction: 'approve_new',
            decisionReason: 'Auto-approved for ledger import.',
            updatedAt: new Date().toISOString(),
          })
          count++
        }
      }
      notify(`✓ ${count} transactions approved for import!`)
      return updated
    })
  }


  const handleChangeClassification = (
    recordId: string,
    newType: TransactionType | 'reversal' | 'needs_review'
  ) => {
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(recordId)
      if (existing) {
        const nextState: ReconciliationDecisionState =
          newType === 'needs_review'
            ? 'classification_required'
            : existing.state === 'classification_required'
            ? 'ready_for_import'
            : existing.state

        updated.set(recordId, {
          ...existing,
          proposedType: newType,
          state: nextState,
          userAction: 'change_classification',
          decisionReason: `Classification updated to ${newType}.`,
          updatedAt: new Date().toISOString(),
        })
      }
      return updated
    })
  }

  const handleChangeCategory = (recordId: string, categoryName: string, categoryId?: string) => {
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      const existing = updated.get(recordId)
      if (existing) {
        const nextState =
          existing.state === 'classification_required' ? 'ready_for_import' : existing.state

        updated.set(recordId, {
          ...existing,
          proposedCategory: categoryName,
          proposedCategoryId: categoryId,
          state: nextState,
          userAction: 'change_classification',
          decisionReason: `Category assigned to ${categoryName}.`,
          updatedAt: new Date().toISOString(),
        })
      }
      return updated
    })
  }

  const handleAssignAccountForMask = async (maskedId: string, targetAccountId: string) => {
    const targetAccount = ACCOUNT_OPTIONS.find((a) => a.id === targetAccountId)
    if (!targetAccount) return

    // 1. Persist explicit mapping
    const newMapping = await saveAccountMapping({
      maskedAccountId: maskedId,
      targetAccountId: targetAccount.id,
      targetAccountAlias: targetAccount.alias,
      provider: 'phonepe',
      workspace: isDemoMode ? 'demo' : 'live',
      confirmedBy: 'user_explicit',
      notes: `User explicitly mapped mask ${maskedId} to ${targetAccount.alias}`,
    })

    setAccountMappings((prev) => ({
      ...prev,
      [maskedId]: newMapping,
    }))

    // 2. Update all records matching this mask
    if (parserResult) {
      for (const rec of parserResult.records) {
        if (rec.maskedAccountId === maskedId) {
          rec.sourceAccountId = targetAccount.id
          rec.sourceAccountAlias = targetAccount.alias
        }
      }
    }

    // 3. Update userDecisions
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      if (parserResult) {
        for (const rec of parserResult.records) {
          if (rec.maskedAccountId === maskedId) {
            const dec = updated.get(rec.id)
            if (dec) {
              updated.set(rec.id, {
                ...dec,
                assignedAccountId: targetAccount.id,
                assignedAccountAlias: targetAccount.alias,
                decisionReason: `Account explicitly assigned to ${targetAccount.alias}.`,
                updatedAt: new Date().toISOString(),
              })
            }
          }
        }
      }
      return updated
    })

    notify(`Account mapping saved: ${maskedId} → ${targetAccount.alias}`)
  }

  const handleAssignAccountForRecord = (recordId: string, targetAccountId: string) => {
    const targetAccount = ACCOUNT_OPTIONS.find((a) => a.id === targetAccountId)
    if (!targetAccount) return

    if (parserResult) {
      const rec = parserResult.records.find((r) => r.id === recordId)
      if (rec) {
        rec.sourceAccountId = targetAccount.id
        rec.sourceAccountAlias = targetAccount.alias
      }
    }

    setUserDecisions((prev) => {
      const updated = new Map(prev)
      const dec = updated.get(recordId)
      if (dec) {
        updated.set(recordId, {
          ...dec,
          assignedAccountId: targetAccount.id,
          assignedAccountAlias: targetAccount.alias,
          decisionReason: `Account explicitly assigned to ${targetAccount.alias}.`,
          updatedAt: new Date().toISOString(),
        })
      }
      return updated
    })
  }

  const handleResetDecision = (recordId: string) => {
    const record = parserResult?.records.find((r) => r.id === recordId)
    if (!record) return

    const initial = evaluateRecordAgainstLedger(record, existingTransactions)
    setUserDecisions((prev) => {
      const updated = new Map(prev)
      updated.set(recordId, initial)
      return updated
    })
    notify('Decision reset to initial auto-evaluation.')
  }

  const handleDiscard = () => {
    setSelectedFile(null)
    setFileContent('')
    setFileHash('')
    setParserResult(null)
    setUserDecisions(new Map())
    setExpandedRowId(null)
    setSearchQuery('')
    setCommitError(null)
    setCommittedBatch(null)
    setShowRollbackConfirm(false)
    setRollbackMessage(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    notify('Draft reconciliation discarded from memory.')
  }

  // Workspace safety guard: if active workspace changes while a reconciliation draft is staged,
  // clear the staged draft immediately so it can never be redirected into another workspace.
  const prevWorkspaceRef = useRef(isDemoMode)
  useEffect(() => {
    if (prevWorkspaceRef.current !== isDemoMode) {
      prevWorkspaceRef.current = isDemoMode
      if (parserResult) {
        handleDiscard()
        notify(
          `Workspace switched to ${isDemoMode ? 'Demo' : 'Live'}. Staged reconciliation draft was cleared to prevent cross-workspace contamination.`
        )
      }
    }
  }, [isDemoMode, parserResult])

  const handleCommitImport = async () => {
    if (!parserResult || !batchEligibility || !batchEligibility.isBatchEligible) return
    setIsCommitting(true)
    setCommitError(null)

    try {
      const account = ACCOUNT_OPTIONS.find((a) => a.id === selectedAccountId)
      const recordsWithBalance = parserResult.records
        .filter((r) => r.balanceAfterPaise !== undefined)
        .sort((a, b) => (a.originalRowIndex || 0) - (b.originalRowIndex || 0))
      const firstRec = recordsWithBalance[0]
      const lastRec = recordsWithBalance[recordsWithBalance.length - 1]
      const startingBalancePaise =
        firstRec && firstRec.balanceAfterPaise !== undefined
          ? firstRec.balanceAfterPaise - firstRec.signedAmountPaise
          : undefined
      const statementClosingBalancePaise = lastRec?.balanceAfterPaise

      const detected = parserResult.detection.detectedProvider
      const provider: StatementProvider =
        detected || (selectedProvider === 'auto' ? 'generic_csv' : selectedProvider)

      const res = await commitStatementBatch({
        workspace: isDemoMode ? 'demo' : 'live',
        records: parserResult.records,
        decisions: userDecisions,
        batchMetadata: {
          fileName: selectedFile?.name || 'statement.csv',
          fileSizeBytes: selectedFile?.size || fileContent.length,
          fileHash: fileHash || computeFileHash(fileContent),
          mimeType: selectedFile?.type || (selectedFile?.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/csv'),
          detectedFormat: selectedFile?.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'csv',
        },
        sourceProvider: provider,
        sourceAccountId: selectedAccountId,
        sourceAccountAlias: account?.alias || 'Selected Account',
        beginningBalancePaise: startingBalancePaise,
        statementClosingBalancePaise,
      })

      if (res.success && res.batch) {
        setCommittedBatch(res.batch)
        notify(
          `Statement batch committed: ${res.createdTransactionIds?.length || 0} transactions added, ${res.skippedDuplicatesCount || 0} duplicates skipped.`
        )
        onCommitSuccess?.()
      } else {
        setCommitError(res.error || 'Commitment failed')
        notify(`Commit failed: ${res.error || 'Unknown error'}`)
      }
    } catch (err: any) {
      const msg = err.message || 'Unexpected failure during import commit'
      setCommitError(msg)
      notify(`Commit error: ${msg}`)
    } finally {
      setIsCommitting(false)
    }
  }

  const handleExecuteRollback = async () => {
    if (!committedBatch) return
    setIsRollingBack(true)
    try {
      const res = await executeBatchRollback(committedBatch.id, {
        targetScope: isDemoMode ? 'demo' : 'live',
      })
      if (res.success) {
        setCommittedBatch((prev) =>
          prev ? { ...prev, commitStatus: 'rolled_back' } : null
        )
        setShowRollbackConfirm(false)
        setRollbackMessage(res.message || 'Batch successfully rolled back.')
        notify(`Batch ${committedBatch.id} successfully rolled back.`)
        onCommitSuccess?.()
      } else {
        notify(`Rollback failed: ${res.error}`)
      }
    } catch (err: any) {
      notify(`Rollback error: ${err.message}`)
    } finally {
      setIsRollingBack(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="bd show recon-modal-backdrop"
      id="bd"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="recon-title"
    >
      <div className="mc gl recon-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mh recon-modal-header">
          <div className="recon-header-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileSpreadsheet size={22} style={{ color: 'var(--pu)' }} />
            <h2 id="recon-title">Statement Import &amp; Interactive Reconciliation</h2>
            <span className={`badge recon-scope-badge ${isDemoMode ? 'demo' : 'live'}`}>
              {isDemoMode ? 'Demo Workspace' : 'Live Workspace'}
            </span>
          </div>
          <button className="ib action-btn" onClick={onClose} aria-label="Close modal" title="Close modal">
            <X size={17} />
          </button>
        </div>

        {/* Body */}
        <div className="mb recon-modal-body">
          {committedBatch ? (
            <div className="recon-audit-view">
              {/* Success Header Card */}
              <div className="recon-audit-header-card">
                <div className="recon-audit-header-title">
                  <CheckCircle2 size={24} style={{ color: '#10b981' }} />
                  <div>
                    <h3>Statement Import Completed &amp; Reconciled</h3>
                    <div className="recon-audit-header-meta">
                      Batch ID: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{committedBatch.id}</span> ·{' '}
                      {new Date(committedBatch.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span className={`recon-scope-badge ${isDemoMode ? 'demo' : 'live'}`}>
                    {isDemoMode ? 'Demo Workspace' : 'Live Workspace'}
                  </span>
                  <span
                    className="recon-decision-badge"
                    style={{
                      background: committedBatch.commitStatus === 'rolled_back' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: committedBatch.commitStatus === 'rolled_back' ? '#f87171' : '#10b981',
                      border: committedBatch.commitStatus === 'rolled_back' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    {committedBatch.commitStatus === 'rolled_back' ? 'ROLLED BACK' : 'COMMITTED'}
                  </span>
                </div>
              </div>

              {/* Rollback Notification Banner if recently rolled back */}
              {rollbackMessage && (
                <div
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    color: '#f87171',
                    fontSize: '0.85rem',
                  }}
                >
                  ✓ {rollbackMessage}
                </div>
              )}

              {/* Metric Cards Grid */}
              <div className="recon-audit-metrics-grid">
                <div className="recon-audit-metric-card">
                  <span className="label">Source Rows Parsed</span>
                  <span className="value">{committedBatch.recordCounts.total}</span>
                </div>
                <div className="recon-audit-metric-card">
                  <span className="label">Transactions Imported</span>
                  <span className="value" style={{ color: '#10b981' }}>
                    {committedBatch.auditReport?.acceptedAndImportedCount ?? committedBatch.recordCounts.imported}
                  </span>
                </div>
                <div className="recon-audit-metric-card">
                  <span className="label">Duplicates Skipped</span>
                  <span className="value" style={{ color: '#818cf8' }}>
                    {committedBatch.auditReport?.skippedDuplicatesCount ?? 0}
                  </span>
                </div>
                <div className="recon-audit-metric-card">
                  <span className="label">Internal Transfers</span>
                  <span className="value" style={{ color: '#38bdf8' }}>
                    {committedBatch.auditReport?.transfersCount ?? 0}
                  </span>
                </div>
                <div className="recon-audit-metric-card">
                  <span className="label">Retained Unresolved</span>
                  <span className="value" style={{ color: '#94a3b8' }}>
                    {committedBatch.auditReport?.retainedUnresolvedCount ?? 0}
                  </span>
                </div>
                <div className="recon-audit-metric-card">
                  <span className="label">Pending / Failed / Refunds</span>
                  <span className="value" style={{ color: '#f59e0b', fontSize: '1rem' }}>
                    {(committedBatch.auditReport?.pendingCount || 0)} P · {(committedBatch.auditReport?.failedCount || 0)} F · {(committedBatch.auditReport?.refundsCount || 0)} R
                  </span>
                </div>
              </div>

              {/* Balance Reconciliation Card */}
              <div className="recon-balance-card">
                <h4>
                  <Sparkles size={18} style={{ color: 'var(--accent, #6366f1)' }} />
                  Reconciliation Balance Verification
                </h4>
                <div className="recon-balance-grid">
                  <div className="recon-balance-row">
                    <span className="title">Statement Opening Balance</span>
                    <span className="num">
                      {committedBatch.auditReport?.beginningBalancePaise !== undefined
                        ? formatPaise(committedBatch.auditReport.beginningBalancePaise)
                        : 'Not provided'}
                    </span>
                  </div>
                  <div className="recon-balance-row">
                    <span className="title">Reconstructed Closing Balance</span>
                    <span className="num">
                      {committedBatch.auditReport?.reconstructedClosingBalancePaise !== undefined
                        ? formatPaise(committedBatch.auditReport.reconstructedClosingBalancePaise)
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="recon-balance-row">
                    <span className="title">Statement Closing Balance</span>
                    <span className="num">
                      {committedBatch.auditReport?.statementClosingBalancePaise !== undefined
                        ? formatPaise(committedBatch.auditReport.statementClosingBalancePaise)
                        : 'Not provided'}
                    </span>
                  </div>
                  <div className="recon-balance-row">
                    <span className="title">Net Balance Variance</span>
                    <span
                      className="num"
                      style={{
                        color:
                          committedBatch.auditReport?.balanceDifferencePaise === 0
                            ? '#10b981'
                            : '#f59e0b',
                      }}
                    >
                      {committedBatch.auditReport?.balanceDifferencePaise !== undefined
                        ? formatPaise(Math.abs(committedBatch.auditReport.balanceDifferencePaise))
                        : 'N/A'}
                    </span>
                  </div>
                </div>

                {/* Conclusive status badge */}
                <div>
                  {committedBatch.auditReport?.isReconciliationConclusive ? (
                    <div className="recon-status-badge conclusive">
                      <CheckCircle2 size={18} />
                      <span>{committedBatch.auditReport.reconciliationStatusReason}</span>
                    </div>
                  ) : (
                    <div className="recon-status-badge inconclusive">
                      <AlertTriangle size={18} />
                      <span>{committedBatch.auditReport?.reconciliationStatusReason || 'Inconclusive balance comparison.'}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Rollback Action Box */}
              {committedBatch.commitStatus !== 'rolled_back' && (
                <div className="recon-rollback-box">
                  <div className="recon-rollback-info">
                    <strong>Safe Batch Rollback Available</strong>
                    <span>
                      If this statement was imported by mistake or needs correction, you can safely undo it.
                      This removes only the {committedBatch.auditReport?.acceptedAndImportedCount ?? committedBatch.recordCounts.imported} newly created transactions.
                    </span>
                  </div>
                  {!showRollbackConfirm ? (
                    <button
                      className="danger-button"
                      id="recon-rollback-btn"
                      onClick={() => setShowRollbackConfirm(true)}
                    >
                      <RotateCcw size={14} /> Rollback this batch
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', color: '#f87171', fontWeight: 600 }}>Confirm rollback?</span>
                      <button
                        className="danger-button"
                        id="recon-confirm-rollback-btn"
                        onClick={handleExecuteRollback}
                        disabled={isRollingBack}
                      >
                        {isRollingBack ? 'Rolling back...' : 'Yes, Delete Created Transactions'}
                      </button>
                      <button
                        className="outline-button"
                        onClick={() => setShowRollbackConfirm(false)}
                        disabled={isRollingBack}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              {commitError && (
                <div
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    color: '#f87171',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={18} />
                    <span>{commitError}</span>
                  </div>
                  <button
                    style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}
                    onClick={() => setCommitError(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* Controls Row: Provider & Account Selection */}
              <div className="row2 recon-controls-row">
                <label htmlFor="recon-provider-select">
                  Source Provider / Format
                  <select
                    id="recon-provider-select"
                    className="recon-select"
                    data-opt="prov"
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value as StatementProvider | 'auto')}
                    disabled={Boolean(parserResult)}
                  >
                    {PROVIDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label htmlFor="recon-account-select">
                  Target Owned Account Alias
                  <select
                    id="recon-account-select"
                    className="recon-select"
                    data-opt="acct"
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    disabled={Boolean(parserResult)}
                  >
                    {ACCOUNT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.alias} ({opt.institution})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

          {/* Auto-detected statement banner from Downloads */}
          {!parserResult && detectedLocalFile && (
            <div
              className="recon-detected-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.12))',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                marginBottom: '16px',
                boxShadow: '0 4px 16px rgba(99, 102, 241, 0.08)',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
                    flexShrink: 0,
                  }}
                >
                  <FileSpreadsheet size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        textTransform: 'uppercase',
                        fontWeight: 800,
                        color: 'var(--accent, #6366f1)',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Found in Downloads Folder
                    </span>
                  </div>
                  <strong style={{ fontSize: '0.94rem', color: 'inherit' }}>
                    {detectedLocalFile.fileName}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '8px' }}>
                    ({(detectedLocalFile.fileSize / 1024).toFixed(1)} KB)
                  </span>
                </div>
              </div>

              <button
                type="button"
                id="recon-auto-load-btn"
                onClick={handleLoadDetectedFile}
                disabled={isParsing}
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '9px 20px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  cursor: isParsing ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease',
                  opacity: isParsing ? 0.6 : 1,
                }}
              >
                <Sparkles size={16} />
                {isParsing ? 'Parsing Statement...' : '1-Click Auto-Load'}
              </button>
            </div>
          )}

          {/* Upload Dropzone (When no file parsed) */}
          {!parserResult && (
            <div
              className={`recon-dropzone ${isDragging ? 'dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                id="recon-file-input"
                data-testid="recon-file-input"
                type="file"
                accept=".csv,.pdf,text/csv,text/plain,application/pdf"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />
              <div className="recon-dropzone-icon">
                <UploadCloud size={28} />
              </div>
              <h4>
                {isParsing ? 'Parsing statement in memory...' : 'Choose or drop statement file (CSV or PDF)'}
              </h4>
              <p>Supports PhonePe (PDF & CSV), SBI, Union Bank, Paytm, Slice, and standard CSV statement exports.</p>
              <button
                type="button"
                className="outline-button"
                style={{ marginTop: '8px', pointerEvents: 'none' }}
              >
                Browse CSV or PDF files
              </button>
            </div>
          )}

          {/* File Loaded Pill & Format Diagnostic Banner */}
          {parserResult && selectedFile && (
            <>
              <div className="file recon-file-pill">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <FileSpreadsheet size={22} style={{ color: 'var(--pu)' }} />
                  <div>
                    <b>{selectedFile.name}</b>
                    <small style={{ display: 'block', color: 'var(--mu)', fontSize: '0.75rem' }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB · {parserResult.detection.formatId || 'CSV'}
                    </small>
                  </div>
                </div>
                <button
                  className="ib action-btn"
                  onClick={handleDiscard}
                  title="Discard and upload another file"
                >
                  <RotateCcw size={16} />
                </button>
              </div>

              {/* Provisional / Verification Banner */}
              <div
                className={`ban recon-format-banner ${
                  parserResult.detection.isVerified
                    ? 'verified'
                    : parserResult.detection.status === 'missing_required_columns'
                    ? 'missing'
                    : 'provisional'
                }`}
              >
                <ShieldCheck size={22} style={{ color: 'var(--mint)', flexShrink: 0 }} />
                <div>
                  <strong>
                    {parserResult.detection.status === 'missing_required_columns'
                      ? 'Incomplete Statement Format'
                      : parserResult.detection.isVerified
                      ? 'Verified Statement Format'
                      : 'Provisional Format Parser'}
                  </strong>
                  <div>
                    {parserResult.detection.explanation || 'Detected statement export layout with standard transaction table.'} Interactive review operates 100% in local browser
                    memory without writing to your financial ledger.
                  </div>
                </div>
              </div>

              {/* Unmapped Masked Account Quick Resolution Banner */}
              {unresolvedMaskSummaries.length > 0 && (
                <div
                  className="recon-unmapped-banner"
                  style={{
                    background: 'rgba(99, 102, 241, 0.08)',
                    border: '1px solid rgba(99, 102, 241, 0.22)',
                    borderRadius: '16px',
                    padding: '14px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6366f1' }}>
                    <ShieldCheck size={18} style={{ flexShrink: 0 }} />
                    <strong style={{ fontSize: '0.88rem' }}>
                      Statement Account Auto-Linked ({unresolvedMaskSummaries.reduce((acc, m) => acc + m.count, 0)} transactions)
                    </strong>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.45 }}>
                    PhonePe masked bank accounts (e.g. <code>XXXX5200</code>) are automatically connected to your selected ledger account. You can switch the target account below at any time:
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginTop: '2px' }}>
                    {unresolvedMaskSummaries.map(({ mask, count }) => (
                      <div
                        key={mask}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: 'rgba(255, 255, 255, 0.7)',
                          padding: '6px 14px',
                          borderRadius: '10px',
                          border: '1px solid rgba(148, 163, 184, 0.25)',
                        }}
                      >
                        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                          Mask: <span style={{ fontFamily: 'monospace', color: '#6366f1' }}>{mask}</span> ({count} records) →
                        </span>
                        <select
                          className="recon-select"
                          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAssignAccountForMask(mask, e.target.value)
                            }
                          }}
                        >
                          <option value="" disabled>
                            Select owned account...
                          </option>
                          {ACCOUNT_OPTIONS.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.alias} ({acc.institution})
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary Stats Grid */}
              <div className="stats recon-stats-grid" id="stats">
                <div className="st recon-stat-card">
                  <span>Source Rows</span>
                  <b>{parserResult.statistics.totalRows}</b>
                </div>
                <div className="st recon-stat-card">
                  <span>Suggested Matches</span>
                  <b style={{ color: 'var(--amb)' }}>
                    {tabCounts.suggested_matches}
                  </b>
                </div>
                <div className="st recon-stat-card">
                  <span>Confirmed Links</span>
                  <b style={{ color: 'var(--mint)' }}>
                    {tabCounts.confirmed}
                  </b>
                </div>
                <div className="st recon-stat-card">
                  <span>Proposed New</span>
                  <b style={{ color: 'var(--pu)' }}>
                    {proposedSummary?.proposedNewEventsCount || 0}
                  </b>
                </div>
                <div className="st recon-stat-card">
                  <span>Proposed Expenses</span>
                  <b style={{ color: 'var(--cor)' }}>
                    {formatPaise(proposedSummary?.proposedExpensesPaise || 0)}
                  </b>
                </div>
                <div className="st recon-stat-card">
                  <span>Proposed Income</span>
                  <b style={{ color: 'var(--mint)' }}>
                    {formatPaise(proposedSummary?.proposedIncomePaise || 0)}
                  </b>
                </div>
              </div>

              {/* Extended Review Tabs Bar */}
              <div className="seg recon-tabs-bar" id="mtabs" style={{ justifySelf: 'start', maxWidth: '100%' }}>
                <button
                  className={`recon-tab-btn ${activeTab === 'all' ? 'on active' : ''}`}
                  onClick={() => setActiveTab('all')}
                >
                  All Records ({tabCounts.all})
                </button>
                {tabCounts.suggested_matches > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'suggested_matches' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('suggested_matches')}
                    style={{ color: 'var(--amb)' }}
                  >
                    Suggested Matches ({tabCounts.suggested_matches})
                  </button>
                )}
                {tabCounts.unmatched_bank > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'unmatched_bank' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('unmatched_bank')}
                  >
                    Bank Observations ({tabCounts.unmatched_bank})
                  </button>
                )}
                {tabCounts.unmatched_upi > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'unmatched_upi' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('unmatched_upi')}
                  >
                    UPI Observations ({tabCounts.unmatched_upi})
                  </button>
                )}
                {tabCounts.internal_transfers > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'internal_transfers' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('internal_transfers')}
                    style={{ color: 'var(--pu)' }}
                  >
                    <ArrowRightLeft size={13} /> Transfers ({tabCounts.internal_transfers})
                  </button>
                )}
                {tabCounts.conflicts > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'conflicts' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('conflicts')}
                    style={{ color: 'var(--cor)' }}
                  >
                    <AlertTriangle size={13} /> Conflicts ({tabCounts.conflicts})
                  </button>
                )}
                {tabCounts.confirmed > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'confirmed' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('confirmed')}
                    style={{ color: 'var(--mint)' }}
                  >
                    <Check size={13} /> Confirmed ({tabCounts.confirmed})
                  </button>
                )}
                <button
                  className={`recon-tab-btn ${activeTab === 'summary' ? 'on active' : ''}`}
                  onClick={() => setActiveTab('summary')}
                >
                  <Layers size={14} /> Proposed Import Summary
                </button>
                {parserResult.warnings.length > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'warnings' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('warnings')}
                    style={{ color: 'var(--amb)' }}
                  >
                    <Info size={14} /> Warnings ({parserResult.warnings.length})
                  </button>
                )}
                {parserResult.rejectedRows.length > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'rejected' ? 'on active' : ''}`}
                    onClick={() => setActiveTab('rejected')}
                    style={{ color: 'var(--cor)' }}
                  >
                    <XCircle size={14} /> Rejected Rows ({parserResult.rejectedRows.length})
                  </button>
                )}
              </div>

              {/* View 1: Record Review Table (all, matches, bank, upi, transfers, conflicts, confirmed) */}
              {activeTab !== 'summary' && activeTab !== 'rejected' && activeTab !== 'warnings' && (
                <>
                  {/* Quick Automation & Smart Filters Bar */}
                  <div className="auto recon-automation-bar">
                    <div className="chips recon-automation-chips" id="chips">
                      <span>Filter:</span>
                      <button
                        type="button"
                        className={`chip recon-chip ${quickFilter === 'all' ? 'on active' : ''}`}
                        onClick={() => setQuickFilter('all')}
                      >
                        All ({quickCounts.all})
                      </button>
                      <button
                        type="button"
                        className={`chip recon-chip ${quickFilter === 'debits' ? 'on active' : ''}`}
                        onClick={() => setQuickFilter('debits')}
                        style={{ color: quickFilter === 'debits' ? '#fff' : 'var(--cor)' }}
                      >
                        Debits ({quickCounts.debits})
                      </button>
                      <button
                        type="button"
                        className={`chip recon-chip ${quickFilter === 'credits' ? 'on active' : ''}`}
                        onClick={() => setQuickFilter('credits')}
                        style={{ color: quickFilter === 'credits' ? '#fff' : 'var(--mint)' }}
                      >
                        Credits ({quickCounts.credits})
                      </button>
                      <button
                        type="button"
                        className={`chip recon-chip ${quickFilter === 'ready' ? 'on active' : ''}`}
                        onClick={() => setQuickFilter('ready')}
                        style={{ color: quickFilter === 'ready' ? '#fff' : 'var(--pu)' }}
                      >
                        ✓ Ready ({quickCounts.ready})
                      </button>
                      {quickCounts.needs_review > 0 && (
                        <button
                          type="button"
                          className={`chip recon-chip ${quickFilter === 'needs_review' ? 'on active' : ''}`}
                          onClick={() => setQuickFilter('needs_review')}
                          style={{ color: quickFilter === 'needs_review' ? '#fff' : 'var(--amb)' }}
                        >
                          ⚠️ Needs Review ({quickCounts.needs_review})
                        </button>
                      )}
                    </div>

                    <button
                      className="btn p primary-button"
                      id="recon-approve-all-btn"
                      onClick={handleApproveAllNew}
                      title="Fast-track all valid records for 1-click import"
                    >
                      <Check size={16} /> Approve All Valid ({quickCounts.all})
                    </button>
                  </div>

                  {/* Filters and View Switcher Bar */}
                  <div className="fr recon-filter-row">
                    <label className="sr recon-search-box">
                      <Search size={16} />
                      <input
                        id="rq"
                        type="text"
                        placeholder="Search description, merchant, reference..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button
                          className="ib action-btn"
                          type="button"
                          onClick={() => setSearchQuery('')}
                          style={{ width: '18px', height: '18px', border: 0, background: 'transparent', cursor: 'pointer' }}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </label>

                    <select
                      id="rdir"
                      className="recon-select"
                      data-opt="dir"
                      value={directionFilter === 'debit' ? 'debits' : directionFilter === 'credit' ? 'credits' : directionFilter}
                      onChange={(e) => setDirectionFilter(e.target.value as any)}
                    >
                      <option value="all">All Directions</option>
                      <option value="debits">Debits Only</option>
                      <option value="credits">Credits Only</option>
                    </select>

                    <div className="seg recon-view-switcher" id="views">
                      <button
                        type="button"
                        className={viewMode === 'cards' ? 'on active' : ''}
                        data-v="cards"
                        onClick={() => setViewMode('cards')}
                        title="Card Grid view"
                      >
                        <LayoutGrid size={14} /> Cards
                      </button>
                      <button
                        type="button"
                        className={viewMode === 'slide' ? 'on active' : ''}
                        data-v="deck"
                        onClick={() => setViewMode('slide')}
                        title="Interactive Slide Deck view"
                      >
                        <Layers size={14} /> Slide Deck
                      </button>
                      <button
                        type="button"
                        className={viewMode === 'table' ? 'on active' : ''}
                        data-v="table"
                        onClick={() => setViewMode('table')}
                        title="Spreadsheet Table view"
                      >
                        <Table2 size={14} /> Table
                      </button>
                    </div>
                  </div>

                  {/* Mode 1: Cards View */}
                  {viewMode === 'cards' && (
                    <div className="feed recon-card-feed">
                      {filteredRecords.length === 0 ? (
                        <div className="empty" style={{ textAlign: 'center', padding: '36px', color: 'var(--mu, #94a3b8)', gridColumn: '1 / -1' }}>
                          <h3>No matching records</h3>
                          <p>Try a different search or filter.</p>
                        </div>
                      ) : (
                        filteredRecords.map((rec, idx) => {
                          const decision = userDecisions.get(rec.id)
                          const state = decision?.state || 'unreviewed'
                          const isDebit = rec.direction === 'debit'
                          const isModified = modifiedRecordIds.has(rec.id)

                          return (
                            <div key={rec.id} className="tc recon-tx-card" data-i={idx}>
                              {/* Header: Date + Provider & Mask + Ref */}
                              <div className="t1 recon-tx-card-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <b>
                                    {rec.parsedDate
                                      ? new Date(rec.parsedDate).toLocaleDateString('en-IN', {
                                          day: '2-digit',
                                          month: 'short',
                                          year: 'numeric',
                                        })
                                      : rec.rawDateText}
                                  </b>
                                  <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                                    {rec.sourceProvider}
                                  </span>
                                  {rec.maskedAccountId && (
                                    <span className="ref">
                                      {rec.maskedAccountId}
                                    </span>
                                  )}
                                </div>
                                <span className="ref">
                                  {rec.normalizedReference || rec.originalReference || 'Ref —'}
                                </span>
                              </div>

                              {/* Amount & Direction Row */}
                              <div className="t2 recon-tx-card-amount-row">
                                <div className={`am ${isDebit ? 'db debit' : 'cr credit'}`}>
                                  {formatSignedPaise(rec.amountPaise, rec.direction)}
                                </div>
                                <span className={`dir ${rec.direction} recon-dir-badge`}>
                                  {rec.direction}
                                </span>
                              </div>

                              {/* Merchant / Description */}
                              <div className="mer recon-tx-card-merchant">
                                {rec.counterparty || rec.cleanDescription}
                              </div>

                              {/* Interactive Selectors */}
                              <div className="ctl recon-tx-card-controls">
                                <select
                                  data-k="acc"
                                  className="recon-mini-select recon-account-select"
                                  data-testid="recon-row-account-select"
                                  value={decision?.assignedAccountId || (rec.sourceAccountId.startsWith('unmapped:') ? '' : rec.sourceAccountId)}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setModifiedRecordIds((prev) => new Set(prev).add(rec.id))
                                    if (val) {
                                      if (rec.maskedAccountId) {
                                        handleAssignAccountForMask(rec.maskedAccountId, val)
                                      } else {
                                        handleAssignAccountForRecord(rec.id, val)
                                      }
                                    }
                                  }}
                                  style={{
                                    border: (!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:'))
                                      ? '1px solid #ef4444'
                                      : undefined,
                                  }}
                                >
                                  {(!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:')) && (
                                    <option value="">⚠️ Select Account</option>
                                  )}
                                  {ACCOUNT_OPTIONS.map((opt) => (
                                    <option key={opt.id} value={opt.id}>{opt.alias}</option>
                                  ))}
                                </select>

                                <select
                                  data-k="type"
                                  className="recon-mini-select recon-type-select"
                                  data-testid="recon-type-select"
                                  value={decision?.proposedType || rec.proposedType}
                                  onChange={(e) => {
                                    setModifiedRecordIds((prev) => new Set(prev).add(rec.id))
                                    handleChangeClassification(rec.id, e.target.value as any)
                                  }}
                                >
                                  <option value="expense">Expense</option>
                                  <option value="income">Income</option>
                                  <option value="transfer">Transfer</option>
                                  <option value="refund">Refund</option>
                                  <option value="reversal">Reversal</option>
                                  <option value="needs_review">Needs Review</option>
                                </select>

                                <select
                                  data-k="cat"
                                  className="recon-mini-select recon-category-select"
                                  data-testid="recon-category-select"
                                  value={decision?.proposedCategory || rec.proposedCategory || 'Other'}
                                  onChange={(e) => {
                                    setModifiedRecordIds((prev) => new Set(prev).add(rec.id))
                                    const cat = categories.find((c) => c.name === e.target.value)
                                    handleChangeCategory(rec.id, e.target.value, cat?.id)
                                  }}
                                >
                                  {categories.map((c) => (
                                    <option key={c.id} value={c.name}>{c.name}</option>
                                  ))}
                                  <option value="Other">Other</option>
                                </select>
                              </div>

                              {/* Footer: State badge + Action Buttons */}
                              <div className="t4 recon-tx-card-footer">
                                <span className={`ok ${isModified ? 'm' : ''}`}>
                                  <CheckCircle2 size={14} />
                                  {isModified
                                    ? 'Modified · Ready to Import'
                                    : state === 'suggested_match'
                                    ? 'Suggested Match'
                                    : 'Ready to Import'}
                                </span>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  {state === 'suggested_match' && (
                                    <>
                                      <button className="recon-action-btn confirm" onClick={() => handleConfirmMatch(rec.id)}>Confirm</button>
                                      <button className="recon-action-btn reject" onClick={() => handleRejectMatch(rec.id)}>Separate</button>
                                    </>
                                  )}
                                  {(state === 'confirmed_match' || state === 'rejected_match') && (
                                    <button className="recon-action-btn reset" onClick={() => handleResetDecision(rec.id)}>Reset</button>
                                  )}
                                  {(state === 'unmatched' || state === 'ready_for_import' || state === 'classification_required') && (
                                    <>
                                      {state !== 'ready_for_import' ? (
                                        <button className="recon-action-btn confirm" onClick={() => handleApproveRecord(rec.id)}>
                                          <Check size={13} /> Approve
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '0.74rem', color: '#10b981', fontWeight: 700 }}>
                                          ✓ Ready
                                        </span>
                                      )}
                                    </>
                                  )}
                                  <button
                                    className="mod"
                                    data-a="modify"
                                    onClick={() => {
                                      setModifiedRecordIds((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(rec.id)) next.delete(rec.id)
                                        else next.add(rec.id)
                                        return next
                                      })
                                      handleMarkReview(rec.id)
                                    }}
                                  >
                                    Modify
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}

                  {/* Mode 2: Interactive Slide Deck View */}
                  {viewMode === 'slide' && (
                    <div className="deck recon-slide-deck">
                      {filteredRecords.length === 0 ? (
                        <div className="empty" style={{ textAlign: 'center', padding: '48px', color: 'var(--mu, #94a3b8)' }}>
                          <h3>No matching records</h3>
                          <p>Try a different search or filter.</p>
                        </div>
                      ) : (() => {
                        const safeIdx = Math.min(slideIndex, Math.max(0, filteredRecords.length - 1))
                        const rec = filteredRecords[safeIdx] || filteredRecords[0]
                        const decision = userDecisions.get(rec.id)
                        const state = decision?.state || 'unreviewed'
                        const isDebit = rec.direction === 'debit'
                        const isModified = modifiedRecordIds.has(rec.id)
                        const pct = Math.round(((safeIdx + 1) / filteredRecords.length) * 100)

                        return (
                          <>
                            {/* Slide Progress Meter */}
                            <div className="recon-slide-progress" style={{ width: '100%', maxWidth: '540px' }}>
                              <div className="recon-slide-progress-header">
                                <span>
                                  Transaction <strong>{safeIdx + 1}</strong> of <strong>{filteredRecords.length}</strong>
                                </span>
                                <span style={{ color: 'var(--pu)', fontWeight: 700 }}>
                                  {pct}% Processed
                                </span>
                              </div>
                              <div className="recon-slide-progress-bar-bg">
                                <div className="recon-slide-progress-bar-fill" style={{ width: `${pct}%` }} />
                              </div>
                            </div>

                            {/* Centered Liquid Glass Big Card */}
                            <div
                              className="tc big recon-tx-card recon-slide-card"
                              onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
                              onTouchEnd={(e) => {
                                if (touchStartX === null) return
                                const diff = e.changedTouches[0].clientX - touchStartX
                                if (diff > 50 && safeIdx > 0) {
                                  setSlideIndex(safeIdx - 1)
                                } else if (diff < -50 && safeIdx < filteredRecords.length - 1) {
                                  setSlideIndex(safeIdx + 1)
                                }
                                setTouchStartX(null)
                              }}
                            >
                              {/* Header */}
                              <div className="t1 recon-tx-card-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <b>
                                    {rec.parsedDate
                                      ? new Date(rec.parsedDate).toLocaleDateString('en-IN', {
                                          day: '2-digit',
                                          month: 'short',
                                          year: 'numeric',
                                        })
                                      : rec.rawDateText}
                                  </b>
                                  <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                                    {rec.sourceProvider}
                                  </span>
                                  {rec.maskedAccountId && (
                                    <span className="ref">
                                      {rec.maskedAccountId}
                                    </span>
                                  )}
                                </div>
                                <span className="ref">
                                  {rec.normalizedReference || rec.originalReference || 'Ref —'}
                                </span>
                              </div>

                              {/* Amount Display Hero */}
                              <div className="t2 recon-tx-card-amount-row" style={{ flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px 0' }}>
                                <div className={`am ${isDebit ? 'db debit' : 'cr credit'}`} style={{ fontSize: '38px', fontWeight: 800 }}>
                                  {formatSignedPaise(rec.amountPaise, rec.direction)}
                                </div>
                                <span className={`dir ${rec.direction} recon-dir-badge`}>
                                  {rec.direction}
                                </span>
                              </div>

                              {/* Merchant Title */}
                              <div className="mer recon-tx-card-merchant" style={{ textAlign: 'center', fontSize: '1.05rem', fontWeight: 700 }}>
                                {rec.counterparty || rec.cleanDescription}
                              </div>
                              {rec.counterparty && rec.cleanDescription !== rec.counterparty && (
                                <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--mu)', marginTop: '-8px' }}>
                                  {rec.cleanDescription}
                                </div>
                              )}

                              {/* Controls */}
                              <div className="ctl recon-tx-card-controls">
                                <select
                                  data-k="acc"
                                  className="recon-mini-select recon-account-select"
                                  data-testid="recon-row-account-select"
                                  value={decision?.assignedAccountId || (rec.sourceAccountId.startsWith('unmapped:') ? '' : rec.sourceAccountId)}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setModifiedRecordIds((prev) => new Set(prev).add(rec.id))
                                    if (val) {
                                      if (rec.maskedAccountId) {
                                        handleAssignAccountForMask(rec.maskedAccountId, val)
                                      } else {
                                        handleAssignAccountForRecord(rec.id, val)
                                      }
                                    }
                                  }}
                                  style={{
                                    border: (!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:'))
                                      ? '1px solid #ef4444'
                                      : undefined,
                                  }}
                                >
                                  {(!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:')) && (
                                    <option value="">⚠️ Select Account</option>
                                  )}
                                  {ACCOUNT_OPTIONS.map((opt) => (
                                    <option key={opt.id} value={opt.id}>{opt.alias}</option>
                                  ))}
                                </select>

                                <select
                                  data-k="type"
                                  className="recon-mini-select recon-type-select"
                                  data-testid="recon-type-select"
                                  value={decision?.proposedType || rec.proposedType}
                                  onChange={(e) => {
                                    setModifiedRecordIds((prev) => new Set(prev).add(rec.id))
                                    handleChangeClassification(rec.id, e.target.value as any)
                                  }}
                                >
                                  <option value="expense">Expense</option>
                                  <option value="income">Income</option>
                                  <option value="transfer">Transfer</option>
                                  <option value="refund">Refund</option>
                                  <option value="reversal">Reversal</option>
                                  <option value="needs_review">Needs Review</option>
                                </select>

                                <select
                                  data-k="cat"
                                  className="recon-mini-select recon-category-select"
                                  data-testid="recon-category-select"
                                  value={decision?.proposedCategory || rec.proposedCategory || 'Other'}
                                  onChange={(e) => {
                                    setModifiedRecordIds((prev) => new Set(prev).add(rec.id))
                                    const cat = categories.find((c) => c.name === e.target.value)
                                    handleChangeCategory(rec.id, e.target.value, cat?.id)
                                  }}
                                >
                                  {categories.map((c) => (
                                    <option key={c.id} value={c.name}>{c.name}</option>
                                  ))}
                                  <option value="Other">Other</option>
                                </select>
                              </div>

                              {/* Footer */}
                              <div className="t4 recon-tx-card-footer">
                                <span className={`ok ${isModified ? 'm' : ''}`}>
                                  <CheckCircle2 size={14} />
                                  {isModified
                                    ? 'Modified · Ready to Import'
                                    : state === 'suggested_match'
                                    ? 'Suggested Match'
                                    : 'Ready to Import'}
                                </span>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  {state === 'suggested_match' ? (
                                    <>
                                      <button className="recon-action-btn confirm" onClick={() => handleConfirmMatch(rec.id)}>
                                        Confirm
                                      </button>
                                      <button className="recon-action-btn reject" onClick={() => handleRejectMatch(rec.id)}>
                                        Separate
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        className="btn p primary-button"
                                        style={{ padding: '6px 14px', borderRadius: '10px', fontSize: '0.8rem' }}
                                        onClick={() => {
                                          handleApproveRecord(rec.id)
                                          if (safeIdx < filteredRecords.length - 1) {
                                            setSlideIndex(safeIdx + 1)
                                          }
                                        }}
                                      >
                                        <Check size={14} /> {state === 'ready_for_import' ? 'Approved (Next →)' : 'Approve & Next →'}
                                      </button>
                                    </>
                                  )}
                                  <button
                                    className="mod"
                                    data-a="modify"
                                    onClick={() => {
                                      setModifiedRecordIds((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(rec.id)) next.delete(rec.id)
                                        else next.add(rec.id)
                                        return next
                                      })
                                      handleMarkReview(rec.id)
                                    }}
                                  >
                                    Modify
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Deck Navigation Controls */}
                            <div className="dn">
                              <button
                                className="ib outline-button"
                                data-a="prev"
                                aria-label="Previous"
                                onClick={() => setSlideIndex((prev) => Math.max(0, prev - 1))}
                                disabled={safeIdx === 0}
                              >
                                <ArrowLeft size={16} />
                              </button>
                              <span>
                                {safeIdx + 1} / {filteredRecords.length}
                              </span>
                              <button
                                className="ib outline-button"
                                data-a="next"
                                aria-label="Next"
                                onClick={() => setSlideIndex((prev) => Math.min(filteredRecords.length - 1, prev + 1))}
                                disabled={safeIdx === filteredRecords.length - 1}
                              >
                                <ChevronRight size={16} />
                              </button>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  )}

                  {/* Mode 3: Spreadsheet Table View */}
                  {viewMode === 'table' && (
                    <div className="tw recon-table-wrapper">
                      <table className="recon-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Provider</th>
                            <th>Account</th>
                            <th>Reference</th>
                            <th>Merchant</th>
                            <th>Direction</th>
                            <th style={{ textAlign: 'right' }}>Amount</th>
                            <th>Type</th>
                            <th>Category</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRecords.length === 0 ? (
                            <tr>
                              <td
                                colSpan={10}
                                style={{
                                  textAlign: 'center',
                                  padding: '32px',
                                  color: 'var(--muted, #94a3b8)',
                                }}
                              >
                                No records match the current view and filter selection.
                              </td>
                            </tr>
                          ) : (
                            filteredRecords.map((rec) => {
                              const decision = userDecisions.get(rec.id)
                              const state = decision?.state || 'unreviewed'
                              const isExpanded = expandedRowId === rec.id
                              const matchedLedgerTx = decision?.matchedLedgerTxId
                                ? existingTransactions.find((t) => t.id === decision.matchedLedgerTxId)
                                : undefined
                              const isModified = modifiedRecordIds.has(rec.id)

                              return (
                                <Fragment key={rec.id}>
                                  <tr
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => setExpandedRowId(isExpanded ? null : rec.id)}
                                  >
                                    <td style={{ whiteSpace: 'nowrap' }}>
                                      {rec.parsedDate
                                        ? new Date(rec.parsedDate).toLocaleDateString('en-IN', {
                                            day: '2-digit',
                                            month: 'short',
                                            year: 'numeric',
                                          })
                                        : rec.rawDateText}
                                    </td>
                                    <td style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                                      {rec.sourceProvider}
                                    </td>
                                    <td className="mono" onClick={(e) => e.stopPropagation()}>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        {rec.maskedAccountId && (
                                          <span
                                            className="ref"
                                            style={{
                                              fontSize: '0.68rem',
                                              alignSelf: 'flex-start',
                                            }}
                                            title={`Masked Account: ${rec.maskedAccountId}`}
                                          >
                                            {rec.maskedAccountId}
                                          </span>
                                        )}
                                        <select
                                          className="recon-mini-select recon-account-select"
                                          data-testid="recon-row-account-select"
                                          data-k="acc"
                                          value={decision?.assignedAccountId || (rec.sourceAccountId.startsWith('unmapped:') ? '' : rec.sourceAccountId)}
                                          onChange={(e) => {
                                            const val = e.target.value
                                            if (val) {
                                              if (rec.maskedAccountId) {
                                                handleAssignAccountForMask(rec.maskedAccountId, val)
                                              } else {
                                                handleAssignAccountForRecord(rec.id, val)
                                              }
                                            }
                                          }}
                                          style={{
                                            fontSize: '0.74rem',
                                            padding: '3px 6px',
                                            borderRadius: '8px',
                                            border: (!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:'))
                                              ? '1px solid #ef4444'
                                              : undefined,
                                            maxWidth: '140px',
                                          }}
                                        >
                                          {(!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:')) && (
                                            <option value="">⚠️ Select Account</option>
                                          )}
                                          {ACCOUNT_OPTIONS.map((opt) => (
                                            <option key={opt.id} value={opt.id}>
                                              {opt.alias}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    </td>
                                    <td className="mono">
                                      <span className="ref">
                                        {rec.normalizedReference || rec.originalReference || '—'}
                                      </span>
                                    </td>
                                    <td style={{ textTransform: 'capitalize' }}>
                                      <b style={{ display: 'block', color: 'var(--text, #f8fafc)' }}>
                                        {rec.counterparty || rec.cleanDescription}
                                      </b>
                                      {rec.counterparty && rec.cleanDescription !== rec.counterparty && (
                                        <small style={{ fontSize: '0.72rem', color: 'var(--muted, #64748b)' }}>
                                          {rec.cleanDescription}
                                        </small>
                                      )}
                                    </td>
                                    <td>
                                      <span className={`dir ${rec.direction}`}>
                                        {rec.direction}
                                      </span>
                                    </td>
                                    <td
                                      style={{
                                        textAlign: 'right',
                                        fontWeight: 800,
                                        fontSize: '0.92rem',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      <span className={`am ${rec.direction === 'debit' ? 'db' : 'cr'}`}>
                                        {formatSignedPaise(rec.amountPaise, rec.direction)}
                                      </span>
                                    </td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <select
                                        className="recon-mini-select recon-type-select"
                                        data-testid="recon-type-select"
                                        data-k="type"
                                        value={decision?.proposedType || rec.proposedType}
                                        onChange={(e) =>
                                          handleChangeClassification(rec.id, e.target.value as any)
                                        }
                                      >
                                        <option value="expense">Expense</option>
                                        <option value="income">Income</option>
                                        <option value="transfer">Transfer</option>
                                        <option value="refund">Refund</option>
                                        <option value="reversal">Reversal / Failed</option>
                                        <option value="needs_review">Needs Review</option>
                                      </select>
                                    </td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <select
                                        className="recon-mini-select recon-category-select"
                                        data-testid="recon-category-select"
                                        data-k="cat"
                                        value={decision?.proposedCategory || rec.proposedCategory || 'Other'}
                                        onChange={(e) => {
                                          const cat = categories.find((c) => c.name === e.target.value)
                                          handleChangeCategory(rec.id, e.target.value, cat?.id)
                                        }}
                                      >
                                        {categories.map((c) => (
                                          <option key={c.id} value={c.name}>
                                            {c.name}
                                          </option>
                                        ))}
                                        <option value="Other">Other</option>
                                      </select>
                                    </td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                        {state === 'suggested_match' ? (
                                          <>
                                            <button
                                              className="recon-action-btn confirm"
                                              onClick={() => handleConfirmMatch(rec.id)}
                                              title="Confirm match link"
                                            >
                                              Confirm
                                            </button>
                                            <button
                                              className="recon-action-btn reject"
                                              onClick={() => handleRejectMatch(rec.id)}
                                              title="Separate record"
                                            >
                                              Separate
                                            </button>
                                          </>
                                        ) : state === 'conflicting' ? (
                                          <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' }}>
                                            Conflict
                                          </span>
                                        ) : (
                                          <>
                                            <span className={`ok ${isModified ? 'm' : ''}`}>
                                              <Check size={12} /> {isModified ? 'Modified · Ready' : 'Ready'}
                                            </span>
                                            <button
                                              className="mod"
                                              data-a="modify"
                                              onClick={() => handleMarkReview(rec.id)}
                                              title="Modify record"
                                            >
                                              Modify
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr className="recon-expanded-row">
                                      <td
                                        colSpan={10}
                                        style={{
                                          background: 'rgba(255, 255, 255, 0.02)',
                                          padding: '12px 18px',
                                          fontSize: '0.78rem',
                                          color: 'var(--muted, #94a3b8)',
                                        }}
                                      >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                          <div>
                                            <strong>Raw Narration:</strong> {rec.rawDescription}
                                          </div>
                                          {rec.balanceAfterPaise !== undefined && (
                                            <div>
                                              <strong>Closing Balance:</strong> {formatPaise(rec.balanceAfterPaise)}
                                            </div>
                                          )}
                                          {decision?.decisionReason && (
                                            <div>
                                              <strong>Decision Reasoning:</strong> {decision.decisionReason}
                                            </div>
                                          )}
                                          {matchedLedgerTx && (
                                            <div style={{ color: '#6366f1' }}>
                                              <strong>Matched Ledger Tx:</strong> "{matchedLedgerTx.description}" ({formatPaise(matchedLedgerTx.amount)}, {matchedLedgerTx.type})
                                            </div>
                                          )}
                                          {decision?.conflicts && decision.conflicts.length > 0 && (
                                            <div style={{ color: '#ef4444' }}>
                                              <strong>Conflicts:</strong> {decision.conflicts.join(', ')}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {/* View 2: Proposed Import Summary Tab */}
              {activeTab === 'summary' && proposedSummary && (
                <div className="pn recon-summary-panel">
                  <div className="recon-summary-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <Sparkles size={20} style={{ color: 'var(--accent, #6366f1)' }} />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                        Proposed Import Summary
                      </h3>
                      <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--muted, #94a3b8)' }}>
                        {parserResult.records.length} new records · {parserResult.statistics.debitCount} debits totalling {formatPaise(proposedSummary.proposedExpensesPaise)} · {parserResult.statistics.creditCount} credits totalling {formatPaise(proposedSummary.proposedIncomePaise)}. Net {formatSignedPaise(Math.abs(proposedSummary.proposedIncomePaise - proposedSummary.proposedExpensesPaise), proposedSummary.proposedIncomePaise >= proposedSummary.proposedExpensesPaise ? 'credit' : 'debit')}.
                      </p>
                    </div>
                  </div>

                  <div className="recon-summary-grid">
                    <div className="recon-summary-card">
                      <span className="recon-stat-label">Total Observations</span>
                      <span className="recon-summary-val">
                        {proposedSummary.totalSourceObservations}
                      </span>
                    </div>
                    <div className="recon-summary-card">
                      <span className="recon-stat-label">Confirmed Links</span>
                      <span className="recon-summary-val" style={{ color: '#34d399' }}>
                        {proposedSummary.confirmedLinksCount}
                      </span>
                    </div>
                    <div className="recon-summary-card">
                      <span className="recon-stat-label">Duplicates Awaiting Review</span>
                      <span className="recon-summary-val" style={{ color: '#fbbf24' }}>
                        {proposedSummary.potentialDuplicatesRequiringReview}
                      </span>
                    </div>
                    <div className="recon-summary-card">
                      <span className="recon-stat-label">Conflicting Records</span>
                      <span className="recon-summary-val" style={{ color: '#f87171' }}>
                        {proposedSummary.conflictingCount}
                      </span>
                    </div>
                    <div className="recon-summary-card">
                      <span className="recon-stat-label">Unresolved Classifications</span>
                      <span className="recon-summary-val" style={{ color: '#f59e0b' }}>
                        {proposedSummary.unresolvedClassificationCount}
                      </span>
                    </div>
                    {(proposedSummary.unresolvedAccountMappingCount ?? 0) > 0 && (
                      <div className="recon-summary-card">
                        <span className="recon-stat-label">Unresolved Accounts</span>
                        <span className="recon-summary-val" style={{ color: '#ef4444' }}>
                          {proposedSummary.unresolvedAccountMappingCount}
                        </span>
                      </div>
                    )}
                    <div className="recon-summary-card">
                      <span className="recon-stat-label">Proposed New Events</span>
                      <span className="recon-summary-val" style={{ color: '#818cf8' }}>
                        {proposedSummary.proposedNewEventsCount}
                      </span>
                    </div>
                  </div>

                  <div className="recon-summary-totals">
                    {parserResult && (
                      <div className="recon-summary-row">
                        <span>Statement Date Range</span>
                        <strong style={{ color: '#818cf8' }}>
                          {(() => {
                            const validDates = parserResult.records
                              .map((r) => r.parsedDate)
                              .filter((d): d is string => Boolean(d))
                              .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
                            if (validDates.length === 0) return 'Undetected'
                            const startStr = new Date(validDates[0]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                            const endStr = new Date(validDates[validDates.length - 1]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                            return `${startStr} – ${endStr}`
                          })()}
                        </strong>
                      </div>
                    )}
                    <div className="recon-summary-row">
                      <span>Proposed Expenses</span>
                      <strong className="debit">{formatPaise(proposedSummary.proposedExpensesPaise)}</strong>
                    </div>
                    <div className="recon-summary-row">
                      <span>Proposed Income</span>
                      <strong className="credit">{formatPaise(proposedSummary.proposedIncomePaise)}</strong>
                    </div>
                    <div className="recon-summary-row">
                      <span>Internal Transfers (Excluded from Net)</span>
                      <strong>{formatPaise(proposedSummary.proposedTransfersPaise)}</strong>
                    </div>
                    <div className="recon-summary-row">
                      <span>Refunds & Adjustments (Non-Income)</span>
                      <strong>{formatPaise(proposedSummary.proposedRefundsPaise)}</strong>
                    </div>
                    <div className="recon-summary-row">
                      <span>Rejected Statement Rows</span>
                      <strong style={{ color: '#ef4444' }}>
                        {proposedSummary.rejectedSourceRowsCount}
                      </strong>
                    </div>
                  </div>

                  {/* Accounting Safeguard Banner */}
                  <div
                    style={{
                      background: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      fontSize: '0.8rem',
                      lineHeight: '1.5',
                      color: 'var(--muted, #94a3b8)',
                    }}
                  >
                    <strong style={{ color: 'var(--text, #f8fafc)', display: 'block', marginBottom: '4px' }}>
                      Strict Read-Only Verification Guarantee:
                    </strong>
                    All totals shown above are draft projections simulated in component memory. Zero records
                    have been committed to your financial ledger. No balances or dashboard summaries have been
                    modified.
                  </div>
                </div>
              )}

              {/* View 3: Rejected Rows */}
              {activeTab === 'rejected' && (
                <div className="tw recon-table-wrapper">
                  <table className="recon-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Row #</th>
                        <th>Raw Line Snippet</th>
                        <th>Rejection Diagnostic Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parserResult.rejectedRows.map((err, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 700, color: '#f87171' }}>{err.rowIndex}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            {err.rawRow.join(', ')}
                          </td>
                          <td style={{ color: '#f87171' }}>{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* View 4: Warnings */}
              {activeTab === 'warnings' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="pn w">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <Info size={16} />
                      <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
                        {parserResult.warnings.length} {parserResult.warnings.length === 1 ? 'warning' : 'warnings'}
                      </h3>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted, #94a3b8)' }}>
                      The parser flagged {parserResult.warnings.length} {parserResult.warnings.length === 1 ? 'row' : 'rows'}. Review before importing. Nothing is written to your ledger until you confirm.
                    </p>
                  </div>
                  {parserResult.warnings.map((warn, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 14px',
                        background: 'rgba(245, 158, 11, 0.1)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        color: '#fbbf24',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <Info size={16} />
                      {warn}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mf recon-modal-footer">
          {committedBatch ? (
            <>
              <div className="fn recon-footer-notice">
                <ShieldCheck size={16} style={{ color: '#10b981' }} />
                <span>
                  Batch ID: <code style={{ color: '#38bdf8' }}>{committedBatch.id}</code> · Workspace:{' '}
                  {isDemoMode ? 'Demo' : 'Live'}
                </span>
              </div>
              <div className="fa recon-footer-actions">
                <button
                  className="btn p primary-button"
                  id="recon-audit-done-btn"
                  onClick={() => {
                    handleDiscard()
                    onClose()
                  }}
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className="fn recon-footer-notice"
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck
                    size={16}
                    style={{ color: batchEligibility?.isBatchEligible ? '#10b981' : '#f59e0b' }}
                  />
                  <strong id="fn1">
                    {isDemoMode ? 'Demo Workspace' : 'Live Workspace'} ·{' '}
                    {parserResult
                      ? `${batchEligibility?.toCreateCount ?? 0} to import · ${
                          batchEligibility?.toSkipDuplicateCount ?? 0
                        } duplicates to skip · ${batchEligibility?.transferCount ?? 0} transfers`
                      : 'No file uploaded'}
                  </strong>
                </div>
                {parserResult && (
                  <span
                    style={{
                      color: batchEligibility?.isBatchEligible ? 'var(--muted, #94a3b8)' : '#f87171',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '650px',
                    }}
                    title={batchEligibility?.isBatchEligible ? '' : Array.from(new Set(batchEligibility?.rejectionReasons.map((r) => r.reason) || [])).join('\n')}
                  >
                    {batchEligibility?.isBatchEligible
                      ? 'Ledger will be modified only after you confirm.'
                      : `⚠️ ${batchEligibility?.unresolvedCount} item(s) require review: ${Array.from(new Set(batchEligibility?.rejectionReasons.map((r) => r.reason) || [])).slice(0, 2).join(' · ')}${(new Set(batchEligibility?.rejectionReasons.map((r) => r.reason) || [])).size > 2 ? ' ...' : ''}`}
                  </span>
                )}
              </div>
              <div className="fa recon-footer-actions">
                {parserResult && (
                  <button
                    className="btn o outline-button"
                    id="recon-discard-draft-btn"
                    data-a="disc"
                    onClick={handleDiscard}
                    disabled={isCommitting}
                  >
                    <RotateCcw size={14} /> Discard draft
                  </button>
                )}
                {parserResult && (
                  <button
                    className="btn p primary-button"
                    id="recon-commit-import-btn"
                    data-a="commit"
                    onClick={handleCommitImport}
                    disabled={
                      isCommitting ||
                      !batchEligibility?.isBatchEligible ||
                      ((batchEligibility?.toCreateCount ?? 0) === 0 &&
                        (batchEligibility?.toSkipDuplicateCount ?? 0) === 0 &&
                        (batchEligibility?.transferCount ?? 0) === 0)
                    }
                  >
                    {isCommitting ? 'Importing...' : 'Import approved transactions'}
                  </button>
                )}
                <button
                  className="btn o outline-button"
                  data-a="close"
                  onClick={onClose}
                  disabled={isCommitting}
                >
                  Close review
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
