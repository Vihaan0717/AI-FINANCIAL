/**
 * PhonePe PDF Statement Parser
 * Money Mate AI — Milestone: PhonePe PDF Statement Import
 * 
 * Strict architectural guarantees:
 * 1. Parses PhonePe digital PDF exports:
 *    - Multiline transaction details.
 *    - Dates with month names including "Sept" (e.g. "Sept 26, 2026", "Oct 18, 2026").
 *    - Rupee symbols (₹), commas, decimal values, and integer amounts.
 *    - Directions (DEBIT / CREDIT).
 *    - PhonePe transaction IDs and 12-digit bank UTR numbers.
 *    - Masked account identifiers (XXXX5200, XXXXXX3938, slice XXXX2051).
 *    - Refunds ("Refund from ...") and internal transfers ("Transfer to ...").
 * 2. Independent row-level validation: malformed rows are never silently dropped.
 * 3. Exact integer paise calculations — zero floating-point math.
 * 4. Provider role: 'enrichment_source' (supplementary UPI application data).
 * 5. Does not assume Slice accounts are credit facilities.
 */

import type {
  StatementParserOptions,
  StatementParserResult,
  FormatDetectionResult,
  RejectedRow,
} from './parserTypes'
import type { ExtractedPdfDocument } from './pdfReader'
import type { StatementRecord } from '../../types/reconciliation'
import {
  validateStatementMonetaryAmount,
  normalizeTransactionReference,
  parseStatementTimestamp,
  cleanCounterpartyText,
} from '../reconciliationValidation'

interface PhonePeHeaderMetadata {
  accountMasked?: string
  startDateText?: string
  endDateText?: string
  parsedStartDate?: string
  parsedEndDate?: string
}

/**
 * Extracts statement-level header metadata (account/phone and statement date range)
 */
function extractHeaderMetadata(fullText: string): PhonePeHeaderMetadata {
  const result: PhonePeHeaderMetadata = {}

  // 1. Account / Phone identifier e.g. "Transaction Statement for 9154716156"
  const stmtForMatch = fullText.match(/Transaction Statement for\s+([A-Za-z0-9*X]+)/i)
  if (stmtForMatch) {
    const rawId = stmtForMatch[1].trim()
    // Mask sensitive digits for safe in-memory display
    if (rawId.length >= 8) {
      result.accountMasked = 'XXXX' + rawId.slice(-4)
    } else {
      result.accountMasked = rawId
    }
  }

  // 2. Statement date range e.g. "22 Jul, 2026 - 20 Oct, 2026"
  const rangeMatch = fullText.match(
    /(\d{1,2}\s+[A-Za-z]{3,4},?\s*\d{4})\s*-\s*(\d{1,2}\s+[A-Za-z]{3,4},?\s*\d{4})/i
  )
  if (rangeMatch) {
    result.startDateText = rangeMatch[1].trim()
    result.endDateText = rangeMatch[2].trim()
    result.parsedStartDate = parseStatementTimestamp(result.startDateText).parsedIso
    result.parsedEndDate = parseStatementTimestamp(result.endDateText).parsedIso
  }

  return result
}

/**
 * Cleans PDF text stream by stripping repetitive page headers, footers, and disclaimers.
 */
function cleanPdfPageText(pageText: string): string {
  return pageText
    .replace(/\u0000/g, ':')
    .replace(/\r/g, '')
    .replace(/Page\s+\d+\s+of\s+\d+/gi, '')
    .replace(/This is an? (?:system|automatically) generated statement[\s\S]*?(?=Date\s+Transaction Details|$)/gi, '')
    .replace(/Customer\(s\) are requested to immediately notify[\s\S]*?(?=Date\s+Transaction Details|$)/gi, '')
    .replace(/Disclaimer\s*:[\s\S]*?(?=Date\s+Transaction Details|$)/gi, '')
    .replace(/For any queries, contact us at[^\n\r]*/gi, '')
    .replace(/https:\/\/support\.phonepe\.com\/statement[^\n\r]*/gi, '')
    .replace(/Date\s+Transaction Details\s+Type\s+Amount/gi, '')
}

/**
 * Parses raw text extracted from a PhonePe PDF statement.
 */
