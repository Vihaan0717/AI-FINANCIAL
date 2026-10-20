/**
 * Robust Client-Side RFC 4180 CSV Reader
 * Money Mate AI — Stage 8.2
 * 
 * Capabilities:
 * - UTF-8 and UTF-8 BOM (\uFEFF) detection and stripping.
 * - Quoted fields containing commas, spaces, and escaped double quotes ("").
 * - Multi-line quoted cells.
 * - CRLF (\r\n) and LF (\n) normalization.
 * - Whitespace trimming for column headers.
 * - Disambiguation of duplicate column names (e.g. ['Amount', 'Amount'] -> ['Amount', 'Amount_2']).
 * - Trailing empty line pruning.
 * - Non-throwing, resilient parsing of malformed rows with diagnostic warnings.
 */

import type { ParsedCsvTable } from './parserTypes'

export interface CsvReaderOptions {
  trimHeaders?: boolean
  trimCells?: boolean
  skipEmptyRows?: boolean
}

/**
 * Parses raw CSV string into a structured ParsedCsvTable.
 */
export function parseCsv(csvText: string, options: CsvReaderOptions = {}): ParsedCsvTable {
  const {
    trimHeaders = true,
    trimCells = false,
    skipEmptyRows = true,
  } = options

  const warnings: string[] = []

  if (!csvText || typeof csvText !== 'string') {
    return {
      headers: [],
      rows: [],
      rawLineCount: 0,
      bomDetected: false,
      lineEnding: 'LF',
      warnings: ['Input CSV text is empty or not a string.'],
    }
  }

  // 1. Detect and strip UTF-8 BOM (\uFEFF)
  let text = csvText
  let bomDetected = false
  if (text.charCodeAt(0) === 0xfeff) {
    bomDetected = true
    text = text.slice(1)
  }

  // 2. Detect line endings
  let crlfCount = 0
  let lfOnlyCount = 0
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      crlfCount++
      i++ // Skip \n
    } else if (text[i] === '\n') {
      lfOnlyCount++
    }
  }
  const lineEnding: 'CRLF' | 'LF' | 'mixed' =
    crlfCount > 0 && lfOnlyCount > 0
      ? 'mixed'
      : crlfCount > 0
      ? 'CRLF'
      : 'LF'

  // 3. RFC 4180 State Machine Parser
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false
  let rawLineCount = 1

  const len = text.length

  for (let i = 0; i < len; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        // Lookahead for escaped quote ("")
        if (i + 1 < len && text[i + 1] === '"') {
          currentCell += '"'
          i++ // skip next quote
        } else {
          // Closing quote
          inQuotes = false
        }
      } else {
        if (char === '\n') {
          rawLineCount++
        }
        currentCell += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        currentRow.push(trimCells ? currentCell.trim() : currentCell)
        currentCell = ''
      } else if (char === '\r') {
        // Lookahead for \n
        if (i + 1 < len && text[i + 1] === '\n') {
          i++
        }
        currentRow.push(trimCells ? currentCell.trim() : currentCell)
        rows.push(currentRow)
        currentRow = []
        currentCell = ''
        rawLineCount++
      } else if (char === '\n') {
        currentRow.push(trimCells ? currentCell.trim() : currentCell)
        rows.push(currentRow)
        currentRow = []
        currentCell = ''
        rawLineCount++
      } else {
        currentCell += char
      }
    }
  }

  // Flush remaining cell and row
  if (currentCell.length > 0 || inQuotes || currentRow.length > 0) {
    if (inQuotes) {
      warnings.push(`Unclosed quote detected at line ${rawLineCount}. Cell terminated at EOF.`)
    }
    currentRow.push(trimCells ? currentCell.trim() : currentCell)
    rows.push(currentRow)
  }

  if (rows.length === 0) {
    return {
      headers: [],
      rows: [],
      rawLineCount,
      bomDetected,
      lineEnding,
      warnings: ['CSV file contains no rows.'],
    }
  }

  // 4. Extract and Disambiguate Headers
  const rawHeaders = rows[0] || []
  const headers: string[] = []
  const headerCounts = new Map<string, number>()

  for (let i = 0; i < rawHeaders.length; i++) {
    let headerName = trimHeaders ? rawHeaders[i].trim() : rawHeaders[i]
    if (headerName === '') {
      headerName = `Column_${i + 1}`
      warnings.push(`Empty header at column ${i + 1} renamed to "${headerName}".`)
    }

    const lower = headerName.toLowerCase()
    const count = headerCounts.get(lower) || 0
    headerCounts.set(lower, count + 1)

    if (count > 0) {
      const disambiguated = `${headerName}_${count + 1}`
      warnings.push(`Duplicate column header "${headerName}" disambiguated as "${disambiguated}".`)
      headers.push(disambiguated)
    } else {
      headers.push(headerName)
    }
  }

  // 5. Filter Data Rows
  const dataRows: string[][] = []
  const dataRowsRaw = rows.slice(1)

  for (let r = 0; r < dataRowsRaw.length; r++) {
    const row = dataRowsRaw[r]
    if (skipEmptyRows) {
      const isBlank = row.every((c) => c.trim() === '')
      if (isBlank) {
        continue
      }
    }
    dataRows.push(row)
  }

  return {
    headers,
    rows: dataRows,
    rawLineCount,
    bomDetected,
    lineEnding,
    warnings,
  }
}
