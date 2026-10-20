/**
 * Statement Parser Types and Integration Interfaces
 * Money Mate AI — Stage 8.2
 * 
 * Defines client-side parser outputs, format detection results, and row diagnostics.
 */

import type {
  StatementRecord,
  StatementProvider,
} from '../../types/reconciliation'

/** Low-level CSV table parsed by csvReader */
export interface ParsedCsvTable {
  headers: string[]
  rows: string[][]
  rawLineCount: number
  bomDetected: boolean
  lineEnding: 'CRLF' | 'LF' | 'mixed'
  warnings: string[]
}

/** Status of statement format detection */
export type FormatDetectionStatus =
  | 'recognized' // Confident match on known provider signature
  | 'provisional' // Provider structure detected, but awaiting verified real-world statement samples
  | 'ambiguous' // Multiple matching format candidates
  | 'missing_required_columns' // Partially matched, but mandatory columns are absent
  | 'unknown' // Header structure is unrecognized
  | 'unsupported' // File cannot be parsed as a structured statement

/** Diagnostic result of format detection */
export interface FormatDetectionResult {
  status: FormatDetectionStatus
  detectedProvider?: StatementProvider
  formatId?: string // e.g. 'sbi_csv_v1', 'phonepe_csv_v1'
  confidence: 'high' | 'medium' | 'low' | 'none'
  isVerified: boolean // False for all provisional parsers until verified against real-world statement exports
  matchedHeaders: string[]
  missingHeaders: string[]
  explanation: string
}

/** Diagnostic representation of an unparseable or invalid row */
export interface RejectedRow {
  rowIndex: number // 1-based line index in the source file
  rawRow: string[]
  reason: string
  fieldErrors: Record<string, string>
}

/** Aggregated parsing statistics */
export interface StatementParserStatistics {
  totalRows: number
  parsedRecords: number
  rejectedRecords: number
  warningRecords: number
  debitCount: number
  creditCount: number
  totalDebitPaise: number
  totalCreditPaise: number
}

/**
 * Standard output of a statement parser.
 * Exposes a clean, typed boundary consumed by the reconciliation preview UI.
 */
export interface StatementParserResult {
  detection: FormatDetectionResult
  records: StatementRecord[]
  rejectedRows: RejectedRow[]
  warnings: string[]
  statistics: StatementParserStatistics
  isProvisional: boolean
}

/** User configuration options passed to statement parsers */
export interface StatementParserOptions {
  batchId?: string
  sourceAccountId?: string
  sourceAccountAlias?: string
  statementFileId?: string
  isDemo?: boolean
  selectedProvider?: StatementProvider // Manual override if detection is ambiguous or provisional
  columnOverrides?: Record<string, string> // Optional custom column mapping (e.g. date -> 'Txn Date')
  accountMappings?: Record<string, { targetAccountId: string; targetAccountAlias: string }> // Explicit masked identifier mappings
}

