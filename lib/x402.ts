import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server'
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '@x402/core/types'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import {
  HEDERA_NETWORK,
  PAYMENT_ASSET_ID,
  PAYMENT_ASSET_DECIMALS,
  PAYMENT_ASSET_SYMBOL,
  getPayToAccount,
  explorerTx,
} from './hedera'
import { toUnits } from './money'

// ── x402 on Hedera rails ──────────────────────────────────────────────────────
//
// GroundTruth is the resource server: it prices a task, answers unpaid requests
// with a 402 challenge, and hands the client's signed payment to a Hedera
// facilitator to verify and settle.
//
// The `exact` scheme on Hedera works differently from the EVM/Permit2 version
// this project used on X Layer. There, the agent signed a Permit2 authorization
// and we pulled the funds ourselves. Here the agent builds and *partially signs
// a real Hedera TransferTransaction*, and the facilitator co-signs as fee payer
// and submits it. Consequences worth knowing:
//
//   • We never hold or move the agent's funds — we only ever see a signed tx.
//   • We hold no key on the payment path at all; the facilitator is fee payer.
//   • Settlement returns a real Hedera transaction id, linkable on HashScan.
//   • The transfer is inside the signature, so we cannot redirect or inflate it.

const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? 'https://api.testnet.blocky402.com'

const PRICE = process.env.ASP_PRICE_USDT ?? '2.00'
const MAX_TIMEOUT_SECONDS = Number(process.env.X402_MAX_TIMEOUT_SECONDS ?? '180')

export const X402_VERSION = 2

/**
 * One resource server per process. Registering `hedera:*` routes both testnet
 * and mainnet requirements to the Hedera exact scheme.
 *
 * `initialize()` is not optional: it fetches each facilitator's supported kinds,
 * and the Hedera exact scheme folds that metadata — critically the facilitator's
 * **feePayer** account — into the requirements we advertise. Without it a client
 * cannot build a transaction the facilitator will co-sign, so the 402 challenge
 * would be unusable. We cache the promise so it happens once per process and
 * retry on failure rather than caching a broken server.
 */
let initPromise: Promise<x402ResourceServer> | null = null

function createResourceServer(): x402ResourceServer {
  return new x402ResourceServer(
    new HTTPFacilitatorClient({ url: FACILITATOR_URL })
  ).register(
    'hedera:*' as Network,
    new ExactHederaScheme({
      defaultAssets: {
        'hedera:testnet': { asset: PAYMENT_ASSET_ID, decimals: PAYMENT_ASSET_DECIMALS },
        'hedera:mainnet': { asset: PAYMENT_ASSET_ID, decimals: PAYMENT_ASSET_DECIMALS },
      },
    })
  )
}

export function getResourceServer(): Promise<x402ResourceServer> {
  if (!initPromise) {
    const server = createResourceServer()
    initPromise = server
      .initialize()
      .then(() => server)
      .catch((e) => {
        // Do not cache a server that never loaded supported kinds — the next
        // call should try the facilitator again.
        initPromise = null
        throw e
      })
  }
  return initPromise
}

/**
 * What the caller must pay for a task.
 *
 * Delegated to the SDK rather than hand-rolled, so the facilitator's supported
 * metadata (fee payer, asset decimals) is merged in by the scheme itself.
 * `amount` ends up in the asset's atomic units (USDC: 6 decimals).
 */
export async function buildPaymentRequirements(
  priceOverride?: string
): Promise<PaymentRequirements> {
  const server = await getResourceServer()
  const price = priceOverride ?? PRICE

  const requirements = await server.buildPaymentRequirements({
    scheme: 'exact',
    network: HEDERA_NETWORK as Network,
    payTo: getPayToAccount(),
    price: { amount: toUnits(price).toString(), asset: PAYMENT_ASSET_ID },
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      name: 'GroundTruth Task',
      version: '1',
      symbol: PAYMENT_ASSET_SYMBOL,
      decimals: PAYMENT_ASSET_DECIMALS,
    },
  })

  const requirement = requirements[0]
  if (!requirement) {
    throw new Error(
      `Facilitator ${FACILITATOR_URL} does not support the exact scheme on ${HEDERA_NETWORK}`
    )
  }
  return requirement
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function resourceInfo(resourcePath: string) {
  return {
    url: `${APP_URL}${resourcePath}`,
    description:
      'GroundTruth — hire a human oracle to verify something in the physical world',
    mimeType: 'application/json',
    serviceName: 'GroundTruth',
    tags: ['oracle', 'human-verification', 'reality-as-a-service'],
  }
}

