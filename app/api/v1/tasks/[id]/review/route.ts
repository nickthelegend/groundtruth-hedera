import { NextRequest, NextResponse } from 'next/server'
import { getTask, transition } from '@/lib/db'
import { settleTask } from '@/lib/settle'

// Agent verification: the calling agent reviews the submitted proof and
// accepts or rejects it. Accept → task verified + on-chain payout to the
// worker. Reject → task failed (no payout). This is what makes GroundTruth a
// buyer-driven marketplace rather than the server second-guessing the agent.
//
// Auth: the paying agent proves identity with either the task's payment_ref
// (returned to it out-of-band) or the server ADMIN_SECRET (used by the MCP
// server on the agent's behalf).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { decision?: string; reason?: string; payment_ref?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const decision = body.decision
  if (decision !== 'accept' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be "accept" or "reject"' }, { status: 400 })
  }

  const task = await getTask(params.id)
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const adminSecret = process.env.ADMIN_SECRET
  const demoKey = req.headers.get('X-DEMO-KEY')
  const authed =
    (!!adminSecret && demoKey === adminSecret) ||
    (!!task.payment_ref && !!body.payment_ref && body.payment_ref === task.payment_ref)
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized — provide the task payment_ref or admin key' }, { status: 401 })
  }

  if (task.status !== 'submitted') {
    return NextResponse.json(
      { error: `Task is not awaiting review (status: ${task.status})` },
      { status: 409 }
    )
  }

  // ── Reject ──
  if (decision === 'reject') {
    const failed = await transition(params.id, 'submitted', 'failed', {
      resolved_at: new Date().toISOString(),
    })
    if (!failed) return NextResponse.json({ error: 'Transition failed' }, { status: 409 })
    return NextResponse.json({ task_id: params.id, outcome: 'rejected', reason: body.reason ?? null })
  }

  // ── Accept → verify + on-chain payout ──
  const verified = await transition(params.id, 'submitted', 'verified', {
    resolved_at: new Date().toISOString(),
  })
  if (!verified) return NextResponse.json({ error: 'Transition failed' }, { status: 409 })

  const settle = await settleTask(
    params.id,
    task.worker_wallet ?? '',
    task.payment_ref ?? '',
    task.budget_usdt
  )

  return NextResponse.json({
    task_id: params.id,
    outcome: 'accepted',
    worker: task.worker_wallet,
    settle,
  })
}
