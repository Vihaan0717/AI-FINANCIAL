import { describe, it, expect } from 'vitest'
import { parseReceiptText } from '../src/services/receiptParser'

describe('Indian Financial Receipt & Screenshot Parser Tests', () => {
  it('1. correctly parses Google Pay / UPI screenshot text', () => {
    const rawGpay = `
      Google Pay
      Paid to Blue Tokai Coffee Roasters
      ₹150.00
      Completed
      19 Oct 2026, 11:30 AM
      UPI Ref No: 428901234567
    `

    const parsed = parseReceiptText(rawGpay)
    expect(parsed.totalAmountPaise).toBe(15000) // ₹150.00
    expect(parsed.merchant).toContain('Blue Tokai')
    expect(parsed.paymentMethod).toBe('UPI')
    expect(parsed.status).toBe('completed')
    expect(parsed.externalRef).toBe('428901234567')
    expect(parsed.category).toBe('Food & dining')
  })

  it('2. correctly parses PhonePe screenshot with 12-digit UTR and ₹ symbol', () => {
    const rawPhonePe = `
      PhonePe
      Payment Successful
      ₹250
      Paid to Fresh Vegetables & Fruits
      Transaction ID: T261019183011234
      UTR: 329188471920
    `

    const parsed = parseReceiptText(rawPhonePe)
    expect(parsed.totalAmountPaise).toBe(25000) // ₹250.00
    expect(parsed.status).toBe('completed')
    expect(parsed.paymentMethod).toBe('UPI')
    expect(parsed.externalRef).toBe('329188471920')
  })

  it('3. correctly parses supermarket itemized receipt text into 1 total and multiple line items', () => {
    const rawReceipt = `
      FreshMart Supermarket
      Tax Invoice / Cash Bill
      Bathing Soap 2 60.00
      Laundry Detergent 1 120.00
      Herbal Toothpaste 1 90.00
      Grand Total: ₹270.00
      UPI Ref: 998877665544
    `

    const parsed = parseReceiptText(rawReceipt)
    expect(parsed.docType).toBe('itemized_receipt')
    expect(parsed.totalAmountPaise).toBe(27000) // ₹270.00
    expect(parsed.items).toBeDefined()
    expect(parsed.items!.length).toBe(3)
    expect(parsed.items![0].name).toBe('Bathing Soap')
    expect(parsed.items![0].quantity).toBe(2)
    expect(parsed.items![0].totalPricePaise).toBe(12000) // 2 * 60 = 120 (or qty * unit)
  })

  it('4. correctly identifies failed transaction and issues appropriate review warning', () => {
    const rawFailed = `
      Payment Failed
      Bank server declined transaction.
      Amount: ₹500.00
      Transaction ID: TXN887722
    `

    const parsed = parseReceiptText(rawFailed)
    expect(parsed.status).toBe('failed')
    expect(parsed.totalAmountPaise).toBe(50000)
    expect(parsed.warnings.some((w) => w.includes('FAILED'))).toBe(true)
  })
})
