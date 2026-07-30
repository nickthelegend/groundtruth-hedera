import {
  MIRROR_NODE_URL,
  PAYMENT_ASSET_ID,
  IS_HBAR,
  getPayToAccount,
  toMirrorTxId,
  explorerTx,
} from './hedera'

// ── Independent verification against a public Mirror Node ─────────────────────
//
// The facilitator tells us a payment settled. This module checks that claim
// against Hedera's public record, which is the actual source of truth.
//
// Every Hedera transaction is mirrored to public Mirror Nodes with its full
// transfer list. Given a transaction id we fetch that record and confirm the
// payee actually received at least the required amount of the right asset. A
// fabricated transaction id has no record; a real transaction that paid someone
// else, or paid too little, fails the transfer-list check.
//
// This is the same fail-closed posture the X Layer version had when it re-derived
// ERC-20 Transfer logs — the Hedera equivalent is simply cleaner, because the
// transfer list is a first-class field rather than an event we have to decode.

export interface MirrorVerification {
  valid: boolean
  reason?: string
  payer?: string
  payee?: string
  asset?: string
  amountUnits?: bigint
  txId?: string
  explorer?: string
  consensusTimestamp?: string
}

interface MirrorTransfer {
  account: string
  amount: number | string
}

interface MirrorTokenTransfer extends MirrorTransfer {
  token_id: string
}

interface MirrorTransaction {
  transaction_id: string
  result: string
  consensus_timestamp: string
  transfers?: MirrorTransfer[]
  token_transfers?: MirrorTokenTransfer[]
}

/**
 * Mirror Nodes lag consensus by a beat. Poll briefly rather than declaring a
 * just-settled payment invalid because the record hasn't propagated yet.
 */
async function fetchTransaction(
  txId: string,
  attempts = 5,
  delayMs = 1200
): Promise<MirrorTransaction | null> {
  const url = `${MIRROR_NODE_URL}/api/v1/transactions/${toMirrorTxId(txId)}`

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        const data = (await res.json()) as { transactions?: MirrorTransaction[] }
        const tx = data.transactions?.[0]
        if (tx) return tx
      }
    } catch {
      // Network hiccup — fall through to the retry.
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}

/**
 * Confirm `txId` credited the expected payee with at least `requiredUnits` of
 * the payment asset. Fails closed: anything we cannot positively confirm is
 * treated as invalid.
 */
export async function verifyPaymentOnMirror(params: {
  txId?: string
  requiredUnits: bigint
  expectedPayee?: string
  expectedPayer?: string
}): Promise<MirrorVerification> {
  const { txId, requiredUnits, expectedPayer } = params

  if (!txId) return { valid: false, reason: 'missing transaction id' }

  let expectedPayee: string
  try {
    expectedPayee = params.expectedPayee ?? getPayToAccount()
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message : 'payee not configured' }
  }

  const tx = await fetchTransaction(txId)
  if (!tx) return { valid: false, reason: 'transaction not found on mirror node', txId }
  if (tx.result !== 'SUCCESS') {
    return { valid: false, reason: `transaction result ${tx.result}`, txId }
  }

  // Positive entries credit an account, negative entries debit it. Find the
  // credit to our payee in whichever transfer list matches the payment asset.
  const credits: MirrorTransfer[] = IS_HBAR
    ? (tx.transfers ?? [])
    : (tx.token_transfers ?? []).filter((t) => t.token_id === PAYMENT_ASSET_ID)

  const credited = credits
    .filter((t) => t.account === expectedPayee)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n)

  if (credited < requiredUnits) {
    return {
      valid: false,
      reason:
        credited === 0n
          ? `no ${IS_HBAR ? 'HBAR' : PAYMENT_ASSET_ID} credited to ${expectedPayee}`
          : `credited ${credited} < required ${requiredUnits}`,
      txId,
    }
  }

  // The payer is whoever was debited. On Hedera the fee payer may differ from
  // the sender, so derive the payer from the transfer list rather than assuming
  // it is the account in the transaction id.
  const debited = credits.find((t) => BigInt(t.amount) < 0n)
  const payer = debited?.account

  if (expectedPayer && payer && expectedPayer !== payer) {
    return { valid: false, reason: `payer ${payer} does not match expected ${expectedPayer}`, txId }
  }

  return {
    valid: true,
    payer,
    payee: expectedPayee,
    asset: IS_HBAR ? 'HBAR' : PAYMENT_ASSET_ID,
    amountUnits: credited,
    txId,
    explorer: explorerTx(txId),
    consensusTimestamp: tx.consensus_timestamp,
  }
}
