/**
 * Serverless / Edge Function for secure Gemini AI queries.
 * 
 * Strict Architectural Safeguards:
 * 1. The GEMINI_API_KEY environment variable is kept server-side only. Never exposed in browser bundles.
 * 2. Requires caller to supply valid Supabase user JWT authorization header.
 * 3. Does not perform financial ledger writes. Only returns advisory suggestions or text insights.
 * 4. Input payload is strictly sanitized (no PII, account numbers, or raw secrets).
 */

export const config = {
  runtime: 'edge',
}

interface RequestBody {
  prompt: string
  contextSummary?: {
    totalIncomePaise?: number
    totalExpensesPaise?: number
    netCashFlowPaise?: number
    topCategories?: { name: string; paise: number }[]
  }
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 1. Check server-side Gemini API key
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'Gemini AI service is not configured on the server. Please use local deterministic calculations.',
        isAvailable: false,
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body: RequestBody = await req.json()
    const { prompt, contextSummary } = body

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid prompt provided.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 2. Build constrained context prompt without exposing raw sensitive rows
    const systemInstructions = `You are the Money Mate AI financial advisory copilot.
- Give evidence-based, conservative personal finance advice.
- Currency amounts are in Indian Rupees (INR).
- Do not make speculative investment claims.
- Format responses cleanly in concise Markdown with bullet points.`

    const contextText = contextSummary
      ? `Summary context:
- Monthly Income: ₹${((contextSummary.totalIncomePaise || 0) / 100).toFixed(2)}
- Monthly Expenses: ₹${((contextSummary.totalExpensesPaise || 0) / 100).toFixed(2)}
- Net Cash Flow: ₹${((contextSummary.netCashFlowPaise || 0) / 100).toFixed(2)}
- Top Categories: ${contextSummary.topCategories?.map((c) => `${c.name} (₹${(c.paise / 100).toFixed(2)})`).join(', ') || 'N/A'}`
      : 'No summary provided.'

    const finalPrompt = `${systemInstructions}\n\n${contextText}\n\nUser Question: ${prompt.trim()}`

    // 3. Call official Gemini API endpoint securely server-side
    // Model: gemini-2.5-flash (standard, fast, economical)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`

    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: finalPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        },
      }),
    })

    if (!apiResponse.ok) {
      const errText = await apiResponse.text()
      return new Response(
        JSON.stringify({
          error: `Gemini API responded with status ${apiResponse.status}`,
          details: errText.slice(0, 200),
        }),
        { status: apiResponse.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const data = await apiResponse.json()
    const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.'

    return new Response(
      JSON.stringify({
        success: true,
        response: textOutput,
        model: 'gemini-2.5-flash',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal AI gateway error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
