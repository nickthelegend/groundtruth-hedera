import { NextRequest, NextResponse } from 'next/server'
import { getTask, transition } from '@/lib/db'
import { settleTask } from '@/lib/settle'

// Simple secret-based auth for admin endpoints
function isAuthorized(req: NextRequest): boolean {
  const configured = process.env.ADMIN_SECRET
  if (!configured) return false // no admin secret set → admin endpoints are closed
  return req.headers.get('x-admin-secret') === configured
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action } = body
  if (!action || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const task = await getTask(params.id)
  if (!task || task.status !== 'needs_review') {
    return NextResponse.json({ error: 'Task not in needs_review state' }, { status: 409 })
  }

  if (action === 'reject') {
    await transition(params.id, 'needs_review', 'failed', {
      resolved_at: new Date().toISOString(),
    })
    return NextResponse.json({ task_id: params.id, outcome: 'failed' })
  }

  // Approve — transition to verified then settle
  const verified = await transition(params.id, 'needs_review', 'verified', {
    resolved_at: new Date().toISOString(),
  })
  if (!verified) {
    return NextResponse.json({ error: 'Transition failed' }, { status: 409 })
  }

  const settleResult = await settleTask(
    params.id,
    task.worker_wallet ?? '',
    task.payment_ref ?? '',
    task.budget_usdt
  )

  return NextResponse.json({
    task_id: params.id,
    outcome: 'verified',
    settle: settleResult,
  })
}
