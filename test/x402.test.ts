import { describe, it, expect, beforeAll, vi } from 'vitest'

// The server-side guard on an inbound payment. A client echoes back which
// requirement it paid; these tests assert we re-derive our own requirements and
// refuse anything that would let a caller pay less, pay in the wrong asset, or
// redirect the money — BEFORE the facilitator is ever consulted.

const PAYEE = '0.0.9847867'

let x402: typeof import('../lib/x402')

const FACILITATOR_SUPPORTED = {
  kinds: [
    {
      x402Version: 2,
      scheme: 'exact',
      network: 'hedera:testnet',
      extra: { feePayer: '0.0.7162784' },
    },
  ],
  extensions: [],
}

beforeAll(async () => {
  process.env.HEDERA_NETWORK = 'hedera:testnet'
  process.env.PAYMENT_ASSET_ID = '0.0.0'
  process.env.HEDERA_OPERATOR_ID = PAYEE
  process.env.PAY_TO_ACCOUNT = PAYEE
  process.env.ASP_PRICE_USDT = '0.50'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

  // Serve the facilitator's /supported so initialize() works offline. Any
  // verify/settle call is a test failure in this file — none should reach it.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/supported')) {
      // A real Response — the SDK reads it with .text(), not .json().
      return new Response(JSON.stringify(FACILITATOR_SUPPORTED), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected facilitator call: ${url}`)
  }) as unknown as typeof fetch

  x402 = await import('../lib/x402')
})

/** Encode a payment header the way a client would. */
function header(accepted: Record<string, unknown>) {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted,
      payload: { transaction: 'base64-signed-hedera-tx' },
    })
  ).toString('base64')
}

function validAccepted(overrides: Record<string, unknown> = {}) {
  return {
    scheme: 'exact',
    network: 'hedera:testnet',
    asset: '0.0.0',
    amount: '50000000',
    payTo: PAYEE,
    maxTimeoutSeconds: 180,
    extra: {},
    ...overrides,
  }
}

describe('buildPaymentRequirements', () => {
  it('prices in the asset\'s atomic units', async () => {
    const req = await x402.buildPaymentRequirements('0.50')
    expect(req.amount).toBe('50000000') // 0.5 HBAR in tinybars
    expect(req.asset).toBe('0.0.0')
    expect(req.network).toBe('hedera:testnet')
    expect(req.scheme).toBe('exact')
  })

  it('merges the facilitator fee payer into extra', async () => {
    // Without this a client cannot build a transaction the facilitator co-signs.
    const req = await x402.buildPaymentRequirements('0.50')
    expect((req.extra as Record<string, unknown>).feePayer).toBe('0.0.7162784')
  })

  it('honours a per-task price override', async () => {
    const req = await x402.buildPaymentRequirements('2.00')
    expect(req.amount).toBe('200000000')
  })
})

describe('buildChallenge', () => {
  it('produces a complete 402 body', async () => {
    const challenge = await x402.buildChallenge('/api/v1/human-do', '0.50')
    expect(challenge.x402Version).toBe(2)
    expect(challenge.accepts).toHaveLength(1)
    expect(challenge.resource.url).toBe('http://localhost:3000/api/v1/human-do')
  })
})

describe('verifyPayment — rejects before reaching the facilitator', () => {
  it('rejects a malformed header', async () => {
    const result = await x402.verifyPayment('not-base64-json', '0.50')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/malformed/)
  })

  it('rejects a redirected payee', async () => {
    // The attack: pay a smaller/attacker-controlled account but claim it satisfies us.
    const result = await x402.verifyPayment(
      header(validAccepted({ payTo: '0.0.999999' })),
      '0.50'
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('wrong payTo')
  })

  it('rejects an underpayment', async () => {
    const result = await x402.verifyPayment(header(validAccepted({ amount: '1' })), '0.50')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('amount below required price')
  })

  it('rejects the wrong asset', async () => {
    // Paying 0.5 of a worthless token instead of 0.5 HBAR.
    const result = await x402.verifyPayment(
      header(validAccepted({ asset: '0.0.111111' })),
      '0.50'
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('wrong asset')
  })

  it('rejects the wrong network', async () => {
    const result = await x402.verifyPayment(
      header(validAccepted({ network: 'hedera:mainnet' })),
      '0.50'
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/wrong network/)
  })

  it('rejects an unsupported scheme', async () => {
    const result = await x402.verifyPayment(header(validAccepted({ scheme: 'upto' })), '0.50')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/unsupported scheme/)
  })

  it('rejects a payment priced for a cheaper task', async () => {
    // Header is valid for 0.50 but the task costs 2.00.
    const result = await x402.verifyPayment(header(validAccepted()), '2.00')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('amount below required price')
  })

  it('accepts an overpayment', async () => {
    // Paying more than asked is not an attack; it must reach the facilitator.
    // The facilitator call throws in this suite, which proves we got past our
    // own checks rather than short-circuiting.
    const result = await x402.verifyPayment(
      header(validAccepted({ amount: '999000000' })),
      '0.50'
    )
    expect(result.reason).not.toMatch(/amount below|wrong /)
  })
})
