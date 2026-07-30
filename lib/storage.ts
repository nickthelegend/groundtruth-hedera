import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Proof storage.
//
// The photo IS the deliverable. An agent pays for a task and expects to get the
// image back, so submitted photos are uploaded to a PRIVATE Supabase Storage
// bucket and handed out later as short-lived signed URLs.
//
// Private, not public: proofs can contain storefronts, addresses, and people.
// A public bucket would make every proof permanently enumerable by URL. Signed
// URLs expire, so a leaked link stops working.

const BUCKET = process.env.PROOF_BUCKET ?? 'proofs'

/** How long a handed-out proof link stays valid. */
const SIGNED_URL_TTL_SECONDS = Number(process.env.PROOF_URL_TTL_SECONDS ?? '3600')

const MAX_BYTES = Number(process.env.PROOF_MAX_BYTES ?? String(15 * 1024 * 1024))

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Map a sniffed image format to its content type and canonical extension. */
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
 * we do not want to serve a mislabelled file back to an agent.
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
 * Upload one proof image. Keys are `<taskId>/<index>-<sha8>.<ext>` — derived
 * from content, never from the worker-supplied filename, so a hostile name
 * cannot escape the task's folder or collide with another task's object.
 */
export async function uploadProofImage(
  taskId: string,
  buf: Buffer,
  index: number
): Promise<StoredProof> {
  if (buf.byteLength === 0) throw new Error('empty image')
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`image exceeds ${MAX_BYTES} bytes`)
  }

  const { createHash } = await import('crypto')
  const digest = createHash('sha256').update(buf).digest('hex').slice(0, 8)
  const { contentType, ext } = await sniffFormat(buf)
  const key = `${taskId}/${index}-${digest}.${ext}`

  const db = serviceClient()
  const { error } = await db.storage.from(BUCKET).upload(key, buf, {
    contentType,
    upsert: true, // a retry of the same proof should overwrite, not fail
  })
  if (error) throw new Error(`proof upload failed: ${error.message}`)

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

/**
 * Mint short-lived signed URLs for stored proof keys.
 *
 * Best-effort per key: one unreadable object must not blank out the whole
 * deliverable, so failures are dropped rather than thrown.
 */
export async function signProofUrls(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}

  try {
    const db = serviceClient()
    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUrls(keys, SIGNED_URL_TTL_SECONDS)
    if (error || !data) return {}

    const out: Record<string, string> = {}
    data.forEach((row, i) => {
      const key = keys[i]
      if (row.signedUrl && !row.error) out[key] = row.signedUrl
    })
    return out
  } catch {
    return {}
  }
}

/** Fetch the raw bytes of a stored proof — used by the duplicate checker. */
export async function downloadProof(key: string): Promise<Buffer | null> {
  try {
    const db = serviceClient()
    const { data, error } = await db.storage.from(BUCKET).download(key)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

export const proofBucket = BUCKET
export const proofUrlTtlSeconds = SIGNED_URL_TTL_SECONDS
