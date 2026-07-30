#!/usr/bin/env node
/**
 * One-time Hedera setup for a fresh GroundTruth deployment.
 *
 *   npx tsx scripts/hedera-setup.ts
 *
 * Does three things, all idempotent:
 *   1. Associates the payment token (USDC) with the treasury and agent accounts,
 *      so both can hold and move it.
 *   2. Creates the HCS topic that verified proofs are anchored to.
 *   3. Prints balances and the env values you still need to set.
 *
 * Reads .env.local (falling back to .env) so it matches what `next dev` sees.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load env before importing anything that reads process.env at module scope.
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
    // File absent — fall through to the next candidate / real env.
  }
}

async function main() {
  const {
    PAYMENT_ASSET_ID,
    PAYMENT_ASSET_SYMBOL,
    IS_HBAR,
    HEDERA_NETWORK,
    parsePrivateKey,
    normalizeAccountId,
    associateToken,
    getPaymentAssetBalance,
    isTokenAssociated,
    explorerAccount,
  } = await import('../lib/hedera')
  const { createProofTopic } = await import('../lib/hcs')
  const { fromUnits } = await import('../lib/money')

  console.log(`\nGroundTruth — Hedera setup`)
  console.log(`  network : ${HEDERA_NETWORK}`)
  console.log(`  asset   : ${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID})\n`)

  const accounts: { label: string; id?: string; key?: string }[] = [
    {
      label: 'treasury',
      id: process.env.HEDERA_OPERATOR_ID,
      key: process.env.HEDERA_OPERATOR_KEY,
    },
    {
      label: 'agent',
      id: process.env.AGENT_ACCOUNT_ID,
      key: process.env.AGENT_PRIVATE_KEY,
    },
  ]

  // ── 1. Token association ────────────────────────────────────────────────────
  for (const account of accounts) {
    if (!account.id || !account.key) {
      console.log(`- ${account.label}: not configured, skipping`)
      continue
    }

    const id = normalizeAccountId(account.id)

    if (IS_HBAR) {
      console.log(`- ${account.label} ${id}: HBAR needs no association`)
    } else {
      const already = await isTokenAssociated(id)
      if (already) {
        console.log(`- ${account.label} ${id}: already associated with ${PAYMENT_ASSET_ID}`)
      } else {
        try {
          const res = await associateToken(id, parsePrivateKey(account.key))
          console.log(
            `- ${account.label} ${id}: associated ${PAYMENT_ASSET_ID}${res.txId ? ` (${res.txId})` : ''}`
          )
        } catch (e) {
          console.log(
            `- ${account.label} ${id}: association FAILED — ${e instanceof Error ? e.message : String(e)}`
          )
        }
      }
    }

    try {
      const balance = await getPaymentAssetBalance(id)
      console.log(
        `    balance: ${fromUnits(balance)} ${PAYMENT_ASSET_SYMBOL}   ${explorerAccount(id)}`
      )
    } catch (e) {
      console.log(`    balance: unavailable (${e instanceof Error ? e.message : String(e)})`)
    }
  }

  // ── 2. HCS proof topic ──────────────────────────────────────────────────────
  console.log('')
  if (process.env.HEDERA_PROOF_TOPIC_ID) {
    console.log(`- proof topic: already configured (${process.env.HEDERA_PROOF_TOPIC_ID})`)
  } else {
    try {
      const topic = await createProofTopic()
      console.log(`- proof topic created: ${topic.topicId}`)
      console.log(`    ${topic.explorer}`)
      console.log(`\n  Add this to .env.local:`)
      console.log(`    HEDERA_PROOF_TOPIC_ID=${topic.topicId}`)
    } catch (e) {
      console.log(`- proof topic: creation FAILED — ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log('\nDone.\n')

  const { closeHederaClients } = await import('../lib/hedera')
  closeHederaClients()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nSetup failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
