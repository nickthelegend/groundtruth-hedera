import { NextRequest, NextResponse } from 'next/server'
import { getTask, transition, recordProofHash, recentProofHashes, bumpWorker } from '@/lib/db'
import { verifyProof } from '@/lib/verify'
import { settleTask } from '@/lib/settle'
import { uploadProofImages } from '@/lib/storage'
import { notaryReview } from '@/lib/notary'
import type { ProofPayload, ProofSpec, NotaryVerdict } from '@/lib/types'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    return await handleSubmit(req, params)
  } catch (err) {
    console.error('[submit] unhandled error:', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}

async function handleSubmit(req: NextRequest, params: { id: string }) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form submission' }, { status: 400 })
  }

  const workerWallet = formData.get('worker_wallet') as string
  const proofType = formData.get('proof_type') as 'photo' | 'form'

  if (!workerWallet?.match(/^\d+\.\d+\.\d+$/) || !proofType) {
    return NextResponse.json(
      { error: 'Missing or invalid fields (worker_wallet must be a Hedera account id)' },
      { status: 400 }
    )
  }

  const task = await getTask(params.id)
  // Allow a fresh submit (claimed) OR a RETRY of a failed attempt by the same
  // worker — an honest worker who blurred the code or missed the subject can try
  // again within the task window instead of being locked out.
  const isClaimed = task?.status === 'claimed'
  const isRetry = task?.status === 'failed' && task.worker_wallet === workerWallet
  if (!task || (!isClaimed && !isRetry)) {
    return NextResponse.json({ error: 'Task not open for submission' }, { status: 409 })
  }
  if (task.worker_wallet !== workerWallet) {
    return NextResponse.json({ error: 'Not your task' }, { status: 403 })
  }
  const fromStatus = task.status // 'claimed' or 'failed' (retry)

  // Build proof payload
  const imageBuffers: Buffer[] = []
  let proofPayload: ProofPayload

  if (proofType === 'photo') {
    const photos = formData.getAll('photos') as File[]
    for (const photo of photos) {
      const buf = Buffer.from(await photo.arrayBuffer())
      imageBuffers.push(buf)
    }

    // The photo IS the deliverable the agent paid for, so it must be persisted
    // before we can call the task verified. If the upload fails we stop here
    // rather than marking a task complete with no retrievable proof.
    let storageKeys: string[]
    try {
      const stored = await uploadProofImages(params.id, imageBuffers)
      storageKeys = stored.map(s => s.key)
    } catch (e) {
      return NextResponse.json(
        {
          error: 'Could not store proof — nothing was submitted, please try again',
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 502 }
      )
    }

    proofPayload = {
      type: 'photo',
      storageKeys,
      submittedAt: new Date().toISOString(),
    }
  } else {
    const rawForm = formData.get('form_data') as string
    let parsedForm: Record<string, string>
    try {
      parsedForm = JSON.parse(rawForm ?? '{}')
    } catch {
      return NextResponse.json({ error: 'Invalid form_data JSON' }, { status: 400 })
    }
    proofPayload = {
      type: 'form',
      formData: parsedForm,
      submittedAt: new Date().toISOString(),
    }
  }

  // Run verification (dedup only matters for photos, so skip that read for
  // forms). Verify works on the in-memory payload, so we don't need to persist
  // the 'submitted' state first — we resolve straight to the final status in a
  // single write below, saving several cold DB round-trips.
  const recentHashes = proofType === 'photo' ? await recentProofHashes(60) : []
  const result = await verifyProof(task.proof_spec as any, proofPayload, imageBuffers, recentHashes, task.intent)

  // Store proof hashes for dedup (photos only)
  if (proofType === 'photo') {
    for (const buf of imageBuffers) {
      try {
        const { createHash } = await import('crypto')
        const hash = createHash('sha256').update(buf).digest('hex')
        await recordProofHash(params.id, hash)
      } catch {}
    }
  }

  const now = new Date().toISOString()
  const integrityFailed = result.outcome === 'failed'

  // Semantic notary gate — the real content check. Only runs once integrity has
  // passed (no point asking an LLM to judge blatant garbage). It judges the
  // proof against the task intent and returns accept / reject / uncertain.
  // A CONFIDENT mismatch rejects; uncertain still pays (fail toward the worker).
  let notary: NotaryVerdict | null = null
  if (!integrityFailed) {
    notary = await notaryReview(task.intent, task.proof_spec as ProofSpec, proofPayload, imageBuffers)
    result.notary = notary
  }
  const semanticReject = notary?.decision === 'reject'
  const rejected = integrityFailed || semanticReject
  const autoAccept = process.env.AUTO_ACCEPT !== 'false'

  // FAIL CLOSED: if a task carries a freshness challenge but the notary could not
  // actually run (vision/LLM skipped, errored, timed out, or hit a rate limit),
  // we cannot confirm the anti-fraud check — so we must NOT auto-pay. Hold the
  // proof for manual review instead. This means a rate-limited vision API can
  // never silently approve an unverified proof; it degrades safely.
  // Fail closed for the fraud-prone case: a PHOTO task (or any task carrying a
  // freshness challenge) whose notary could not actually run is held, not paid.
  const challenged = !!(task.proof_spec as ProofSpec).challenge
  const notaryCouldNotVerify = !!notary && notary.checked === false
  const holdForReview = (challenged || proofType === 'photo') && notaryCouldNotVerify

  // Single CAS transition from 'claimed' to the resolved status.
  //   failed   : integrity gate OR the notary confidently rejected the proof
  //   verified : passed + auto-accept → pay out in the background
  //   submitted: manual mode, OR held for review because verification was unavailable
  const target: 'failed' | 'verified' | 'submitted' =
    rejected ? 'failed' : (holdForReview || !autoAccept) ? 'submitted' : 'verified'

  const moved = await transition(params.id, fromStatus, target, {
    proof_payload: proofPayload,
    result,
    submitted_at: now,
    ...(target === 'submitted' ? {} : { resolved_at: now }),
  })
  if (!moved) {
    return NextResponse.json({ error: 'State transition failed' }, { status: 409 })
  }

  if (rejected) {
    await bumpWorker({ wallet: workerWallet, earned_units: BigInt(0), outcome: 'failed' }).catch(() => {})
    return NextResponse.json({
      task_id: params.id,
      status: 'failed',
      integrity: result.outcome,
      notary,
      checks: result.checks,
      vision: result.vision ?? null,
      message: semanticReject
        ? `Proof doesn't match the task${notary?.reason ? ` — ${notary.reason}` : ''}.`
        : 'Proof did not pass integrity checks.',
    })
  }

  if (target === 'verified') {
    // Settle SYNCHRONOUSLY so the payout is guaranteed before we respond — a
    // "verified but never paid" state is the worst thing a worker/judge can hit.
    // The on-chain wait (~5-8s on real infra) is covered by the "settling" UI.
    // Reliable on any runtime without a background-execution dependency.
    const settle = await settleTask(params.id, workerWallet, task.payment_ref ?? '', task.budget_usdt)
    return NextResponse.json({
      task_id: params.id,
      status: 'verified',
      integrity: result.outcome,
      notary,
      checks: result.checks,
      vision: result.vision ?? null,
      settle,
      message: settle.success ? 'Verified — payout settled on-chain.' : 'Verified — settlement is finalizing.',
    })
  }

  return NextResponse.json({
    task_id: params.id,
    status: 'submitted',
    integrity: result.outcome,
    notary,
    checks: result.checks,
    vision: result.vision ?? null,
    held_for_review: holdForReview,
    message: holdForReview
      ? 'Proof received — AI verification is temporarily unavailable, so it’s held for review. No payout is released until it’s verified.'
      : 'Proof submitted — awaiting the agent’s verification.',
  })
}
