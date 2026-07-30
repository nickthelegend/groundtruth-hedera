import { x402Client } from '@x402/core/client'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import type { Network, PaymentRequired } from '@x402/core/types'
import { createClientHederaSigner } from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import {
  HEDERA_NETWORK,
  PAYMENT_ASSET_ID,
  PAYMENT_ASSET_SYMBOL,
  PAYMENT_ASSET_DECIMALS,
  IS_HBAR,
  parsePrivateKey,
  normalizeAccountId,
  getPaymentAssetBalance,
  isTokenAssociated,
  associateToken,
  explorerAccount,
} from './hedera'
import { toUnits, fromUnits } from './money'

// ── Autonomous agent payment ──────────────────────────────────────────────────
//
// This is the agent side of x402: it hits the resource unpaid, receives a 402
// challenge, builds and signs a Hedera transfer that satisfies it, and hands
// back a payment header to retry with.
//
// The agent wallet is deliberately a DIFFERENT account from the treasury that
// pays workers. That keeps the on-chain story honest — agent → treasury →
// worker is a real two-sided market, not one account paying itself.
//
// Note the agent signs but does not submit. The facilitator co-signs as fee
// payer and submits, which is why an agent account needs the payment asset but
// needs no HBAR for gas.

export interface AgentPayResult {
  success: boolean
  agentAccount: string
  agentExplorer: string
  asset: string
  assetSymbol: string
  balanceBefore: string
  required: string
  associationTx?: string
  paymentHeader: string
  steps: string[]
}

function agentSigner() {
  const accountId = process.env.AGENT_ACCOUNT_ID ?? process.env.HEDERA_OPERATOR_ID
  const rawKey = process.env.AGENT_PRIVATE_KEY ?? process.env.HEDERA_OPERATOR_KEY

  if (!accountId || !rawKey) {
    throw new Error(
      'No agent wallet configured (set AGENT_ACCOUNT_ID + AGENT_PRIVATE_KEY, or HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY)'
    )
  }

  const normalized = normalizeAccountId(accountId)
  const privateKey = parsePrivateKey(rawKey)

  const signer = createClientHederaSigner(normalized, privateKey, { network: HEDERA_NETWORK })

  const client = new x402Client().register(
    'hedera:*' as Network,
    new ExactHederaScheme(signer)
  )

  return { accountId: normalized, privateKey, client }
}

/**
 * Fetch the 402 challenge from the resource. A real round-trip rather than
 * building requirements locally — this is what proves the flow end to end.
 */
async function fetchChallenge(resourceUrl: string): Promise<PaymentRequired> {
  const res = await fetch(resourceUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })

  if (res.status !== 402) {
    throw new Error(`expected 402 challenge from ${resourceUrl}, got ${res.status}`)
  }

  const body = (await res.json()) as PaymentRequired
  if (!body?.accepts?.length) {
    throw new Error('402 response contained no payment requirements')
  }
  return body
}

/**
 * Produce a signed x402 payment header for `budget` worth of the payment asset.
 *
 * Handles the two Hedera-specific preconditions an EVM chain does not have:
 * the agent must be associated with the HTS token before it can send it, and
 * balances are queried per-token rather than per-contract.
 *
 * `presetChallenge` short-circuits the HTTP round-trip. Normal callers omit it
 * and let the agent fetch a real 402; tests pass one in so the payment path can
 * be exercised without a running server.
 */
export async function agentPay(
  budget: string,
  resourceUrl: string,
  presetChallenge?: PaymentRequired
): Promise<AgentPayResult> {
  const steps: string[] = []
  const { accountId, privateKey, client } = agentSigner()
  const requiredUnits = toUnits(budget)

  steps.push(`Agent account: ${accountId}`)
  steps.push(`Network: ${HEDERA_NETWORK}`)
  steps.push(`Asset: ${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID}, ${PAYMENT_ASSET_DECIMALS}dp)`)

  // ── Token association ───────────────────────────────────────────────────────
  // An HTS token cannot be sent from an account that has not associated it.
  let associationTx: string | undefined
  if (!IS_HBAR) {
    const associated = await isTokenAssociated(accountId)
    if (!associated) {
      steps.push(`Associating token ${PAYMENT_ASSET_ID}...`)
      try {
        const result = await associateToken(accountId, privateKey)
        associationTx = result.txId
        steps.push(
          result.alreadyAssociated
            ? 'Token already associated'
            : `Token associated: ${result.txId}`
        )
      } catch (e) {
        steps.push(`Association failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      steps.push('Token already associated')
    }
  }

  // ── Balance check ───────────────────────────────────────────────────────────
  let balanceUnits = 0n
  try {
    balanceUnits = await getPaymentAssetBalance(accountId)
  } catch (e) {
    steps.push(`Balance query failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  const balanceBefore = fromUnits(balanceUnits)
  steps.push(`Balance: ${balanceBefore} ${PAYMENT_ASSET_SYMBOL} (need ${budget})`)

  if (balanceUnits < requiredUnits) {
    throw new Error(
      `Agent account ${accountId} holds ${balanceBefore} ${PAYMENT_ASSET_SYMBOL} but needs ${budget}. ` +
        `Fund it${IS_HBAR ? ' from the Hedera Portal faucet' : ` with ${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID})`}.`
    )
  }

  // ── 402 round-trip ──────────────────────────────────────────────────────────
  let challenge: PaymentRequired
  if (presetChallenge) {
    steps.push('Using a pre-supplied 402 challenge (no HTTP round-trip)')
    challenge = presetChallenge
  } else {
    steps.push(`Requesting 402 challenge from ${resourceUrl}...`)
    challenge = await fetchChallenge(resourceUrl)
  }
  const accepted = challenge.accepts[0]
  steps.push(
    `Challenge: ${accepted.amount} atomic units of ${accepted.asset} to ${accepted.payTo} (${accepted.network})`
  )

  // ── Sign ────────────────────────────────────────────────────────────────────
  // Builds a real Hedera TransferTransaction and signs it. The facilitator
  // co-signs as fee payer and submits — the agent never broadcasts.
  steps.push('Signing Hedera transfer for x402 exact scheme...')
  const payload = await client.createPaymentPayload(challenge)
  const paymentHeader = encodePaymentSignatureHeader(payload)
  steps.push('Payment signed — facilitator will co-sign as fee payer and submit to Hedera.')

  return {
    success: true,
    agentAccount: accountId,
    agentExplorer: explorerAccount(accountId),
    asset: PAYMENT_ASSET_ID,
    assetSymbol: PAYMENT_ASSET_SYMBOL,
    balanceBefore,
    required: budget,
    associationTx,
    paymentHeader,
    steps,
  }
}
