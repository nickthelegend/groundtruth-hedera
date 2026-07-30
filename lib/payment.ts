import { toUnits, splitBudget } from './money'
import { verifyPayment as x402Verify, settlePayment as x402Settle, buildChallenge } from './x402'
import { verifyPaymentOnMirror } from './mirror-verify'
import { PAYMENT_ASSET_SYMBOL, explorerTx } from './hedera'

// ── Payment orchestration ─────────────────────────────────────────────────────
//
// One function the API routes call to turn an inbound payment header into a
// decision. Three gates, in order, all fail-closed:
//
//   1. Facilitator VERIFY   — is the signed transaction well-formed and fundable?
//   2. Facilitator SETTLE   — submit it to Hedera, get a real transaction id.
//   3. Mirror Node CONFIRM  — independently re-derive the transfer from Hedera's
//                             public record before we believe step 2.
//
// Step 3 exists because a resource server should not take a facilitator's word
// for it. If the facilitator says "settled" but no matching credit appears in
// consensus, we reject.

const PRICE = process.env.ASP_PRICE_USDT ?? '2.00'
const FEE_BPS = Number(process.env.ASP_FEE_BPS ?? '1200')

export interface PaymentResult {
  success: boolean
  reason?: string
  paymentRef: string
  payerAccount: string
  txId?: string
  explorer?: string
  amountUnits: bigint
  feeUnits: bigint
  payoutUnits: bigint
  /** Set when the facilitator settled but Mirror Node could not confirm it yet. */
  unconfirmed?: boolean
}

export { buildChallenge }

function failed(taskId: string, reason: string, budget?: string): PaymentResult {
  const { feeUnits, payoutUnits } = splitBudget(budget ?? PRICE, FEE_BPS)
  return {
    success: false,
    reason,
    paymentRef: `invalid-${taskId}-${Date.now()}`,
    payerAccount: '0.0.0',
    amountUnits: toUnits(budget ?? PRICE),
    feeUnits,
    payoutUnits,
  }
}

/**
 * Verify, settle, and independently confirm a payment for `taskId`.
 *
 * `budgetUsdt` lets a caller pay more than the list price for a task; the split
 * between platform fee and worker payout is derived from what was actually paid,
 * not from the configured price.
 */
export async function processPayment(
  paymentHeader: string,
  taskId: string,
  budgetUsdt?: string
): Promise<PaymentResult> {
  const price = budgetUsdt ?? PRICE

  // ── 1. Verify ───────────────────────────────────────────────────────────────
  const verification = await x402Verify(paymentHeader, price)
  if (!verification.valid) {
    return failed(taskId, verification.reason ?? 'payment verification failed', price)
  }

  // ── 2. Settle ───────────────────────────────────────────────────────────────
  const settlement = await x402Settle(paymentHeader, price)
  if (!settlement.success || !settlement.txId) {
    return failed(taskId, settlement.reason ?? 'payment settlement failed', price)
  }

  const paidUnits = settlement.amountUnits ?? toUnits(price)
  const feeBps = BigInt(FEE_BPS)
  const feeUnits = (paidUnits * feeBps) / 10000n
  const payoutUnits = paidUnits - feeUnits
  const payer = settlement.payer ?? verification.payer ?? '0.0.0'

  // ── 3. Confirm against Hedera's public record ───────────────────────────────
  const confirmation = await verifyPaymentOnMirror({
    txId: settlement.txId,
    requiredUnits: toUnits(price),
    expectedPayer: settlement.payer,
  })

  if (!confirmation.valid) {
    // The facilitator claimed success but consensus does not (yet) show the
    // credit. Mirror lag is the benign case, so surface the task as paid-but-
    // unconfirmed rather than silently trusting or silently dropping it.
    return {
      success: false,
      reason: `settled but unconfirmed on mirror node: ${confirmation.reason}`,
      paymentRef: `hedera-${settlement.txId}`,
      payerAccount: payer,
      txId: settlement.txId,
      explorer: explorerTx(settlement.txId),
      amountUnits: paidUnits,
      feeUnits,
      payoutUnits,
      unconfirmed: true,
    }
  }

  return {
    success: true,
    // Bind the payment ref to the Hedera transaction id so a replayed header
    // collides on the DB unique constraint no matter what else it claims.
    paymentRef: `hedera-${settlement.txId}`,
    payerAccount: confirmation.payer ?? payer,
    txId: settlement.txId,
    explorer: explorerTx(settlement.txId),
    amountUnits: confirmation.amountUnits ?? paidUnits,
    feeUnits,
    payoutUnits,
  }
}

/** Human-readable price line used in MCP tool descriptions and the 402 body. */
export function priceLabel(budget?: string): string {
  return `${budget ?? PRICE} ${PAYMENT_ASSET_SYMBOL}`
}
