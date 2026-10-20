/**
 * Statement Parser Subsystem Entrypoint
 * Money Mate AI — Stage 8.2
 * 
 * Provides unified, client-side statement ingestion with format detection,
 * non-destructive normalization, and row-level diagnostics.
 */

import { parseCsv } from './csvReader'
import { detectStatementFormat, detectPdfStatementFormat } from './formatDetection'
import { parseSbiCsv } from './sbiCsvParser'
import { parseUnionBankCsv } from './unionBankCsvParser'
import { parsePhonePeCsv } from './phonePeCsvParser'
import { parsePaytmCsv } from './paytmCsvParser'
import { parseSliceCsv } from './sliceCsvParser'
import { extractPdfText } from './pdfReader'
import { parsePhonePePdfText } from './phonePePdfParser'
import type {
  StatementParserOptions,
  StatementParserResult,
  FormatDetectionResult,
  RejectedRow,
} from './parserTypes'
import type { StatementRecord } from '../../types/reconciliation'
import {
  validateStatementMonetaryAmount,
  normalizeTransactionReference,
  parseStatementTimestamp,
  cleanCounterpartyText,
} from '../reconciliationValidation'

export * from './parserTypes'
export * from './csvReader'
export * from './formatDetection'
export * from './sbiCsvParser'
export * from './unionBankCsvParser'
export * from './phonePeCsvParser'
export * from './paytmCsvParser'
export * from './sliceCsvParser'
export * from './pdfReader'
export * from './phonePePdfParser'

/**
 * Parses generic CSV statements containing Date, Description, and Amount columns.
 */
