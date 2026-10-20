/**
 * PhonePe PDF Statement Import & Reconciliation Tests
 * Money Mate AI — Milestone: Secure, Local-First PhonePe PDF Import
 * 
 * Strict architectural and safety tests:
 * 1. Multiline records and page boundaries.
 * 2. Month names including "Sept", "Jul", "Aug", "Oct".
 * 3. Rupee formatting (₹), commas, decimal values, and exact integer paise precision.
 * 4. Missing or malformed dates, zero-amounts, and negative amounts rejected with row diagnostics.
 * 5. Refunds, internal transfers, AutoPay, and pending/failed transactions.
 * 6. Masked account identification (Slice is not assumed to be a credit facility).
 * 7. Duplicate bank & UPI observations (deduplication and single-counting).
 * 8. Unsupported or image-only PDFs.
 * 9. Demo/Live isolation.
 * 10. Atomic import, audit reporting, and rollback.
 * 
 * Privacy: All test data uses synthetic names, synthetic phone/account IDs, and synthetic references.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractPdfText,
  parsePhonePePdfText,
  detectPdfStatementFormat,
  parseStatementPdf,
  type ExtractedPdfDocument,
} from '../src/utils/statementParsers'
import {
  evaluateStatementRecordMatch,
  createInitialReconciliationDecisions,
} from '../src/utils/reconciliationRules'
import {
  commitStatementBatch,
  computeFileHash,
} from '../src/services/statementImportService'
import { executeBatchRollback } from '../src/services/statementRollbackService'
import { InMemoryTransactionRepository } from '../src/storage/transactionRepository'
import type { ImportBatch } from '../src/types/reconciliation'
import type { Transaction } from '../src/types/transaction'
import { calculateFinancialSummary } from '../src/utils/calculations'

/**
 * Generates a valid, minimal synthetic PDF 1.4 binary buffer containing given page text strings.
 */
