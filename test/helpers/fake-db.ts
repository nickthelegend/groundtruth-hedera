import { vi } from 'vitest'
import type { Task, TaskStatus, TaskResult, ProofPayload } from '../../lib/types'
import { canTransition } from '../../lib/types'

// An in-memory stand-in for lib/db.
//
// Deliberately reimplements the *constraints* the real schema enforces —
// the payments primary key, the unique index on tx_hash, and the status
// transition rules — because those are exactly what the route logic depends on.
// A mock that always says "ok" would let the replay guard regress silently.

export interface FakeState {
  tasks: Map<string, Task>
  payments: Map<string, { task_id: string; tx_hash: string | null; amount_units: bigint }>
  proofHashes: { task_id: string; phash: string }[]
  workers: Map<string, { earned: bigint; completed: number; failed: number }>
}

export function createFakeState(): FakeState {
  return {
    tasks: new Map(),
    payments: new Map(),
    proofHashes: [],
    workers: new Map(),
  }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date()
  return {
    id: overrides.id ?? crypto.randomUUID(),
    intent: 'Check if the coffee shop is open',
    proof_spec: { type: 'photo', instructions: 'Photo of the entrance', minPhotos: 1 },
    budget_usdt: '0.50',
    status: 'pending',
    worker_wallet: null,
    payment_ref: 'hedera-0.0.1@1.1',
    proof_payload: null,
    result: null,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 3600_000).toISOString(),
    claimed_at: null,
    submitted_at: null,
    resolved_at: null,
    ...overrides,
  } as Task
}

/**
 * Build a module mock for lib/db backed by `state`.
 * Use with: vi.mock('@/lib/db', () => buildDbMock(state))
 */
export function buildDbMock(state: FakeState) {
  return {
    getTask: vi.fn(async (id: string) => state.tasks.get(id) ?? null),

    insertTask: vi.fn(async (params: Record<string, unknown>) => {
      const task = makeTask({
        intent: params.intent as string,
        proof_spec: params.proof_spec as Task['proof_spec'],
        budget_usdt: params.budget_usdt as string,
        payment_ref: params.payment_ref as string,
        expires_at: (params.expires_at as Date).toISOString(),
      })
      state.tasks.set(task.id, task)
      return task
    }),

    deleteTask: vi.fn(async (id: string) => {
      state.tasks.delete(id)
      return true
    }),

    // Mirrors the real constraints: payment_ref is a primary key and tx_hash
    // carries a partial unique index. Either collision means "already used".
    recordPaymentRef: vi.fn(
      async (p: {
        payment_ref: string
        task_id: string
        amount_units: bigint
        tx_hash?: string
      }) => {
        if (state.payments.has(p.payment_ref)) return false
        if (p.tx_hash) {
          for (const existing of state.payments.values()) {
            if (existing.tx_hash === p.tx_hash) return false
          }
        }
        state.payments.set(p.payment_ref, {
          task_id: p.task_id,
          tx_hash: p.tx_hash ?? null,
          amount_units: p.amount_units,
        })
        return true
      }
    ),

    claimTask: vi.fn(async (id: string, worker: string) => {
      const task = state.tasks.get(id)
      if (!task) return null
      if (new Date(task.expires_at).getTime() <= Date.now()) return null
      const reclaimable =
        task.status === 'claimed' &&
        task.claimed_at !== null &&
        Date.now() - new Date(task.claimed_at).getTime() > 30 * 60 * 1000
      if (task.status !== 'pending' && !reclaimable) return null
      const updated = {
        ...task,
        status: 'claimed' as TaskStatus,
        worker_wallet: worker,
        claimed_at: new Date().toISOString(),
      }
      state.tasks.set(id, updated)
      return updated
    }),

    transition: vi.fn(
      async (
        id: string,
        from: TaskStatus,
        to: TaskStatus,
        patch: { result?: TaskResult; proof_payload?: ProofPayload } = {}
      ) => {
        const task = state.tasks.get(id)
        if (!task) return null
        // Same-state writes are how settle merges its result in.
        if (task.status !== from) return null
        if (from !== to && !canTransition(from, to)) return null
        const updated = { ...task, ...patch, status: to } as Task
        state.tasks.set(id, updated)
        return updated
      }
    ),

    recordProofHash: vi.fn(async (taskId: string, phash: string) => {
      state.proofHashes.push({ task_id: taskId, phash })
    }),

    recentProofHashes: vi.fn(async () => state.proofHashes.map(p => p.phash)),

    bumpWorker: vi.fn(
      async (p: { wallet: string; earned_units: bigint; outcome: 'completed' | 'failed' }) => {
        const w = state.workers.get(p.wallet) ?? { earned: 0n, completed: 0, failed: 0 }
        if (p.outcome === 'completed') {
          w.completed++
          w.earned += p.earned_units
        } else {
          w.failed++
        }
        state.workers.set(p.wallet, w)
      }
    ),

    listOpenTasks: vi.fn(async () =>
      [...state.tasks.values()].filter(t => t.status === 'pending')
    ),
    listTransactions: vi.fn(async () => []),
    listTopWorkers: vi.fn(async () => []),
    pulseStats: vi.fn(async () => ({
      total_tasks: state.tasks.size,
      verified_tasks: [...state.tasks.values()].filter(t => t.status === 'verified').length,
      total_paid_usdt: '0',
      active_workers: state.workers.size,
    })),
    getAnonClient: vi.fn(),
  }
}