function parseGenericCsv(
  table: ReturnType<typeof parseCsv>,
  detection: FormatDetectionResult,
  options: StatementParserOptions = {}
): StatementParserResult {
  const records: StatementRecord[] = []
  const rejectedRows: RejectedRow[] = []
  const warnings: string[] = [...table.warnings]

  const batchId = options.batchId || `imp-batch-generic-${Date.now()}`
  const sourceAccountId = options.sourceAccountId || 'acc-generic'
  const sourceAccountAlias = options.sourceAccountAlias || 'Generic Statement Account'
  const statementFileId = options.statementFileId || 'statement.csv'
  const isDemo = Boolean(options.isDemo)

  const headerMap = new Map<string, number>()
  table.headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim().replace(/[\s_\-]+/g, ' '), i))

  const dateIdx =
    headerMap.get('date') ??
    headerMap.get('time') ??
    headerMap.get('timestamp') ??
    headerMap.get('txn date') ??
    -1

  const descIdx =
    headerMap.get('description') ??
    headerMap.get('narration') ??
    headerMap.get('particulars') ??
    headerMap.get('details') ??
    headerMap.get('remarks') ??
    -1

  const amountIdx =
    headerMap.get('amount') ??
    headerMap.get('amt') ??
    headerMap.get('total') ??
    -1

  const debitIdx =
    headerMap.get('debit') ??
    headerMap.get('withdrawal') ??
    headerMap.get('dr') ??
    -1

  const creditIdx =
    headerMap.get('credit') ??
    headerMap.get('deposit') ??
    headerMap.get('cr') ??
    -1

  const refIdx =
    headerMap.get('reference') ??
    headerMap.get('ref no') ??
    headerMap.get('transaction id') ??
    headerMap.get('utr') ??
    -1

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
    const rawDate = dateIdx !== -1 ? rawRow[dateIdx] || '' : ''
    const dateParsed = parseStatementTimestamp(rawDate)
    if (!dateParsed.parsedIso) {
      fieldErrors.date = dateParsed.error || 'Invalid date.'
    }
    if (dateParsed.warning) {
      rowWarnings.push(dateParsed.warning)
    }

    // 2. Description
    const rawDesc = descIdx !== -1 ? rawRow[descIdx] || '' : ''
    const cleanDesc = cleanCounterpartyText(rawDesc)

    // 3. Amount & Direction
    let direction: 'debit' | 'credit' = 'debit'
    let amountPaise = 0

    if (debitIdx !== -1 || creditIdx !== -1) {
      const rawDebit = debitIdx !== -1 ? rawRow[debitIdx] : ''
      const rawCredit = creditIdx !== -1 ? rawRow[creditIdx] : ''
      const hasDebit = rawDebit && rawDebit.trim() !== '' && rawDebit.trim() !== '0'
      const hasCredit = rawCredit && rawCredit.trim() !== '' && rawCredit.trim() !== '0'

      if (hasDebit && hasCredit) {
        fieldErrors.amount = `Row contains both Debit (${rawDebit}) and Credit (${rawCredit}) values.`
      } else if (!hasDebit && !hasCredit) {
        fieldErrors.amount = 'Row contains neither Debit nor Credit amount.'
      } else if (hasDebit) {
        direction = 'debit'
        const v = validateStatementMonetaryAmount(rawDebit)
        if (!v.valid || v.paise <= 0) fieldErrors.debit = v.error || 'Invalid debit amount.'
        else amountPaise = v.paise
      } else {
        direction = 'credit'
        const v = validateStatementMonetaryAmount(rawCredit)
        if (!v.valid || v.paise <= 0) fieldErrors.credit = v.error || 'Invalid credit amount.'
        else amountPaise = v.paise
      }
    } else if (amountIdx !== -1) {
      const rawAmount = rawRow[amountIdx] || ''
      const v = validateStatementMonetaryAmount(rawAmount)
      if (!v.valid || v.paise <= 0) {
        fieldErrors.amount = v.error || 'Invalid amount.'
      } else {
        amountPaise = v.paise
        direction = 'debit' // Default to debit for single amount column unless specified
      }
    } else {
      fieldErrors.amount = 'No amount or debit/credit column found in generic CSV.'
    }

    // 4. Reference
    const rawRef = refIdx !== -1 ? rawRow[refIdx] : ''
    const normalizedRef = normalizeTransactionReference(rawRef) || normalizeTransactionReference(rawDesc)

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

    records.push({
      id: `stg-gen-${rowNum}-${Date.now()}`,
      batchId,
      sourceProvider: 'generic_csv',
      sourceProviderRole: 'primary_ledger',
      sourceAccountId,
      sourceAccountAlias,
      statementFileId,
      originalRowIndex: rowNum,
      originalReference: rawRef || undefined,
      normalizedReference: normalizedRef,
      rawDateText: rawDate,
      parsedDate: dateParsed.parsedIso,
      rawDescription: rawDesc || 'Generic Transaction',
      cleanDescription: cleanDesc || 'Transaction',
      counterparty: cleanDesc,
      amountPaise,
      debitPaise: direction === 'debit' ? amountPaise : undefined,
      creditPaise: direction === 'credit' ? amountPaise : undefined,
      signedAmountPaise: direction === 'debit' ? -amountPaise : amountPaise,
      currency: 'INR',
      direction,
      metadata: {
        rawNarration: rawDesc,
      },
      warnings: rowWarnings,
      errors: [],
      proposedType: direction === 'credit' ? 'income' : 'expense',
      proposedCategory: direction === 'credit' ? 'Income' : 'Other',
      status: 'staged',
      reviewStatus: 'pending',
      matchCandidateIds: [],
      matchConfidence: 'none',
      isDemo,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
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

/**
 * Universal client-side statement CSV parser.
 * Reads raw CSV, detects provider format, maps rows to StatementRecord,
 * and produces row-level diagnostics.
 */
export function parseStatementCsv(
  csvText: string,
  options: StatementParserOptions = {}
): StatementParserResult {
  // Step 1: Parse CSV structure
  const table = parseCsv(csvText, {
    trimHeaders: true,
    skipEmptyRows: true,
  })

  // Step 2: Format Detection
  const detection = detectStatementFormat(table.headers, options)

  // If format is unsupported or headers are missing/corrupt
  if (
    detection.status === 'unsupported' ||
    detection.status === 'unknown' ||
    detection.status === 'missing_required_columns'
  ) {
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: [...table.warnings, detection.explanation],
      statistics: {
        totalRows: table.rows.length,
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

  // Step 3: Route to specific provider parser
  const provider = detection.detectedProvider || options.selectedProvider || 'generic_csv'

  switch (provider) {
    case 'sbi':
      return parseSbiCsv(table, detection, options)
    case 'union_bank':
      return parseUnionBankCsv(table, detection, options)
    case 'phonepe':
      return parsePhonePeCsv(table, detection, options)
    case 'paytm':
      return parsePaytmCsv(table, detection, options)
    case 'slice':
      return parseSliceCsv(table, detection, options)
    case 'generic_csv':
    default:
      return parseGenericCsv(table, detection, options)
  }
}

/**
 * Universal client-side statement PDF parser.
 * Reads raw PDF bytes, extracts per-page text stream, detects format,
 * normalizes transactions into StatementRecord objects, and computes row-level diagnostics.
 */
export async function parseStatementPdf(
  pdfData: Uint8Array | ArrayBuffer,
  options: StatementParserOptions = {}
): Promise<StatementParserResult> {
  // Step 1: Extract text per page
  const pdfDoc = await extractPdfText(pdfData)

  if (pdfDoc.error) {
    const detection: FormatDetectionResult = {
      status: 'unsupported',
      confidence: 'none',
      isVerified: false,
      matchedHeaders: [],
      missingHeaders: [],
      explanation: pdfDoc.error,
    }
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: [pdfDoc.error, ...pdfDoc.warnings],
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

  // Step 2: Format Detection
  const detection = detectPdfStatementFormat(pdfDoc, options)

  if (detection.status === 'unsupported' || detection.status === 'unknown') {
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: [...pdfDoc.warnings, detection.explanation],
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

  // Step 3: Route to specific provider parser
  const provider = detection.detectedProvider || options.selectedProvider || 'phonepe'
  if (provider === 'phonepe') {
    return parsePhonePePdfText(pdfDoc, detection, options)
  }

  return {
    detection,
    records: [],
    rejectedRows: [],
    warnings: [...pdfDoc.warnings, `Provider ${provider} does not yet have a verified digital PDF parser.`],
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

