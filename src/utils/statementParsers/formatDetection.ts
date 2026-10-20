/**
 * Statement Format Detection Engine
 * Money Mate AI — Stage 8.2
 * 
 * Inspects parsed column headers and structure to identify the provider format.
 * Strictly labels parsers as provisional (isVerified: false) until verified against
 * real exported statement samples.
 */

import type { FormatDetectionResult, StatementParserOptions } from './parserTypes'
import type { StatementProvider } from '../../types/reconciliation'
import type { ExtractedPdfDocument } from './pdfReader'

interface ProviderSignature {
  provider: StatementProvider
  formatId: string
  name: string
  primaryKeys: string[][] // Array of required column alias sets (at least one from each group must match)
  secondaryKeys: string[] // Strong indicator columns
}

const PROVIDER_SIGNATURES: ProviderSignature[] = [
  // 1. State Bank of India (SBI)
  {
    provider: 'sbi',
    formatId: 'sbi_csv_provisional_v1',
    name: 'State Bank of India (SBI) CSV',
    primaryKeys: [
      ['txn date', 'transaction date', 'date'],
      ['description', 'narration', 'particulars'],
      ['debit', 'withdrawal amt.', 'withdrawal', 'dr'],
      ['credit', 'deposit amt.', 'deposit', 'cr'],
    ],
    secondaryKeys: ['ref no./cheque no.', 'chq./ref.no.', 'value date', 'balance', 'closing balance'],
  },

  // 2. Union Bank of India
  {
    provider: 'union_bank',
    formatId: 'union_bank_csv_provisional_v1',
    name: 'Union Bank of India CSV',
    primaryKeys: [
      ['date', 'txn date', 'tran date'],
      ['remarks', 'narration', 'transaction remarks'],
      ['withdrawal (dr)', 'withdrawal', 'debit (dr)', 'dr amount'],
      ['deposit (cr)', 'deposit', 'credit (cr)', 'cr amount'],
    ],
    secondaryKeys: ['cheque no', 'chq no', 'account balance', 'balance (inr)', 'balance'],
  },

  // 3. PhonePe
  {
    provider: 'phonepe',
    formatId: 'phonepe_csv_provisional_v1',
    name: 'PhonePe Export CSV',
    primaryKeys: [
      ['date', 'payment date', 'time'],
      ['transaction id', 'txn id', 'utr', 'transaction details'],
      ['amount', 'paid amount'],
      ['type', 'transaction type', 'payment type'],
    ],
    secondaryKeys: ['payment to', 'merchant', 'status', 'payment instrument', 'transaction details'],
  },

  // 4. Paytm
  {
    provider: 'paytm',
    formatId: 'paytm_csv_provisional_v1',
    name: 'Paytm Export CSV',
    primaryKeys: [
      ['date', 'activity date'],
      ['transaction details', 'description', 'order details'],
      ['order id', 'order_id', 'txn id'],
      ['amount', 'transaction amount'],
    ],
    secondaryKeys: ['activity', 'wallet txnid', 'status', 'source/destination'],
  },

  // 5. Slice
  {
    provider: 'slice',
    formatId: 'slice_csv_provisional_v1',
    name: 'Slice Export CSV',
    primaryKeys: [
      ['date', 'txn date'],
      ['description', 'merchant name'],
      ['txn type', 'transaction type'],
      ['amount', 'spend amount'],
    ],
    secondaryKeys: ['category', 'reference id', 'slice reference', 'payment mode'],
  },
]

/**
 * Normalizes header string for comparison.
 */
function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s_\-]+/g, ' ')
}

/**
 * Detects the statement provider format from parsed table headers.
 */
