import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import type { ProofSpec, ProofPayload } from '../lib/types'

// The notary is the gate that decides whether money moves, so its decision
// logic is tested exhaustively and offline. The model calls themselves are
// stubbed — what matters here is what we DO with a given model answer, not
// whether the model is any good.

process.env.NOTARY_REJECT_CONFIDENCE = '0.6'
process.env.GROQ_API_KEY = 'test-key'

const verifyImageMatchesIntent = vi.fn()
vi.mock('@/lib/groq-vision', async () => {
  const actual = await vi.importActual<typeof import('../lib/groq-vision')>('../lib/groq-vision')
  return { verifyImageMatchesIntent, extractJson: actual.extractJson }
})

const { notaryReview } = await import('../lib/notary')

const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
})

/** Stub the form judge (an OpenAI-compatible chat completion). */
function mockFormJudge(answer: object, ok = true, status = 200) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), {
      status: ok ? status : status,
    })
  ) as unknown as typeof fetch
}

const photoSpec = (challenge?: string): ProofSpec => ({
  type: 'photo',
  instructions: 'Photo of the entrance',
  minPhotos: 1,
  challenge,
})

const formSpec = (challenge?: string): ProofSpec => ({
  type: 'form',
  instructions: 'Report the opening hours',
  formFields: ['hours'],
  challenge,
})

const formPayload = (fields: Record<string, string>): ProofPayload => ({
  type: 'form',
  formData: fields,
  submittedAt: new Date().toISOString(),
})

const photoPayload: ProofPayload = {
  type: 'photo',
  storageKeys: ['task/0-abc.jpg'],
  submittedAt: new Date().toISOString(),
}

// The notary caches verdicts by (image + intent + challenge), so every case
// needs its own image — otherwise a later test reads an earlier test's verdict.
// (The cache itself is covered explicitly below.)
let imgSeq = 0
const IMG = () => [Buffer.from(`fake-image-bytes-${++imgSeq}-${Date.now()}`)]

beforeEach(() => {
  verifyImageMatchesIntent.mockReset()
  globalThis.fetch = realFetch
})

describe('notary — photo proofs', () => {
  it('accepts when the subject matches and the freshness code is visible', async () => {
    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: true, confidence: 0.93, reason: 'entrance visible', challengeFound: true,
    })
    const v = await notaryReview('Photo the entrance', photoSpec('AB12CD'), photoPayload, IMG())
    expect(v.decision).toBe('accept')
    expect(v.checked).toBe(true)
  })

  it('rejects a confident subject mismatch', async () => {
    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: false, confidence: 0.95, reason: 'photo of a blank wall', challengeFound: true,
    })
    const v = await notaryReview('Photo the entrance', photoSpec('AB12CD'), photoPayload, IMG())
    expect(v.decision).toBe('reject')
  })

  it('does NOT reject a low-confidence mismatch — it abstains', async () => {
    // Below the reject threshold the worker gets the benefit of the doubt; the
    // task is flagged rather than failed.
    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: false, confidence: 0.3, reason: 'unclear', challengeFound: true,
    })
    const v = await notaryReview('Photo the entrance', photoSpec('AB12CD'), photoPayload, IMG())
    expect(v.decision).toBe('uncertain')
  })

  it('rejects a matching photo that is missing the freshness code', async () => {
    // The anti-replay signal: right subject, but it could be a stock image.
    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: true, confidence: 0.9, reason: 'looks right', challengeFound: false,
    })
    const v = await notaryReview('Photo the entrance', photoSpec('AB12CD'), photoPayload, IMG())
    expect(v.decision).toBe('reject')
    expect(v.reason).toMatch(/AB12CD/)
    expect(v.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it('ignores the freshness check when the task carries no code', async () => {
    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: true, confidence: 0.8, reason: 'ok', challengeFound: false,
    })
    const v = await notaryReview('Photo the entrance', photoSpec(undefined), photoPayload, IMG())
    expect(v.decision).toBe('accept')
  })

  it('abstains — never rejects — when the vision model could not run', async () => {
    // An outage must not fail an honest worker. The caller holds the task.
    verifyImageMatchesIntent.mockResolvedValue({
      checked: false, match: true, confidence: 0, reason: 'vision unavailable (HTTP 429)',
    })
    const v = await notaryReview('Photo the entrance', photoSpec('AB12CD'), photoPayload, IMG())
    expect(v.decision).toBe('uncertain')
    expect(v.checked).toBe(false)
  })

  it('abstains when there is no image to look at', async () => {
    const v = await notaryReview('Photo the entrance', photoSpec('AB12CD'), photoPayload, [])
    expect(v.decision).toBe('uncertain')
    expect(verifyImageMatchesIntent).not.toHaveBeenCalled()
  })

  it('caches a verdict so a retry of the same image does not re-bill the model', async () => {
    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: true, confidence: 0.9, reason: 'ok', challengeFound: true,
    })
    const unique = [Buffer.from(`cache-probe-${Date.now()}`)]
    await notaryReview('Photo the entrance', photoSpec('ZZ99'), photoPayload, unique)
    await notaryReview('Photo the entrance', photoSpec('ZZ99'), photoPayload, unique)
    expect(verifyImageMatchesIntent).toHaveBeenCalledOnce()
  })

  it('does NOT cache a failed check, so a retry re-attempts', async () => {
    verifyImageMatchesIntent.mockResolvedValue({
      checked: false, match: true, confidence: 0, reason: 'rate limited',
    })
    const unique = [Buffer.from(`nocache-probe-${Date.now()}`)]
    await notaryReview('Photo the entrance', photoSpec('YY88'), photoPayload, unique)
    await notaryReview('Photo the entrance', photoSpec('YY88'), photoPayload, unique)
    expect(verifyImageMatchesIntent).toHaveBeenCalledTimes(2)
  })
})

