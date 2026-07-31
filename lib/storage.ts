import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { GridFSBucket, ObjectId } from 'mongodb'
import { getDb } from './mongo'

// Proof storage on GridFS.
//
// The photo IS the deliverable. An agent pays for a task and expects the image
// back, so submitted photos are stored in MongoDB (GridFS chunks them, so files
// larger than the 16MB document limit are fine) and handed out later as
// short-lived signed URLs.
//
// Signed and expiring, not public: proofs can show storefronts, addresses and
// people. GridFS has no native URL concept, so `/api/proofs/[key]` serves the
// bytes and this module mints the HMAC that route verifies. That reproduces the
// property the object store gave us — a leaked link stops working.

const BUCKET = process.env.PROOF_BUCKET ?? 'proofs'
const SIGNED_URL_TTL_SECONDS = Number(process.env.PROOF_URL_TTL_SECONDS ?? '3600')
const MAX_BYTES = Number(process.env.PROOF_MAX_BYTES ?? String(15 * 1024 * 1024))

/**
 * Secret for proof URL signatures. Falls back to ADMIN_SECRET so a deployment
 * does not silently serve unsigned proofs, but a dedicated secret is better.
 */
function urlSecret(): string {
  const secret = process.env.PROOF_URL_SECRET ?? process.env.ADMIN_SECRET
  if (!secret) {
    throw new Error('PROOF_URL_SECRET (or ADMIN_SECRET) must be set to sign proof URLs')
  }
  return secret
}

async function bucket(): Promise<GridFSBucket> {
  return new GridFSBucket(await getDb(), { bucketName: BUCKET })
}

const FORMATS: Record<string, { contentType: string; ext: string }> = {
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  png: { contentType: 'image/png', ext: 'png' },
  webp: { contentType: 'image/webp', ext: 'webp' },
  gif: { contentType: 'image/gif', ext: 'gif' },
  heif: { contentType: 'image/heif', ext: 'heic' },
  avif: { contentType: 'image/avif', ext: 'avif' },
}

/**
 * Determine the real image type from the bytes rather than trusting the
 * uploaded filename — a worker-supplied name is not evidence of anything, and
 * we must not serve a mislabelled file back to an agent.
 */
async function sniffFormat(buf: Buffer): Promise<{ contentType: string; ext: string }> {
  try {
    const sharp = (await import('sharp')).default
    const format = (await sharp(buf).metadata()).format ?? ''
    return FORMATS[format] ?? { contentType: 'application/octet-stream', ext: 'bin' }
  } catch {
    return { contentType: 'application/octet-stream', ext: 'bin' }
  }
}

export interface StoredProof {
  key: string
  bytes: number
  contentType: string
}

/**
 * Upload one proof image.
 *
 * Keys are `<taskId>/<index>-<sha8>.<ext>` — derived from content, never from
 * the worker-supplied filename, so a hostile name cannot escape the task's
 * namespace or collide with another task's object.
 */
export async function uploadProofImage(
  taskId: string,
  buf: Buffer,
  index: number
): Promise<StoredProof> {
  if (buf.byteLength === 0) throw new Error('empty image')
  if (buf.byteLength > MAX_BYTES) throw new Error(`image exceeds ${MAX_BYTES} bytes`)

  const digest = createHash('sha256').update(buf).digest('hex').slice(0, 8)
  const { contentType, ext } = await sniffFormat(buf)
  const key = `${taskId}/${index}-${digest}.${ext}`

  const gfs = await bucket()

  // A retry of the same proof should replace, not duplicate.
  const existing = await gfs.find({ filename: key }).toArray()
  for (const file of existing) {
    await gfs.delete(file._id as ObjectId).catch(() => {})
  }

  await new Promise<void>((resolve, reject) => {
    // The driver dropped the top-level `contentType` option in v6, so it lives
    // in metadata and is read back from there on download.
    const stream = gfs.openUploadStream(key, {
      metadata: {
        taskId,
        index,
        contentType,
        sha256: createHash('sha256').update(buf).digest('hex'),
      },
    })
    stream.on('error', reject)
    stream.on('finish', () => resolve())
    stream.end(buf)
  })

  return { key, bytes: buf.byteLength, contentType }
}

/** Upload every image for a submission, preserving order. */
export async function uploadProofImages(
  taskId: string,
  buffers: Buffer[]
): Promise<StoredProof[]> {
  const stored: StoredProof[] = []
  for (let i = 0; i < buffers.length; i++) {
    stored.push(await uploadProofImage(taskId, buffers[i], i))
  }
  return stored
}

// ── Signed URLs ───────────────────────────────────────────────────────────────

function signature(key: string, expires: number): string {
  return createHmac('sha256', urlSecret()).update(`${key}:${expires}`).digest('hex')
}

/**
 * Verify a proof URL signature.
 *
 * Compared with timingSafeEqual so a forged signature cannot be recovered byte
 * by byte from response timing.
 */
export function verifyProofSignature(key: string, expires: string, sig: string): boolean {
  const exp = Number(expires)
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false

  let expected: Buffer
  try {
    expected = Buffer.from(signature(key, exp), 'hex')
  } catch {
    return false
  }
  const provided = Buffer.from(sig, 'hex')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** Mint short-lived signed URLs for stored proof keys. */
export async function signProofUrls(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}
  try {
    const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS
    const out: Record<string, string> = {}
    for (const key of keys) {
      const url = new URL(`${APP_URL}/api/proofs/${key}`)
      url.searchParams.set('exp', String(expires))
      url.searchParams.set('sig', signature(key, expires))
      out[key] = url.toString()
    }
    return out
  } catch {
    // Missing signing secret — hand back nothing rather than unsigned links.
    return {}
  }
}

export interface ProofFile {
  buffer: Buffer
  contentType: string
}

/** Fetch the raw bytes of a stored proof. */
export async function downloadProof(key: string): Promise<ProofFile | null> {
  try {
    const gfs = await bucket()
    const [file] = await gfs.find({ filename: key }).limit(1).toArray()
    if (!file) return null

    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = gfs.openDownloadStreamByName(key)
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('error', reject)
      stream.on('end', () => resolve())
    })

    return {
      buffer: Buffer.concat(chunks),
      contentType:
        (file.metadata?.contentType as string | undefined) ?? 'application/octet-stream',
    }
  } catch {
    return null
  }
}

export const proofBucket = BUCKET
export const proofUrlTtlSeconds = SIGNED_URL_TTL_SECONDS
