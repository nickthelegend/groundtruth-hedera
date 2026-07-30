#!/usr/bin/env node
/**
 * GroundTruth — full paid round-trip on Hedera testnet.
 *
 *   npx tsx scripts/e2e-hedera-pay.ts
 *
 * Proves the whole loop with real transactions, one command:
 *
 *   1. GET  /api/v1/human-do            → 402 Payment Required + requirements
 *   2. sign a Hedera transfer that satisfies them (x402 `exact` scheme)
 *   3. POST /api/v1/human-do            → facilitator settles it on Hedera
 *   4. verify the settlement on a public Mirror Node
 *   5. print the HashScan links for the submission
 *
 * Requires a running server (`pnpm dev`) and a funded AGENT_ACCOUNT_ID.
 * Reads .env.local (falling back to .env).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const file of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const [, key, rawValue] = m
      if (process.env[key]) continue
      process.env[key] = rawValue.replace(/^["']|["']$/g, '')
    }
    break
  } catch {
    // Fall through to the next candidate / real env.
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const BUDGET = process.env.E2E_BUDGET ?? process.env.ASP_PRICE_USDT ?? '2.00'

function step(n: number, label: string) {
  console.log(`\n\x1b[1m[${n}]\x1b[0m ${label}`)
}

function ok(msg: string) {
  console.log(`    \x1b[32m✓\x1b[0m ${msg}`)
}

function info(msg: string) {
  console.log(`      ${msg}`)
}

function fail(msg: string): never {
  console.error(`    \x1b[31m✗\x1b[0m ${msg}\n`)
  process.exit(1)
}

async function main() {
  const { agentPay } = await import('../lib/agent-pay')
  const { verifyPaymentOnMirror } = await import('../lib/mirror-verify')
  const { HEDERA_NETWORK, PAYMENT_ASSET_ID, PAYMENT_ASSET_SYMBOL, explorerTx } = await import(
    '../lib/hedera'
  )
  const { toUnits } = await import('../lib/money')

  console.log(`\n\x1b[1mGroundTruth × Hedera — end-to-end paid task\x1b[0m`)
  console.log(`  server  : ${BASE_URL}`)
  console.log(`  network : ${HEDERA_NETWORK}`)
  console.log(`  asset   : ${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID})`)
  console.log(`  budget  : ${BUDGET}`)

  // ── 1 + 2. Challenge and signature ─────────────────────────────────────────
  step(1, 'Requesting the 402 challenge and signing a Hedera payment')
  let pay
  try {
    pay = await agentPay(BUDGET, `${BASE_URL}/api/v1/human-do`)
  } catch (e) {
    fail(`agent payment failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  for (const s of pay.steps) info(s)
  ok(`payment signed by ${pay.agentAccount}`)

  // ── 3. Paid task creation ──────────────────────────────────────────────────
  step(2, 'POSTing the paid request — facilitator settles on Hedera')
  const res = await fetch(`${BASE_URL}/api/v1/human-do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': pay.paymentHeader,
    },
    body: JSON.stringify({
      intent: 'E2E check — photograph the entrance of the nearest open coffee shop',
      proof_spec: {
        type: 'photo',
        instructions: 'Clear photo of the entrance showing the shop is open',
        minPhotos: 1,
      },
      budget_usdt: BUDGET,
      timeout_seconds: 3600,
    }),
    signal: AbortSignal.timeout(120_000),
  })

  const body = await res.json()

  if (res.status !== 201) {
    console.error(`    HTTP ${res.status}`)
    console.error(JSON.stringify(body, null, 2))
    fail('paid request rejected')
  }

  const txId: string | null = body.payment?.tx_id ?? null
  ok(`task created: ${body.task_id}`)
  info(`payer  : ${body.payment?.payer}`)
  info(`tx id  : ${txId ?? '(none recorded)'}`)

  if (!txId) fail('no Hedera transaction id returned — payment did not settle on-chain')

  // ── 4. Independent confirmation ────────────────────────────────────────────
  step(3, 'Confirming the payment on a public Mirror Node')
  const confirmation = await verifyPaymentOnMirror({
    txId,
    requiredUnits: toUnits(BUDGET),
  })

  if (!confirmation.valid) fail(`mirror node did not confirm: ${confirmation.reason}`)

  ok('payment confirmed in Hedera consensus')
  info(`payer     : ${confirmation.payer}`)
  info(`payee     : ${confirmation.payee}`)
  info(`amount    : ${confirmation.amountUnits} atomic units of ${confirmation.asset}`)
  info(`timestamp : ${confirmation.consensusTimestamp}`)

  // ── 5. Links ───────────────────────────────────────────────────────────────
  step(4, 'HashScan links')
  console.log(`\n  payment tx : ${explorerTx(txId)}`)
  console.log(`  agent      : ${pay.agentExplorer}`)
  console.log(`  task board : ${BASE_URL}/tasks/${body.task_id}`)

  console.log(
    `\n\x1b[32m\x1b[1mPASS\x1b[0m — real x402 payment settled on ${HEDERA_NETWORK}.\n` +
      `Complete the task at the board URL above to see the native ${PAYMENT_ASSET_SYMBOL} payout\n` +
      `and the HCS proof anchor.\n`
  )
}

main().catch((e) => {
  console.error('\nE2E failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
