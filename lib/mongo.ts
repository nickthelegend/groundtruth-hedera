import { MongoClient, Db, Collection } from 'mongodb'
import type { Task } from './types'

// MongoDB connection and schema.
//
// A single client is cached per process. The driver pools connections
// internally, so building a new MongoClient per request would be both slow and
// a socket leak — and in Next.js dev, module reloads would multiply them, hence
// the globalThis cache.

const URI = process.env.MONGODB_URI
const DB_NAME = process.env.MONGODB_DB ?? 'groundtruth'

export interface PaymentDoc {
  _id: string // payment_ref — the primary key, so a duplicate ref is a write conflict
  task_id: string
  amount_units: string // bigint does not survive BSON; stored as a decimal string
  fee_units: string
  payer_address: string
  tx_hash: string | null
  settled_at: string | null
  created_at: string
}

export interface WorkerDoc {
  _id: string // wallet / account id
  tasks_completed: number
  tasks_failed: number
  total_earned_units: string
  last_seen: string
}

export interface ProofHashDoc {
  task_id: string
  phash: string
  created_at: string
}

export type TaskDoc = Omit<Task, 'id'> & { _id: string }

interface Cached {
  client: MongoClient
  db: Db
  indexesReady: Promise<void>
}

// Next.js reloads modules in dev; without a global the client would leak.
const globalCache = globalThis as typeof globalThis & { __gtMongo?: Cached }

function connect(): Cached {
  if (globalCache.__gtMongo) return globalCache.__gtMongo
  if (!URI) throw new Error('MONGODB_URI not set')

  const client = new MongoClient(URI, {
    // Fail fast rather than hanging a request for 30s on a bad cluster.
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
  })
  const db = client.db(DB_NAME)

  const cached: Cached = { client, db, indexesReady: ensureIndexes(db) }
  globalCache.__gtMongo = cached
  return cached
}

/**
 * Indexes that enforce correctness, not just speed.
 *
 * The unique partial index on `tx_hash` is the replay guard: one settled Hedera
 * transaction can back at most one payment, no matter what payment_ref a caller
 * invents. It is partial so demo rows (tx_hash null) never collide with each
 * other. Postgres enforced this with a partial unique index; this is the
 * MongoDB equivalent and must not be dropped.
 */
async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('payments').createIndex(
      { tx_hash: 1 },
      {
        unique: true,
        partialFilterExpression: { tx_hash: { $type: 'string' } },
        name: 'payments_tx_hash_unique',
      }
    ),
    db.collection('tasks').createIndex({ status: 1, expires_at: 1 }),
    db.collection('tasks').createIndex({ worker_wallet: 1 }),
    db.collection('tasks').createIndex({ status: 1, resolved_at: -1 }),
    db.collection('proof_hashes').createIndex({ phash: 1 }),
    db.collection('proof_hashes').createIndex({ created_at: -1 }),
    db.collection('workers').createIndex({ tasks_completed: -1 }),
  ])
}

export async function getDb(): Promise<Db> {
  const cached = connect()
  // Await once; subsequent calls resolve immediately from the cached promise.
  await cached.indexesReady
  return cached.db
}

export async function tasks(): Promise<Collection<TaskDoc>> {
  return (await getDb()).collection<TaskDoc>('tasks')
}

export async function payments(): Promise<Collection<PaymentDoc>> {
  return (await getDb()).collection<PaymentDoc>('payments')
}

export async function workers(): Promise<Collection<WorkerDoc>> {
  return (await getDb()).collection<WorkerDoc>('workers')
}

export async function proofHashes(): Promise<Collection<ProofHashDoc>> {
  return (await getDb()).collection<ProofHashDoc>('proof_hashes')
}

/** Close the pool. Servers never need this; scripts do, to exit cleanly. */
export async function closeMongo(): Promise<void> {
  if (globalCache.__gtMongo) {
    await globalCache.__gtMongo.client.close()
    globalCache.__gtMongo = undefined
  }
}

/** A duplicate-key error means a uniqueness constraint rejected the write. */
export function isDuplicateKeyError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: number }).code === 11000
}

/** Mongo stores `_id`; the app speaks `id`. */
export function toTask(doc: TaskDoc | null): Task | null {
  if (!doc) return null
  const { _id, ...rest } = doc
  return { id: _id, ...rest } as Task
}
