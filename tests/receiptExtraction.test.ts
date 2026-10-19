import { describe, it, expect } from 'vitest'
import { ClientReceiptExtractor } from '../src/services/aiExtractor'
import { calculateFinancialSummary } from '../src/utils/calculations'
import { detectDuplicate } from '../src/utils/duplicateDetector'
import type { Transaction } from '../src/types/transaction'

describe('Money Mate AI — Milestone 3: AI Receipt & Payment Capture Test Suite', () => {
  const extractor = new ClientReceiptExtractor()

  // 1. UPI Payment Screenshot Recognition
  it('1. correctly extracts a payment screenshot draft with merchant, UPI method, and reference', () => {
    const draft = extractor.createUpiPaymentDraft(undefined, 'coffee')
    expect(draft.docType).toBe('payment_screenshot')
    expect(draft.totalAmountPaise).toBe(15000) // ₹150.00
    expect(draft.merchant).toBe('Blue Tokai Coffee Roasters')
    expect(draft.paymentMethod).toBe('UPI')
    expect(draft.status).toBe('completed')
    expect(draft.externalRef).toBeDefined()
    expect(draft.confidenceScore).toBeGreaterThanOrEqual(0.9)
  })

  // 2. Shopping Receipt Recognition & Single-Transaction Rule
  it('2. verifies a 3-item supermarket receipt produces exactly 1 financial transaction of ₹270, not 3 separate expenses', () => {
    const draft = extractor.createItemizedReceiptDraft()
    expect(draft.docType).toBe('itemized_receipt')
    expect(draft.totalAmountPaise).toBe(27000) // Exactly ₹270.00 total
    expect(draft.items).toHaveLength(3)

    // Verify line item details
    const itemTotalPaise = draft.items!.reduce((sum, item) => sum + item.totalPricePaise, 0)
    expect(itemTotalPaise).toBe(27000) // 6000 (Soap) + 12000 (Detergent) + 9000 (Toothpaste) = 27000 paise

    // Verify it creates ONE financial transaction in the financial engine
    const financialTransaction: Transaction = {
      id: 'tx-receipt-1',
      type: 'expense',
      amount: draft.totalAmountPaise,
      currency: 'INR',
      date: draft.date,
      description: draft.description,
      merchant: draft.merchant,
      category: draft.category,
      paymentMethod: draft.paymentMethod,
      status: draft.status,
      externalRef: draft.externalRef,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const summary = calculateFinancialSummary([financialTransaction], 0)
    expect(summary.grossConfirmedExpenses).toBe(27000) // Exactly ₹270
    expect(summary.totalConfirmedExpenses).toBe(27000)
    expect(summary.netCashFlow).toBe(-27000)
  })

  // 3. Failed Payment Screenshot Protection
  it('3. flags failed payment status and excludes it from confirmed financial calculations', () => {
    const draft = extractor.createFailedPaymentDraft()
    expect(draft.status).toBe('failed')
    expect(draft.warnings).toHaveLength(1)
    expect(draft.warnings[0]).toContain('FAILED')

    const failedTx: Transaction = {
      id: 'tx-failed-screenshot',
      type: 'expense',
      amount: draft.totalAmountPaise,
      currency: 'INR',
      date: draft.date,
      description: draft.description,
      category: draft.category,
      paymentMethod: draft.paymentMethod,
      status: 'failed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const summary = calculateFinancialSummary([failedTx], 0)
    // Must NOT alter confirmed income or expenses
    expect(summary.totalConfirmedExpenses).toBe(0)
    expect(summary.totalConfirmedIncome).toBe(0)
    expect(summary.netCashFlow).toBe(0)
    expect(summary.failedCount).toBe(1)
  })

  // 4. Duplicate Protection on Extracted References
  it('4. detects duplicate when uploading the same payment screenshot twice based on externalRef', () => {
    const draft = extractor.createUpiPaymentDraft()
    const existingTx: Transaction = {
      id: 'tx-existing-1',
      type: 'expense',
      amount: draft.totalAmountPaise,
      currency: 'INR',
      date: draft.date,
      description: draft.description,
      merchant: draft.merchant,
      category: draft.category,
      paymentMethod: draft.paymentMethod,
      status: 'completed',
      externalRef: draft.externalRef,
      createdAt: draft.date,
      updatedAt: draft.date,
    }

    // Check duplicate using same reference ID
    const dupCheck = detectDuplicate(
      {
        amount: draft.totalAmountPaise,
        type: 'expense',
        date: draft.date,
        externalRef: draft.externalRef,
        merchant: draft.merchant,
        description: draft.description,
      },
      [existingTx]
    )

    expect(dupCheck.isDuplicate).toBe(true)
    expect(dupCheck.confidence).toBe('high')
    expect(dupCheck.reason).toContain(draft.externalRef)
  })
})
