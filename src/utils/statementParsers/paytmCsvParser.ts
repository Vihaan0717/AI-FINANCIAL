/**
 * Paytm Provisional CSV Parser
 * Money Mate AI — Stage 8.2
 * 
 * Strict architectural rules:
 * - Provider role: 'enrichment_source' (Order IDs, merchant details, payment activity).
 * - Distinguishes debits vs refunds/cashback.
 * - Exact integer paise calculations.
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

export function parsePaytmCsv(
  table: ParsedCsvTable,
  detection: FormatDetectionResult,
  options: StatementParserOptions = {}
): StatementParserResult {
  const records: StatementRecord[] = []
  const rejectedRows: RejectedRow[] = []
  const warnings: string[] = [...table.warnings]

  const batchId = options.batchId || `imp-batch-paytm-${Date.now()}`
  const sourceAccountId = options.sourceAccountId || 'acc-paytm-linked'
  const sourceAccountAlias = options.sourceAccountAlias || 'Paytm (Linked Bank)'
  const statementFileId = options.statementFileId || 'paytm_export.csv'
  const isDemo = Boolean(options.isDemo)

  const headerMap = new Map<string, number>()
  table.headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim().replace(/[\s_\-]+/g, ' '), i))

  const dateIdx =
    headerMap.get('date') ??
    headerMap.get('activity date') ??
    -1

  const timeIdx =
    headerMap.get('time') ??
    -1

  const descIdx =
    headerMap.get('transaction details') ??
    headerMap.get('description') ??
    headerMap.get('order details') ??
    -1

  const orderIdIdx =
    headerMap.get('order id') ??
    headerMap.get('order_id') ??
    headerMap.get('txn id') ??
    -1

  const activityIdx =
    headerMap.get('activity') ??
    headerMap.get('type') ??
    -1

  const amountIdx =
    headerMap.get('amount') ??
    headerMap.get('transaction amount') ??
    -1

  const statusIdx =
    headerMap.get('status') ??
    headerMap.get('payment status') ??
    -1

  if (dateIdx === -1 || amountIdx === -1) {
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: ['Paytm CSV missing essential columns (Date or Amount).'],
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

    // 1. Date + Time
    let rawDate = rawRow[dateIdx] || ''
    if (timeIdx !== -1 && rawRow[timeIdx]) {
      rawDate = `${rawDate} ${rawRow[timeIdx]}`
    }
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

    // 3. Activity / Direction
    const rawActivity = activityIdx !== -1 ? (rawRow[activityIdx] || '').toLowerCase() : ''
    let direction: 'debit' | 'credit' = 'debit'
    if (
      rawActivity.includes('received') ||
      rawActivity.includes('cashback') ||
      rawActivity.includes('refund') ||
      rawActivity.includes('credit')
    ) {
      direction = 'credit'
    }

    // 4. Order ID / Reference
    const rawRef = orderIdIdx !== -1 ? rawRow[orderIdIdx] : ''
    const normalizedRef = normalizeTransactionReference(rawRef)

    // 5. Description
    const rawDesc = descIdx !== -1 ? rawRow[descIdx] : ''
    const cleanDesc = cleanCounterpartyText(rawDesc)

    // 6. Status
    const rawStatus = statusIdx !== -1 ? (rawRow[statusIdx] || '').toLowerCase().trim() : 'success'
    const isFailed = rawStatus.includes('failed') || rawStatus.includes('failed')

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

    const record: StatementRecord = {
      id: `stg-paytm-${rowNum}-${Date.now()}`,
      batchId,
      sourceProvider: 'paytm',
      sourceProviderRole: 'enrichment_source',
      sourceAccountId,
      sourceAccountAlias,
      statementFileId,
      originalRowIndex: rowNum,
      originalReference: rawRef || undefined,
      normalizedReference: normalizedRef,
      rawDateText: rawDate,
      parsedDate: dateParsed.parsedIso,
      rawDescription: rawDesc || `Paytm Order ${rawRef}`,
      cleanDescription: cleanDesc || 'Paytm Transaction',
      counterparty: cleanDesc,
      amountPaise,
      debitPaise: direction === 'debit' ? amountPaise : undefined,
      creditPaise: direction === 'credit' ? amountPaise : undefined,
      signedAmountPaise: direction === 'debit' ? -amountPaise : amountPaise,
      currency: 'INR',
      direction,
      metadata: {
        paymentChannel: 'UPI',
        orderId: rawRef || undefined,
        paymentStatus: rawRow[statusIdx] || 'Success',
      },
      warnings: rowWarnings,
      errors: [],
      proposedType: rawActivity.includes('refund')
        ? 'refund'
        : (/transfer|trf|to own|self|credit card|slice/i.test(rawDesc + ' ' + rawActivity) || (direction === 'credit' && !/salary|payroll|dividend|interest/i.test(rawDesc)))
        ? 'transfer'
        : direction === 'credit'
        ? 'income'
        : 'expense',
      proposedCategory: rawActivity.includes('refund')
        ? 'Shopping'
        : (/transfer|trf|to own|self|credit card|slice/i.test(rawDesc + ' ' + rawActivity) || (direction === 'credit' && !/salary|payroll|dividend|interest/i.test(rawDesc)))
        ? 'Transfer'
        : direction === 'credit'
        ? 'Income'
        : 'Other',
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
