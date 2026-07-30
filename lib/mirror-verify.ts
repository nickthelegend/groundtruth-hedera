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
 * Fetch every record Hedera holds for a transaction id.
 *
 * One id can map to SEVERAL records: the top-level transaction (nonce 0) plus
 * child records such as the CRYPTOUPDATEACCOUNT emitted when a payer's account
 * was auto-created from an EVM alias. Those children carry an empty transfer
 * list and are frequently returned FIRST, so reading `transactions[0]` finds no
 * payment and wrongly reports a good payment as unconfirmed. Always scan them all.
 *
 * Mirror Nodes also lag consensus by a beat, so poll briefly rather than
 * rejecting a just-settled payment that has not propagated yet.
 */
async function fetchTransactionRecords(
  txId: string,
  attempts = 6,
  delayMs = 1500
): Promise<MirrorTransaction[]> {
  const url = `${MIRROR_NODE_URL}/api/v1/transactions/${toMirrorTxId(txId)}`

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        const data = (await res.json()) as { transactions?: MirrorTransaction[] }
        if (data.transactions?.length) return data.transactions
      }
    } catch {
      // Network hiccup — fall through to the retry.
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  return []
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

  const records = await fetchTransactionRecords(txId)
  if (records.length === 0) {
    return { valid: false, reason: 'transaction not found on mirror node', txId }
  }

  const successful = records.filter((r) => r.result === 'SUCCESS')
  if (successful.length === 0) {
    return { valid: false, reason: `transaction result ${records[0].result}`, txId }
  }

  // Positive entries credit an account, negative entries debit it. Gather the
  // relevant transfer entries across every successful record for this id.
  const entries: MirrorTransfer[] = successful.flatMap((r) =>
    IS_HBAR
      ? (r.transfers ?? [])
      : (r.token_transfers ?? []).filter((t) => t.token_id === PAYMENT_ASSET_ID)
  )

  const credited = entries
    .filter((t) => t.account === expectedPayee)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n)

  if (credited < requiredUnits) {
    return {
      valid: false,
      reason:
        credited <= 0n
          ? `no ${IS_HBAR ? 'HBAR' : PAYMENT_ASSET_ID} credited to ${expectedPayee}`
          : `credited ${credited} < required ${requiredUnits}`,
      txId,
    }
  }

  // The payer is whoever was debited the payment amount. On Hedera the fee payer
  // is often a DIFFERENT account from the sender (here, the x402 facilitator),
  // and it appears in the same transfer list paying network fees. Match on the
  // amount so we report the actual sender rather than the fee payer.
  const payer =
    entries.find((t) => BigInt(t.amount) === -credited)?.account ??
    entries
      .filter((t) => BigInt(t.amount) < 0n)
      .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? -1 : 1))[0]?.account

  if (expectedPayer && payer && expectedPayer !== payer) {
    return { valid: false, reason: `payer ${payer} does not match expected ${expectedPayer}`, txId }
  }

  const transferRecord =
    successful.find((r) => (r.transfers ?? r.token_transfers ?? []).length > 0) ?? successful[0]

  return {
    valid: true,
    payer,
    payee: expectedPayee,
    asset: IS_HBAR ? 'HBAR' : PAYMENT_ASSET_ID,
    amountUnits: credited,
    txId,
    explorer: explorerTx(txId),
    consensusTimestamp: transferRecord.consensus_timestamp,
  }
}
