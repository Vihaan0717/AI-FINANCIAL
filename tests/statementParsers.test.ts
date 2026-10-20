import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  parseCsv,
  detectStatementFormat,
  parseStatementCsv,
  parseSbiCsv,
  parseUnionBankCsv,
  parsePhonePeCsv,
  parsePaytmCsv,
  parseSliceCsv,
} from '../src/utils/statementParsers'

describe('Money Mate AI — Stage 8.2 Client-Side Statement Parsers Test Suite', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures/statements')

  const readFixture = (filename: string): string => {
    return fs.readFileSync(path.join(fixturesDir, filename), 'utf-8')
  }

  // =========================================================================
  // 1. CSV Reader Unit Tests
  // =========================================================================
  describe('1. CSV Reader Engine (RFC 4180)', () => {
    it('detects and strips UTF-8 BOM', () => {
      const csvWithBom = '\uFEFFDate,Description,Amount\n19/10/2026,Coffee,150.00\n'
      const table = parseCsv(csvWithBom)

      expect(table.bomDetected).toBe(true)
      expect(table.headers).toEqual(['Date', 'Description', 'Amount'])
      expect(table.rows.length).toBe(1)
      expect(table.rows[0]).toEqual(['19/10/2026', 'Coffee', '150.00'])
    })

    it('handles quoted fields containing commas and spaces', () => {
      const csv = 'Date,Description,Amount\n19/10/2026,"Grocery, Milk, Bread",250.00\n'
      const table = parseCsv(csv)

      expect(table.rows.length).toBe(1)
      expect(table.rows[0][1]).toBe('Grocery, Milk, Bread')
    })

    it('handles escaped double quotes within quoted cells', () => {
      const csv = 'Date,Description,Amount\n19/10/2026,"Café ""Espresso"" Lounge",300.00\n'
      const table = parseCsv(csv)

      expect(table.rows.length).toBe(1)
      expect(table.rows[0][1]).toBe('Café "Espresso" Lounge')
    })

    it('handles CRLF and LF line endings and detects lineEnding', () => {
      const crlfCsv = 'Header1,Header2\r\nValue1,Value2\r\n'
      const crlfTable = parseCsv(crlfCsv)
      expect(crlfTable.lineEnding).toBe('CRLF')
      expect(crlfTable.rows.length).toBe(1)

      const lfCsv = 'Header1,Header2\nValue1,Value2\n'
      const lfTable = parseCsv(lfCsv)
      expect(lfTable.lineEnding).toBe('LF')
      expect(lfTable.rows.length).toBe(1)
    })

    it('disambiguates duplicate column headers with diagnostic warnings', () => {
      const duplicateHeadersCsv = 'Date,Amount,Description,Amount\n19/10/2026,100,Test,200\n'
      const table = parseCsv(duplicateHeadersCsv)

      expect(table.headers).toEqual(['Date', 'Amount', 'Description', 'Amount_2'])
      expect(table.warnings.some((w) => w.includes('Duplicate column header'))).toBe(true)
    })

    it('preserves empty fields correctly', () => {
      const csv = 'A,B,C,D\n1,,3,\n'
      const table = parseCsv(csv)

      expect(table.rows.length).toBe(1)
      expect(table.rows[0]).toEqual(['1', '', '3', ''])
    })

    it('skips trailing whitespace-only empty rows', () => {
      const csv = 'Col1,Col2\nVal1,Val2\n   \n\n'
      const table = parseCsv(csv, { skipEmptyRows: true })

      expect(table.rows.length).toBe(1)
      expect(table.rows[0]).toEqual(['Val1', 'Val2'])
    })

    it('handles unclosed quotes without throwing and reports diagnostic warning', () => {
      const malformedCsv = 'Date,Description,Amount\n19/10/2026,"Unclosed description,150.00'
      const table = parseCsv(malformedCsv)

      expect(table.warnings.some((w) => w.includes('Unclosed quote'))).toBe(true)
      expect(table.rows.length).toBe(1)
    })
  })

  // =========================================================================
  // 2. Format Detection Tests
  // =========================================================================
  describe('2. Statement Format Detection', () => {
    it('detects SBI CSV format and marks as provisional with isVerified: false', () => {
      const headers = ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('provisional')
      expect(res.detectedProvider).toBe('sbi')
      expect(res.isVerified).toBe(false) // Strict rule: provisional until verified on real statements
      expect(res.confidence).toBe('high')
    })

    it('detects Union Bank CSV format as provisional', () => {
      const headers = ['Date', 'Remarks', 'Cheque No', 'Withdrawal (DR)', 'Deposit (CR)', 'Balance']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('provisional')
      expect(res.detectedProvider).toBe('union_bank')
      expect(res.isVerified).toBe(false)
    })

    it('detects PhonePe CSV format as provisional', () => {
      const headers = ['Date', 'Transaction ID', 'Payment To', 'Type', 'Amount', 'Status']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('provisional')
      expect(res.detectedProvider).toBe('phonepe')
      expect(res.isVerified).toBe(false)
    })

    it('detects Paytm CSV format as provisional', () => {
      const headers = ['Date', 'Time', 'Transaction Details', 'Order ID', 'Activity', 'Amount', 'Status']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('provisional')
      expect(res.detectedProvider).toBe('paytm')
      expect(res.isVerified).toBe(false)
    })

    it('detects Slice CSV format as provisional', () => {
      const headers = ['Date', 'Description', 'Txn Type', 'Amount', 'Category', 'Reference ID']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('provisional')
      expect(res.detectedProvider).toBe('slice')
      expect(res.isVerified).toBe(false)
    })

    it('detects Generic CSV when headers contain Date, Description, and Amount', () => {
      const headers = ['Date', 'Description', 'Amount']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('provisional')
      expect(res.detectedProvider).toBe('generic_csv')
      expect(res.isVerified).toBe(false)
    })

    it('flags missing_required_columns when required columns are absent', () => {
      // Missing date column
      const headers = ['Description', 'Debit', 'Credit', 'Balance']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('missing_required_columns')
      expect(res.missingHeaders.length).toBeGreaterThan(0)
    })

    it('reports unknown format when headers do not match any provider signature', () => {
      const headers = ['Random_A', 'Random_B', 'Random_C']
      const res = detectStatementFormat(headers)

      expect(res.status).toBe('unknown')
      expect(res.confidence).toBe('none')
    })
  })

  // =========================================================================
  // 3. State Bank of India (SBI) Parser Tests
  // =========================================================================
  describe('3. SBI CSV Parser', () => {
    it('parses synthetic SBI statement fixture into valid StatementRecord list', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const result = parseStatementCsv(sbiContent, {
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
        statementFileId: 'sbi_sample.csv',
      })

      expect(result.detection.detectedProvider).toBe('sbi')
      expect(result.isProvisional).toBe(true)
      expect(result.records.length).toBe(8)
      expect(result.rejectedRows.length).toBe(0)

      // Test Row 1: Swiggy debit
      const rec1 = result.records[0]
      expect(rec1.amountPaise).toBe(35000) // ₹350.00
      expect(rec1.debitPaise).toBe(35000)
      expect(rec1.creditPaise).toBeUndefined()
      expect(rec1.signedAmountPaise).toBe(-35000)
      expect(rec1.direction).toBe('debit')
      expect(rec1.normalizedReference).toBe('529381729102')
      expect(rec1.counterparty).toBe('SWIGGY')
      expect(rec1.balanceAfterPaise).toBe(1250000) // ₹12,500.00
      expect(rec1.sourceProviderRole).toBe('primary_ledger')
      expect(rec1.proposedType).toBe('expense')

      // Test Row 6: Salary credit
      const rec6 = result.records[5]
      expect(rec6.amountPaise).toBe(8500000) // ₹85,000.00
      expect(rec6.direction).toBe('credit')
      expect(rec6.creditPaise).toBe(8500000)
      expect(rec6.signedAmountPaise).toBe(8500000)
      expect(rec6.balanceAfterPaise).toBe(10878050)
      expect(rec6.proposedType).toBe('income')

      // Verify statistics
      expect(result.statistics.debitCount).toBe(6)
      expect(result.statistics.creditCount).toBe(2)
      expect(result.statistics.totalDebitPaise).toBe(35000 + 42050 + 200000 + 5000000 + 2000 + 2000)
      expect(result.statistics.totalCreditPaise).toBe(129900 + 8500000)
    })
  })

  // =========================================================================
  // 4. Union Bank of India Parser Tests
  // =========================================================================
  describe('4. Union Bank of India CSV Parser', () => {
    it('parses synthetic Union Bank fixture with correct withdrawal and deposit mapping', () => {
      const unionContent = readFixture('union_bank_synthetic.csv')
      const result = parseStatementCsv(unionContent, {
        sourceAccountId: 'acc-union-savings',
        sourceAccountAlias: 'Union Bank Operating',
      })

      expect(result.detection.detectedProvider).toBe('union_bank')
      expect(result.records.length).toBe(4)
      expect(result.rejectedRows.length).toBe(0)

      // Row 1: Transfer credit
      const rec1 = result.records[0]
      expect(rec1.amountPaise).toBe(5000000) // ₹50,000.00
      expect(rec1.direction).toBe('credit')
      expect(rec1.creditPaise).toBe(5000000)
      expect(rec1.normalizedReference).toBe('529381000111')
      expect(rec1.balanceAfterPaise).toBe(7500000)

      // Row 2: Netflix debit
      const rec2 = result.records[1]
      expect(rec2.amountPaise).toBe(64900) // ₹649.00
      expect(rec2.direction).toBe('debit')
      expect(rec2.normalizedReference).toBe('529381667788')
    })
  })

  // =========================================================================
  // 5. PhonePe, Paytm, Slice Enrichment Parsers
  // =========================================================================
  describe('5. Supplementary UPI Enrichment Parsers', () => {
    it('parses PhonePe export with merchant names and flags failed transactions', () => {
      const phonepeContent = readFixture('phonepe_synthetic.csv')
      const result = parseStatementCsv(phonepeContent)

      expect(result.detection.detectedProvider).toBe('phonepe')
      expect(result.records.length).toBe(5)
      expect(result.records[0].sourceProviderRole).toBe('enrichment_source')
      expect(result.records[0].counterparty).toBe('Swiggy')
      expect(result.records[0].amountPaise).toBe(35000)

      // Failed Uber ride row
      const failedRec = result.records[2]
      expect(failedRec.status).toBe('failed')
      expect(failedRec.metadata.paymentStatus).toBe('Failed')
      expect(failedRec.warnings.some((w) => w.includes('Excluded from active financial totals'))).toBe(true)
    })

    it('parses real PhonePe system-generated format with multiline Transaction Details, UTR, and Indian Rupee symbols', () => {
      const realFormatCsv = `Date,Transaction Details,Type,Amount
"Oct 18, 2026 03:17 pm","Paid to slice small finance bank limited\nTransaction ID T2610181517124664077348\nUTR No. 653418482649\nPaid by XXXX5200",DEBIT,"₹7,000"
"Oct 18, 2026 02:21 pm","Received from Annaya Hema Sai\nTransaction ID T2610181421468393051240\nUTR No. 929806481745\nCredited to XXXX5200",CREDIT,"₹7,000"
"Sept 26, 2026 08:22 pm","Refund from CTRLX TECHNOLOGIES PRIVATE LIMITED\nTransaction ID T2609262022460539510804\nUTR No. 635143327925\nCredited to XXXX5200",CREDIT,"₹54.33"
"Aug 25, 2026 02:31 pm","Transfer to XXXXXX3938\nTransaction ID T2608251431103440936030\nUTR No. 190292218332\nPaid by XXXX5200",DEBIT,"₹2,000"
"Oct 17, 2026 04:42 pm","Mobile recharged 9154716156\nTransaction ID NB26101716422971577716472\nUTR No. 679888871415\nAirtel Prepaid Reference ID 161490470\nPaid by slice XXXX2051",DEBIT,"₹49"`

      const result = parseStatementCsv(realFormatCsv)
      expect(result.detection.detectedProvider).toBe('phonepe')
      expect(result.records.length).toBe(5)
      expect(result.rejectedRows.length).toBe(0)

      // Row 1: Slice bank debit
      const rec1 = result.records[0]
      expect(rec1.amountPaise).toBe(700000) // ₹7,000.00
      expect(rec1.direction).toBe('debit')
      expect(rec1.proposedType).toBe('expense')
      expect(rec1.normalizedReference).toBe('653418482649') // Extracted UTR
      expect(rec1.counterparty).toContain('slice small finance bank')
      expect(rec1.parsedDate).toBe('2026-10-18T15:17:00.000Z')

      // Row 2: Credit from Annaya Hema Sai
      const rec2 = result.records[1]
      expect(rec2.amountPaise).toBe(700000)
      expect(rec2.direction).toBe('credit')
      expect(rec2.proposedType).toBe('income')
      expect(rec2.normalizedReference).toBe('929806481745')

      // Row 3: Refund with fractional paise and Sept month
      const rec3 = result.records[2]
      expect(rec3.amountPaise).toBe(5433) // ₹54.33
      expect(rec3.direction).toBe('credit')
      expect(rec3.proposedType).toBe('refund')
      expect(rec3.normalizedReference).toBe('635143327925')
      expect(rec3.parsedDate).toBe('2026-09-26T20:22:00.000Z')

      // Row 4: Internal self-transfer
      const rec4 = result.records[3]
      expect(rec4.amountPaise).toBe(200000) // ₹2,000.00
      expect(rec4.proposedType).toBe('transfer')
      expect(rec4.proposedCategory).toBe('Transfer')

      // Row 5: Mobile recharge
      const rec5 = result.records[4]
      expect(rec5.amountPaise).toBe(4900) // ₹49.00
      expect(rec5.counterparty).toContain('Mobile Recharge')
    })

    it('parses Paytm export and extracts order ID and activities', () => {
      const paytmContent = readFixture('paytm_synthetic.csv')
      const result = parseStatementCsv(paytmContent)

      expect(result.detection.detectedProvider).toBe('paytm')
      expect(result.records.length).toBe(3)

      const rec1 = result.records[0]
      expect(rec1.amountPaise).toBe(185000) // ₹1,850.00
      expect(rec1.normalizedReference).toBe('BB48192')
      expect(rec1.originalReference).toBe('ORDER_BB_48192')

      const cashbackRec = result.records[1]
      expect(cashbackRec.direction).toBe('credit')
      expect(cashbackRec.amountPaise).toBe(5000) // ₹50.00
    })

    it('parses Slice export and extracts category tags', () => {
      const sliceContent = readFixture('slice_synthetic.csv')
      const result = parseStatementCsv(sliceContent)

      expect(result.detection.detectedProvider).toBe('slice')
      expect(result.records.length).toBe(3)

      const rec1 = result.records[0]
      expect(rec1.amountPaise).toBe(459900) // ₹4,599.00
      expect(rec1.counterparty).toBe('Zara Retail Koramangala')
      expect(rec1.metadata.categoryHint).toBe('Shopping')
    })
  })

  // =========================================================================
  // 6. Edge Cases & Row Rejection Diagnostics
  // =========================================================================
  describe('6. Edge Cases & Actionable Row Rejection Diagnostics', () => {
    it('correctly rejects invalid rows with detailed diagnostics without discarding valid rows', () => {
      const edgeContent = readFixture('edge_cases_synthetic.csv')
      const result = parseStatementCsv(edgeContent)

      // Valid rows in fixture: Row 2 (Grocery), Row 3 (Café), Row 9 (Valid Row After Errors) = 3 valid records
      expect(result.records.length).toBe(3)
      // Rejected rows: Invalid Amount, Excess Precision, Invalid Date, Both Dr & Cr, Neither Dr nor Cr = 5 rejected rows
      expect(result.rejectedRows.length).toBe(5)

      // Check Row 4: Invalid Amount Row ('abc')
      const errAmount = result.rejectedRows.find((r) => r.rowIndex === 4)
      expect(errAmount).toBeDefined()
      expect(errAmount?.fieldErrors.debit).toContain('Invalid amount format')

      // Check Row 5: Excess Precision ('10.999')
      const errPrecision = result.rejectedRows.find((r) => r.rowIndex === 5)
      expect(errPrecision).toBeDefined()
      expect(errPrecision?.fieldErrors.debit).toContain('at most 2 decimal places')

      // Check Row 6: Invalid Date ('not_a_date')
      const errDate = result.rejectedRows.find((r) => r.rowIndex === 6)
      expect(errDate).toBeDefined()
      expect(errDate?.fieldErrors.date).toBeDefined()

      // Check Row 7: Both Debit and Credit Filled
      const errBoth = result.rejectedRows.find((r) => r.rowIndex === 7)
      expect(errBoth).toBeDefined()
      expect(errBoth?.fieldErrors.amount).toContain('contains both Debit')

      // Check Row 8: Neither Debit nor Credit Filled
      const errNeither = result.rejectedRows.find((r) => r.rowIndex === 8)
      expect(errNeither).toBeDefined()
      expect(errNeither?.fieldErrors.amount).toContain('neither a Debit nor a Credit')

      // Confirm valid rows still parsed with exact paise
      const validRec1 = result.records[0]
      expect(validRec1.cleanDescription).toBe('Grocery, Milk & Eggs')
      expect(validRec1.amountPaise).toBe(15000) // ₹150.00

      const validRec2 = result.records[1]
      expect(validRec2.cleanDescription).toBe('Café "Espresso" Delight')
      expect(validRec2.amountPaise).toBe(22000) // ₹220.00
    })
  })

  // =========================================================================
  // 7. Workspace Isolation & Non-Destructive In-Memory Boundaries
  // =========================================================================
  describe('7. Workspace Isolation & In-Memory Boundaries', () => {
    it('respects isDemo flag on generated StatementRecords', () => {
      const csv = 'Date,Description,Amount\n19/10/2026,Lunch,200.00\n'
      const demoResult = parseStatementCsv(csv, { isDemo: true })
      expect(demoResult.records[0].isDemo).toBe(true)

      const liveResult = parseStatementCsv(csv, { isDemo: false })
      expect(liveResult.records[0].isDemo).toBe(false)
    })
  })
})