describe('notary — form proofs', () => {
  it('rejects a missing freshness code without calling the model at all', async () => {
    // Deterministic gate: freshness must not depend on an API being up.
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: '9-5' }))
    expect(v.decision).toBe('reject')
    expect(v.checked).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('matches the freshness code case-insensitively', async () => {
    mockFormJudge({ satisfies: true, confidence: 0.9, reason: 'plausible' })
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: '9-5 ab12cd' }))
    expect(v.decision).toBe('accept')
  })

  it('accepts an answer the judge finds plausible', async () => {
    mockFormJudge({ satisfies: true, confidence: 0.88, reason: 'specific hours given' })
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: 'Open 8-6. AB12CD' }))
    expect(v.decision).toBe('accept')
    expect(v.confidence).toBeCloseTo(0.88)
  })

  it('rejects a confidently unsatisfactory answer', async () => {
    mockFormJudge({ satisfies: false, confidence: 0.9, reason: 'gibberish' })
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: 'asdf AB12CD' }))
    expect(v.decision).toBe('reject')
  })

  it('abstains on a low-confidence rejection', async () => {
    mockFormJudge({ satisfies: false, confidence: 0.2, reason: 'not sure' })
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: 'maybe AB12CD' }))
    expect(v.decision).toBe('uncertain')
  })

  it('abstains when the judge endpoint errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: 'AB12CD 9-5' }))
    expect(v.decision).toBe('uncertain')
    expect(v.checked).toBe(false)
  })

  it('abstains when the judge returns unparseable content', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 })
    ) as unknown as typeof fetch
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: 'AB12CD' }))
    expect(v.decision).toBe('uncertain')
  })

  it('clamps a confidence the model reports out of range', async () => {
    mockFormJudge({ satisfies: true, confidence: 42, reason: 'over-confident' })
    const v = await notaryReview('Report hours', formSpec('AB12CD'), formPayload({ hours: 'AB12CD 9-5' }))
    expect(v.confidence).toBeLessThanOrEqual(1)
    expect(v.confidence).toBeGreaterThanOrEqual(0)
  })
})

describe('notary — reject threshold is configurable', () => {
  it('treats NOTARY_REJECT_CONFIDENCE as the accept/abstain boundary', async () => {
    // 0.6 is the configured threshold: 0.6 rejects, 0.59 abstains.
    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: false, confidence: 0.6, reason: 'mismatch', challengeFound: true,
    })
    expect((await notaryReview('x', photoSpec(), photoPayload, [Buffer.from(`a${Date.now()}`)])).decision).toBe('reject')

    verifyImageMatchesIntent.mockResolvedValue({
      checked: true, match: false, confidence: 0.59, reason: 'mismatch', challengeFound: true,
    })
    expect((await notaryReview('x', photoSpec(), photoPayload, [Buffer.from(`b${Date.now()}`)])).decision).toBe('uncertain')
  })
})
