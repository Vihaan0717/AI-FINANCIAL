/**
 * Statement Validation and Normalization Utilities
 * Money Mate AI — Stage 8.1
 * 
 * Safe client-side parsing, exact integer paise arithmetic, and reference sanitization.
 */

import { rupeesToPaise } from './money'

/**
 * Validates and converts statement amount to exact integer paise.
 * Rejects non-finite values, negative numbers, zero amounts (unless allowZero is true),
 * malformed numbers, and precision > 2 decimals.
 * 
 * Deliberate Policy: Financial transactions in the ledger must represent non-zero,
 * positive economic amounts (amountPaise > 0). Zero amounts are rejected unless
 * explicitly allowed (e.g. for running account balance verification).
 */
export function validateStatementMonetaryAmount(
  value: unknown,
  allowZero: boolean = false
): {
  valid: boolean
  paise: number
  error?: string
} {
  if (value === null || value === undefined) {
    return { valid: false, paise: 0, error: 'Amount is null or undefined.' }
  }

  // Handle number type
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || isNaN(value)) {
      return { valid: false, paise: 0, error: `Non-finite amount: ${value}` }
    }
    if (value < 0) {
      return { valid: false, paise: 0, error: `Negative amount not permitted: ${value}. Direction should be specified explicitly.` }
    }
    if (value === 0 && !allowZero) {
      return { valid: false, paise: 0, error: 'Zero-value transactions are not permitted. Financial records must have a positive monetary amount.' }
    }
    try {
      const paise = Math.round(value * 100)
      if (paise === 0 && !allowZero) {
        return { valid: false, paise: 0, error: 'Zero-value transactions are not permitted. Financial records must have a positive monetary amount.' }
      }
      // Check for excess precision in floating number (e.g. 10.005)
      const diff = Math.abs(value * 100 - paise)
      if (diff > 1e-4) {
        return { valid: false, paise: 0, error: `Amount ${value} has more than 2 decimal places.` }
      }
      return { valid: true, paise }
    } catch {
      return { valid: false, paise: 0, error: `Failed to convert amount: ${value}` }
    }
  }

  // Handle string type
  if (typeof value === 'string') {
    const raw = value.trim().replace(/[₹,\s]/g, '')
    if (raw === '') {
      return { valid: false, paise: 0, error: 'Empty amount string.' }
    }
    // Reject negative sign in raw amount (direction must be explicit)
    if (raw.startsWith('-')) {
      return { valid: false, paise: 0, error: `Negative amount string "${value}" not permitted.` }
    }
    // Strict format check: digits optionally followed by up to 2 decimals
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      return { valid: false, paise: 0, error: `Invalid amount format "${value}". Must be a positive number with at most 2 decimal places.` }
    }

    try {
      const paise = rupeesToPaise(raw)
      if (paise === 0 && !allowZero) {
        return { valid: false, paise: 0, error: 'Zero-value transactions are not permitted. Financial records must have a positive monetary amount.' }
      }
      return { valid: true, paise }
    } catch (err) {
      return { valid: false, paise: 0, error: err instanceof Error ? err.message : 'Invalid amount' }
    }
  }

  return { valid: false, paise: 0, error: `Unsupported amount type: ${typeof value}` }
}

/** Common meaningless reference tokens to ignore */
const PLACEHOLDER_REFERENCES = new Set([
  'NA',
  'N/A',
  'NIL',
  'NONE',
  'NULL',
  '-',
  '--',
  '0',
  '000000000000',
  'UNKNOWN',
])

/**
 * Normalizes a raw statement reference (UTR, RRN, IMPS Ref, Order ID).
 * 
 * Capabilities:
 * - Extracts 12-digit UPI reference numbers from standard Indian bank narration patterns (e.g. UPI/529381729102/..., UTR:529381729102).
 * - Preserves alphanumeric references (e.g., Paytm order IDs or Slice hashes) without corrupting them.
 * - Strips common narration noise and prefix tags.
 * - Returns undefined if the reference is absent, too short (< 4 chars), or matches generic placeholder tokens.
 */
