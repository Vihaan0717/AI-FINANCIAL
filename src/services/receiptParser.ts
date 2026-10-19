import type {
  DocumentType,
  ExtractedReceiptItem,
  ReceiptExtractionDraft,
} from '../types/receipt'
import type { PaymentMethod, TransactionStatus } from '../types/transaction'
import { rupeesToPaise } from '../utils/money'

export interface ParsedReceiptData {
  docType: DocumentType
  totalAmountPaise: number
  merchant: string
  date: string
  paymentMethod: PaymentMethod
  status: TransactionStatus
  category: string
  description: string
  externalRef?: string
  confidenceScore: number
  warnings: string[]
  items?: ExtractedReceiptItem[]
  rawText: string
}

/**
 * Parses raw text extracted by OCR from a receipt or payment screenshot.
 */
export function parseReceiptText(rawText: string): ParsedReceiptData {
  const text = rawText.replace(/\r\n/g, '\n')
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const lowerText = text.toLowerCase()

  const warnings: string[] = []
  let confidenceScore = 0.5

  // 1. Detect Payment Status
  let status: TransactionStatus = 'completed'
  if (
    lowerText.includes('failed') ||
    lowerText.includes('declined') ||
    lowerText.includes('payment failed') ||
    lowerText.includes('unsuccessful')
  ) {
    status = 'failed'
    confidenceScore += 0.15
    warnings.push('Payment status is detected as FAILED.')
  } else if (
    lowerText.includes('pending') ||
    lowerText.includes('processing') ||
    lowerText.includes('in progress')
  ) {
    status = 'pending'
    confidenceScore += 0.1
    warnings.push('Payment is marked as PENDING / UNSETTLED.')
  } else if (
    lowerText.includes('paid successfully') ||
    lowerText.includes('payment successful') ||
    lowerText.includes('completed') ||
    lowerText.includes('paid to')
  ) {
    status = 'completed'
    confidenceScore += 0.15
  }

  // 2. Detect Payment Method
  let paymentMethod: PaymentMethod = 'UPI'
  if (
    lowerText.includes('upi') ||
    lowerText.includes('gpay') ||
    lowerText.includes('phonepe') ||
    lowerText.includes('paytm') ||
    lowerText.includes('cred') ||
    lowerText.includes('bhim') ||
    lowerText.includes('@ok') ||
    lowerText.includes('@axl') ||
    lowerText.includes('@ybl')
  ) {
    paymentMethod = 'UPI'
    confidenceScore += 0.1
  } else if (lowerText.includes('card') || lowerText.includes('visa') || lowerText.includes('mastercard') || lowerText.includes('rupay')) {
    paymentMethod = 'Card'
    confidenceScore += 0.1
  } else if (lowerText.includes('netbanking') || lowerText.includes('neft') || lowerText.includes('rtgs') || lowerText.includes('imps')) {
    paymentMethod = 'Bank transfer'
    confidenceScore += 0.1
  } else if (lowerText.includes('cash')) {
    paymentMethod = 'Cash'
    confidenceScore += 0.1
  }

  // 3. Extract Amount (INR)
  let totalAmountPaise = 0
  const amountRegexes = [
    /(?:total|grand\s*total|net\s*payable|amount\s*paid|paid|amount)\s*[:=-]?\s*(?:₹|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:₹|rs\.?|inr)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /\b([0-9,]+\.[0-9]{2})\b/,
  ]

  for (const regex of amountRegexes) {
    const match = text.match(regex)
    if (match && match[1]) {
      const cleanNum = match[1].replace(/,/g, '')
      const val = parseFloat(cleanNum)
      if (!isNaN(val) && val > 0 && val < 1000000) {
        try {
          totalAmountPaise = rupeesToPaise(cleanNum)
          confidenceScore += 0.2
          break
        } catch {
          // Continue to next regex
        }
      }
    }
  }

  if (totalAmountPaise === 0) {
    warnings.push('Could not detect total amount with certainty. Please enter amount.')
  }

  // 4. Extract UTR / External Reference (prioritize UTR over generic Txn ID)
  let externalRef: string | undefined = undefined
  const utrMatch =
    text.match(/(?:utr(?:\s*no\.?)?|upi\s*ref(?:\s*no\.?|\s*id)?)\s*[:=-]?\s*([A-Za-z0-9]{8,24})/i) ||
    text.match(/(?:txn\s*id|transaction\s*id)\s*[:=-]?\s*([A-Za-z0-9]{8,24})/i)
  if (utrMatch && utrMatch[1]) {
    externalRef = utrMatch[1].trim()
    confidenceScore += 0.15
  } else {
    // Check for standard 12-digit Indian UTR number
    const twelveDigitMatch = text.match(/\b\d{12}\b/)
    if (twelveDigitMatch) {
      externalRef = `UPI/${twelveDigitMatch[0]}`
      confidenceScore += 0.1
    }
  }

  // 5. Extract Merchant / Payee
  let merchant = ''
  const merchantPrefixMatch = text.match(/(?:paid to|to:?|payee:?)\s*([A-Za-z0-9 &.,'-]{3,35})/i)
  if (merchantPrefixMatch && merchantPrefixMatch[1]) {
    merchant = merchantPrefixMatch[1].trim()
    confidenceScore += 0.15
  } else {
    // Check for common stores in first 4 lines
    for (const line of lines.slice(0, 4)) {
      if (
        line.length >= 3 &&
        !/\d{4}/.test(line) &&
        !/receipt|invoice|bill|tax|phone|date|total/i.test(line)
      ) {
        merchant = line
        break
      }
    }
  }

  if (!merchant) {
    merchant = 'Merchant / Store'
    warnings.push('Merchant name was ambiguous. Please verify.')
  }

  // 6. Category Heuristics
  let category = 'Shopping'
  const catKeywords: Record<string, string[]> = {
    'Food & dining': ['coffee', 'restaurant', 'cafe', 'tea', 'swiggy', 'zomato', 'bakery', 'kitchen', 'dining', 'pizza', 'burger'],
    'Groceries': ['supermarket', 'mart', 'fresh', 'grocer', 'dmart', 'blinkit', 'zepto', 'instamart', 'provisions', 'vegetables', 'milk', 'soap', 'detergent'],
    'Transport': ['uber', 'ola', 'rapido', 'metro', 'petrol', 'fuel', 'auto', 'railway', 'irctc'],
    'Utilities': ['electricity', 'water', 'gas', 'broadband', 'airtel', 'jio', 'recharge', 'bescom', 'besl'],
    'Health': ['pharmacy', 'chemist', 'hospital', 'apollo', 'medplus', 'clinic', 'dentist'],
  }

  for (const [cat, words] of Object.entries(catKeywords)) {
    if (words.some((w) => lowerText.includes(w))) {
      category = cat
      break
    }
  }

  // 7. Detect Itemized Receipt & Line Items
  const items: ExtractedReceiptItem[] = []
  const itemLineRegex = /^([A-Za-z0-9\s.,'()-]{3,30})\s+(\d+)\s+(?:₹|rs\.?)?\s*(\d+(?:\.\d{1,2})?)/i

  for (const line of lines) {
    const itemMatch = line.match(itemLineRegex)
    if (itemMatch) {
      const name = itemMatch[1].trim()
      const qty = parseInt(itemMatch[2], 10) || 1
      const priceRupees = parseFloat(itemMatch[3])
      if (priceRupees > 0) {
        const itemPaise = Math.round(priceRupees * 100)
        items.push({
          id: `item-${items.length + 1}`,
          name,
          quantity: qty,
          unitPricePaise: itemPaise,
          totalPricePaise: itemPaise * qty,
          category,
          suggestedInventoryCategory: 'Essentials',
        })
      }
    }
  }

  const isItemized = items.length > 0 || lowerText.includes('subtotal') || lowerText.includes('qty') || lowerText.includes('tax invoice')
  const docType: DocumentType = isItemized
    ? 'itemized_receipt'
    : paymentMethod === 'UPI' || lowerText.includes('paid')
    ? 'payment_screenshot'
    : 'unknown'

  // Cap confidence score between 0.2 and 0.98
  const finalConfidence = Math.min(0.98, Math.max(0.2, Number(confidenceScore.toFixed(2))))

  return {
    docType,
    totalAmountPaise,
    merchant,
    date: new Date().toISOString(),
    paymentMethod,
    status,
    category,
    description: docType === 'itemized_receipt' ? `${merchant} purchase (${items.length || 1} items)` : `Payment to ${merchant}`,
    externalRef,
    confidenceScore: finalConfidence,
    warnings,
    items: items.length > 0 ? items : undefined,
    rawText: text,
  }
}

/**
 * Converts parsed receipt data into a full ReceiptExtractionDraft.
 */
export function createDraftFromParsedData(
  parsed: ParsedReceiptData,
  rawImagePreview?: string
): ReceiptExtractionDraft {
  return {
    id: `draft-${Date.now()}`,
    docType: parsed.docType,
    totalAmountPaise: parsed.totalAmountPaise,
    currency: 'INR',
    date: parsed.date,
    merchant: parsed.merchant,
    paymentMethod: parsed.paymentMethod,
    externalRef: parsed.externalRef,
    status: parsed.status,
    category: parsed.category,
    description: parsed.description,
    confidenceScore: parsed.confidenceScore,
    warnings: parsed.warnings,
    items: parsed.items,
    rawImagePreview,
    rawText: parsed.rawText,
  }
}
