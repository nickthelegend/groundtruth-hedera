import {
  AccountBalanceQuery,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
  TransferTransaction,
} from '@hiero-ledger/sdk'

// ── Hedera rails ──────────────────────────────────────────────────────────────
//
// Everything GroundTruth touches on-chain lives on Hedera: x402 payments settle
// in HTS USDC, worker payouts are native HTS transfers, and proof hashes are
// anchored to a Hedera Consensus Service topic. This module owns the low-level
// Hedera surface — client construction, account/token IDs, Mirror Node reads,
// and HashScan links — so the rest of the app never imports the SDK directly.

/** CAIP-2 network id used by the x402 Hedera scheme. */
export const HEDERA_NETWORK = process.env.HEDERA_NETWORK ?? 'hedera:testnet'

/** `testnet` | `mainnet` — the bare name the SDK and HashScan expect. */
export const HEDERA_NETWORK_NAME = HEDERA_NETWORK.split(':')[1] ?? 'testnet'

const IS_MAINNET = HEDERA_NETWORK_NAME === 'mainnet'

/** Asset id x402 uses for native HBAR. */
export const HBAR_ASSET_ID = '0.0.0'

/** Circle USDC on Hedera. Testnet and mainnet have different token ids. */
export const USDC_TOKEN_ID = IS_MAINNET ? '0.0.456858' : '0.0.429274'

/**
 * The token payments and payouts are denominated in. Defaults to USDC; set
 * PAYMENT_ASSET_ID to `0.0.0` to run the whole flow in HBAR instead, or to any
 * other HTS token id for a custom asset.
 */
export const PAYMENT_ASSET_ID = process.env.PAYMENT_ASSET_ID ?? USDC_TOKEN_ID

/** USDC uses 6 decimals; HBAR is quoted in tinybars (8 decimals). */
export const PAYMENT_ASSET_DECIMALS = Number(
  process.env.PAYMENT_ASSET_DECIMALS ?? (PAYMENT_ASSET_ID === HBAR_ASSET_ID ? '8' : '6')
)

export const PAYMENT_ASSET_SYMBOL =
  process.env.PAYMENT_ASSET_SYMBOL ?? (PAYMENT_ASSET_ID === HBAR_ASSET_ID ? 'HBAR' : 'USDC')

export const IS_HBAR = PAYMENT_ASSET_ID === HBAR_ASSET_ID

export const MIRROR_NODE_URL =
  process.env.HEDERA_MIRROR_NODE_URL ?? `https://${HEDERA_NETWORK_NAME}.mirrornode.hedera.com`

const HASHSCAN_BASE = `https://hashscan.io/${HEDERA_NETWORK_NAME}`

/** Hedera entity ids look like `0.0.1234` (shard.realm.num). */
export const HEDERA_ID_REGEX = /^\d+\.\d+\.\d+$/

export function isHederaAccountId(value: string): boolean {
  return HEDERA_ID_REGEX.test(value.trim())
}

/**
 * Workers paste their own account id, so tolerate stray whitespace and a
 * leading `hedera:` prefix before validating.
 */
export function normalizeAccountId(value: string): string {
  const cleaned = value.trim().replace(/^hedera:(testnet|mainnet):?/i, '')
  if (!isHederaAccountId(cleaned)) {
    throw new Error(`Not a Hedera account id: ${value}`)
  }
  return AccountId.fromString(cleaned).toString()
}

// ── Explorer links ────────────────────────────────────────────────────────────

/**
 * HashScan wants the `0.0.x@seconds.nanos` form, but Mirror Node and several
 * SDK surfaces hand back `0.0.x-seconds-nanos`. Accept either.
 */
export function toHashScanTxId(txId: string): string {
  const m = txId.match(/^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/)
  return m ? `${m[1]}@${m[2]}.${m[3]}` : txId
}

/** Mirror Node wants the dashed form. */
export function toMirrorTxId(txId: string): string {
  const m = txId.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : txId
}

export function explorerTx(txId: string): string {
  return `${HASHSCAN_BASE}/transaction/${toHashScanTxId(txId)}`
}

