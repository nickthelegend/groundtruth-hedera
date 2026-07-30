import { describe, it, expect, beforeAll, vi } from 'vitest'

// lib/money derives its decimal scale from env at module load, so the env must
// be set before the dynamic import below.
let money: typeof import('../lib/money')

describe('money — USDC (6 decimals)', () => {
  beforeAll(async () => {
    process.env.PAYMENT_ASSET_ID = '0.0.429274'
    delete process.env.PAYMENT_ASSET_DECIMALS
    money = await import('../lib/money')
  })

  it('resolves 6 decimals for a token asset', () => {
    expect(money.paymentDecimals).toBe(6)
  })

  it('converts whole amounts', () => {
    expect(money.toUnits('1')).toBe(1_000_000n)
    expect(money.toUnits('2.00')).toBe(2_000_000n)
    expect(money.toUnits('0')).toBe(0n)
  })

  it('converts fractional amounts without floating point error', () => {
    expect(money.toUnits('0.1')).toBe(100_000n)
    expect(money.toUnits('0.000001')).toBe(1n)
    // 0.1 + 0.2 in float is 0.30000000000000004; in atomic units it is exact.
    expect(money.toUnits('0.1') + money.toUnits('0.2')).toBe(money.toUnits('0.3'))
  })

  it('truncates beyond the asset precision rather than rounding up', () => {
    // Rounding up would let a caller pay less than they appear to.
    expect(money.toUnits('1.9999999')).toBe(1_999_999n)
  })

  it('round-trips through fromUnits', () => {
    for (const v of ['0', '1', '0.5', '2.25', '1234.567891']) {
      expect(money.fromUnits(money.toUnits(v))).toBe(
        // fromUnits trims trailing zeros, so compare against the trimmed form
        v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v
      )
    }
  })

  it('handles very large amounts without precision loss', () => {
    const big = '9007199254740.991' // beyond Number.MAX_SAFE_INTEGER in atomic units
    expect(money.fromUnits(money.toUnits(big))).toBe(big)
  })

  it('handles negative amounts symmetrically', () => {
    expect(money.toUnits('-1.5')).toBe(-1_500_000n)
    expect(money.fromUnits(-1_500_000n)).toBe('-1.5')
  })
})

describe('money — HBAR (8 decimals)', () => {
  let hbar: typeof import('../lib/money')

  beforeAll(async () => {
    process.env.PAYMENT_ASSET_ID = '0.0.0'
    delete process.env.PAYMENT_ASSET_DECIMALS
    vi.resetModules()
    hbar = await import('../lib/money')
  })

  it('resolves 8 decimals for native HBAR', () => {
    expect(hbar.paymentDecimals).toBe(8)
  })

  it('prices in tinybars, not micro-units', () => {
    // The bug this guards: a 6-decimal assumption made "2.00" mean 0.02 HBAR.
    expect(hbar.toUnits('2.00')).toBe(200_000_000n)
    expect(hbar.toUnits('0.5')).toBe(50_000_000n)
    expect(hbar.toUnits('0.00000001')).toBe(1n) // one tinybar
  })
})


describe('splitBudget', () => {
  beforeAll(async () => {
    process.env.PAYMENT_ASSET_ID = '0.0.429274'
    delete process.env.PAYMENT_ASSET_DECIMALS
    vi.resetModules()
    money = await import('../lib/money')
  })

  it('splits at the configured basis points', () => {
    const { feeUnits, payoutUnits } = money.splitBudget('2.00', 1200)
    expect(feeUnits).toBe(240_000n) // 12% of 2.00
    expect(payoutUnits).toBe(1_760_000n)
  })

  it('never loses or creates value', () => {
    for (const budget of ['2.00', '0.01', '1234.567891', '0.000003']) {
      for (const bps of [0, 1, 1200, 9999, 10000]) {
        const { feeUnits, payoutUnits } = money.splitBudget(budget, bps)
        expect(feeUnits + payoutUnits).toBe(money.toUnits(budget))
        expect(feeUnits).toBeGreaterThanOrEqual(0n)
        expect(payoutUnits).toBeGreaterThanOrEqual(0n)
      }
    }
  })

  it('rounds the fee down, favouring the worker', () => {
    // 3 units at 12% is 0.36 — the fee truncates to 0 so the worker keeps it all.
    const { feeUnits, payoutUnits } = money.splitBudget('0.000003', 1200)
    expect(feeUnits).toBe(0n)
    expect(payoutUnits).toBe(3n)
  })

  it('gives everything to the platform only at 100%', () => {
    const { feeUnits, payoutUnits } = money.splitBudget('2.00', 10000)
    expect(payoutUnits).toBe(0n)
    expect(feeUnits).toBe(2_000_000n)
  })
})
