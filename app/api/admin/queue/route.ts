import { NextRequest, NextResponse } from 'next/server'
import { tasks as tasksCol } from '@/lib/mongo'

function isAuthorized(req: NextRequest): boolean {
  const configured = process.env.ADMIN_SECRET
  // An unset secret must not authorise everyone — deny outright.
  if (!configured) return false
  return req.headers.get('x-admin-secret') === configured
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const col = await tasksCol()
    const docs = await col
      .find({ status: 'needs_review' })
      .sort({ submitted_at: 1 })
      .limit(50)
      .toArray()

    return NextResponse.json(
      docs.map(d => ({
        id: d._id,
        intent: d.intent,
        worker_wallet: d.worker_wallet,
        budget_usdt: d.budget_usdt,
        submitted_at: d.submitted_at,
        proof_payload: d.proof_payload,
      }))
    )
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
