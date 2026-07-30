import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { canTransition } from './types'
import type { Task, TaskStatus, TaskResult, ProofPayload } from './types'

// Service-role client — used server-side only, never exposed to browser
function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Anon client — safe for browser use, read-only via RLS
export function getAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase public env vars missing')
  return createClient(url, key)
}

export async function insertTask(params: {
  intent: string
  proof_spec: object
  budget_usdt: string
  expires_at: Date
  payment_ref: string
}): Promise<Task> {
  const db = getServiceClient()
  const { data, error } = await db
    .from('tasks')
    .insert({
      intent: params.intent,
      proof_spec: params.proof_spec,
      budget_usdt: params.budget_usdt,
      expires_at: params.expires_at.toISOString(),
      payment_ref: params.payment_ref,
      status: 'pending',
    })
    .select()
    .single()
  if (error) throw error
  return data as Task
}

// Best-effort delete — used to clean up an orphan task when payment recording
// fails (e.g. a replayed payment) so no unpaid task lingers on the board.
export async function deleteTask(id: string): Promise<void> {
  const db = getServiceClient()
  await db.from('tasks').delete().eq('id', id)
}

export async function getTask(id: string): Promise<Task | null> {
  const db = getServiceClient()
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('id', id)
    .single()
  if (error) return null
  return data as Task
}

// CAS transition: only updates if current status matches `from`
export async function transition(
  id: string,
  from: TaskStatus,
  to: TaskStatus,
  extra?: Partial<Pick<Task, 'result' | 'proof_payload' | 'resolved_at' | 'submitted_at'>>
): Promise<Task | null> {
  // Enforce the declared state machine here, at the only place status is
  // written. Without this check VALID_TRANSITIONS is documentation rather than
  // a guarantee, and an illegal move (say pending → verified, paying out for a
  // task nobody ever did) would be a single mistaken call away.
  if (!canTransition(from, to)) return null

  const db = getServiceClient()
  const update: Record<string, unknown> = { status: to, ...extra }
  const { data, error } = await db
    .from('tasks')
    .update(update)
    .eq('id', id)
    .eq('status', from)
    .select()
    .single()
  if (error) return null
  return data as Task
}

// Atomic claim via SQL function — no read-then-write race
export async function claimTask(
  taskId: string,
  workerWallet: string,
  claimExpiresAt: Date
): Promise<Task | null> {
  const db = getServiceClient()
  const { data, error } = await db.rpc('claim_task', {
    p_task_id: taskId,
    p_worker: workerWallet,
    p_expires_at: claimExpiresAt.toISOString(),
  })
  if (error || !data) return null
  return data as Task
}

export async function listOpenTasks(): Promise<Task[]> {
  const db = getServiceClient()
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Task[]
}

// Returns false if payment_ref already exists (replay detected)
export async function recordPaymentRef(params: {
  payment_ref: string
  task_id: string
  amount_units: bigint
  fee_units: bigint
  payer_address: string
  tx_hash?: string
}): Promise<boolean> {
  const db = getServiceClient()
  const { error } = await db.from('payments').insert({
    payment_ref: params.payment_ref,
    task_id: params.task_id,
    amount_units: params.amount_units.toString(),
    fee_units: params.fee_units.toString(),
    payer_address: params.payer_address,
    tx_hash: params.tx_hash ?? null,
  })
  // 23505 = unique violation on either payment_ref (PK) or tx_hash (unique).
  // A replayed on-chain tx collides on tx_hash even with a fresh payment_ref.
  if (error?.code === '23505') return false
  if (error) throw error
  return true
}

export async function recordProofHash(taskId: string, phash: string): Promise<void> {
  const db = getServiceClient()
  await db.from('proof_hashes').insert({ task_id: taskId, phash })
}

export async function recentProofHashes(limitMinutes = 60): Promise<string[]> {
  const db = getServiceClient()
  const since = new Date(Date.now() - limitMinutes * 60_000).toISOString()
  const { data } = await db
    .from('proof_hashes')
    .select('phash')
    .gt('created_at', since)
  return (data ?? []).map((r: { phash: string }) => r.phash)
}

export async function bumpWorker(params: {
  wallet: string
  earned_units: bigint
  outcome: 'completed' | 'failed'
}): Promise<void> {
  const db = getServiceClient()
  // Upsert worker row
  const { error: upsertErr } = await db.from('workers').upsert(
    { wallet: params.wallet, last_seen: new Date().toISOString() },
    { onConflict: 'wallet' }
  )
  if (upsertErr) throw upsertErr
  // Increment counters
  const col = params.outcome === 'completed' ? 'tasks_completed' : 'tasks_failed'
  await db.rpc('increment_worker', {
    p_wallet: params.wallet,
    p_col: col,
    p_earned: params.earned_units.toString(),
  }).throwOnError()
}

export interface WorkerRep {
  wallet: string
  tasks_completed: number
  tasks_failed: number
  earned_usdt: string
}

export interface RecentCompletion {
  id: string
  intent: string
  resolved_at: string
  tx_id: string | null
  explorer: string | null
}

/**
 * Recently verified missions, for the landing page's activity feed.
 *
 * The feed shows real completions or nothing at all — inventing plausible
 * activity on a marketplace page would misrepresent how much is actually
 * happening.
 */