export function detectStatementFormat(
  headers: string[],
  options?: StatementParserOptions
): FormatDetectionResult {
  // If user explicitly selected a provider override, honor it as provisional
  if (options?.selectedProvider) {
    const selected = PROVIDER_SIGNATURES.find((s) => s.provider === options.selectedProvider)
    return {
      status: 'provisional',
      detectedProvider: options.selectedProvider,
      formatId: selected?.formatId || `${options.selectedProvider}_manual_override`,
      confidence: 'medium',
      isVerified: false,
      matchedHeaders: headers,
      missingHeaders: [],
      explanation: `Provider "${options.selectedProvider}" selected via user override. Parser running in provisional mode.`,
    }
  }

  if (!headers || headers.length === 0) {
    return {
      status: 'unsupported',
      confidence: 'none',
      isVerified: false,
      matchedHeaders: [],
      missingHeaders: [],
      explanation: 'No headers found in statement file.',
    }
  }

  const normalizedHeaders = headers.map(normalizeHeader)

  // Evaluate candidate matches
  const matchCandidates: {
    sig: ProviderSignature
    matchedPrimaryCount: number
    totalPrimaryCount: number
    matchedSecondaryCount: number
    missingPrimary: string[]
    matchedNames: string[]
  }[] = []

  for (const sig of PROVIDER_SIGNATURES) {
    let matchedPrimary = 0
    const missingPrimary: string[] = []
    const matchedNames: string[] = []

    for (const group of sig.primaryKeys) {
      const foundHeader = normalizedHeaders.find((h) => group.includes(h))
      if (foundHeader) {
        matchedPrimary++
        matchedNames.push(foundHeader)
      } else {
        missingPrimary.push(group[0]) // Suggest first alias
      }
    }

    let matchedSecondary = 0
    for (const sec of sig.secondaryKeys) {
      if (normalizedHeaders.includes(sec)) {
        matchedSecondary++
        matchedNames.push(sec)
      }
    }

    matchCandidates.push({
      sig,
      matchedPrimaryCount: matchedPrimary,
      totalPrimaryCount: sig.primaryKeys.length,
      matchedSecondaryCount: matchedSecondary,
      missingPrimary,
      matchedNames,
    })
  }

  // Filter full primary matches
  const fullMatches = matchCandidates.filter((c) => c.matchedPrimaryCount === c.totalPrimaryCount)

  if (fullMatches.length === 1) {
    const best = fullMatches[0]
    return {
      status: 'provisional',
      detectedProvider: best.sig.provider,
      formatId: best.sig.formatId,
      confidence: best.matchedSecondaryCount > 0 ? 'high' : 'medium',
      isVerified: false, // Strict: provisional until validated against real files
      matchedHeaders: best.matchedNames,
      missingHeaders: [],
      explanation: `Detected provisional format "${best.sig.name}" (${best.matchedPrimaryCount}/${best.totalPrimaryCount} key columns matched).`,
    }
  }

  if (fullMatches.length > 1) {
    // Disambiguate using secondary indicators
    fullMatches.sort((a, b) => b.matchedSecondaryCount - a.matchedSecondaryCount)
    if (fullMatches[0].matchedSecondaryCount > fullMatches[1].matchedSecondaryCount) {
      const best = fullMatches[0]
      return {
        status: 'provisional',
        detectedProvider: best.sig.provider,
        formatId: best.sig.formatId,
        confidence: 'medium',
        isVerified: false,
        matchedHeaders: best.matchedNames,
        missingHeaders: [],
        explanation: `Disambiguated candidate format "${best.sig.name}" based on secondary indicator columns.`,
      }
    }

    return {
      status: 'ambiguous',
      confidence: 'low',
      isVerified: false,
      matchedHeaders: headers,
      missingHeaders: [],
      explanation: `Ambiguous statement format. Headers matched multiple candidate providers: ${fullMatches.map((m) => m.sig.name).join(', ')}. Please specify provider manually.`,
    }
  }

  // Check generic CSV (minimum requirement: date column + description column + amount or dr/cr)
  const hasDate = normalizedHeaders.some((h) => ['date', 'time', 'timestamp', 'txn date'].includes(h))
  const hasDesc = normalizedHeaders.some((h) => ['description', 'particulars', 'narration', 'details', 'remarks'].includes(h))
  const hasSingleAmount = normalizedHeaders.some((h) => ['amount', 'amt', 'total'].includes(h))
  const hasDrCr =
    normalizedHeaders.some((h) => ['debit', 'withdrawal', 'withdrawal (dr)', 'dr'].includes(h)) ||
    normalizedHeaders.some((h) => ['credit', 'deposit', 'deposit (cr)', 'cr'].includes(h))

  // If file has standard Date, Description, and Amount (without Dr/Cr or bank balance indicators),
  // it is cleanly a generic CSV rather than an incomplete bank statement.
  if (hasDate && hasDesc && hasSingleAmount && !hasDrCr) {
    return {
      status: 'provisional',
      detectedProvider: 'generic_csv',
      formatId: 'generic_csv_v1',
      confidence: 'medium',
      isVerified: false,
      matchedHeaders: headers,
      missingHeaders: [],
      explanation: 'Detected Generic CSV format containing standard Date, Description, and Amount columns.',
    }
  }

  // Check for partial matches with missing required columns
  const partialMatches = matchCandidates.filter(
    (c) => c.matchedPrimaryCount >= 2 && c.missingPrimary.length > 0
  )
  if (partialMatches.length > 0) {
    // Sort by most primary matches, then secondary matches
    partialMatches.sort((a, b) => b.matchedPrimaryCount - a.matchedPrimaryCount || b.matchedSecondaryCount - a.matchedSecondaryCount)
    const closest = partialMatches[0]
    return {
      status: 'missing_required_columns',
      detectedProvider: closest.sig.provider,
      formatId: closest.sig.formatId,
      confidence: 'low',
      isVerified: false,
      matchedHeaders: closest.matchedNames,
      missingHeaders: closest.missingPrimary,
      explanation: `Headers partially match "${closest.sig.name}", but required columns are missing: ${closest.missingPrimary.join(', ')}.`,
    }
  }

  if (hasDate && hasDesc && (hasSingleAmount || hasDrCr)) {
    return {
      status: 'provisional',
      detectedProvider: 'generic_csv',
      formatId: 'generic_csv_v1',
      confidence: 'medium',
      isVerified: false,
      matchedHeaders: headers,
      missingHeaders: [],
      explanation: 'Detected Generic CSV format containing standard transaction columns.',
    }
  }

  return {
    status: 'unknown',
    confidence: 'none',
    isVerified: false,
    matchedHeaders: [],
    missingHeaders: [],
    explanation: `Unknown statement format. Headers [${headers.join(', ')}] did not match any known provider signature.`,
  }
}

