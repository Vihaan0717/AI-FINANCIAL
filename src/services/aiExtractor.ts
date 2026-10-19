import type {
  ReceiptExtractionDraft,
  ExtractionResult,
  ExtractedReceiptItem,
} from '../types/receipt'
import { performClientOcr, type OcrProgressCallback } from './tesseractOcr'
import { extractWithGeminiVision } from './geminiVision'

export interface IReceiptExtractor {
  extractFromImage(file: File, onProgress?: OcrProgressCallback): Promise<ExtractionResult>
}

/**
 * Intelligent Unified Extractor Engine.
 * 
 * 1. Checks if user configured a Gemini Vision API Key in Settings. If present, calls Gemini Vision.
 * 2. Defaults to genuine client-side Tesseract.js OCR (100% free, WebAssembly, running locally in-browser).
 * 3. Falls back gracefully with user-inspectable error details.
 */
export class ClientReceiptExtractor implements IReceiptExtractor {
  async extractFromImage(
    file: File,
    onProgress?: OcrProgressCallback
  ): Promise<ExtractionResult> {
    const dataUrl = await this.readFileAsDataUrl(file)

    // Check for optional Gemini API key
    let geminiKey = ''
    if (typeof window !== 'undefined') {
      geminiKey = localStorage.getItem('moneymate_gemini_api_key') || ''
    }

    if (geminiKey.trim()) {
      if (onProgress) onProgress(0.3, 'Connecting to Gemini Vision model...')
      const base64Data = dataUrl.split(',')[1]
      const mimeType = file.type || 'image/jpeg'
      const geminiResult = await extractWithGeminiVision(base64Data, mimeType, geminiKey)
      if (geminiResult.success && geminiResult.draft) {
        geminiResult.draft.rawImagePreview = dataUrl
        if (onProgress) onProgress(1.0, 'Gemini extraction complete!')
        return geminiResult
      }
      console.warn('Gemini vision extraction failed, falling back to client-side Tesseract OCR:', geminiResult.error)
    }

    // Default: Genuine Client-Side Tesseract OCR
    const ocrResult = await performClientOcr(file, onProgress)
    if (ocrResult.success && ocrResult.draft) {
      ocrResult.draft.rawImagePreview = dataUrl
      return ocrResult
    }

    // If OCR returned empty text (e.g. pure graphic or low contrast), generate an unverified draft for user review
    return {
      success: true,
      draft: {
        id: `draft-${Date.now()}`,
        docType: 'unknown',
        totalAmountPaise: 0,
        currency: 'INR',
        date: new Date().toISOString(),
        merchant: 'Unverified Merchant',
        paymentMethod: 'UPI',
        category: 'Shopping',
        description: 'Uploaded receipt',
        status: 'completed',
        confidenceScore: 0.3,
        warnings: [
          'OCR could not detect sharp text in this image. Please review and enter details manually.',
        ],
        rawImagePreview: dataUrl,
      },
    }
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read image file'))
      reader.readAsDataURL(file)
    })
  }

  /**
   * Supermarket itemized receipt preset
   */
  createItemizedReceiptDraft(dataUrl?: string): ReceiptExtractionDraft {
    const items: ExtractedReceiptItem[] = [
      {
        id: 'item-1',
        name: 'Bathing Soap (Pack of 2)',
        quantity: 2,
        unit: 'bars',
        unitPricePaise: 3000,
        totalPricePaise: 6000,
        category: 'Personal care and other essentials',
        suggestedInventoryCategory: 'Personal care and other essentials',
        confidence: 'high',
      },
      {
        id: 'item-2',
        name: 'Laundry Detergent 1kg',
        quantity: 1,
        unit: 'packs',
        unitPricePaise: 12000,
        totalPricePaise: 12000,
        category: 'Household essentials',
        suggestedInventoryCategory: 'Household essentials',
        confidence: 'high',
      },
      {
        id: 'item-3',
        name: 'Herbal Toothpaste 150g',
        quantity: 1,
        unit: 'tubes',
        unitPricePaise: 9000,
        totalPricePaise: 9000,
        category: 'Personal care and other essentials',
        suggestedInventoryCategory: 'Personal care and other essentials',
        confidence: 'high',
      },
    ]

    return {
      id: `draft-${Date.now()}`,
      docType: 'itemized_receipt',
      totalAmountPaise: 27000,
      currency: 'INR',
      date: new Date().toISOString(),
      merchant: 'FreshMart Supermarket',
      paymentMethod: 'UPI',
      category: 'Groceries',
      description: 'Supermarket essentials (3 items)',
      status: 'completed',
      externalRef: `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`,
      confidenceScore: 0.94,
      warnings: [],
      items,
      rawImagePreview: dataUrl,
    }
  }

  /**
   * UPI payment screenshot preset
   */
  createUpiPaymentDraft(dataUrl?: string, customName?: string): ReceiptExtractionDraft {
    const isCoffee = customName?.toLowerCase().includes('coffee')
    const amount = isCoffee ? 15000 : 25000
    const merchant = isCoffee ? 'Blue Tokai Coffee Roasters' : 'Local Merchant'
    const category = isCoffee ? 'Food & dining' : 'Shopping'
    const ref = `UPI/${new Date().getFullYear()}${Math.floor(10000000 + Math.random() * 90000000)}`

    return {
      id: `draft-${Date.now()}`,
      docType: 'payment_screenshot',
      totalAmountPaise: amount,
      currency: 'INR',
      date: new Date().toISOString(),
      merchant,
      paymentMethod: 'UPI',
      category,
      description: `Payment to ${merchant}`,
      status: 'completed',
      externalRef: ref,
      confidenceScore: 0.96,
      warnings: [],
      rawImagePreview: dataUrl,
    }
  }

  /**
   * Failed payment screenshot preset
   */
  createFailedPaymentDraft(dataUrl?: string): ReceiptExtractionDraft {
    return {
      id: `draft-${Date.now()}`,
      docType: 'payment_screenshot',
      totalAmountPaise: 50000,
      currency: 'INR',
      date: new Date().toISOString(),
      merchant: 'Online Retailer',
      paymentMethod: 'Card',
      category: 'Shopping',
      description: 'Declined card payment',
      status: 'failed',
      externalRef: 'TXN-FAIL-88219',
      confidenceScore: 0.88,
      warnings: [
        'Payment status is marked as FAILED in screenshot. This entry will not affect confirmed financial balances unless corrected.',
      ],
      rawImagePreview: dataUrl,
    }
  }
}

export function getReceiptExtractor(): IReceiptExtractor {
  return new ClientReceiptExtractor()
}
