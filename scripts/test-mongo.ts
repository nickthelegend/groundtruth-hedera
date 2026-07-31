#!/usr/bin/env node
/**
 * Database integration test — runs against the real MongoDB.
 *
 *   npx tsx scripts/test-mongo.ts
 *
 * The offline suite (`pnpm test`) covers route logic against an in-memory fake.
 * This one proves the fake's assumptions actually hold in MongoDB: that the
 * replay guard is a real unique index, that claiming is atomic under
 * concurrency, and that proof bytes survive a round trip through GridFS.
 *
 * Everything it writes is namespaced and deleted afterwards.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const file of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m || process.env[m[1]]) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    break
  } catch {
    /* next candidate */
  }
}

let passed = 0
let failed = 0
const pass = (m: string) => (passed++, console.log(`  \x1b[32m✓\x1b[0m ${m}`))
const fail = (m: string) => (failed++, console.log(`  \x1b[31m✗\x1b[0m ${m}`))
const info = (m: string) => console.log(`      \x1b[2m${m}\x1b[0m`)
const section = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`)

async function main() {
  const db = await import('../lib/db')
  const storage = await import('../lib/storage')
  const { getDb, closeMongo, payments, tasks, proofHashes, workers } = await import('../lib/mongo')

  const created: string[] = []
  const WORKER = '0.0.9847870'

  console.log(`\n\x1b[1mMongoDB integration\x1b[0m`)
  console.log(`  db: ${(await getDb()).databaseName}`)

  // ── 1. Connection and indexes ───────────────────────────────────────────────
  section('1. Connection and constraints')
  const mongo = await getDb()
  const ping = await mongo.command({ ping: 1 })
  ping.ok === 1 ? pass('cluster reachable') : fail('ping failed')

  const idx = await (await payments()).indexes()
  const replayIdx = idx.find(i => i.name === 'payments_tx_hash_unique')
  replayIdx?.unique === true
    ? pass('replay guard exists as a unique index on tx_hash')
    : fail('replay guard index missing — a settled tx could pay for two tasks')
  replayIdx?.partialFilterExpression
    ? pass('index is partial, so demo rows with no tx do not collide')
    : fail('index is not partial')

  // ── 2. Task round trip ──────────────────────────────────────────────────────
  section('2. Task round trip')
  const task = await db.insertTask({
    intent: 'MONGO-TEST verify the shop is open',
    proof_spec: { type: 'photo', instructions: 'photo', minPhotos: 1 },
    budget_usdt: '0.50',
    expires_at: new Date(Date.now() + 3600_000),
    payment_ref: `test-${Date.now()}`,
  })
  created.push(task.id)
  task.id ? pass(`inserted task ${task.id}`) : fail('insert returned no id')

  const fetched = await db.getTask(task.id)
  fetched?.intent === task.intent ? pass('read back with matching fields') : fail('read back mismatch')
  fetched?.status === 'pending' ? pass('starts pending') : fail(`status is ${fetched?.status}`)

  // ── 3. Atomic claim under concurrency ───────────────────────────────────────
  section('3. Atomic claim')
  const contested = await db.insertTask({
    intent: 'MONGO-TEST contested',
    proof_spec: { type: 'form', instructions: 'form' },
    budget_usdt: '0.50',
    expires_at: new Date(Date.now() + 3600_000),
    payment_ref: `test-contested-${Date.now()}`,
  })
  created.push(contested.id)

  // Ten workers race for one task. Exactly one may win.
  const racers = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      db.claimTask(contested.id, `0.0.${900000 + i}`, new Date(Date.now() + 1800_000))
    )
  )
  const winners = racers.filter(Boolean)
  winners.length === 1
    ? pass(`exactly 1 of 10 concurrent claims won (${winners[0]!.worker_wallet})`)
    : fail(`${winners.length} claims won — the claim is not atomic`)

  const afterClaim = await db.getTask(contested.id)
  afterClaim?.status === 'claimed' ? pass('task is claimed') : fail('task not claimed')

  const secondAttempt = await db.claimTask(contested.id, '0.0.999999', new Date())
  secondAttempt === null ? pass('a later claim is refused') : fail('task was re-claimed')

  // ── 4. Replay guard ─────────────────────────────────────────────────────────
  section('4. Payment replay guard')
  const txId = `0.0.7162784@${Date.now()}.000000001`

  const first = await db.recordPaymentRef({
    payment_ref: `hedera-${txId}`,
    task_id: task.id,
    amount_units: 50_000_000n,
    fee_units: 6_000_000n,
    payer_address: WORKER,
    tx_hash: txId,
  })
  first ? pass('first payment recorded') : fail('first payment rejected')

  const sameRef = await db.recordPaymentRef({
    payment_ref: `hedera-${txId}`,
    task_id: contested.id,
    amount_units: 50_000_000n,
    fee_units: 6_000_000n,
    payer_address: WORKER,
    tx_hash: txId,
  })
  !sameRef ? pass('same payment_ref rejected') : fail('duplicate payment_ref accepted')

  // The important one: a fresh reference must NOT let a settled tx pay twice.
  const freshRef = await db.recordPaymentRef({
    payment_ref: `hedera-forged-${Date.now()}`,
    task_id: contested.id,
    amount_units: 50_000_000n,
    fee_units: 6_000_000n,
    payer_address: WORKER,
    tx_hash: txId,
  })
  !freshRef
    ? pass('same tx_hash under a NEW payment_ref rejected')
    : fail('SECURITY: one settled transaction paid for two tasks')

  // Demo rows carry no tx and must not collide with one another.
  const demoA = await db.recordPaymentRef({
    payment_ref: `demo-a-${Date.now()}`,
    task_id: task.id,
    amount_units: 0n,
    fee_units: 0n,
    payer_address: '0.0.0',
  })
  const demoB = await db.recordPaymentRef({
    payment_ref: `demo-b-${Date.now()}`,
    task_id: task.id,
    amount_units: 0n,
    fee_units: 0n,
    payer_address: '0.0.0',
  })
  demoA && demoB ? pass('two tx-less rows coexist') : fail('partial index is rejecting demo rows')

  // ── 5. Transition CAS ───────────────────────────────────────────────────────
  section('5. Status transitions')
  const illegal = await db.transition(task.id, 'pending', 'verified')
  illegal === null
    ? pass('illegal transition pending → verified refused')
    : fail('SECURITY: paid out a task nobody claimed')

  await db.claimTask(task.id, WORKER, new Date(Date.now() + 1800_000))

  // Two concurrent resolutions; only one may take effect.
  const resolutions = await Promise.all([
    db.transition(task.id, 'claimed', 'verified', { resolved_at: new Date().toISOString() }),
    db.transition(task.id, 'claimed', 'failed', { resolved_at: new Date().toISOString() }),
  ])
  resolutions.filter(Boolean).length === 1
    ? pass('exactly 1 of 2 concurrent resolutions won')
    : fail(`${resolutions.filter(Boolean).length} resolutions won — CAS is not atomic`)

  const settled = await db.getTask(task.id)
  const sameStatusWrite = await db.transition(task.id, settled!.status, settled!.status, {
    result: { outcome: 'verified', checks: [] },
  })
  sameStatusWrite ? pass('same-status write allowed so settlement can merge') : fail('same-status write refused')

  // ── 6. GridFS proof storage ─────────────────────────────────────────────────
  section('6. Proof storage (GridFS)')
  // A 1x1 PNG — real bytes, so the format sniffer has something to read.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )

  const stored = await storage.uploadProofImages(task.id, [png])
  stored.length === 1 ? pass(`uploaded proof: ${stored[0].key}`) : fail('upload returned nothing')
  stored[0].contentType === 'image/png'
    ? pass('content type sniffed from bytes, not the filename')
    : fail(`content type is ${stored[0].contentType}`)

  const back = await storage.downloadProof(stored[0].key)
  back && Buffer.compare(back.buffer, png) === 0
    ? pass('bytes round-trip through GridFS unchanged')
    : fail('downloaded bytes differ from what was uploaded')

  // Re-uploading the same proof must replace, not accumulate.
  await storage.uploadProofImages(task.id, [png])
  const bucketFiles = await mongo
    .collection(`${storage.proofBucket}.files`)
    .countDocuments({ filename: stored[0].key })
  bucketFiles === 1 ? pass('re-upload replaces rather than duplicates') : fail(`${bucketFiles} copies stored`)

  // ── 7. Signed URLs ──────────────────────────────────────────────────────────
  section('7. Signed proof URLs')
  const urls = await storage.signProofUrls([stored[0].key])
  const url = urls[stored[0].key]
  url ? pass('signed URL minted') : fail('no signed URL')
  info(url ?? '')

  const parsed = new URL(url)
  const exp = parsed.searchParams.get('exp')!
  const sig = parsed.searchParams.get('sig')!

  storage.verifyProofSignature(stored[0].key, exp, sig)
    ? pass('valid signature accepted')
    : fail('valid signature rejected')

  !storage.verifyProofSignature(stored[0].key, exp, 'deadbeef')
    ? pass('forged signature rejected')
    : fail('SECURITY: forged signature accepted')

  !storage.verifyProofSignature('other-task/0-aaaaaaaa.png', exp, sig)
    ? pass('signature bound to its own key — cannot be reused for another proof')
    : fail('SECURITY: signature valid for a different key')

  !storage.verifyProofSignature(stored[0].key, String(Math.floor(Date.now() / 1000) - 60), sig)
    ? pass('expired link rejected')
    : fail('SECURITY: expired link accepted')

  // ── 8. Worker reputation ────────────────────────────────────────────────────
  section('8. Worker reputation')
  await db.bumpWorker({ wallet: WORKER, earned_units: 44_000_000n, outcome: 'completed' })
  await db.bumpWorker({ wallet: WORKER, earned_units: 44_000_000n, outcome: 'completed' })
  const top = await db.listTopWorkers(10)
  const me = top.find(w => w.wallet === WORKER)
  me && me.tasks_completed >= 2 ? pass(`counters accumulate (${me.tasks_completed} completed)`) : fail('counters did not accumulate')

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  section('Cleanup')
  const taskCol = await tasks()
  await taskCol.deleteMany({ _id: { $in: created } })
  await (await payments()).deleteMany({ task_id: { $in: created } })
  await (await proofHashes()).deleteMany({ task_id: { $in: created } })
  await (await workers()).deleteOne({ _id: WORKER })
  for (const key of stored.map(s => s.key)) {
    const files = await mongo.collection(`${storage.proofBucket}.files`).find({ filename: key }).toArray()
    for (const f of files) {
      await mongo.collection(`${storage.proofBucket}.chunks`).deleteMany({ files_id: f._id })
      await mongo.collection(`${storage.proofBucket}.files`).deleteOne({ _id: f._id })
    }
  }
  pass('test data removed')

  await closeMongo()
  console.log(
    `\n${failed === 0 ? '\x1b[32m\x1b[1mALL PASS\x1b[0m' : '\x1b[31m\x1b[1mFAILURES\x1b[0m'} — ` +
      `${passed} passed, ${failed} failed\n`
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('\n\x1b[31mTest crashed:\x1b[0m', e instanceof Error ? e.stack : e)
  process.exit(1)
})
