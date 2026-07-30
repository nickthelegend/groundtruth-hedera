import type { ProofSpec, ProofPayload, NotaryVerdict, NotaryCheck } from './types'
import { verifyImageMatchesIntent, extractJson } from './groq-vision'

// The Notary: semantic judgment of proof-vs-intent — the real accept gate that
// turns "any image / any form pays" into genuine content verification.
//
//   photo → a vision model (Gemini via VISION_*) judges whether the image shows
//           the task being done.
//   form  → a text LLM (Groq via FORM_JUDGE_* / GROQ_API_KEY) judges whether the
//           answer plausibly satisfies the task.
//
// Fails toward the worker: only a CONFIDENT mismatch rejects. Anything the model
// is unsure about — or any API failure / missing key — returns 'uncertain', which
// the caller treats as accept-but-flag. An honest worker is never denied pay
// because our model hiccuped; only a blatant mismatch is stopped.

const REJECT_CONFIDENCE = Number(process.env.NOTARY_REJECT_CONFIDENCE ?? '0.6')

const FORM_API_URL = process.env.FORM_JUDGE_API_URL ?? 'https://api.groq.com/openai/v1/chat/completions'
const FORM_API_KEY = process.env.FORM_JUDGE_API_KEY ?? process.env.GROQ_API_KEY
const FORM_MODEL = process.env.FORM_JUDGE_MODEL ?? 'llama-3.3-70b-versatile'

const uncertain = (mode: 'photo' | 'form', reason: string): NotaryVerdict => ({
  decision: 'uncertain', confidence: 0, reason, checked: false, mode,
})

// Cache real verdicts by (image + intent + challenge) so a refresh/retry of the
// SAME proof doesn't burn another vision call. Only successful ("checked")
// verdicts are cached — an errored/rate-limited result is never cached, so a
// retry after the quota resets re-attempts. Bounded to avoid unbounded growth.
const verdictCache = new Map<string, NotaryVerdict>()
const CACHE_MAX = 200
function cacheGet(key: string): NotaryVerdict | undefined { return verdictCache.get(key) }
function cacheSet(key: string, v: NotaryVerdict): void {
  if (!v.checked) return
  if (verdictCache.size >= CACHE_MAX) verdictCache.delete(verdictCache.keys().next().value as string)
  verdictCache.set(key, v)
}

async function buildDataUrl(buf: Buffer): Promise<string> {
  try {
    const sharp = (await import('sharp')).default
    const fmt = (await sharp(buf).metadata()).format ?? 'jpeg'
    return `data:image/${fmt};base64,${buf.toString('base64')}`
  } catch {
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  }
}

export async function notaryReview(
  intent: string,
  spec: ProofSpec,
  payload: ProofPayload,
  imageBuffers: Buffer[] = []
): Promise<NotaryVerdict> {
  if (spec.type === 'photo') return reviewPhoto(intent, imageBuffers, spec.challenge)
  return reviewForm(intent, spec, payload)
}

async function reviewPhoto(intent: string, imageBuffers: Buffer[], challenge?: string): Promise<NotaryVerdict> {
  if (!imageBuffers.length) return uncertain('photo', 'no image to review')

  const { createHash } = await import('crypto')
  const cacheKey = createHash('sha256').update(imageBuffers[0]).update(`|${intent}|${challenge ?? ''}`).digest('hex')
  const hit = cacheGet(cacheKey)
  if (hit) return hit

  const dataUrl = await buildDataUrl(imageBuffers[0])
  const v = await verifyImageMatchesIntent(dataUrl, intent, challenge)
  if (!v.checked) return uncertain('photo', v.reason) // not cached → retry re-attempts

  const subjectOk = v.match
  const challengeOk = !challenge || !!v.challengeFound
  const checks: NotaryCheck[] = [{ label: 'Subject matches the task', passed: subjectOk }]
  if (challenge) checks.push({ label: `Freshness code ${challenge} visible in photo`, passed: challengeOk })
  checks.push({ label: `Confidence ${Math.round(v.confidence * 100)}%`, passed: true })

  let verdict: NotaryVerdict
  if (subjectOk && challengeOk) {
    verdict = { decision: 'accept', confidence: v.confidence, reason: v.reason, checked: true, mode: 'photo', checks }
  } else {
    // Subject mismatch OR missing freshness code → both are strong fraud signals.
    const reason = !challengeOk ? `Freshness code "${challenge}" was not visible in the photo` : v.reason
    const conf = !challengeOk ? Math.max(v.confidence, 0.9) : v.confidence
    verdict = {
      decision: conf >= REJECT_CONFIDENCE ? 'reject' : 'uncertain',
      confidence: conf, reason, checked: true, mode: 'photo', checks,
    }
  }
  cacheSet(cacheKey, verdict)
  return verdict
}

async function reviewForm(intent: string, spec: ProofSpec, payload: ProofPayload): Promise<NotaryVerdict> {
  const fields = payload.formData ?? {}
  const challenge = spec.challenge

  // Deterministic freshness gate FIRST — a plain string match, no API dependency.
  // A missing reference code is a hard reject even if the LLM judge is unavailable,
  // so freshness never fails open.
  if (challenge) {
    const joined = Object.values(fields).join(' ').toUpperCase()
    if (!joined.includes(challenge.toUpperCase())) {
      return {
        decision: 'reject', confidence: 0.95,
        reason: `Reference code "${challenge}" was not included`,
        checked: true, mode: 'form',
        checks: [{ label: `Reference code ${challenge} included`, passed: false }],
      }
    }
  }

  const key = FORM_API_KEY
  if (!key || key.startsWith('REPLACE')) return uncertain('form', 'form judge skipped — no key')

  try {
    const res = await fetch(FORM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: FORM_MODEL,
        messages: [{
          role: 'user',
          content:
            `A person was asked to complete this real-world task: "${intent}".\n` +
            (spec.instructions ? `Instructions: "${spec.instructions}".\n` : '') +
            `They submitted this form data as proof:\n${JSON.stringify(fields)}\n` +
            `Does this plausibly and meaningfully satisfy the task? Reject ONLY if it is clearly ` +
            `irrelevant, empty of meaning, placeholder/gibberish, or self-contradictory. Be lenient ` +
            `on exact values you cannot independently verify.\n` +
            `Respond ONLY as JSON: {"satisfies": true|false, "confidence": 0.0-1.0, "reason": "one short sentence"}`,
        }],
        temperature: 0,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return uncertain('form', `form judge unavailable (HTTP ${res.status})`)
    const json = await res.json()
    const content = json.choices?.[0]?.message?.content
    if (!content) return uncertain('form', 'form judge returned no content')

    const parsed = extractJson(content)
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    const reason = String(parsed.reason ?? '').slice(0, 200)

    // Freshness already passed the deterministic gate above, so only the
    // "satisfies the task" judgment remains.
    const satisfiesOk = !!parsed.satisfies
    const checks: NotaryCheck[] = [{ label: 'Answer satisfies the task', passed: satisfiesOk }]
    if (challenge) checks.push({ label: `Reference code ${challenge} included`, passed: true })
    checks.push({ label: `Confidence ${Math.round(confidence * 100)}%`, passed: true })

    if (satisfiesOk) {
      return { decision: 'accept', confidence, reason, checked: true, mode: 'form', checks }
    }
    return {
      decision: confidence >= REJECT_CONFIDENCE ? 'reject' : 'uncertain',
      confidence, reason, checked: true, mode: 'form', checks,
    }
  } catch {
    return uncertain('form', 'form judge error')
  }
}
