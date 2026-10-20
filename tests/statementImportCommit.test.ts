/**
 * Money Mate AI — Stage 8.5 Automated Test Suite
 * Atomic Statement Commitment, Batch Rollback, and Reconciliation Audit Reporting
 * 
 * Tests cover all 34 required test cases:
 * 1. A valid approved expense is imported once.
 * 2. A valid approved income record is imported once.
 * 3. An unconfirmed suggested match is rejected by the import service.
 * 4. A confirmed duplicate does not create another transaction.
 * 5. A rejected match is imported separately only after explicit approval.
 * 6. A same-amount/same-date transaction with insufficient evidence is not automatically merged.
 * 7. A conflicting external reference blocks commitment.
 * 8. A debit/credit direction conflict blocks commitment.
 * 9. An unresolved classification blocks commitment.
 * 10. Pending transactions remain pending.
 * 11. Failed transactions do not inflate financial totals.
 * 12. Reversals do not count as successful payments.
 * 13. Refunds do not become ordinary income.
 * 14. A confirmed internal transfer does not inflate income or expenses.
 * 15. An uncertain transfer pair cannot be auto-confirmed.
 * 16. Demo import cannot alter Live data.
 * 17. Live import cannot alter Demo data.
 * 18. Re-importing the same file is idempotent.
 * 19. Overlapping statement files do not silently duplicate transactions.
 * 20. The same event observed through bank and UPI data is counted only once when properly linked.
 * 21. A failed IndexedDB transaction leaves no partial ledger changes.
 * 22. A failed commit does not create a misleading completed batch.
 * 23. A successful import records its batch metadata and rollback manifest.
 * 24. Rolling back a simple batch removes only that batch's newly created transactions.
 * 25. Rolling back a batch does not remove pre-existing matched transactions.
 * 26. Rollback is blocked when a transaction has unsafe subsequent modifications or dependencies.
 * 27. Repeating rollback is safe.
 * 28. Rollback cannot affect a different workspace.
 * 29. A second concurrent commit cannot create duplicates.
 * 30. Reconstructed balances are marked incomplete when statement coverage is insufficient.
 * 31. Integer-paise calculations remain exact.
 * 32. Import errors do not leak raw financial records into logs.
 * 33. A malformed or unsupported statement cannot partially modify the ledger.
 * 34. The final report distinguishes imported, skipped, pending, failed, and unresolved records.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import {
  commitStatementBatch,
  computeFileHash,
} from '../src/services/statementImportService'
import {
  validateRollbackSafety,
  executeBatchRollback,
} from '../src/services/statementRollbackService'
import { validateImportEligibility } from '../src/services/reconciliationEligibility'
import { parseStatementCsv } from '../src/utils/statementParsers'
import { calculateFinancialSummary } from '../src/utils/calculations'
import type { Transaction } from '../src/types/transaction'
import type {
  StatementRecord,
  ReconciliationDecision,
  ImportBatch,
  BatchFileMetadata,
} from '../src/types/reconciliation'

describe('Money Mate AI — Stage 8.5 Statement Import & Rollback Test Suite', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures/statements')
  const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name), 'utf-8')

  let repo: InMemoryTransactionRepository
  let mockBatches: Map<string, ImportBatch>

  beforeEach(() => {
    repo = new InMemoryTransactionRepository()
    mockBatches = new Map<string, ImportBatch>()
  })

  // Helper to create synthetic metadata
  function createTestMetadata(hashSuffix = '001', size = 512): BatchFileMetadata {
    return {
      fileName: `statement_${hashSuffix}.csv`,
      fileSizeBytes: size,
      fileHash: `hash_sha256_${hashSuffix}`,
      mimeType: 'text/csv',
      detectedFormat: 'csv',
    }
  }

  // Helper to create standard approved decision
  function createApprovedDecision(record: StatementRecord, overrides?: Partial<ReconciliationDecision>): ReconciliationDecision {
    const validCategory =
      record.proposedCategory && record.proposedCategory !== 'Other' && record.proposedCategory !== 'Uncategorized'
        ? record.proposedCategory
        : (record.proposedType === 'income' ? 'Income' : 'Shopping')

    return {
      recordId: record.id,
      state: 'ready_for_import',
      proposedType: record.proposedType,
      proposedCategory: validCategory,
      evidence: ['exact_reference'],
      conflicts: [],
      decisionReason: 'Explicitly approved by user for import.',
      isConfirmed: true,
      updatedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  // =========================================================================
  // 1 & 2: Expense & Income Commitment
  // =========================================================================
  it('1. imports a valid approved expense record once into the ledger', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    const expenseRecord = parsed.records.find((r) => r.direction === 'debit' && r.amountPaise === 35000)!
    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(expenseRecord.id, createApprovedDecision(expenseRecord, { proposedCategory: 'Food & dining' }))

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [expenseRecord],
      decisions,
      batchMetadata: createTestMetadata('exp1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    expect(result.createdTransactionIds).toHaveLength(1)

    const all = await repo.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].amount).toBe(35000)
    expect(all[0].type).toBe('expense')
    expect(all[0].category).toBe('Food & dining')
    expect(all[0].isDemo).toBe(false)
    expect(all[0].status).toBe('completed')
  })

  it('2. imports a valid approved income record once into the ledger', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    const incomeRecord = parsed.records.find((r) => r.direction === 'credit' && r.amountPaise === 8500000)!
    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(incomeRecord.id, createApprovedDecision(incomeRecord, { proposedType: 'income', proposedCategory: 'Salary' }))

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [incomeRecord],
      decisions,
      batchMetadata: createTestMetadata('inc1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    const all = await repo.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].amount).toBe(8500000)
    expect(all[0].type).toBe('income')
    expect(all[0].category).toBe('Salary')
  })

  // =========================================================================
  // 3 & 4 & 5: Matches, Suggested Matches, Duplicates, and Rejected Matches
  // =========================================================================
  it('3. rejects unconfirmed suggested match candidate from entering the import', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    const record = parsed.records[0]
    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, {
      recordId: record.id,
      state: 'suggested_match', // Unconfirmed!
      matchedLedgerTxId: 'tx-existing-1',
      proposedType: 'expense',
      proposedCategory: 'Food & dining',
      evidence: ['weak_heuristic'],
      conflicts: [],
      decisionReason: 'Possible duplicate candidate requiring user review.',
      isConfirmed: false,
      updatedAt: new Date().toISOString(),
    })

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('unconfirmed1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('strict eligibility criteria')
    expect(await repo.getAll()).toHaveLength(0)
  })

  it('4. confirmed duplicate does not create another ledger transaction', async () => {
    // Existing ledger transaction
    const existingTx: Transaction = {
      id: 'tx-existing-swiggy',
      type: 'expense',
      amount: 35000,
      currency: 'INR',
      date: '2026-10-19T13:45:00.000Z',
      description: 'Swiggy Dinner Order',
      category: 'Food & dining',
      paymentMethod: 'UPI',
      externalRef: '529381729102',
      status: 'completed',
      isDemo: false,
      createdAt: '2026-10-19T13:45:00.000Z',
      updatedAt: '2026-10-19T13:45:00.000Z',
    }
    await repo.add(existingTx)

    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    const record = parsed.records.find((r) => r.normalizedReference === '529381729102')!
    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, {
      recordId: record.id,
      state: 'confirmed_match',
      matchedLedgerTxId: existingTx.id,
      proposedType: 'expense',
      proposedCategory: 'Food & dining',
      evidence: ['exact_reference'],
      conflicts: [],
      decisionReason: 'User confirmed duplicate match with existing ledger transaction.',
      isConfirmed: true,
      updatedAt: new Date().toISOString(),
    })

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('dup1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    expect(result.skippedDuplicatesCount).toBe(1)
    expect(result.createdTransactionIds).toHaveLength(0)

    // Ledger still has exactly 1 transaction (the original)
    const all = await repo.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('tx-existing-swiggy')
  })

  it('5. imports a rejected match separately only after explicit approval', async () => {
    const existingTx: Transaction = {
      id: 'tx-existing-tea',
      type: 'expense',
      amount: 2000,
      currency: 'INR',
      date: '2026-10-17T10:00:00.000Z',
      description: 'Chai Point',
      category: 'Food & dining',
      paymentMethod: 'UPI',
      status: 'completed',
      isDemo: false,
      createdAt: '2026-10-17T10:00:00.000Z',
      updatedAt: '2026-10-17T10:00:00.000Z',
    }
    await repo.add(existingTx)

    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    // Second tea purchase of same ₹20 on same date
    const record = parsed.records.find((r) => r.amountPaise === 2000 && r.cleanDescription.includes('AMRIT TULSI'))!

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, {
      recordId: record.id,
      state: 'rejected_match',
      userAction: 'reject_match',
      proposedType: 'expense',
      proposedCategory: 'Food & dining',
      evidence: ['weak_heuristic'],
      conflicts: [],
      decisionReason: 'User rejected candidate match: distinct second purchase.',
      isConfirmed: true, // Explicitly confirmed as separate!
      updatedAt: new Date().toISOString(),
    })

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('rej1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    expect(result.createdTransactionIds).toHaveLength(1)

    const all = await repo.getAll()
    expect(all).toHaveLength(2)
    expect(all.some((t) => t.id === 'tx-existing-tea')).toBe(true)
  })

  // =========================================================================
  // 6, 7, 8, 9: Conflicts and Insufficient Evidence Guardrails
  // =========================================================================
  it('6. does not automatically merge same-amount/same-date transactions with insufficient evidence', () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    const recA = parsed.records.find((r) => r.cleanDescription.includes('CHAI POINT'))!
    const recB = parsed.records.find((r) => r.cleanDescription.includes('AMRIT TULSI'))!

    // Both are ₹20 on 17/10/2026, but have different UTRs and distinct counterparties
    const eligibilityA = validateImportEligibility(
      recA,
      {
        recordId: recA.id,
        state: 'unreviewed', // Unreviewed should fail
        proposedType: 'expense',
        proposedCategory: 'Food & dining',
        evidence: [],
        conflicts: [],
        decisionReason: '',
        isConfirmed: false,
        updatedAt: '',
      },
      'live'
    )
    expect(eligibilityA.isEligible).toBe(false)
  })

  it('7. conflicting external reference blocks commitment', async () => {
    // Existing ledger transaction with reference 'REF-UNIQUE-999'
    await repo.add({
      id: 'tx-live-orig',
      type: 'expense',
      amount: 50000,
      currency: 'INR',
      date: '2026-10-19T10:00:00.000Z',
      description: 'Original Merchant',
      category: 'Shopping',
      paymentMethod: 'UPI',
      externalRef: 'REF-UNIQUE-999',
      status: 'completed',
      isDemo: false,
      createdAt: '2026-10-19T10:00:00.000Z',
      updatedAt: '2026-10-19T10:00:00.000Z',
    })

    // Staged record claims to be a new transaction but with identical reference REF-UNIQUE-999
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record = { ...parsed.records[0], normalizedReference: 'REF-UNIQUE-999' }

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, createApprovedDecision(record, {
      state: 'ready_for_import', // Incorrectly trying to import as new event without linking
    }))

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('ref_conflict'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Conflicting external reference')
  })

  it('8. debit/credit direction conflict blocks commitment', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record = parsed.records[0]

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, {
      recordId: record.id,
      state: 'conflicting',
      proposedType: 'expense',
      proposedCategory: 'Shopping',
      evidence: [],
      conflicts: ['direction_mismatch'],
      decisionReason: 'Conflicting debit/credit direction detected.',
      isConfirmed: false,
      updatedAt: new Date().toISOString(),
    })

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('dir_conflict'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(false)
    expect(result.diagnostics?.some((d) => d.includes('unresolved conflicts'))).toBe(true)
  })

  it('9. unresolved classification blocks commitment', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record = { ...parsed.records[0], proposedCategory: 'Uncategorized' }

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, {
      recordId: record.id,
      state: 'classification_required',
      proposedType: 'expense',
      proposedCategory: 'Uncategorized',
      evidence: [],
      conflicts: [],
      decisionReason: 'Category required.',
      isConfirmed: false,
      updatedAt: new Date().toISOString(),
    })

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('unclass'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(false)
    expect(result.diagnostics?.some((d) => d.includes('unresolved classification'))).toBe(true)
  })

  // =========================================================================
  // 10, 11, 12, 13, 14, 15: Status Semantics (Pending, Failed, Reversals, Refunds, Transfers)
  // =========================================================================
  it('10. pending transactions remain pending and do not inflate settled totals', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record = {
      ...parsed.records[0],
      metadata: { ...parsed.records[0].metadata, paymentStatus: 'Pending' },
    }

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, createApprovedDecision(record))

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('pending1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    const all = await repo.getAll()
    expect(all[0].status).toBe('pending')

    const summary = calculateFinancialSummary(all)
    expect(summary.totalConfirmedExpenses).toBe(0)
    expect(summary.totalPendingExpenses).toBe(record.amountPaise)
  })

  it('11. failed transactions do not inflate financial totals', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record: StatementRecord = {
      ...parsed.records[0],
      status: 'failed',
      metadata: { ...parsed.records[0].metadata, paymentStatus: 'Failed' },
    }

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, createApprovedDecision(record, { proposedType: 'reversal' }))

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('failed1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    const all = await repo.getAll()
    expect(all[0].status).toBe('failed')

    const summary = calculateFinancialSummary(all)
    expect(summary.totalConfirmedExpenses).toBe(0)
    expect(summary.failedCount).toBe(1)
  })

  it('12. reversals do not count as successful payments', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record = parsed.records[0]

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, createApprovedDecision(record, { proposedType: 'reversal' }))

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('rev1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    const all = await repo.getAll()
    const summary = calculateFinancialSummary(all)
    expect(summary.totalConfirmedExpenses).toBe(0)
  })

  it('13. refunds do not become ordinary income', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const refundRecord = parsed.records.find((r) => r.amountPaise === 129900)!

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(refundRecord.id, createApprovedDecision(refundRecord, { proposedType: 'refund', proposedCategory: 'Refunds' }))

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [refundRecord],
      decisions,
      batchMetadata: createTestMetadata('refund1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    const all = await repo.getAll()
    expect(all[0].type).toBe('refund')

    const summary = calculateFinancialSummary(all)
    expect(summary.totalConfirmedIncome).toBe(0) // Crucial: refund is NOT counted as earned income!
    expect(summary.totalRefunds).toBe(129900)
  })

  it('14. confirmed internal transfer does not inflate income or expenses', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const transferRecord = parsed.records.find((r) => r.amountPaise === 5000000)!

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(transferRecord.id, {
      recordId: transferRecord.id,
      state: 'ready_for_import',
      isInternalTransfer: true,
      proposedType: 'transfer',
      proposedCategory: 'Transfer',
      transferDestinationAccountId: 'acc-union-savings',
      transferDestinationAccountAlias: 'Union Bank Operating',
      evidence: ['account_transfer_pair'],
      conflicts: [],
      decisionReason: 'Confirmed internal transfer between owned accounts.',
      isConfirmed: true,
      updatedAt: new Date().toISOString(),
    })

    const result = await commitStatementBatch({
      workspace: 'live',
      records: [transferRecord],
      decisions,
      batchMetadata: createTestMetadata('trf1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)
    const all = await repo.getAll()
    expect(all[0].type).toBe('transfer')
    expect(all[0].fromAccount).toBe('SBI Primary Savings')
    expect(all[0].toAccount).toBe('Union Bank Operating')

    const summary = calculateFinancialSummary(all)
    expect(summary.totalConfirmedExpenses).toBe(0)
    expect(summary.totalConfirmedIncome).toBe(0)
    expect(summary.totalTransfers).toBe(5000000)
  })

  it('15. uncertain transfer pair cannot be auto-confirmed', () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const transferRecord = parsed.records.find((r) => r.amountPaise === 5000000)!

    const decision: ReconciliationDecision = {
      recordId: transferRecord.id,
      state: 'suggested_match',
      isInternalTransfer: true,
      proposedType: 'transfer',
      proposedCategory: 'Transfer',
      transferDestinationAccountId: 'acc-union-savings',
      transferDestinationAccountAlias: 'Union Bank Operating',
      evidence: ['weak_heuristic'],
      conflicts: [],
      decisionReason: 'Uncertain transfer heuristic.',
      isConfirmed: false, // Not confirmed!
      updatedAt: new Date().toISOString(),
    }

    const check = validateImportEligibility(transferRecord, decision, 'live')
    expect(check.isEligible).toBe(false)
    expect(check.rejectionReason).toMatch(/explicit confirmation/i)
  })

  // =========================================================================
  // 16 & 17: Workspace Isolation (Demo vs Live)
  // =========================================================================
  it('16. Demo import cannot alter Live data', async () => {
    // Populate Live ledger with 1 transaction
    await repo.add({
      id: 'tx-live-baseline',
      type: 'expense',
      amount: 10000,
      currency: 'INR',
      date: '2026-10-19',
      description: 'Live Transaction',
      category: 'General',
      paymentMethod: 'UPI',
      status: 'completed',
      isDemo: false,
      createdAt: '2026-10-19',
      updatedAt: '2026-10-19',
    })

    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      isDemo: true,
    })
    const record = parsed.records[0]

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, createApprovedDecision(record))

    const result = await commitStatementBatch({
      workspace: 'demo', // Demo workspace!
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('demo1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)

    const all = await repo.getAll()
    const liveTxs = all.filter((t) => !t.isDemo)
    const demoTxs = all.filter((t) => t.isDemo)

    expect(liveTxs).toHaveLength(1)
    expect(liveTxs[0].id).toBe('tx-live-baseline') // Unchanged!
    expect(demoTxs).toHaveLength(1)
  })

  it('17. Live import cannot alter Demo data', async () => {
    // Populate Demo ledger with 1 transaction
    await repo.add({
      id: 'tx-demo-baseline',
      type: 'income',
      amount: 250000,
      currency: 'INR',
      date: '2026-10-19',
      description: 'Demo Income',
      category: 'General',
      paymentMethod: 'UPI',
      status: 'completed',
      isDemo: true,
      createdAt: '2026-10-19',
      updatedAt: '2026-10-19',
    })

    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      isDemo: false,
    })
    const record = parsed.records[0]

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, createApprovedDecision(record))

    const result = await commitStatementBatch({
      workspace: 'live', // Live workspace!
      records: [record],
      decisions,
      batchMetadata: createTestMetadata('live1'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(result.success).toBe(true)

    const all = await repo.getAll()
    const demoTxs = all.filter((t) => t.isDemo)
    expect(demoTxs).toHaveLength(1)
    expect(demoTxs[0].id).toBe('tx-demo-baseline')
  })

  // =========================================================================
  // 18, 19, 20: Idempotency, Overlapping Files, Cross-Source Linking
  // =========================================================================
  it('18. re-importing the same statement file is idempotent and blocked', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record = parsed.records[0]
    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(record.id, createApprovedDecision(record))

    const metadata = createTestMetadata('same_file_idempotency')

    // First commit
    const first = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: metadata,
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })
    expect(first.success).toBe(true)

    // Second commit with identical file hash & account
    const second = await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions,
      batchMetadata: metadata,
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(second.success).toBe(false)
    expect(second.error).toContain('Idempotency violation')
    expect(await repo.getAll()).toHaveLength(1)
  })

  it('19. overlapping statement files do not silently duplicate transactions with identical references', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const record = parsed.records[0] // reference '529381729102'

    // First file imported
    await commitStatementBatch({
      workspace: 'live',
      records: [record],
      decisions: new Map([[record.id, createApprovedDecision(record)]]),
      batchMetadata: createTestMetadata('batch_A'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    // Second overlapping file with different filename but same reference 529381729102
    const overlappingRecord: StatementRecord = {
      ...record,
      id: 'stg-rec-overlapping-002',
    }
    const decisions2 = new Map([[overlappingRecord.id, createApprovedDecision(overlappingRecord)]])

    const second = await commitStatementBatch({
      workspace: 'live',
      records: [overlappingRecord],
      decisions: decisions2,
      batchMetadata: createTestMetadata('batch_B_overlapping'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(second.success).toBe(false)
    expect(second.error).toContain('Conflicting external reference')
  })

  it('20. same event observed through bank and UPI is counted only once when properly linked', async () => {
    // Bank record and PhonePe record of same Swiggy ₹350 payment
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const phonepeCsv = readFixture('phonepe_synthetic.csv')

    const parsedBank = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const parsedPhonePe = parseStatementCsv(phonepeCsv, {
      sourceAccountId: 'acc-phonepe-linked',
      sourceAccountAlias: 'PhonePe Linked',
    })

    const bankSwiggy = parsedBank.records.find((r) => r.amountPaise === 35000)!
    const phonepeSwiggy = parsedPhonePe.records.find((r) => r.amountPaise === 35000)!

    // Primary ledger is committed first
    await commitStatementBatch({
      workspace: 'live',
      records: [bankSwiggy],
      decisions: new Map([[bankSwiggy.id, createApprovedDecision(bankSwiggy)]]),
      batchMetadata: createTestMetadata('bank_primary'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    const existingBankTx = (await repo.getAll())[0]

    // PhonePe enrichment record is matched as duplicate to existing bank tx
    const phonepeDecision: ReconciliationDecision = {
      recordId: phonepeSwiggy.id,
      state: 'confirmed_match',
      matchedLedgerTxId: existingBankTx.id,
      proposedType: 'expense',
      proposedCategory: 'Food & dining',
      evidence: ['exact_reference'],
      conflicts: [],
      decisionReason: 'UPI enrichment linked to authoritative bank transaction.',
      isConfirmed: true,
      updatedAt: new Date().toISOString(),
    }

    const phonepeCommit = await commitStatementBatch({
      workspace: 'live',
      records: [phonepeSwiggy],
      decisions: new Map([[phonepeSwiggy.id, phonepeDecision]]),
      batchMetadata: createTestMetadata('phonepe_supplementary'),
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-phonepe-linked',
      sourceAccountAlias: 'PhonePe Linked',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(phonepeCommit.success).toBe(true)
    expect(phonepeCommit.skippedDuplicatesCount).toBe(1)
    expect(phonepeCommit.createdTransactionIds).toHaveLength(0)

    // Ledger has exactly 1 transaction for this payment
    const all = await repo.getAll()
    expect(all).toHaveLength(1)
  })

  // =========================================================================
  // 21, 22, 23: Atomicity & Failure Guarantees
  // =========================================================================
  it('21. failed transaction leaves no partial ledger changes', async () => {
    // Create custom repository that throws on 2nd write
    let writeCount = 0
    const flakyRepo = new InMemoryTransactionRepository()
    const origAdd = flakyRepo.add.bind(flakyRepo)
    flakyRepo.add = async (t: Transaction) => {
      writeCount++
      if (writeCount === 2) {
        throw new Error('Simulated disk full or abort exception during second record write')
      }
      return origAdd(t)
    }

    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec1 = parsed.records[0]
    const rec2 = parsed.records[1]

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(rec1.id, createApprovedDecision(rec1))
    decisions.set(rec2.id, createApprovedDecision(rec2))

    const res = await commitStatementBatch({
      workspace: 'live',
      records: [rec1, rec2],
      decisions,
      batchMetadata: createTestMetadata('atomic_fail'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: flakyRepo,
      mockBatchesStore: mockBatches,
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('Memory commit failed and was rolled back')

    // Clean atomic rollback: Zero partial transactions in repository
    expect(await flakyRepo.getAll()).toHaveLength(0)
  })

  it('22. failed commit does not create a misleading completed batch', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]

    // Missing decision triggers validation failure
    const res = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map(), // Empty!
      batchMetadata: createTestMetadata('fail_batch'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(res.success).toBe(false)
    expect(mockBatches.size).toBe(0)
  })

  it('23. successful import records its batch metadata and rollback manifest', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]

    const res = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('manifest_check'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(res.success).toBe(true)
    expect(res.batch).toBeDefined()
    expect(res.batch?.commitStatus).toBe('committed')
    expect(res.batch?.recoveryManifest).toBeDefined()
    expect(res.batch?.recoveryManifest?.createdTransactionIds).toHaveLength(1)
  })

  // =========================================================================
  // 24, 25, 26, 27, 28: Safe Batch Rollback
  // =========================================================================
  it('24. rolling back a simple batch removes only that batch newly created transactions', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]

    const commitRes = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('rollback_target'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(await repo.getAll()).toHaveLength(1)

    // Execute rollback
    const rollbackRes = await executeBatchRollback(commitRes.batch!.id, {
      targetScope: 'live',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(rollbackRes.success).toBe(true)
    expect(rollbackRes.restoredCount).toBe(1)
    expect(await repo.getAll()).toHaveLength(0)

    const updatedBatch = mockBatches.get(commitRes.batch!.id)!
    expect(updatedBatch.commitStatus).toBe('rolled_back')
  })

  it('25. rolling back a batch does not remove pre-existing matched transactions', async () => {
    // 1 pre-existing transaction
    const preExisting: Transaction = {
      id: 'tx-pre-existing-untouchable',
      type: 'expense',
      amount: 4500,
      currency: 'INR',
      date: '2026-10-15',
      description: 'Older purchase',
      category: 'General',
      paymentMethod: 'Card',
      status: 'completed',
      isDemo: false,
      createdAt: '2026-10-15',
      updatedAt: '2026-10-15',
    }
    await repo.add(preExisting)

    // Batch adds 1 new transaction
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]

    const commitRes = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('rollback_untouchable'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(await repo.getAll()).toHaveLength(2)

    await executeBatchRollback(commitRes.batch!.id, {
      targetScope: 'live',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    const all = await repo.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('tx-pre-existing-untouchable')
  })

  it('26. rollback is blocked when a transaction has unsafe subsequent modifications or dependencies', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]

    const commitRes = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('rollback_mod_check'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    const createdTxId = commitRes.createdTransactionIds![0]
    const tx = (await repo.getById(createdTxId))!

    // Simulate subsequent user edit
    tx.category = 'Modified Later'
    tx.updatedAt = new Date(Date.now() + 10000).toISOString()
    await repo.update(tx)

    // Rollback must be refused
    const check = await validateRollbackSafety(commitRes.batch!.id, {
      targetScope: 'live',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(check.canRollback).toBe(false)
    expect(check.reason).toContain('modified after import')

    const rollbackRes = await executeBatchRollback(commitRes.batch!.id, {
      targetScope: 'live',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })
    expect(rollbackRes.success).toBe(false)
  })

  it('27. repeating rollback is safe and idempotent', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]

    const commitRes = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('idempotent_rollback'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    // First rollback
    const first = await executeBatchRollback(commitRes.batch!.id, {
      targetScope: 'live',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })
    expect(first.success).toBe(true)

    // Second rollback
    const second = await executeBatchRollback(commitRes.batch!.id, {
      targetScope: 'live',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })
    expect(second.success).toBe(true)
    expect(second.restoredCount).toBe(0)
    expect(second.message).toContain('already rolled back')
  })

  it('28. rollback cannot affect a different workspace', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      isDemo: true,
    })
    const rec = parsed.records[0]

    const commitRes = await commitStatementBatch({
      workspace: 'demo', // Demo batch
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('demo_workspace_target'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    // Attempting to rollback Demo batch from Live workspace
    const rollbackRes = await executeBatchRollback(commitRes.batch!.id, {
      targetScope: 'live', // Mismatch!
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(rollbackRes.success).toBe(false)
    expect(rollbackRes.error).toContain('Workspace mismatch')
  })

  // =========================================================================
  // 29, 30, 31, 32, 33, 34: Concurrency, Balances, Paise, Privacy, Diagnostics
  // =========================================================================
  it('29. prevents concurrent commits from creating duplicates', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]
    const metadata = createTestMetadata('concurrent_key')

    // Run two simultaneous commit promises
    const [p1, p2] = await Promise.all([
      commitStatementBatch({
        workspace: 'live',
        records: [rec],
        decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
        batchMetadata: metadata,
        sourceProvider: 'sbi',
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
        inMemoryRepo: repo,
        mockBatchesStore: mockBatches,
      }),
      commitStatementBatch({
        workspace: 'live',
        records: [rec],
        decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
        batchMetadata: metadata,
        sourceProvider: 'sbi',
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
        inMemoryRepo: repo,
        mockBatchesStore: mockBatches,
      }),
    ])

    // Exactly one should succeed and one should fail
    const successes = [p1, p2].filter((r) => r.success)
    const failures = [p1, p2].filter((r) => !r.success)

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toMatch(/concurrent commit|Idempotency violation/i)
  })

  it('30. reconstructed balances are marked incomplete when statement coverage is insufficient', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = parsed.records[0]

    const commitRes = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('no_starting_bal'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      // No beginningBalancePaise supplied
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(commitRes.success).toBe(true)
    expect(commitRes.auditReport?.isReconciliationConclusive).toBe(false)
    expect(commitRes.auditReport?.reconciliationStatusReason).toContain('Incomplete balance coverage')
  })

  it('31. integer-paise calculations remain exact without floating-point artifacts', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    // Zomato ₹420.50 = 42050 paise
    const zomatoRec = parsed.records.find((r) => r.amountPaise === 42050)!
    expect(zomatoRec.amountPaise).toBe(42050)
    expect(Number.isInteger(zomatoRec.amountPaise)).toBe(true)

    const commitRes = await commitStatementBatch({
      workspace: 'live',
      records: [zomatoRec],
      decisions: new Map([[zomatoRec.id, createApprovedDecision(zomatoRec)]]),
      batchMetadata: createTestMetadata('paise_exact'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    const tx = (await repo.getAll())[0]
    expect(tx.amount).toBe(42050)
    expect(Number.isInteger(tx.amount)).toBe(true)
  })

  it('32. import errors do not leak raw financial records or passwords into logs', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })
    const rec = { ...parsed.records[0], amountPaise: -500 } // Invalid amount

    const res = await commitStatementBatch({
      workspace: 'live',
      records: [rec],
      decisions: new Map([[rec.id, createApprovedDecision(rec)]]),
      batchMetadata: createTestMetadata('leak_check'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(res.success).toBe(false)
    // Error must be sanitized without raw credential or stack dump
    expect(res.error).not.toMatch(/password|credential|pin|otp/i)
  })

  it('33. malformed or empty statement cannot partially modify the ledger', async () => {
    const res = await commitStatementBatch({
      workspace: 'live',
      records: [], // Empty records!
      decisions: new Map(),
      batchMetadata: createTestMetadata('empty_records'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('No statement records provided')
    expect(await repo.getAll()).toHaveLength(0)
  })

  it('34. final audit report distinguishes imported, skipped, pending, failed, and unresolved records', async () => {
    const sbiCsv = readFixture('sbi_synthetic.csv')
    const parsed = parseStatementCsv(sbiCsv, {
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    const expRec = parsed.records[0] // Valid expense
    const dupRec = parsed.records[1] // Duplicate of existing
    const pendingRec = {
      ...parsed.records[2],
      metadata: { ...parsed.records[2].metadata, paymentStatus: 'Pending' },
    }
    const failedRec: StatementRecord = {
      ...parsed.records[3],
      status: 'failed',
    }

    // Add existing tx to match dupRec
    await repo.add({
      id: 'tx-existing-for-dup',
      type: 'expense',
      amount: dupRec.amountPaise,
      currency: 'INR',
      date: dupRec.parsedDate!,
      description: dupRec.cleanDescription,
      category: 'Shopping',
      paymentMethod: 'UPI',
      externalRef: dupRec.normalizedReference,
      status: 'completed',
      isDemo: false,
      createdAt: '2026-10-19',
      updatedAt: '2026-10-19',
    })

    const decisions = new Map<string, ReconciliationDecision>()
    decisions.set(expRec.id, createApprovedDecision(expRec))
    decisions.set(dupRec.id, {
      recordId: dupRec.id,
      state: 'confirmed_match',
      matchedLedgerTxId: 'tx-existing-for-dup',
      proposedType: 'expense',
      proposedCategory: 'Shopping',
      evidence: ['exact_reference'],
      conflicts: [],
      decisionReason: 'Confirmed duplicate.',
      isConfirmed: true,
      updatedAt: new Date().toISOString(),
    })
    decisions.set(pendingRec.id, createApprovedDecision(pendingRec))
    decisions.set(failedRec.id, createApprovedDecision(failedRec, { proposedType: 'reversal' }))

    const res = await commitStatementBatch({
      workspace: 'live',
      records: [expRec, dupRec, pendingRec, failedRec],
      decisions,
      batchMetadata: createTestMetadata('multi_stat_audit'),
      sourceProvider: 'sbi',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo: repo,
      mockBatchesStore: mockBatches,
    })

    expect(res.success).toBe(true)
    const report = res.auditReport!

    expect(report.totalRowsParsed).toBe(4)
    expect(report.acceptedAndImportedCount).toBe(3) // expRec + pendingRec + failedRec
    expect(report.skippedDuplicatesCount).toBe(1) // dupRec
    expect(report.pendingCount).toBe(1)
    expect(report.failedCount).toBe(1)
    expect(report.retainedUnresolvedCount).toBe(0)
  })
})
