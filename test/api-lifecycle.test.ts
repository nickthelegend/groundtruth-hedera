import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeState, buildDbMock, makeTask, type FakeState } from './helpers/fake-db'

// The oracle side of the loop: claim a task, submit proof, get paid. These are
// the routes a human touches, and the ones that decide when money moves.

process.env.HEDERA_NETWORK = 'hedera:testnet'
process.env.PAYMENT_ASSET_ID = '0.0.0'
process.env.HEDERA_OPERATOR_ID = '0.0.9847867'
process.env.ASP_PRICE_USDT = '0.50'
process.env.ASP_FEE_BPS = '1200'

const state: FakeState = createFakeState()

vi.mock('@/lib/db', () => buildDbMock(state))

const uploadProofImages = vi.fn(async (taskId: string, buffers: Buffer[]) =>
  buffers.map((_, i) => ({ key: `${taskId}/${i}-abc12345.jpg`, bytes: 100, contentType: 'image/jpeg' }))
)
vi.mock('@/lib/storage', () => ({
  uploadProofImages,
  signProofUrls: vi.fn(async (keys: string[]) =>
    Object.fromEntries(keys.map(k => [k, `https://signed.example/${k}`]))
  ),
  proofUrlTtlSeconds: 3600,
  downloadProof: vi.fn(),
  proofBucket: 'proofs',
}))

// verifyProof is stubbed so each test can drive the integrity outcome, but
// proofPerceptualHash stays REAL — the bug these tests guard against was the
// route storing the wrong kind of hash, which a stubbed hasher would hide.
const verifyProof = vi.fn()
vi.mock('@/lib/verify', async () => {
  const actual = await vi.importActual<typeof import('../lib/verify')>('../lib/verify')
  return { verifyProof, proofFingerprint: actual.proofFingerprint }
})

const notaryReview = vi.fn()
vi.mock('@/lib/notary', () => ({ notaryReview }))

const settleTask = vi.fn()
vi.mock('@/lib/settle', () => ({ settleTask }))

const { POST: claimRoute } = await import('../app/api/tasks/[id]/claim/route')
const { POST: submitRoute } = await import('../app/api/tasks/[id]/submit/route')

const WORKER = '0.0.9847870'

