import { createWorker } from 'tesseract.js'
import { parseReceiptText, createDraftFromParsedData } from './receiptParser'
import type { ExtractionResult } from '../types/receipt'

export type OcrProgressCallback = (progress: number, status: string) => void

/**
 * Genuine client-side OCR engine using Tesseract.js.
 * Runs 100% in the user's browser with WebAssembly & Web Workers.
 * Zero external API keys, zero cloud costs, 100% private.
 */
export async function performClientOcr(
  imageSource: string | File,
  onProgress?: OcrProgressCallback
): Promise<ExtractionResult> {
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null

  try {
    if (onProgress) {
      onProgress(0.1, 'Initializing OCR engine...')
    }

    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(0.2 + m.progress * 0.7, `Reading image text... (${Math.round(m.progress * 100)}%)`)
        }
      },
    })

    if (onProgress) {
      onProgress(0.3, 'Scanning pixels & characters...')
    }

    const ret = await worker.recognize(imageSource)
    const rawText = ret.data.text

    if (onProgress) {
      onProgress(0.95, 'Parsing financial fields & reference IDs...')
    }

    // Pass the real extracted text to the Indian financial parser
    const parsed = parseReceiptText(rawText)

    const draft = createDraftFromParsedData(
      parsed,
      typeof imageSource === 'string' ? imageSource : undefined
    )

    if (onProgress) {
      onProgress(1.0, 'Extraction complete!')
    }

    return {
      success: true,
      draft,
    }
  } catch (err) {
    console.error('Tesseract OCR error:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'OCR failed to process image',
    }
  } finally {
    if (worker) {
      try {
        await worker.terminate()
      } catch {
        // ignore termination cleanup
      }
    }
  }
}
