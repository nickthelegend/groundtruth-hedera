import { NextRequest, NextResponse } from 'next/server'
import { getTask } from '@/lib/db'

// Never cache task reads — the UI polls this for live status (claimed →
// submitted → verified). Without this, Next caches the first response (usually
// 'pending') and the poller never sees the task advance, so it hangs forever.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const task = await getTask(params.id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Return safe public view — no payment_ref, no internal fields.
    // proof_payload IS the deliverable, so the paying agent can review it.
    return NextResponse.json({
      id: task.id,
      intent: task.intent,
      proof_spec: task.proof_spec,
      budget_usdt: task.budget_usdt,
      status: task.status,
      result: task.result,
      proof_payload: task.proof_payload ?? null,
      created_at: task.created_at,
      expires_at: task.expires_at,
    })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
