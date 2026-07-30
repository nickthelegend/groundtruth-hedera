import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret')
  return secret === (process.env.ADMIN_SECRET ?? '')
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json([], { status: 200 })

  const db = createClient(url, key, { auth: { persistSession: false } })
  const { data } = await db
    .from('tasks')
    .select('id, intent, worker_wallet, budget_usdt, submitted_at, proof_payload')
    .eq('status', 'needs_review')
    .order('submitted_at', { ascending: true })

  return NextResponse.json(data ?? [])
}
