import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeState, buildDbMock, type FakeState } from './helpers/fake-db'

// Task creation is the payment gate. These tests assert the one invariant that
// matters most: a task is only ever created against a payment that verified,
// settled, AND was confirmed in Hedera consensus — and never twice for the same
// payment.

process.env.HEDERA_NETWORK = 'hedera:testnet'
process.env.PAYMENT_ASSET_ID = '0.0.0'
process.env.HEDERA_OPERATOR_ID = '0.0.9847867'
process.env.PAY_TO_ACCOUNT = '0.0.9847867'
process.env.ASP_PRICE_USDT = '0.50'
process.env.ASP_FEE_BPS = '1200'
delete process.env.ADMIN_SECRET

const state: FakeState = createFakeState()

vi.mock('@/lib/db', () => buildDbMock(state))

// The payment pipeline is exercised for real against live Hedera in
// scripts/test-x402.ts. Here it is stubbed so route logic can be tested
// offline and deterministically, including its failure branches.
const processPayment = vi.fn()
vi.mock('@/lib/payment', async () => {
  const x402 = await import('../lib/x402')
  return {
    processPayment,
    buildChallenge: x402.buildChallenge,
    priceLabel: () => '0.50 HBAR',
  }
})

vi.mock('@/lib/x402', () => ({
  buildChallenge: vi.fn(async () => ({
    x402Version: 2,
    error: 'Payment required',
    resource: { url: 'http://localhost:3000/api/v1/human-do' },
    accepts: [
      {
        scheme: 'exact',
        network: 'hedera:testnet',
        asset: '0.0.0',
        amount: '50000000',
        payTo: '0.0.9847867',
        maxTimeoutSeconds: 180,
        extra: { feePayer: '0.0.7162784' },
      },
    ],
  })),
}))

vi.mock('@/lib/planner', () => ({
  planTask: vi.fn(async () => ({
    proof_spec: { type: 'photo', instructions: 'Take a photo', minPhotos: 1 },
    estimated_minutes: 10,
  })),
}))

const { POST, GET } = await import('../app/api/v1/human-do/route')

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/v1/human-do', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

const VALID_BODY = {
  intent: 'Verify the coffee shop on Main St is open',
  budget_usdt: '0.50',
  proof_spec: { type: 'photo' as const, instructions: 'Photo of the entrance', minPhotos: 1 },
}

function settled(txId = '0.0.7162784@1785448933.726761986') {
  return {
    success: true,
    paymentRef: `hedera-${txId}`,
    payerAccount: '0.0.9847870',
    txId,
    explorer: `https://hashscan.io/testnet/transaction/${txId}`,
    amountUnits: 50_000_000n,
    feeUnits: 6_000_000n,
    payoutUnits: 44_000_000n,
  }
}

beforeEach(() => {
  state.tasks.clear()
  state.payments.clear()
  processPayment.mockReset()
})

describe('GET /api/v1/human-do', () => {
  it('answers unpaid discovery with 402 and usable requirements', async () => {
    const res = await GET()
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.x402Version).toBe(2)
    expect(body.accepts[0].network).toBe('hedera:testnet')
    expect(body.accepts[0].scheme).toBe('exact')
    // Without the facilitator fee payer a client cannot build a payable tx.
    expect(body.accepts[0].extra.feePayer).toBeTruthy()
  })
})

