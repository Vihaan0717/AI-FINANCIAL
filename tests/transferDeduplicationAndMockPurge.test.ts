/**
 * Anti-Double-Counting, Inter-Account Self-Transfers & Mock Data Hygiene Test Suite
 * Money Mate AI
 * 
 * Verifies strict architectural guarantees:
 * 1. Mock/demo data is accurately identified and safely isolated or purged from real databases.
 * 2. Inter-account self-transfers between user bank accounts (e.g. Account A to Account B)
 *    are NEVER double-counted as Income or Expenses.
 * 3. Moving money to another owned account or paying a credit card/loan (e.g. Slice, Credit Card)
 *    is classified as 'transfer' and strictly excluded from both gross spending and earned income.
 * 4. P2P personal receipts (money from family, friends, splitting bills) do not inflate earned income.
 * 5. Intra-batch and cross-statement reconciliation links corresponding transfer legs,
 *    guaranteeing that a credited amount sent to another account does NOT enter credit twice.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { StatementRecord } from '../src/types/reconciliation'
import type { Transaction } from '../src/types/transaction'
import { isMockTransaction, shouldReclassifyAsTransfer } from '../src/hooks/useTransactions'
import { DEMO_TRANSACTIONS } from '../src/utils/demoData'
import {
  evaluateTransferCandidate,
  createInitialReconciliationDecisions,
  calculateProposedImportSummary,
} from '../src/utils/reconciliationRules'
import { calculateFinancialSummary } from '../src/utils/calculations'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import { parsePhonePePdfText } from '../src/utils/statementParsers/phonePePdfParser'
import type { ExtractedPdfDocument } from '../src/utils/statementParsers/pdfReader'

describe('Anti-Double-Counting, Self-Transfers & Mock Data Hygiene Suite', () => {
  let inMemoryRepo: InMemoryTransactionRepository

  beforeEach(() => {
    inMemoryRepo = new InMemoryTransactionRepository()
  })

  // =========================================================================
  // 1. Mock Data Identification & Safe Purge
  // =========================================================================
  describe('1. Mock Data Hygiene', () => {
    it('accurately identifies starter demo transactions by id, source, or signature', () => {
      for (const demoTx of DEMO_TRANSACTIONS) {
        expect(isMockTransaction(demoTx)).toBe(true)

        // Stored with 'real-demo-' prefix from older loader
        const prefixedTx: Transaction = {
          ...demoTx,
          id: `real-${demoTx.id}`,
          source: 'manual',
        }
        expect(isMockTransaction(prefixedTx)).toBe(true)
      }

      // UI test dummy entries
      expect(isMockTransaction({
        id: 'tx-test-1',
        description: 'Notebook return discount',
        amount: 1000,
        currency: 'INR',
        type: 'refund',
        category: 'Groceries',
        paymentMethod: 'UPI',
        status: 'completed',
        date: '2026-10-19T20:55:00.000Z',
        createdAt: '2026-10-19T20:55:00.000Z',
        updatedAt: '2026-10-19T20:55:00.000Z',
      })).toBe(true)

      expect(isMockTransaction({
        id: 'tx-test-2',
        description: 'Checking to Savings',
        amount: 2000,
        currency: 'INR',
        type: 'transfer',
        category: 'Transfer',
        paymentMethod: 'UPI',
        status: 'completed',
        date: '2026-10-19T20:53:00.000Z',
        createdAt: '2026-10-19T20:53:00.000Z',
        updatedAt: '2026-10-19T20:53:00.000Z',
      })).toBe(true)

      expect(isMockTransaction({
        id: 'tx-test-3',
        description: 'Consulting Pay',
        amount: 10000,
        currency: 'INR',
        type: 'income',
        category: 'Income',
        paymentMethod: 'Other',
        status: 'completed',
        date: '2026-10-19T20:48:00.000Z',
        createdAt: '2026-10-19T20:48:00.000Z',
        updatedAt: '2026-10-19T20:48:00.000Z',
      })).toBe(true)

      expect(isMockTransaction({
        id: 'tx-test-4',
        description: 'Office notebook',
        amount: 3500,
        currency: 'INR',
        type: 'expense',
        category: 'Shopping',
        paymentMethod: 'UPI',
        status: 'completed',
        date: '2026-10-19T09:50:00.000Z',
        createdAt: '2026-10-19T09:50:00.000Z',
        updatedAt: '2026-10-19T09:50:00.000Z',
      })).toBe(true)
    })

    it('does NOT misidentify authentic user imported transactions as mock data', () => {
      const realTx1: Transaction = {
        id: 'tx-real-101',
        type: 'income',
        amount: 5000000,
        currency: 'INR',
        date: '2026-10-18T09:00:00.000Z',
        description: 'Tech Consulting Client Monthly Retainer',
        category: 'Income',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        source: 'csv',
        externalRef: 'NEFT/HDFC/99887711',
        createdAt: '2026-10-18T09:00:00.000Z',
        updatedAt: '2026-10-18T09:00:00.000Z',
      }

      const realTx2: Transaction = {
        id: 'tx-real-102',
        type: 'expense',
        amount: 25000,
        currency: 'INR',
        date: '2026-10-19T10:30:00.000Z',
        description: 'Chai point morning tea',
        category: 'Food & dining',
        paymentMethod: 'UPI',
        status: 'completed',
        source: 'csv',
        externalRef: 'UPI/61019010421',
        createdAt: '2026-10-19T10:30:00.000Z',
        updatedAt: '2026-10-19T10:30:00.000Z',
      }

      expect(isMockTransaction(realTx1)).toBe(false)
      expect(isMockTransaction(realTx2)).toBe(false)
    })

    it('safely purges contaminated mock records from repository while preserving real transactions', async () => {
      // Seed repo with 10 demo items and 2 real user items
      for (const d of DEMO_TRANSACTIONS) {
        await inMemoryRepo.add({ ...d, id: `real-${d.id}` })
      }

      const realUserIncome: Transaction = {
        id: 'tx-user-income-01',
        type: 'income',
        amount: 10000000, // ₹1,00,000
        currency: 'INR',
        date: '2026-10-01T10:00:00.000Z',
        description: 'October Salary Direct Deposit',
        category: 'Income',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      }
      await inMemoryRepo.add(realUserIncome)

      const allBefore = await inMemoryRepo.getAll()
      expect(allBefore.length).toBe(DEMO_TRANSACTIONS.length + 1)

      // Purge mock items
      const mockItems = allBefore.filter(isMockTransaction)
      for (const m of mockItems) {
        await inMemoryRepo.delete(m.id)
      }

      const allAfter = await inMemoryRepo.getAll()
      expect(allAfter.length).toBe(1)
      expect(allAfter[0].id).toBe('tx-user-income-01')
      expect(allAfter[0].amount).toBe(10000000)

      // Summary on clean repository matches true user ledger
      const summary = calculateFinancialSummary(allAfter)
      expect(summary.totalConfirmedIncome).toBe(10000000) // ₹1,00,000.00
      expect(summary.totalConfirmedExpenses).toBe(0)
    })
  })

  // =========================================================================
  // 2. Inter-Account Transfer Double-Counting Prevention
  // =========================================================================
  describe('2. Anti-Double-Counting of Money Sent Between Accounts', () => {
    it('guarantees that money received in Bank A and then transferred to Bank B is NOT credited twice', () => {
      // 1. Initial credit received in Bank 1 (Legitimate Income)
      const salaryIncomeTx: Transaction = {
        id: 'tx-bank1-salary',
        type: 'income',
        amount: 5000000, // ₹50,000
        currency: 'INR',
        date: '2026-10-10T09:00:00.000Z',
        description: 'Employer Salary Credit',
        category: 'Income',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-10T09:00:00.000Z',
        updatedAt: '2026-10-10T09:00:00.000Z',
      }

      // 2. User moves ₹30,000 from Bank 1 to Bank 2
      // Recorded as an inter-account transfer
      const transferTx: Transaction = {
        id: 'tx-transfer-bank1-to-bank2',
        type: 'transfer',
        amount: 3000000, // ₹30,000
        currency: 'INR',
        date: '2026-10-10T14:00:00.000Z',
        description: 'Internal Transfer: Bank of Baroda (XXXX5200) → SBI (XXXXXX3938)',
        fromAccount: 'Bank of Baroda (XXXX5200)',
        toAccount: 'State Bank of India (XXXXXX3938)',
        category: 'Transfer',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-10T14:00:00.000Z',
        updatedAt: '2026-10-10T14:00:00.000Z',
      }

      const summary = calculateFinancialSummary([salaryIncomeTx, transferTx])

      // Strict Personal Finance Requirement:
      // Confirmed income MUST be exactly ₹50,000, NOT ₹80,000!
      expect(summary.totalConfirmedIncome).toBe(5000000)
      // Confirmed expenses MUST be ₹0, NOT ₹30,000!
      expect(summary.totalConfirmedExpenses).toBe(0)
      // Net cash flow MUST be +₹50,000
      expect(summary.netCashFlow).toBe(5000000)
      // Transfers tracked separately
      expect(summary.totalTransfers).toBe(3000000)
    })

    it('pairs debit on Account A and credit on Account B in reconciliation and produces 0 proposed income/expense', () => {
      // Simulating user importing two statements or multi-account UPI statement (e.g. PhonePe)
      // Leg 1: Debit ₹10,000 on Account A
      const debitLeg: StatementRecord = {
        id: 'stg-rec-debit-5200',
        batchId: 'batch-test-trf',
        sourceProvider: 'phonepe',
        sourceProviderRole: 'enrichment_source',
        sourceAccountId: 'unmapped:XXXX5200',
        sourceAccountAlias: 'Bank of Baroda (XXXX5200)',
        statementFileId: 'stmt.pdf',
        rawDateText: 'Oct 10, 2026 02:30 pm',
        parsedDate: '2026-10-10T14:30:00.000Z',
        rawDescription: 'Transfer to XXXXXX3938',
        cleanDescription: 'Transfer to XXXXXX3938',
        amountPaise: 1000000, // ₹10,000.00
        signedAmountPaise: -1000000,
        currency: 'INR',
        direction: 'debit',
        normalizedReference: 'UTR1010202699',
        metadata: { paymentChannel: 'UPI' },
        warnings: [],
        errors: [],
        proposedType: 'transfer',
        proposedCategory: 'Transfer',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: '2026-10-10T14:30:00.000Z',
        updatedAt: '2026-10-10T14:30:00.000Z',
      }

      // Leg 2: Credit ₹10,000 on Account B
      const creditLeg: StatementRecord = {
        id: 'stg-rec-credit-3938',
        batchId: 'batch-test-trf',
        sourceProvider: 'phonepe',
        sourceProviderRole: 'enrichment_source',
        sourceAccountId: 'unmapped:XXXXXX3938',
        sourceAccountAlias: 'State Bank of India (XXXXXX3938)',
        statementFileId: 'stmt.pdf',
        rawDateText: 'Oct 10, 2026 02:31 pm',
        parsedDate: '2026-10-10T14:31:00.000Z',
        rawDescription: 'Received from XXXX5200',
        cleanDescription: 'Received from XXXX5200',
        amountPaise: 1000000, // ₹10,000.00
        signedAmountPaise: 1000000,
        currency: 'INR',
        direction: 'credit',
        normalizedReference: 'UTR1010202699',
        metadata: { paymentChannel: 'UPI' },
        warnings: [],
        errors: [],
        proposedType: 'transfer',
        proposedCategory: 'Transfer',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: '2026-10-10T14:31:00.000Z',
        updatedAt: '2026-10-10T14:31:00.000Z',
      }

      // 1. Evaluate pairing candidate
      const candidate = evaluateTransferCandidate(debitLeg, creditLeg)
      expect(candidate).not.toBeNull()
      expect(candidate?.confidence).toBe('high')
      expect(candidate?.amountPaise).toBe(1000000)

      // 2. Generate initial reconciliation decisions
      const decisions = createInitialReconciliationDecisions([debitLeg, creditLeg], [])

      const decDebit = decisions.get(debitLeg.id)
      const decCredit = decisions.get(creditLeg.id)

      expect(decDebit?.isInternalTransfer).toBe(true)
      expect(decDebit?.proposedType).toBe('transfer')
      expect(decDebit?.matchedRecordId).toBe(creditLeg.id)

      expect(decCredit?.isInternalTransfer).toBe(true)
      expect(decCredit?.proposedType).toBe('transfer')
      expect(decCredit?.matchedRecordId).toBe(debitLeg.id)

      // 3. Confirm both legs as approved internal transfer
      decDebit!.state = 'confirmed_match'
      decCredit!.state = 'confirmed_match'

      // 4. Calculate proposed import summary
      const summary = calculateProposedImportSummary([debitLeg, creditLeg], decisions, 0)

      // STRICT ZERO DOUBLE COUNTING:
      // Transfers count: exactly 1 (not 2!)
      expect(summary.proposedTransfersCount).toBe(1)
      expect(summary.proposedTransfersPaise).toBe(1000000)
      // Proposed income must be ₹0!
      expect(summary.proposedIncomePaise).toBe(0)
      expect(summary.proposedIncomeCount).toBe(0)
      // Proposed expenses must be ₹0!
      expect(summary.proposedExpensesPaise).toBe(0)
      expect(summary.proposedExpensesCount).toBe(0)
    })

    it('matches an incoming credit against an existing ledger transfer instead of creating duplicate credit/income', () => {
      // Existing ledger transaction: User transferred ₹15,000 from Bank 1 to Bank 2
      const existingTransfer: Transaction = {
        id: 'tx-existing-transfer-15k',
        type: 'transfer',
        amount: 1500000,
        currency: 'INR',
        date: '2026-10-15T11:00:00.000Z',
        description: 'Transfer to SBI Savings',
        fromAccount: 'BOB XXXX5200',
        toAccount: 'SBI XXXXXX3938',
        category: 'Transfer',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        externalRef: 'UTR1510202699',
        createdAt: '2026-10-15T11:00:00.000Z',
        updatedAt: '2026-10-15T11:00:00.000Z',
      }

      // Statement record from SBI statement (Credit ₹15,000)
      const sbiIncomingCredit: StatementRecord = {
        id: 'stg-sbi-cr-15k',
        batchId: 'batch-sbi-stmt',
        sourceProvider: 'sbi',
        sourceProviderRole: 'primary_ledger',
        sourceAccountId: 'acc-sbi-primary',
        sourceAccountAlias: 'SBI Primary Savings',
        statementFileId: 'sbi.csv',
        rawDateText: '15/10/2026',
        parsedDate: '2026-10-15T11:02:00.000Z',
        rawDescription: 'TRANSFER FROM BOB XXXX5200',
        cleanDescription: 'TRANSFER FROM BOB',
        amountPaise: 1500000,
        signedAmountPaise: 1500000,
        currency: 'INR',
        direction: 'credit',
        normalizedReference: 'UTR1510202699',
        metadata: { paymentChannel: 'NEFT' },
        warnings: [],
        errors: [],
        proposedType: 'transfer',
        proposedCategory: 'Transfer',
        status: 'staged',
        reviewStatus: 'pending',
        matchCandidateIds: [],
        matchConfidence: 'none',
        createdAt: '2026-10-15T11:02:00.000Z',
        updatedAt: '2026-10-15T11:02:00.000Z',
      }

      const decisions = createInitialReconciliationDecisions([sbiIncomingCredit], [existingTransfer])
      const dec = decisions.get(sbiIncomingCredit.id)

      // Must NOT be conflicting with direction_mismatch!
      expect(dec?.state).toBe('suggested_match')
      expect(dec?.matchedLedgerTxId).toBe(existingTransfer.id)
      expect(dec?.isInternalTransfer).toBe(true)
      expect(dec?.conflicts).toEqual([])

      // When confirmed, it links to existing transfer and skips creating new income
      dec!.state = 'confirmed_match'
      const summary = calculateProposedImportSummary([sbiIncomingCredit], decisions, 0)
      expect(summary.proposedIncomePaise).toBe(0)
      expect(summary.confirmedLinksCount).toBe(1)
    })
  })

  // =========================================================================
  // 3. P2P Personal Receipts & Card Repayments Classification
  // =========================================================================
  describe('3. P2P Personal Receipts & Card Repayments Classification', () => {
    it('classifies Slice card repayments as transfer (not expense) and P2P credits as transfer (not income)', () => {
      const syntheticPhonePeDoc: ExtractedPdfDocument = {
        totalPages: 1,
        fullText: 'PhonePe Statement',
        isScannedOrImageOnly: false,
        warnings: [],
        pages: [
          {
            pageNumber: 1,
            lineCount: 15,
            hasSelectableText: true,
            text: `
Transaction Statement for 9154716156
22 Jul, 2026 - 20 Oct, 2026
Date Transaction Details Type Amount
Oct 18, 2026
03:17 pm
Paid to slice small finance bank limited DEBIT ₹7,000
Transaction ID T2610181517124664077348
UTR No. 653418482649
Paid by XXXX5200

Oct 17, 2026
02:21 pm
Received from Dad CREDIT ₹7,000
Transaction ID T2610171421468393051240
UTR No. 929806481745
Credited to XXXX5200

Oct 16, 2026
10:00 am
Monthly salary credit from Acme Corp Payroll CREDIT ₹75,000
Transaction ID T2610161000001234567890
UTR No. 112233445566
Credited to XXXX5200
`,
          },
        ],
      }

      const parsed = parsePhonePePdfText(syntheticPhonePeDoc, {
        status: 'recognized',
        detectedProvider: 'phonepe',
        confidence: 0.98,
        explanation: 'Test',
        isProvisional: false,
      })

      expect(parsed.records.length).toBe(3)

      // 1. Slice small finance bank repayment: Must be 'transfer', NOT 'expense'
      const sliceRepayment = parsed.records[0]
      expect(sliceRepayment.counterparty).toContain('slice small finance bank')
      expect(sliceRepayment.proposedType).toBe('transfer')
      expect(sliceRepayment.proposedCategory).toBe('Transfer')

      // 2. Personal P2P receipt from Dad: Must be 'transfer', NOT 'income'
      const dadReceipt = parsed.records[1]
      expect(dadReceipt.counterparty).toBe('Dad')
      expect(dadReceipt.proposedType).toBe('transfer')
      expect(dadReceipt.proposedCategory).toBe('Transfer')

      // 3. Genuine Corporate Salary: Correctly recognized as 'income'
      const salaryReceipt = parsed.records[2]
      expect(salaryReceipt.counterparty).toContain('Acme Corp Payroll')
      expect(salaryReceipt.proposedType).toBe('income')
      expect(salaryReceipt.proposedCategory).toBe('Income')
    })

    it('identifies existing misclassified expenses and income as transfers for auto-healing', () => {
      // 1. Slice card repayment mistakenly saved as expense
      const misclassifiedSlice: Transaction = {
        id: 'tx-slice-old',
        type: 'expense',
        amount: 2500000,
        currency: 'INR',
        date: '2026-10-18T10:00:00.000Z',
        description: 'Paid to Slice Small Finance Bank Limited',
        category: 'Other',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-18T10:00:00.000Z',
        updatedAt: '2026-10-18T10:00:00.000Z',
      }
      expect(shouldReclassifyAsTransfer(misclassifiedSlice)).toBe(true)

      // 2. Inter-account self-transfer mistakenly saved as expense
      const misclassifiedSelfTransfer: Transaction = {
        id: 'tx-transfer-old',
        type: 'expense',
        amount: 1000000,
        currency: 'INR',
        date: '2026-10-17T11:00:00.000Z',
        description: 'Transfer to State Bank of India (XXXXXX3938)',
        category: 'Other',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-17T11:00:00.000Z',
        updatedAt: '2026-10-17T11:00:00.000Z',
      }
      expect(shouldReclassifyAsTransfer(misclassifiedSelfTransfer)).toBe(true)

      // 3. Personal P2P receipt mistakenly saved as income
      const misclassifiedP2P: Transaction = {
        id: 'tx-p2p-old',
        type: 'income',
        amount: 500000,
        currency: 'INR',
        date: '2026-10-16T14:00:00.000Z',
        description: 'Received from Dad',
        category: 'Income',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-16T14:00:00.000Z',
        updatedAt: '2026-10-16T14:00:00.000Z',
      }
      expect(shouldReclassifyAsTransfer(misclassifiedP2P)).toBe(true)

      // 4. Authentic corporate salary: Should NOT be reclassified as transfer
      const authenticSalary: Transaction = {
        id: 'tx-salary-real',
        type: 'income',
        amount: 7500000,
        currency: 'INR',
        date: '2026-10-01T09:00:00.000Z',
        description: 'Monthly payroll salary from Tech Corp',
        category: 'Income',
        paymentMethod: 'Bank transfer',
        status: 'completed',
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
      }
      expect(shouldReclassifyAsTransfer(authenticSalary)).toBe(false)

      // 5. Authentic retail grocery expense: Should NOT be reclassified as transfer
      const authenticExpense: Transaction = {
        id: 'tx-grocery-real',
        type: 'expense',
        amount: 145000,
        currency: 'INR',
        date: '2026-10-15T18:00:00.000Z',
        description: 'Zepto instant groceries',
        category: 'Groceries',
        paymentMethod: 'UPI',
        status: 'completed',
        createdAt: '2026-10-15T18:00:00.000Z',
        updatedAt: '2026-10-15T18:00:00.000Z',
      }
      expect(shouldReclassifyAsTransfer(authenticExpense)).toBe(false)
    })
  })
})
