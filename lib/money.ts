// Decimal-string ↔ atomic-unit conversion for the configured payment asset.
//
// The decimal count is NOT a constant: USDC on Hedera uses 6, but native HBAR
// is denominated in tinybars at 8. Hardcoding 6 would silently charge 0.02 HBAR
// for a task priced "2.00", so the scale is derived from the same env the rest
// of the app reads.
//
// Read from process.env directly rather than importing ./hedera, to keep this
// module free of import cycles — it is imported almost everywhere.

const HBAR_ASSET_ID = '0.0.0'

function assetDecimals(): number {
  const explicit = process.env.PAYMENT_ASSET_DECIMALS
  if (explicit) return Number(explicit)
  const asset = process.env.PAYMENT_ASSET_ID ?? ''
  return asset === HBAR_ASSET_ID ? 8 : 6
}

const DECIMALS = BigInt(assetDecimals())
const SCALE = 10n ** DECIMALS

/** Decimal string ("2.00") → atomic units (2_000_000n at 6dp). */
export function toUnits(amount: string): bigint {
  const negative = amount.trim().startsWith('-')
  const [whole, frac = ''] = amount.trim().replace(/^[-+]/, '').split('.')
  const fracPadded = frac.padEnd(Number(DECIMALS), '0').slice(0, Number(DECIMALS))
  const units = BigInt(whole || '0') * SCALE + BigInt(fracPadded || '0')
  return negative ? -units : units
}

/** Atomic units → decimal string, trailing zeros trimmed. */
export function fromUnits(units: bigint): string {
  const negative = units < 0n
  const abs = negative ? -units : units
  const whole = abs / SCALE
  const frac = abs % SCALE
  const body =
    frac === 0n
      ? whole.toString()
      : `${whole}.${frac.toString().padStart(Number(DECIMALS), '0').replace(/0+$/, '')}`
  return negative ? `-${body}` : body
}

export function splitBudget(
  budget: string,
  feeBps: number
): { feeUnits: bigint; payoutUnits: bigint } {
  const total = toUnits(budget)
  const feeUnits = (total * BigInt(feeBps)) / 10000n
  const payoutUnits = total - feeUnits
  return { feeUnits, payoutUnits }
}

/** Decimals actually in use — handy for display and for scheme metadata. */
export const paymentDecimals = Number(DECIMALS)
