#!/usr/bin/env node
/**
 * HTTP endpoint suite — every route, happy path and rejection path.
 *
 *   pnpm dev            # in one terminal
 *   npx tsx scripts/test-endpoints.ts
 *
 * Spends one real payment (the configured price) to exercise the paid routes.
 * Everything else is free.
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

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const BUDGET = process.env.ASP_PRICE_USDT ?? '0.50'
const ADMIN = process.env.ADMIN_SECRET ?? ''
const ORACLE = process.env.E2E_ORACLE_ACCOUNT ?? process.env.AGENT_ACCOUNT_ID!

let passed = 0
let failed = 0
const pass = (m: string) => (passed++, console.log(`  \x1b[32m✓\x1b[0m ${m}`))
const bad = (m: string) => (failed++, console.log(`  \x1b[31m✗\x1b[0m ${m}`))
const section = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`)
const info = (m: string) => console.log(`      \x1b[2m${m}\x1b[0m`)

/** Assert an endpoint returns the expected status; returns the parsed body. */
async function expectStatus(
  label: string,
  url: string,
  expected: number | number[],
  init?: RequestInit
): Promise<any> {
  const want = Array.isArray(expected) ? expected : [expected]
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000), ...init })
    const text = await res.text()
    let body: any
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    want.includes(res.status)
      ? pass(`${label} → ${res.status}`)
      : bad(`${label} → ${res.status}, expected ${want.join('|')}  ${String(text).slice(0, 160)}`)
    return body
  } catch (e) {
    bad(`${label} → threw ${e instanceof Error ? e.message : e}`)
    return null
  }
}

