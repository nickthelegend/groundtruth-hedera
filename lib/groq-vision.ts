import type { VisionResult } from './types'

// Real AI-vision content check: does the submitted photo actually show what the
// task asked for? Uses a Groq vision model. This is ADVISORY — a mismatch flags
// a red alert on the result but never blocks settlement (hackathon flow keeps
// moving). It also fails OPEN: any error/missing key → checked:false, match:true,
// so verification never breaks on an infra hiccup.

// Provider-flexible: any OpenAI-compatible vision endpoint works via env —
// Groq (Llama-4), OpenAI (gpt-4o-mini), OpenRouter, Gemini's OpenAI shim, etc.
//
// RESILIENCE (no code change — all via env):
//  - VISION_API_KEY may be a COMMA-SEPARATED list of keys for the same endpoint;
//    on a 429/rate-limit we rotate to the next key.
//  - VISION_FALLBACK is an optional JSON array of extra providers
//    [{"url","key","model"}] tried in order if the primary provider fails.
// So a rate-limited or down vendor rotates/falls back automatically.
const DEFAULT_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = process.env.VISION_MODEL ?? process.env.GROQ_VISION_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct'
const MAX_TOKENS = Number(process.env.VISION_MAX_TOKENS ?? '1200')

interface VisionProvider { url: string; key: string; model: string }

function visionProviders(): VisionProvider[] {
  const out: VisionProvider[] = []
  const url = process.env.VISION_API_URL ?? DEFAULT_URL
  const keys = (process.env.VISION_API_KEY ?? process.env.GROQ_API_KEY ?? '')
    .split(',').map(k => k.trim()).filter(k => k && !k.startsWith('REPLACE'))
  for (const key of keys) out.push({ url, key, model: DEFAULT_MODEL })
  try {
    const extra = JSON.parse(process.env.VISION_FALLBACK ?? '[]') as VisionProvider[]
    for (const p of extra) if (p?.url && p?.key) out.push({ url: p.url, key: p.key, model: p.model ?? DEFAULT_MODEL })
  } catch { /* ignore malformed fallback config */ }
  return out
}

const skipped = (reason: string): VisionResult => ({ checked: false, match: true, confidence: 0, reason })

// Providers differ: some return raw JSON, Gemini wraps it in ```json fences and
// may add prose. Extract the first {...} object robustly.
export function extractJson(s: string): any {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no json object in response')
  return JSON.parse(body.slice(start, end + 1))
}

export async function verifyImageMatchesIntent(dataUrl: string, intent: string, challenge?: string): Promise<VisionResult> {
  const providers = visionProviders()
  if (!providers.length) return skipped('vision skipped — no vision API key')

  const prompt =
    `A person was asked to complete this real-world task: "${intent}".\n` +
    `Look at the image they submitted as proof. Does its CONTENT plausibly show that task being done?\n` +
    `Judge the subject matter only — be lenient on framing, quality, and medium (photo, ` +
    `screenshot, or graphic all count). Reject only if the content clearly does not match the task.\n` +
    (challenge
      ? `ALSO: a freshness code was issued for this task. Is the exact text "${challenge}" clearly ` +
        `written or visible somewhere in the image (e.g. on a note held in frame)? Set "challenge_visible" accordingly.\n`
      : '') +
    `Respond ONLY as JSON: {"match": true|false, ${challenge ? '"challenge_visible": true|false, ' : ''}"confidence": 0.0-1.0, "reason": "one short sentence"}`

  let lastReason = 'vision unavailable'
  // Try each provider/key in order; rotate on rate-limit / server / network error.
  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
          temperature: 0,
          max_tokens: MAX_TOKENS,
        }),
        signal: AbortSignal.timeout(20_000),
      })

      if (!res.ok) {
        lastReason = `vision unavailable (HTTP ${res.status})`
        if (res.status === 429 || res.status >= 500) continue // rotate to next key/provider
        return skipped(lastReason) // 4xx (bad key/request) — rotating won't help
      }
      const json = await res.json()
      const content = json.choices?.[0]?.message?.content
      if (!content) { lastReason = 'vision returned no content'; continue }

      const parsed = extractJson(content)
      return {
        checked: true,
        match: !!parsed.match,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: String(parsed.reason ?? '').slice(0, 200),
        challengeFound: challenge ? !!parsed.challenge_visible : undefined,
      }
    } catch {
      lastReason = 'vision error (network/timeout)'
      continue // try next provider
    }
  }
  return skipped(lastReason)
}