describe('POST /api/v1/human-do — payment gate', () => {
  it('refuses to create a task with no payment header', async () => {
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(402)
    expect(state.tasks.size).toBe(0)
    expect(processPayment).not.toHaveBeenCalled()
  })

  it('creates a task when payment verifies, settles and confirms', async () => {
    processPayment.mockResolvedValue(settled())
    const res = await POST(req(VALID_BODY, { 'X-PAYMENT': 'signed-header' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.task_id).toBeTruthy()
    expect(body.payment.tx_id).toBe('0.0.7162784@1785448933.726761986')
    expect(state.tasks.size).toBe(1)
  })

  it('creates NO task when the payment fails verification', async () => {
    processPayment.mockResolvedValue({
      success: false,
      reason: 'facilitator rejected payment',
      paymentRef: 'invalid',
      payerAccount: '0.0.0',
      amountUnits: 0n,
      feeUnits: 0n,
      payoutUnits: 0n,
    })
    const res = await POST(req(VALID_BODY, { 'X-PAYMENT': 'forged' }))
    expect(res.status).toBe(402)
    expect((await res.json()).error).toMatch(/facilitator rejected/)
    expect(state.tasks.size).toBe(0)
  })

  it('creates NO task when settlement is unconfirmed on the mirror node', async () => {
    // The facilitator claimed success but consensus does not show it. This must
    // not mint a task, but must return the tx id so it can be reconciled.
    processPayment.mockResolvedValue({
      success: false,
      unconfirmed: true,
      reason: 'settled but unconfirmed on mirror node: not found',
      paymentRef: 'hedera-0.0.1@1.1',
      payerAccount: '0.0.9847870',
      txId: '0.0.1@1.1',
      explorer: 'https://hashscan.io/testnet/transaction/0.0.1@1.1',
      amountUnits: 50_000_000n,
      feeUnits: 6_000_000n,
      payoutUnits: 44_000_000n,
    })
    const res = await POST(req(VALID_BODY, { 'X-PAYMENT': 'header' }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.settled_unconfirmed).toBe(true)
    expect(body.tx_id).toBe('0.0.1@1.1')
    expect(state.tasks.size).toBe(0)
  })

  it('accepts the payment-signature header as well as X-PAYMENT', async () => {
    processPayment.mockResolvedValue(settled())
    const res = await POST(req(VALID_BODY, { 'payment-signature': 'signed' }))
    expect(res.status).toBe(201)
  })
})

describe('POST /api/v1/human-do — replay protection', () => {
  it('rejects a second task paid with the same transaction', async () => {
    processPayment.mockResolvedValue(settled())

    const first = await POST(req(VALID_BODY, { 'X-PAYMENT': 'header' }))
    expect(first.status).toBe(201)

    const second = await POST(req(VALID_BODY, { 'X-PAYMENT': 'header' }))
    expect(second.status).toBe(409)
    expect((await second.json()).error).toMatch(/already used/i)
  })

  it('leaves no orphan task behind after a rejected replay', async () => {
    processPayment.mockResolvedValue(settled())
    await POST(req(VALID_BODY, { 'X-PAYMENT': 'header' }))
    await POST(req(VALID_BODY, { 'X-PAYMENT': 'header' }))
    // Exactly one task, and one payment — the replay's task was rolled back so
    // no unpaid task reaches the board.
    expect(state.tasks.size).toBe(1)
    expect(state.payments.size).toBe(1)
  })

  it('allows a distinct transaction to create another task', async () => {
    processPayment.mockResolvedValueOnce(settled('0.0.1@111.1'))
    processPayment.mockResolvedValueOnce(settled('0.0.1@222.2'))
    expect((await POST(req(VALID_BODY, { 'X-PAYMENT': 'a' }))).status).toBe(201)
    expect((await POST(req(VALID_BODY, { 'X-PAYMENT': 'b' }))).status).toBe(201)
    expect(state.tasks.size).toBe(2)
  })
})

describe('POST /api/v1/human-do — input validation', () => {
  beforeEach(() => processPayment.mockResolvedValue(settled()))

  it('rejects malformed JSON', async () => {
    const bad = new Request('http://localhost:3000/api/v1/human-do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PAYMENT': 'h' },
      body: '{not json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
    expect((await POST(bad)).status).toBe(400)
  })

  it('rejects an invalid budget', async () => {
    const res = await POST(
      req({ ...VALID_BODY, budget_usdt: 'free' }, { 'X-PAYMENT': 'h' })
    )
    expect(res.status).toBe(400)
    expect(state.tasks.size).toBe(0)
  })

  it('rejects an empty intent', async () => {
    const res = await POST(req({ ...VALID_BODY, intent: '' }, { 'X-PAYMENT': 'h' }))
    expect(res.status).toBe(400)
  })

  it('attaches a freshness challenge to every task', async () => {
    const res = await POST(req(VALID_BODY, { 'X-PAYMENT': 'h' }))
    const body = await res.json()
    // Guards against a stale/stock photo: the code cannot appear in an old image.
    expect(body.proof_spec.challenge).toBeTruthy()
    expect(typeof body.proof_spec.challenge).toBe('string')
  })

  it('plans a proof_spec when the caller omits one', async () => {
    const res = await POST(
      req({ intent: 'Check the shop', budget_usdt: '0.50' }, { 'X-PAYMENT': 'h' })
    )
    expect(res.status).toBe(201)
    expect((await res.json()).proof_spec.type).toBe('photo')
  })
})

describe('POST /api/v1/human-do — demo bypass', () => {
  it('is disabled when ADMIN_SECRET is unset', async () => {
    delete process.env.ADMIN_SECRET
    const res = await POST(req(VALID_BODY, { 'X-DEMO-KEY': 'anything' }))
    expect(res.status).toBe(402)
    expect(state.tasks.size).toBe(0)
  })

  it('ignores a wrong demo key', async () => {
    process.env.ADMIN_SECRET = 'correct-secret'
    process.env.ALLOW_DEMO_BYPASS = 'true'
    const res = await POST(req(VALID_BODY, { 'X-DEMO-KEY': 'wrong-secret' }))
    expect(res.status).toBe(402)
    delete process.env.ADMIN_SECRET
    delete process.env.ALLOW_DEMO_BYPASS
  })
})
