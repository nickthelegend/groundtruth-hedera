#!/usr/bin/env node
/**
 * Full lifecycle end-to-end — real money, real database, real consensus.
 *
 *   pnpm dev            # in one terminal
 *   npx tsx scripts/e2e-hedera-pay.ts
 *
 * Walks the entire product in one run:
 *
 *   1. GET  /api/v1/human-do          → 402 Payment Required
 *   2. agent signs a Hedera transfer satisfying the challenge
 *   3. POST /api/v1/human-do          → facilitator settles; task created
 *   4. mirror node confirms the payment independently
 *   5. a human oracle claims the task
 *   6. the oracle submits photo proof   → stored in GridFS
 *   7. the paying agent reviews and accepts
 *   8. oracle is paid on Hedera; proof is anchored to HCS
 *   9. the proof is retrieved through its signed URL
 *
 * Every step is verified, not assumed.
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

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const BUDGET = process.env.E2E_BUDGET ?? process.env.ASP_PRICE_USDT ?? '0.50'
const ORACLE = process.env.E2E_ORACLE_ACCOUNT ?? process.env.AGENT_ACCOUNT_ID!

let passed = 0
let failed = 0
const pass = (m: string) => (passed++, console.log(`  \x1b[32m✓\x1b[0m ${m}`))
const bad = (m: string) => (failed++, console.log(`  \x1b[31m✗\x1b[0m ${m}`))
const info = (m: string) => console.log(`      \x1b[2m${m}\x1b[0m`)
const step = (n: number, m: string) => console.log(`\n\x1b[1m[${n}] ${m}\x1b[0m`)

function die(msg: string): never {
  console.error(`\n\x1b[31m${msg}\x1b[0m\n`)
  process.exit(1)
}

/**
 * Render a stand-in "photo" of an open coffee shop with the task's freshness
 * code visible, the way a real worker would hold up a note.
 *
 * Generated rather than checked in so the vision model is genuinely reading the
 * per-task code, not a fixture that happens to match.
 */
