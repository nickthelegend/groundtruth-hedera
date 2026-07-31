import { NextResponse } from 'next/server'
import { listOpenTasks } from '@/lib/db'

// Public mission board feed.
//
// The task document contains `payment_ref`, which is the credential the paying
// agent uses to accept a proof and release an on-chain payout
// (app/api/v1/tasks/[id]/review). It must never leave the server on an
// unauthenticated route, so what follows is an ALLOWLIST rather than a
// blocklist — a field added to Task later cannot leak by default.
export async function GET() {
  try {
    const tasks = await listOpenTasks()
    const publicView = tasks.map(t => ({
      id: t.id,
      intent: t.intent,
      proof_spec: t.proof_spec,
      budget_usdt: t.budget_usdt,
      status: t.status,
      created_at: t.created_at,
      expires_at: t.expires_at,
    }))
    return NextResponse.json(publicView)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}
