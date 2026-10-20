/**
 * Client-Side PDF Text Extraction Utility
 * Money Mate AI — Milestone: PhonePe PDF Statement Import
 * 
 * Strict architectural guarantees:
 * 1. 100% local, client-side execution — statement binary and text NEVER leave the user's browser.
 * 2. Graceful error handling for encrypted, password-protected, or corrupted files.
 * 3. Page-level text extraction with selectable text validation and scanned/image-only detection.
 * 4. Coordinate-aware text reconstruction to preserve spatial layout, word boundaries, and line breaks.
 */

import { extractText, extractTextItems } from 'unpdf'

export interface ExtractedPdfPage {
  pageNumber: number
  text: string
  lineCount: number
  hasSelectableText: boolean
}

export interface ExtractedPdfDocument {
  totalPages: number
  pages: ExtractedPdfPage[]
  fullText: string
  isScannedOrImageOnly: boolean
  warnings: string[]
  error?: string
}

/**
 * Extracts structured text per page from a local PDF binary buffer using unpdf.
 * Reconstructs lines and word spacing using spatial coordinates for layout accuracy.
 */
export async function extractPdfText(
  data: Uint8Array | ArrayBuffer
): Promise<ExtractedPdfDocument> {
  const warnings: string[] = []
  const u8Array = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0))

  if (u8Array.byteLength < 8) {
    return {
      totalPages: 0,
      pages: [],
      fullText: '',
      isScannedOrImageOnly: false,
      warnings: [],
      error: 'File is empty or too small to be a valid PDF document.',
    }
  }

  // Verify %PDF- signature in first 1024 bytes
  const headerCheck = new TextDecoder('utf-8').decode(u8Array.slice(0, 1024))
  if (!headerCheck.includes('%PDF-')) {
    return {
      totalPages: 0,
      pages: [],
      fullText: '',
      isScannedOrImageOnly: false,
      warnings: [],
      error: 'File lacks a valid PDF header (%PDF-). File may be corrupted or not a PDF.',
    }
  }

  try {
    // Attempt coordinate-based structured item extraction first for high fidelity
    let pageItemsResult: Awaited<ReturnType<typeof extractTextItems>> | null = null
    try {
      pageItemsResult = await extractTextItems(u8Array)
    } catch {
      // Fall back to basic text extraction below if items extraction fails
      pageItemsResult = null
    }

    const pages: ExtractedPdfPage[] = []
    let totalSelectableLength = 0

    if (pageItemsResult && pageItemsResult.items && pageItemsResult.items.length > 0) {
      const totalPages = pageItemsResult.totalPages || pageItemsResult.items.length

      for (let p = 0; p < totalPages; p++) {
        const pageNum = p + 1
        const items = pageItemsResult.items[p] || []

        // Group text items by Y coordinate (within 4 points threshold)
        const lineGroups: { y: number; words: { x: number; str: string }[] }[] = []
        for (const item of items) {
          if (!item.str || item.str.trim() === '') continue
          let group = lineGroups.find((g) => Math.abs(g.y - item.y) <= 4)
          if (!group) {
            group = { y: item.y, words: [] }
            lineGroups.push(group)
          }
          group.words.push({ x: item.x, str: item.str })
        }

        // Sort lines top-to-bottom (Y descending in PDF coordinate space)
        lineGroups.sort((a, b) => b.y - a.y)

        // Sort words left-to-right (X ascending) and join with space
        const reconstructedLines = lineGroups.map((group) => {
          group.words.sort((a, b) => a.x - b.x)
          return group.words.map((w) => w.str.replace(/\u0000/g, ':')).join(' ').trim()
        }).filter((l) => l.length > 0)

        const rawText = reconstructedLines.join('\n')
        const trimmed = rawText.trim()
        const hasSelectableText = trimmed.length > 0

        if (hasSelectableText) {
          totalSelectableLength += trimmed.length
        } else {
          warnings.push(`Page ${pageNum} has no selectable text (may be blank or an image-only scan).`)
        }

        pages.push({
          pageNumber: pageNum,
          text: rawText,
          lineCount: reconstructedLines.length,
          hasSelectableText,
        })
      }
    } else {
      // Fallback: standard stream text extraction
      const result = await extractText(u8Array, { mergePages: false })
      const pageTexts = Array.isArray(result.text) ? result.text : [result.text]

      for (let i = 0; i < pageTexts.length; i++) {
        const pageNum = i + 1
        const rawText = pageTexts[i] || ''
        const trimmed = rawText.trim()
        const hasSelectableText = trimmed.length > 0
        const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0)

        if (hasSelectableText) {
          totalSelectableLength += trimmed.length
        } else {
          warnings.push(`Page ${pageNum} has no selectable text (may be blank or an image-only scan).`)
        }

        pages.push({
          pageNumber: pageNum,
          text: rawText,
          lineCount: lines.length,
          hasSelectableText,
        })
      }
    }

    const isScannedOrImageOnly = pages.length > 0 && totalSelectableLength === 0
    if (isScannedOrImageOnly) {
      warnings.push(
        'Scanned or image-only PDF detected. This document contains no machine-readable text stream. Optical character recognition (OCR) or an original digital statement export is required.'
      )
    }

    const fullText = pages.map((p) => p.text).join('\n')

    return {
      totalPages: pages.length,
      pages,
      fullText,
      isScannedOrImageOnly,
      warnings,
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err)
    if (errMsg.toLowerCase().includes('password') || errMsg.toLowerCase().includes('encrypted')) {
      return {
        totalPages: 0,
        pages: [],
        fullText: '',
        isScannedOrImageOnly: false,
        warnings: [],
        error: 'Password-protected PDF statements cannot be parsed. Please unlock or re-export the statement without a password before importing.',
      }
    }

    return {
      totalPages: 0,
      pages: [],
      fullText: '',
      isScannedOrImageOnly: false,
      warnings: [],
      error: `Failed to extract PDF text: ${errMsg}`,
    }
  }
}