async function renderProofImage(challenge: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const svg = `<svg width="640" height="440" xmlns="http://www.w3.org/2000/svg">
    <rect width="640" height="440" fill="#f2ede4"/>
    <rect x="60" y="60" width="520" height="290" fill="#3a3027"/>
    <rect x="150" y="150" width="150" height="200" fill="#8fd6ff"/>
    <rect x="340" y="150" width="150" height="200" fill="#8fd6ff"/>
    <text x="320" y="120" font-family="Helvetica" font-size="40" fill="#ffffff" text-anchor="middle">COFFEE SHOP</text>
    <text x="320" y="300" font-family="Helvetica" font-size="34" fill="#0b8f3a" text-anchor="middle">OPEN</text>
    <rect x="180" y="365" width="280" height="55" rx="6" fill="#ffffff" stroke="#111111" stroke-width="2"/>
    <text x="320" y="403" font-family="Helvetica" font-size="30" fill="#111111" text-anchor="middle">${challenge}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function main() {
  const { agentPay } = await import('../lib/agent-pay')
  const { verifyPaymentOnMirror } = await import('../lib/mirror-verify')
  const {
    HEDERA_NETWORK,
    PAYMENT_ASSET_ID,
    PAYMENT_ASSET_SYMBOL,
    getPaymentAssetBalance,
    explorerTx,
    closeHederaClients,
  } = await import('../lib/hedera')
  const { toUnits, fromUnits } = await import('../lib/money')
  const { closeMongo } = await import('../lib/mongo')

  console.log(`\n\x1b[1mGroundTruth — full lifecycle on ${HEDERA_NETWORK}\x1b[0m`)
  console.log(`  server : ${BASE_URL}`)
  console.log(`  asset  : ${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID})`)
  console.log(`  budget : ${BUDGET}`)
  console.log(`  oracle : ${ORACLE}`)

  // Confirm the server is actually up before spending anything.
  try {
    const probe = await fetch(`${BASE_URL}/api/v1/human-do`, { signal: AbortSignal.timeout(15_000) })
    if (probe.status !== 402) die(`Server at ${BASE_URL} returned ${probe.status}, expected 402. Is \`pnpm dev\` running?`)
  } catch {
    die(`Cannot reach ${BASE_URL}. Start the server with \`pnpm dev\`.`)
  }

  const oracleBefore = await getPaymentAssetBalance(ORACLE)

  // ── 1–2. Challenge and signature ───────────────────────────────────────────
  step(1, 'Agent fetches the 402 challenge and signs a Hedera payment')
  const pay = await agentPay(BUDGET, `${BASE_URL}/api/v1/human-do`)
  for (const s of pay.steps) info(s)
  pass(`signed by ${pay.agentAccount}`)

  // ── 3. Paid task creation ──────────────────────────────────────────────────
  step(2, 'Paid request creates the task')
  const createRes = await fetch(`${BASE_URL}/api/v1/human-do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PAYMENT': pay.paymentHeader },
    body: JSON.stringify({
      intent: 'E2E — photograph the entrance of the nearest open coffee shop',
      proof_spec: { type: 'photo', instructions: 'Clear photo of the entrance', minPhotos: 1 },
      budget_usdt: BUDGET,
      timeout_seconds: 3600,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const created = await createRes.json()
  if (createRes.status !== 201) {
    console.error(JSON.stringify(created, null, 2))
    die(`Task creation failed with HTTP ${createRes.status}`)
  }
  const taskId: string = created.task_id
  const txId: string = created.payment.tx_id
  pass(`task ${taskId} created`)
  info(`payment tx ${txId}`)
  info(explorerTx(txId))

  // ── 4. Independent confirmation ────────────────────────────────────────────
  step(3, 'Mirror node confirms the payment')
  const conf = await verifyPaymentOnMirror({ txId, requiredUnits: toUnits(BUDGET) })
  conf.valid
    ? pass(`confirmed — ${fromUnits(conf.amountUnits ?? 0n)} ${PAYMENT_ASSET_SYMBOL} from ${conf.payer}`)
    : bad(`mirror did not confirm: ${conf.reason}`)

  // ── 5. Claim ───────────────────────────────────────────────────────────────
  step(4, 'A human oracle claims the mission')
  const claimRes = await fetch(`${BASE_URL}/api/tasks/${taskId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_wallet: ORACLE }),
  })
  claimRes.ok ? pass(`claimed by ${ORACLE}`) : bad(`claim failed: HTTP ${claimRes.status}`)

  // ── 6. Submit proof ────────────────────────────────────────────────────────
  step(5, 'Oracle submits photo proof')
  const challenge: string = created.proof_spec?.challenge ?? ''
  info(`freshness code for this task: ${challenge}`)
  const PNG = await renderProofImage(challenge)

  const fd = new FormData()
  fd.append('task_id', taskId)
  fd.append('worker_wallet', ORACLE)
  fd.append('proof_type', 'photo')
  fd.append('photos', new File([new Uint8Array(PNG)], 'proof.png', { type: 'image/png' }))

  const submitRes = await fetch(`${BASE_URL}/api/tasks/${taskId}/submit`, {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(180_000),
  })
  const submitBody = await submitRes.json()
  if (!submitRes.ok) {
    console.error(JSON.stringify(submitBody, null, 2))
    die(`Submission failed with HTTP ${submitRes.status}`)
  }
  pass(`submitted — status ${submitBody.status}`)
  info(`notary: ${submitBody.notary?.decision ?? 'n/a'} (${submitBody.notary?.reason ?? 'no reason'})`)

  // ── 7. Agent review ────────────────────────────────────────────────────────
  // Without a vision key the notary returns 'uncertain' and the task is held
  // for review rather than auto-paid — fail-closed by design. The paying agent
  // then decides, which is the buyer-driven path the MCP review_task tool uses.
  let settle = submitBody.settle
  if (submitBody.status !== 'verified') {
    step(6, 'Paying agent reviews the proof and accepts')
    const adminSecret = process.env.ADMIN_SECRET
    if (!adminSecret) die('ADMIN_SECRET must be set so the agent can review')
    const reviewRes = await fetch(`${BASE_URL}/api/v1/tasks/${taskId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DEMO-KEY': adminSecret },
      body: JSON.stringify({ decision: 'accept' }),
      signal: AbortSignal.timeout(180_000),
    })
    const reviewBody = await reviewRes.json()
    if (!reviewRes.ok) {
      console.error(JSON.stringify(reviewBody, null, 2))
      die(`Review failed with HTTP ${reviewRes.status}`)
    }
    settle = reviewBody.settle
    pass('accepted by the paying agent')
  } else {
    step(6, 'Notary auto-accepted — no manual review needed')
    pass('auto-verified')
  }

  // ── 8. Payout and anchor ───────────────────────────────────────────────────
  step(7, 'Oracle is paid on Hedera and the proof is anchored to HCS')
  settle?.success ? pass(`payout tx ${settle.txId}`) : bad(`payout failed: ${settle?.error}`)
  if (settle?.explorer) info(settle.explorer)
  settle?.payout ? pass(`paid ${settle.payout} ${settle.asset}`) : bad('no payout amount recorded')
  settle?.anchor?.anchored
    ? pass(`proof anchored at HCS sequence #${settle.anchor.sequenceNumber}`)
    : bad(`anchor failed: ${settle?.anchor?.error}`)
  if (settle?.anchor?.topicExplorer) info(settle.anchor.topicExplorer)

  await new Promise(r => setTimeout(r, 4000))
  const oracleAfter = await getPaymentAssetBalance(ORACLE)
  const delta = oracleAfter - oracleBefore
  info(`oracle balance ${fromUnits(oracleBefore)} → ${fromUnits(oracleAfter)} (${fromUnits(delta)})`)

  // ── 9. Retrieve the deliverable ────────────────────────────────────────────
  step(8, 'Paying agent retrieves the proof it paid for')
  const statusRes = await fetch(`${BASE_URL}/api/v1/tasks/${taskId}`)
  const status = await statusRes.json()
  status.status === 'verified' ? pass('task reports verified') : bad(`status is ${status.status}`)

  const urls: string[] = status.proof_urls ?? []
  urls.length > 0 ? pass(`${urls.length} signed proof URL(s) returned`) : bad('no proof URLs — deliverable is missing')

  if (urls.length > 0) {
    const imgRes = await fetch(urls[0])
    const bytes = Buffer.from(await imgRes.arrayBuffer())
    imgRes.ok && Buffer.compare(bytes, PNG) === 0
      ? pass('proof image downloads and matches the bytes submitted')
      : bad(`proof download failed (HTTP ${imgRes.status}, ${bytes.byteLength} bytes)`)

    // The link must be signed, not merely obscure.
    const unsigned = urls[0].split('?')[0]
    const unsignedRes = await fetch(unsigned)
    unsignedRes.status === 403
      ? pass('the same URL without a signature is refused')
      : bad(`SECURITY: unsigned proof URL returned HTTP ${unsignedRes.status}`)
  }

  console.log(`\n  \x1b[1mHashScan\x1b[0m`)
  console.log(`    payment : ${explorerTx(txId)}`)
  if (settle?.explorer) console.log(`    payout  : ${settle.explorer}`)
  if (settle?.anchor?.topicExplorer) console.log(`    anchor  : ${settle.anchor.topicExplorer}`)
  console.log(`    board   : ${BASE_URL}/tasks/${taskId}`)

  closeHederaClients()
  await closeMongo()

  console.log(
    `\n${failed === 0 ? '\x1b[32m\x1b[1mALL PASS\x1b[0m' : '\x1b[31m\x1b[1mFAILURES\x1b[0m'} — ` +
      `${passed} passed, ${failed} failed\n`
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('\n\x1b[31mE2E crashed:\x1b[0m', e instanceof Error ? e.stack : e)
  process.exit(1)
})
