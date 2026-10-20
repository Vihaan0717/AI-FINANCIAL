/**
 * Slice Provisional CSV Parser
 * Money Mate AI — Stage 8.2
 * 
 * Strict architectural rules:
 * - Provider role: 'enrichment_source' (card / UPI spend, category tags, merchant names).
 * - Exact integer paise calculations.
 * - Extracts merchant and suggested category.
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

export function parseSliceCsv(
  table: ParsedCsvTable,
  detection: FormatDetectionResult,
  options: StatementParserOptions = {}
): StatementParserResult {
  const records: StatementRecord[] = []
  const rejectedRows: RejectedRow[] = []
  const warnings: string[] = [...table.warnings]

  const batchId = options.batchId || `imp-batch-slice-${Date.now()}`
  const sourceAccountId = options.sourceAccountId || 'acc-slice-linked'
  const sourceAccountAlias = options.sourceAccountAlias || 'Slice Card/UPI'
  const statementFileId = options.statementFileId || 'slice_export.csv'
  const isDemo = Boolean(options.isDemo)

  const headerMap = new Map<string, number>()
  table.headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim().replace(/[\s_\-]+/g, ' '), i))

  const dateIdx =
    headerMap.get('date') ??
    headerMap.get('txn date') ??
    -1

  const descIdx =
    headerMap.get('description') ??
    headerMap.get('merchant name') ??
    headerMap.get('particulars') ??
    -1

  const typeIdx =
    headerMap.get('txn type') ??
    headerMap.get('transaction type') ??
    headerMap.get('type') ??
    -1

  const amountIdx =
    headerMap.get('amount') ??
    headerMap.get('spend amount') ??
    -1

  const catIdx =
    headerMap.get('category') ??
    -1

  const refIdx =
    headerMap.get('reference id') ??
    headerMap.get('slice reference') ??
    headerMap.get('ref no') ??
    -1

  if (dateIdx === -1 || amountIdx === -1) {
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: ['Slice CSV missing essential columns (Date or Amount).'],
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

    // 3. Direction
    let direction: 'debit' | 'credit' = 'debit'
    if (typeIdx !== -1) {
      const rawType = (rawRow[typeIdx] || '').toLowerCase()
      if (
        rawType.includes('credit') ||
        rawType.includes('repayment') ||
        rawType.includes('cashback') ||
        rawType.includes('refund')
      ) {
        direction = 'credit'
      }
    }

    // 4. Reference
    const rawRef = refIdx !== -1 ? rawRow[refIdx] : ''
    const normalizedRef = normalizeTransactionReference(rawRef)

    // 5. Description & Merchant
    const rawDesc = descIdx !== -1 ? rawRow[descIdx] : ''
    const cleanDesc = cleanCounterpartyText(rawDesc)

    // 6. Category Hint
    const rawCat = catIdx !== -1 ? rawRow[catIdx] : undefined

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
      totalDebitPaise += amountPaise
    } else {
      creditCount++
      totalCreditPaise += amountPaise
    }

    const record: StatementRecord = {
      id: `stg-slice-${rowNum}-${Date.now()}`,
      batchId,
      sourceProvider: 'slice',
      sourceProviderRole: 'enrichment_source',
      sourceAccountId,
      sourceAccountAlias,
      statementFileId,
      originalRowIndex: rowNum,
      originalReference: rawRef || undefined,
      normalizedReference: normalizedRef,
      rawDateText: rawDate,
      parsedDate: dateParsed.parsedIso,
      rawDescription: rawDesc || 'Slice Spend',
      cleanDescription: cleanDesc || 'Slice Transaction',
      counterparty: cleanDesc,
      amountPaise,
      debitPaise: direction === 'debit' ? amountPaise : undefined,
      creditPaise: direction === 'credit' ? amountPaise : undefined,
      signedAmountPaise: direction === 'debit' ? -amountPaise : amountPaise,
      currency: 'INR',
      direction,
      metadata: {
        paymentChannel: 'CARD',
        categoryHint: rawCat,
        orderId: rawRef || undefined,
      },
      warnings: rowWarnings,
      errors: [],
      proposedType: direction === 'credit' ? 'income' : 'expense',
      proposedCategory: rawCat || (direction === 'credit' ? 'Income' : 'Shopping'),
      status: 'staged',
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
