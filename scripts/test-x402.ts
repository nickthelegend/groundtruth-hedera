#!/usr/bin/env node
/**
 * x402 payment rail test — no server, no database.
 *
 *   npx tsx scripts/test-x402.ts
 *
 * Exercises the payment path in isolation so a failure here is unambiguously a
 * payment problem rather than an app problem:
 *
 *   1. resource server builds a 402 challenge (facilitator metadata merged in)
 *   2. agent client signs a real Hedera transfer satisfying it
 *   3. facilitator VERIFIES the signed transaction
 *   4. facilitator SETTLES it — co-signs as fee payer, submits to Hedera
 *   5. public Mirror Node independently CONFIRMS the transfer
 *   6. balances are re-read to prove value actually moved
 *
 * Also runs negative cases: a tampered header and a replayed payment must both
 * be rejected.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const file of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      if (process.env[m[1]]) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    break
  } catch {
    /* next candidate */
  }
}

let passed = 0
let failed = 0

function pass(msg: string) {
  passed++
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
}

function fail(msg: string) {
  failed++
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
}

function info(msg: string) {
  console.log(`      \x1b[2m${msg}\x1b[0m`)
}

function section(msg: string) {
  console.log(`\n\x1b[1m${msg}\x1b[0m`)
}

async function main() {
  const {
    buildChallenge,
    buildPaymentRequirements,
    verifyPayment,
    settlePayment,
    facilitatorUrl,
  } = await import('../lib/x402')
  const { agentPay } = await import('../lib/agent-pay')
  const { verifyPaymentOnMirror } = await import('../lib/mirror-verify')
  const {
    HEDERA_NETWORK,
    PAYMENT_ASSET_ID,
    PAYMENT_ASSET_SYMBOL,
    getPaymentAssetBalance,
    getPayToAccount,
    explorerTx,
    closeHederaClients,
  } = await import('../lib/hedera')
  const { toUnits, fromUnits } = await import('../lib/money')

  const PRICE = process.env.ASP_PRICE_USDT ?? '0.50'
  const agentAccount = process.env.AGENT_ACCOUNT_ID!
  const payTo = getPayToAccount()

  console.log(`\n\x1b[1mx402 payment rail — ${HEDERA_NETWORK}\x1b[0m`)
  console.log(`  facilitator : ${facilitatorUrl}`)
  console.log(`  asset       : ${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID})`)
  console.log(`  price       : ${PRICE} ${PAYMENT_ASSET_SYMBOL}`)
  console.log(`  agent       : ${agentAccount}`)
  console.log(`  payTo       : ${payTo}`)

  // ── 1. Challenge ────────────────────────────────────────────────────────────
  section('1. Build the 402 challenge')
  const challenge = await buildChallenge('/api/v1/human-do', PRICE)
  const accepts = challenge.accepts[0]

  challenge.x402Version === 2
    ? pass('x402Version is 2')
    : fail(`x402Version is ${challenge.x402Version}, expected 2`)

  accepts.network === HEDERA_NETWORK
    ? pass(`network is ${HEDERA_NETWORK}`)
    : fail(`network is ${accepts.network}`)

  accepts.scheme === 'exact' ? pass('scheme is exact') : fail(`scheme is ${accepts.scheme}`)

  accepts.amount === toUnits(PRICE).toString()
    ? pass(`amount is ${accepts.amount} atomic units (= ${PRICE} ${PAYMENT_ASSET_SYMBOL})`)
    : fail(`amount is ${accepts.amount}, expected ${toUnits(PRICE)}`)

  const feePayer = (accepts.extra as Record<string, unknown>)?.feePayer
  feePayer
    ? pass(`facilitator fee payer merged in: ${feePayer}`)
    : fail('no feePayer in challenge — client cannot build a co-signable transaction')

  // ── 2. Balances before ──────────────────────────────────────────────────────
  section('2. Record balances before payment')
  const agentBefore = await getPaymentAssetBalance(agentAccount)
  const payToBefore = await getPaymentAssetBalance(payTo)
  info(`agent  ${fromUnits(agentBefore)} ${PAYMENT_ASSET_SYMBOL}`)
  info(`payTo  ${fromUnits(payToBefore)} ${PAYMENT_ASSET_SYMBOL}`)
  pass('balances read')

  // ── 3. Sign ─────────────────────────────────────────────────────────────────
  section('3. Agent signs a Hedera transfer for the challenge')
  const pay = await agentPay(PRICE, 'unused://challenge-supplied-directly', challenge)
  pay.paymentHeader ? pass('payment header produced') : fail('no payment header')
  info(`header is ${pay.paymentHeader.length} bytes of base64`)

  // ── 4. Verify ───────────────────────────────────────────────────────────────
  section('4. Facilitator verifies the signed payment')
  const verification = await verifyPayment(pay.paymentHeader, PRICE)
  verification.valid
    ? pass(`verified — payer ${verification.payer}`)
    : fail(`verification failed: ${verification.reason}`)

  if (!verification.valid) {
    closeHederaClients()
    return finish()
  }

  // ── 5. Negative: tampered header ────────────────────────────────────────────
  section('5. Negative — a tampered payment must be rejected')
  const decoded = JSON.parse(Buffer.from(pay.paymentHeader, 'base64').toString('utf8'))
  const tampered = structuredClone(decoded)
  tampered.accepted.payTo = '0.0.1'
  const tamperedHeader = Buffer.from(JSON.stringify(tampered)).toString('base64')
  const tamperedResult = await verifyPayment(tamperedHeader, PRICE)
  !tamperedResult.valid
    ? pass(`redirected payTo rejected — "${tamperedResult.reason}"`)
    : fail('SECURITY: a payment redirected to another account was accepted')

  const underpaid = structuredClone(decoded)
  underpaid.accepted.amount = '1'
  const underpaidHeader = Buffer.from(JSON.stringify(underpaid)).toString('base64')
  const underpaidResult = await verifyPayment(underpaidHeader, PRICE)
  !underpaidResult.valid
    ? pass(`underpayment rejected — "${underpaidResult.reason}"`)
    : fail('SECURITY: an underpayment was accepted')

  // ── 6. Settle ───────────────────────────────────────────────────────────────
  section('6. Facilitator settles on Hedera')
  const settlement = await settlePayment(pay.paymentHeader, PRICE)
  settlement.success
    ? pass(`settled — tx ${settlement.txId}`)
    : fail(`settlement failed: ${settlement.reason}`)

  if (!settlement.success || !settlement.txId) {
    closeHederaClients()
    return finish()
  }
  info(explorerTx(settlement.txId))

  // ── 7. Mirror Node confirmation ─────────────────────────────────────────────
  section('7. Independent confirmation on a public Mirror Node')
  const confirmation = await verifyPaymentOnMirror({
    txId: settlement.txId,
    requiredUnits: toUnits(PRICE),
  })
  confirmation.valid
    ? pass(`confirmed in consensus at ${confirmation.consensusTimestamp}`)
    : fail(`mirror node did not confirm: ${confirmation.reason}`)
  if (confirmation.valid) {
    info(`payer  ${confirmation.payer}`)
    info(`payee  ${confirmation.payee}`)
    info(`amount ${fromUnits(confirmation.amountUnits ?? 0n)} ${PAYMENT_ASSET_SYMBOL}`)
  }

  // ── 8. Negative: replay ─────────────────────────────────────────────────────
  section('8. Negative — replaying the settled payment must fail')
  const replay = await settlePayment(pay.paymentHeader, PRICE)
  !replay.success
    ? pass(`replay rejected — "${replay.reason}"`)
    : fail(`SECURITY: the same payment settled twice (${replay.txId})`)

  // ── 9. Balances after ───────────────────────────────────────────────────────
  section('9. Confirm value actually moved')
  await new Promise((r) => setTimeout(r, 4000))
  const agentAfter = await getPaymentAssetBalance(agentAccount)
  const payToAfter = await getPaymentAssetBalance(payTo)
  const agentDelta = agentAfter - agentBefore
  const payToDelta = payToAfter - payToBefore
  info(`agent  ${fromUnits(agentBefore)} → ${fromUnits(agentAfter)}  (${fromUnits(agentDelta)})`)
  info(`payTo  ${fromUnits(payToBefore)} → ${fromUnits(payToAfter)}  (${fromUnits(payToDelta)})`)

  payToDelta >= toUnits(PRICE)
    ? pass(`payee credited ${fromUnits(payToDelta)} ${PAYMENT_ASSET_SYMBOL}`)
    : fail(`payee credited ${fromUnits(payToDelta)}, expected at least ${PRICE}`)

  // The agent pays the transfer but NOT the network fee — the facilitator is fee
  // payer. So the debit should be the price exactly, not price + gas.
  agentDelta === -toUnits(PRICE)
    ? pass('agent debited exactly the price — facilitator covered the network fee')
    : info(`agent delta ${fromUnits(agentDelta)} (expected -${PRICE})`)

  console.log(`\n  \x1b[1mHashScan:\x1b[0m ${explorerTx(settlement.txId)}`)

  closeHederaClients()
  finish()
}

function finish() {
  console.log(
    `\n${failed === 0 ? '\x1b[32m\x1b[1mALL PASS\x1b[0m' : '\x1b[31m\x1b[1mFAILURES\x1b[0m'} — ` +
      `${passed} passed, ${failed} failed\n`
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\n\x1b[31mTest crashed:\x1b[0m', e instanceof Error ? e.stack : e)
  process.exit(1)
})