export function parsePhonePePdfText(
  pdfDoc: ExtractedPdfDocument,
  detection: FormatDetectionResult,
  options: StatementParserOptions = {}
): StatementParserResult {
  const records: StatementRecord[] = []
  const rejectedRows: RejectedRow[] = []
  const warnings: string[] = [...pdfDoc.warnings]

  const batchId = options.batchId || `imp-batch-phonepe-pdf-${Date.now()}`
  const sourceAccountId = options.sourceAccountId || 'acc-phonepe-linked'
  const sourceAccountAlias = options.sourceAccountAlias || 'PhonePe (Linked Bank)'
  const statementFileId = options.statementFileId || 'phonepe_statement.pdf'
  const isDemo = Boolean(options.isDemo)

  // Step 1: Check for scanned / image-only document
  if (pdfDoc.isScannedOrImageOnly || pdfDoc.pages.length === 0) {
    return {
      detection: {
        ...detection,
        status: 'unsupported',
        explanation: 'Scanned or image-only PDF detected with no readable text stream. Optical character recognition (OCR) or an original digital export is required.',
      },
      records: [],
      rejectedRows: [],
      warnings: [
        'Scanned or image-only PDF detected with no readable text stream. Optical character recognition (OCR) or an original digital export is required.',
      ],
      statistics: {
        totalRows: 0,
        parsedRecords: 0,
        rejectedRecords: 0,
        warningRecords: 0,
        debitCount: 0,
        creditCount: 0,
        totalDebitPaise: 0,
        totalCreditPaise: 0,
      },
      isProvisional: false,
    }
  }

  // Step 2: Extract header metadata
  const headerMeta = extractHeaderMetadata(pdfDoc.fullText)
  if (headerMeta.parsedStartDate && headerMeta.parsedEndDate) {
    warnings.push(
      `Detected statement period: ${headerMeta.startDateText} to ${headerMeta.endDateText}`
    )
  }

  // Step 3: Clean page text and stitch pages
  const cleanedText = pdfDoc.pages
    .map((p) => cleanPdfPageText(p.text))
    .join('\n')

  // Step 4: Chunk text into individual transaction entries using Date anchors
  // Pattern matches lines starting with "Month DD, YYYY" (e.g. "Oct 18, 2026 Paid to ...")
  // or Date + Time combinations across lines.
  const ENTRY_START_REGEX = /(?:^|\n)[ \t]*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|October|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b[^\n]*)/gi

  let match: RegExpExecArray | null
  const anchors: { lineText: string; index: number }[] = []

  while ((match = ENTRY_START_REGEX.exec(cleanedText)) !== null) {
    const matchedLine = match[1].trim()
    const matchIndex = match.index + (match[0].startsWith('\n') ? 1 : 0)
    anchors.push({
      lineText: matchedLine,
      index: matchIndex,
    })
  }

  // Fallback to strict DATE_TIME_REGEX if line-start matching found nothing
  if (anchors.length === 0) {
    const DATE_TIME_REGEX = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|October|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:[ \t]*\r?\n[ \t]*|[ \t]+)(\d{1,2}[:\.\s\uFF1A\u2236\?]*\d{2}(?:\s*(?:am|pm|AM|PM))?))\b/gi
    while ((match = DATE_TIME_REGEX.exec(cleanedText)) !== null) {
      anchors.push({
        lineText: match[1].replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim(),
        index: match.index,
      })
    }
  }

  if (anchors.length === 0) {
    return {
      detection: {
        ...detection,
        status: 'missing_required_columns',
        explanation: 'Could not find standard PhonePe transaction date anchors in the PDF text stream.',
      },
      records: [],
      rejectedRows: [],
      warnings: ['No transaction records detected in PhonePe PDF statement.'],
      statistics: {
        totalRows: 0,
        parsedRecords: 0,
        rejectedRecords: 0,
        warningRecords: 0,
        debitCount: 0,
        creditCount: 0,
        totalDebitPaise: 0,
        totalCreditPaise: 0,
      },
      isProvisional: false,
    }
  }

  let totalDebitPaise = 0
  let totalCreditPaise = 0
  let debitCount = 0
  let creditCount = 0

  for (let i = 0; i < anchors.length; i++) {
    const rowNum = i + 1
    const currentAnchor = anchors[i]
    const nextStart = i + 1 < anchors.length ? anchors[i + 1].index : cleanedText.length
    const chunk = cleanedText.slice(currentAnchor.index, nextStart).trim()

    const fieldErrors: Record<string, string> = {}
    const rowWarnings: string[] = []

    // 1. Date & Time parsing
    const dateMatch = chunk.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|October|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i)
    const rawDate = dateMatch ? dateMatch[1] : currentAnchor.lineText.slice(0, 15)

    const timeMatch = chunk.match(/\b(\d{1,2})[\s:\.\u0000\uFF1A\u2236]+(\d{2})\s*(am|pm)\b/i)
    const timeStr = timeMatch ? `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3].toLowerCase()}` : undefined
    const combinedDateTime = timeStr ? `${rawDate} ${timeStr}` : rawDate
    const dateParsed = parseStatementTimestamp(combinedDateTime)
    if (!dateParsed.parsedIso) {
      fieldErrors.date = dateParsed.error || `Invalid transaction date: "${rawDate}"`
    }
    if (dateParsed.warning) {
      rowWarnings.push(dateParsed.warning)
    }

    // 2. Direction detection
    let direction: 'debit' | 'credit' = 'debit'
    const typeMatch = chunk.match(/\b(DEBIT|CREDIT)\b/i)
    if (typeMatch) {
      direction = typeMatch[1].toUpperCase() === 'CREDIT' ? 'credit' : 'debit'
    }

    // 3. Amount parsing
    // Must be preceded by DEBIT/CREDIT or contain a rupee symbol (₹/Rs/INR/Unicode glyphs)
    // This strictly prevents matching the day number of the date (e.g. 18 in "Oct 18, 2026")
    let rawAmount = ''
    const amountMatch =
      chunk.match(/(?:DEBIT|CREDIT)\s*(-?\s*(?:INR\s*)?[₹\u20B9„Rs\.]*\s*-?[0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      chunk.match(/(-?\s*(?:INR\s*)?[₹\u20B9„]\s*-?[0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      chunk.match(/(-?\s*(?:Rs\.?|INR)\s*-?[0-9,]+(?:\.[0-9]{1,2})?)/i)

    if (amountMatch) {
      rawAmount = amountMatch[1]
        .replace(/[₹\u20B9„\s]/g, '')
        .replace(/\bRs\.?\s*/gi, '')
        .replace(/\bINR\s*/gi, '')
        .trim()
    } else {
      fieldErrors.amount = 'No monetary amount found in transaction record.'
    }

    let amountPaise = 0
    if (rawAmount) {
      const v = validateStatementMonetaryAmount(rawAmount)
      if (!v.valid || v.paise <= 0) {
        fieldErrors.amount = v.error || `Invalid transaction amount "${rawAmount}".`
      } else {
        amountPaise = v.paise
      }
    }

    // 4. Transaction ID extraction
    let rawTxnId: string | undefined
    const txnMatch = chunk.match(/Transaction ID\s*[:\s]*([A-Za-z0-9]+)/i)
    if (txnMatch) {
      rawTxnId = txnMatch[1].trim()
    }

    // 5. UTR / Bank Reference extraction (12 digits)
    let rawUtr: string | undefined
    const utrMatch =
      chunk.match(/UTR No\.?\s*[:\s]*(\d{12})/i) ||
      chunk.match(/\bUTR\s*[:\s]*(\d{12})\b/i) ||
      chunk.match(/\bRRN\s*[:\s]*(\d{12})\b/i)
    if (utrMatch) {
      rawUtr = utrMatch[1].trim()
    }

    // Secondary reference (e.g. Airtel Prepaid Reference ID)
    let secondaryRef: string | undefined
    const secRefMatch = chunk.match(/(?:Airtel Prepaid Reference ID|Reference ID)\s*[:\s]*([0-9A-Za-z]+)/i)
    if (secRefMatch) {
      secondaryRef = secRefMatch[1].trim()
    }

    // 6. Account Identification
    let rawAccountInfo: string | undefined
    const accMatch = chunk.match(/(?:Paid by|Credited to)\s+([^\n\r]+)/i)
    if (accMatch) {
      let rawAcc = accMatch[1].trim()
      // If Autopay tag is trailing, strip it from the account identifier
      if (/AUTOPAY/i.test(rawAcc)) {
        rawAcc = rawAcc.replace(/AUTOPAY/i, '').trim()
        rowWarnings.push('Recurring AutoPay mandate execution.')
      }
      rawAccountInfo = rawAcc
    }

    // 7. Counterparty / Action Extraction
    let isRefund = false
    let isTransfer = false
    let rawCounterparty = ''

    // Filter out date lines, ID lines, and account lines
    const contentLines = chunk
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => {
        if (!l) return false
        if (l.match(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|October|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}[:\.\s\?]*\d{2}(?:\s*(?:am|pm|AM|PM))?)?$/i)) return false
        if (l.match(/^\d{1,2}[:\.\s\uFF1A\u2236\?]*\d{2}(?:\s*(?:am|pm|AM|PM))?$/i)) return false
        if (l.match(/Transaction ID/i)) return false
        if (l.match(/UTR No/i)) return false
        if (l.match(/^(?:Paid by|Credited to)/i)) return false
        if (l.match(/Reference ID/i)) return false
        if (l.match(/https?:\/\//i)) return false
        if (l.match(/errors in the statement|terms-conditions|privacy policy|disclaimer|fictitious offers|confidential|recipient specified/i)) return false
        return true
      })

    // Clean Date, Time, DEBIT / CREDIT / amounts from the remaining description lines
    const cleanedDetailLines = contentLines
      .map((l) =>
        l
          .replace(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|October|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\s*/i, '')
          .replace(/^\d{1,2}[:\.\s\uFF1A\u2236\?]*\d{2}(?:\s*(?:am|pm|AM|PM))?\s*/i, '')
          .replace(/\b(DEBIT|CREDIT)\b/gi, '')
          .replace(/-?\s*[\u20B9₹„Rs\.]*\s*-?[0-9,]+(?:\.[0-9]{1,2})?/gi, '')
          .replace(/Transaction ID\s*[A-Za-z0-9_-]*/gi, '')
          .replace(/UTR No\.?\s*\d*/gi, '')
          .replace(/Reference ID\s*[A-Za-z0-9_-]*/gi, '')
          .trim()
      )
      .filter((l) => l.length > 0)

    const fullDetailText = cleanedDetailLines.join(' ')

    if (/^Refund from/i.test(fullDetailText)) {
      isRefund = true
      direction = 'credit' // Ensure refund is treated as credit
      rawCounterparty = fullDetailText.replace(/^Refund from\s+/i, '').trim()
    } else if (/^Transfer to/i.test(fullDetailText)) {
      isTransfer = true
      rawCounterparty = fullDetailText.trim()
    } else if (/^Received from/i.test(fullDetailText)) {
      direction = 'credit'
      rawCounterparty = fullDetailText.replace(/^Received from\s+/i, '').trim()
    } else if (/^(?:Paid to|Payment to)/i.test(fullDetailText)) {
      rawCounterparty = fullDetailText.replace(/^(?:Paid to|Payment to)\s+/i, '').trim()
    } else if (/^Mobile recharged/i.test(fullDetailText)) {
      rawCounterparty = 'Mobile Recharge ' + fullDetailText.replace(/^Mobile recharged\s+/i, '').trim()
    } else if (fullDetailText) {
      rawCounterparty = fullDetailText
    } else {
      rawCounterparty = rawTxnId ? `PhonePe payment ${rawTxnId}` : 'PhonePe Transaction'
    }

    const cleanCounterparty = cleanCounterpartyText(rawCounterparty)

    // Reference prioritization: UTR is primary for bank ledger reconciliation; Txn ID as secondary
    const primaryRef = rawUtr || rawTxnId
    const normalizedRef = normalizeTransactionReference(rawUtr) || normalizeTransactionReference(rawTxnId)

    // 8. Payment status checks
    const isFailed = /failed|declined/i.test(chunk)
    const isPending = /pending|processing/i.test(chunk)

    if (isFailed) {
      rowWarnings.push('Transaction marked as Failed in PhonePe statement. Excluded from active financial totals.')
    }
    if (isPending) {
      rowWarnings.push('Transaction marked as Pending/Processing in PhonePe statement.')
    }

    // 9. Independent Validation Check
    if (Object.keys(fieldErrors).length > 0) {
      rejectedRows.push({
        rowIndex: rowNum,
        rawRow: [rawDate, chunk, rawAmount, direction],
        reason: Object.values(fieldErrors).join('; '),
        fieldErrors,
      })
      continue
    }

    // Financial totals tracking (exclude failed transactions)
    if (!isFailed) {
      if (direction === 'debit') {
        debitCount++
        totalDebitPaise += amountPaise
      } else {
        creditCount++
        totalCreditPaise += amountPaise
      }
    }

    // Proposed classification
    let proposedType: 'income' | 'expense' | 'transfer' | 'refund' =
      direction === 'credit' ? 'income' : 'expense'
    if (isRefund) {
      proposedType = 'refund'
    } else if (isTransfer) {
      proposedType = 'transfer'
    }

    let proposedCategory = direction === 'credit' ? 'Income' : 'Other'
    if (isRefund) {
      proposedCategory = 'Shopping'
    } else if (isTransfer) {
      proposedCategory = 'Transfer'
    } else if (/Mobile Recharge/i.test(cleanCounterparty)) {
      proposedCategory = 'Bills & Utilities'
    } else if (/ZOMATO|SWIGGY|FOOD|RESTAURANT|DINING/i.test(cleanCounterparty)) {
      proposedCategory = 'Food & Dining'
    } else if (/UBER|TRANSPORT|TRAVEL|METRO/i.test(cleanCounterparty)) {
      proposedCategory = 'Transportation'
    } else if (/PHARMACY|CLINIC|HOSPITAL|1MG/i.test(cleanCounterparty)) {
      proposedCategory = 'Healthcare'
    } else if (/ZEPTO|BLINKIT|GROCERY|MART/i.test(cleanCounterparty)) {
      proposedCategory = 'Groceries'
    }

    // Resolve account attribution:
    // If options.accountMappings has an entry for this masked account, map it.
    // Otherwise, retain unmapped state if rawAccountInfo exists, or fallback to options.sourceAccountId only if no masked account is present.
    let resolvedAccountId = sourceAccountId
    let resolvedAccountAlias = sourceAccountAlias

    if (rawAccountInfo) {
      if (options.accountMappings && options.accountMappings[rawAccountInfo]) {
        resolvedAccountId = options.accountMappings[rawAccountInfo].targetAccountId
        resolvedAccountAlias = options.accountMappings[rawAccountInfo].targetAccountAlias
      } else {
        // Unknown / unmapped masked account: Mark as unmapped so user review is required
        resolvedAccountId = `unmapped:${rawAccountInfo}`
        resolvedAccountAlias = `Unmapped Account (${rawAccountInfo})`
      }
    }

    const record: StatementRecord = {
      id: `stg-phonepe-pdf-${rowNum}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      batchId,
      sourceProvider: 'phonepe',
      sourceProviderRole: 'enrichment_source',
      sourceAccountId: resolvedAccountId,
      sourceAccountAlias: resolvedAccountAlias,
      maskedAccountId: rawAccountInfo,
      statementFileId,
      originalRowIndex: rowNum,
      originalReference: primaryRef,
      normalizedReference: normalizedRef,
      rawDateText: rawDate,
      parsedDate: dateParsed.parsedIso,
      rawDescription: rawCounterparty,
      cleanDescription: cleanCounterparty || 'PhonePe payment',
      counterparty: cleanCounterparty,
      amountPaise,
      debitPaise: direction === 'debit' ? amountPaise : undefined,
      creditPaise: direction === 'credit' ? amountPaise : undefined,
      signedAmountPaise: direction === 'debit' ? -amountPaise : amountPaise,
      currency: 'INR',
      direction,
      metadata: {
        paymentChannel: 'UPI',
        paymentStatus: isFailed ? 'Failed' : isPending ? 'Pending' : 'Completed',
        orderId: rawTxnId,
        chequeOrRefNo: rawUtr,
        customFields: {
          accountInfo: rawAccountInfo || 'Unknown',
          secondaryReference: secondaryRef || '',
          sourceFormat: 'pdf',
        },
      },
      warnings: rowWarnings,
      errors: [],
      proposedType,
      proposedCategory,
      status: isFailed ? 'failed' : 'staged',
      reviewStatus: 'pending',
      matchCandidateIds: [],
      matchConfidence: 'none',
      isDemo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    records.push(record)
  }

  return {
    detection,
    records,
    rejectedRows,
    warnings,
    statistics: {
      totalRows: anchors.length,
      parsedRecords: records.length,
      rejectedRecords: rejectedRows.length,
      warningRecords: records.filter((r) => r.warnings.length > 0).length,
      debitCount,
      creditCount,
      totalDebitPaise,
      totalCreditPaise,
    },
    isProvisional: false, // Verified against real PhonePe statement layout!
  }
}
