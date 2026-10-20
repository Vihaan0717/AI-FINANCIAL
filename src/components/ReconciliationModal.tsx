import { useState, useRef, useMemo, useEffect, type ChangeEvent, type DragEvent } from 'react'
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
  const [directionFilter, setDirectionFilter] = useState<'all' | 'debit' | 'credit'>('all')
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

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
  }, [parserResult, activeTab, directionFilter, searchQuery, userDecisions])

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

      // Generate initial in-memory reconciliation decisions
      const initialDecisions = createInitialReconciliationDecisions(
        result.records,
        existingTransactions,
        OWNED_ACCOUNTS_MAP
      )

      setParserResult(result)
      setUserDecisions(initialDecisions)
      setActiveTab('all')
      notify(
        `Parsed ${result.records.length} records (${result.statistics.debitCount} debits, ${result.statistics.creditCount} credits)`
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
        const cat = dec.proposedCategory
        if (
          (dec.state === 'unmatched' || dec.state === 'ready_for_import') &&
          cat &&
          cat.trim() !== '' &&
          cat !== 'Other' &&
          cat !== 'Uncategorized'
        ) {
          updated.set(id, {
            ...dec,
            state: 'ready_for_import',
            isConfirmed: true,
            userAction: 'approve_new',
            decisionReason: 'Batch approved by user for ledger import.',
            updatedAt: new Date().toISOString(),
          })
          count++
        }
      }
      notify(`Approved ${count} eligible new event(s).`)
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
      className="recon-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="recon-title"
    >
      <div className="recon-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="recon-modal-header">
          <div className="recon-header-title">
            <FileSpreadsheet size={22} style={{ color: 'var(--accent, #6366f1)' }} />
            <h2 id="recon-title">Statement Import & Interactive Reconciliation</h2>
            <span className={`recon-scope-badge ${isDemoMode ? 'demo' : 'live'}`}>
              {isDemoMode ? 'Demo Workspace' : 'Live Workspace'}
            </span>
          </div>
          <button className="action-btn" onClick={onClose} aria-label="Close modal" title="Close modal">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="recon-modal-body">
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
              <div className="recon-controls-row">
                <div className="recon-control-group">
                  <label htmlFor="recon-provider-select">Source Provider / Format</label>
              <select
                id="recon-provider-select"
                className="recon-select"
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
            </div>

            <div className="recon-control-group">
              <label htmlFor="recon-account-select">Target Owned Account Alias</label>
              <select
                id="recon-account-select"
                className="recon-select"
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
            </div>
          </div>

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
              <div className="recon-file-pill">
                <div className="recon-file-info">
                  <FileSpreadsheet size={20} style={{ color: 'var(--accent, #6366f1)' }} />
                  <div>
                    <div className="recon-file-name">{selectedFile.name}</div>
                    <div className="recon-file-size">
                      {(selectedFile.size / 1024).toFixed(1)} KB · {parserResult.detection.formatId || 'CSV'}
                    </div>
                  </div>
                </div>
                <button
                  className="action-btn"
                  onClick={handleDiscard}
                  title="Discard and upload another file"
                >
                  <RotateCcw size={15} />
                </button>
              </div>

              {/* Provisional / Verification Banner */}
              <div
                className={`recon-format-banner ${
                  parserResult.detection.isVerified
                    ? 'verified'
                    : parserResult.detection.status === 'missing_required_columns'
                    ? 'missing'
                    : 'provisional'
                }`}
              >
                {parserResult.detection.isVerified ? (
                  <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                ) : (
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                )}
                <div>
                  <strong>
                    {parserResult.detection.status === 'missing_required_columns'
                      ? 'Incomplete Statement Format'
                      : parserResult.detection.isVerified
                      ? 'Verified Statement Format'
                      : 'Provisional Format Parser'}
                  </strong>
                  <div>
                    {parserResult.detection.explanation} Interactive review operates 100% in local browser
                    memory without writing to your financial ledger.
                  </div>
                </div>
              </div>

              {/* Summary Stats Grid */}
              <div className="recon-stats-grid">
                <div className="recon-stat-card">
                  <span className="recon-stat-label">Source Rows</span>
                  <span className="recon-stat-value">{parserResult.statistics.totalRows}</span>
                </div>
                <div className="recon-stat-card">
                  <span className="recon-stat-label">Suggested Matches</span>
                  <span className="recon-stat-value" style={{ color: '#fbbf24' }}>
                    {tabCounts.suggested_matches}
                  </span>
                </div>
                <div className="recon-stat-card">
                  <span className="recon-stat-label">Confirmed Links</span>
                  <span className="recon-stat-value" style={{ color: '#34d399' }}>
                    {tabCounts.confirmed}
                  </span>
                </div>
                <div className="recon-stat-card">
                  <span className="recon-stat-label">Proposed New</span>
                  <span className="recon-stat-value" style={{ color: '#818cf8' }}>
                    {proposedSummary?.proposedNewEventsCount || 0}
                  </span>
                </div>
                <div className="recon-stat-card">
                  <span className="recon-stat-label">Proposed Expenses</span>
                  <span className="recon-stat-value debit">
                    {formatPaise(proposedSummary?.proposedExpensesPaise || 0)}
                  </span>
                </div>
                <div className="recon-stat-card">
                  <span className="recon-stat-label">Proposed Income</span>
                  <span className="recon-stat-value credit">
                    {formatPaise(proposedSummary?.proposedIncomePaise || 0)}
                  </span>
                </div>
              </div>

              {/* Extended Review Tabs Bar */}
              <div className="recon-tabs-bar">
                <button
                  className={`recon-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveTab('all')}
                >
                  All Records ({tabCounts.all})
                </button>
                {tabCounts.suggested_matches > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'suggested_matches' ? 'active' : ''}`}
                    onClick={() => setActiveTab('suggested_matches')}
                    style={{ color: '#fbbf24' }}
                  >
                    Suggested Matches ({tabCounts.suggested_matches})
                  </button>
                )}
                {tabCounts.unmatched_bank > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'unmatched_bank' ? 'active' : ''}`}
                    onClick={() => setActiveTab('unmatched_bank')}
                  >
                    Bank Observations ({tabCounts.unmatched_bank})
                  </button>
                )}
                {tabCounts.unmatched_upi > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'unmatched_upi' ? 'active' : ''}`}
                    onClick={() => setActiveTab('unmatched_upi')}
                  >
                    UPI Observations ({tabCounts.unmatched_upi})
                  </button>
                )}
                {tabCounts.internal_transfers > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'internal_transfers' ? 'active' : ''}`}
                    onClick={() => setActiveTab('internal_transfers')}
                    style={{ color: '#c084fc' }}
                  >
                    <ArrowRightLeft size={13} /> Transfers ({tabCounts.internal_transfers})
                  </button>
                )}
                {tabCounts.conflicts > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'conflicts' ? 'active' : ''}`}
                    onClick={() => setActiveTab('conflicts')}
                    style={{ color: '#f87171' }}
                  >
                    <AlertTriangle size={13} /> Conflicts ({tabCounts.conflicts})
                  </button>
                )}
                {tabCounts.confirmed > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'confirmed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('confirmed')}
                    style={{ color: '#34d399' }}
                  >
                    <Check size={13} /> Confirmed ({tabCounts.confirmed})
                  </button>
                )}
                <button
                  className={`recon-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
                  onClick={() => setActiveTab('summary')}
                >
                  <Sparkles size={13} /> Proposed Import Summary
                </button>
                {parserResult.rejectedRows.length > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'rejected' ? 'active' : ''}`}
                    onClick={() => setActiveTab('rejected')}
                    style={{ color: '#f87171' }}
                  >
                    <XCircle size={13} /> Rejected Rows ({parserResult.rejectedRows.length})
                  </button>
                )}
                {parserResult.warnings.length > 0 && (
                  <button
                    className={`recon-tab-btn ${activeTab === 'warnings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('warnings')}
                  >
                    <Info size={13} /> Warnings ({parserResult.warnings.length})
                  </button>
                )}
              </div>

              {/* View 1: Record Review Table (all, matches, bank, upi, transfers, conflicts, confirmed) */}
              {activeTab !== 'summary' && activeTab !== 'rejected' && activeTab !== 'warnings' && (
                <>
                  {/* Filters and Search Bar */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'var(--bg, #0f172a)',
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border, #334155)',
                        flex: 1,
                        minWidth: '180px',
                      }}
                    >
                      <Search size={14} style={{ color: 'var(--muted, #94a3b8)' }} />
                      <input
                        type="text"
                        placeholder="Search description, merchant, reference..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                          border: 0,
                          outline: 'none',
                          background: 'transparent',
                          color: 'var(--text, #f8fafc)',
                          fontSize: '0.82rem',
                          width: '100%',
                        }}
                      />
                      {searchQuery && (
                        <button
                          className="action-btn"
                          onClick={() => setSearchQuery('')}
                          style={{ width: '18px', height: '18px' }}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    <select
                      className="recon-select"
                      value={directionFilter}
                      onChange={(e) => setDirectionFilter(e.target.value as any)}
                    >
                      <option value="all">All Directions</option>
                      <option value="debit">Debits Only</option>
                      <option value="credit">Credits Only</option>
                    </select>

                    <button
                      className="outline-button"
                      id="recon-approve-all-btn"
                      onClick={handleApproveAllNew}
                      style={{ fontSize: '0.78rem', padding: '5px 10px', height: '32px' }}
                      title="Approve all classified new records for import"
                    >
                      <Check size={14} style={{ color: '#10b981' }} /> Approve All Valid
                    </button>
                  </div>

                  {/* Table */}
                  <div className="recon-table-wrapper">
                    <table className="recon-table">
                      <thead>
                        <tr>
                          <th style={{ width: '38px' }}>#</th>
                          <th>Date</th>
                          <th>Source & Account</th>
                          <th>Description & Merchant</th>
                          <th>Direction</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th>Reference</th>
                          <th>Reconciliation State</th>
                          <th>Classification & Category</th>
                          <th style={{ textAlign: 'right' }}>Review Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.length === 0 ? (
                          <tr>
                            <td
                              colSpan={10}
                              style={{
                                textAlign: 'center',
                                padding: '24px',
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

                            return (
                              <tr
                                key={rec.id}
                                style={{ cursor: 'pointer' }}
                                onClick={() => setExpandedRowId(isExpanded ? null : rec.id)}
                              >
                                <td>{rec.originalRowIndex || '—'}</td>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  {rec.parsedDate
                                    ? new Date(rec.parsedDate).toLocaleDateString('en-IN', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                      })
                                    : rec.rawDateText}
                                </td>
                                <td style={{ fontSize: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                                    <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>
                                      {rec.sourceProvider}
                                    </span>
                                    {rec.maskedAccountId && (
                                      <span
                                        style={{
                                          fontSize: '0.68rem',
                                          background: 'rgba(99, 102, 241, 0.15)',
                                          color: '#818cf8',
                                          padding: '1px 5px',
                                          borderRadius: '4px',
                                          fontFamily: 'monospace',
                                        }}
                                        title={`Masked Account: ${rec.maskedAccountId}`}
                                      >
                                        {rec.maskedAccountId}
                                      </span>
                                    )}
                                  </div>
                                  <select
                                    className="recon-mini-select recon-account-select"
                                    data-testid="recon-row-account-select"
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
                                      fontSize: '0.72rem',
                                      padding: '2px 4px',
                                      borderRadius: '4px',
                                      border: (!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:'))
                                        ? '1px solid #f87171'
                                        : '1px solid var(--border, #334155)',
                                      color: (!decision?.assignedAccountId && rec.sourceAccountId.startsWith('unmapped:'))
                                        ? '#f87171'
                                        : 'var(--text, #f8fafc)',
                                      background: 'var(--bg, #0f172a)',
                                      width: '100%',
                                      maxWidth: '150px',
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
                                </td>
                                <td>
                                  <div style={{ fontWeight: 600 }}>
                                    {rec.counterparty || rec.cleanDescription}
                                  </div>
                                  {rec.counterparty && rec.cleanDescription !== rec.counterparty && (
                                    <div
                                      style={{ fontSize: '0.72rem', color: 'var(--muted, #94a3b8)' }}
                                    >
                                      {rec.cleanDescription}
                                    </div>
                                  )}
                                  {isExpanded && (
                                    <div
                                      style={{
                                        marginTop: '6px',
                                        fontSize: '0.72rem',
                                        color: 'var(--muted, #94a3b8)',
                                        borderTop: '1px dashed var(--border, #334155)',
                                        paddingTop: '4px',
                                      }}
                                    >
                                      <div>
                                        <strong>Raw Narration:</strong> {rec.rawDescription}
                                      </div>
                                      {rec.balanceAfterPaise !== undefined && (
                                        <div>
                                          <strong>Closing Balance:</strong>{' '}
                                          {formatPaise(rec.balanceAfterPaise)}
                                        </div>
                                      )}
                                      <div>
                                        <strong>Decision Reasoning:</strong> {decision?.decisionReason}
                                      </div>
                                      {matchedLedgerTx && (
                                        <div style={{ color: '#818cf8', marginTop: '2px' }}>
                                          <strong>Matched Ledger Tx:</strong> "{matchedLedgerTx.description}"
                                          ({formatPaise(matchedLedgerTx.amount)}, {matchedLedgerTx.type})
                                        </div>
                                      )}
                                      {decision?.conflicts && decision.conflicts.length > 0 && (
                                        <div style={{ color: '#f87171', marginTop: '2px' }}>
                                          <strong>Conflicts:</strong> {decision.conflicts.join(', ')}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <span className={`recon-dir-badge ${rec.direction}`}>
                                    {rec.direction}
                                  </span>
                                </td>
                                <td
                                  style={{
                                    textAlign: 'right',
                                    fontWeight: 700,
                                    color: rec.direction === 'debit' ? '#f87171' : '#34d399',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatPaise(rec.amountPaise, { showSign: true })}
                                </td>
                                <td style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                                  {rec.normalizedReference || rec.originalReference || '—'}
                                </td>
                                <td>
                                  {state === 'suggested_match' && (
                                    <span className="recon-decision-badge suggested">
                                      <HelpCircle size={12} /> Suggested Match
                                    </span>
                                  )}
                                  {state === 'confirmed_match' && (
                                    <span className="recon-decision-badge confirmed">
                                      <CheckCircle2 size={12} /> Confirmed Link
                                    </span>
                                  )}
                                  {state === 'rejected_match' && (
                                    <span className="recon-decision-badge rejected">
                                      <Check size={12} /> Keep Separate
                                    </span>
                                  )}
                                  {state === 'conflicting' && (
                                    <span className="recon-decision-badge conflicting">
                                      <AlertTriangle size={12} /> Conflict
                                    </span>
                                  )}
                                  {state === 'classification_required' && (
                                    <span className="recon-decision-badge needs_review">
                                      <Info size={12} /> Needs Review
                                    </span>
                                  )}
                                  {(state === 'unmatched' || state === 'ready_for_import') && (
                                    <span className="recon-decision-badge unmatched">
                                      New Event
                                    </span>
                                  )}
                                </td>
                                <td onClick={(e) => e.stopPropagation()}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <select
                                      className="recon-mini-select recon-type-select"
                                      data-testid="recon-type-select"
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
                                    <select
                                      className="recon-mini-select recon-category-select"
                                      data-testid="recon-category-select"
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
                                  </div>
                                </td>
                                <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                  <div
                                    style={{
                                      display: 'flex',
                                      gap: '4px',
                                      justifyContent: 'flex-end',
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    {state === 'suggested_match' && (
                                      <>
                                        <button
                                          className="recon-action-btn confirm"
                                          onClick={() => handleConfirmMatch(rec.id)}
                                          title="Confirm match/duplicate link"
                                        >
                                          Confirm
                                        </button>
                                        <button
                                          className="recon-action-btn reject"
                                          onClick={() => handleRejectMatch(rec.id)}
                                          title="Reject match: import as independent transaction"
                                        >
                                          Separate
                                        </button>
                                        <button
                                          className="recon-action-btn review"
                                          onClick={() => handleMarkReview(rec.id)}
                                          title="Mark for classification review"
                                        >
                                          Review
                                        </button>
                                      </>
                                    )}
                                    {(state === 'confirmed_match' || state === 'rejected_match') && (
                                      <button
                                        className="recon-action-btn reset"
                                        onClick={() => handleResetDecision(rec.id)}
                                        title="Reset user decision"
                                      >
                                        Reset
                                      </button>
                                    )}
                                    {state === 'conflicting' && (
                                      <button
                                        className="recon-action-btn review"
                                        onClick={() => handleMarkReview(rec.id)}
                                        title="Examine conflict"
                                      >
                                        Examine
                                      </button>
                                    )}
                                    {(state === 'unmatched' || state === 'ready_for_import') && (
                                      <>
                                        {state === 'unmatched' && (
                                          <button
                                            className="recon-action-btn confirm"
                                            onClick={() => handleApproveRecord(rec.id)}
                                            title="Approve record to import as new financial transaction"
                                          >
                                            Approve
                                          </button>
                                        )}
                                        <button
                                          className="recon-action-btn review"
                                          onClick={() => handleMarkReview(rec.id)}
                                          title="Modify classification"
                                        >
                                          Modify
                                        </button>
                                      </>
                                    )}
                                    {state === 'classification_required' && (
                                      <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>
                                        Select category
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* View 2: Proposed Import Summary Tab */}
              {activeTab === 'summary' && proposedSummary && (
                <div className="recon-summary-panel">
                  <div className="recon-summary-header">
                    <Sparkles size={20} style={{ color: 'var(--accent, #6366f1)' }} />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                        In-Memory Proposed Import Summary
                      </h3>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted, #94a3b8)' }}>
                        Projected financial impact if staged draft decisions are committed in Stage 8.5.
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
                <div className="recon-table-wrapper">
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
        <div className="recon-modal-footer">
          {committedBatch ? (
            <>
              <div className="recon-footer-notice">
                <ShieldCheck size={16} style={{ color: '#10b981' }} />
                <span>
                  Batch ID: <code style={{ color: '#38bdf8' }}>{committedBatch.id}</code> · Workspace:{' '}
                  {isDemoMode ? 'Demo' : 'Live'}
                </span>
              </div>
              <div className="recon-footer-actions">
                <button
                  className="primary-button"
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
                className="recon-footer-notice"
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck
                    size={16}
                    style={{ color: batchEligibility?.isBatchEligible ? '#10b981' : '#f59e0b' }}
                  />
                  <strong>
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
              <div className="recon-footer-actions">
                {parserResult && (
                  <button className="outline-button" onClick={handleDiscard} disabled={isCommitting}>
                    <RotateCcw size={14} /> Discard draft
                  </button>
                )}
                {parserResult && (
                  <button
                    className="primary-button"
                    id="recon-commit-import-btn"
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
                <button className="outline-button" onClick={onClose} disabled={isCommitting}>
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