export function normalizeTransactionReference(rawRef?: string): string | undefined {
  if (!rawRef || typeof rawRef !== 'string') return undefined

  const trimmed = rawRef.trim()
  if (trimmed.length === 0) return undefined

  if (PLACEHOLDER_REFERENCES.has(trimmed.toUpperCase())) {
    return undefined
  }

  // 1. Check for standard 12-digit Indian UPI / RRN pattern within narration
  // Examples: UPI/529381729102/CR, UTR-529381729102, RRN:529381729102, UPI:529381729102
  const upi12DigitMatch = trimmed.match(/(?:UPI|UTR|RRN|IMPS|REF)[/:\-_ ]*(\d{12})(?!\d)/i)
  if (upi12DigitMatch && upi12DigitMatch[1]) {
    return upi12DigitMatch[1]
  }

  // 2. Standalone 12-digit numeric reference
  const standalone12Digit = trimmed.match(/^(\d{12})$/)
  if (standalone12Digit && standalone12Digit[1]) {
    return standalone12Digit[1]
  }

  // 3. Alphanumeric reference extraction (e.g., Paytm Txn ID or IMPS reference)
  // Strips common leading prefixes like "REF:", "TXN ID:", "CHQ NO:", "UTR NO:"
  const cleaned = trimmed
    .replace(/^(?:REF|TXN|TRANSACTION|ID|UTR|RRN|CHQ|CHEQUE|ORDER)[\s#:_\-\.]+/i, '')
    .trim()

  // Must have at least 4 alphanumeric characters to be considered a viable reference
  const alphanumericOnly = cleaned.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (alphanumericOnly.length >= 4) {
    return alphanumericOnly
  }

  return undefined
}

/** Month name to month index mapping */
const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, SEPT: 8, OCT: 9, NOV: 10, DEC: 11,
}

/**
 * Safely parses common Indian banking and statement date formats into an ISO 8601 string.
 * Never throws exceptions; returns diagnostic warnings/errors.
 * 
 * Supported patterns:
 * - ISO: "2026-10-19", "2026-10-19T14:30:00Z"
 * - DD/MM/YYYY or DD-MM-YYYY (e.g. "19/10/2026", "19-10-2026")
 * - DD/MM/YYYY HH:mm or HH:mm:ss
 * - DD-MMM-YYYY (e.g. "19-OCT-2026", "19-Oct-2026 14:30")
 * - MMM DD, YYYY (e.g. "Oct 18, 2026 03:17 pm", "Sept 26, 2026", "Oct 18, 2026\n03:17 pm")
 * - DD/MM/YY (2-digit year)
 */
export function parseStatementTimestamp(rawText: string): {
  parsedIso?: string
  warning?: string
  error?: string
} {
  if (!rawText || typeof rawText !== 'string') {
    return { error: 'Date string is missing or not a string.' }
  }

  const clean = rawText.trim()
  if (clean === '') {
    return { error: 'Date string is empty.' }
  }

  // 1. Standard ISO check
  if (/^\d{4}-\d{2}-\d{2}(?:T|\s)?.*$/.test(clean)) {
    const parsed = new Date(clean)
    if (!isNaN(parsed.getTime())) {
      return { parsedIso: parsed.toISOString() }
    }
  }

  // 2. DD-MMM-YYYY or DD-MMM-YY (e.g. 19-OCT-2026 or 19-Oct-26)
  const dddMmmMatch = clean.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,4})[-\s/](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i)
  if (dddMmmMatch) {
    const day = parseInt(dddMmmMatch[1], 10)
    const monthStr = dddMmmMatch[2].toUpperCase()
    let year = parseInt(dddMmmMatch[3], 10)
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000
    }

    const month = MONTH_MAP[monthStr]
    if (month !== undefined && day >= 1 && day <= 31) {
      let hours = dddMmmMatch[4] ? parseInt(dddMmmMatch[4], 10) : 0
      const minutes = dddMmmMatch[5] ? parseInt(dddMmmMatch[5], 10) : 0
      const seconds = dddMmmMatch[6] ? parseInt(dddMmmMatch[6], 10) : 0
      const ampm = dddMmmMatch[7]?.toUpperCase()

      if (ampm === 'PM' && hours < 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0

      // Create UTC date
      const dateObj = new Date(Date.UTC(year, month, day, hours, minutes, seconds))
      if (!isNaN(dateObj.getTime())) {
        return { parsedIso: dateObj.toISOString() }
      }
    }
  }

  // 2b. MMM DD, YYYY or MMM DD YYYY (e.g. "Oct 18, 2026 03:17 pm", "Sept 26, 2026", "Oct 18, 2026\n03:17 pm")
  const mmmDdMatch = clean.replace(/\r?\n/g, ' ').match(/^([A-Za-z]{3,4})[\s,]+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i)
  if (mmmDdMatch) {
    const monthStr = mmmDdMatch[1].toUpperCase()
    const day = parseInt(mmmDdMatch[2], 10)
    let year = parseInt(mmmDdMatch[3], 10)
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000
    }

    const month = MONTH_MAP[monthStr]
    if (month !== undefined && day >= 1 && day <= 31) {
      let hours = mmmDdMatch[4] ? parseInt(mmmDdMatch[4], 10) : 0
      const minutes = mmmDdMatch[5] ? parseInt(mmmDdMatch[5], 10) : 0
      const seconds = mmmDdMatch[6] ? parseInt(mmmDdMatch[6], 10) : 0
      const ampm = mmmDdMatch[7]?.toUpperCase()

      if (ampm === 'PM' && hours < 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0

      const dateObj = new Date(Date.UTC(year, month, day, hours, minutes, seconds))
      if (!isNaN(dateObj.getTime())) {
        return { parsedIso: dateObj.toISOString() }
      }
    }
  }

  // 3. DD/MM/YYYY or DD-MM-YYYY (e.g. 19/10/2026, 19-10-2026)
  const ddmmyyyyMatch = clean.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i)
  if (ddmmyyyyMatch) {
    const day = parseInt(ddmmyyyyMatch[1], 10)
    const month = parseInt(ddmmyyyyMatch[2], 10) - 1 // 0-indexed
    let year = parseInt(ddmmyyyyMatch[3], 10)
    if (year < 100) {
      year += year >= 70 ? 1900 : 2000
    }

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let hours = ddmmyyyyMatch[4] ? parseInt(ddmmyyyyMatch[4], 10) : 0
      const minutes = ddmmyyyyMatch[5] ? parseInt(ddmmyyyyMatch[5], 10) : 0
      const seconds = ddmmyyyyMatch[6] ? parseInt(ddmmyyyyMatch[6], 10) : 0
      const ampm = ddmmyyyyMatch[7]?.toUpperCase()

      if (ampm === 'PM' && hours < 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0

      const dateObj = new Date(Date.UTC(year, month, day, hours, minutes, seconds))
      if (!isNaN(dateObj.getTime())) {
        return { parsedIso: dateObj.toISOString() }
      }
    }
  }

  // 4. Fallback to standard Date.parse
  const fallback = Date.parse(clean)
  if (!isNaN(fallback)) {
    return {
      parsedIso: new Date(fallback).toISOString(),
      warning: `Timestamp parsed using generic engine for "${clean}". Verify time zone.`,
    }
  }

  return { error: `Could not parse date format: "${clean}"` }
}

/**
 * Checks whether two normalized references exist and are in conflict.
 */
export function detectReferenceConflict(refA?: string, refB?: string): boolean {
  if (!refA || !refB) return false
  const normA = normalizeTransactionReference(refA)
  const normB = normalizeTransactionReference(refB)
  if (!normA || !normB) return false
  return normA !== normB
}

/**
 * Cleans raw counterparty or merchant text by trimming, collapsing whitespace,
 * and stripping superfluous legal entity suffixes.
 */
export function cleanCounterpartyText(rawText?: string): string {
  if (!rawText || typeof rawText !== 'string') return ''

  return rawText
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\/\\|_-]+$/, '')
    .trim()
}