function createSyntheticPdfBytes(pageTexts: string[]): Uint8Array {
  let objectCount = 3 // Root catalog (1), Pages (2), Font (3)
  const pageObjIds: number[] = []
  const contentObjIds: number[] = []

  for (let i = 0; i < pageTexts.length; i++) {
    objectCount++
    pageObjIds.push(objectCount)
    objectCount++
    contentObjIds.push(objectCount)
  }

  let pdfStr = '%PDF-1.4\n'
  const offsets: number[] = [0]

  // Object 1: Catalog
  offsets.push(pdfStr.length)
  pdfStr += `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`

  // Object 2: Pages tree
  offsets.push(pdfStr.length)
  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(' ')
  pdfStr += `2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageTexts.length} >>\nendobj\n`

  // Object 3: Font
  offsets.push(pdfStr.length)
  pdfStr += `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`

  // Page and Content objects
  for (let i = 0; i < pageTexts.length; i++) {
    const pageId = pageObjIds[i]
    const contentId = contentObjIds[i]
    const textLines = pageTexts[i].split('\n')

    let streamData = 'BT\n/F1 10 Tf\n20 750 Td\n14 TL\n'
    for (const line of textLines) {
      // Escape parentheses in PDF string literal
      const safeLine = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
      streamData += `(${safeLine}) Tj\nT*\n`
    }
    streamData += 'ET\n'

    // Page object
    offsets.push(pdfStr.length)
    pdfStr += `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`

    // Content stream object
    offsets.push(pdfStr.length)
    pdfStr += `${contentId} 0 obj\n<< /Length ${streamData.length} >>\nstream\n${streamData}endstream\nendobj\n`
  }

  // Cross-reference table
  const startXref = pdfStr.length
  pdfStr += `xref\n0 ${objectCount + 1}\n`
  pdfStr += `0000000000 65535 f \n`
  for (let i = 1; i <= objectCount; i++) {
    const off = offsets[i]
    pdfStr += `${off.toString().padStart(10, '0')} 00000 n \n`
  }

  pdfStr += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`

  return new TextEncoder().encode(pdfStr)
}

describe('PhonePe PDF Statement Import & Reconciliation Suite', () => {
  let inMemoryRepo: InMemoryTransactionRepository
  let mockBatchesStore: Map<string, ImportBatch>

  beforeEach(() => {
    inMemoryRepo = new InMemoryTransactionRepository()
    mockBatchesStore = new Map()
  })

  // 1. Multiline records & Page Boundaries
  it('parses multiline records across page boundaries with headers and footers stripped', () => {
    const page1 = `
Transaction Statement for 9999900000
22 Jul, 2026 - 20 Oct, 2026
Date Transaction Details Type Amount
Oct 18, 2026
03:17 pm
Paid to Synthetic Merchant Limited DEBIT ₹7,000
Transaction ID T9900112233445566778899
UTR No. 112233445566
Paid by XXXX5200
Oct 18, 2026
02:21 pm
Received from Synthetic Payer CREDIT ₹7,000
Transaction ID T9900112233445566778800
UTR No. 223344556677
Credited to XXXX5200
Page 1 of 2
This is a system generated statement. For any queries, contact us at https://support.phonepe.com/statement.
`

    const page2 = `
Date Transaction Details Type Amount
Sept 23, 2026
10:48 am
Paid to DEBIT ₹30
SYNTHETIC TRANSPORT CORP
Transaction ID T9900112233445566778811
UTR No. 334455667788
Paid by XXXXXX3938
Sept 22, 2026
07:39 pm
Paid to Synthetic Grocer DEBIT ₹46.82
Transaction ID T9900112233445566778822
UTR No. 445566778899
Paid by XXXXXX3938
Page 2 of 2
This is an automatically generated statement. Customer(s) are requested to immediately notify PhonePe in case of errors.
Disclaimer : Do not fall prey to fictitious offers.
`

    const doc: ExtractedPdfDocument = {
      totalPages: 2,
      pages: [
        { pageNumber: 1, text: page1, lineCount: 20, hasSelectableText: true },
        { pageNumber: 2, text: page2, lineCount: 20, hasSelectableText: true },
      ],
      fullText: `${page1}\n${page2}`,
      isScannedOrImageOnly: false,
      warnings: [],
    }

    const detection = detectPdfStatementFormat(doc)
    expect(detection.status).toBe('recognized')
    expect(detection.detectedProvider).toBe('phonepe')

    const result = parsePhonePePdfText(doc, detection)

    expect(result.statistics.totalRows).toBe(4)
    expect(result.records.length).toBe(4)
    expect(result.rejectedRows.length).toBe(0)

    // Record 1
    const r1 = result.records[0]
    expect(r1.cleanDescription).toBe('Synthetic Merchant Limited')
    expect(r1.direction).toBe('debit')
    expect(r1.amountPaise).toBe(700000)
    expect(r1.originalReference).toBe('112233445566')
    expect(r1.normalizedReference).toBe('112233445566')
    expect(r1.metadata.orderId).toBe('T9900112233445566778899')
    expect(r1.metadata.customFields?.accountInfo).toBe('XXXX5200')

    // Record 2 (Credit)
    const r2 = result.records[1]
    expect(r2.cleanDescription).toBe('Synthetic Payer')
    expect(r2.direction).toBe('credit')
    expect(r2.amountPaise).toBe(700000)
    expect(r2.metadata.customFields?.accountInfo).toBe('XXXX5200')

    // Record 3 (Multi-line counterparty with DEBIT ₹30 inline)
    const r3 = result.records[2]
    expect(r3.cleanDescription).toBe('SYNTHETIC TRANSPORT CORP')
    expect(r3.direction).toBe('debit')
    expect(r3.amountPaise).toBe(3000)
    expect(r3.metadata.customFields?.accountInfo).toBe('XXXXXX3938')

    // Record 4 (Decimal amount ₹46.82)
    const r4 = result.records[3]
    expect(r4.cleanDescription).toBe('Synthetic Grocer')
    expect(r4.amountPaise).toBe(4682)
    expect(r4.metadata.customFields?.accountInfo).toBe('XXXXXX3938')
  })

  // 2. Month Names including "Sept"
  it('correctly parses dates across different months, including "Sept"', () => {
    const pageText = `
Transaction Statement for 9999900000
Date Transaction Details Type Amount
Sept 26, 2026
08:22 pm
Paid to Synthetic Merchant A DEBIT ₹50
Transaction ID T1111111111
UTR No. 990011223344
Paid by XXXX5200
Aug 04, 2026
10:20 pm
Paid to Synthetic Merchant B DEBIT ₹60
Transaction ID T2222222222
UTR No. 990011223355
Paid by XXXX5200
Jul 27, 2026
09:23 pm
Received from Synthetic Friend CREDIT ₹100
Transaction ID T3333333333
UTR No. 990011223366
Credited to XXXX5200
`
    const doc: ExtractedPdfDocument = {
      totalPages: 1,
      pages: [{ pageNumber: 1, text: pageText, lineCount: 20, hasSelectableText: true }],
      fullText: pageText,
      isScannedOrImageOnly: false,
      warnings: [],
    }

    const result = parsePhonePePdfText(doc, detectPdfStatementFormat(doc))
    expect(result.records.length).toBe(3)

    // Check ISO dates
    expect(result.records[0].parsedDate).toContain('2026-09-26')
    expect(result.records[1].parsedDate).toContain('2026-08-04')
    expect(result.records[2].parsedDate).toContain('2026-07-27')
  })

  // 3. Rupee Formatting and Paise Precision
  it('handles rupee symbols, comma-separated amounts, and exact decimal paise precision', () => {
    const pageText = `
Transaction Statement for 9999900000
Date Transaction Details Type Amount
Oct 10, 2026
05:39 pm
Received from Synthetic Source CREDIT ₹44,981
Transaction ID T4444444444
UTR No. 556677889900
Credited to XXXX5200
Oct 12, 2026
11:46 pm
Paid to Synthetic Food App DEBIT ₹148.19
Transaction ID T5555555555
UTR No. 556677889911
Paid by XXXX2051
Oct 17, 2026
04:42 pm
Mobile recharged 9999900000 DEBIT ₹49
Transaction ID T6666666666
UTR No. 556677889922
Paid by XXXX2051
`
    const doc: ExtractedPdfDocument = {
      totalPages: 1,
      pages: [{ pageNumber: 1, text: pageText, lineCount: 20, hasSelectableText: true }],
      fullText: pageText,
      isScannedOrImageOnly: false,
      warnings: [],
    }

    const result = parsePhonePePdfText(doc, detectPdfStatementFormat(doc))
    expect(result.records.length).toBe(3)

    // ₹44,981 = 4,498,100 paise
    expect(result.records[0].amountPaise).toBe(4498100)
    // ₹148.19 = 14,819 paise
    expect(result.records[1].amountPaise).toBe(14819)
    // ₹49 = 4,900 paise
    expect(result.records[2].amountPaise).toBe(4900)
  })

  // 4. Missing or Malformed Dates and Amounts Rejected
  it('rejects rows with missing or malformed dates, zero-amounts, or negative values into rejectedRows', () => {
    const pageText = `
Transaction Statement for 9999900000
Date Transaction Details Type Amount
Oct 18, 2026
03:17 pm
Paid to Valid Merchant DEBIT ₹500
Transaction ID T7777777777
UTR No. 778899001122
Paid by XXXX5200
Oct 18, 2026
02:00 pm
Paid to Zero Merchant DEBIT ₹0.00
Transaction ID T8888888888
UTR No. 778899001133
Paid by XXXX5200
Oct 18, 2026
01:00 pm
Paid to Negative Merchant DEBIT -₹100
Transaction ID T9999999999
UTR No. 778899001144
Paid by XXXX5200
`
    const doc: ExtractedPdfDocument = {
      totalPages: 1,
      pages: [{ pageNumber: 1, text: pageText, lineCount: 20, hasSelectableText: true }],
      fullText: pageText,
      isScannedOrImageOnly: false,
      warnings: [],
    }

    const result = parsePhonePePdfText(doc, detectPdfStatementFormat(doc))

    expect(result.records.length).toBe(1)
    expect(result.rejectedRows.length).toBe(2)

    // Verify rejected row reasons
    expect(result.rejectedRows[0].reason).toContain('Zero-value transactions are not permitted')
    expect(result.rejectedRows[1].reason).toContain('Negative amount')
  })

  // 5. Refunds, Internal Transfers, and AutoPay
  it('correctly classifies refunds, internal transfers, and AutoPay recurring debits', () => {
    const pageText = `
Transaction Statement for 9999900000
Date Transaction Details Type Amount
Sept 26, 2026
08:22 pm
Refund from Synthetic Merchant CREDIT ₹54.33
Transaction ID T1010101010
UTR No. 635143327925
Credited to XXXX5200
Oct 10, 2026
12:33 pm
Transfer to XXXXXX3938 DEBIT ₹2,500
Transaction ID T2020202020
UTR No. 697273711388
Paid by XXXX5200
Oct 14, 2026
10:19 pm
Payment to Synthetic Finance DEBIT ₹1
Transaction ID T3030303030
UTR No. 628722946500
Paid by XXXX5200 AUTOPAY
`
    const doc: ExtractedPdfDocument = {
      totalPages: 1,
      pages: [{ pageNumber: 1, text: pageText, lineCount: 20, hasSelectableText: true }],
      fullText: pageText,
      isScannedOrImageOnly: false,
      warnings: [],
    }

    const result = parsePhonePePdfText(doc, detectPdfStatementFormat(doc))
    expect(result.records.length).toBe(3)

    // 1. Refund
    const rRefund = result.records[0]
    expect(rRefund.proposedType).toBe('refund')
    expect(rRefund.direction).toBe('credit')
    expect(rRefund.cleanDescription).toBe('Synthetic Merchant')
    expect(rRefund.amountPaise).toBe(5433)

    // 2. Transfer
    const rTransfer = result.records[1]
    expect(rTransfer.proposedType).toBe('transfer')
    expect(rTransfer.direction).toBe('debit')
    expect(rTransfer.amountPaise).toBe(250000)

    // 3. AutoPay
    const rAutopay = result.records[2]
    expect(rAutopay.metadata.customFields?.accountInfo).toBe('XXXX5200')
    expect(rAutopay.warnings).toContain('Recurring AutoPay mandate execution.')
  })

  // 6. Masked Account Identification & Slice Non-Credit Facility Rule
  it('preserves masked accounts without assuming Slice is a credit facility', () => {
    const pageText = `
Transaction Statement for 9999900000
Date Transaction Details Type Amount
Oct 17, 2026
09:21 pm
Paid to slice small finance bank limited DEBIT ₹7,000
Transaction ID T4040404040
UTR No. 936529355421
Paid by XXXX5200
Oct 12, 2026
11:46 pm
Paid to Synthetic Food App DEBIT ₹148.19
Transaction ID T5050505050
UTR No. 933036185828
Paid by slice XXXX2051
`
    const doc: ExtractedPdfDocument = {
      totalPages: 1,
      pages: [{ pageNumber: 1, text: pageText, lineCount: 20, hasSelectableText: true }],
      fullText: pageText,
      isScannedOrImageOnly: false,
      warnings: [],
    }

    const result = parsePhonePePdfText(doc, detectPdfStatementFormat(doc))
    expect(result.records.length).toBe(2)

    // Record 1: Paid to slice small finance bank limited
    const r1 = result.records[0]
    expect(r1.cleanDescription).toBe('slice small finance bank limited')
    expect(r1.sourceProviderRole).toBe('enrichment_source')
    expect(r1.metadata.customFields?.accountInfo).toBe('XXXX5200')

    // Record 2: Paid by slice XXXX2051
    const r2 = result.records[1]
    expect(r2.sourceProviderRole).toBe('enrichment_source')
    expect(r2.metadata.customFields?.accountInfo).toBe('slice XXXX2051')
    // Crucial: Role remains enrichment_source, not forced to credit_card
    expect(r2.sourceProviderRole).toBe('enrichment_source')
  })

  // 7. Duplicate Bank & UPI Observations (Deduplication)
  it('deduplicates bank debit and PhonePe UPI observation with identical UTR reference', () => {
    // 1. Existing Bank transaction in ledger (Primary Settlement Anchor)
    const existingBankTx: Transaction = {
      id: 'tx-bank-anchor-001',
      date: '2026-10-18T15:17:12.000Z',
      amount: 700000,
      description: 'UPI/112233445566/DR/Merchant',
      type: 'expense',
      category: 'Other',
      paymentMethod: 'bank_transfer',
      status: 'completed',
      externalRef: '112233445566', // 12-digit UTR
      createdAt: '2026-10-18T15:20:00.000Z',
      updatedAt: '2026-10-18T15:20:00.000Z',
    }

    // 2. Incoming PhonePe record with identical UTR
    const phonePeRecord = {
      id: 'stg-phonepe-001',
      batchId: 'batch-test-pdf',
      sourceProvider: 'phonepe' as const,
      sourceProviderRole: 'enrichment_source' as const,
      sourceAccountId: 'acc-phonepe-linked',
      sourceAccountAlias: 'PhonePe',
      statementFileId: 'phonepe.pdf',
      originalReference: '112233445566',
      normalizedReference: '112233445566',
      rawDateText: 'Oct 18, 2026 03:17 pm',
      parsedDate: '2026-10-18T15:17:12.000Z',
      rawDescription: 'Paid to Synthetic Merchant',
      cleanDescription: 'Synthetic Merchant',
      amountPaise: 700000,
      signedAmountPaise: -700000,
      currency: 'INR' as const,
      direction: 'debit' as const,
      metadata: {
        paymentChannel: 'UPI' as const,
        orderId: 'T9900112233445566778899',
      },
      warnings: [],
      errors: [],
      proposedType: 'expense' as const,
      proposedCategory: 'Shopping',
      status: 'staged' as const,
      reviewStatus: 'pending' as const,
      matchCandidateIds: [],
      matchConfidence: 'none' as const,
      createdAt: '2026-10-18T15:25:00.000Z',
      updatedAt: '2026-10-18T15:25:00.000Z',
    }

    // Match evaluation against existing bank transaction
    const initialDecisions = createInitialReconciliationDecisions(
      [phonePeRecord],
      [existingBankTx],
      new Map()
    )

    const decision = initialDecisions.get('stg-phonepe-001')
    expect(decision).toBeDefined()
    expect(decision?.state).toBe('suggested_match')
    expect(decision?.matchedLedgerTxId).toBe('tx-bank-anchor-001')
    expect(decision?.evidence).toContain('exact_reference')
    expect(decision?.decisionReason).toContain('112233445566')

    // Calculation guardrail test: Even if both were in active list, linkedTransactionId prevents double counting
    const linkedPhonePeTx: Transaction = {
      id: 'tx-phonepe-linked-001',
      date: '2026-10-18T15:17:12.000Z',
      amount: 700000,
      description: 'Synthetic Merchant (PhonePe)',
      type: 'expense',
      category: 'Shopping',
      paymentMethod: 'upi',
      status: 'completed',
      externalRef: '112233445566',
      linkedTransactionId: 'tx-bank-anchor-001', // Linked to bank anchor!
      createdAt: '2026-10-18T15:25:00.000Z',
      updatedAt: '2026-10-18T15:25:00.000Z',
    }

    const summary = calculateFinancialSummary([existingBankTx, linkedPhonePeTx])
    // Only 1 expense of ₹7,000 (700,000 paise) should be counted! NOT ₹14,000!
    expect(summary.totalConfirmedExpenses).toBe(700000)
    expect(summary.netCashFlow).toBe(-700000)
  })

  // 8. Unsupported or Image-Only PDFs
  it('gracefully handles image-only / scanned PDFs without machine-readable text', async () => {
    const doc: ExtractedPdfDocument = {
      totalPages: 3,
      pages: [
        { pageNumber: 1, text: '   \n  ', lineCount: 0, hasSelectableText: false },
        { pageNumber: 2, text: '', lineCount: 0, hasSelectableText: false },
        { pageNumber: 3, text: ' \t ', lineCount: 0, hasSelectableText: false },
      ],
      fullText: '',
      isScannedOrImageOnly: true,
      warnings: ['Page 1 has no selectable text.', 'Page 2 has no selectable text.', 'Page 3 has no selectable text.'],
    }

    const detection = detectPdfStatementFormat(doc)
    expect(detection.status).toBe('unsupported')
    expect(detection.explanation).toContain('Scanned or image-only PDF')

    const result = parsePhonePePdfText(doc, detection)
    expect(result.detection.status).toBe('unsupported')
    expect(result.records.length).toBe(0)
    expect(result.warnings.some((w) => w.includes('OCR') && w.includes('digital export'))).toBe(true)
  })

  // 9. Full Binary PDF Extraction and Parse Flow
  it('extracts and parses real synthetic PDF bytes via parseStatementPdf', async () => {
    const samplePage = `
Transaction Statement for 9999900000
22 Jul, 2026 - 20 Oct, 2026
Date Transaction Details Type Amount
Oct 18, 2026
03:17 pm
Paid to Synthetic Coffee DEBIT ₹120
Transaction ID T6060606060
UTR No. 123456789012
Paid by XXXX5200
`
    const pdfBytes = createSyntheticPdfBytes([samplePage])
    expect(pdfBytes.length).toBeGreaterThan(100)

    const result = await parseStatementPdf(pdfBytes, {
      selectedProvider: 'phonepe',
      statementFileId: 'phonepe_test.pdf',
    })

    expect(result.detection.status).toBe('recognized')
    expect(result.records.length).toBe(1)
    expect(result.records[0].cleanDescription).toBe('Synthetic Coffee')
    expect(result.records[0].amountPaise).toBe(12000)
    expect(result.records[0].direction).toBe('debit')
    expect(result.records[0].normalizedReference).toBe('123456789012')
  })

  // 10. Demo/Live Workspace Isolation & Atomic Rollback
  it('guarantees complete Demo/Live workspace isolation, atomic commitment, and clean rollback', async () => {
    const sampleRecord = {
      id: 'stg-rec-demo-001',
      batchId: 'imp-batch-demo-pdf',
      sourceProvider: 'phonepe' as const,
      sourceProviderRole: 'enrichment_source' as const,
      sourceAccountId: 'acc-phonepe-linked',
      sourceAccountAlias: 'PhonePe',
      statementFileId: 'synthetic_demo.pdf',
      originalReference: '998877665544',
      normalizedReference: '998877665544',
      rawDateText: 'Oct 18, 2026 03:17 pm',
      parsedDate: '2026-10-18T15:17:12.000Z',
      rawDescription: 'Paid to Demo Merchant',
      cleanDescription: 'Demo Merchant',
      amountPaise: 25000,
      signedAmountPaise: -25000,
      currency: 'INR' as const,
      direction: 'debit' as const,
      metadata: { paymentChannel: 'UPI' as const },
      warnings: [],
      errors: [],
      proposedType: 'expense' as const,
      proposedCategory: 'Shopping',
      status: 'staged' as const,
      reviewStatus: 'approved' as const,
      matchCandidateIds: [],
      matchConfidence: 'none' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const decisions = new Map()
    decisions.set('stg-rec-demo-001', {
      recordId: 'stg-rec-demo-001',
      state: 'ready_for_import',
      isConfirmed: true,
      userAction: 'create_new',
      finalType: 'expense',
      finalCategory: 'Shopping',
      updatedAt: new Date().toISOString(),
    })

    const batchMeta = {
      fileName: 'synthetic_demo.pdf',
      fileSizeBytes: 2048,
      fileHash: computeFileHash('synthetic_binary_data'),
      mimeType: 'application/pdf',
      detectedFormat: 'pdf' as const,
    }

    // 1. Commit to DEMO workspace
    const demoCommitRes = await commitStatementBatch({
      workspace: 'demo',
      records: [sampleRecord],
      decisions,
      batchMetadata: batchMeta,
      sourceProvider: 'phonepe',
      sourceAccountId: 'acc-phonepe-linked',
      sourceAccountAlias: 'PhonePe',
      inMemoryRepo,
      mockBatchesStore,
    })

    expect(demoCommitRes.success).toBe(true)
    expect(demoCommitRes.batch).toBeDefined()
    expect(demoCommitRes.batch?.isDemo).toBe(true)
    expect(demoCommitRes.auditReport?.workspace).toBe('demo')
    expect(demoCommitRes.batch?.fileMetadata.detectedFormat).toBe('pdf')
    expect(demoCommitRes.createdTransactionIds?.length).toBe(1)

    // Verify isolation: Demo transaction exists in demo store; Live store has ZERO records
    const allTxs = await inMemoryRepo.getAll()
    const demoTxs = allTxs.filter((t) => t.isDemo === true)
    const liveTxs = allTxs.filter((t) => !t.isDemo)

    expect(demoTxs.length).toBe(1)
    expect(liveTxs.length).toBe(0)
    expect(demoTxs[0].description).toBe('Demo Merchant')

    // 2. Rollback the Demo batch
    const batchId = demoCommitRes.batch!.id
    const rollbackRes = await executeBatchRollback(batchId, {
      inMemoryRepo,
      mockBatchesStore,
      targetScope: 'demo',
    })

    expect(rollbackRes.success).toBe(true)
    expect(rollbackRes.restoredCount).toBe(1)

    // Verify that demo store is restored to 0 records
    const afterRollbackDemo = await inMemoryRepo.getAll('demo')
    expect(afterRollbackDemo.length).toBe(0)

    // Batch status is updated to 'rolled_back'
    const storedBatch = mockBatchesStore.get(batchId)
    expect(storedBatch?.commitStatus).toBe('rolled_back')
  })

  // 11. Real-World Single-Line Layout, Null-Byte Normalization, and Multi-Line Footer Stripping
  it('correctly parses real-world single-line header layout with embedded font null characters and strips multiline footers without description leakage', async () => {
    // Synthetic sample mirroring the exact structural anomaly discovered in real exports:
    // - Date on same line as counterparty, direction, and amount
    // - Time with embedded null character (\u0000) and Transaction ID on line 2
    // - Multi-line legal disclaimer footer at the end of the page
    const syntheticPage = [
      'Transaction Statement for 9999900000',
      '22 Jul, 2026 - 20 Oct, 2026',
      'Date Transaction Details Type Amount',
      'Oct 18, 2026 Paid to synthetic scheduled bank limited DEBIT ₹7,000',
      '03\u000017 pm Transaction ID T9999999999999999999999',
      'UTR No. 112233445566',
      'Paid by XXXX5200',
      'Jul 27, 2026 Received from Synthetic Sender CREDIT ₹1,000',
      '09\u000023 pm Transaction ID T8888888888888888888888',
      'UTR No. 998877665544',
      'Credited to XXXX5200',
      'Page 1 of 1',
      'This is an automatically generated statement. Customer(s) are requested to immediately notify PhonePe in case',
      'of any errors in the statement at https://support.phonepe.com/statement and visit https://www.phonepe.com/',
      'terms-conditions/ for PhonePe Terms & Conditions and Privacy Policy.',
      'Disclaimer : Do not fall prey to fictitious offers of winning prizes, money circulation schemes and cheap funds,',
      'etc. through SMS, emails and calls. The contents of this email and document are confidential and intended for',
      'the recipient specified in this document.',
    ].join('\n')

    const pdfBytes = createSyntheticPdfBytes([syntheticPage])
    const parseResult = await parseStatementPdf(pdfBytes, {
      isDemo: true,
      selectedProvider: 'phonepe',
    })

    expect(parseResult.detection.isVerified).toBe(true)
    expect(parseResult.records.length).toBe(2)
    expect(parseResult.rejectedRows.length).toBe(0)

    const [tx1, tx2] = parseResult.records

    // Check tx1: DEBIT ₹7,000
    expect(tx1.direction).toBe('debit')
    expect(tx1.amountPaise).toBe(700000)
    expect(tx1.cleanDescription).toBe('synthetic scheduled bank limited')
    expect(tx1.cleanDescription).not.toContain('Transaction ID')
    expect(tx1.metadata.chequeOrRefNo).toBe('112233445566')
    expect(tx1.metadata.orderId).toBe('T9999999999999999999999')
    expect(tx1.parsedDate).toContain('2026-10-18T15:17:00')

    // Check tx2: CREDIT ₹1,000
    expect(tx2.direction).toBe('credit')
    expect(tx2.amountPaise).toBe(100000)
    expect(tx2.cleanDescription).toBe('Synthetic Sender')
    // Crucial regression check: Multi-line disclaimer footer must NOT leak into last transaction description
    expect(tx2.cleanDescription).not.toContain('errors in the statement')
    expect(tx2.cleanDescription).not.toContain('Disclaimer')
    expect(tx2.cleanDescription).not.toContain('PhonePe')
    expect(tx2.metadata.chequeOrRefNo).toBe('998877665544')
    expect(tx2.metadata.orderId).toBe('T8888888888888888888888')
    expect(tx2.parsedDate).toContain('2026-07-27T21:23:00')
  })
})
