import type { DuplicateCheckResult, Transaction } from '../types/transaction'

/**
 * Checks if a candidate transaction looks like a potential duplicate of an existing record.
 * 
 * Rules:
 * 1. If both have the same non-empty externalRef, high confidence duplicate.
 * 2. If same amount (paise), same type, within 24 hours of each other, AND (same merchant OR same description), medium confidence duplicate.
 * 3. Never flag solely based on amount matching; legitimate repeat purchases are normal.
 */
export function detectDuplicate(
  candidate: {
    amount: number
    type: string
    date: string
    merchant?: string
    description?: string
    externalRef?: string
    id?: string
  },
  existingTransactions: Transaction[]
): DuplicateCheckResult {
  const candidateRef = candidate.externalRef?.trim().toLowerCase()
  const candidateMerchant = candidate.merchant?.trim().toLowerCase()
  const candidateDesc = candidate.description?.trim().toLowerCase()
  const candidateTime = new Date(candidate.date).getTime()

  for (const existing of existingTransactions) {
    // Skip self during edit operations
    if (candidate.id && existing.id === candidate.id) {
      continue
    }

    // 1. External reference match (strongest signal)
    if (candidateRef && existing.externalRef) {
      if (candidateRef === existing.externalRef.trim().toLowerCase()) {
        return {
          isDuplicate: true,
          match: existing,
          confidence: 'high',
          reason: `A transaction with identical reference ID (${existing.externalRef}) already exists.`,
        }
      }
    }

    // 2. Amount and Type must match
    if (existing.amount !== candidate.amount || existing.type !== candidate.type) {
      continue
    }

    // 3. Time proximity check (within 24 hours / 86,400,000 ms)
    const existingTime = new Date(existing.date).getTime()
    const timeDiffMs = Math.abs(candidateTime - existingTime)
    const isWithin24Hours = !isNaN(timeDiffMs) && timeDiffMs <= 86_400_000

    if (!isWithin24Hours) {
      continue
    }

    // 4. Same merchant or matching description
    const existingMerchant = existing.merchant?.trim().toLowerCase()
    const existingDesc = existing.description?.trim().toLowerCase()

    const hasMerchantMatch = candidateMerchant && existingMerchant && candidateMerchant === existingMerchant
    const hasDescMatch = candidateDesc && existingDesc && candidateDesc === existingDesc

    if (hasMerchantMatch || hasDescMatch) {
      const matchLabel = existing.merchant || existing.description
      return {
        isDuplicate: true,
        match: existing,
        confidence: 'medium',
        reason: `A matching ${existing.type} of ₹${existing.amount / 100} for "${matchLabel}" was already recorded on ${new Date(existing.date).toLocaleDateString('en-IN')}.`,
      }
    }
  }

  return {
    isDuplicate: false,
    confidence: 'high',
  }
}
