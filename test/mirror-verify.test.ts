import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

let verifyPaymentOnMirror: typeof import('../lib/mirror-verify').verifyPaymentOnMirror

const PAYEE = '0.0.9847867'
const PAYER = '0.0.9847870'
const FEE_PAYER = '0.0.7162784' // the x402 facilitator
const TX = '0.0.7162784@1785448933.726761986'

const realFetch = globalThis.fetch

beforeAll(async () => {
  process.env.HEDERA_NETWORK = 'hedera:testnet'
  process.env.PAYMENT_ASSET_ID = '0.0.0'
  process.env.HEDERA_OPERATOR_ID = PAYEE
  process.env.PAY_TO_ACCOUNT = PAYEE
  // Keep the retry path exercised but fast — production waits ~9s for mirror lag.
  process.env.MIRROR_LOOKUP_ATTEMPTS = '2'
  process.env.MIRROR_LOOKUP_DELAY_MS = '10'
  ;({ verifyPaymentOnMirror } = await import('../lib/mirror-verify'))
})

afterAll(() => {
  globalThis.fetch = realFetch
})

function mockMirror(body: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch
}

/**
 * The exact shape that caused a live failure: one transaction id returning TWO
 * records, the child CRYPTOUPDATEACCOUNT first (empty transfers, from the
 * payer's EVM-alias auto-creation), the real CRYPTOTRANSFER second.
 */
const REAL_TWO_RECORD_RESPONSE = {
  transactions: [
    {
      transaction_id: '0.0.7162784-1785448933-726761986',
      name: 'CRYPTOUPDATEACCOUNT',
      result: 'SUCCESS',
      consensus_timestamp: '1785448939.705625597',
      nonce: 1,
      transfers: [],
      token_transfers: [],
    },
    {
      transaction_id: '0.0.7162784-1785448933-726761986',
      name: 'CRYPTOTRANSFER',
      result: 'SUCCESS',
      consensus_timestamp: '1785448939.705625598',
      nonce: 0,
      transfers: [
        { account: '0.0.802', amount: 292432 }, // node fee
        { account: FEE_PAYER, amount: -292432 }, // facilitator pays the fee
        { account: PAYER, amount: -50000000 }, // the actual payment
        { account: PAYEE, amount: 50000000 },
      ],
      token_transfers: [],
    },
  ],
}

describe('verifyPaymentOnMirror — multi-record responses', () => {
  beforeEach(() => {
    globalThis.fetch = realFetch
  })

  it('finds the payment when a child record is returned first', async () => {
    // Regression: reading transactions[0] found an empty transfer list and
    // reported every genuine payment as unconfirmed.
    mockMirror(REAL_TWO_RECORD_RESPONSE)
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 50000000n })
    expect(result.valid).toBe(true)
    expect(result.amountUnits).toBe(50000000n)
  })

  it('attributes the payer to the sender, not the fee payer', async () => {
    // The facilitator is debited too (network fees) and appears in the same
    // list. Reporting it as the payer would misattribute every payment.
    mockMirror(REAL_TWO_RECORD_RESPONSE)
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 50000000n })
    expect(result.payer).toBe(PAYER)
    expect(result.payer).not.toBe(FEE_PAYER)
  })

  it('reports the consensus timestamp of the record holding the transfer', async () => {
    mockMirror(REAL_TWO_RECORD_RESPONSE)
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 50000000n })
    expect(result.consensusTimestamp).toBe('1785448939.705625598')
  })
})

describe('verifyPaymentOnMirror — rejection cases', () => {
  it('rejects a missing transaction id', async () => {
    const result = await verifyPaymentOnMirror({ txId: undefined, requiredUnits: 1n })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/missing transaction id/)
  })

  it('rejects a transaction with no mirror record', async () => {
    mockMirror({ transactions: [] })
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 1n })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/not found/)
  })

  it('rejects a failed transaction', async () => {
    mockMirror({
      transactions: [
        {
          transaction_id: 'x',
          name: 'CRYPTOTRANSFER',
          result: 'INSUFFICIENT_ACCOUNT_BALANCE',
          consensus_timestamp: '1.0',
          transfers: [],
        },
      ],
    })
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 1n })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/INSUFFICIENT_ACCOUNT_BALANCE/)
  })

  it('rejects a payment credited to a different account', async () => {
    mockMirror({
      transactions: [
        {
          transaction_id: 'x',
          name: 'CRYPTOTRANSFER',
          result: 'SUCCESS',
          consensus_timestamp: '1.0',
          transfers: [
            { account: PAYER, amount: -50000000 },
            { account: '0.0.999999', amount: 50000000 }, // someone else
          ],
        },
      ],
    })
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 50000000n })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/no HBAR credited/)
  })

  it('rejects an underpayment', async () => {
    mockMirror({
      transactions: [
        {
          transaction_id: 'x',
          name: 'CRYPTOTRANSFER',
          result: 'SUCCESS',
          consensus_timestamp: '1.0',
          transfers: [
            { account: PAYER, amount: -1 },
            { account: PAYEE, amount: 1 },
          ],
        },
      ],
    })
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 50000000n })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/< required/)
  })

  it('rejects when the payer is not the expected one', async () => {
    mockMirror(REAL_TWO_RECORD_RESPONSE)
    const result = await verifyPaymentOnMirror({
      txId: TX,
      requiredUnits: 50000000n,
      expectedPayer: '0.0.111111',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/does not match expected/)
  })

  it('fails closed when the mirror node is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const result = await verifyPaymentOnMirror({ txId: TX, requiredUnits: 1n })
    expect(result.valid).toBe(false)
  }, 30_000)
})

describe('verifyPaymentOnMirror — token payments', () => {
  it('only counts transfers of the configured token', async () => {
    process.env.PAYMENT_ASSET_ID = '0.0.429274'
    vi.resetModules()
    const { verifyPaymentOnMirror: verifyToken } = await import('../lib/mirror-verify')

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        transactions: [
          {
            transaction_id: 'x',
            name: 'CRYPTOTRANSFER',
            result: 'SUCCESS',
            consensus_timestamp: '1.0',
            transfers: [{ account: PAYEE, amount: 999999999 }], // HBAR, must be ignored
            token_transfers: [
              // A different token paid to us — must not count.
              { token_id: '0.0.111111', account: PAYEE, amount: 5000000 },
              { token_id: '0.0.429274', account: PAYER, amount: -2000000 },
              { token_id: '0.0.429274', account: PAYEE, amount: 2000000 },
            ],
          },
        ],
      }),
    })) as unknown as typeof fetch

    const ok = await verifyToken({ txId: TX, requiredUnits: 2000000n })
    expect(ok.valid).toBe(true)
    expect(ok.amountUnits).toBe(2000000n)

    const tooMuch = await verifyToken({ txId: TX, requiredUnits: 3000000n })
    expect(tooMuch.valid).toBe(false)
  })
})
