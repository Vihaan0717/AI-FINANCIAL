import { useState, useRef, type ChangeEvent } from 'react'
import {
  X,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  CreditCard,
  PackageCheck,
  RotateCcw,
} from 'lucide-react'
import type { ReceiptExtractionDraft } from '../types/receipt'
import type { Transaction, DuplicateCheckResult, PaymentMethod, TransactionStatus } from '../types/transaction'
import type { InventoryItem, InventoryCategory, InventoryUnit } from '../types/inventory'
import { SUPPORTED_UNITS } from '../utils/units'
import { ClientReceiptExtractor } from '../services/aiExtractor'
import { formatPaise, validateAmount } from '../utils/money'

export interface ConfirmedReceiptItemUpdate {
  name: string
  quantity: number
  unit: InventoryUnit
  category: InventoryCategory
  unitPricePaise: number
  existingItemId?: string
}

export interface ConfirmedReceiptInventory {
  receiptId: string
  confirmedItems: ConfirmedReceiptItemUpdate[]
}

export interface EditableReceiptLineItem {
  id: string
  selected: boolean
  name: string
  quantity: number
  unit: InventoryUnit
  category: InventoryCategory
  unitPricePaise: number
  existingItemId?: string
  isAmbiguous: boolean
}

interface ReceiptCaptureModalProps {
  isOpen: boolean
  onClose: () => void
  onSaveTransaction: (
    data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>,
    inventoryUpdates?: ConfirmedReceiptInventory
  ) => Promise<void>
  checkDuplicate: (candidate: {
    amount: number
    type: string
    date: string
    merchant?: string
    description?: string
    externalRef?: string
  }) => DuplicateCheckResult
  existingInventory?: InventoryItem[]
  hasReceiptInventoryUpdate?: (receiptId: string) => Promise<boolean>
}

const extractor = new ClientReceiptExtractor()

