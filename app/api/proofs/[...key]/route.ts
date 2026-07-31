import { NextRequest, NextResponse } from 'next/server'
import { downloadProof, verifyProofSignature } from '@/lib/storage'

// Serves a stored proof image.
//
// GridFS has no URL concept, so this route is the equivalent of an object
// store's signed URL: the key, an expiry and an HMAC are supplied as query
// params, and nothing is served without a valid, unexpired signature. Proofs
// can show storefronts, addresses and people, so an unauthenticated read must
// not be possible just by knowing (or guessing) a key.

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { key: string[] } }
) {
  // The key is `<taskId>/<index>-<sha8>.<ext>`, so it arrives as path segments.
  const key = params.key.map(decodeURIComponent).join('/')

  const { searchParams } = new URL(req.url)
  const exp = searchParams.get('exp')
  const sig = searchParams.get('sig')

  if (!exp || !sig || !verifyProofSignature(key, exp, sig)) {
    // One message for missing, malformed, expired and forged signatures alike —
    // distinguishing them would confirm which keys exist.
    return NextResponse.json({ error: 'Invalid or expired proof link' }, { status: 403 })
  }

  const file = await downloadProof(key)
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.buffer.byteLength),
      // Cacheable only by the recipient, and never beyond the link's own life.
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': `inline; filename="${key.split('/').pop() ?? 'proof'}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
