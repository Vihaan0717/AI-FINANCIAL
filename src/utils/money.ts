/**
 * Exact Financial Arithmetic Module
 * 
 * All monetary amounts in Money Mate AI are stored and calculated as exact integer paise.
 * 1 Rupee = 100 Paise.
 * Floating-point arithmetic is never used for financial calculations.
 */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const inrFormatterPrecise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Converts a rupee amount (number or string) into exact integer paise.
 * Validates against NaN, Infinity, negative values, and invalid formats.
 */
export function rupeesToPaise(rupees: number | string): number {
  if (typeof rupees === 'string') {
    const trimmed = rupees.trim().replace(/,/g, '')
    if (trimmed === '' || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      throw new Error(`Invalid rupee amount format: "${rupees}". Must be a positive number with at most 2 decimal places.`)
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid monetary value: "${rupees}"`)
    }
    return Math.round(parsed * 100)
  }

  if (typeof rupees !== 'number' || !Number.isFinite(rupees) || isNaN(rupees) || rupees < 0) {
    throw new Error(`Invalid rupee amount: ${rupees}. Must be a finite positive number.`)
  }

  return Math.round(rupees * 100)
}

/**
 * Converts integer paise to float rupees for presentation only.
 */
export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) {
    throw new Error(`Paise must be an integer, received: ${paise}`)
  }
  return paise / 100
}

/**
 * Converts integer paise to a decimal rupee string with 2 decimal places.
 */
export function paiseToRupeesString(paise: number): string {
  return paiseToRupees(paise).toFixed(2)
}

/**
 * Validates a monetary input string or number.
 */
export function validateAmount(amount: number | string): { valid: boolean; paise: number; error?: string } {
  try {
    const paise = rupeesToPaise(amount)
    if (paise <= 0) {
      return { valid: false, paise: 0, error: 'Amount must be greater than zero.' }
    }
    // Prevent unrealistic overflow (> 100 Crores)
    if (paise > 1_000_000_000_00) {
      return { valid: false, paise: 0, error: 'Amount exceeds maximum supported limit.' }
    }
    return { valid: true, paise }
  } catch (err) {
    return { valid: false, paise: 0, error: err instanceof Error ? err.message : 'Invalid amount' }
  }
}

/**
 * Formats integer paise into localized Indian Rupee (INR) representation.
 */
export function formatPaise(paise: number, options?: { showSign?: boolean; precise?: boolean }): string {
  if (!Number.isInteger(paise)) {
    paise = Math.round(paise)
  }

  const isNegative = paise < 0
  const absPaise = Math.abs(paise)
  const rupees = absPaise / 100

  const formatter = options?.precise || absPaise % 100 !== 0 ? inrFormatterPrecise : inrFormatter
  const formatted = formatter.format(rupees)

  if (options?.showSign) {
    if (isNegative) return `−${formatted}`
    if (paise > 0) return `+${formatted}`
    return formatted
  }

  return isNegative ? `−${formatted}` : formatted
}

/**
 * Safe integer addition of paise amounts.
 */
export function addPaise(...amounts: number[]): number {
  return amounts.reduce((acc, curr) => {
    if (!Number.isInteger(curr)) {
      throw new Error(`addPaise expects integers, received: ${curr}`)
    }
    return acc + curr
  }, 0)
}

/**
 * Safe integer subtraction of paise amounts.
 */
export function subtractPaise(minuend: number, subtrahend: number): number {
  if (!Number.isInteger(minuend) || !Number.isInteger(subtrahend)) {
    throw new Error(`subtractPaise expects integers, received minuend: ${minuend}, subtrahend: ${subtrahend}`)
  }
  return minuend - subtrahend
}