// A real 1x1 PNG. The perceptual hash needs bytes sharp can actually decode —
// a Buffer.from('anything') yields no hash at all.
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function claimReq(body: unknown) {
  return new Request('http://localhost/api/tasks/x/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

function submitReq(fields: Record<string, string>, photos: Buffer[] = []) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  for (const p of photos) {
    fd.append('photos', new File([new Uint8Array(p)], 'proof.jpg', { type: 'image/jpeg' }))
  }
  return new Request('http://localhost/api/tasks/x/submit', {
    method: 'POST',
    body: fd,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

beforeEach(() => {
  state.tasks.clear()
  state.proofHashes.length = 0
  state.workers.clear()
  verifyProof.mockReset()
  notaryReview.mockReset()
  settleTask.mockReset()
  uploadProofImages.mockClear()
  settleTask.mockResolvedValue({
    success: true,
    txId: '0.0.9847867@1.1',
    explorer: 'https://hashscan.io/testnet/transaction/0.0.9847867@1.1',
    payout: '0.44',
    asset: 'HBAR',
  })
})

describe('POST /api/tasks/:id/claim', () => {
  it('claims an open task', async () => {
    const task = makeTask()
    state.tasks.set(task.id, task)
    const res = await claimRoute(claimReq({ worker_wallet: WORKER }), { params: { id: task.id } })
    expect(res.status).toBe(200)
    expect(state.tasks.get(task.id)!.status).toBe('claimed')
    expect(state.tasks.get(task.id)!.worker_wallet).toBe(WORKER)
  })

  it('rejects an EVM address as the worker wallet', async () => {
    const task = makeTask()
    state.tasks.set(task.id, task)
    const res = await claimRoute(
      claimReq({ worker_wallet: '0xf566aaf0e2421c45fa280c59e0c46e5e898d1795' }),
      { params: { id: task.id } }
    )
    expect(res.status).toBe(400)
    expect(state.tasks.get(task.id)!.status).toBe('pending')
  })

  it('refuses a task already claimed by someone else', async () => {
    const task = makeTask({ status: 'claimed', worker_wallet: '0.0.111', claimed_at: new Date().toISOString() })
    state.tasks.set(task.id, task)
    const res = await claimRoute(claimReq({ worker_wallet: WORKER }), { params: { id: task.id } })
    expect(res.status).toBe(409)
    expect(state.tasks.get(task.id)!.worker_wallet).toBe('0.0.111')
  })

  it('refuses an expired task', async () => {
    const task = makeTask({ expires_at: new Date(Date.now() - 1000).toISOString() })
    state.tasks.set(task.id, task)
    const res = await claimRoute(claimReq({ worker_wallet: WORKER }), { params: { id: task.id } })
    expect(res.status).toBe(409)
  })

  it('lets an abandoned claim be picked up again', async () => {
    const task = makeTask({
      status: 'claimed',
      worker_wallet: '0.0.111',
      claimed_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    })
    state.tasks.set(task.id, task)
    const res = await claimRoute(claimReq({ worker_wallet: WORKER }), { params: { id: task.id } })
    expect(res.status).toBe(200)
    expect(state.tasks.get(task.id)!.worker_wallet).toBe(WORKER)
  })
})

describe('POST /api/tasks/:id/submit — proof storage', () => {
  function claimed() {
    const task = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(task.id, task)
    return task
  }

  it('persists the photo and records the real storage keys', async () => {
    // Regression: storage keys used to be fabricated from the filename and no
    // upload ever happened, so the deliverable did not exist.
    verifyProof.mockResolvedValue({ outcome: 'verified', checks: [] })
    notaryReview.mockResolvedValue({ decision: 'accept', confidence: 0.9, reason: 'ok', checked: true, mode: 'photo' })
    const task = claimed()

    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'photo' }, [
        Buffer.from('fake-image-bytes'),
      ]),
      { params: { id: task.id } }
    )

    expect(res.status).toBe(200)
    expect(uploadProofImages).toHaveBeenCalledOnce()
    const stored = state.tasks.get(task.id)!.proof_payload!
    expect(stored.storageKeys).toEqual([`${task.id}/0-abc12345.jpg`])
  })

  it('does NOT mark a task verified when the upload fails', async () => {
    // A verified task with no retrievable proof is worse than a failed submit.
    uploadProofImages.mockRejectedValueOnce(new Error('bucket unavailable'))
    const task = claimed()

    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'photo' }, [
        Buffer.from('img'),
      ]),
      { params: { id: task.id } }
    )

    expect(res.status).toBe(502)
    expect(state.tasks.get(task.id)!.status).toBe('claimed')
    expect(settleTask).not.toHaveBeenCalled()
  })
})

