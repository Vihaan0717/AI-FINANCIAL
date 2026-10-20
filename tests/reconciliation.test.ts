import { describe, it, expect } from 'vitest'
import {
  validateStatementMonetaryAmount,
  normalizeTransactionReference,
  parseStatementTimestamp,
  detectReferenceConflict,
  cleanCounterpartyText,
} from '../src/utils/reconciliationValidation'
import {
  evaluateStatementRecordMatch,
  evaluateTransferCandidate,
  buildCanonicalFinancialEvent,
  calculateBatchStatistics,
  calculateTextSimilarity,
} from '../src/utils/reconciliationRules'
import { calculateFinancialSummary } from '../src/utils/calculations'
import type {
  StatementRecord,
  AccountDefinition,
  ImportBatch,
  BatchRollbackManifest,
} from '../src/types/reconciliation'
import type { Transaction } from '../src/types/transaction'

describe('Money Mate AI — Stage 8.1 Statement Import & Reconciliation Domain Suite', () => {
  // Synthetic Test Fixtures: Accounts
  const sbiAccount: AccountDefinition = {
    id: 'acc-sbi-primary',
    institution: 'SBI',
    alias: 'SBI Primary Savings',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
    isDemo: false,
  }

  const unionBankAccount: AccountDefinition = {
    id: 'acc-union-savings',
    institution: 'Union Bank of India',
    alias: 'Union Bank Operating',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
    isDemo: false,
  }

  const ownedAccountsMap = new Map<string, AccountDefinition>([
    [sbiAccount.id, sbiAccount],
    [unionBankAccount.id, unionBankAccount],
  ])

  // Synthetic Test Fixtures: Base records
  const createSyntheticRecord = (overrides?: Partial<StatementRecord>): StatementRecord => ({
    id: 'stg-rec-001',
    batchId: 'imp-batch-001',
    sourceProvider: 'sbi',
    sourceProviderRole: 'primary_ledger',
    sourceAccountId: sbiAccount.id,
    sourceAccountAlias: sbiAccount.alias,
    statementFileId: 'stmt-sbi-oct2026.csv',
    originalRowIndex: 12,
    originalReference: 'UPI/529381729102/CR/Swiggy',
    normalizedReference: '529381729102',
    rawDateText: '19/10/2026 13:45:00',
    parsedDate: '2026-10-19T13:45:00.000Z',
    rawDescription: 'UPI/529381729102/DR/SWIGGY/BANGALORE',
    cleanDescription: 'SWIGGY BANGALORE',
    counterparty: 'Swiggy',
    amountPaise: 35000, // ₹350.00
    debitPaise: 35000,
    creditPaise: undefined,
    signedAmountPaise: -35000,
    currency: 'INR',
    direction: 'debit',
    balanceAfterPaise: 1250000, // ₹12,500.00
    metadata: {
      rawNarration: 'UPI/529381729102/DR/SWIGGY/BANGALORE',
      paymentChannel: 'UPI',
    },
    warnings: [],
    errors: [],
    proposedType: 'expense',
    proposedCategory: 'Food & dining',
    status: 'staged',
    reviewStatus: 'pending',
    matchCandidateIds: [],
    matchConfidence: 'none',
    isDemo: false,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  })

  // =========================================================================
  // 1. Valid and Invalid Monetary Values
  // =========================================================================
  describe('1. Valid and Invalid Monetary Values', () => {
    it('accepts valid numeric and string monetary amounts', () => {
      expect(validateStatementMonetaryAmount(100)).toEqual({ valid: true, paise: 10000 })
      expect(validateStatementMonetaryAmount(100.5)).toEqual({ valid: true, paise: 10050 })
      expect(validateStatementMonetaryAmount('250.75')).toEqual({ valid: true, paise: 25075 })
      expect(validateStatementMonetaryAmount('1,500.00')).toEqual({ valid: true, paise: 150000 })
      // For balance verification, zero is accepted when explicitly allowed
      expect(validateStatementMonetaryAmount(0, true)).toEqual({ valid: true, paise: 0 })
      expect(validateStatementMonetaryAmount('0.00', true)).toEqual({ valid: true, paise: 0 })
    })

    it('rejects invalid, negative, NaN, non-finite, and default zero-value transaction amounts', () => {
      expect(validateStatementMonetaryAmount(0).valid).toBe(false)
      expect(validateStatementMonetaryAmount('0.00').valid).toBe(false)
      expect(validateStatementMonetaryAmount(NaN).valid).toBe(false)
      expect(validateStatementMonetaryAmount(Infinity).valid).toBe(false)
      expect(validateStatementMonetaryAmount(-50).valid).toBe(false)
      expect(validateStatementMonetaryAmount('-100.00').valid).toBe(false)
      expect(validateStatementMonetaryAmount('invalid_amount').valid).toBe(false)
      expect(validateStatementMonetaryAmount('').valid).toBe(false)
      expect(validateStatementMonetaryAmount(null).valid).toBe(false)
      expect(validateStatementMonetaryAmount(undefined).valid).toBe(false)
    })

    it('rejects monetary values with precision exceeding 2 decimal places', () => {
      const result = validateStatementMonetaryAmount('10.999')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('at most 2 decimal places')
    })
  })

  // =========================================================================
  // 2. Paise Precision (Exact Arithmetic)
  // =========================================================================
  describe('2. Exact Paise Precision', () => {
    it('accurately converts 1 paisa and fractional rupee amounts without floating-point error', () => {
      expect(validateStatementMonetaryAmount('0.01')).toEqual({ valid: true, paise: 1 })
      expect(validateStatementMonetaryAmount('0.10')).toEqual({ valid: true, paise: 10 })
      expect(validateStatementMonetaryAmount('99.99')).toEqual({ valid: true, paise: 9999 })
      expect(validateStatementMonetaryAmount('1000000.00')).toEqual({ valid: true, paise: 100000000 })
    })
  })

  // =========================================================================
  // 3. Missing References & Heuristics
  // =========================================================================
  describe('3. Missing References & Safe Fallbacks', () => {
    it('normalizes standard 12-digit UPI / RRN numbers from complex narrations', () => {
      expect(normalizeTransactionReference('UPI/529381729102/CR/Swiggy')).toBe('529381729102')
      expect(normalizeTransactionReference('RRN: 529381729102')).toBe('529381729102')
      expect(normalizeTransactionReference('529381729102')).toBe('529381729102')
      expect(normalizeTransactionReference('PAYTM12345678')).toBe('PAYTM12345678')
    })

    it('returns undefined for missing, empty, or placeholder references', () => {
      expect(normalizeTransactionReference(undefined)).toBeUndefined()
      expect(normalizeTransactionReference('')).toBeUndefined()
      expect(normalizeTransactionReference('NA')).toBeUndefined()
      expect(normalizeTransactionReference('N/A')).toBeUndefined()
      expect(normalizeTransactionReference('NIL')).toBeUndefined()
      expect(normalizeTransactionReference('-')).toBeUndefined()
    })

    it('flags match without references as a review candidate and NEVER automatically merges', () => {
      const bankRecord = createSyntheticRecord({
        id: 'rec-bank-01',
        normalizedReference: undefined,
        originalReference: undefined,
        counterparty: 'Starbucks Coffee',
      })
      const phonePeRecord = createSyntheticRecord({
        id: 'rec-phonepe-01',
        sourceProvider: 'phonepe',
        sourceProviderRole: 'enrichment_source',
        normalizedReference: undefined,
        originalReference: undefined,
        counterparty: 'Starbucks Coffee Bangalore',
      })

      const match = evaluateStatementRecordMatch(bankRecord, phonePeRecord)
      expect(match.isMatchCandidate).toBe(true)
      expect(match.confidence).toBe('medium')
      expect(match.canAutoMerge).toBe(false) // Strict rule: user review required
      expect(match.reason).toContain('Requires user confirmation')
    })

    it('refuses to merge two transactions that only share date and amount with no counterparty or reference match', () => {
      const teaShop1 = createSyntheticRecord({
        id: 'rec-chai-1',
        amountPaise: 2000, // ₹20.00
        cleanDescription: 'CHAI POINT INDIRANAGAR',
        counterparty: 'Chai Point',
        normalizedReference: undefined,
      })
      const teaShop2 = createSyntheticRecord({
        id: 'rec-chai-2',
        amountPaise: 2000, // ₹20.00
        cleanDescription: 'AMRIT TULSI TEA KORAMANGALA',
        counterparty: 'Amrit Tulsi',
        normalizedReference: undefined,
      })

      const match = evaluateStatementRecordMatch(teaShop1, teaShop2)
      // Must NOT be treated as a match candidate: legitimate distinct purchases on same day
      expect(match.isMatchCandidate).toBe(false)
      expect(match.canAutoMerge).toBe(false)
      expect(match.confidence).toBe('low')
    })
  })

  // =========================================================================
  // 4. Timestamp Formats
  // =========================================================================
  describe('4. Different Timestamp Formats', () => {
    it('correctly parses ISO, DD/MM/YYYY, DD-MM-YYYY, and DD-MMM-YYYY dates', () => {
      // ISO
      const isoRes = parseStatementTimestamp('2026-10-19T10:30:00Z')
      expect(isoRes.parsedIso).toBe('2026-10-19T10:30:00.000Z')

      // DD/MM/YYYY
      const ddmmyyyyRes = parseStatementTimestamp('19/10/2026')
      expect(ddmmyyyyRes.parsedIso).toBe('2026-10-19T00:00:00.000Z')

      // DD-MM-YYYY HH:mm:ss
      const ddmmyyyyTimeRes = parseStatementTimestamp('19-10-2026 14:30:00')
      expect(ddmmyyyyTimeRes.parsedIso).toBe('2026-10-19T14:30:00.000Z')

      // DD-MMM-YYYY
      const ddMmmYyyyRes = parseStatementTimestamp('19-OCT-2026')
      expect(ddMmmYyyyRes.parsedIso).toBe('2026-10-19T00:00:00.000Z')

      // 12-hour AM/PM format
      const ampmRes = parseStatementTimestamp('19/10/2026 02:30 PM')
      expect(ampmRes.parsedIso).toBe('2026-10-19T14:30:00.000Z')
    })

    it('safely reports error for invalid date strings without throwing', () => {
      const invalidRes = parseStatementTimestamp('not_a_valid_date')
      expect(invalidRes.error).toBeDefined()
      expect(invalidRes.parsedIso).toBeUndefined()
    })
  })

  // =========================================================================
  // 5. Conflicting References
  // =========================================================================
  describe('5. Conflicting References', () => {
    it('detects and flags conflicting references between statement records', () => {
      expect(detectReferenceConflict('529381729102', '987654321098')).toBe(true)
      expect(detectReferenceConflict('529381729102', '529381729102')).toBe(false)
      expect(detectReferenceConflict(undefined, '529381729102')).toBe(false)
    })

    it('rejects match evaluation when two records have different references', () => {
      const recordA = createSyntheticRecord({
        id: 'rec-a',
        normalizedReference: '529381729102',
      })
      const recordB = createSyntheticRecord({
        id: 'rec-b',
        normalizedReference: '987654321098', // Different reference
      })

      const match = evaluateStatementRecordMatch(recordA, recordB)
      expect(match.isMatchCandidate).toBe(false)
      expect(match.conflicts).toContain('reference_conflict')
      expect(match.canAutoMerge).toBe(false)
    })
  })

  // =========================================================================
  // 6. Candidate Matches versus Confirmed Matches
  // =========================================================================
  describe('6. Candidate Matches vs Confirmed Matches', () => {
    it('keeps unreviewed candidate matches separate from confirmed financial events', () => {
      const primaryBankRecord = createSyntheticRecord({ id: 'rec-bank-01' })
      const enrichmentRecord = createSyntheticRecord({
        id: 'rec-phonepe-01',
        sourceProvider: 'phonepe',
        sourceProviderRole: 'enrichment_source',
        counterparty: 'Swiggy Bangalore Order #4819',
      })

      // Construct canonical event
      const event = buildCanonicalFinancialEvent(primaryBankRecord, [enrichmentRecord])

      // Initial state must be unreviewed
      expect(event.status).toBe('unreviewed')
      expect(event.resultingTransactionId).toBeUndefined()
      expect(event.merchant).toBe('Swiggy Bangalore Order #4819')
      expect(event.provenance.primarySourceRecordId).toBe('rec-bank-01')
      expect(event.provenance.enrichmentSourceRecordIds).toEqual(['rec-phonepe-01'])

      // Simulating user confirmation
      event.status = 'user_confirmed'
      expect(event.status).toBe('user_confirmed')
    })
  })

  // =========================================================================
  // 7. Direction Mismatches
  // =========================================================================
  describe('7. Direction Mismatches', () => {
    it('flags direction mismatch when reconciling two records where one is debit and one is credit', () => {
      const debitRecord = createSyntheticRecord({
        id: 'rec-deb',
        direction: 'debit',
      })
      const creditRecord = createSyntheticRecord({
        id: 'rec-crd',
        direction: 'credit',
      })

      const match = evaluateStatementRecordMatch(debitRecord, creditRecord)
      expect(match.isMatchCandidate).toBe(false)
      expect(match.conflicts).toContain('direction_mismatch')
      expect(match.canAutoMerge).toBe(false)
    })
  })

  // =========================================================================
  // 8. Separate Bank Accounts
  // =========================================================================
  describe('8. Separate Bank Account Identities', () => {
    it('maintains distinct account identities for SBI and Union Bank without account numbers', () => {
      expect(sbiAccount.id).not.toBe(unionBankAccount.id)
      expect(sbiAccount.institution).toBe('SBI')
      expect(unionBankAccount.institution).toBe('Union Bank of India')
      expect(sbiAccount.isOwned).toBe(true)
      expect(unionBankAccount.isOwned).toBe(true)
    })
  })

  // =========================================================================
  // 9. Transfer Candidates & Accounting Semantics
  // =========================================================================
  describe('9. Internal Transfer Candidates & Accounting Rules', () => {
    it('identifies candidate transfer between SBI and Union Bank when debit and credit match with UTR', () => {
      const sbiDebit = createSyntheticRecord({
        id: 'rec-sbi-deb',
        sourceAccountId: sbiAccount.id,
        sourceAccountAlias: sbiAccount.alias,
        direction: 'debit',
        amountPaise: 5000000, // ₹50,000.00
        parsedDate: '2026-10-19T10:00:00.000Z',
        normalizedReference: '529381000111',
      })

      const unionBankCredit = createSyntheticRecord({
        id: 'rec-union-crd',
        sourceAccountId: unionBankAccount.id,
        sourceAccountAlias: unionBankAccount.alias,
        sourceProvider: 'union_bank',
        direction: 'credit',
        amountPaise: 5000000, // ₹50,000.00
        parsedDate: '2026-10-19T10:05:00.000Z', // 5 minutes later
        normalizedReference: '529381000111', // Matching UTR
      })

      const transfer = evaluateTransferCandidate(sbiDebit, unionBankCredit, ownedAccountsMap)
      expect(transfer).not.toBeNull()
      expect(transfer?.fromAccountId).toBe(sbiAccount.id)
      expect(transfer?.toAccountId).toBe(unionBankAccount.id)
      expect(transfer?.amountPaise).toBe(5000000)
      expect(transfer?.confidence).toBe('high')
      expect(transfer?.status).toBe('pending')
    })

    it('rejects transfer candidate if both records are on the same account', () => {
      const debit1 = createSyntheticRecord({
        id: 'rec-1',
        sourceAccountId: sbiAccount.id,
        direction: 'debit',
        amountPaise: 10000,
      })
      const credit1 = createSyntheticRecord({
        id: 'rec-2',
        sourceAccountId: sbiAccount.id, // Same account
        direction: 'credit',
        amountPaise: 10000,
      })

      const transfer = evaluateTransferCandidate(debit1, credit1, ownedAccountsMap)
      expect(transfer).toBeNull()
    })

    it('confirms internal transfers are strictly excluded from confirmed income and expense totals', () => {
      // Create a transfer transaction following Money Mate accounting rules
      const confirmedTransferTx: Transaction = {
        id: 'tx-trf-sbi-to-union',
        type: 'transfer',
        amount: 5000000, // ₹50,000
        currency: 'INR',
        date: '2026-10-19T10:00:00.000Z',
        description: 'Internal transfer from SBI to Union Bank',
        fromAccount: sbiAccount.alias,
        toAccount: unionBankAccount.alias,
        category: 'Transfer',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-19T10:00:00.000Z',
        updatedAt: '2026-10-19T10:00:00.000Z',
      }

      const ordinaryExpenseTx: Transaction = {
        id: 'tx-exp-groceries',
        type: 'expense',
        amount: 150000, // ₹1,500
        currency: 'INR',
        date: '2026-10-19T11:00:00.000Z',
        description: 'Weekly groceries',
        category: 'Groceries',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-19T11:00:00.000Z',
        updatedAt: '2026-10-19T11:00:00.000Z',
      }

      const summary = calculateFinancialSummary([confirmedTransferTx, ordinaryExpenseTx], 0)
      // Confirmed transfers must NOT inflate expenses or income
      expect(summary.totalConfirmedIncome).toBe(0)
      expect(summary.totalConfirmedExpenses).toBe(150000) // Only the ₹1,500 groceries
      expect(summary.totalTransfers).toBe(5000000) // ₹50,000 tracked separately
    })
  })

  // =========================================================================
  // 10. Source-Record Provenance
  // =========================================================================
  describe('10. Source-Record Provenance', () => {
    it('preserves provenance linking primary bank debit and secondary UPI enrichment records', () => {
      const bankDebit = createSyntheticRecord({
        id: 'sbi-row-42',
        sourceProvider: 'sbi',
        rawDescription: 'POS 948201 / BLR / COFFEE',
        counterparty: undefined,
      })

      const phonePeRecord = createSyntheticRecord({
        id: 'phonepe-row-15',
        sourceProvider: 'phonepe',
        sourceProviderRole: 'enrichment_source',
        counterparty: 'Blue Tokai Coffee Roasters',
        cleanDescription: 'Cold Brew & Croissant',
      })

      const event = buildCanonicalFinancialEvent(bankDebit, [phonePeRecord], {
        notes: 'Enriched coffee run',
      })

      expect(event.provenance.primarySourceRecordId).toBe('sbi-row-42')
      expect(event.provenance.enrichmentSourceRecordIds).toContain('phonepe-row-15')
      expect(event.merchant).toBe('Blue Tokai Coffee Roasters')
      expect(event.notes).toContain('Enriched coffee run')
      expect(event.notes).toContain('Cold Brew & Croissant')
    })
  })

  // =========================================================================
  // 11. Import Batch Lifecycle & Idempotency
  // =========================================================================
  describe('11. Import Batch Lifecycle & Idempotency', () => {
    it('tracks batch statistics and state transitions', () => {
      const records = [
        createSyntheticRecord({ id: 'r1', status: 'ready', errors: [] }),
        createSyntheticRecord({ id: 'r2', status: 'ready', errors: [] }),
        createSyntheticRecord({ id: 'r3', status: 'failed', errors: ['Invalid amount'] }),
        createSyntheticRecord({ id: 'r4', status: 'ignored', errors: [] }),
      ]

      const stats = calculateBatchStatistics(records)
      expect(stats.total).toBe(4)
      expect(stats.valid).toBe(3)
      expect(stats.errors).toBe(1)
      expect(stats.ready).toBe(2)
      expect(stats.ignored).toBe(1)
    })

    it('models import batch idempotency key based on file hash and account identity', () => {
      const fileHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      const batch: ImportBatch = {
        id: 'imp-batch-001',
        sourceProvider: 'sbi',
        sourceAccountId: sbiAccount.id,
        sourceAccountAlias: sbiAccount.alias,
        fileMetadata: {
          fileName: 'sbi_statement_oct2026.csv',
          fileSizeBytes: 24500,
          fileHash,
          mimeType: 'text/csv',
          detectedFormat: 'csv',
        },
        recordCounts: {
          total: 10,
          valid: 10,
          warnings: 0,
          errors: 0,
          ready: 10,
          ignored: 0,
          imported: 0,
        },
        validationStatus: 'valid',
        reviewStatus: 'unreviewed',
        commitStatus: 'draft',
        idempotencyKey: `${fileHash}_${sbiAccount.id}`,
        isDemo: false,
        createdAt: '2026-10-20T00:00:00.000Z',
        updatedAt: '2026-10-20T00:00:00.000Z',
      }

      expect(batch.idempotencyKey).toBe(`${fileHash}_${sbiAccount.id}`)
      expect(batch.commitStatus).toBe('draft')

      // Commit transition
      batch.commitStatus = 'committed'
      expect(batch.commitStatus).toBe('committed')

      // Rollback manifest
      const rollbackManifest: BatchRollbackManifest = {
        batchId: batch.id,
        createdTransactionIds: ['tx-01', 'tx-02'],
        updatedTransactionIds: [],
        rolledBackAt: '2026-10-20T01:00:00.000Z',
        restoredCount: 2,
      }
      batch.recoveryManifest = rollbackManifest
      batch.commitStatus = 'rolled_back'
      expect(batch.commitStatus).toBe('rolled_back')
      expect(batch.recoveryManifest.createdTransactionIds.length).toBe(2)
    })
  })

  // =========================================================================
  // 12. Demo / Live Scope Isolation
  // =========================================================================
  describe('12. Demo / Live Scope Isolation', () => {
    it('preserves isDemo isolation flag on records and accounts', () => {
      const liveRecord = createSyntheticRecord({ isDemo: false })
      const demoRecord = createSyntheticRecord({ isDemo: true, id: 'demo-stg-01' })

      expect(liveRecord.isDemo).toBe(false)
      expect(demoRecord.isDemo).toBe(true)

      const liveEvent = buildCanonicalFinancialEvent(liveRecord)
      const demoEvent = buildCanonicalFinancialEvent(demoRecord)

      expect(liveEvent.isDemo).toBe(false)
      expect(demoEvent.isDemo).toBe(true)
    })
  })
})
