/**
 * Shared by the Vercel serverless function (api/groq-insights.ts, used in
 * production) and the Vite dev-server middleware (vite.config.ts, used by
 * `pnpm dev`) so the Groq call — and the API key — only ever happen
 * server-side. The key must never reach the client bundle: anything
 * prefixed VITE_ gets inlined into shipped JS and is publicly readable.
 */
export async function proxyGroqInsights(
  system: string,
  snapshot: unknown,
  apiKey: string | undefined,
  model: string,
): Promise<{ status: number; body: string }> {
  if (!apiKey) {
    return { status: 501, body: JSON.stringify({ error: 'GROQ_API_KEY is not configured on the server.' }) }
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(snapshot) },
      ],
    }),
  })

  return { status: res.status, body: await res.text() }
}
