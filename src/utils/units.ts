import type { InventoryUnit } from '../types/inventory'

export type UnitDimension = 'mass' | 'volume' | 'discrete'

export const UNIT_DIMENSIONS: Record<InventoryUnit, UnitDimension> = {
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  pcs: 'discrete',
  bars: 'discrete',
  bottles: 'discrete',
  tubes: 'discrete',
  packs: 'discrete',
}

export const SUPPORTED_UNITS: InventoryUnit[] = [
  'pcs',
  'bars',
  'bottles',
  'tubes',
  'packs',
  'g',
  'kg',
  'ml',
  'l',
]

/**
 * Checks whether two inventory units can be mathematically combined.
 * Mass units (g, kg) are mutually compatible.
 * Volume units (ml, l) are mutually compatible.
 * Discrete units (pcs, bars, bottles, tubes, packs) are only compatible with the exact same unit.
 */
export function areUnitsCompatible(unitA: InventoryUnit, unitB: InventoryUnit): boolean {
  if (unitA === unitB) return true

  const dimA = UNIT_DIMENSIONS[unitA]
  const dimB = UNIT_DIMENSIONS[unitB]

  if (dimA === 'discrete' || dimB === 'discrete') {
    // Discrete items of different packaging cannot be combined automatically
    return false
  }

  return dimA === dimB
}

/**
 * Converts a quantity from one unit to another within the same dimension.
 * Throws an Error if units are incompatible.
 */
export function convertUnitQuantity(
  amount: number,
  fromUnit: InventoryUnit,
  toUnit: InventoryUnit
): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Quantity must be a finite, non-negative number. Received: ${amount}`)
  }

  if (fromUnit === toUnit) {
    return amount
  }

  if (!areUnitsCompatible(fromUnit, toUnit)) {
    throw new Error(
      `Incompatible units: Cannot convert between "${fromUnit}" and "${toUnit}".`
    )
  }

  // Mass conversions
  if (fromUnit === 'kg' && toUnit === 'g') {
    return amount * 1000
  }
  if (fromUnit === 'g' && toUnit === 'kg') {
    return amount / 1000
  }

  // Volume conversions
  if (fromUnit === 'l' && toUnit === 'ml') {
    return amount * 1000
  }
  if (fromUnit === 'ml' && toUnit === 'l') {
    return amount / 1000
  }

  throw new Error(`Unhandled conversion from "${fromUnit}" to "${toUnit}".`)
}

/**
 * Combines two quantities safely, throwing if their units are incompatible.
 */
export function combineQuantities(
  qtyA: number,
  unitA: InventoryUnit,
  qtyB: number,
  unitB: InventoryUnit,
  targetUnit: InventoryUnit = unitA
): number {
  if (!areUnitsCompatible(unitA, unitB)) {
    throw new Error(`Cannot combine incompatible units: "${unitA}" and "${unitB}".`)
  }

  const convertedA = convertUnitQuantity(qtyA, unitA, targetUnit)
  const convertedB = convertUnitQuantity(qtyB, unitB, targetUnit)

  const result = convertedA + convertedB
  if (!Number.isFinite(result) || result < 0) {
    throw new Error('Resulting combined quantity is invalid.')
  }
  return Number(result.toFixed(4)) // Avoid floating point precision issues
}
