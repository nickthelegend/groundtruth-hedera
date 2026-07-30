import { NextRequest, NextResponse } from 'next/server'
import { HumanDoInputSchema } from '@/lib/types'
import { buildChallenge, processPayment } from '@/lib/payment'
import { recordPaymentRef, insertTask, deleteTask } from '@/lib/db'
import { planTask } from '@/lib/planner'
import { generateChallenge } from '@/lib/challenge'
import { toUnits, splitBudget } from '@/lib/money'

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

  const demoKey = req.headers.get('X-DEMO-KEY')
  // Demo bypass is enabled ONLY when ADMIN_SECRET is explicitly configured.
  // No hardcoded fallback secret — an unset env var means demo mode is off.
  const adminSecret = process.env.ADMIN_SECRET
  const isDemoMode = !!adminSecret && demoKey === adminSecret

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
      await deleteTask(task.id).catch(() => {})
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
      await deleteTask(task.id).catch(() => {})
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