export function explorerAccount(accountId: string): string {
  return `${HASHSCAN_BASE}/account/${accountId}`
}

export function explorerToken(tokenId: string): string {
  return `${HASHSCAN_BASE}/token/${tokenId}`
}

export function explorerTopic(topicId: string): string {
  return `${HASHSCAN_BASE}/topic/${topicId}`
}

// ── Client construction ───────────────────────────────────────────────────────

// DER algorithm identifiers. A DER-encoded private key names its own curve, so
// we read it instead of guessing.
const OID_ED25519 = '2b6570' // 1.3.101.112
const OID_SECP256K1 = '2b8104000a' // 1.3.132.0.10

/**
 * Hedera keys come in two flavours: the Portal hands out ECDSA by default, but
 * plenty of accounts are ED25519.
 *
 * Do NOT resolve this by trying one parser and falling back on throw.
 * `PrivateKey.fromStringECDSA` accepts an ED25519 DER string without
 * complaining and silently derives the WRONG public key — which means the wrong
 * account id, and signatures that fail for no visible reason. Detect the curve
 * from the DER algorithm identifier instead.
 */
export function parsePrivateKey(raw: string): PrivateKey {
  const key = raw.trim().replace(/^0x/i, '')

  const hint = (process.env.HEDERA_KEY_TYPE ?? '').toUpperCase()
  if (hint === 'ED25519') return PrivateKey.fromStringED25519(key)
  if (hint === 'ECDSA') return PrivateKey.fromStringECDSA(key)

  // A DER key starts with a SEQUENCE tag and is longer than a bare 32-byte hex
  // key. Only then is an OID match meaningful — raw key material could contain
  // those bytes by chance.
  const lower = key.toLowerCase()
  if (lower.startsWith('30') && lower.length > 64) {
    if (lower.includes(OID_ED25519)) return PrivateKey.fromStringED25519(key)
    if (lower.includes(OID_SECP256K1)) return PrivateKey.fromStringECDSA(key)
  }

  // Raw 32-byte hex carries no curve information. The Portal default is ECDSA,
  // so prefer it and let the caller set HEDERA_KEY_TYPE to override.
  try {
    return PrivateKey.fromStringECDSA(key)
  } catch {
    return PrivateKey.fromStringED25519(key)
  }
}

function clientForNetwork(): Client {
  return IS_MAINNET ? Client.forMainnet() : Client.forTestnet()
}

export interface HederaOperator {
  accountId: string
  privateKey: PrivateKey
  client: Client
}

// A Hedera Client owns gRPC connections to the network. Building one per call
// would leak a connection pool on every payout, so the operator client is a
// process singleton. Scripts should call closeHederaClients() when done, or the
// open connections keep Node's event loop alive and the process never exits.
let operatorSingleton: HederaOperator | null = null

/**
 * The treasury/operator account. It pays workers, funds the faucet, and submits
 * HCS messages. It never signs agent payments — the agent holds its own key.
 */
export function getOperator(): HederaOperator {
  if (operatorSingleton) return operatorSingleton

  const accountId = process.env.HEDERA_OPERATOR_ID
  const rawKey = process.env.HEDERA_OPERATOR_KEY
  if (!accountId) throw new Error('HEDERA_OPERATOR_ID not set')
  if (!rawKey) throw new Error('HEDERA_OPERATOR_KEY not set')

  const privateKey = parsePrivateKey(rawKey)
  const client = clientForNetwork()
  client.setOperator(AccountId.fromString(accountId), privateKey)
  // Cap what a single misconfigured call can cost the treasury.
  client.setDefaultMaxTransactionFee(new Hbar(Number(process.env.HEDERA_MAX_TX_FEE_HBAR ?? '2')))

  operatorSingleton = {
    accountId: AccountId.fromString(accountId).toString(),
    privateKey,
    client,
  }
  return operatorSingleton
}

/**
 * Release network connections. Long-running servers never need this; scripts do,
 * because an open Client keeps the process alive indefinitely.
 */
export function closeHederaClients(): void {
  if (operatorSingleton) {
    operatorSingleton.client.close()
    operatorSingleton = null
  }
}

