const USDT_DECIMALS = 6n
const USDT_SCALE = 10n ** USDT_DECIMALS  // 1_000_000n

export function toUnits(usdt: string): bigint {
  const [whole, frac = ''] = usdt.split('.')
  const fracPadded = frac.padEnd(Number(USDT_DECIMALS), '0').slice(0, Number(USDT_DECIMALS))
  return BigInt(whole) * USDT_SCALE + BigInt(fracPadded)
}

export function fromUnits(units: bigint): string {
  const whole = units / USDT_SCALE
  const frac = units % USDT_SCALE
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(Number(USDT_DECIMALS), '0').replace(/0+$/, '')}`
}

export function splitBudget(
  budgetUsdt: string,
  feeBps: number
): { feeUnits: bigint; payoutUnits: bigint } {
  const total = toUnits(budgetUsdt)
  const feeBpsN = BigInt(feeBps)
  const feeUnits = (total * feeBpsN) / 10000n
  const payoutUnits = total - feeUnits
  return { feeUnits, payoutUnits }
}
