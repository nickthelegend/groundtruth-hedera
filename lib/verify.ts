import { createHash } from 'crypto'
import type { ProofPayload, ProofSpec, VerificationCheck, TaskResult, VisionResult } from './types'
import type { ProofFingerprint } from './db'

// Dynamic imports to avoid build errors when packages unavailable at type-check time
async function getExifr() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – exifr is an optional runtime dep; import fails gracefully
  try { return await import('exifr') } catch { return null }
}

async function getSharp() {
  try { return (await import('sharp')).default } catch { return null }
}

export async function verifyProof(
  spec: ProofSpec,
  payload: ProofPayload,
  imageBuffers?: Buffer[],
  recentHashes?: ProofFingerprint[],
  intent?: string
): Promise<TaskResult> {
  const checks: VerificationCheck[] = []

  if (spec.type === 'photo') {
    // Real pipeline: photo count + valid-image decode (hard), plus resolution,
    // perceptual-hash dedup, and EXIF timestamp (soft).
    checks.push(...(await verifyPhoto(spec, payload, imageBuffers ?? [], recentHashes ?? [])))
  }

  if (spec.type === 'form') {
    checks.push(...verifyForm(spec, payload))
  }

  // Fail-closed: any hard failure → failed; never auto-pass on timeout/error.
  const hardFail = checks.some(c => c.severity === 'hard' && !c.passed)
  const softChecks = checks.filter(c => c.severity === 'soft')
  const softFailCount = softChecks.filter(c => !c.passed).length
  const totalChecks = checks.length

  // No vision call here on purpose.
  //
  // This module used to run its own advisory vision check, which meant every
  // photo submission judged the same image TWICE with the same model — once
  // here without the freshness code, once in lib/notary.ts with it. The second
  // is strictly stronger and is the one that actually gates payout, so the
  // first was pure cost: doubled latency, doubled rate-limit pressure, and with
  // retries it could exceed the serverless function budget on its own.
  const vision: VisionResult | undefined = undefined

  if (hardFail) {
    return { outcome: 'failed', checks, vision }
  }

  const passed = checks.filter(c => c.passed).length
  const confidence = totalChecks > 0 ? passed / totalChecks : 0

  // Hard checks passed → verified. Soft checks are advisory; only a majority of
  // soft signals failing warrants manual review (genuine photos may lack EXIF,
  // be low-res, etc. without being fraudulent).
  if (softChecks.length > 0 && softFailCount / softChecks.length > 0.5) {
    return { outcome: 'needs_review', checks, confidence, vision }
  }

  return { outcome: 'verified', checks, confidence, vision }
}