export async function listRecentCompletions(limit = 6): Promise<RecentCompletion[]> {
  const db = getServiceClient()
  const { data, error } = await db
    .from('tasks')
    .select('id,intent,resolved_at,result')
    .eq('status', 'verified')
    .order('resolved_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []

  return (data as { id: string; intent: string; resolved_at: string; result: TaskResult | null }[])
    .map(t => {
      let result: unknown = t.result
      if (typeof result === 'string') {
        try { result = JSON.parse(result) } catch { result = null }
      }
      const settle = (result as { settle?: { tx_id?: string; explorer?: string } } | null)?.settle
      return {
        id: t.id,
        intent: t.intent,
        resolved_at: t.resolved_at,
        tx_id: settle?.tx_id ?? null,
        explorer: settle?.explorer ?? null,
      }
    })
    .filter(t => !!t.resolved_at)
}

// Top human oracles by completed tasks — surfaces reputation on the board so
// the marketplace isn't "any wallet that uploads a JPEG" (Sybil-visibility).
export async function listTopWorkers(limit = 5): Promise<WorkerRep[]> {
  const db = getServiceClient()
  const { fromUnits } = await import('./money')
  const { data } = await db
    .from('workers')
    .select('wallet,tasks_completed,tasks_failed,total_earned_units')
    .order('tasks_completed', { ascending: false })
    .limit(limit)
  return (data ?? [])
    .filter((w: { tasks_completed: number }) => w.tasks_completed > 0)
    .map((w: { wallet: string; tasks_completed: number; tasks_failed: number; total_earned_units: string }) => ({
      wallet: w.wallet,
      tasks_completed: w.tasks_completed,
      tasks_failed: w.tasks_failed,
      earned_usdt: fromUnits(BigInt(w.total_earned_units ?? 0)),
    }))
}

export interface LedgerEntry {
  direction: 'in' | 'out'
  address: string          // payer (in) or worker (out)
  amount_usdt: string
  tx_hash: string | null
  explorer: string | null  // null for demo/off-chain rows
  at: string               // ISO timestamp
  intent: string | null
}

// Public settlement ledger: incoming x402 payments (agent → escrow) and
// outgoing payouts (escrow → worker), merged newest-first. Payouts are read
// from each task's stored result.settle (see settleTask).
export async function listTransactions(limit = 25): Promise<LedgerEntry[]> {
  const db = getServiceClient()
  const { explorerTx } = await import('./hedera')
  const { fromUnits } = await import('./money')
  // A real Hedera transaction id is `0.0.x@seconds.nanos` (or the dashed mirror
  // form). Demo rows carry an empty or synthetic id and get no explorer link.
  const isRealTxId = (h: string | null | undefined): h is string =>
    !!h && /^\d+\.\d+\.\d+[@-]\d+[.-]\d+$/.test(h)

  const [paymentsRes, tasksRes] = await Promise.all([
    db.from('payments').select('payer_address,amount_units,tx_hash,created_at,task_id').order('created_at', { ascending: false }).limit(limit),
    db.from('tasks').select('id,intent,result').eq('status', 'verified').order('resolved_at', { ascending: false }).limit(200),
  ])

  const tasks = (tasksRes.data ?? []) as { id: string; intent: string; result: TaskResult | null }[]
  const intentById = new Map(tasks.map(t => [t.id, t.intent]))

  const inflows: LedgerEntry[] = (paymentsRes.data ?? []).map((p: { payer_address: string; amount_units: string; tx_hash: string | null; created_at: string; task_id: string }) => ({
    direction: 'in' as const,
    address: p.payer_address,
    amount_usdt: fromUnits(BigInt(p.amount_units)),
    tx_hash: p.tx_hash,
    explorer: isRealTxId(p.tx_hash) ? explorerTx(p.tx_hash) : null,
    at: p.created_at,
    intent: intentById.get(p.task_id) ?? null,
  }))

  const payouts: LedgerEntry[] = tasks
    .map(t => {
      // jsonb normally arrives parsed, but tolerate a stringified result too.
      let result: unknown = t.result
      if (typeof result === 'string') {
        try { result = JSON.parse(result) } catch { result = null }
      }
      const s = (result as { settle?: { worker?: string; payout?: string; tx_id?: string | null; explorer?: string | null; settled_at?: string } } | null)?.settle
      if (!s?.worker) return null
      return {
        direction: 'out' as const,
        address: s.worker,
        amount_usdt: s.payout ?? '0',
        tx_hash: s.tx_id ?? null,
        explorer: s.explorer ?? (isRealTxId(s.tx_id) ? explorerTx(s.tx_id!) : null),
        at: s.settled_at ?? '',
        intent: t.intent,
      } as LedgerEntry
    })
    .filter((e): e is LedgerEntry => e !== null)

  return [...inflows, ...payouts]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
}

export async function pulseStats(): Promise<{
  total_tasks: number
  verified_tasks: number
  total_paid_usdt: string
  active_workers: number
}> {
  const db = getServiceClient()
  const [tasksRes, workersRes, paymentsRes] = await Promise.all([
    db.from('tasks').select('status'),
    db.from('workers').select('wallet', { count: 'exact', head: true }),
    db.from('payments').select('amount_units'),
  ])
  const tasks = tasksRes.data ?? []
  const verified = tasks.filter((t: { status: string }) => t.status === 'verified').length
  const totalUnits = (paymentsRes.data ?? []).reduce(
    (sum: bigint, p: { amount_units: string }) => sum + BigInt(p.amount_units),
    0n
  )
  const { fromUnits } = await import('./money')
  return {
    total_tasks: tasks.length,
    verified_tasks: verified,
    total_paid_usdt: fromUnits(totalUnits),
    active_workers: workersRes.count ?? 0,
  }
}
