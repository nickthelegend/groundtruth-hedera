import { NextRequest, NextResponse } from 'next/server'
import { HumanDoInputSchema } from '@/lib/types'
import { buildChallenge, processPayment } from '@/lib/payment'
import { recordPaymentRef, insertTask, deleteTask } from '@/lib/db'
import { planTask } from '@/lib/planner'
import { generateChallenge } from '@/lib/challenge'
import { toUnits, splitBudget } from '@/lib/money'

// Settlement is slow by nature: the facilitator submits to Hedera, then we poll
// a public Mirror Node until consensus catches up. That routinely runs 15-25s,
// well past Vercel's 10s default — and a truncated request here would abort
// AFTER funds moved. 60s is the Hobby ceiling and is comfortably enough.
export const maxDuration = 60


/**
 * Remove a task created just before a payment could be recorded.
 *
 * Never throws — the caller is already returning an error — but a failure here
 * leaves an unpaid task visible on the board, so it must be loud in the log.
 */
async function rollbackTask(taskId: string, reason: string): Promise<void> {
  try {
    const removed = await deleteTask(taskId)
    if (!removed) {
      console.error(`[human-do] ORPHAN TASK ${taskId}: rollback after ${reason} deleted nothing`)
    }
  } catch (e) {
    console.error(
      `[human-do] ORPHAN TASK ${taskId}: rollback after ${reason} threw:`,
      e instanceof Error ? e.message : e
    )
  }
}

/** The floor a caller's `budget_usdt` must meet. Paying more is allowed. */
const LIST_PRICE = process.env.ASP_PRICE_USDT ?? '2.00'

// Task creation, gated by an x402 payment settled on Hedera.
//
// GET returns the 402 challenge so an agent can discover the price without
// paying. POST requires a signed payment header; the payment is verified by the
// facilitator, settled on Hedera, and independently re-confirmed against a
// public Mirror Node before any task is created.

