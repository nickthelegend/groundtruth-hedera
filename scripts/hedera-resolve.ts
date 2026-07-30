#!/usr/bin/env node
/**
 * Resolve auto-created Hedera account ids after funding.
 *
 *   npx tsx scripts/hedera-resolve.ts
 *
 * Reads the keys written by hedera-keygen.ts, derives each EVM address, and
 * asks a public Mirror Node which 0.0.x account id it was assigned. Accounts
 * only exist once funded, so an unfunded address reports as pending.
 *
 * Resolved ids are written back into .env.local.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrivateKey } from '@hiero-ledger/sdk'

const ENV_PATH = resolve(process.cwd(), '.env.local')

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) {
    console.error(`\n  .env.local not found. Run scripts/hedera-keygen.ts first.\n`)
    process.exit(1)
  }
  const out: Record<string, string> = {}
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function upsertEnv(key: string, value: string) {
  const raw = readFileSync(ENV_PATH, 'utf8')
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  writeFileSync(ENV_PATH, re.test(raw) ? raw.replace(re, line) : `${raw.replace(/\n*$/, '\n')}${line}\n`)
}

async function resolveAccount(
  mirror: string,
  evmAddress: string
): Promise<{ accountId?: string; balanceHbar?: string }> {
  try {
    const res = await fetch(`${mirror}/api/v1/accounts/${evmAddress}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return {}
    const data = (await res.json()) as {
      account?: string
      balance?: { balance?: number }
    }
    return {
      accountId: data.account,
      balanceHbar:
        data.balance?.balance !== undefined
          ? (data.balance.balance / 1e8).toFixed(4)
          : undefined,
    }
  } catch {
    return {}
  }
}

async function main() {
  const env = loadEnv()
  const network = (env.HEDERA_NETWORK ?? 'hedera:testnet').split(':')[1] ?? 'testnet'
  const mirror = env.HEDERA_MIRROR_NODE_URL ?? `https://${network}.mirrornode.hedera.com`

  const targets = [
    { label: 'treasury', keyVar: 'HEDERA_OPERATOR_KEY', idVar: 'HEDERA_OPERATOR_ID' },
    { label: 'agent', keyVar: 'AGENT_PRIVATE_KEY', idVar: 'AGENT_ACCOUNT_ID' },
  ]

  console.log(`\n\x1b[1mResolving Hedera accounts\x1b[0m (${network})\n`)

  let pending = 0

  for (const t of targets) {
    const raw = env[t.keyVar]
    if (!raw) {
      console.log(`  ${t.label}: ${t.keyVar} not set — skipping`)
      continue
    }

    const key = PrivateKey.fromStringECDSA(raw)
    const evmAddress = `0x${key.publicKey.toEvmAddress()}`
    const { accountId, balanceHbar } = await resolveAccount(mirror, evmAddress)

    if (!accountId) {
      pending++
      console.log(`  \x1b[33m○\x1b[0m ${t.label}`)
      console.log(`      ${evmAddress}`)
      console.log(`      not created yet — send testnet HBAR to that address\n`)
      continue
    }

    upsertEnv(t.idVar, accountId)
    console.log(`  \x1b[32m✓\x1b[0m ${t.label}  \x1b[1m${accountId}\x1b[0m  (${balanceHbar ?? '?'} HBAR)`)
    console.log(`      ${evmAddress}`)
    console.log(`      https://hashscan.io/${network}/account/${accountId}\n`)
  }

  if (pending > 0) {
    console.log(
      `  ${pending} account(s) still unfunded. Fund them, wait a few seconds,\n` +
        `  then run this again.\n`
    )
    process.exit(1)
  }

  console.log(`  Account ids written to .env.local. Next:\n    pnpm hedera:setup\n`)
}

main().catch((e) => {
  console.error('\nResolve failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