/** The account payments are made out to. Defaults to the operator. */
export function getPayToAccount(): string {
  const payTo = process.env.PAY_TO_ACCOUNT ?? process.env.HEDERA_OPERATOR_ID
  if (!payTo) throw new Error('PAY_TO_ACCOUNT (or HEDERA_OPERATOR_ID) not set')
  return AccountId.fromString(payTo).toString()
}

// ── Transfers ─────────────────────────────────────────────────────────────────

export interface TransferResult {
  txId: string
  explorer: string
  status: string
}

/**
 * Move `amountUnits` of the payment asset from the operator to `toAccountId`.
 * Handles both native HBAR (tinybars) and HTS tokens with one code path so the
 * caller doesn't branch on asset type.
 */
export async function transferPaymentAsset(
  toAccountId: string,
  amountUnits: bigint
): Promise<TransferResult> {
  const { accountId: from, client } = getOperator()
  const to = normalizeAccountId(toAccountId)

  if (amountUnits <= 0n) throw new Error('transfer amount must be positive')

  const tx = new TransferTransaction()
  if (IS_HBAR) {
    // Hbar.fromTinybars takes string/number/Long — not bigint — so stringify.
    // addTokenTransfer below does accept bigint, so token amounts stay exact.
    tx.addHbarTransfer(AccountId.fromString(from), Hbar.fromTinybars((-amountUnits).toString()))
    tx.addHbarTransfer(AccountId.fromString(to), Hbar.fromTinybars(amountUnits.toString()))
  } else {
    const token = TokenId.fromString(PAYMENT_ASSET_ID)
    tx.addTokenTransfer(token, AccountId.fromString(from), -amountUnits)
    tx.addTokenTransfer(token, AccountId.fromString(to), amountUnits)
  }

  const submitted = await tx.execute(client)
  const receipt = await submitted.getReceipt(client)
  const txId = submitted.transactionId.toString()

  return { txId, explorer: explorerTx(txId), status: receipt.status.toString() }
}

/**
 * HTS tokens must be explicitly associated before an account can receive them.
 * Association is idempotent from our side: an already-associated account throws
 * TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, which we treat as success.
 */
export async function associateToken(
  accountId: string,
  privateKey: PrivateKey,
  tokenId = PAYMENT_ASSET_ID
): Promise<{ associated: boolean; txId?: string; alreadyAssociated: boolean }> {
  if (tokenId === HBAR_ASSET_ID) return { associated: true, alreadyAssociated: true }

  const client = clientForNetwork()
  client.setOperator(AccountId.fromString(accountId), privateKey)

  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(accountId))
      .setTokenIds([TokenId.fromString(tokenId)])
      .freezeWith(client)
      .sign(privateKey)
    const submitted = await tx.execute(client)
    await submitted.getReceipt(client)
    return { associated: true, txId: submitted.transactionId.toString(), alreadyAssociated: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
      return { associated: true, alreadyAssociated: true }
    }
    throw e
  } finally {
    client.close()
  }
}

/** Balance of the payment asset for an account, in atomic units. */
export async function getPaymentAssetBalance(accountId: string): Promise<bigint> {
  const client = clientForNetwork()
  try {
    const balance = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(normalizeAccountId(accountId)))
      .execute(client)

    if (IS_HBAR) return BigInt(balance.hbars.toTinybars().toString())

    const tokens = balance.tokens
    if (!tokens) return 0n
    const amount = tokens.get(TokenId.fromString(PAYMENT_ASSET_ID))
    return amount ? BigInt(amount.toString()) : 0n
  } finally {
    client.close()
  }
}

/** True when the account can already receive the payment token. */
export async function isTokenAssociated(accountId: string): Promise<boolean> {
  if (IS_HBAR) return true
  try {
    const res = await fetch(
      `${MIRROR_NODE_URL}/api/v1/accounts/${normalizeAccountId(accountId)}/tokens?token.id=${PAYMENT_ASSET_ID}`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) return false
    const data = (await res.json()) as { tokens?: unknown[] }
    return Array.isArray(data.tokens) && data.tokens.length > 0
  } catch {
    return false
  }
}
