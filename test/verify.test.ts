import { describe, it, expect } from 'vitest'
import { verifyProof, proofPerceptualHash, proofFingerprint } from '../lib/verify'
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

describe('proofFingerprint', () => {
  it('returns both a perceptual hash and a digest', async () => {
    const { black } = await images()
    const fp = (await proofFingerprint(black))!
    expect(fp.phash).toMatch(/^[01]{64}$/)
    expect(fp.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('duplicate detection', () => {
  it('FAILS a proof whose BYTES exactly repeat a recent submission', async () => {
    const { black, blackCopy } = await images()
    const seen = (await proofFingerprint(black))!

    const result = await verifyProof(photoSpec, photoPayload, [blackCopy], [seen], 'photo the shop')
    const dedup = result.checks.find(c => c.name.startsWith('dedup_'))

    expect(dedup?.passed).toBe(false)
    expect(dedup?.severity).toBe('hard')
    // A hard failure must actually fail the proof, not just annotate it.
    expect(result.outcome).toBe('failed')
  })

  it('does NOT fail a merely SIMILAR image — it flags it', async () => {
    // The regression that broke production: an 8x8 average hash collides for
    // images differing in a small region (same template, different code), so
    // treating perceptual equality as proof of reuse rejects honest work.
    const { black } = await images()
    const sharp = (await import('sharp')).default
    // Same field of black with one small white square — visually near-identical,
    // different bytes.
    const nearlyIdentical = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{
        input: await sharp({
          create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } },
        }).png().toBuffer(),
        left: 0, top: 0,
      }])
      .png()
      .toBuffer()

    const seen = (await proofFingerprint(black))!
    const result = await verifyProof(photoSpec, photoPayload, [nearlyIdentical], [seen], 'photo the shop')

    expect(result.checks.find(c => c.name.startsWith('dedup_'))?.passed).toBe(true)
    expect(result.outcome).not.toBe('failed')
  })

  it('passes a visually different image', async () => {
    const { black, checker } = await images()
    const seen = (await proofFingerprint(black))!

    const result = await verifyProof(photoSpec, photoPayload, [checker], [seen], 'photo the shop')
    expect(result.checks.find(c => c.name.startsWith('dedup_'))?.passed).toBe(true)
  })

  it('passes when nothing has been submitted recently', async () => {
    const { black } = await images()
    const result = await verifyProof(photoSpec, photoPayload, [black], [], 'photo the shop')
    expect(result.checks.find(c => c.name.startsWith('dedup_'))?.passed).toBe(true)
  })

  it('tolerates legacy rows that carry no digest', async () => {
    // Rows written before the digest existed must not crash or false-positive.
    const { black } = await images()
    const legacy = { phash: 'a'.repeat(64), sha256: '' }
    const result = await verifyProof(photoSpec, photoPayload, [black], [legacy], 'photo the shop')
    expect(result.checks.find(c => c.name.startsWith('dedup_'))?.passed).toBe(true)
  })
})
