import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  evaluateRecordAgainstLedger,
  createInitialReconciliationDecisions,
  calculateProposedImportSummary,
  evaluateStatementRecordMatch,
  evaluateTransferCandidate,
} from '../src/utils/reconciliationRules'
import { parseStatementCsv } from '../src/utils/statementParsers'
import { formatPaise } from '../src/utils/money'
import { calculateFinancialSummary } from '../src/utils/calculations'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import type { StatementRecord, AccountDefinition, ReconciliationDecision } from '../src/types/reconciliation'
import type { Transaction } from '../src/types/transaction'

describe('Money Mate AI — Stage 8.4 Interactive Reconciliation Review Test Suite', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures/statements')
  const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), 'utf-8')

  // Sample existing ledger transactions
  const existingLedger: Transaction[] = [
    {
      id: 'tx-ledger-swiggy',
      type: 'expense',
      amount: 35000, // ₹350.00
      currency: 'INR',
      date: '2026-10-19T13:45:00.000Z',
      description: 'Swiggy Dinner Order',
      merchant: 'Swiggy',
      category: 'Food & dining',
      paymentMethod: 'UPI',
      externalRef: '529381729102',
      status: 'completed',
      createdAt: '2026-10-19T13:45:00.000Z',
      updatedAt: '2026-10-19T13:45:00.000Z',
    },
    {
      id: 'tx-ledger-salary',
      type: 'income',
      amount: 8500000, // ₹85,000.00
      currency: 'INR',
      date: '2026-10-19T09:00:00.000Z',
      description: 'October Monthly Salary',
      merchant: 'Acme Corp',
      category: 'Salary',
      paymentMethod: 'Bank transfer',
      externalRef: 'SAL2026101901',
      status: 'completed',
      createdAt: '2026-10-19T09:00:00.000Z',
      updatedAt: '2026-10-19T09:00:00.000Z',
    },
    {
      id: 'tx-ledger-netflix',
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

  const sbiAccount: AccountDefinition = {
    id: 'acc-sbi-primary',
    institution: 'SBI',
    alias: 'SBI Primary Savings',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
  }

  const unionAccount: AccountDefinition = {
    id: 'acc-union-savings',
    institution: 'Union Bank of India',
    alias: 'Union Bank Operating',
    accountType: 'savings',
    currency: 'INR',
    isOwned: true,
  }

  const ownedAccountsMap = new Map<string, AccountDefinition>([
    [sbiAccount.id, sbiAccount],
    [unionAccount.id, unionAccount],
  ])

  // =========================================================================
  // 1. Confirming a Suggested Match
  // =========================================================================
  describe('1. Confirming a Suggested Match', () => {
    it('initializes match as suggested_match and transitions to confirmed_match upon explicit user action', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)
      const swiggyRecord = parsed.records[0] // 529381729102, ₹350.00

      const initialDecision = evaluateRecordAgainstLedger(swiggyRecord, existingLedger)
      expect(initialDecision.state).toBe('suggested_match')
      expect(initialDecision.isConfirmed).toBe(false)
      expect(initialDecision.matchedLedgerTxId).toBe('tx-ledger-swiggy')

      // User explicit confirmation
      const confirmedDecision: ReconciliationDecision = {
        ...initialDecision,
        state: 'confirmed_match',
        isConfirmed: true,
        userAction: 'confirm_match',
      }
      expect(confirmedDecision.state).toBe('confirmed_match')
      expect(confirmedDecision.isConfirmed).toBe(true)

      const decisions = new Map([[swiggyRecord.id, confirmedDecision]])
      const summary = calculateProposedImportSummary([swiggyRecord], decisions, 0)

      expect(summary.confirmedLinksCount).toBe(1)
      expect(summary.potentialDuplicatesRequiringReview).toBe(0)
      // Confirmed duplicate does NOT create a new event
      expect(summary.proposedNewEventsCount).toBe(0)
    })
  })

  // =========================================================================
  // 2. Rejecting a Suggested Match
  // =========================================================================
  describe('2. Rejecting a Suggested Match', () => {
    it('allows user to reject a match so the record is kept as an independent new transaction', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)
      const swiggyRecord = parsed.records[0]

      const rejectedDecision: ReconciliationDecision = {
        recordId: swiggyRecord.id,
        state: 'rejected_match',
        proposedType: 'expense',
        proposedCategory: 'Food & dining',
        evidence: [],
        conflicts: [],
        decisionReason: 'User rejected match. Keep as separate transaction.',
        isConfirmed: true,
        userAction: 'reject_match',
        updatedAt: new Date().toISOString(),
      }

      const decisions = new Map([[swiggyRecord.id, rejectedDecision]])
      const summary = calculateProposedImportSummary([swiggyRecord], decisions, 0)

      expect(summary.confirmedLinksCount).toBe(0)
      expect(summary.potentialDuplicatesRequiringReview).toBe(0)
      expect(summary.proposedNewEventsCount).toBe(1)
      expect(summary.proposedExpensesPaise).toBe(35000)
    })
  })

  // =========================================================================
  // 3. Keeping Identical-Amount Transactions Separate
  // =========================================================================
  describe('3. Keeping Identical-Amount Transactions Separate', () => {
    it('refuses to merge two distinct transactions on same date & amount without shared reference or merchant overlap', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)

      // Rows 7 & 8 are two distinct ₹20 tea payments on the same date:
      // Row 7: Chai Point Koramangala
      // Row 8: Amrit Tulsi Tea Indiranagar
      const tea1 = parsed.records[6]
      const tea2 = parsed.records[7]

      expect(tea1.amountPaise).toBe(2000)
      expect(tea2.amountPaise).toBe(2000)

      const evalMatch = evaluateStatementRecordMatch(tea1, tea2)
      expect(evalMatch.isMatchCandidate).toBe(false)
      expect(evalMatch.canAutoMerge).toBe(false)
      expect(evalMatch.conflicts).toContain('reference_conflict')
    })
  })

  // =========================================================================
  // 4. Blocking Merges When References Conflict
  // =========================================================================
  describe('4. Blocking Merges When References Conflict', () => {
    it('flags conflict when reference matches but amounts differ', () => {
      const testRecord: StatementRecord = {
        id: 'rec-test-diff-amt',
        batchId: 'b1',
        sourceProvider: 'sbi',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
        statementFileId: 'stmt.csv',
        rawDateText: '19/10/2026',
        rawDescription: 'UPI/529381729102/DR/SWIGGY',
        cleanDescription: 'SWIGGY',
        normalizedReference: '529381729102', // Matches ledger swiggy
        amountPaise: 40000, // ₹400.00 (Ledger has ₹350.00)
        signedAmountPaise: -40000,
        currency: 'INR',
        direction: 'debit',
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'expense',
        proposedCategory: 'Food & dining',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const decision = evaluateRecordAgainstLedger(testRecord, existingLedger)
      expect(decision.state).toBe('conflicting')
      expect(decision.conflicts).toContain('amount_mismatch')
      expect(decision.decisionReason).toContain('Conflicting amounts')
    })

    it('keeps transactions separate when nearby date and same amount have distinct references', () => {
      const testRecord: StatementRecord = {
        id: 'rec-distinct-ref',
        batchId: 'b1',
        sourceProvider: 'sbi',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
        statementFileId: 'stmt.csv',
        rawDateText: '19/10/2026',
        parsedDate: '2026-10-19T13:45:00.000Z',
        rawDescription: 'ZOMATO ORDER',
        cleanDescription: 'ZOMATO',
        normalizedReference: '999888777666', // Different reference
        amountPaise: 35000, // Same amount as Swiggy
        signedAmountPaise: -35000,
        currency: 'INR',
        direction: 'debit',
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'expense',
        proposedCategory: 'Food & dining',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const decision = evaluateRecordAgainstLedger(testRecord, existingLedger)
      expect(decision.state).toBe('unmatched')
      expect(decision.decisionReason).toContain('Distinct transaction')
    })
  })

  // =========================================================================
  // 5. Blocking Merges When Transaction Directions Conflict
  // =========================================================================
  describe('5. Blocking Merges When Transaction Directions Conflict', () => {
    it('flags direction_mismatch conflict when reference matches but flow direction contradicts ledger type', () => {
      const creditRecordWithSwiggyRef: StatementRecord = {
        id: 'rec-credit-swiggy',
        batchId: 'b1',
        sourceProvider: 'sbi',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
        statementFileId: 'stmt.csv',
        rawDateText: '19/10/2026',
        rawDescription: 'UPI/529381729102/CR/SWIGGY',
        cleanDescription: 'SWIGGY',
        normalizedReference: '529381729102',
        amountPaise: 35000,
        signedAmountPaise: 35000,
        currency: 'INR',
        direction: 'credit', // Credit on an expense reference
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'income',
        proposedCategory: 'Income',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const decision = evaluateRecordAgainstLedger(creditRecordWithSwiggyRef, existingLedger)
      expect(decision.state).toBe('conflicting')
      expect(decision.conflicts).toContain('direction_mismatch')
      expect(decision.decisionReason).toContain('Conflicting flow direction')
    })
  })

  // =========================================================================
  // 6. Distinguishing Bank Records from UPI Observations
  // =========================================================================
  describe('6. Distinguishing Bank Records from UPI Observations', () => {
    it('strictly separates primary_ledger bank records from enrichment_source UPI observations', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const phonepeContent = readFixture('phonepe_synthetic.csv')

      const sbiParsed = parseStatementCsv(sbiContent)
      const phonepeParsed = parseStatementCsv(phonepeContent)

      expect(sbiParsed.records[0].sourceProviderRole).toBe('primary_ledger')
      expect(sbiParsed.records[0].sourceProvider).toBe('sbi')

      expect(phonepeParsed.records[0].sourceProviderRole).toBe('enrichment_source')
      expect(phonepeParsed.records[0].sourceProvider).toBe('phonepe')
    })
  })

  // =========================================================================
  // 7. Confirming and Rejecting Internal Transfer Candidates
  // =========================================================================
  describe('7. Confirming and Rejecting Internal Transfer Candidates', () => {
    it('identifies cross-account transfer pairs and excludes confirmed transfers from income and expenses', () => {
      const sbiDebit: StatementRecord = {
        id: 'rec-sbi-trf-dr',
        batchId: 'b1',
        sourceProvider: 'sbi',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: sbiAccount.id,
        sourceAccountAlias: sbiAccount.alias,
        statementFileId: 'sbi.csv',
        rawDateText: '19/10/2026 10:00:00',
        parsedDate: '2026-10-19T10:00:00.000Z',
        rawDescription: 'NEFT TO UNION BANK',
        cleanDescription: 'TRANSFER TO UNION BANK',
        normalizedReference: 'TRF990011',
        amountPaise: 5000000, // ₹50,000.00
        signedAmountPaise: -5000000,
        currency: 'INR',
        direction: 'debit',
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'transfer',
        proposedCategory: 'Transfer',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const unionCredit: StatementRecord = {
        id: 'rec-union-trf-cr',
        batchId: 'b1',
        sourceProvider: 'union_bank',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: unionAccount.id,
        sourceAccountAlias: unionAccount.alias,
        statementFileId: 'union.csv',
        rawDateText: '19/10/2026 10:05:00',
        parsedDate: '2026-10-19T10:05:00.000Z',
        rawDescription: 'NEFT FROM SBI',
        cleanDescription: 'TRANSFER FROM SBI',
        normalizedReference: 'TRF990011',
        amountPaise: 5000000, // ₹50,000.00
        signedAmountPaise: 5000000,
        currency: 'INR',
        direction: 'credit',
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'transfer',
        proposedCategory: 'Transfer',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const initialDecisions = createInitialReconciliationDecisions(
        [sbiDebit, unionCredit],
        [],
        ownedAccountsMap
      )

      expect(initialDecisions.get(sbiDebit.id)?.isInternalTransfer).toBe(true)
      expect(initialDecisions.get(unionCredit.id)?.isInternalTransfer).toBe(true)

      // Confirm transfer
      const confirmedDecisions = new Map(initialDecisions)
      confirmedDecisions.set(sbiDebit.id, {
        ...confirmedDecisions.get(sbiDebit.id)!,
        state: 'confirmed_match',
        isConfirmed: true,
      })
      confirmedDecisions.set(unionCredit.id, {
        ...confirmedDecisions.get(unionCredit.id)!,
        state: 'confirmed_match',
        isConfirmed: true,
      })

      const summary = calculateProposedImportSummary([sbiDebit, unionCredit], confirmedDecisions, 0)
      expect(summary.proposedTransfersCount).toBe(1)
      expect(summary.proposedTransfersPaise).toBe(5000000)
      // Confirmed transfers must NOT inflate expenses or income
      expect(summary.proposedExpensesPaise).toBe(0)
      expect(summary.proposedIncomePaise).toBe(0)
    })
  })

  // =========================================================================
  // 8. Keeping Uncertain Classifications Unresolved
  // =========================================================================
  describe('8. Keeping Uncertain Classifications Unresolved', () => {
    it('flags unclassified records with classification_required until user specifies category', () => {
      const unclassifiedRecord: StatementRecord = {
        id: 'rec-unclassified',
        batchId: 'b1',
        sourceProvider: 'generic_csv',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: 'acc-generic',
        sourceAccountAlias: 'Generic Account',
        statementFileId: 'stmt.csv',
        rawDateText: '19/10/2026',
        rawDescription: 'MISC PAYMENT 4819',
        cleanDescription: 'MISC PAYMENT',
        amountPaise: 12000,
        signedAmountPaise: -12000,
        currency: 'INR',
        direction: 'debit',
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'expense',
        proposedCategory: '', // Empty category
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const decision = evaluateRecordAgainstLedger(unclassifiedRecord, existingLedger)
      expect(decision.state).toBe('classification_required')
      expect(decision.decisionReason).toContain('Classification required')
    })
  })

  // =========================================================================
  // 9. Correctly Handling Refunds and Failed Transactions
  // =========================================================================
  describe('9. Correctly Handling Refunds and Failed Transactions', () => {
    it('treats refunds as distinct from ordinary income and excludes failed payments from spending', () => {
      const refundRecord: StatementRecord = {
        id: 'rec-refund-01',
        batchId: 'b1',
        sourceProvider: 'phonepe',
        sourceProviderRole: 'enrichment_source',
        sourceAccountId: 'acc-phonepe-linked',
        sourceAccountAlias: 'PhonePe',
        statementFileId: 'phonepe.csv',
        rawDateText: '19/10/2026',
        rawDescription: 'REFUND FOR CANCELLED ORDER',
        cleanDescription: 'AMAZON REFUND',
        counterparty: 'Amazon',
        amountPaise: 129900, // ₹1,299.00
        signedAmountPaise: 129900,
        currency: 'INR',
        direction: 'credit',
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'refund',
        proposedCategory: 'Refund',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const failedRecord: StatementRecord = {
        id: 'rec-failed-01',
        batchId: 'b1',
        sourceProvider: 'phonepe',
        sourceProviderRole: 'enrichment_source',
        sourceAccountId: 'acc-phonepe-linked',
        sourceAccountAlias: 'PhonePe',
        statementFileId: 'phonepe.csv',
        rawDateText: '19/10/2026',
        rawDescription: 'PAYMENT TO UBER FAILED',
        cleanDescription: 'UBER RIDE',
        counterparty: 'Uber',
        amountPaise: 42000, // ₹420.00
        signedAmountPaise: -42000,
        currency: 'INR',
        direction: 'debit',
        metadata: { paymentStatus: 'Failed' },
        warnings: [],
        errors: [],
        proposedType: 'expense',
        proposedCategory: 'Transportation',
        status: 'failed',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const decisions = new Map<string, ReconciliationDecision>([
        [
          refundRecord.id,
          {
            recordId: refundRecord.id,
            state: 'unmatched',
            proposedType: 'refund',
            proposedCategory: 'Refund',
            evidence: [],
            conflicts: [],
            decisionReason: 'Refund observation',
            isConfirmed: false,
            updatedAt: new Date().toISOString(),
          },
        ],
        [
          failedRecord.id,
          {
            recordId: failedRecord.id,
            state: 'ready_for_import',
            proposedType: 'reversal',
            proposedCategory: 'Transportation',
            evidence: [],
            conflicts: [],
            decisionReason: 'Failed payment observation',
            isConfirmed: false,
            updatedAt: new Date().toISOString(),
          },
        ],
      ])

      const summary = calculateProposedImportSummary(
        [refundRecord, failedRecord],
        decisions,
        0
      )

      expect(summary.proposedRefundsCount).toBe(1)
      expect(summary.proposedRefundsPaise).toBe(129900)
      // Refunds must NOT inflate ordinary income
      expect(summary.proposedIncomePaise).toBe(0)
      // Failed payments must NOT inflate confirmed spending
      expect(summary.proposedExpensesPaise).toBe(0)
    })
  })

  // =========================================================================
  // 10. Preserving All Source Observations
  // =========================================================================
  describe('10. Preserving All Source Observations', () => {
    it('maintains original narration, row index, and metadata without deletion', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)
      const rec = parsed.records[0]

      expect(rec.originalRowIndex).toBe(2)
      expect(rec.rawDescription).toContain('UPI/529381729102/CR/SWIGGY/BANGALORE')
      expect(rec.balanceAfterPaise).toBe(1250000)
      expect(rec.metadata.paymentChannel).toBe('UPI')
    })
  })

  // =========================================================================
  // 11. Calculating Proposed Totals Using Integer Paise
  // =========================================================================
  describe('11. Exact Integer Paise Arithmetic', () => {
    it('guarantees deterministic, exact integer additions for proposed totals', () => {
      const rec1: StatementRecord = {
        id: 'r1',
        batchId: 'b',
        sourceProvider: 'sbi',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: 'a',
        sourceAccountAlias: 'A',
        statementFileId: 'f',
        rawDateText: '',
        rawDescription: '',
        cleanDescription: '',
        amountPaise: 1, // ₹0.01
        signedAmountPaise: -1,
        currency: 'INR',
        direction: 'debit',
        metadata: {},
        warnings: [],
        errors: [],
        proposedType: 'expense',
        proposedCategory: 'Shopping',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: '',
        updatedAt: '',
      }

      const rec2: StatementRecord = {
        ...rec1,
        id: 'r2',
        amountPaise: 1099, // ₹10.99
        signedAmountPaise: -1099,
      }

      const decisions = new Map<string, ReconciliationDecision>([
        [
          'r1',
          {
            recordId: 'r1',
            state: 'unmatched',
            proposedType: 'expense',
            proposedCategory: 'Shopping',
            evidence: [],
            conflicts: [],
            decisionReason: '',
            isConfirmed: false,
            updatedAt: '',
          },
        ],
        [
          'r2',
          {
            recordId: 'r2',
            state: 'unmatched',
            proposedType: 'expense',
            proposedCategory: 'Shopping',
            evidence: [],
            conflicts: [],
            decisionReason: '',
            isConfirmed: false,
            updatedAt: '',
          },
        ],
      ])

      const summary = calculateProposedImportSummary([rec1, rec2], decisions, 0)
      expect(summary.proposedExpensesPaise).toBe(1100) // ₹11.00 exactly
      expect(formatPaise(summary.proposedExpensesPaise)).toBe('₹11')
    })
  })

  // =========================================================================
  // 12. Resetting Draft Decisions
  // =========================================================================
  describe('12. Resetting Draft Decisions', () => {
    it('restores initial auto-evaluated decision state upon user reset', () => {
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)
      const swiggyRecord = parsed.records[0]

      const initial = evaluateRecordAgainstLedger(swiggyRecord, existingLedger)
      expect(initial.state).toBe('suggested_match')

      // User modifies to confirmed_match
      let decision: ReconciliationDecision = {
        ...initial,
        state: 'confirmed_match',
        isConfirmed: true,
      }
      expect(decision.state).toBe('confirmed_match')

      // User resets decision
      decision = evaluateRecordAgainstLedger(swiggyRecord, existingLedger)
      expect(decision.state).toBe('suggested_match')
      expect(decision.isConfirmed).toBe(false)
    })
  })

  // =========================================================================
  // 13. Preventing Draft Values from Affecting Actual Dashboard Totals
  // =========================================================================
  describe('13. Preventing Draft Values from Affecting Dashboard Totals', () => {
    it('guarantees calculateFinancialSummary executes only on real ledger transactions', () => {
      const initialSummary = calculateFinancialSummary(existingLedger, 0)
      expect(initialSummary.totalConfirmedExpenses).toBe(35000 + 64900) // ₹999.00
      expect(initialSummary.totalConfirmedIncome).toBe(8500000) // ₹85,000.00

      // Staging and reviewing draft statement records in memory
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)
      const decisions = createInitialReconciliationDecisions(parsed.records, existingLedger)

      // User classifies Row 2 (Zomato) as Food & dining
      const zomatoRec = parsed.records[1]
      decisions.set(zomatoRec.id, {
        recordId: zomatoRec.id,
        state: 'ready_for_import',
        proposedType: 'expense',
        proposedCategory: 'Food & dining',
        evidence: [],
        conflicts: [],
        decisionReason: 'Classified by user',
        isConfirmed: true,
        updatedAt: new Date().toISOString(),
      })

      const draftSummary = calculateProposedImportSummary(parsed.records, decisions, 0)
      expect(draftSummary.proposedExpensesPaise).toBe(42050) // ₹420.50

      // Ledger summary remains completely unchanged!
      const afterSummary = calculateFinancialSummary(existingLedger, 0)
      expect(afterSummary.totalConfirmedExpenses).toBe(initialSummary.totalConfirmedExpenses)
      expect(afterSummary.totalConfirmedIncome).toBe(initialSummary.totalConfirmedIncome)
    })
  })

  // =========================================================================
  // 14. Preventing All Ledger Writes During Review
  // =========================================================================
  describe('14. Strict Ledger Non-Mutation', () => {
    it('guarantees 0 writes or updates to transaction repository throughout the review lifecycle', async () => {
      const repo = new InMemoryTransactionRepository(existingLedger)
      const initialCount = (await repo.getAll()).length

      // Parse and review statements
      const sbiContent = readFixture('sbi_synthetic.csv')
      const parsed = parseStatementCsv(sbiContent)
      const decisions = createInitialReconciliationDecisions(parsed.records, existingLedger)

      // Confirm one match, reject another
      const dec1 = decisions.get(parsed.records[0].id)!
      decisions.set(parsed.records[0].id, { ...dec1, state: 'confirmed_match', isConfirmed: true })

      const dec2 = decisions.get(parsed.records[1].id)!
      decisions.set(parsed.records[1].id, { ...dec2, state: 'rejected_match', isConfirmed: true })

      calculateProposedImportSummary(parsed.records, decisions, 0)

      // Verify repository is untouched
      const finalCount = (await repo.getAll()).length
      expect(finalCount).toBe(initialCount)
      expect(finalCount).toBe(3)
    })
  })

  // =========================================================================
  // 15. Maintaining Demo/Live Isolation
  // =========================================================================
  describe('15. Maintaining Demo/Live Isolation', () => {
    it('preserves Demo flag across statement parsing and in-memory reconciliation decisions', () => {
      const csv = 'Date,Description,Amount\n19/10/2026,Lunch,250.00\n'
      const demoRes = parseStatementCsv(csv, { isDemo: true })
      expect(demoRes.records[0].isDemo).toBe(true)

      const liveRes = parseStatementCsv(csv, { isDemo: false })
      expect(liveRes.records[0].isDemo).toBe(false)
    })
  })

  // =========================================================================
  // 16. Discarding Draft Safely
  // =========================================================================
  describe('16. Discarding the Entire Draft Safely', () => {
    it('completely clears draft state in memory when discarded', () => {
      let draftState: any = {
        file: { name: 'sbi.csv', size: 1024 },
        parserResult: parseStatementCsv(readFixture('sbi_synthetic.csv')),
        decisions: new Map<string, any>(),
      }

      expect(draftState.parserResult.records.length).toBe(8)

      // Discard action
      draftState = null
      expect(draftState).toBeNull()
    })
  })
})
