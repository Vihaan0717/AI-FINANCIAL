/**
 * Union Bank of India Provisional CSV Parser
 * Money Mate AI — Stage 8.2
 * 
 * Strict architectural rules:
 * - Provider role: 'primary_ledger' (authoritative bank debits/credits/balances).
 * - Exact integer paise calculations; no binary floating-point.
 * - Extracts Cheque No and UTR references from remarks/narration.
 * - Row-level diagnostics for invalid or unparseable lines.
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

export function parseUnionBankCsv(
  table: ParsedCsvTable,
  detection: FormatDetectionResult,
  options: StatementParserOptions = {}
): StatementParserResult {
  const records: StatementRecord[] = []
  const rejectedRows: RejectedRow[] = []
  const warnings: string[] = [...table.warnings]

  const batchId = options.batchId || `imp-batch-union-${Date.now()}`
  const sourceAccountId = options.sourceAccountId || 'acc-union-savings'
  const sourceAccountAlias = options.sourceAccountAlias || 'Union Bank Operating'
  const statementFileId = options.statementFileId || 'union_bank_statement.csv'
  const isDemo = Boolean(options.isDemo)

  const headerMap = new Map<string, number>()
  table.headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim().replace(/[\s_\-]+/g, ' '), i))

  const dateIdx =
    headerMap.get('date') ??
    headerMap.get('txn date') ??
    headerMap.get('tran date') ??
    -1

  const narrationIdx =
    headerMap.get('remarks') ??
    headerMap.get('narration') ??
    headerMap.get('transaction remarks') ??
    headerMap.get('particulars') ??
    -1

  const refIdx =
    headerMap.get('cheque no') ??
    headerMap.get('chq no') ??
    headerMap.get('ref no') ??
    -1

  const debitIdx =
    headerMap.get('withdrawal (dr)') ??
    headerMap.get('withdrawal') ??
    headerMap.get('debit (dr)') ??
    headerMap.get('dr amount') ??
    -1

  const creditIdx =
    headerMap.get('deposit (cr)') ??
    headerMap.get('deposit') ??
    headerMap.get('credit (cr)') ??
    headerMap.get('cr amount') ??
    -1

  const balanceIdx =
    headerMap.get('account balance') ??
    headerMap.get('balance (inr)') ??
    headerMap.get('balance') ??
    -1

  if (dateIdx === -1 || narrationIdx === -1 || (debitIdx === -1 && creditIdx === -1)) {
    return {
      detection,
      records: [],
      rejectedRows: [],
      warnings: ['Union Bank CSV missing essential columns (Date, Remarks/Narration, or Withdrawal/Deposit).'],
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

    // 2. Narration
    const rawNarration = rawRow[narrationIdx] || ''
    const cleanDescription = cleanCounterpartyText(rawNarration)

    // 3. Amounts & Direction
    const rawDebit = debitIdx !== -1 ? rawRow[debitIdx] : ''
    const rawCredit = creditIdx !== -1 ? rawRow[creditIdx] : ''

    const hasDebit = rawDebit && rawDebit.trim() !== '' && rawDebit.trim() !== '0' && rawDebit.trim() !== '0.00'
    const hasCredit = rawCredit && rawCredit.trim() !== '' && rawCredit.trim() !== '0' && rawCredit.trim() !== '0.00'

    let direction: 'debit' | 'credit' = 'debit'
    let amountPaise = 0
    let debitPaise: number | undefined
    let creditPaise: number | undefined

    if (hasDebit && hasCredit) {
      fieldErrors.amount = `Row contains both Withdrawal (${rawDebit}) and Deposit (${rawCredit}) amounts.`
    } else if (!hasDebit && !hasCredit) {
      fieldErrors.amount = 'Row contains neither a Withdrawal nor a Deposit amount.'
    } else if (hasDebit) {
      direction = 'debit'
      const v = validateStatementMonetaryAmount(rawDebit)
      if (!v.valid || v.paise <= 0) {
        fieldErrors.debit = v.error || 'Invalid withdrawal amount.'
      } else {
        amountPaise = v.paise
        debitPaise = v.paise
      }
    } else {
      direction = 'credit'
      const v = validateStatementMonetaryAmount(rawCredit)
      if (!v.valid || v.paise <= 0) {
        fieldErrors.credit = v.error || 'Invalid deposit amount.'
      } else {
        amountPaise = v.paise
        creditPaise = v.paise
      }
    }

    // 4. Closing Balance
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

    // 7. Counterparty extraction
    let counterparty: string | undefined
    const upiMatch = rawNarration.match(/UPI[/:\-_]+(?:\d+)[/:\-_]+(?:CR|DR)?[/:\-_]*([^/]+)/i)
    if (upiMatch && upiMatch[1]) {
      counterparty = cleanCounterpartyText(upiMatch[1])
    }

    if (direction === 'debit') {
      debitCount++
      totalDebitPaise += amountPaise
    } else {
      creditCount++
      totalCreditPaise += amountPaise
    }

    // Classify transfers, repayments, and income
    const isTransferNarration = /transfer to|trf to|to own|self trf|self transfer|slice|card pay|credit card/i.test(
      rawNarration + ' ' + (cleanDescription || '')
    )
    const isExplicitIncome = /salary|payroll|dividend|interest|pension|stipend/i.test(
      rawNarration + ' ' + (cleanDescription || '')
    )

    let proposedType: 'income' | 'expense' | 'transfer' = direction === 'credit' ? 'income' : 'expense'
    let proposedCategory = direction === 'credit' ? 'Income' : 'Other'

    if (isTransferNarration) {
      proposedType = 'transfer'
      proposedCategory = 'Transfer'
    } else if (direction === 'credit') {
      if (isExplicitIncome) {
        proposedType = 'income'
        proposedCategory = 'Income'
      } else if (/transfer|trf|upi|imps|neft/i.test(rawNarration)) {
        proposedType = 'transfer'
        proposedCategory = 'Transfer'
      }
    }

    const record: StatementRecord = {
      id: `stg-union-${rowNum}-${Date.now()}`,
      batchId,
      sourceProvider: 'union_bank',
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
      proposedType,
      proposedCategory,
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