export async function POST(req: NextRequest) {
  const paymentHeader =
    req.headers.get('X-PAYMENT') ??
    req.headers.get('x-payment') ??
    req.headers.get('payment-signature')

  // Demo bypass creates a task WITHOUT payment, so it is off by default and
  // needs two independent opt-ins: a configured ADMIN_SECRET *and* an explicit
  // ALLOW_DEMO_BYPASS=true. A single stray env var should never turn a paid API
  // into a free one, and on a payments product a reachable bypass is a
  // liability — so it is refused outright in production.
  const demoKey = req.headers.get('X-DEMO-KEY')
  const adminSecret = process.env.ADMIN_SECRET
  const bypassAllowed =
    process.env.ALLOW_DEMO_BYPASS === 'true' && process.env.NODE_ENV !== 'production'
  const isDemoMode = bypassAllowed && !!adminSecret && demoKey === adminSecret

  if (!paymentHeader && !isDemoMode) {
    return NextResponse.json(await buildChallenge(), { status: 402 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = HumanDoInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const input = parsed.data

  // `budget_usdt` is caller-supplied and becomes the price the whole payment
  // pipeline enforces — verify, settle, and the mirror gate all check against
  // it. Without a floor a caller could ask for a task, declare a budget of
  // 0.000001, pay that, and clear all three gates legitimately. The schema only
  // constrains the format, so the price floor has to be applied here.
  if (toUnits(input.budget_usdt) < toUnits(LIST_PRICE)) {
    return NextResponse.json(
      {
        ...(await buildChallenge('/api/v1/human-do')),
        error: `budget_usdt must be at least the list price of ${LIST_PRICE}`,
      },
      { status: 402 }
    )
  }

  // Generated early so the payment reference can be bound to this task.
  const taskId = crypto.randomUUID()

  let paymentRef: string
  let amountUnits: bigint
  let feeUnits: bigint
  let payerAccount: string
  let txId: string

  if (isDemoMode) {
    const split = splitBudget(input.budget_usdt, Number(process.env.ASP_FEE_BPS ?? '1200'))
    paymentRef = `demo-${taskId}`
    amountUnits = toUnits(input.budget_usdt)
    feeUnits = split.feeUnits
    payerAccount = '0.0.0'
    txId = ''
  } else {
    const result = await processPayment(paymentHeader!, taskId, input.budget_usdt)
    if (!result.success) {
      const challenge = await buildChallenge('/api/v1/human-do', input.budget_usdt)
      return NextResponse.json(
        {
          ...challenge,
          error: result.reason ?? 'Payment required',
          // A settled-but-unconfirmed payment is recoverable, so hand back the
          // transaction id rather than leaving the caller unable to reconcile.
          ...(result.unconfirmed
            ? { settled_unconfirmed: true, tx_id: result.txId, explorer: result.explorer }
            : {}),
        },
        { status: 402 }
      )
    }
    paymentRef = result.paymentRef
    amountUnits = result.amountUnits
    feeUnits = result.feeUnits
    payerAccount = result.payerAccount
    txId = result.txId ?? ''
  }

  // Use the planner when no explicit proof_spec was supplied. Attach a per-task
  // freshness challenge the worker must include in the proof, so a stale or
  // stock image (which cannot contain this code) is rejected.
  const baseSpec = input.proof_spec ?? (await planTask(input.intent)).proof_spec
  const proofSpec = { ...baseSpec, challenge: generateChallenge() }

  // Payment is settled on Hedera by this point. Any failure below must not
  // silently swallow captured funds — surface it with the transaction id.
  const expiresAt = new Date(Date.now() + (input.timeout_seconds ?? 3600) * 1000)
  let task
  try {
    task = await insertTask({
      intent: input.intent,
      proof_spec: proofSpec,
      budget_usdt: input.budget_usdt,
      expires_at: expiresAt,
      payment_ref: paymentRef,
    })
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : err && typeof err === 'object'
          ? JSON.stringify(err)
          : String(err)
    console.error('[human-do] insertTask failed:', detail)
    return NextResponse.json(
      {
        error: 'Task creation failed after payment was captured',
        payment_ref: paymentRef,
        tx_id: txId || null,
        detail,
      },
      { status: 500 }
    )
  }

  if (!isDemoMode) {
    let recorded = false
    try {
      recorded = await recordPaymentRef({
        payment_ref: paymentRef,
        task_id: task.id,
        amount_units: amountUnits,
        fee_units: feeUnits,
        payer_address: payerAccount,
        tx_hash: txId,
      })
    } catch (err) {
      // DB error recording payment — roll back the orphan task, then report.
      // A failed rollback would leave an unpaid task on the public board, so it
      // is logged rather than swallowed: silence here is the one case where the
      // "payment clears three gates before a task exists" invariant can break.
      await rollbackTask(task.id, 'payment record failed')
      return NextResponse.json(
        {
          error: 'Failed to record payment',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 }
      )
    }
    if (!recorded) {
      // Replayed payment (payment_ref or tx id already used) — remove the
      // just-created task so no unpaid orphan remains on the board.
      await rollbackTask(task.id, 'replayed payment')
      return NextResponse.json({ error: 'Payment already used' }, { status: 409 })
    }
  }

  return NextResponse.json(
    {
      task_id: task.id,
      status: task.status,
      intent: task.intent,
      proof_spec: task.proof_spec,
      budget_usdt: task.budget_usdt,
      expires_at: task.expires_at,
      payment: {
        network: process.env.HEDERA_NETWORK ?? 'hedera:testnet',
        tx_id: txId || null,
        payer: payerAccount,
      },
      poll_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/v1/tasks/${task.id}`,
    },
    { status: 201 }
  )
}

export async function GET() {
  // GET returns the 402 challenge so agents can discover payment requirements.
  return NextResponse.json(await buildChallenge(), { status: 402 })
}
