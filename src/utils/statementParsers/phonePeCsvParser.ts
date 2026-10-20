/**
 * PhonePe Provisional CSV Parser
 * Money Mate AI — Stage 8.2
 * 
 * Strict architectural rules:
 * - Provider role: 'enrichment_source' (merchant names, UPI UTR / Txn IDs, payment status).
 * - Distinguishes Completed vs Pending vs Failed transactions.
 * - Extracts clean merchant/counterparty names and payment notes.
 */

import type {
  StatementParserOptions,
  StatementParserResult,
  FormatDetectionResult,
  RejectedRow,
} from './parserTypes'
import type { ParsedCsvTable } from './parserTypes'
import type { StatementRecord } from '../../types/reconciliation'
import {
  validateStatementMonetaryAmount,
  normalizeTransactionReference,
  parseStatementTimestamp,
  cleanCounterpartyText,
} from '../reconciliationValidation'

export function parsePhonePeCsv(
  table: ParsedCsvTable,
  detection: FormatDetectionResult,
  options: StatementParserOptions = {}
): StatementParserResult {
  const records: StatementRecord[] = []
  const rejectedRows: RejectedRow[] = []
  const warnings: string[] = [...table.warnings]

  const batchId = options.batchId || `imp-batch-phonepe-${Date.now()}`
  const sourceAccountId = options.sourceAccountId || 'acc-phonepe-linked'
  const sourceAccountAlias = options.sourceAccountAlias || 'PhonePe (Linked Bank)'
  const statementFileId = options.statementFileId || 'phonepe_export.csv'
  const isDemo = Boolean(options.isDemo)

  const headerMap = new Map<string, number>()
  table.headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim().replace(/[\s_\-]+/g, ' '), i))

  const dateIdx =
    headerMap.get('date') ??
    headerMap.get('payment date') ??
    headerMap.get('time') ??
    -1

  const txnIdIdx =
    headerMap.get('transaction id') ??
    headerMap.get('txn id') ??
    headerMap.get('utr') ??
    -1

  const merchantIdx =
    headerMap.get('payment to') ??
    headerMap.get('merchant') ??
    headerMap.get('paid to') ??
    headerMap.get('recipient') ??
    -1

  const typeIdx =
    headerMap.get('type') ??
    headerMap.get('transaction type') ??
    headerMap.get('payment type') ??
    -1

  const amountIdx =
    headerMap.get('amount') ??
    headerMap.get('paid amount') ??
    -1

  const statusIdx =
    headerMap.get('status') ??
    headerMap.get('payment status') ??
    -1

  const detailsIdx =
    headerMap.get('transaction details') ??
    headerMap.get('details') ??
    headerMap.get('description') ??
    -1

  if (dateIdx === -1 || amountIdx === -1 || (merchantIdx === -1 && txnIdIdx === -1 && detailsIdx === -1)) {
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: ['PhonePe CSV missing essential columns (Date, Amount, or Transaction Details).'],
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
      isProvisional: true,
    }
  }

  let totalDebitPaise = 0
  let totalCreditPaise = 0
  let debitCount = 0
  let creditCount = 0

  for (let r = 0; r < table.rows.length; r++) {
    const rawRow = table.rows[r]
    const rowNum = r + 2
    const fieldErrors: Record<string, string> = {}
    const rowWarnings: string[] = []

    // 1. Date
    const rawDate = rawRow[dateIdx] || ''
    const dateParsed = parseStatementTimestamp(rawDate)
    if (!dateParsed.parsedIso) {
      fieldErrors.date = dateParsed.error || 'Invalid date.'
    }
    if (dateParsed.warning) {
      rowWarnings.push(dateParsed.warning)
    }

    // 2. Amount
    const rawAmount = rawRow[amountIdx] || ''
    const v = validateStatementMonetaryAmount(rawAmount)
    let amountPaise = 0
    if (!v.valid || v.paise <= 0) {
      fieldErrors.amount = v.error || 'Invalid amount.'
    } else {
      amountPaise = v.paise
    }

    // 3. Multiline Transaction Details Extraction (Real PhonePe export)
    let rawMerchant = merchantIdx !== -1 ? rawRow[merchantIdx] : ''
    let rawRef = txnIdIdx !== -1 ? rawRow[txnIdIdx] : ''
    let isRefund = false
    let isTransfer = false
    let rawAccountInfo: string | undefined

    if (detailsIdx !== -1 && rawRow[detailsIdx]) {
      const details = rawRow[detailsIdx]

      // Extract Transaction ID
      const txnIdMatch = details.match(/Transaction ID\s+([A-Za-z0-9]+)/i)
      if (txnIdMatch) {
        rawRef = txnIdMatch[1]
      }

      // Extract 12-digit UTR (preferred reference for bank matching)
      const utrMatch = details.match(/UTR No\.\s*(\d{12})/i)
      if (utrMatch) {
        rawRef = utrMatch[1]
      }

      // Extract account identity (e.g. Paid by XXXX5200, Credited to XXXX5200)
      const accountMatch = details.match(/(?:Paid by|Credited to)\s+([^\n\r]+)/i)
      if (accountMatch) {
        rawAccountInfo = accountMatch[1].trim()
      }

      // Extract counterparty / action from first line
      const firstLine = details.split(/\r?\n/)[0]?.trim() || ''
      if (/^Refund from/i.test(firstLine)) {
        isRefund = true
        rawMerchant = firstLine.replace(/^Refund from\s+/i, '').trim()
      } else if (/^Transfer to/i.test(firstLine)) {
        isTransfer = true
        rawMerchant = firstLine.trim()
      } else if (/^Received from/i.test(firstLine)) {
        rawMerchant = firstLine.replace(/^Received from\s+/i, '').trim()
      } else if (/^(?:Paid to|Payment to)/i.test(firstLine)) {
        rawMerchant = firstLine.replace(/^(?:Paid to|Payment to)\s+/i, '').trim()
      } else if (/^Mobile recharged/i.test(firstLine)) {
        rawMerchant = 'Mobile Recharge ' + firstLine.replace(/^Mobile recharged\s+/i, '').trim()
      } else if (firstLine) {
        rawMerchant = firstLine
      }
    }

    // 4. Direction
    let direction: 'debit' | 'credit' = 'debit'
    if (typeIdx !== -1) {
      const rawType = (rawRow[typeIdx] || '').toLowerCase()
      if (rawType.includes('credit') || rawType.includes('received') || rawType.includes('refund')) {
        direction = 'credit'
      } else {
        direction = 'debit'
      }
    } else if (isRefund) {
      direction = 'credit'
    }

    // 5. Reference & Counterparty Normalization
    const normalizedRef = normalizeTransactionReference(rawRef)
    const cleanMerchant = cleanCounterpartyText(rawMerchant)

    // 6. Payment Status
    const rawStatus = statusIdx !== -1 ? (rawRow[statusIdx] || '').toLowerCase().trim() : 'completed'
    const isFailed = rawStatus.includes('failed') || rawStatus.includes('declined')
    const isPending = rawStatus.includes('pending') || rawStatus.includes('processing')

    if (isFailed) {
      rowWarnings.push(`Transaction status is "${rawRow[statusIdx]}". Excluded from active financial totals.`)
    }

    if (Object.keys(fieldErrors).length > 0) {
      rejectedRows.push({
        rowIndex: rowNum,
        rawRow,
        reason: Object.values(fieldErrors).join('; '),
        fieldErrors,
      })
      continue
    }

    if (direction === 'debit') {
      debitCount++
      if (!isFailed) totalDebitPaise += amountPaise
    } else {
      creditCount++
      if (!isFailed) totalCreditPaise += amountPaise
    }

    let proposedType: 'income' | 'expense' | 'transfer' | 'refund' =
      direction === 'credit' ? 'income' : 'expense'
    let proposedCategory = direction === 'credit' ? 'Income' : 'Other'

    const rawDetails = detailsIdx !== -1 ? rawRow[detailsIdx] || '' : ''
    const isExplicitIncome = /salary|payroll|dividend|interest|pension|stipend|client invoice/i.test(
      cleanMerchant + ' ' + rawDetails
    )

    if (isRefund) {
      proposedType = 'refund'
      proposedCategory = 'Shopping'
    } else if (isTransfer || /transfer to|transfer from|to own|self transfer|slice/i.test(cleanMerchant + ' ' + rawDetails)) {
      proposedType = 'transfer'
      proposedCategory = 'Transfer'
    } else if (direction === 'credit') {
      if (isExplicitIncome) {
        proposedType = 'income'
        proposedCategory = 'Income'
      } else {
        proposedType = 'transfer'
        proposedCategory = 'Transfer'
      }
    }

    let resolvedAccountId = sourceAccountId
    let resolvedAccountAlias = sourceAccountAlias

    if (rawAccountInfo) {
      if (options.accountMappings && options.accountMappings[rawAccountInfo]) {
        resolvedAccountId = options.accountMappings[rawAccountInfo].targetAccountId
        resolvedAccountAlias = options.accountMappings[rawAccountInfo].targetAccountAlias
      } else {
        resolvedAccountId = `unmapped:${rawAccountInfo}`
        resolvedAccountAlias = `Unmapped Account (${rawAccountInfo})`
      }
    }

    const record: StatementRecord = {
      id: `stg-phonepe-${rowNum}-${Date.now()}`,
      batchId,
      sourceProvider: 'phonepe',
      sourceProviderRole: 'enrichment_source',
      sourceAccountId: resolvedAccountId,
      sourceAccountAlias: resolvedAccountAlias,
      maskedAccountId: rawAccountInfo,
      statementFileId,
      originalRowIndex: rowNum,
      originalReference: rawRef || undefined,
      normalizedReference: normalizedRef,
      rawDateText: rawDate,
      parsedDate: dateParsed.parsedIso,
      rawDescription: rawMerchant || `PhonePe payment ${rawRef}`,
      cleanDescription: cleanMerchant || 'PhonePe payment',
      counterparty: cleanMerchant,
      amountPaise,
      debitPaise: direction === 'debit' ? amountPaise : undefined,
      creditPaise: direction === 'credit' ? amountPaise : undefined,
      signedAmountPaise: direction === 'debit' ? -amountPaise : amountPaise,
      currency: 'INR',
      direction,
      metadata: {
        paymentChannel: 'UPI',
        paymentStatus: rawRow[statusIdx] || 'Completed',
        orderId: rawRef || undefined,
        customFields: rawAccountInfo ? { accountInfo: rawAccountInfo } : undefined,
      },
      warnings: rowWarnings,
      errors: [],
      proposedType,
      proposedCategory,
      status: isFailed ? 'failed' : isPending ? 'staged' : 'staged',
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
      totalRows: table.rows.length,
      parsedRecords: records.length,
      rejectedRecords: rejectedRows.length,
      warningRecords: records.filter((r) => r.warnings.length > 0).length,
      debitCount,
      creditCount,
      totalDebitPaise,
      totalCreditPaise,
    },
    isProvisional: true,
  }
}
