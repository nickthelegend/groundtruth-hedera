#!/usr/bin/env node
/**
 * Settlement primitives test — no server, no database.
 *
 *   npx tsx scripts/test-settlement.ts
 *
 * Covers what happens after a proof is accepted:
 *   1. native payout transfer from the treasury to an oracle account
 *   2. proof anchoring to the HCS topic
 *   3. reading the anchor back from a public Mirror Node
 *   4. money maths (decimal handling, fee split) against the configured asset
 *
 * Pays the agent account a token amount so the test is self-funding in aggregate
 * — the agent pays for tasks, the treasury pays it back here.
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

const pass = (m: string) => (passed++, console.log(`  \x1b[32m✓\x1b[0m ${m}`))
const fail = (m: string) => (failed++, console.log(`  \x1b[31m✗\x1b[0m ${m}`))
const info = (m: string) => console.log(`      \x1b[2m${m}\x1b[0m`)
const section = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`)

async function main() {
  const {
    transferPaymentAsset,
    getPaymentAssetBalance,
    PAYMENT_ASSET_SYMBOL,
    PAYMENT_ASSET_ID,
    normalizeAccountId,
    isHederaAccountId,
    toHashScanTxId,
    toMirrorTxId,
    closeHederaClients,
  } = await import('../lib/hedera')
  const { anchorProof, readAnchoredProofs, proofTopicId } = await import('../lib/hcs')
  const { toUnits, fromUnits, splitBudget, paymentDecimals } = await import('../lib/money')

  const oracle = process.env.AGENT_ACCOUNT_ID!
  const PRICE = process.env.ASP_PRICE_USDT ?? '0.50'
  const FEE_BPS = Number(process.env.ASP_FEE_BPS ?? '1200')

  console.log(`\n\x1b[1mSettlement primitives\x1b[0m`)
  console.log(`  asset  : ${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID}, ${paymentDecimals}dp)`)
  console.log(`  topic  : ${proofTopicId() ?? '(not configured)'}`)

  // ── 1. Money maths ──────────────────────────────────────────────────────────
  section('1. Money maths for the configured asset')
  const expectedScale = PAYMENT_ASSET_ID === '0.0.0' ? 8 : 6
  paymentDecimals === expectedScale
    ? pass(`decimals resolved to ${paymentDecimals} for ${PAYMENT_ASSET_SYMBOL}`)
    : fail(`decimals is ${paymentDecimals}, expected ${expectedScale}`)

  const oneUnit = toUnits('1')
  oneUnit === 10n ** BigInt(paymentDecimals)
    ? pass(`"1" → ${oneUnit} atomic units`)
    : fail(`"1" → ${oneUnit}, expected ${10n ** BigInt(paymentDecimals)}`)

  fromUnits(toUnits('0.5')) === '0.5'
    ? pass('round-trips "0.5" exactly')
    : fail(`round-trip gave "${fromUnits(toUnits('0.5'))}"`)

  const { feeUnits, payoutUnits } = splitBudget(PRICE, FEE_BPS)
  feeUnits + payoutUnits === toUnits(PRICE)
    ? pass(`fee split is lossless — ${fromUnits(payoutUnits)} payout + ${fromUnits(feeUnits)} fee`)
    : fail('fee split loses value')

  ;(feeUnits * 10000n) / toUnits(PRICE) === BigInt(FEE_BPS)
    ? pass(`fee is exactly ${FEE_BPS} bps`)
    : fail(`fee is ${(feeUnits * 10000n) / toUnits(PRICE)} bps, expected ${FEE_BPS}`)

  // ── 2. Account id handling ──────────────────────────────────────────────────
  section('2. Account id handling')
  isHederaAccountId('0.0.12345') ? pass('accepts 0.0.12345') : fail('rejected a valid id')
  !isHederaAccountId('0xabc') ? pass('rejects an EVM address') : fail('accepted an EVM address')
  normalizeAccountId('  0.0.123  ') === '0.0.123'
    ? pass('trims whitespace')
    : fail('did not trim whitespace')

  toHashScanTxId('0.0.1-1700000000-123') === '0.0.1@1700000000.123'
    ? pass('converts mirror tx id → HashScan form')
    : fail('HashScan tx id conversion wrong')
  toMirrorTxId('0.0.1@1700000000.123') === '0.0.1-1700000000-123'
    ? pass('converts HashScan tx id → mirror form')
    : fail('mirror tx id conversion wrong')

  // ── 3. Native payout ────────────────────────────────────────────────────────
  section('3. Native payout to an oracle account')
  const before = await getPaymentAssetBalance(oracle)
  info(`oracle ${oracle} before: ${fromUnits(before)} ${PAYMENT_ASSET_SYMBOL}`)

  let payoutTx: string | undefined
  try {
    const transfer = await transferPaymentAsset(oracle, payoutUnits)
    payoutTx = transfer.txId
    transfer.status === 'SUCCESS'
      ? pass(`payout settled — ${transfer.txId}`)
      : fail(`payout status ${transfer.status}`)
    info(transfer.explorer)
  } catch (e) {
    fail(`payout failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (payoutTx) {
    await new Promise((r) => setTimeout(r, 4000))
    const after = await getPaymentAssetBalance(oracle)
    after - before === payoutUnits
      ? pass(`oracle credited exactly ${fromUnits(payoutUnits)} ${PAYMENT_ASSET_SYMBOL}`)
      : fail(`oracle delta ${fromUnits(after - before)}, expected ${fromUnits(payoutUnits)}`)
  }

  // ── 4. HCS proof anchor ─────────────────────────────────────────────────────
  section('4. Anchor a proof to Hedera Consensus Service')
  const taskId = `test-${Date.now()}`
  const anchor = await anchorProof({
    v: 1,
    taskId,
    proofHash: 'a'.repeat(64),
    intentHash: 'b'.repeat(64),
    verdict: 'accept',
    confidence: 0.97,
    worker: oracle,
    payoutUnits: payoutUnits.toString(),
    asset: PAYMENT_ASSET_ID,
    at: new Date().toISOString(),
  })

  anchor.anchored
    ? pass(`anchored at sequence #${anchor.sequenceNumber} — ${anchor.txId}`)
    : fail(`anchor failed: ${anchor.error}`)
  if (anchor.explorer) info(anchor.explorer)

  // ── 5. Read the anchor back ─────────────────────────────────────────────────
  section('5. Read the anchor back from a public Mirror Node')
  if (!anchor.anchored) {
    fail('skipped — nothing was anchored')
  } else {
    let found = null
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const messages = await readAnchoredProofs(15)
      found = messages.find(
        (m) => (m.payload as { taskId?: string }).taskId === taskId
      )
      if (found) break
    }

    if (found) {
      pass(`anchor readable from public mirror at consensus ${found.consensusTimestamp}`)
      const payload = found.payload as Record<string, unknown>
      payload.verdict === 'accept' && payload.worker === oracle
        ? pass('anchored payload matches what we wrote')
        : fail(`payload mismatch: ${JSON.stringify(payload)}`)
      info(`anyone can replay this topic — no GroundTruth API required`)
    } else {
      fail('anchor not visible on mirror node after ~20s')
    }
  }

  closeHederaClients()
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
