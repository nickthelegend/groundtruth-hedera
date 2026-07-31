import { describe, it, expect } from 'vitest'
import { verifyProof, proofPerceptualHash } from '../lib/verify'
import type { ProofSpec, ProofPayload } from '../lib/types'

// Integrity gate. These tests exist because the duplicate check was dead code
// for the whole life of the project: the submit route stored a SHA-256 digest
// while this module compared perceptual hashes. Both are 64 characters, so the
// length guard passed and the comparison simply never matched.

/** Two visually different real images, and a byte-identical copy of the first. */
async function images() {
  const sharp = (await import('sharp')).default
  const black = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer()
  const checker = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 32, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
        }).png().toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer()
  return { black, checker, blackCopy: Buffer.from(black) }
}

const photoSpec: ProofSpec = { type: 'photo', instructions: 'Photo', minPhotos: 1 }
const photoPayload: ProofPayload = {
  type: 'photo',
  storageKeys: ['t/0.png'],
  submittedAt: new Date().toISOString(),
}

describe('proofPerceptualHash', () => {
  it('returns a 64-bit bitstring, not a hex digest', async () => {
    const { black } = await images()
    const h = await proofPerceptualHash(black)
    expect(h).toMatch(/^[01]{64}$/)
  })

  it('is stable for identical bytes', async () => {
    const { black, blackCopy } = await images()
    expect(await proofPerceptualHash(black)).toBe(await proofPerceptualHash(blackCopy))
  })

  it('returns null for data that is not an image', async () => {
    expect(await proofPerceptualHash(Buffer.from('not an image'))).toBeNull()
  })
})

describe('duplicate detection', () => {
  it('FAILS a proof that exactly repeats a recent submission', async () => {
    // The check the docs promise. Before the fix this passed silently.
    const { black, blackCopy } = await images()
    const seen = (await proofPerceptualHash(black))!

    const result = await verifyProof(photoSpec, photoPayload, [blackCopy], [seen], 'photo the shop')
    const dedup = result.checks.find(c => c.name.startsWith('dedup_'))

    expect(dedup?.passed).toBe(false)
    expect(dedup?.severity).toBe('hard')
    // A hard failure must actually fail the proof, not just annotate it.
    expect(result.outcome).toBe('failed')
  })

  it('passes a visually different image', async () => {
    const { black, checker } = await images()
    const seen = (await proofPerceptualHash(black))!

    const result = await verifyProof(photoSpec, photoPayload, [checker], [seen], 'photo the shop')
    const dedup = result.checks.find(c => c.name.startsWith('dedup_'))
    expect(dedup?.passed).toBe(true)
  })

  it('passes when nothing has been submitted recently', async () => {
    const { black } = await images()
    const result = await verifyProof(photoSpec, photoPayload, [black], [], 'photo the shop')
    expect(result.checks.find(c => c.name.startsWith('dedup_'))?.passed).toBe(true)
  })

  it('does not fail a proof merely because the stored hash is the wrong format', async () => {
    // Defensive: a legacy SHA-256 row must not crash or false-positive.
    const { black } = await images()
    const legacyHex = 'a'.repeat(64)
    const result = await verifyProof(photoSpec, photoPayload, [black], [legacyHex], 'photo the shop')
    expect(result.checks.find(c => c.name.startsWith('dedup_'))?.passed).toBe(true)
  })
})
