/**
 * State Bank of India (SBI) Provisional CSV Parser
 * Money Mate AI — Stage 8.2
 * 
 * Strict architectural rules:
 * - Provider role: 'primary_ledger' (authoritative bank debits/credits/balances).
 * - Exact integer paise calculations; no binary floating-point.
 * - Extracts 12-digit UTR/RRN from narrations if available.
 * - Actionable row-level diagnostics for invalid or unparseable lines.
 * - Never assumes credit is salary or debit is ordinary expense.
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

export function parseSbiCsv(
  table: ParsedCsvTable,
  detection: FormatDetectionResult,
  options: StatementParserOptions = {}
): StatementParserResult {
  const records: StatementRecord[] = []
  const rejectedRows: RejectedRow[] = []
  const warnings: string[] = [...table.warnings]

  const batchId = options.batchId || `imp-batch-sbi-${Date.now()}`
  const sourceAccountId = options.sourceAccountId || 'acc-sbi-primary'
  const sourceAccountAlias = options.sourceAccountAlias || 'SBI Primary Savings'
  const statementFileId = options.statementFileId || 'sbi_statement.csv'
  const isDemo = Boolean(options.isDemo)

  // Map header lowercase names to column indices
  const headerMap = new Map<string, number>()
  table.headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim().replace(/[\s_\-]+/g, ' '), i))

  const dateIdx =
    headerMap.get('txn date') ??
    headerMap.get('transaction date') ??
    headerMap.get('date') ??
    -1

  const narrationIdx =
    headerMap.get('description') ??
    headerMap.get('narration') ??
    headerMap.get('particulars') ??
    -1

  const refIdx =
    headerMap.get('ref no./cheque no.') ??
    headerMap.get('chq./ref.no.') ??
    headerMap.get('ref no') ??
    headerMap.get('cheque no') ??
    -1

  const debitIdx =
    headerMap.get('debit') ??
    headerMap.get('withdrawal amt.') ??
    headerMap.get('withdrawal') ??
    headerMap.get('dr') ??
    -1

  const creditIdx =
    headerMap.get('credit') ??
    headerMap.get('deposit amt.') ??
    headerMap.get('deposit') ??
    headerMap.get('cr') ??
    -1

  const balanceIdx =
    headerMap.get('balance') ??
    headerMap.get('closing balance') ??
    -1

  if (dateIdx === -1 || narrationIdx === -1 || (debitIdx === -1 && creditIdx === -1)) {
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: ['SBI CSV missing essential columns (Date, Description, or Debit/Credit).'],
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
    const rowNum = r + 2 // 1-based, accounting for header row
    const fieldErrors: Record<string, string> = {}
    const rowWarnings: string[] = []

    // 1. Date parsing
    const rawDate = rawRow[dateIdx] || ''
    const dateParsed = parseStatementTimestamp(rawDate)
    if (!dateParsed.parsedIso) {
      fieldErrors.date = dateParsed.error || 'Invalid or unparseable date.'
    }
    if (dateParsed.warning) {
      rowWarnings.push(dateParsed.warning)
    }

    // 2. Narration
    const rawNarration = rawRow[narrationIdx] || ''
    const cleanDescription = cleanCounterpartyText(rawNarration)

    // 3. Amounts and Direction
    const rawDebit = debitIdx !== -1 ? rawRow[debitIdx] : ''
    const rawCredit = creditIdx !== -1 ? rawRow[creditIdx] : ''

    const hasDebit = rawDebit && rawDebit.trim() !== '' && rawDebit.trim() !== '0' && rawDebit.trim() !== '0.00'
    const hasCredit = rawCredit && rawCredit.trim() !== '' && rawCredit.trim() !== '0' && rawCredit.trim() !== '0.00'

    let direction: 'debit' | 'credit' = 'debit'
    let amountPaise = 0
    let debitPaise: number | undefined
    let creditPaise: number | undefined

    if (hasDebit && hasCredit) {
      fieldErrors.amount = `Row contains both Debit (${rawDebit}) and Credit (${rawCredit}) values.`
    } else if (!hasDebit && !hasCredit) {
      fieldErrors.amount = 'Row contains neither a Debit nor a Credit amount.'
    } else if (hasDebit) {
      direction = 'debit'
      const v = validateStatementMonetaryAmount(rawDebit)
      if (!v.valid || v.paise <= 0) {
        fieldErrors.debit = v.error || 'Invalid debit amount.'
      } else {
        amountPaise = v.paise
        debitPaise = v.paise
      }
    } else {
      direction = 'credit'
      const v = validateStatementMonetaryAmount(rawCredit)
      if (!v.valid || v.paise <= 0) {
        fieldErrors.credit = v.error || 'Invalid credit amount.'
      } else {
        amountPaise = v.paise
        creditPaise = v.paise
      }
    }

    // 4. Closing Balance (optional)
    let balanceAfterPaise: number | undefined
    if (balanceIdx !== -1 && rawRow[balanceIdx] && rawRow[balanceIdx].trim() !== '') {
      const b = validateStatementMonetaryAmount(rawRow[balanceIdx], true)
      if (b.valid) {
        balanceAfterPaise = b.paise
      }
    }

    // 5. Reference extraction
    const rawRef = refIdx !== -1 ? rawRow[refIdx] : ''
    let normalizedRef = normalizeTransactionReference(rawRef)
    if (!normalizedRef) {
      // Fallback: search narration for 12-digit UPI / UTR reference
      normalizedRef = normalizeTransactionReference(rawNarration)
    }

    // 6. Check for rejected row
    if (Object.keys(fieldErrors).length > 0) {
      rejectedRows.push({
        rowIndex: rowNum,
        rawRow,
        reason: Object.values(fieldErrors).join('; '),
        fieldErrors,
      })
      continue
    }

    // 7. Extract potential counterparty from UPI narration
    let counterparty: string | undefined
    const upiMatch = rawNarration.match(/UPI[/:\-_]+(?:\d+)[/:\-_]+(?:CR|DR)?[/:\-_]*([^/]+)/i)
    if (upiMatch && upiMatch[1]) {
      counterparty = cleanCounterpartyText(upiMatch[1])
    }

    // Aggregate statistics
    if (direction === 'debit') {
      debitCount++
      totalDebitPaise += amountPaise
    } else {
      creditCount++
      totalCreditPaise += amountPaise
    }

    const record: StatementRecord = {
      id: `stg-sbi-${rowNum}-${Date.now()}`,
      batchId,
      sourceProvider: 'sbi',
      sourceProviderRole: 'primary_ledger',
      sourceAccountId,
      sourceAccountAlias,
      statementFileId,
      originalRowIndex: rowNum,
      originalReference: rawRef || undefined,
      normalizedReference: normalizedRef,
      rawDateText: rawDate,
      parsedDate: dateParsed.parsedIso,
      rawDescription: rawNarration,
      cleanDescription: cleanDescription || rawNarration,
      counterparty,
      amountPaise,
      debitPaise,
      creditPaise,
      signedAmountPaise: direction === 'debit' ? -amountPaise : amountPaise,
      currency: 'INR',
      direction,
      balanceAfterPaise,
      metadata: {
        rawNarration,
        paymentChannel: rawNarration.toUpperCase().includes('UPI')
          ? 'UPI'
          : rawNarration.toUpperCase().includes('NEFT')
          ? 'NEFT'
          : rawNarration.toUpperCase().includes('IMPS')
          ? 'IMPS'
          : 'OTHER',
        chequeOrRefNo: rawRef || undefined,
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
