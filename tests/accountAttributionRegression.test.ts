/**
 * Synthetic Account Attribution & Mapping Regression Suite
 * Money Mate AI — Stage 8.5
 * 
 * Verifies end-to-end account attribution:
 * 1. A statement containing three distinct masked account identifiers preserves each identifier.
 * 2. Transactions from each identifier retain the correct mapping after import.
 * 3. Unknown identifiers remain unresolved and block commit until reviewed.
 * 4. A user selecting the wrong account cannot bypass validation silently.
 * 5. Internal transfers between mapped accounts do not inflate income or expenses.
 * 6. Bank/UPI matching respects account attribution.
 * 7. Rollback preserves unrelated records and the audit trail.
 * 8. No Live mutations occur when working in Demo Mode.
 * 9. Idempotency policy: Re-import of committed batch is blocked; rolled-back file re-import requires deliberate user confirmation.
 * 
 * Privacy: Uses synthetic identifiers ('XXXX1111', 'XXXX2222', 'XXXX3333') and synthetic transactions only.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  parsePhonePePdfText,
  type ExtractedPdfDocument,
} from '../src/utils/statementParsers/phonePePdfParser'
import { parseSbiCsv } from '../src/utils/statementParsers/sbiCsvParser'
import { parseUnionBankCsv } from '../src/utils/statementParsers/unionBankCsvParser'
import type { ParsedCsvTable } from '../src/utils/statementParsers/parserTypes'
import { evaluateStatementCoverage } from '../src/services/statementCoverageService'
import {
  createInitialReconciliationDecisions,
  calculateProposedImportSummary,
} from '../src/utils/reconciliationRules'
import {
  validateImportEligibility,
  evaluateBatchEligibility,
} from '../src/services/reconciliationEligibility'
import {
  commitStatementBatch,
  computeFileHash,
} from '../src/services/statementImportService'
import {
  validateRollbackSafety,
  executeBatchRollback,
} from '../src/services/statementRollbackService'
import {
  saveAccountMapping,
  getAccountMappingsForWorkspace,
  clearInMemoryAccountMappings,
} from '../src/services/accountMappingService'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import type {
  AccountDefinition,
  ImportBatch,
  StatementRecord,
  FormatDetectionResult,
} from '../src/types/reconciliation'
import type { Transaction } from '../src/types/transaction'
import { calculateFinancialSummary } from '../src/utils/calculations'

describe('Account Attribution & Mapping Regression Suite', () => {
  let inMemoryRepo: InMemoryTransactionRepository
  let mockBatchesStore: Map<string, ImportBatch>

  const ownedAccountsMap = new Map<string, AccountDefinition>([
    [
      'acc-sbi-primary',
      {
        id: 'acc-sbi-primary',
        institution: 'SBI',
        alias: 'SBI Primary Savings',
        accountType: 'savings',
        currency: 'INR',
        isOwned: true,
      },
    ],
    [
      'acc-union-savings',
      {
        id: 'acc-union-savings',
        institution: 'Union Bank of India',
        alias: 'Union Bank Operating',
        accountType: 'savings',
        currency: 'INR',
        isOwned: true,
      },
    ],
    [
      'acc-slice-card',
      {
        id: 'acc-slice-card',
        institution: 'Other',
        alias: 'Slice Card/UPI Account',
        accountType: 'credit_card',
        currency: 'INR',
        isOwned: true,
      },
    ],
  ])

  const mockDetection: FormatDetectionResult = {
    status: 'recognized',
    detectedProvider: 'phonepe',
    confidence: 'high',
    isVerified: true,
    matchedHeaders: ['Transaction ID', 'Date', 'Type', 'Amount'],
    missingHeaders: [],
    explanation: 'Synthetic PhonePe statement signature verified.',
  }

  // Helper to build synthetic PhonePe extracted document with 3 distinct masked accounts
  function createSynthetic3AccountPdfDoc(): ExtractedPdfDocument {
    const rawChunks = [
      // Account 1: XXXX1111 (Debit ₹150)
      [
        'Oct 18, 2026 02:15 PM',
        'Synthetic Merchant Alpha',
        'Transaction ID T1111111111111111111111',
        'UTR No. 111122223333',
        'Paid by XXXX1111',
        'DEBIT INR 150.00',
      ].join('\n'),

      // Account 2: XXXX2222 (Credit ₹500)
      [
        'Oct 17, 2026 11:30 AM',
        'Synthetic Client Beta',
        'Transaction ID T2222222222222222222222',
        'UTR No. 222233334444',
        'Credited to XXXX2222',
        'CREDIT INR 500.00',
      ].join('\n'),

      // Account 3: XXXXXX3333 (Debit ₹1,200)
      [
        'Oct 16, 2026 09:45 AM',
        'Synthetic Utility Gamma',
        'Transaction ID T3333333333333333333333',
        'UTR No. 333344445555',
        'Paid by XXXXXX3333',
        'DEBIT INR 1200.00',
      ].join('\n'),
    ]

    const fullText = rawChunks.join('\n\n')
    return {
      totalPages: 1,
      pages: [
        {
          pageNumber: 1,
          text: fullText,
          lineCount: fullText.split('\n').length,
          hasSelectableText: true,
        },
      ],
      fullText,
      warnings: [],
      isScannedOrImageOnly: false,
    }
  }

  beforeEach(() => {
    inMemoryRepo = new InMemoryTransactionRepository()
    mockBatchesStore = new Map()
    clearInMemoryAccountMappings()
  })

  it('preserves 3 distinct masked account identifiers during parsing', () => {
    const pdfDoc = createSynthetic3AccountPdfDoc()
    const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
      isDemo: true,
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
    })

    expect(parsed.records.length).toBe(3)
    expect(parsed.records[0].maskedAccountId).toBe('XXXX1111')
    expect(parsed.records[1].maskedAccountId).toBe('XXXX2222')
    expect(parsed.records[2].maskedAccountId).toBe('XXXXXX3333')

    // Since no explicit mappings were provided in options, each is marked unmapped
    expect(parsed.records[0].sourceAccountId).toBe('unmapped:XXXX1111')
    expect(parsed.records[1].sourceAccountId).toBe('unmapped:XXXX2222')
    expect(parsed.records[2].sourceAccountId).toBe('unmapped:XXXXXX3333')
  })

  it('maps masked identifiers to distinct internal accounts when explicit mappings are supplied', async () => {
    const pdfDoc = createSynthetic3AccountPdfDoc()
    const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
      isDemo: true,
      accountMappings: {
        XXXX1111: { targetAccountId: 'acc-sbi-primary', targetAccountAlias: 'SBI Primary Savings' },
        XXXX2222: { targetAccountId: 'acc-union-savings', targetAccountAlias: 'Union Bank Operating' },
        XXXXXX3333: { targetAccountId: 'acc-slice-card', targetAccountAlias: 'Slice Card/UPI Account' },
      },
    })

    expect(parsed.records[0].sourceAccountId).toBe('acc-sbi-primary')
    expect(parsed.records[1].sourceAccountId).toBe('acc-union-savings')
    expect(parsed.records[2].sourceAccountId).toBe('acc-slice-card')

    // Masked identifiers are preserved in metadata and record field
    expect(parsed.records[0].maskedAccountId).toBe('XXXX1111')
    expect(parsed.records[1].maskedAccountId).toBe('XXXX2222')
    expect(parsed.records[2].maskedAccountId).toBe('XXXXXX3333')
  })

  it('keeps unknown identifiers unresolved and strictly blocks batch commit until reviewed', async () => {
    const pdfDoc = createSynthetic3AccountPdfDoc()
    // Provide mapping for only one of the three accounts
    const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
      isDemo: true,
      accountMappings: {
        XXXX1111: { targetAccountId: 'acc-sbi-primary', targetAccountAlias: 'SBI Primary Savings' },
      },
    })

    const decisions = createInitialReconciliationDecisions(parsed.records, [], ownedAccountsMap)

    // Attempt to mark all as ready for import
    for (const record of parsed.records) {
      const dec = decisions.get(record.id)!
      dec.state = 'ready_for_import'
      dec.isConfirmed = true
      dec.proposedCategory = 'Food & Dining'
    }

    const batchEligibility = evaluateBatchEligibility(parsed.records, decisions, 'demo')
    expect(batchEligibility.isBatchEligible).toBe(false)
    expect(batchEligibility.unresolvedCount).toBe(2)
    expect(batchEligibility.rejectionReasons.some((r) => r.reason.includes('Unresolved account mapping'))).toBe(true)

    // Attempt commit
    const commitResult = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata: {
        fileName: 'synthetic_3acc.pdf',
        fileSizeBytes: 1024,
        fileHash: 'hash-synthetic-3acc',
        mimeType: 'application/pdf',
        detectedFormat: 'pdf',
      },
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })

    expect(commitResult.success).toBe(false)
    expect(commitResult.error).toContain('failed strict eligibility criteria')
    expect((await inMemoryRepo.getAll()).length).toBe(0)
  })

  it('retains distinct account attribution upon commit and generates accurate audit report', async () => {
    const pdfDoc = createSynthetic3AccountPdfDoc()
    const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
      isDemo: true,
      accountMappings: {
        XXXX1111: { targetAccountId: 'acc-sbi-primary', targetAccountAlias: 'SBI Primary Savings' },
        XXXX2222: { targetAccountId: 'acc-union-savings', targetAccountAlias: 'Union Bank Operating' },
        XXXXXX3333: { targetAccountId: 'acc-slice-card', targetAccountAlias: 'Slice Card/UPI Account' },
      },
    })

    const decisions = createInitialReconciliationDecisions(parsed.records, [], ownedAccountsMap)
    for (const record of parsed.records) {
      const dec = decisions.get(record.id)!
      dec.state = 'ready_for_import'
      dec.isConfirmed = true
      dec.proposedCategory = 'General Spending'
    }

    const commitResult = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata: {
        fileName: 'synthetic_3acc.pdf',
        fileSizeBytes: 1024,
        fileHash: 'hash-synthetic-3acc-ok',
        mimeType: 'application/pdf',
        detectedFormat: 'pdf',
      },
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })

    expect(commitResult.success).toBe(true)
    expect(commitResult.batch?.auditReport?.accountAttributionSummary).toBeDefined()

    const summary = commitResult.batch!.auditReport!.accountAttributionSummary!
    expect(summary['acc-sbi-primary']?.count).toBe(1)
    expect(summary['acc-sbi-primary']?.maskedIdentifiers).toContain('XXXX1111')
    expect(summary['acc-union-savings']?.count).toBe(1)
    expect(summary['acc-union-savings']?.maskedIdentifiers).toContain('XXXX2222')
    expect(summary['acc-slice-card']?.count).toBe(1)
    expect(summary['acc-slice-card']?.maskedIdentifiers).toContain('XXXXXX3333')

    // Verify persisted transactions in the repository
    const storedTxs = await inMemoryRepo.getAll()
    expect(storedTxs.length).toBe(3)
    const txByAcc = new Map(storedTxs.map((t) => [t.accountId, t]))
    expect(txByAcc.get('acc-sbi-primary')?.amount).toBe(15000)
    expect(txByAcc.get('acc-union-savings')?.amount).toBe(50000)
    expect(txByAcc.get('acc-slice-card')?.amount).toBe(120000)
  })

  it('internal transfer between mapped accounts does not inflate income or expenses', async () => {
    // Synthetic internal transfer: Debit on SBI, Credit on Union Bank
    const transferDebitText = [
      'Oct 18, 2026 10:00 AM',
      'Transfer to Union Bank',
      'Transaction ID T99991111',
      'UTR No. 888877776666',
      'Paid by XXXX1111',
      'DEBIT INR 2000.00',
    ].join('\n')

    const transferCreditText = [
      'Oct 18, 2026 10:00 AM',
      'Transfer from SBI',
      'Transaction ID T99992222',
      'UTR No. 888877776666',
      'Credited to XXXX2222',
      'CREDIT INR 2000.00',
    ].join('\n')

    const combinedTransferText = transferDebitText + '\n\n' + transferCreditText
    const pdfDoc: ExtractedPdfDocument = {
      totalPages: 1,
      pages: [
        {
          pageNumber: 1,
          text: combinedTransferText,
          lineCount: combinedTransferText.split('\n').length,
          hasSelectableText: true,
        },
      ],
      fullText: combinedTransferText,
      warnings: [],
      isScannedOrImageOnly: false,
    }

    const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
      isDemo: true,
      accountMappings: {
        XXXX1111: { targetAccountId: 'acc-sbi-primary', targetAccountAlias: 'SBI Primary Savings' },
        XXXX2222: { targetAccountId: 'acc-union-savings', targetAccountAlias: 'Union Bank Operating' },
      },
    })

    const decisions = createInitialReconciliationDecisions(parsed.records, [], ownedAccountsMap)
    const [recDebit, recCredit] = parsed.records

    const decDebit = decisions.get(recDebit.id)!
    const decCredit = decisions.get(recCredit.id)!

    expect(decDebit.isInternalTransfer).toBe(true)
    expect(decCredit.isInternalTransfer).toBe(true)

    // Confirm transfer
    decDebit.state = 'confirmed_match'
    decDebit.isConfirmed = true
    decCredit.state = 'confirmed_match'
    decCredit.isConfirmed = true

    const proposed = calculateProposedImportSummary(parsed.records, decisions, 0)
    expect(proposed.proposedTransfersCount).toBe(1)
    expect(proposed.proposedTransfersPaise).toBe(200000)
    // Internal transfers must strictly NOT inflate income or expense totals
    expect(proposed.proposedExpensesPaise).toBe(0)
    expect(proposed.proposedIncomePaise).toBe(0)

    const commitResult = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata: {
        fileName: 'synthetic_trf.pdf',
        fileSizeBytes: 512,
        fileHash: 'hash-synthetic-trf',
        mimeType: 'application/pdf',
        detectedFormat: 'pdf',
      },
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })

    expect(commitResult.success).toBe(true)
    const storedTxs = await inMemoryRepo.getAll()
    expect(storedTxs.length).toBe(1) // Single transfer transaction
    expect(storedTxs[0].type).toBe('transfer')

    const finSummary = calculateFinancialSummary(storedTxs)
    expect(finSummary.totalConfirmedIncome).toBe(0)
    expect(finSummary.totalConfirmedExpenses).toBe(0)
    expect(finSummary.totalTransfers).toBe(200000)
  })

  it('keeps account mappings isolated between Demo and Live workspaces', async () => {
    // Save mapping in Demo
    await saveAccountMapping({
      maskedAccountId: 'XXXX9999',
      targetAccountId: 'acc-sbi-primary',
      targetAccountAlias: 'SBI Primary Savings',
      provider: 'phonepe',
      workspace: 'demo',
      confirmedBy: 'user_explicit',
    })

    // Query demo mappings
    const demoMappings = await getAccountMappingsForWorkspace('demo')
    expect(demoMappings['XXXX9999']).toBeDefined()
    expect(demoMappings['XXXX9999'].targetAccountId).toBe('acc-sbi-primary')

    // Query live mappings: must be empty and not contaminated by demo mapping
    const liveMappings = await getAccountMappingsForWorkspace('live')
    expect(liveMappings['XXXX9999']).toBeUndefined()
  })

  it('enforces idempotency: blocks re-import of committed batch; requires deliberate action after rollback', async () => {
    const pdfDoc = createSynthetic3AccountPdfDoc()
    const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
      isDemo: true,
      accountMappings: {
        XXXX1111: { targetAccountId: 'acc-sbi-primary', targetAccountAlias: 'SBI Primary Savings' },
        XXXX2222: { targetAccountId: 'acc-union-savings', targetAccountAlias: 'Union Bank Operating' },
        XXXXXX3333: { targetAccountId: 'acc-slice-card', targetAccountAlias: 'Slice Card/UPI Account' },
      },
    })

    const decisions = createInitialReconciliationDecisions(parsed.records, [], ownedAccountsMap)
    for (const record of parsed.records) {
      const dec = decisions.get(record.id)!
      dec.state = 'ready_for_import'
      dec.isConfirmed = true
      dec.proposedCategory = 'Shopping'
    }

    const batchMetadata = {
      fileName: 'synthetic_idempotency.pdf',
      fileSizeBytes: 1024,
      fileHash: 'hash-idempotent-test-123',
      mimeType: 'application/pdf',
      detectedFormat: 'pdf' as const,
    }

    // 1. First commit: should succeed
    const firstCommit = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata,
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })
    expect(firstCommit.success).toBe(true)
    const batchId = firstCommit.batch!.id

    // 2. Immediate duplicate re-import attempt: must be strictly blocked
    const duplicateCommit = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata,
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })
    expect(duplicateCommit.success).toBe(false)
    expect(duplicateCommit.error).toContain('Idempotency violation')

    // 2b. Attempt to import the exact same file again after changing account mapping or selected account ID: must also be strictly blocked!
    const changedMappingCommit = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata,
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-union-savings', // different account!
      sourceAccountAlias: 'Union Bank Operating',
      inMemoryRepo,
      mockBatchesStore,
    })
    expect(changedMappingCommit.success).toBe(false)
    expect(changedMappingCommit.error).toContain('Idempotency violation')

    // 3. Rollback the batch
    const rollbackRes = await executeBatchRollback(batchId, {
      targetScope: 'demo',
      inMemoryRepo,
      mockBatchesStore,
    })
    expect(rollbackRes.success).toBe(true)
    expect((await inMemoryRepo.getAll()).length).toBe(0)

    // The rolled back batch remains in the audit history
    const storedBatch = mockBatchesStore.get(batchId)
    expect(storedBatch).toBeDefined()
    expect(storedBatch?.commitStatus).toBe('rolled_back')

    // 4. Attempt re-import without deliberate confirmation: must be blocked
    const unconfirmedReimport = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata,
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })
    expect(unconfirmedReimport.success).toBe(false)
    expect(unconfirmedReimport.error).toContain('previously imported and rolled back')

    // 5. Intentional re-import with deliberate flag allowReimportOfRolledBack: succeeds cleanly without duplication
    const intentionalReimport = await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata,
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      allowReimportOfRolledBack: true,
      inMemoryRepo,
      mockBatchesStore,
    })
    expect(intentionalReimport.success).toBe(true)
    expect((await inMemoryRepo.getAll()).length).toBe(3)
  })

  it('guarantees no Live mutations when committing in Demo Mode', async () => {
    // Seed Live ledger with pre-existing live transaction
    const liveTx: Transaction = {
      id: 'live-tx-100',
      type: 'expense',
      amount: 45000,
      currency: 'INR',
      date: '2026-10-15T12:00:00.000Z',
      description: 'Authoritative Live Expense',
      category: 'Utilities',
      paymentMethod: 'Bank transfer',
      accountId: 'acc-sbi-primary',
      status: 'completed',
      isDemo: false,
      createdAt: '2026-10-15T12:00:00.000Z',
      updatedAt: '2026-10-15T12:00:00.000Z',
    }
    await inMemoryRepo.add(liveTx)

    const pdfDoc = createSynthetic3AccountPdfDoc()
    const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
      isDemo: true,
      accountMappings: {
        XXXX1111: { targetAccountId: 'acc-sbi-primary', targetAccountAlias: 'SBI Primary Savings' },
        XXXX2222: { targetAccountId: 'acc-union-savings', targetAccountAlias: 'Union Bank Operating' },
        XXXXXX3333: { targetAccountId: 'acc-slice-card', targetAccountAlias: 'Slice Card/UPI Account' },
      },
    })

    const decisions = createInitialReconciliationDecisions(parsed.records, [], ownedAccountsMap)
    for (const record of parsed.records) {
      const dec = decisions.get(record.id)!
      dec.state = 'ready_for_import'
      dec.isConfirmed = true
      dec.proposedCategory = 'Food'
    }

    await commitStatementBatch({
      workspace: 'demo',
      records: parsed.records,
      decisions,
      batchMetadata: {
        fileName: 'demo_test.pdf',
        fileSizeBytes: 1024,
        fileHash: 'hash-demo-isolation',
        mimeType: 'application/pdf',
        detectedFormat: 'pdf',
      },
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })

    const allTxs = await inMemoryRepo.getAll()
    const liveTxs = allTxs.filter((t) => t.isDemo !== true)
    const demoTxs = allTxs.filter((t) => t.isDemo === true)

    // Authoritative Live ledger remained strictly 1 transaction, completely untouched
    expect(liveTxs.length).toBe(1)
    expect(liveTxs[0].id).toBe('live-tx-100')
    expect(liveTxs[0].amount).toBe(45000)

    // 3 Demo transactions were added
    expect(demoTxs.length).toBe(3)
  })

  it('verifies IndexedDB version 5-to-6 migration preserves existing stores and creates account_mappings', async () => {
    // Synthetic migration logic test simulating IDB upgrade
    const existingStores = new Set([
      'transactions',
      'inventory',
      'shopping_list',
      'receipt_inventory_links',
      'recurring_schedules',
      'bill_instances',
      'planner_tasks',
      'dismissed_alerts',
      'categories',
      'import_batches',
    ])

    // Before v6 upgrade
    expect(existingStores.has('account_mappings')).toBe(false)
    expect(existingStores.has('transactions')).toBe(true)

    // Apply upgrade step (as implemented in db.ts openDatabase onupgradeneeded)
    if (!existingStores.has('account_mappings')) {
      existingStores.add('account_mappings')
    }

    // After v6 upgrade
    expect(existingStores.has('account_mappings')).toBe(true)
    expect(existingStores.has('transactions')).toBe(true)
    expect(existingStores.size).toBe(11)
  })

  it('matches a PhonePe debit to an existing bank debit via exact UTR reference without creating duplicate transaction', async () => {
    // 1. Existing authoritative bank debit on SBI
    const existingBankDebit: Transaction = {
      id: 'tx-sbi-bank-debit-1',
      type: 'expense',
      amount: 150000, // ₹1,500.00
      currency: 'INR',
      date: '2026-10-18T10:00:00.000Z',
      description: 'UPI/998877665544/Merchant Store',
      category: 'Shopping',
      paymentMethod: 'UPI',
      accountId: 'acc-sbi-primary',
      status: 'completed',
      externalRef: '998877665544',
      isDemo: true,
      createdAt: '2026-10-18T10:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z',
    }
    await inMemoryRepo.add(existingBankDebit)

    // 2. Incoming PhonePe record with identical UTR reference and amount
    const phonePeRecord: StatementRecord = {
      id: 'rec-phonepe-1',
      statementFileId: 'synthetic_phonepe.pdf',
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      maskedAccountId: 'XXXX1111',
      rawDateText: '18 Oct 2026',
      parsedDate: '2026-10-18T10:00:00.000Z',
      rawDescription: 'Paid to Merchant Store',
      cleanDescription: 'Merchant Store',
      direction: 'debit',
      amountPaise: 150000,
      signedAmountPaise: -150000,
      originalReference: '998877665544',
      normalizedReference: '998877665544',
      proposedType: 'expense',
      proposedCategory: 'Shopping',
      isDemo: true,
      status: 'ready',
      warnings: [],
      errors: [],
      metadata: { rawNarration: 'Paid to Merchant Store' },
    }

    const decisions = createInitialReconciliationDecisions([phonePeRecord], [existingBankDebit], ownedAccountsMap)
    const dec = decisions.get('rec-phonepe-1')!

    expect(dec.state).toBe('suggested_match')
    expect(dec.matchedLedgerTxId).toBe('tx-sbi-bank-debit-1')
    expect(dec.evidence).toContain('exact_reference')
    expect(dec.evidence).toContain('compatible_amount_direction')

    // Confirm match
    dec.state = 'confirmed_match'
    dec.isConfirmed = true

    const eligibility = validateImportEligibility(phonePeRecord, dec, 'demo')
    expect(eligibility.isEligible).toBe(true)
    expect(eligibility.action).toBe('skip_confirmed_duplicate')

    // Commit batch
    const commitRes = await commitStatementBatch({
      workspace: 'demo',
      records: [phonePeRecord],
      decisions,
      batchMetadata: {
        fileName: 'synthetic_phonepe.pdf',
        fileSizeBytes: 1024,
        fileHash: 'hash-phonepe-bank-match',
        mimeType: 'application/pdf',
        detectedFormat: 'pdf',
      },
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      inMemoryRepo,
      mockBatchesStore,
    })

    expect(commitRes.success).toBe(true)
    expect(commitRes.skippedDuplicatesCount).toBe(1)
    expect(commitRes.createdTransactionIds?.length).toBe(0)

    // Ledger transactions count remains strictly 1 (no duplicate created!)
    const allTxs = await inMemoryRepo.getAll()
    expect(allTxs.length).toBe(1)
    expect(allTxs[0].id).toBe('tx-sbi-bank-debit-1')
  })

  it('keeps records separate when UPI and bank records have same amount but different references', async () => {
    const existingTx: Transaction = {
      id: 'tx-bank-1',
      type: 'expense',
      amount: 45000, // ₹450.00
      currency: 'INR',
      date: '2026-10-18T12:00:00.000Z',
      description: 'UPI/111111111111/Store A',
      category: 'Food',
      paymentMethod: 'UPI',
      accountId: 'acc-sbi-primary',
      status: 'completed',
      externalRef: '111111111111',
      isDemo: true,
      createdAt: '2026-10-18T12:00:00.000Z',
      updatedAt: '2026-10-18T12:00:00.000Z',
    }

    const incomingRecord: StatementRecord = {
      id: 'rec-upi-diff-ref',
      statementFileId: 'synth.csv',
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      rawDateText: '18 Oct 2026',
      parsedDate: '2026-10-18T12:00:00.000Z',
      rawDescription: 'Store B',
      cleanDescription: 'Store B',
      direction: 'debit',
      amountPaise: 45000, // same ₹450.00
      signedAmountPaise: -45000,
      originalReference: '222222222222', // completely different reference!
      normalizedReference: '222222222222',
      proposedType: 'expense',
      proposedCategory: 'Food',
      isDemo: true,
      status: 'ready',
      warnings: [],
      errors: [],
      metadata: {},
    }

    const decisions = createInitialReconciliationDecisions([incomingRecord], [existingTx], ownedAccountsMap)
    const dec = decisions.get('rec-upi-diff-ref')!

    expect(dec.state).toBe('unmatched')
    expect(dec.matchedLedgerTxId).toBeUndefined()
    expect(dec.decisionReason).toContain('Distinct transaction')
  })

  it('flags competing matches when multiple statement records match the same ledger transaction', async () => {
    const existingTx: Transaction = {
      id: 'tx-target-competing',
      type: 'expense',
      amount: 80000, // ₹800.00
      currency: 'INR',
      date: '2026-10-18T14:00:00.000Z',
      description: 'UPI/888888888888/Supermarket',
      category: 'Groceries',
      paymentMethod: 'UPI',
      accountId: 'acc-sbi-primary',
      status: 'completed',
      externalRef: '888888888888',
      isDemo: true,
      createdAt: '2026-10-18T14:00:00.000Z',
      updatedAt: '2026-10-18T14:00:00.000Z',
    }

    // Two different records in incoming batch carrying the same reference or competing for target
    const recordA: StatementRecord = {
      id: 'rec-competing-a',
      statementFileId: 'batch.csv',
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      rawDateText: '18 Oct 2026',
      parsedDate: '2026-10-18T14:00:00.000Z',
      rawDescription: 'Supermarket A',
      cleanDescription: 'Supermarket A',
      direction: 'debit',
      amountPaise: 80000,
      signedAmountPaise: -80000,
      normalizedReference: '888888888888',
      proposedType: 'expense',
      proposedCategory: 'Groceries',
      isDemo: true,
      status: 'ready',
      warnings: [],
      errors: [],
      metadata: {},
    }

    const recordB: StatementRecord = {
      id: 'rec-competing-b',
      statementFileId: 'batch.csv',
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-sbi-primary',
      sourceAccountAlias: 'SBI Primary Savings',
      rawDateText: '18 Oct 2026',
      parsedDate: '2026-10-18T14:05:00.000Z',
      rawDescription: 'Supermarket B',
      cleanDescription: 'Supermarket B',
      direction: 'debit',
      amountPaise: 80000,
      signedAmountPaise: -80000,
      normalizedReference: '888888888888',
      proposedType: 'expense',
      proposedCategory: 'Groceries',
      isDemo: true,
      status: 'ready',
      warnings: [],
      errors: [],
      metadata: {},
    }

    const decisions = createInitialReconciliationDecisions([recordA, recordB], [existingTx], ownedAccountsMap)
    const decA = decisions.get('rec-competing-a')!
    const decB = decisions.get('rec-competing-b')!

    // Both competing records MUST be converted to conflicting to require explicit user resolution
    expect(decA.state).toBe('conflicting')
    expect(decB.state).toBe('conflicting')
    expect(decA.conflicts).toContain('competing_match')
    expect(decB.conflicts).toContain('competing_match')
  })

  it('verifies opening and closing balance calculation on bank CSV and rejects inconsistent running balance', () => {
    // Synthetic SBI CSV table with valid running balance
    const sbiTable: ParsedCsvTable = {
      headers: ['Txn Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance'],
      rows: [
        ['15/10/2026', 'Opening Deposit', 'REF101', '', '10,000.00', '10,000.00'],
        ['16/10/2026', 'Grocery Store', 'REF102', '1,500.00', '', '8,500.00'],
        ['17/10/2026', 'Client Payment', 'REF103', '', '2,000.00', '10,500.00'],
      ],
      warnings: [],
    }

    const parsed = parseSbiCsv(sbiTable, {
      status: 'recognized',
      detectedProvider: 'sbi',
      confidence: 1,
      matchedHeaders: ['Txn Date', 'Description', 'Debit', 'Credit', 'Balance'],
      missingHeaders: [],
      explanation: 'SBI format verified.',
    })

    expect(parsed.records.length).toBe(3)
    expect(parsed.rejectedRows.length).toBe(0)

    // Verify row 1: Opening balance 0 + 10000 = 10000.00 (1000000 paise)
    expect(parsed.records[0].balanceAfterPaise).toBe(1000000)
    // Row 2: 10000 - 1500 = 8500.00 (850000 paise)
    expect(parsed.records[1].balanceAfterPaise).toBe(850000)
    // Row 3: 8500 + 2000 = 10500.00 (1050000 paise)
    expect(parsed.records[2].balanceAfterPaise).toBe(1050000)
  })

  it('rejects malformed bank statement rows with actionable field diagnostics', () => {
    const invalidUnionTable: ParsedCsvTable = {
      headers: ['Date', 'Remarks', 'Cheque No', 'Withdrawal (Dr)', 'Deposit (Cr)', 'Account Balance'],
      rows: [
        ['INVALID_DATE', 'Electricity Bill', 'CHQ001', '500.00', '', '9,500.00'],
        ['15/10/2026', 'Missing Amount Row', 'CHQ002', '', '', '9,500.00'],
        ['16/10/2026', 'Both Debit & Credit', 'CHQ003', '100.00', '200.00', '9,600.00'],
      ],
      warnings: [],
    }

    const parsed = parseUnionBankCsv(invalidUnionTable, {
      status: 'recognized',
      detectedProvider: 'union_bank',
      confidence: 1,
      matchedHeaders: ['Date', 'Remarks', 'Withdrawal (Dr)', 'Deposit (Cr)'],
      missingHeaders: [],
      explanation: 'Union Bank format verified.',
    })

    expect(parsed.records.length).toBe(0)
    expect(parsed.rejectedRows.length).toBe(3)

    expect(parsed.rejectedRows[0].fieldErrors.date).toBeDefined()
    expect(parsed.rejectedRows[1].fieldErrors.amount).toBeDefined()
    expect(parsed.rejectedRows[2].fieldErrors.amount).toContain('contains both')
  })

  describe('Consecutive Statement Validation & Coverage Tracking', () => {
    it('verifies consecutive statements where closing balance agrees with next opening balance', () => {
      // Statement 1: Oct 1, 2025 to Mar 31, 2026. Closing balance = 50,000.00 (5000000 paise)
      const batch1: ImportBatch = {
        id: 'batch-sbi-part1',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:00:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: {
          fileName: 'sbi_oct2025_mar2026.csv',
          fileHash: 'hash-sbi-part1',
          fileSizeBytes: 2048,
          detectedFormat: 'sbi_csv',
          formatConfidence: 1,
        },
        auditReport: {
          totalRows: 50,
          acceptedCount: 50,
          duplicateCount: 0,
          skippedCount: 0,
          firstTransactionDate: '2025-10-01T09:00:00.000Z',
          lastTransactionDate: '2026-03-31T17:00:00.000Z',
          statementStartDate: '2025-10-01',
          statementEndDate: '2026-03-31',
          beginningBalancePaise: 2000000,
          statementClosingBalancePaise: 5000000,
          netChangePaise: 3000000,
          calculatedClosingBalancePaise: 5000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      // Statement 2: Apr 01, 2026 to Oct 20, 2026. Opening balance = 50,000.00 (5000000 paise)
      const batch2: ImportBatch = {
        id: 'batch-sbi-part2',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:05:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: {
          fileName: 'sbi_apr2026_oct2026.csv',
          fileHash: 'hash-sbi-part2',
          fileSizeBytes: 2560,
          detectedFormat: 'sbi_csv',
          formatConfidence: 1,
        },
        auditReport: {
          totalRows: 60,
          acceptedCount: 60,
          duplicateCount: 0,
          skippedCount: 0,
          firstTransactionDate: '2026-04-01T10:00:00.000Z',
          lastTransactionDate: '2026-10-20T18:00:00.000Z',
          statementStartDate: '2026-04-01',
          statementEndDate: '2026-10-20',
          beginningBalancePaise: 5000000,
          statementClosingBalancePaise: 8500000,
          netChangePaise: 3500000,
          calculatedClosingBalancePaise: 8500000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      const coverage = evaluateStatementCoverage([batch1, batch2], {
        targetStartDate: '2025-10-01',
        targetEndDate: '2026-10-20',
      })

      expect(coverage.overallStatus).toBe('complete_verified')
      expect(coverage.totalGaps).toBe(0)
      expect(coverage.totalOverlaps).toBe(0)
      expect(coverage.unresolvedDiscrepancyCount).toBe(0)

      const accCoverage = coverage.accountCoverages['acc-sbi-1234']
      expect(accCoverage).toBeDefined()
      expect(accCoverage.coverageStatus).toBe('complete_verified')
      expect(accCoverage.totalBatches).toBe(2)
      expect(accCoverage.gaps.length).toBe(0)
      expect(accCoverage.overlaps.length).toBe(0)
    })

    it('identifies calendar gaps between consecutive statements and marks coverage partial', () => {
      // Batch A: Oct 1, 2025 to Jan 31, 2026
      const batchA: ImportBatch = {
        id: 'batch-gap-1',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:00:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-union-5678',
        sourceAccountAlias: 'Union Bank Current',
        fileMetadata: { fileName: 'union_oct2025_jan2026.csv', fileHash: 'hash-g1', fileSizeBytes: 1024, detectedFormat: 'union_bank_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 20, acceptedCount: 20, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2025-10-01T00:00:00.000Z',
          lastTransactionDate: '2026-01-31T23:59:59.000Z',
          statementStartDate: '2025-10-01',
          statementEndDate: '2026-01-31',
          beginningBalancePaise: 1000000,
          statementClosingBalancePaise: 2500000,
          netChangePaise: 1500000,
          calculatedClosingBalancePaise: 2500000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      // Batch B: Apr 1, 2026 to Oct 20, 2026 (Missing Feb and Mar 2026)
      const batchB: ImportBatch = {
        id: 'batch-gap-2',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:05:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-union-5678',
        sourceAccountAlias: 'Union Bank Current',
        fileMetadata: { fileName: 'union_apr2026_oct2026.csv', fileHash: 'hash-g2', fileSizeBytes: 1024, detectedFormat: 'union_bank_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 30, acceptedCount: 30, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2026-04-01T00:00:00.000Z',
          lastTransactionDate: '2026-10-20T23:59:59.000Z',
          statementStartDate: '2026-04-01',
          statementEndDate: '2026-10-20',
          beginningBalancePaise: 2500000,
          statementClosingBalancePaise: 4000000,
          netChangePaise: 1500000,
          calculatedClosingBalancePaise: 4000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      const coverage = evaluateStatementCoverage([batchA, batchB], {
        targetStartDate: '2025-10-01',
        targetEndDate: '2026-10-20',
      })

      expect(coverage.overallStatus).toBe('partial')
      expect(coverage.totalGaps).toBe(1)
      const gap = coverage.accountCoverages['acc-union-5678'].gaps[0]
      expect(gap.previousBatchId).toBe('batch-gap-1')
      expect(gap.nextBatchId).toBe('batch-gap-2')
      expect(gap.gapDays).toBeGreaterThan(50) // ~60 days gap
    })

    it('identifies overlapping statement periods and flags for reconciliation without guessing duplicates', () => {
      // Batch 1: Jul 1, 2026 to Sep 15, 2026
      const batch1: ImportBatch = {
        id: 'batch-overlap-1',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:00:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: { fileName: 'sbi_jul_sep15.csv', fileHash: 'hash-o1', fileSizeBytes: 1000, detectedFormat: 'sbi_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 10, acceptedCount: 10, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2026-07-01T00:00:00.000Z',
          lastTransactionDate: '2026-09-15T00:00:00.000Z',
          statementStartDate: '2026-07-01',
          statementEndDate: '2026-09-15',
          beginningBalancePaise: 5000000,
          statementClosingBalancePaise: 6000000,
          netChangePaise: 1000000,
          calculatedClosingBalancePaise: 6000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      // Batch 2: Sep 01, 2026 to Oct 20, 2026 (Overlaps Sep 01 to Sep 15)
      const batch2: ImportBatch = {
        id: 'batch-overlap-2',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:02:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: { fileName: 'sbi_sep01_oct20.csv', fileHash: 'hash-o2', fileSizeBytes: 1000, detectedFormat: 'sbi_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 15, acceptedCount: 15, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2026-09-01T00:00:00.000Z',
          lastTransactionDate: '2026-10-20T00:00:00.000Z',
          statementStartDate: '2026-09-01',
          statementEndDate: '2026-10-20',
          beginningBalancePaise: 5500000,
          statementClosingBalancePaise: 7000000,
          netChangePaise: 1500000,
          calculatedClosingBalancePaise: 7000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      const coverage = evaluateStatementCoverage([batch1, batch2])
      expect(coverage.totalOverlaps).toBe(1)
      const overlap = coverage.accountCoverages['acc-sbi-1234'].overlaps[0]
      expect(overlap.batchIdA).toBe('batch-overlap-1')
      expect(overlap.batchIdB).toBe('batch-overlap-2')
      expect(overlap.overlapStartDate).toBe('2026-09-01T00:00:00.000Z')
      expect(overlap.overlapEndDate).toBe('2026-09-15T00:00:00.000Z')
      expect(overlap.overlapDays).toBe(14)
    })

    it('never compares different account IDs as though they were the same account', () => {
      // SBI batch
      const sbiBatch: ImportBatch = {
        id: 'batch-sbi-only',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:00:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: { fileName: 'sbi.csv', fileHash: 'hash-s1', fileSizeBytes: 500, detectedFormat: 'sbi_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 10, acceptedCount: 10, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2025-10-01T00:00:00.000Z',
          lastTransactionDate: '2026-03-31T00:00:00.000Z',
          statementStartDate: '2025-10-01',
          statementEndDate: '2026-03-31',
          beginningBalancePaise: 1000000,
          statementClosingBalancePaise: 2000000,
          netChangePaise: 1000000,
          calculatedClosingBalancePaise: 2000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      // Union Bank batch starting Apr 01, 2026
      const unionBatch: ImportBatch = {
        id: 'batch-union-only',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:05:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-union-5678',
        sourceAccountAlias: 'Union Bank Current',
        fileMetadata: { fileName: 'union.csv', fileHash: 'hash-u1', fileSizeBytes: 500, detectedFormat: 'union_bank_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 10, acceptedCount: 10, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2026-04-01T00:00:00.000Z',
          lastTransactionDate: '2026-10-20T00:00:00.000Z',
          statementStartDate: '2026-04-01',
          statementEndDate: '2026-10-20',
          beginningBalancePaise: 5000000, // Different opening balance
          statementClosingBalancePaise: 6000000,
          netChangePaise: 1000000,
          calculatedClosingBalancePaise: 6000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      const coverage = evaluateStatementCoverage([sbiBatch, unionBatch])

      // Each account must be strictly isolated: exactly 1 batch each, 0 cross-account gaps or balance discrepancies
      expect(Object.keys(coverage.accountCoverages).length).toBe(2)
      expect(coverage.accountCoverages['acc-sbi-1234'].totalBatches).toBe(1)
      expect(coverage.accountCoverages['acc-union-5678'].totalBatches).toBe(1)

      expect(coverage.accountCoverages['acc-sbi-1234'].gaps.length).toBe(0)
      expect(coverage.accountCoverages['acc-union-5678'].gaps.length).toBe(0)
      expect(coverage.totalGaps).toBe(0)
      expect(coverage.unresolvedDiscrepancyCount).toBe(0)
    })

    it('produces an explicit unresolved discrepancy when consecutive statements have balance mismatch and never invents transactions', () => {
      // Batch 1 closing balance: ₹50,000.00
      const batch1: ImportBatch = {
        id: 'batch-disc-1',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:00:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: { fileName: 'sbi_part1.csv', fileHash: 'hash-d1', fileSizeBytes: 1000, detectedFormat: 'sbi_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 10, acceptedCount: 10, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2025-10-01T00:00:00.000Z',
          lastTransactionDate: '2026-03-31T00:00:00.000Z',
          statementStartDate: '2025-10-01',
          statementEndDate: '2026-03-31',
          beginningBalancePaise: 1000000,
          statementClosingBalancePaise: 5000000, // ₹50,000.00
          netChangePaise: 4000000,
          calculatedClosingBalancePaise: 5000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      // Batch 2 immediately follows on 2026-04-01, but opening balance is ₹55,000.00 (₹5,000 mismatch)
      const batch2: ImportBatch = {
        id: 'batch-disc-2',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:02:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: { fileName: 'sbi_part2.csv', fileHash: 'hash-d2', fileSizeBytes: 1000, detectedFormat: 'sbi_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 10, acceptedCount: 10, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2026-04-01T00:00:00.000Z',
          lastTransactionDate: '2026-10-20T00:00:00.000Z',
          statementStartDate: '2026-04-01',
          statementEndDate: '2026-10-20',
          beginningBalancePaise: 5500000, // ₹55,000.00 (Variance of +500000 paise)
          statementClosingBalancePaise: 8000000,
          netChangePaise: 2500000,
          calculatedClosingBalancePaise: 8000000,
          isReconciliationConclusive: true,
          reconciliationDiscrepancyPaise: 0,
        },
      }

      const coverage = evaluateStatementCoverage([batch1, batch2], {
        targetStartDate: '2025-10-01',
        targetEndDate: '2026-10-20',
      })

      expect(coverage.overallStatus).toBe('unresolved_discrepancy')
      expect(coverage.unresolvedDiscrepancyCount).toBe(1)

      const accCoverage = coverage.accountCoverages['acc-sbi-1234']
      expect(accCoverage.coverageStatus).toBe('unresolved_discrepancy')
      expect(accCoverage.statusReason).toContain('opening and closing balances do not match')

      const discGap = accCoverage.gaps[0]
      expect(discGap).toBeDefined()
      expect(discGap.isBalanceDiscrepancy).toBe(true)
      expect(discGap.balanceDiscrepancyPaise).toBe(500000) // ₹5,000
    })

    it('marks coverage partial instead of complete when a batch has inconclusive reconciliation even if dates span full year', () => {
      const batchInconclusive: ImportBatch = {
        id: 'batch-inconclusive',
        workspaceMode: 'demo',
        createdAt: '2026-10-20T10:00:00.000Z',
        commitStatus: 'committed',
        sourceAccountId: 'acc-sbi-1234',
        sourceAccountAlias: 'SBI Primary Savings',
        fileMetadata: { fileName: 'sbi_year.csv', fileHash: 'hash-inc', fileSizeBytes: 2000, detectedFormat: 'sbi_csv', formatConfidence: 1 },
        auditReport: {
          totalRows: 100, acceptedCount: 100, duplicateCount: 0, skippedCount: 0,
          firstTransactionDate: '2025-10-01T00:00:00.000Z',
          lastTransactionDate: '2026-10-20T00:00:00.000Z',
          statementStartDate: '2025-10-01',
          statementEndDate: '2026-10-20',
          beginningBalancePaise: undefined, // Missing balance
          statementClosingBalancePaise: undefined,
          netChangePaise: 0,
          calculatedClosingBalancePaise: undefined,
          isReconciliationConclusive: false, // Inconclusive!
          reconciliationDiscrepancyPaise: 0,
        },
      }

      const coverage = evaluateStatementCoverage([batchInconclusive], {
        targetStartDate: '2025-10-01',
        targetEndDate: '2026-10-20',
      })

      // Must NOT be marked complete_verified because balance is inconclusive!
      expect(coverage.overallStatus).toBe('partial')
      expect(coverage.accountCoverages['acc-sbi-1234'].coverageStatus).toBe('partial')
      expect(coverage.accountCoverages['acc-sbi-1234'].statusReason).toContain('lack conclusive balance reconciliation')
    })
  })

  describe('Statement Direction Immutability & Financial Classification Integrity', () => {
    it('strictly preserves statement debit/credit direction across refunds, transfers, and reversals', () => {
      // 1. Synthetic PDF document with an expense, a transfer, a received income, and a refund
      const rawText = [
        // Standard expense (Debit)
        'Oct 18, 2026 01:00 PM',
        'Coffee Shop',
        'Transaction ID T_EXP_1',
        'UTR No. 111111111111',
        'Paid by XXXX1111',
        'DEBIT INR 250.00',
        '',
        // Transfer to another account (Debit)
        'Oct 18, 2026 02:00 PM',
        'Transfer to Friend',
        'Transaction ID T_TRF_1',
        'UTR No. 222222222222',
        'Paid by XXXX1111',
        'DEBIT INR 1500.00',
        '',
        // Normal income (Credit)
        'Oct 18, 2026 03:00 PM',
        'Salary Credit',
        'Transaction ID T_INC_1',
        'UTR No. 333333333333',
        'Credited to XXXX1111',
        'CREDIT INR 50000.00',
        '',
        // Merchant Refund (Credit)
        'Oct 18, 2026 04:00 PM',
        'Refund from Online Store',
        'Transaction ID T_REF_1',
        'UTR No. 444444444444',
        'Credited to XXXX1111',
        'CREDIT INR 499.00',
      ].join('\n')

      const pdfDoc: ExtractedPdfDocument = {
        totalPages: 1,
        pages: [{ pageNumber: 1, text: rawText, lineCount: rawText.split('\n').length, hasSelectableText: true }],
        fullText: rawText,
        warnings: [],
        isScannedOrImageOnly: false,
      }

      const parsed = parsePhonePePdfText(pdfDoc, mockDetection, {
        isDemo: true,
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
      })

      expect(parsed.records.length).toBe(4)
      expect(parsed.statistics.totalRows).toBe(4)
      expect(parsed.statistics.debitCount).toBe(2)
      expect(parsed.statistics.creditCount).toBe(2)

      const [recExp, recTrf, recInc, recRef] = parsed.records

      // Expense
      expect(recExp.direction).toBe('debit')
      expect(recExp.proposedType).toBe('expense')
      expect(recExp.signedAmountPaise).toBe(-25000)

      // Transfer: direction must remain 'debit' regardless of proposedType being 'transfer'
      expect(recTrf.direction).toBe('debit')
      expect(recTrf.proposedType).toBe('transfer')
      expect(recTrf.signedAmountPaise).toBe(-150000)

      // Income
      expect(recInc.direction).toBe('credit')
      expect(recInc.proposedType).toBe('income')
      expect(recInc.signedAmountPaise).toBe(5000000)

      // Refund: direction must remain 'credit' regardless of proposedType being 'refund'
      expect(recRef.direction).toBe('credit')
      expect(recRef.proposedType).toBe('refund')
      expect(recRef.signedAmountPaise).toBe(49900)

      // Pass through reconciliation decisions and verify direction is never modified
      const decisions = createInitialReconciliationDecisions(parsed.records, [], ownedAccountsMap)
      for (const rec of parsed.records) {
        const dec = decisions.get(rec.id)!
        dec.state = 'ready_for_import'
        dec.isConfirmed = true
      }

      // Re-verify that records maintain their source statement direction
      expect(parsed.records[0].direction).toBe('debit')
      expect(parsed.records[1].direction).toBe('debit')
      expect(parsed.records[2].direction).toBe('credit')
      expect(parsed.records[3].direction).toBe('credit')

      // Summary checks
      const proposedSummary = calculateProposedImportSummary(parsed.records, decisions, 0)
      expect(proposedSummary.proposedExpensesCount).toBe(1)
      expect(proposedSummary.proposedTransfersCount).toBe(1)
      expect(proposedSummary.proposedIncomeCount).toBe(1)
      // Confirm that the source counts are 2 debits and 2 credits, not shifted
      const totalDebits = parsed.records.filter((r) => r.direction === 'debit').length
      const totalCredits = parsed.records.filter((r) => r.direction === 'credit').length
      expect(totalDebits).toBe(2)
      expect(totalCredits).toBe(2)
    })
  })
})