/**
 * Detects statement format and provider from an extracted PDF document.
 */
export function detectPdfStatementFormat(
  pdfDoc: ExtractedPdfDocument,
  options: StatementParserOptions = {}
): FormatDetectionResult {
  if (pdfDoc.isScannedOrImageOnly) {
    return {
      status: 'unsupported',
      confidence: 'none',
      isVerified: false,
      matchedHeaders: [],
      missingHeaders: [],
      explanation:
        'Scanned or image-only PDF detected with no selectable text. Optical character recognition or an original digital statement export is required.',
    }
  }

  const text = pdfDoc.fullText

  // Check for PhonePe signature
  const isPhonePeHeader =
    /Transaction Statement for/i.test(text) ||
    /phonepe/i.test(text) ||
    /https:\/\/support\.phonepe\.com/i.test(text)

  const hasPhonePeColumns =
    /Date\s+Transaction Details\s+Type\s+Amount/i.test(text) ||
    (/Transaction Details/i.test(text) && /\b(DEBIT|CREDIT)\b/i.test(text))

  if (isPhonePeHeader && hasPhonePeColumns) {
    return {
      status: 'recognized',
      detectedProvider: 'phonepe',
      formatId: 'phonepe_pdf_v1',
      confidence: 'high',
      isVerified: true,
      matchedHeaders: ['Date', 'Transaction Details', 'Type', 'Amount'],
      missingHeaders: [],
      explanation: 'Detected PhonePe PDF statement export layout with standard transaction table.',
    }
  }

  if (options.selectedProvider === 'phonepe' || hasPhonePeColumns) {
    return {
      status: 'recognized',
      detectedProvider: 'phonepe',
      formatId: 'phonepe_pdf_v1',
      confidence: 'medium',
      isVerified: true,
      matchedHeaders: ['Date', 'Transaction Details', 'Type', 'Amount'],
      missingHeaders: [],
      explanation: 'Matched PhonePe PDF statement layout.',
    }
  }

  return {
    status: 'unsupported',
    confidence: 'none',
    isVerified: false,
    matchedHeaders: [],
    missingHeaders: [],
    explanation:
      'Unsupported PDF statement format. Currently supported digital PDF formats: PhonePe digital statement exports.',
  }
}

