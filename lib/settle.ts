import { createHash } from 'crypto'
import {
  transferPaymentAsset,
  isTokenAssociated,
  normalizeAccountId,
  explorerAccount,
  PAYMENT_ASSET_ID,
  PAYMENT_ASSET_SYMBOL,
  IS_HBAR,
} from './hedera'
import { anchorProof, type ProofAnchor } from './hcs'
import { transition, bumpWorker, getTask } from './db'
import { splitBudget, fromUnits } from './money'
import type { TaskResult } from './types'

// ── Worker settlement on Hedera ───────────────────────────────────────────────
//
// Once a proof is verified, two things happen on-chain:
//
//   1. PAYOUT — a native Hedera transfer of the payment asset from the treasury
//      to the worker's account. On HTS this is a single TransferTransaction, no
//      contract, no allowance dance, ~$0.001 and final in seconds.
//
//   2. ANCHOR — the proof hash and the notary verdict are written to a Hedera
//      Consensus Service topic, giving an immutable public audit trail that
//      does not depend on our database staying honest or staying up.
//
// Ordering matters: pay first, anchor second. A failed anchor must never cost a
// worker their money, so anchoring is best-effort and its outcome is recorded
// on the task rather than thrown.

const PRICE = process.env.ASP_PRICE_USDT ?? '2.00'
const FEE_BPS = Number(process.env.ASP_FEE_BPS ?? '1200')

export interface SettleResult {
  success: boolean
  txId?: string
  explorer?: string
  payout?: string
  fee?: string
  asset?: string
  anchor?: ProofAnchor
  error?: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Hash whatever the worker actually submitted. Photos are referenced by storage
 * key and forms by their field values, so the hash commits to the submission
 * without putting its contents on a public topic.
 */
function hashProof(task: { proof_payload: unknown }): string {
  return sha256(JSON.stringify(task.proof_payload ?? {}))
}

export async function settleTask(
  taskId: string,
  workerAccount: string,
  paymentRef: string,
  budget?: string
): Promise<SettleResult> {
  const task = await getTask(taskId)
  if (!task) return { success: false, error: 'task_not_found' }

  // Idempotency: if a payout is already recorded for this task, do not send a
  // second transfer. Hedera has no on-chain `settled` flag to consult here, so
  // the recorded settle block is the guard.
  const existing = ((task.result as unknown as Record<string, unknown>) ?? {}) as Record<
    string,
    unknown
  >
  const priorSettle = existing.settle as { tx_id?: string; explorer?: string } | undefined
  if (priorSettle?.tx_id) {
    return {
      success: true,
      txId: priorSettle.tx_id,
      explorer: priorSettle.explorer,
      error: 'already_settled',
    }
  }

  let worker: string
  try {
    worker = normalizeAccountId(workerAccount)
  } catch {
    return { success: false, error: `invalid_worker_account: ${workerAccount}` }
  }

  const { payoutUnits, feeUnits } = splitBudget(budget ?? task.budget_usdt ?? PRICE, FEE_BPS)

  // HTS tokens cannot be sent to an account that has not associated them. Check
  // first so the worker gets a clear instruction instead of an opaque
  // TOKEN_NOT_ASSOCIATED_TO_ACCOUNT failure.
  if (!IS_HBAR) {
    const associated = await isTokenAssociated(worker)
    if (!associated) {
      return {
        success: false,
        error: `worker_not_associated: account ${worker} must associate token ${PAYMENT_ASSET_ID} (${PAYMENT_ASSET_SYMBOL}) before it can be paid`,
      }
    }
  }

  // ── 1. Pay the worker ───────────────────────────────────────────────────────
  let txId: string
  let explorer: string
  try {
    const transfer = await transferPaymentAsset(worker, payoutUnits)
    txId = transfer.txId
    explorer = transfer.explorer
  } catch (e) {
    // Payout failed — preserve the verification result so the notary verdict is
    // not lost, and report the failure rather than marking the task settled.
    await transition(taskId, 'verified', 'verified', {
      result: { checks: [], ...existing, outcome: 'verified', confidence: 1 } as unknown as TaskResult,
    }).catch(() => {})
    return {
      success: false,
      error: `payout_failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // ── 2. Anchor the proof to HCS (best effort) ────────────────────────────────
  const notary = existing.notary as { decision?: string; confidence?: number } | undefined
  const anchor = await anchorProof({
    v: 1,
    taskId,
    proofHash: hashProof(task),
    intentHash: sha256(task.intent ?? ''),
    verdict: (notary?.decision as 'accept' | 'reject' | 'uncertain') ?? 'accept',
    confidence: notary?.confidence ?? 1,
    worker,
    payoutUnits: payoutUnits.toString(),
    asset: PAYMENT_ASSET_ID,
    at: new Date().toISOString(),
  })

  await bumpWorker({
    wallet: worker,
    earned_units: payoutUnits,
    outcome: 'completed',
  }).catch(() => {})

  const payout = fromUnits(payoutUnits)

  // Merge the settlement into the existing result so the notary verdict, checks,
  // and vision output all survive to the done screen and to task_status.
  await transition(taskId, 'verified', 'verified', {
    result: {
      checks: [],
      ...existing,
      outcome: 'verified',
      confidence: 1,
      settle: {
        worker,
        worker_explorer: explorerAccount(worker),
        asset: PAYMENT_ASSET_ID,
        asset_symbol: PAYMENT_ASSET_SYMBOL,
        payout,
        fee: fromUnits(feeUnits),
        tx_id: txId,
        explorer,
        payment_ref: paymentRef,
        anchor,
        settled_at: new Date().toISOString(),
      },
    } as unknown as TaskResult,
  }).catch(() => {})

  return {
    success: true,
    txId,
    explorer,
    payout,
    fee: fromUnits(feeUnits),
    asset: PAYMENT_ASSET_SYMBOL,
    anchor,
  }
}
