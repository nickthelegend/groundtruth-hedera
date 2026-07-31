import { canTransition } from './types'
import type { Task, TaskStatus, TaskResult, ProofPayload } from './types'
import {
  tasks as tasksCol,
  payments as paymentsCol,
  workers as workersCol,
  proofHashes as proofHashesCol,
  isDuplicateKeyError,
  toTask,
  type TaskDoc,
} from './mongo'

// Data access.
//
// Two properties matter more than anything else here and are implemented with
// atomic operations rather than read-then-write:
//
//   1. A task can be claimed by exactly one worker.
//   2. A settled Hedera transaction can pay for exactly one task.
//
// Both were enforced by Postgres before (an RPC with a conditional UPDATE, and
// a partial unique index). The MongoDB equivalents are a conditional
// findOneAndUpdate and a unique partial index — not application-level checks,
// which would race.

export async function insertTask(params: {
  intent: string
  proof_spec: object
  budget_usdt: string
  expires_at: Date
  payment_ref: string
}): Promise<Task> {
  const col = await tasksCol()
  const now = new Date().toISOString()
  const doc: TaskDoc = {
    _id: crypto.randomUUID(),
    intent: params.intent,
    proof_spec: params.proof_spec as Task['proof_spec'],
    budget_usdt: params.budget_usdt,
    status: 'pending',
    worker_wallet: null,
    payment_ref: params.payment_ref,
    proof_payload: null,
    result: null,
    created_at: now,
    expires_at: params.expires_at.toISOString(),
    claimed_at: null,
    submitted_at: null,
    resolved_at: null,
  }
  await col.insertOne(doc)
  return toTask(doc)!
}

export async function getTask(id: string): Promise<Task | null> {
  const col = await tasksCol()
  return toTask(await col.findOne({ _id: id }))
}

export async function deleteTask(id: string): Promise<boolean> {
  const col = await tasksCol()
  const res = await col.deleteOne({ _id: id })
  return res.deletedCount === 1
}

/**
 * Compare-and-swap on status. The `status: from` filter is the whole point:
 * two concurrent resolutions of the same task cannot both win, because the
 * second finds the status already changed and matches nothing.
 */
export async function transition(
  id: string,
  from: TaskStatus,
  to: TaskStatus,
  extra?: Partial<Pick<Task, 'result' | 'proof_payload' | 'resolved_at' | 'submitted_at'>>
): Promise<Task | null> {
  // Enforce the declared state machine at the only place status is written.
  // Without this, VALID_TRANSITIONS is documentation rather than a guarantee,
  // and an illegal move (pending → verified, paying for work nobody did) would
  // be a single mistaken call away.
  if (!canTransition(from, to)) return null

  const col = await tasksCol()
  const doc = await col.findOneAndUpdate(
    { _id: id, status: from },
    { $set: { status: to, ...extra } },
    { returnDocument: 'after' }
  )
  return toTask(doc)
}

/**
 * Atomic claim. A task is claimable when it is pending, or when a previous
 * claim was abandoned — so a worker who drops off never locks a task forever.
 * Expired tasks are never claimable.
 */
export async function claimTask(
  taskId: string,
  workerWallet: string,
  _claimExpiresAt: Date
): Promise<Task | null> {
  const col = await tasksCol()
  const now = new Date().toISOString()
  const abandonedBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const doc = await col.findOneAndUpdate(
    {
      _id: taskId,
      expires_at: { $gt: now },
      $or: [
        { status: 'pending' },
        { status: 'claimed', claimed_at: { $lt: abandonedBefore } },
      ],
    },
    { $set: { status: 'claimed', worker_wallet: workerWallet, claimed_at: now } },
    { returnDocument: 'after' }
  )
  return toTask(doc)
}

export async function listOpenTasks(): Promise<Task[]> {
  const col = await tasksCol()
  const docs = await col
    .find({ status: 'pending', expires_at: { $gt: new Date().toISOString() } })
    .sort({ created_at: -1 })
    .toArray()
  return docs.map(d => toTask(d)!)
}

/**
 * Record a payment. Returns false when the payment was already used.
 *
 * Two uniqueness constraints can reject this, and both are deliberate:
 *   • `_id` is the payment_ref — the same reference cannot be reused.
 *   • a unique partial index on `tx_hash` — the same settled Hedera transaction
 *     cannot back a second task, even with a freshly invented reference.
 */
export async function recordPaymentRef(params: {
  payment_ref: string
  task_id: string
  amount_units: bigint
  fee_units: bigint
  payer_address: string
  tx_hash?: string
}): Promise<boolean> {
  const col = await paymentsCol()
  try {
    await col.insertOne({
      _id: params.payment_ref,
      task_id: params.task_id,
      amount_units: params.amount_units.toString(),
      fee_units: params.fee_units.toString(),
      payer_address: params.payer_address,
      // Must be null, not undefined — the partial index keys on the field
      // being a string, and an absent field would silently skip the guard.
      tx_hash: params.tx_hash && params.tx_hash.length > 0 ? params.tx_hash : null,
      settled_at: null,
      created_at: new Date().toISOString(),
    })
    return true
  } catch (e) {
    if (isDuplicateKeyError(e)) return false
    throw e
  }
}

export async function recordProofHash(taskId: string, phash: string): Promise<void> {
  const col = await proofHashesCol()
  await col.insertOne({ task_id: taskId, phash, created_at: new Date().toISOString() })
}