describe('POST /api/tasks/:id/submit — authorisation and payout gating', () => {
  it('refuses a submission from a different worker', async () => {
    const task = makeTask({ status: 'claimed', worker_wallet: '0.0.111' })
    state.tasks.set(task.id, task)
    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'form' }, []),
      { params: { id: task.id } }
    )
    expect([403, 409]).toContain(res.status)
    expect(settleTask).not.toHaveBeenCalled()
  })

  it('refuses a submission for an unclaimed task', async () => {
    const task = makeTask({ status: 'pending' })
    state.tasks.set(task.id, task)
    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'form' }, []),
      { params: { id: task.id } }
    )
    expect(res.status).toBe(409)
    expect(settleTask).not.toHaveBeenCalled()
  })

  it('rejects a worker wallet that is not a Hedera account id', async () => {
    const task = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(task.id, task)
    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: '0xdead', proof_type: 'form' }, []),
      { params: { id: task.id } }
    )
    expect(res.status).toBe(400)
  })

  it('does NOT pay out when the notary confidently rejects the proof', async () => {
    verifyProof.mockResolvedValue({ outcome: 'verified', checks: [] })
    notaryReview.mockResolvedValue({
      decision: 'reject',
      confidence: 0.95,
      reason: 'photo shows a blank wall',
      checked: true,
      mode: 'photo',
    })
    const task = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(task.id, task)

    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'photo' }, [Buffer.from('x')]),
      { params: { id: task.id } }
    )

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('failed')
    expect(settleTask).not.toHaveBeenCalled()
    expect(state.tasks.get(task.id)!.status).toBe('failed')
  })

  it('does NOT pay out when the integrity gate fails', async () => {
    verifyProof.mockResolvedValue({
      outcome: 'failed',
      checks: [{ name: 'image decodes', passed: false, severity: 'hard' }],
    })
    notaryReview.mockResolvedValue({ decision: 'uncertain', confidence: 0, reason: '', checked: false, mode: 'photo' })
    const task = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(task.id, task)

    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'photo' }, [Buffer.from('x')]),
      { params: { id: task.id } }
    )
    expect((await res.json()).status).toBe('failed')
    expect(settleTask).not.toHaveBeenCalled()
  })

  it('pays out when integrity and the notary both accept', async () => {
    verifyProof.mockResolvedValue({ outcome: 'verified', checks: [] })
    notaryReview.mockResolvedValue({
      decision: 'accept',
      confidence: 0.92,
      reason: 'entrance visible and open',
      checked: true,
      mode: 'photo',
    })
    const task = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(task.id, task)

    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'photo' }, [Buffer.from('x')]),
      { params: { id: task.id } }
    )

    const body = await res.json()
    expect(body.status).toBe('verified')
    expect(settleTask).toHaveBeenCalledOnce()
    expect(body.settle.txId).toBe('0.0.9847867@1.1')
  })

  it('holds a photo task for review when the notary could not run', async () => {
    // Fail closed: an unverifiable photo must not auto-pay.
    verifyProof.mockResolvedValue({ outcome: 'verified', checks: [] })
    notaryReview.mockResolvedValue({
      decision: 'uncertain',
      confidence: 0,
      reason: 'vision model unavailable',
      checked: false,
      mode: 'photo',
    })
    const task = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(task.id, task)

    const res = await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'photo' }, [Buffer.from('x')]),
      { params: { id: task.id } }
    )

    const body = await res.json()
    expect(body.status).toBe('submitted')
    expect(body.held_for_review).toBe(true)
    expect(settleTask).not.toHaveBeenCalled()
  })

  it('records a PERCEPTUAL hash so duplicates can actually be detected', async () => {
    // Regression: this used to store a SHA-256 digest while verifyProof compared
    // perceptual hashes. Both are 64 characters, so the length guard passed,
    // nothing ever matched, and the duplicate check silently did nothing.
    verifyProof.mockResolvedValue({ outcome: 'verified', checks: [] })
    notaryReview.mockResolvedValue({ decision: 'accept', confidence: 0.9, reason: '', checked: true, mode: 'photo' })
    const task = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(task.id, task)

    await submitRoute(
      submitReq({ task_id: task.id, worker_wallet: WORKER, proof_type: 'photo' }, [REAL_PNG]),
      { params: { id: task.id } }
    )

    expect(state.proofHashes.length).toBe(1)
    const stored = state.proofHashes[0]

    // Both signals must be stored. The digest is what makes an exact repeat a
    // hard fail; the perceptual hash is only the similarity hint. Storing one
    // without the other is how this check did nothing for the project's life.
    const { proofFingerprint } = await vi.importActual<typeof import('../lib/verify')>('../lib/verify')
    const expected = (await proofFingerprint(REAL_PNG))!
    expect(stored.phash).toBe(expected.phash)
    expect(stored.sha256).toBe(expected.sha256)
    expect(stored.phash).toMatch(/^[01]{64}$/)
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('feeds the stored hash back into verification so a repeat is comparable', async () => {
    verifyProof.mockResolvedValue({ outcome: 'verified', checks: [] })
    notaryReview.mockResolvedValue({ decision: 'accept', confidence: 0.9, reason: '', checked: true, mode: 'photo' })

    const first = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(first.id, first)
    await submitRoute(
      submitReq({ task_id: first.id, worker_wallet: WORKER, proof_type: 'photo' }, [REAL_PNG]),
      { params: { id: first.id } }
    )

    const second = makeTask({ status: 'claimed', worker_wallet: WORKER })
    state.tasks.set(second.id, second)
    await submitRoute(
      submitReq({ task_id: second.id, worker_wallet: WORKER, proof_type: 'photo' }, [REAL_PNG]),
      { params: { id: second.id } }
    )

    // The second submission must have been shown the first one's hash — that is
    // the wiring that was broken.
    const lastCall = verifyProof.mock.calls.at(-1)!
    const recentHashes = lastCall[3] as { phash: string; sha256: string }[]
    expect(recentHashes.map(h => h.sha256)).toContain(state.proofHashes[0].sha256)
  })
})
