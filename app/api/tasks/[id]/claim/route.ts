import { NextRequest, NextResponse } from 'next/server'
import { claimTask } from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: { worker_wallet?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { worker_wallet } = body
  if (!worker_wallet?.match(/^\d+\.\d+\.\d+$/)) {
    return NextResponse.json(
      { error: 'Invalid Hedera account id. Expected the form 0.0.12345.' },
      { status: 400 }
    )
  }

  const claimExpiry = new Date(Date.now() + 30 * 60 * 1000) // 30 min to complete
  const task = await claimTask(params.id, worker_wallet, claimExpiry)

  if (!task) {
    return NextResponse.json(
      { error: 'Task not available — already claimed or expired' },
      { status: 409 }
    )
  }

  return NextResponse.json({ task_id: task.id, status: task.status, expires_at: task.expires_at })
}