async function main() {
  const { agentPay } = await import('../lib/agent-pay')
  const { closeHederaClients } = await import('../lib/hedera')
  const { closeMongo } = await import('../lib/mongo')

  console.log(`\n\x1b[1mEndpoint suite\x1b[0m  ${BASE}`)

  // ── Discovery / public reads ────────────────────────────────────────────────
  section('Public endpoints')
  const challenge = await expectStatus('GET  /api/v1/human-do (unpaid discovery)', `${BASE}/api/v1/human-do`, 402)
  challenge?.accepts?.[0]?.extra?.feePayer
    ? pass('402 challenge carries the facilitator fee payer')
    : bad('402 challenge missing feePayer — a client could not pay it')

  const pulse = await expectStatus('GET  /api/pulse', `${BASE}/api/pulse`, 200)
  typeof pulse?.total_tasks === 'number' ? pass('pulse returns numeric stats') : bad('pulse shape wrong')

  const recent = await expectStatus('GET  /api/recent', `${BASE}/api/recent`, 200)
  Array.isArray(recent?.completions) ? pass('recent returns a completions array') : bad('recent shape wrong')

  const open = await expectStatus('GET  /api/tasks', `${BASE}/api/tasks`, 200)
  Array.isArray(open) ? pass('tasks returns an array') : bad('tasks shape wrong')

  // payment_ref authorises an on-chain payout via the review route. It must
  // never appear on this unauthenticated endpoint.
  const leaked = Array.isArray(open)
    ? open.filter((t: Record<string, unknown>) => 'payment_ref' in t)
    : []
  leaked.length === 0
    ? pass('public task list does not leak payment_ref')
    : bad(`SECURITY: /api/tasks exposed payment_ref on ${leaked.length} task(s)`)

  const faucetMeta = await expectStatus('GET  /api/faucet (metadata)', `${BASE}/api/faucet`, 200)
  faucetMeta?.asset ? pass(`faucet advertises asset ${faucetMeta.asset}`) : bad('faucet metadata missing asset')

  await expectStatus('GET  /api/v1/tasks/<unknown>', `${BASE}/api/v1/tasks/00000000-0000-4000-8000-000000000000`, 404)

  // ── Auth ────────────────────────────────────────────────────────────────────
  section('Authorisation')
  await expectStatus('GET  /api/admin/queue (no secret)', `${BASE}/api/admin/queue`, 401)
  if (ADMIN) {
    await expectStatus('GET  /api/admin/queue (with secret)', `${BASE}/api/admin/queue`, 200, {
      headers: { 'x-admin-secret': ADMIN },
    })
    await expectStatus('GET  /api/admin/queue (wrong secret)', `${BASE}/api/admin/queue`, 401, {
      headers: { 'x-admin-secret': 'wrong' },
    })
  }

  // ── Payment gate ────────────────────────────────────────────────────────────
  section('Payment gate')
  const body = JSON.stringify({
    intent: 'ENDPOINT-TEST confirm the shop hours',
    proof_spec: { type: 'form', instructions: 'Report opening hours', formFields: ['hours'] },
    budget_usdt: BUDGET,
  })
  const json = { 'Content-Type': 'application/json' }

  await expectStatus('POST /api/v1/human-do (no payment)', `${BASE}/api/v1/human-do`, 402, {
    method: 'POST',
    headers: json,
    body,
  })

  await expectStatus('POST /api/v1/human-do (garbage payment header)', `${BASE}/api/v1/human-do`, 402, {
    method: 'POST',
    headers: { ...json, 'X-PAYMENT': 'bm90LWEtcGF5bWVudA==' },
    body,
  })

  await expectStatus('POST /api/v1/human-do (malformed JSON, paid header absent)', `${BASE}/api/v1/human-do`, 402, {
    method: 'POST',
    headers: json,
    body: '{not json',
  })

  // ── Paid path ───────────────────────────────────────────────────────────────
  section('Paid task creation (real USDC)')
  const pay = await agentPay(BUDGET, `${BASE}/api/v1/human-do`)
  const created = await expectStatus('POST /api/v1/human-do (valid payment)', `${BASE}/api/v1/human-do`, 201, {
    method: 'POST',
    headers: { ...json, 'X-PAYMENT': pay.paymentHeader },
    body,
  })
  const taskId: string | undefined = created?.task_id
  taskId ? pass(`task created ${taskId}`) : bad('no task id returned')
  if (created?.payment?.tx_id) info(`payment tx ${created.payment.tx_id}`)

  // Replay: the same header must not buy a second task.
  await expectStatus('POST /api/v1/human-do (replayed payment)', `${BASE}/api/v1/human-do`, [402, 409], {
    method: 'POST',
    headers: { ...json, 'X-PAYMENT': pay.paymentHeader },
    body,
  })

  if (!taskId) {
    await finish(closeHederaClients, closeMongo)
    return
  }

  await expectStatus('GET  /api/v1/tasks/:id', `${BASE}/api/v1/tasks/${taskId}`, 200)

  // ── Claim ───────────────────────────────────────────────────────────────────
  section('Claim')
  await expectStatus('POST /api/tasks/:id/claim (EVM address)', `${BASE}/api/tasks/${taskId}/claim`, 400, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ worker_wallet: '0xf566aaf0e2421c45fa280c59e0c46e5e898d1795' }),
  })
  await expectStatus('POST /api/tasks/:id/claim (valid)', `${BASE}/api/tasks/${taskId}/claim`, 200, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ worker_wallet: ORACLE }),
  })
  await expectStatus('POST /api/tasks/:id/claim (already claimed)', `${BASE}/api/tasks/${taskId}/claim`, 409, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ worker_wallet: '0.0.888888' }),
  })

  // ── Submit ──────────────────────────────────────────────────────────────────
  section('Submit proof')
  const spec = created.proof_spec
  const code = spec?.challenge ?? ''
  info(`freshness code: ${code}`)

  const wrongWorker = new FormData()
  wrongWorker.append('task_id', taskId)
  wrongWorker.append('worker_wallet', '0.0.888888')
  wrongWorker.append('proof_type', 'form')
  wrongWorker.append('form_data', JSON.stringify({ hours: `9am-5pm ${code}` }))
  await expectStatus('POST /api/tasks/:id/submit (not your task)', `${BASE}/api/tasks/${taskId}/submit`, [403, 409], {
    method: 'POST',
    body: wrongWorker,
  })

  // Missing the freshness code — a deterministic hard reject, no AI involved.
  const noCode = new FormData()
  noCode.append('task_id', taskId)
  noCode.append('worker_wallet', ORACLE)
  noCode.append('proof_type', 'form')
  noCode.append('form_data', JSON.stringify({ hours: '9am to 5pm' }))
  const rejected = await expectStatus(
    'POST /api/tasks/:id/submit (no freshness code)',
    `${BASE}/api/tasks/${taskId}/submit`,
    200,
    { method: 'POST', body: noCode }
  )
  rejected?.status === 'failed'
    ? pass('proof without the freshness code is rejected')
    : bad(`expected failed, got ${rejected?.status}`)
  rejected?.settle === undefined || rejected?.settle === null
    ? pass('no payout on a rejected proof')
    : bad('SECURITY: a rejected proof produced a settlement')

  // Retry by the same worker, this time including the code.
  const good = new FormData()
  good.append('task_id', taskId)
  good.append('worker_wallet', ORACLE)
  good.append('proof_type', 'form')
  good.append(
    'form_data',
    JSON.stringify({ hours: `Open 8am to 6pm daily. Reference code ${code}.` })
  )
  const submitted = await expectStatus(
    'POST /api/tasks/:id/submit (valid retry)',
    `${BASE}/api/tasks/${taskId}/submit`,
    200,
    { method: 'POST', body: good }
  )
  info(`notary: ${submitted?.notary?.decision} — ${submitted?.notary?.reason}`)

  // ── Review / payout ─────────────────────────────────────────────────────────
  section('Review and payout')
  let settle = submitted?.settle
  if (submitted?.status === 'verified') {
    pass('notary auto-accepted and settled inline')
  } else {
    await expectStatus('POST /api/v1/tasks/:id/review (no auth)', `${BASE}/api/v1/tasks/${taskId}/review`, 401, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ decision: 'accept' }),
    })
    const reviewed = await expectStatus(
      'POST /api/v1/tasks/:id/review (accept)',
      `${BASE}/api/v1/tasks/${taskId}/review`,
      200,
      { method: 'POST', headers: { ...json, 'X-DEMO-KEY': ADMIN }, body: JSON.stringify({ decision: 'accept' }) }
    )
    settle = reviewed?.settle
  }
  settle?.success ? pass(`oracle paid — ${settle.payout} ${settle.asset}`) : bad(`payout failed: ${settle?.error}`)
  if (settle?.explorer) info(settle.explorer)
  settle?.anchor?.anchored ? pass(`proof anchored at HCS #${settle.anchor.sequenceNumber}`) : bad('proof not anchored')

  // ── Proof retrieval ─────────────────────────────────────────────────────────
  section('Proof access control')
  const finalTask = await expectStatus('GET  /api/v1/tasks/:id (verified)', `${BASE}/api/v1/tasks/${taskId}`, 200)
  finalTask?.status === 'verified' ? pass('task reports verified') : bad(`status ${finalTask?.status}`)

  await expectStatus('GET  /api/proofs/<key> (no signature)', `${BASE}/api/proofs/${taskId}/0-deadbeef.jpg`, 403)
  await expectStatus(
    'GET  /api/proofs/<key> (forged signature)',
    `${BASE}/api/proofs/${taskId}/0-deadbeef.jpg?exp=${Math.floor(Date.now() / 1000) + 600}&sig=00`,
    403
  )

  // ── Faucet ──────────────────────────────────────────────────────────────────
  section('Faucet')
  await expectStatus('POST /api/faucet (invalid account)', `${BASE}/api/faucet`, 400, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ account: '0xdeadbeef' }),
  })
  await expectStatus('GET  /api/faucet?account=<id>', `${BASE}/api/faucet?account=${ORACLE}`, 200)

  // ── MCP ─────────────────────────────────────────────────────────────────────
  section('MCP transport')
  const mcp = await expectStatus('POST /api/mcp (tools/list)', `${BASE}/api/mcp`, [200, 202, 400, 406], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  if (typeof mcp === 'string' && mcp.includes('human_do')) pass('MCP advertises human_do')
  else if (mcp?.result?.tools) pass(`MCP advertises ${mcp.result.tools.length} tools`)
  else info('MCP requires a session handshake — exercised by the MCP client, not raw POST')

  await finish(closeHederaClients, closeMongo)
}

async function finish(closeHedera: () => void, closeDb: () => Promise<void>) {
  closeHedera()
  await closeDb()
  console.log(
    `\n${failed === 0 ? '\x1b[32m\x1b[1mALL PASS\x1b[0m' : '\x1b[31m\x1b[1mFAILURES\x1b[0m'} — ` +
      `${passed} passed, ${failed} failed\n`
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('\n\x1b[31mSuite crashed:\x1b[0m', e instanceof Error ? e.stack : e)
  process.exit(1)
})