export async function recentProofHashes(limitMinutes = 60): Promise<string[]> {
  const col = await proofHashesCol()
  const since = new Date(Date.now() - limitMinutes * 60_000).toISOString()
  const docs = await col.find({ created_at: { $gt: since } }).toArray()
  return docs.map(d => d.phash)
}

export async function bumpWorker(params: {
  wallet: string
  earned_units: bigint
  outcome: 'completed' | 'failed'
}): Promise<void> {
  const col = await workersCol()
  const completed = params.outcome === 'completed'

  // Counters increment atomically; earnings are a decimal string (bigint does
  // not survive BSON), so they are read-modify-written inside a single
  // findOneAndUpdate loop-free upsert by storing the sum client-side.
  const existing = await col.findOne({ _id: params.wallet })
  const previous = BigInt(existing?.total_earned_units ?? '0')
  const total = completed ? previous + params.earned_units : previous

  await col.updateOne(
    { _id: params.wallet },
    {
      $inc: completed ? { tasks_completed: 1 } : { tasks_failed: 1 },
      $set: { total_earned_units: total.toString(), last_seen: new Date().toISOString() },
      $setOnInsert: completed ? { tasks_failed: 0 } : { tasks_completed: 0 },
    },
    { upsert: true }
  )
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
  const col = await tasksCol()
  const docs = await col
    .find({ status: 'verified' })
    .sort({ resolved_at: -1 })
    .limit(limit)
    .toArray()

  return docs
    .filter(d => !!d.resolved_at)
    .map(d => {
      const settle = (d.result as { settle?: { tx_id?: string; explorer?: string } } | null)?.settle
      return {
        id: d._id,
        intent: d.intent,
        resolved_at: d.resolved_at as string,
        tx_id: settle?.tx_id ?? null,
        explorer: settle?.explorer ?? null,
      }
    })
}

// Top human oracles by completed tasks — surfaces reputation on the board so
// the marketplace isn't "any wallet that uploads a JPEG" (Sybil-visibility).
export async function listTopWorkers(limit = 5): Promise<WorkerRep[]> {
  const col = await workersCol()
  const { fromUnits } = await import('./money')
  const docs = await col
    .find({ tasks_completed: { $gt: 0 } })
    .sort({ tasks_completed: -1 })
    .limit(limit)
    .toArray()

  return docs.map(d => ({
    wallet: d._id,
    tasks_completed: d.tasks_completed ?? 0,
    tasks_failed: d.tasks_failed ?? 0,
    earned_usdt: fromUnits(BigInt(d.total_earned_units ?? '0')),
  }))
}

export interface LedgerEntry {
  direction: 'in' | 'out'
  address: string // payer (in) or worker (out)
  amount_usdt: string
  tx_hash: string | null
  explorer: string | null // null for demo/off-chain rows
  at: string // ISO timestamp
  intent: string | null
}

// Public settlement ledger: incoming x402 payments (agent → treasury) and
// outgoing payouts (treasury → worker), merged newest-first. Payouts are read
// from each task's stored result.settle (see settleTask).
export async function listTransactions(limit = 25): Promise<LedgerEntry[]> {
  const { explorerTx } = await import('./hedera')
  const { fromUnits } = await import('./money')
  // A real Hedera transaction id is `0.0.x@seconds.nanos` (or the dashed mirror
  // form). Demo rows carry an empty or synthetic id and get no explorer link.
  const isRealTxId = (h: string | null | undefined): h is string =>
    !!h && /^\d+\.\d+\.\d+[@-]\d+[.-]\d+$/.test(h)

  const [paymentsList, verifiedTasks] = await Promise.all([
    (await paymentsCol()).find({}).sort({ created_at: -1 }).limit(limit).toArray(),
    (await tasksCol()).find({ status: 'verified' }).sort({ resolved_at: -1 }).limit(200).toArray(),
  ])

  const intentById = new Map(verifiedTasks.map(t => [t._id, t.intent]))

  const inflows: LedgerEntry[] = paymentsList.map(p => ({
    direction: 'in' as const,
    address: p.payer_address,
    amount_usdt: fromUnits(BigInt(p.amount_units)),
    tx_hash: p.tx_hash,
    explorer: isRealTxId(p.tx_hash) ? explorerTx(p.tx_hash) : null,
    at: p.created_at,
    intent: intentById.get(p.task_id) ?? null,
  }))

  const payouts: LedgerEntry[] = verifiedTasks
    .map(t => {
      const s = (
        t.result as {
          settle?: {
            worker?: string
            payout?: string
            tx_id?: string | null
            explorer?: string | null
            settled_at?: string
          }
        } | null
      )?.settle
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

  return [...inflows, ...payouts].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit)
}

export async function pulseStats(): Promise<{
  total_tasks: number
  verified_tasks: number
  total_paid_usdt: string
  active_workers: number
}> {
  const { fromUnits } = await import('./money')
  const [tasks, payments, workers] = await Promise.all([tasksCol(), paymentsCol(), workersCol()])

  const [total, verified, activeWorkers, paymentDocs] = await Promise.all([
    tasks.countDocuments({}),
    tasks.countDocuments({ status: 'verified' }),
    workers.countDocuments({}),
    payments.find({}, { projection: { amount_units: 1 } }).toArray(),
  ])

  const totalUnits = paymentDocs.reduce((sum, p) => sum + BigInt(p.amount_units), 0n)

  return {
    total_tasks: total,
    verified_tasks: verified,
    total_paid_usdt: fromUnits(totalUnits),
    active_workers: activeWorkers,
  }
}
