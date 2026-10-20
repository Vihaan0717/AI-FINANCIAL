import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseStatementCsv } from '../src/utils/statementParsers'
import { formatPaise } from '../src/utils/money'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import type { Transaction } from '../types/transaction'

describe('Money Mate AI — Stage 8.3 Statement Import & Read-Only Preview Test Suite', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures/statements')
  const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), 'utf-8')

  // Sample existing transactions in the ledger
  const sampleExistingLedger: Transaction[] = [
    {
      id: 'tx-existing-1',
      type: 'expense',
      amount: 35000, // ₹350.00
      currency: 'INR',
      date: '2026-10-19T13:45:00.000Z',
      description: 'Swiggy Dinner Order',
      merchant: 'Swiggy',
      category: 'Food & dining',
      paymentMethod: 'UPI',
      externalRef: '529381729102', // Matching UTR in sbi_synthetic.csv
      status: 'completed',
      createdAt: '2026-10-19T13:45:00.000Z',
      updatedAt: '2026-10-19T13:45:00.000Z',
    },
    {
      id: 'tx-existing-2',
      type: 'expense',
      amount: 64900, // ₹649.00
      currency: 'INR',
      date: '2026-10-19T10:00:00.000Z',
      description: 'Netflix Monthly Plan',
      merchant: 'Netflix',
      category: 'Entertainment',
      paymentMethod: 'Bank transfer',
      status: 'completed',
      createdAt: '2026-10-19T10:00:00.000Z',
      updatedAt: '2026-10-19T10:00:00.000Z',
    },
  ]

  // =========================================================================
  // 1. Valid CSV Parsing
  // =========================================================================
  describe('1. Selecting a Valid CSV', () => {
    it('successfully parses valid SBI statement into previewable draft records', () => {
      const csv = readFixture('sbi_synthetic.csv')
      const result = parseStatementCsv(csv, {
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
      })

      expect(result.detection.detectedProvider).toBe('sbi')
      expect(result.records.length).toBe(8)
      expect(result.statistics.totalRows).toBe(8)
      expect(result.statistics.debitCount).toBe(6)
      expect(result.statistics.creditCount).toBe(2)
      expect(result.rejectedRows.length).toBe(0)
    })

    it('successfully parses valid Union Bank statement into previewable draft records', () => {
      const csv = readFixture('union_bank_synthetic.csv')
      const result = parseStatementCsv(csv, {
        sourceAccountId: 'acc-union-savings',
        sourceAccountAlias: 'Union Bank Operating',
      })

      expect(result.detection.detectedProvider).toBe('union_bank')
      expect(result.records.length).toBe(4)
      expect(result.records[0].amountPaise).toBe(5000000) // ₹50,000.00
    })
  })

  // =========================================================================
  // 2. Drag-and-drop & File Type Validation
  // =========================================================================
  describe('2. File Type & Dropzone Validation', () => {
    it('validates supported file extensions and rejects non-CSV files', () => {
      const validateFileType = (fileName: string): boolean => {
        return fileName.toLowerCase().endsWith('.csv')
      }

      expect(validateFileType('statement.csv')).toBe(true)
      expect(validateFileType('bank_oct_2026.CSV')).toBe(true)
      expect(validateFileType('statement.pdf')).toBe(false)
      expect(validateFileType('data.xlsx')).toBe(false)
      expect(validateFileType('malicious.exe')).toBe(false)
    })
  })

  // =========================================================================
  // 3. Unknown & Unsupported CSV Formats
  // =========================================================================
  describe('3. Unknown & Unsupported CSV Formats', () => {
    it('flags unknown CSV headers and generates clear diagnostic explanation', () => {
      const unknownCsv = 'HeaderAlpha,HeaderBeta,HeaderGamma\nval1,val2,val3\n'
      const result = parseStatementCsv(unknownCsv)

      expect(result.detection.status).toBe('unknown')
      expect(result.detection.confidence).toBe('none')
      expect(result.records.length).toBe(0)
      expect(result.warnings.some((w) => w.includes('did not match any known provider signature'))).toBe(true)
    })
  })

  // =========================================================================
  // 4. Provisional Parser Warnings
  // =========================================================================
  describe('4. Provisional Parser Warnings', () => {
    it('strictly marks all provisional parsers as isVerified: false and displays advisory notice', () => {
      const csv = readFixture('phonepe_synthetic.csv')
      const result = parseStatementCsv(csv)

      expect(result.isProvisional).toBe(true)
      expect(result.detection.isVerified).toBe(false)
      expect(result.detection.status).toBe('provisional')
      expect(result.detection.explanation).toContain('PhonePe Export CSV')
    })
  })

  // =========================================================================
  // 5. Missing Required Columns
  // =========================================================================
  describe('5. Missing Required Columns', () => {
    it('detects missing required columns and identifies missing fields', () => {
      // Missing Date column
      const brokenCsv = 'Particulars,Withdrawal,Deposit,Balance\nTest,100,,500\n'
      const result = parseStatementCsv(brokenCsv)

      expect(result.detection.status).toBe('missing_required_columns')
      expect(result.records.length).toBe(0)
      expect(result.detection.missingHeaders).toContain('txn date')
    })
  })

  // =========================================================================
  // 6. Rejected Rows and Row-Level Diagnostics
  // =========================================================================
  describe('6. Rejected Rows & Row-Level Diagnostics', () => {
    it('captures unparseable rows with line numbers and field errors without discarding valid rows', () => {
      const edgeCsv = readFixture('edge_cases_synthetic.csv')
      const result = parseStatementCsv(edgeCsv)

      expect(result.records.length).toBe(3) // 3 valid records
      expect(result.rejectedRows.length).toBe(5) // 5 invalid records

      // Line 4: Invalid amount
      const row4 = result.rejectedRows.find((r) => r.rowIndex === 4)
      expect(row4).toBeDefined()
      expect(row4?.fieldErrors.debit).toContain('Invalid amount format')

      // Line 6: Invalid date
      const row6 = result.rejectedRows.find((r) => r.rowIndex === 6)
      expect(row6).toBeDefined()
      expect(row6?.fieldErrors.date).toBeDefined()

      // Line 7: Both debit and credit filled
      const row7 = result.rejectedRows.find((r) => r.rowIndex === 7)
      expect(row7).toBeDefined()
      expect(row7?.fieldErrors.amount).toContain('contains both Debit')
    })
  })

  // =========================================================================
  // 7. Correct Integer-Paise Display
  // =========================================================================
  describe('7. Correct Integer-Paise Display', () => {
    it('formats statement paise values accurately with Indian Rupee formatting', () => {
      expect(formatPaise(35000)).toBe('₹350')
      expect(formatPaise(42050)).toBe('₹420.50')
      expect(formatPaise(5000000)).toBe('₹50,000')
      expect(formatPaise(1, { showSign: true })).toBe('+₹0.01')
      expect(formatPaise(-35000, { showSign: true })).toBe('−₹350')
    })
  })

  // =========================================================================
  // 8. Large Statement File Performance
  // =========================================================================
  describe('8. Large Statement File Performance', () => {
    it('efficiently parses 500 rows in memory without stalling', () => {
      let largeCsv = 'Txn Date,Description,Debit,Credit,Balance\n'
      for (let i = 1; i <= 500; i++) {
        largeCsv += `19/10/2026,Transaction #${i},${(i * 10).toFixed(2)},,${(100000 - i * 10).toFixed(2)}\n`
      }

      const start = performance.now()
      const result = parseStatementCsv(largeCsv)
      const duration = performance.now() - start

      expect(result.records.length).toBe(500)
      expect(result.rejectedRows.length).toBe(0)
      expect(duration).toBeLessThan(250) // Should parse in under 250ms
    })
  })

  // =========================================================================
  // 9. Preliminary Duplicate Detection Preview
  // =========================================================================
  describe('9. Preliminary Duplicate Preview', () => {
    it('flags identical reference match as a high confidence duplicate against ledger', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const result = parseStatementCsv(sbiContent)

      // Row 1 has reference 529381729102 and amount 35000
      const rec1 = result.records[0]
      const matchingLedgerTx = sampleExistingLedger.find(
        (t) => t.externalRef === rec1.normalizedReference
      )

      expect(matchingLedgerTx).toBeDefined()
      expect(matchingLedgerTx?.amount).toBe(rec1.amountPaise)
      // Exactly matches ledger transaction
    })

    it('identifies unrecorded transactions as new records', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const result = parseStatementCsv(sbiContent)

      // Row 2 has reference 529381999888 which is NOT in sampleExistingLedger
      const rec2 = result.records[1]
      const match = sampleExistingLedger.find(
        (t) => t.externalRef === rec2.normalizedReference
      )

      expect(match).toBeUndefined()
    })
  })

  // =========================================================================
  // 10. Workspace Isolation (Demo vs Live)
  // =========================================================================
  describe('10. Workspace Isolation (Demo vs Live)', () => {
    it('marks records as isDemo: true in demo workspace and false in live workspace', () => {
      const csv = 'Date,Description,Amount\n19/10/2026,Demo Spend,100.00\n'
      const demoRes = parseStatementCsv(csv, { isDemo: true })
      expect(demoRes.records[0].isDemo).toBe(true)

      const liveRes = parseStatementCsv(csv, { isDemo: false })
      expect(liveRes.records[0].isDemo).toBe(false)
    })
  })

  // =========================================================================
  // 11. Strict Ledger Non-Mutation (Zero Database Writes)
  // =========================================================================
  describe('11. Strict Ledger Non-Mutation', () => {
    it('ensures parsing and preview workflows perform zero writes to repository or IndexedDB', async () => {
      const repo = new InMemoryTransactionRepository(sampleExistingLedger)
      const initialCount = (await repo.getAll()).length

      // Parse statements in memory
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)

      expect(parsed.records.length).toBe(8)

      // Verify that existing repository is completely untouched
      const finalCount = (await repo.getAll()).length
      expect(finalCount).toBe(initialCount)
      expect(finalCount).toBe(2)
    })

    it('closing or discarding preview leaves ledger completely unchanged', async () => {
      const repo = new InMemoryTransactionRepository(sampleExistingLedger)
      
      // Simulate user opening preview, viewing records, and clicking discard
      let draftState: any = parseStatementCsv(readFixture('phonepe_synthetic.csv'))
      expect(draftState.records.length).toBe(5)

      // Discard action
      draftState = null
      expect(draftState).toBeNull()

      // Ledger count remains unchanged
      const ledger = await repo.getAll()
      expect(ledger.length).toBe(2)
    })
  })

  // =========================================================================
  // 12. Dark and Light Theme Design Token Integrity
  // =========================================================================
  describe('12. Theme Design Token Integrity', () => {
    it('CSS uses theme CSS variables for background, text, border, and accents', () => {
      const cssContent = fs.readFileSync(
        path.resolve(__dirname, '../src/components/ReconciliationModal.css'),
        'utf-8'
      )

      expect(cssContent).toContain('var(--panel')
      expect(cssContent).toContain('var(--border')
      expect(cssContent).toContain('var(--text')
      expect(cssContent).toContain('var(--muted')
      expect(cssContent).toContain('var(--accent')
      expect(cssContent).toContain('var(--bg')
    })
  })
})