/**
 * Build the 402 body. The facilitator is consulted so its `supported` metadata
 * (notably the fee-payer account) is merged into what we advertise — the client
 * needs that to build a transaction the facilitator will actually co-sign.
 */
export async function buildChallenge(
  resourcePath = '/api/v1/human-do',
  priceOverride?: string,
  error = 'Payment required'
): Promise<PaymentRequired> {
  const server = await getResourceServer()
  const requirements = await buildPaymentRequirements(priceOverride)
  return server.createPaymentRequiredResponse(
    [requirements],
    resourceInfo(resourcePath),
    error
  )
}

/** Same challenge, as the base64 `payment-required` header value. */
export async function buildChallengeHeader(
  resourcePath = '/api/v1/human-do',
  priceOverride?: string
): Promise<string> {
  return encodePaymentRequiredHeader(await buildChallenge(resourcePath, priceOverride))
}

export interface X402VerifyResult {
  valid: boolean
  reason?: string
  payer?: string
  amountUnits?: bigint
  payload?: PaymentPayload
}

/**
 * Verify a client's payment header without settling.
 *
 * Fails closed. We re-derive the requirements ourselves rather than trusting the
 * `accepted` block the client echoed back, so a client cannot talk us into
 * accepting a cheaper price, a different asset, or a different payee.
 */
export async function verifyPayment(
  header: string,
  priceOverride?: string
): Promise<X402VerifyResult> {
  let payload: PaymentPayload
  try {
    payload = decodePaymentSignatureHeader(header)
  } catch {
    return { valid: false, reason: 'malformed payment header' }
  }

  const requirements = await buildPaymentRequirements(priceOverride)

  // The client echoes back which requirement it paid. Reject any mismatch on the
  // fields that decide *who gets paid how much* before involving the facilitator.
  const accepted = payload.accepted
  if (accepted) {
    if (accepted.scheme !== requirements.scheme) {
      return { valid: false, reason: `unsupported scheme ${accepted.scheme}` }
    }
    if (accepted.network !== requirements.network) {
      return { valid: false, reason: `wrong network ${accepted.network}` }
    }
    if (accepted.asset !== requirements.asset) {
      return { valid: false, reason: 'wrong asset' }
    }
    if (accepted.payTo !== requirements.payTo) {
      return { valid: false, reason: 'wrong payTo' }
    }
    if (BigInt(accepted.amount ?? '0') < BigInt(requirements.amount)) {
      return { valid: false, reason: 'amount below required price' }
    }
  }

  try {
    const server = await getResourceServer()
    const res = await server.verifyPayment(payload, requirements)
    if (!res.isValid) {
      return {
        valid: false,
        reason: res.invalidMessage ?? res.invalidReason ?? 'facilitator rejected payment',
      }
    }
    return {
      valid: true,
      payer: res.payer,
      amountUnits: BigInt(requirements.amount),
      payload,
    }
  } catch (e) {
    return {
      valid: false,
      reason: `facilitator verify failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export interface X402SettleResult {
  success: boolean
  txId?: string
  explorer?: string
  payer?: string
  amountUnits?: bigint
  reason?: string
  responseHeader?: string
}

/**
 * Settle a verified payment. The facilitator co-signs as fee payer and submits
 * to Hedera; what comes back is a real transaction id.
 */
export async function settlePayment(
  header: string,
  priceOverride?: string
): Promise<X402SettleResult> {
  let payload: PaymentPayload
  try {
    payload = decodePaymentSignatureHeader(header)
  } catch {
    return { success: false, reason: 'malformed payment header' }
  }

  const requirements = await buildPaymentRequirements(priceOverride)

  try {
    const server = await getResourceServer()
    const res: SettleResponse = await server.settlePayment(payload, requirements)
    if (!res.success) {
      return {
        success: false,
        reason: res.errorMessage ?? res.errorReason ?? 'settlement failed',
      }
    }
    return {
      success: true,
      txId: res.transaction,
      explorer: res.transaction ? explorerTx(res.transaction) : undefined,
      payer: res.payer,
      amountUnits: BigInt(res.amount ?? requirements.amount),
      responseHeader: encodePaymentResponseHeader(res),
    }
  } catch (e) {
    return {
      success: false,
      reason: `facilitator settle failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export const facilitatorUrl = FACILITATOR_URL
