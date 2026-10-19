import type { Transaction } from '../types/transaction'

/**
 * Escapes a single CSV cell value according to RFC 4180 rules.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const str = String(value)
  // If string contains comma, double-quote, or newline, wrap in quotes and escape quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Converts an array of transactions into a valid RFC 4180 CSV string.
 */
export function generateTransactionsCsv(transactions: Transaction[]): string {
  const headers = [
    'Transaction ID',
    'Date',
    'Type',
    'Amount (INR)',
    'Status',
    'Category',
    'Subcategory',
    'Payment Method',
    'Merchant',
    'Description',
    'External Reference',
    'Notes',
    'Created At',
  ]

  const rows = transactions.map((t) => [
    escapeCsvCell(t.id),
    escapeCsvCell(t.date),
    escapeCsvCell(t.type),
    escapeCsvCell((t.amount / 100).toFixed(2)),
    escapeCsvCell(t.status),
    escapeCsvCell(t.category),
    escapeCsvCell(t.subcategory || ''),
    escapeCsvCell(t.paymentMethod),
    escapeCsvCell(t.merchant || ''),
    escapeCsvCell(t.description),
    escapeCsvCell(t.externalRef || ''),
    escapeCsvCell(t.notes || ''),
    escapeCsvCell(t.createdAt),
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\r\n')

  // UTF-8 Byte Order Mark for proper Excel/Spreadsheet encoding
  return `\uFEFF${csvContent}`
}

/**
 * Triggers a browser download of the CSV file.
 */
export function downloadTransactionsCsv(
  transactions: Transaction[],
  fileName: string = `moneymate-transactions-${new Date().toISOString().slice(0, 10)}.csv`
): void {
  if (typeof window === 'undefined') return

  const csv = generateTransactionsCsv(transactions)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', fileName)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
