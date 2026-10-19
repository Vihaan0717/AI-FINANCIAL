import type { ExtractionResult, ReceiptExtractionDraft, ExtractedReceiptItem } from '../types/receipt'
import { rupeesToPaise } from '../utils/money'

export async function extractWithGeminiVision(
  base64Data: string,
  mimeType: string,
  apiKey: string
): Promise<ExtractionResult> {
  const prompt = `Analyze this Indian payment screenshot or shopping receipt image and extract structured financial details in JSON.
Output ONLY valid JSON with no markdown backticks, conforming to:
{
  "docType": "payment_screenshot" or "itemized_receipt",
  "totalAmountRupees": 270.00,
  "merchant": "Store or Payee name",
  "date": "YYYY-MM-DDTHH:mm:ssZ",
  "paymentMethod": "UPI" or "Card" or "Bank transfer" or "Cash" or "Other",
  "status": "completed" or "pending" or "failed",
  "category": "Groceries" or "Food & dining" or "Shopping" or "Home" or "Transport" or "Utilities" or "Health" or "Other",
  "externalRef": "UPI UTR or Txn ID if visible",
  "description": "Short summary",
  "confidenceScore": 0.95,
  "items": [
    {
      "name": "Item name",
      "quantity": 1,
      "priceRupees": 50.00,
      "suggestedInventoryCategory": "Essentials" or "Clothing" or "Home" or "Other"
    }
  ]
}`

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey.trim()}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Data } },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1,
        },
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errBody}`)
    }

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rawText) {
      throw new Error('No extraction response from Gemini model')
    }

    const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleanJson)

    const items: ExtractedReceiptItem[] = (parsed.items || []).map((it: { name: string; quantity: number; priceRupees: number; suggestedInventoryCategory?: string }, idx: number) => ({
      id: `item-${idx + 1}`,
      name: it.name || `Item ${idx + 1}`,
      quantity: Number(it.quantity) || 1,
      unitPricePaise: Math.round((Number(it.priceRupees) || 0) * 100),
      totalPricePaise: Math.round((Number(it.priceRupees) || 0) * (Number(it.quantity) || 1) * 100),
      category: parsed.category || 'Groceries',
      suggestedInventoryCategory: (it.suggestedInventoryCategory as ExtractedReceiptItem['suggestedInventoryCategory']) || 'Essentials',
    }))

    const draft: ReceiptExtractionDraft = {
      id: `draft-${Date.now()}`,
      docType: parsed.docType || (items.length > 0 ? 'itemized_receipt' : 'payment_screenshot'),
      totalAmountPaise: rupeesToPaise(Number(parsed.totalAmountRupees) || 0),
      currency: 'INR',
      date: parsed.date || new Date().toISOString(),
      merchant: parsed.merchant || 'Merchant',
      paymentMethod: parsed.paymentMethod || 'UPI',
      externalRef: parsed.externalRef,
      status: parsed.status === 'failed' ? 'failed' : parsed.status === 'pending' ? 'pending' : 'completed',
      category: parsed.category || 'Shopping',
      description: parsed.description || `Payment to ${parsed.merchant || 'merchant'}`,
      confidenceScore: Math.min(0.99, Number(parsed.confidenceScore) || 0.95),
      warnings: [],
      items: items.length > 0 ? items : undefined,
    }

    return {
      success: true,
      draft,
    }
  } catch (err) {
    console.error('Gemini vision extraction error:', err)
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gemini Vision extraction failed',
    }
  }
}
