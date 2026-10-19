import type { PaymentMethod, TransactionStatus } from './transaction'

import type { InventoryUnit, InventoryCategory } from './inventory'

export interface ExtractedReceiptItem {
  id: string
  name: string
  quantity: number
  unit?: InventoryUnit
  unitPricePaise: number
  totalPricePaise: number
  category?: string
  suggestedInventoryCategory?: InventoryCategory | 'Clothing' | 'Essentials' | 'Home' | 'Other'
  confidence?: 'high' | 'medium' | 'low'
  isAmbiguous?: boolean
  selectedForInventory?: boolean
  matchedInventoryItemId?: string
}

export interface ReceiptInventoryLink {
  id: string // Idempotency key, e.g. "receipt_<receiptId>_inventory"
  receiptId: string
  transactionId?: string
  appliedItemIds: string[]
  appliedAt: string // ISO 8601
}

export type DocumentType = 'payment_screenshot' | 'itemized_receipt' | 'unknown'

export interface ReceiptExtractionDraft {
  id: string
  docType: DocumentType
  totalAmountPaise: number // Integer paise (e.g. ₹270.00 = 27000 paise)
  currency: 'INR'
  date: string // ISO 8601
  merchant: string
  paymentMethod: PaymentMethod
  externalRef?: string // UTR / UPI reference number
  status: TransactionStatus
  category: string
  description: string
  confidenceScore: number // 0.0 to 1.0
  warnings: string[]
  items?: ExtractedReceiptItem[]
  rawImagePreview?: string // Data URL for thumbnail preview
  rawText?: string // Raw text extracted via OCR
}

export interface ExtractionResult {
  success: boolean
  draft?: ReceiptExtractionDraft
  error?: string
}
