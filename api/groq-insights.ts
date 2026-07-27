import { proxyGroqInsights } from './_groqProxy'

/** Vercel Node serverless function — see api/_groqProxy.ts for why this exists. */
export default async function handler(
  req: { method?: string; body?: { system?: string; snapshot?: unknown } },
  res: { status: (code: number) => typeof res; setHeader: (name: string, value: string) => typeof res; end: (body?: string) => void },
) {
  if (req.method !== 'POST') {
    res.status(405).end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const { system, snapshot } = req.body ?? {}
  if (!system || !snapshot) {
    res.status(400).end(JSON.stringify({ error: 'Missing system prompt or snapshot.' }))
    return
  }

  const { status, body } = await proxyGroqInsights(
    system,
    snapshot,
    process.env.GROQ_API_KEY,
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  )
  res.status(status).setHeader('Content-Type', 'application/json').end(body)
}