export function ReceiptCaptureModal({
  isOpen,
  onClose,
  onSaveTransaction,
  checkDuplicate,
  existingInventory = [],
  hasReceiptInventoryUpdate,
}: ReceiptCaptureModalProps) {
  const [draft, setDraft] = useState<ReceiptExtractionDraft | null>(null)
  const [isExtracting, setIsExtracting] = useState<boolean>(false)
  const [amountRupees, setAmountRupees] = useState<string>('')
  const [merchant, setMerchant] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [category, setCategory] = useState<string>('Groceries')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI')
  const [status, setStatus] = useState<TransactionStatus>('completed')
  const [externalRef, setExternalRef] = useState<string>('')
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [ocrProgress, setOcrProgress] = useState<{ progress: number; status: string } | null>(null)
  const [showRawText, setShowRawText] = useState<boolean>(false)
  const [inventoryLines, setInventoryLines] = useState<EditableReceiptLineItem[]>([])
  const [updateInventoryOnSave, setUpdateInventoryOnSave] = useState<boolean>(true)
  const [isAlreadyInventoryUpdated, setIsAlreadyInventoryUpdated] = useState<boolean>(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const handleProcessDraft = async (extracted: ReceiptExtractionDraft) => {
    setDraft(extracted)
    setAmountRupees((extracted.totalAmountPaise / 100).toFixed(2))
    setMerchant(extracted.merchant)
    setDescription(extracted.description)
    setCategory(extracted.category)
    setPaymentMethod(extracted.paymentMethod)
    setStatus(extracted.status)
    setExternalRef(extracted.externalRef || '')

    // Check persistent idempotency store: was inventory already applied for this receipt?
    if (hasReceiptInventoryUpdate) {
      try {
        const applied = await hasReceiptInventoryUpdate(extracted.id)
        setIsAlreadyInventoryUpdated(applied)
      } catch {
        setIsAlreadyInventoryUpdated(false)
      }
    } else {
      setIsAlreadyInventoryUpdated(false)
    }

    // Populate interactive line items if receipt is itemized
    if (extracted.items && extracted.items.length > 0) {
      const lines: EditableReceiptLineItem[] = extracted.items.map((it) => {
        const match = existingInventory.find(
          (ex) => ex.name.toLowerCase().trim() === it.name.toLowerCase().trim()
        )
        const isUnclear = !it.name || it.name.trim().length < 3 || it.quantity <= 0 || it.confidence === 'low'
        return {
          id: it.id,
          selected: true,
          name: it.name,
          quantity: it.quantity,
          unit: (it.unit as InventoryUnit) || 'pcs',
          category: (it.suggestedInventoryCategory as InventoryCategory) || 'Household essentials',
          unitPricePaise: it.unitPricePaise,
          existingItemId: match ? match.id : undefined,
          isAmbiguous: !!isUnclear,
        }
      })
      setInventoryLines(lines)
      setUpdateInventoryOnSave(true)
    } else {
      setInventoryLines([])
      setUpdateInventoryOnSave(false)
    }

    // Real-time duplicate check
    const dupCheck = checkDuplicate({
      amount: extracted.totalAmountPaise,
      type: 'expense',
      date: extracted.date,
      merchant: extracted.merchant,
      description: extracted.description,
      externalRef: extracted.externalRef,
    })
    setDuplicateWarning(dupCheck.isDuplicate ? dupCheck : null)
    setErrorMessage(null)
  }

  const handleFileUpload = async (file: File) => {
    setIsExtracting(true)
    setOcrProgress({ progress: 0.1, status: 'Initializing OCR WebAssembly worker...' })
    setErrorMessage(null)
    try {
      const result = await extractor.extractFromImage(file, (progress, status) => {
        setOcrProgress({ progress, status })
      })
      if (result.success && result.draft) {
        await handleProcessDraft(result.draft)
      } else {
        setErrorMessage(result.error || 'Failed to extract receipt information')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error extracting receipt')
    } finally {
      setIsExtracting(false)
      setOcrProgress(null)
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0])
    }
  }

  // Quick Preset Handlers for seamless demonstration
  const handleLoadSampleUpi = () => {
    setIsExtracting(true)
    setTimeout(async () => {
      const sample = extractor.createUpiPaymentDraft(undefined, 'coffee')
      await handleProcessDraft(sample)
      setIsExtracting(false)
    }, 300)
  }

  const handleLoadSampleReceipt = () => {
    setIsExtracting(true)
    setTimeout(async () => {
      const sample = extractor.createItemizedReceiptDraft()
      await handleProcessDraft(sample)
      setIsExtracting(false)
    }, 300)
  }

  const handleLoadSampleFailed = () => {
    setIsExtracting(true)
    setTimeout(async () => {
      const sample = extractor.createFailedPaymentDraft()
      await handleProcessDraft(sample)
      setIsExtracting(false)
    }, 300)
  }

  const handleConfirmAndSave = async (bypassDuplicate = false) => {
    const valResult = validateAmount(amountRupees)
    if (!valResult.valid) {
      setErrorMessage(valResult.error || 'Please enter a valid amount')
      return
    }

    if (!description.trim()) {
      setErrorMessage('Please provide a description')
      return
    }

    if (!bypassDuplicate && duplicateWarning) {
      return
    }

    // Build confirmed inventory payload with idempotency key
    const confirmedInventoryPayload: ConfirmedReceiptInventory | undefined =
      updateInventoryOnSave && !isAlreadyInventoryUpdated && inventoryLines.some((l) => l.selected)
        ? {
            receiptId: draft ? draft.id : `rcpt_${Date.now()}`,
            confirmedItems: inventoryLines
              .filter((l) => l.selected)
              .map((l) => ({
                name: l.name.trim(),
                quantity: l.quantity,
                unit: l.unit,
                category: l.category,
                unitPricePaise: l.unitPricePaise,
                existingItemId: l.existingItemId,
              })),
          }
        : undefined

    setIsSubmitting(true)
    try {
      await onSaveTransaction(
        {
          type: 'expense',
          amount: valResult.paise,
          currency: 'INR',
          date: draft ? draft.date : new Date().toISOString(),
          description: description.trim(),
          merchant: merchant.trim() || undefined,
          category,
          paymentMethod,
          status,
          externalRef: externalRef.trim() || undefined,
          notes: draft?.items
            ? `Extracted from receipt: ${draft.items.map((i) => `${i.name} (x${i.quantity})`).join(', ')}`
            : 'Extracted via AI screenshot recognition',
          source: draft?.docType === 'payment_screenshot' ? 'screenshot' : 'receipt',
        },
        confirmedInventoryPayload
      )

      handleReset()
      onClose()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save transaction')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setDraft(null)
    setAmountRupees('')
    setMerchant('')
    setDescription('')
    setInventoryLines([])
    setUpdateInventoryOnSave(true)
    setIsAlreadyInventoryUpdated(false)
    setDuplicateWarning(null)
    setErrorMessage(null)
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title">
      <div className="modal" style={{ width: 'min(100%, 540px)', maxHeight: '90vh', overflowY: 'auto' }}>
        <header>
          <div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Sparkles size={12} color="var(--bright)" />
              AI CAPTURE ENGINE
            </span>
            <h2 id="receipt-modal-title">Extract Receipt or Payment</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </header>

        {errorMessage && (
          <div
            style={{
              marginTop: '12px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(248, 113, 113, 0.16)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              color: '#fca5a5',
              fontSize: '11px',
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* STEP 1: UPLOAD OR SELECT PRESET */}
        {!draft && (
          <div style={{ marginTop: '16px' }}>
            {/* Drop Zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed var(--line)',
                borderRadius: '16px',
                padding: '36px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'var(--deep)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--purple)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: '48px',
                  height: '48px',
                  borderRadius: '14px',
                  background: 'var(--hover)',
                  margin: '0 auto 12px',
                  color: 'var(--bright)',
                }}
              >
                <Upload size={22} />
              </div>
              <strong style={{ display: 'block', fontSize: '13px', color: 'var(--text)' }}>
                {isExtracting ? 'Analyzing image with AI...' : 'Drop payment screenshot or bill here'}
              </strong>
              <span style={{ display: 'block', marginTop: '6px', fontSize: '11px', color: 'var(--muted)' }}>
                Supports UPI payment receipts (GPay, PhonePe, Paytm) & Supermarket bills (PNG, JPG)
              </span>
            </div>

            {/* OCR Live Progress Indicator */}
            {isExtracting && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'var(--deep)',
                  border: '1px solid var(--line)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    marginBottom: '8px',
                    color: 'var(--text)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sparkles size={14} color="var(--mint)" />
                    {ocrProgress?.status || 'Scanning image pixels with WebAssembly OCR...'}
                  </span>
                  <b>{Math.round((ocrProgress?.progress || 0.1) * 100)}%</b>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '999px',
                    background: 'var(--hover)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round((ocrProgress?.progress || 0.1) * 100)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #7d72ea, #65e6c7)',
                      transition: 'width 0.25s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Quick Presets */}
            <div style={{ marginTop: '20px' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: '9px',
                  fontWeight: 800,
                  letterSpacing: '1px',
                  color: 'var(--muted)',
                  marginBottom: '8px',
                }}
              >
                TRY WITH PRE-BUILT SAMPLES
              </span>

              <div style={{ display: 'grid', gap: '8px' }}>
                <button
                  type="button"
                  className="outline-button"
                  style={{ justifyContent: 'flex-start', padding: '12px 14px', minHeight: 'auto', borderRadius: '10px' }}
                  onClick={handleLoadSampleUpi}
                  disabled={isExtracting}
                >
                  <CreditCard size={18} style={{ color: 'var(--mint)', marginRight: '8px' }} />
                  <div style={{ textAlign: 'left' }}>
                    <b style={{ display: 'block', fontSize: '12px', color: 'var(--text)' }}>
                      UPI Payment Screenshot (₹150.00)
                    </b>
                    <small style={{ color: 'var(--muted)', fontSize: '10px' }}>
                      GPay coffee purchase with merchant & reference UTR
                    </small>
                  </div>
                </button>

                <button
                  type="button"
                  className="outline-button"
                  style={{ justifyContent: 'flex-start', padding: '12px 14px', minHeight: 'auto', borderRadius: '10px' }}
                  onClick={handleLoadSampleReceipt}
                  disabled={isExtracting}
                >
                  <Receipt size={18} style={{ color: 'var(--bright)', marginRight: '8px' }} />
                  <div style={{ textAlign: 'left' }}>
                    <b style={{ display: 'block', fontSize: '12px', color: 'var(--text)' }}>
                      Supermarket Itemized Bill (₹270.00)
                    </b>
                    <small style={{ color: 'var(--muted)', fontSize: '10px' }}>
                      Soap (₹60) + Detergent (₹120) + Toothpaste (₹90) $\rightarrow$ 1 single transaction
                    </small>
                  </div>
                </button>

                <button
                  type="button"
                  className="outline-button"
                  style={{ justifyContent: 'flex-start', padding: '12px 14px', minHeight: 'auto', borderRadius: '10px' }}
                  onClick={handleLoadSampleFailed}
                  disabled={isExtracting}
                >
                  <AlertTriangle size={18} style={{ color: '#f87171', marginRight: '8px' }} />
                  <div style={{ textAlign: 'left' }}>
                    <b style={{ display: 'block', fontSize: '12px', color: 'var(--text)' }}>
                      Declined / Failed Transaction (₹500.00)
                    </b>
                    <small style={{ color: 'var(--muted)', fontSize: '10px' }}>
                      Correctly detects failed status without contaminating confirmed balances
                    </small>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: REVIEW & CONFIRM DRAFT */}
        {draft && (
          <div style={{ marginTop: '16px' }}>
            {/* Confidence Banner */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={16} color="var(--mint)" />
                <span style={{ fontSize: '11px', color: 'var(--text)' }}>
                  Extracted via <b>{draft.docType === 'itemized_receipt' ? 'Supermarket OCR' : 'UPI Vision'}</b>
                </span>
              </div>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  color: 'var(--mint)',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: 'rgba(71, 217, 178, 0.15)',
                }}
              >
                {Math.round(draft.confidenceScore * 100)}% Match
              </span>
            </div>

            {/* Warnings banner */}
            {draft.warnings.length > 0 && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(246, 185, 77, 0.14)',
                  border: '1px solid rgba(246, 185, 77, 0.35)',
                  color: 'var(--orange)',
                  fontSize: '11px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}>
                  <AlertTriangle size={15} />
                  <span>Review Note</span>
                </div>
                <p style={{ margin: '4px 0 0', color: 'var(--text2)' }}>{draft.warnings[0]}</p>
              </div>
            )}

            {/* Duplicate detection warning */}
            {duplicateWarning && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(255, 170, 0, 0.14)',
                  border: '1px solid rgba(255, 170, 0, 0.4)',
                  color: '#ffb36a',
                  fontSize: '11px',
                  lineHeight: 1.5,
                  marginBottom: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}>
                  <AlertTriangle size={16} />
                  <span>Potential Duplicate Detected</span>
                </div>
                <p style={{ margin: '6px 0 10px', color: 'var(--text2)' }}>{duplicateWarning.reason}</p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="outline-button"
                    style={{ minHeight: '26px', fontSize: '10px' }}
                    onClick={() => setDuplicateWarning(null)}
                  >
                    Dismiss Warning
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    style={{
                      minHeight: '26px',
                      fontSize: '10px',
                      background: 'linear-gradient(135deg, #f6b94d, #ea9628)',
                    }}
                    onClick={() => handleConfirmAndSave(true)}
                    disabled={isSubmitting}
                  >
                    Save anyway
                  </button>
                </div>
              </div>
            )}

            {/* Editable Form for Extracted Fields */}
            <div style={{ display: 'grid', gap: '12px' }}>
              <label>
                Total Amount (INR)
                <div>
                  <span>₹</span>
                  <input
                    type="number"
                    step="0.01"
                    value={amountRupees}
                    onChange={(e) => setAmountRupees(e.target.value)}
                    required
                  />
                </div>
              </label>

              <div className="form-grid">
                <label>
                  Merchant / Payee
                  <input value={merchant} onChange={(e) => setMerchant(e.target.value)} required />
                </label>

                <label>
                  Category
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="Groceries">Groceries</option>
                    <option value="Food & dining">Food & dining</option>
                    <option value="Shopping">Shopping</option>
                    <option value="Home">Home</option>
                    <option value="Transport">Transport</option>
                    <option value="Utilities">Utilities</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
              </div>

              <div className="form-grid">
                <label>
                  Payment Method
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="Bank transfer">Bank transfer</option>
                    <option value="Cash">Cash</option>
                  </select>
                </label>

                <label>
                  Status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TransactionStatus)}
                  >
                    <option value="completed">Completed (Confirmed)</option>
                    <option value="pending">Pending (Unsettled)</option>
                    <option value="failed">Failed (Excluded)</option>
                  </select>
                </label>
              </div>

              <label>
                Description
                <input value={description} onChange={(e) => setDescription(e.target.value)} required />
              </label>

              {externalRef && (
                <label>
                  Reference / UTR
                  <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
                </label>
              )}
            </div>

            {/* STEP 2: Itemized Receipt to Inventory Bridge */}
            {inventoryLines.length > 0 && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'var(--deep)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <b style={{ fontSize: '11px', color: 'var(--bright)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <PackageCheck size={14} />
                    Personal Inventory Bridge ({inventoryLines.length} items detected)
                  </b>
                  <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                    Receipt total: {formatPaise(draft?.totalAmountPaise || 0)}
                  </span>
                </div>

                {isAlreadyInventoryUpdated ? (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: 'rgba(99, 102, 241, 0.12)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      color: '#a5b4fc',
                      fontSize: '11px',
                      marginBottom: '10px',
                    }}
                  >
                    ⚡ <b>Idempotency Protection:</b> Inventory updates for this receipt were already confirmed previously.
                    Re-saving will record the transaction without duplicating stock additions.
                  </div>
                ) : (
                  <>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '11px',
                        color: 'var(--text)',
                        marginBottom: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={updateInventoryOnSave}
                        onChange={(e) => setUpdateInventoryOnSave(e.target.checked)}
                      />
                      <b>Update personal inventory with selected items below on save</b>
                    </label>

                    {updateInventoryOnSave && (
                      <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
                        {inventoryLines.map((line, idx) => (
                          <div
                            key={line.id}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              background: line.selected ? 'var(--hover)' : 'var(--panel)',
                              border: line.selected ? '1px solid var(--purple)' : '1px solid var(--line)',
                              opacity: line.selected ? 1 : 0.6,
                              fontSize: '11px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={line.selected}
                                  onChange={(e) => {
                                    const next = [...inventoryLines]
                                    next[idx].selected = e.target.checked
                                    setInventoryLines(next)
                                  }}
                                />
                                <strong style={{ color: 'var(--text)' }}>
                                  {line.selected ? 'Include in Inventory' : 'Skipped (Do not add)'}
                                </strong>
                              </label>

                              {line.isAmbiguous && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    background: 'rgba(245, 158, 11, 0.15)',
                                    color: '#fbbf24',
                                  }}
                                >
                                  ⚠️ Unclear OCR read — please verify
                                </span>
                              )}
                            </div>

                            {line.selected && (
                              <div style={{ display: 'grid', gap: '6px', marginTop: '6px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '6px' }}>
                                  <input
                                    type="text"
                                    value={line.name}
                                    onChange={(e) => {
                                      const next = [...inventoryLines]
                                      next[idx].name = e.target.value
                                      setInventoryLines(next)
                                    }}
                                    placeholder="Product name"
                                    style={{ fontSize: '11px', padding: '6px 8px' }}
                                  />
                                  <input
                                    type="number"
                                    step="any"
                                    min="0.01"
                                    value={line.quantity}
                                    onChange={(e) => {
                                      const next = [...inventoryLines]
                                      next[idx].quantity = parseFloat(e.target.value) || 0
                                      setInventoryLines(next)
                                    }}
                                    placeholder="Qty"
                                    style={{ fontSize: '11px', padding: '6px 8px' }}
                                  />
                                  <select
                                    value={line.unit}
                                    onChange={(e) => {
                                      const next = [...inventoryLines]
                                      next[idx].unit = e.target.value as InventoryUnit
                                      setInventoryLines(next)
                                    }}
                                    style={{ fontSize: '11px', padding: '6px 8px' }}
                                  >
                                    {SUPPORTED_UNITS.map((u) => (
                                      <option key={u} value={u}>
                                        {u}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                  <select
                                    value={line.category}
                                    onChange={(e) => {
                                      const next = [...inventoryLines]
                                      next[idx].category = e.target.value as InventoryCategory
                                      setInventoryLines(next)
                                    }}
                                    style={{ fontSize: '11px', padding: '6px 8px' }}
                                  >
                                    <option value="Clothing">Clothing</option>
                                    <option value="Household essentials">Household essentials</option>
                                    <option value="Food and pantry">Food and pantry</option>
                                    <option value="Personal care and other essentials">Personal care</option>
                                  </select>

                                  <select
                                    value={line.existingItemId || ''}
                                    onChange={(e) => {
                                      const next = [...inventoryLines]
                                      next[idx].existingItemId = e.target.value ? e.target.value : undefined
                                      setInventoryLines(next)
                                    }}
                                    style={{ fontSize: '11px', padding: '6px 8px' }}
                                  >
                                    <option value="">+ Create as new item</option>
                                    {existingInventory.map((inv) => (
                                      <option key={inv.id} value={inv.id}>
                                        Restock: {inv.name} ({inv.quantity} {inv.unit})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <p
                  style={{
                    margin: '10px 0 0',
                    fontSize: '10px',
                    color: 'var(--mint)',
                    lineHeight: 1.5,
                  }}
                >
                  ✓ <b>Accounting Guarantee:</b> Creates exactly <b>1 financial transaction</b> of {formatPaise(draft?.totalAmountPaise || 0)}.
                  Never inflates expenses or creates duplicate financial transactions when inventory is updated.
                </p>
              </div>
            )}

            {/* View Raw OCR Text Toggle */}
            <div style={{ marginTop: '12px' }}>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: '10px' }}
                onClick={() => setShowRawText((prev) => !prev)}
              >
                {showRawText ? '▲ Hide raw extracted text' : '▼ View raw extracted text'}
              </button>
              {showRawText && (
                <pre
                  style={{
                    marginTop: '6px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'var(--deep)',
                    border: '1px solid var(--line)',
                    fontSize: '10px',
                    color: 'var(--muted)',
                    maxHeight: '110px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                  }}
                >
                  {draft.rawText || draft.description || 'No raw text attached to this extraction.'}
                </pre>
              )}
            </div>

            {/* Actions */}
            <footer style={{ marginTop: '20px' }}>
              <button type="button" className="outline-button" onClick={handleReset} disabled={isSubmitting}>
                <RotateCcw size={14} /> Try another image
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => handleConfirmAndSave(false)}
                disabled={isSubmitting}
              >
                <CheckCircle2 size={16} />
                {isSubmitting ? 'Recording...' : 'Confirm & Save Transaction'}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}