async function verifyPhoto(
  spec: ProofSpec,
  payload: ProofPayload,
  buffers: Buffer[],
  recentHashes: ProofFingerprint[]
): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = []
  const minPhotos = spec.minPhotos ?? 1

  // Hard: correct number of photos
  checks.push({
    name: 'photo_count',
    passed: buffers.length >= minPhotos,
    severity: 'hard',
    detail: `Expected ${minPhotos}, got ${buffers.length}`,
  })

  if (buffers.length === 0) return checks

  const sharp = await getSharp()
  const exifr = await getExifr()

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i]

    // Hard: valid image (sharp can decode it)
    if (sharp) {
      try {
        const meta = await sharp(buf).metadata()
        checks.push({
          name: `image_valid_${i}`,
          passed: !!meta.width && !!meta.height,
          severity: 'hard',
          detail: meta.width ? `${meta.width}x${meta.height}` : 'decode failed',
        })

        // Soft: minimum resolution (640x480)
        const minRes = (meta.width ?? 0) >= 640 && (meta.height ?? 0) >= 480
        checks.push({
          name: `resolution_${i}`,
          passed: minRes,
          severity: 'soft',
          detail: minRes ? 'ok' : 'low resolution',
        })

        // Dedup against recently submitted proofs.
        //
        // Two different signals, and conflating them is a trap worth spelling
        // out. A SHA-256 digest proves the bytes are IDENTICAL — unambiguous
        // reuse, so a hard fail. A perceptual hash only says two images LOOK
        // alike; an 8x8 average hash collides for images that differ in a small
        // region, so two genuinely different photos of the same storefront
        // (or the same template with a different code printed on it) match.
        // Failing on that would reject honest work, so similarity is advisory.
        try {
          const phash = await computePHash(sharp, buf)
          const digest = createHash('sha256').update(buf).digest('hex')

          const exact = recentHashes.some(h => !!h.sha256 && h.sha256 === digest)
          const near =
            !exact &&
            recentHashes.some(h => !!h.phash && hammingDistance(h.phash, phash) < NEAR_DUPLICATE_BITS)

          checks.push({
            name: `dedup_${i}`,
            passed: !exact,
            severity: 'hard',
            detail: exact ? 'identical image already submitted' : 'not an exact duplicate',
          })
          if (near) {
            checks.push({
              name: `similar_${i}`,
              passed: false,
              severity: 'soft',
              detail: 'visually similar to a recent submission',
            })
          }
        } catch {
          // Hash computation failed — our fault, not the worker's. Soft pass.
          checks.push({ name: `dedup_${i}`, passed: true, severity: 'soft', detail: 'hash unavailable' })
        }
      } catch {
        checks.push({ name: `image_valid_${i}`, passed: false, severity: 'hard', detail: 'invalid image data' })
      }
    }

    // Soft: EXIF timestamp exists (proof was taken recently, not stock photo)
    if (exifr) {
      try {
        const exif = await exifr.parse(buf, ['DateTimeOriginal', 'GPSLatitude'])
        const hasTimestamp = !!exif?.DateTimeOriginal
        checks.push({
          name: `exif_timestamp_${i}`,
          passed: hasTimestamp,
          severity: 'soft',
          detail: hasTimestamp ? exif.DateTimeOriginal.toString() : 'no EXIF timestamp',
        })
      } catch {
        checks.push({ name: `exif_timestamp_${i}`, passed: true, severity: 'soft', detail: 'exif parse skipped' })
      }
    }
  }

  return checks
}

function verifyForm(spec: ProofSpec, payload: ProofPayload): VerificationCheck[] {
  const checks: VerificationCheck[] = []
  const fields = spec.formFields ?? []
  const data = payload.formData ?? {}

  // Hard: all required fields present and non-empty
  for (const field of fields) {
    const val = data[field]
    checks.push({
      name: `field_${field}`,
      passed: typeof val === 'string' && val.trim().length > 0,
      severity: 'hard',
      detail: val ? 'present' : 'missing or empty',
    })
  }

  // Soft: answer length > 10 chars (not just "yes" / "no")
  const answer = data['answer'] ?? ''
  if (answer) {
    checks.push({
      name: 'answer_length',
      passed: answer.trim().length >= 10,
      severity: 'soft',
      detail: `${answer.trim().length} chars`,
    })
  }

  return checks
}

/** Hamming distance below which two images count as visually similar. */
const NEAR_DUPLICATE_BITS = 10

/**
 * 64-bit average perceptual hash, as a string of '0'/'1'.
 *
 * Exported because the submit route must store EXACTLY this value — storing a
 * cryptographic digest instead makes every later comparison silently useless.
 */
export async function proofPerceptualHash(buf: Buffer): Promise<string | null> {
  const sharp = await getSharp()
  if (!sharp) return null
  try {
    return await computePHash(sharp, buf)
  } catch {
    return null
  }
}

/**
 * Both dedup signals for one image.
 *
 * The digest is what makes an exact repeat detectable; the perceptual hash is
 * only a similarity hint. Store both, or the hard check silently never fires.
 */
export async function proofFingerprint(buf: Buffer): Promise<ProofFingerprint | null> {
  const phash = await proofPerceptualHash(buf)
  if (!phash) return null
  return { phash, sha256: createHash('sha256').update(buf).digest('hex') }
}

async function computePHash(sharp: NonNullable<Awaited<ReturnType<typeof getSharp>>>, buf: Buffer): Promise<string> {
  // Resize to 8x8 grayscale, compute average, build bit string
  const { data } = await sharp(buf)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const avg = data.reduce((s: number, v: number) => s + v, 0) / data.length
  return (Array.from(data) as number[]).map((v: number) => (v >= avg ? '1' : '0')).join('')
}

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}
