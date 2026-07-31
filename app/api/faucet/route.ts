import { NextRequest, NextResponse } from 'next/server'
import {
  PAYMENT_ASSET_ID,
  PAYMENT_ASSET_SYMBOL,
  PAYMENT_ASSET_DECIMALS,
  IS_HBAR,
  isHederaAccountId,
  normalizeAccountId,
  getPaymentAssetBalance,
  isTokenAssociated,
  transferPaymentAsset,
  explorerAccount,
} from '@/lib/hedera'
import { toUnits, fromUnits } from '@/lib/money'

// Settlement is slow by nature: the facilitator submits to Hedera, then we poll
// a public Mirror Node until consensus catches up. That routinely runs 15-25s,
// well past Vercel's 10s default — and a truncated request here would abort
// AFTER funds moved. 60s is the Hobby ceiling and is comfortably enough.
export const maxDuration = 60


// Testnet faucet.
//
// On X Layer this minted from a MockUSDT contract we owned. On Hedera the
// payment asset is Circle's USDC, which we cannot mint — so the faucet drips
// from the treasury's own balance instead. That makes every drip a real, finite
// transfer, which is why the limits below matter more than they used to.
//
// Two anti-abuse layers: a per-IP window (best-effort, in-memory) and a
// per-recipient cooldown enforced by looking at when we last paid them.

const DRIP_AMOUNT = process.env.FAUCET_DRIP_AMOUNT ?? '5.00'
const COOLDOWN_MS = Number(process.env.FAUCET_COOLDOWN_MS ?? '3600000') // 1h

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 5
const ipHits = new Map<string, number[]>()

// Per-recipient cooldown. In-memory and per-instance, same as the original —
// good enough for a testnet faucet, and the treasury balance is the hard cap.
const lastDrip = new Map<string, number>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  hits.push(now)
  ipHits.set(ip, hits)
  return hits.length > RATE_MAX
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  return fwd ? fwd.split(',')[0].trim() : (req.headers.get('x-real-ip') ?? 'unknown')
}

function assetMeta() {
  return {
    network: process.env.HEDERA_NETWORK ?? 'hedera:testnet',
    asset: PAYMENT_ASSET_ID,
    symbol: PAYMENT_ASSET_SYMBOL,
    decimals: PAYMENT_ASSET_DECIMALS,
    drip_amount: DRIP_AMOUNT,
  }
}

export async function POST(req: NextRequest) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait a moment and try again.' },
        { status: 429 }
      )
    }

    const { address, account } = await req.json()
    const raw = (account ?? address ?? '').toString()

    if (!raw || !isHederaAccountId(raw)) {
      return NextResponse.json(
        { error: 'Invalid Hedera account id. Expected the form 0.0.12345.' },
        { status: 400 }
      )
    }

    const recipient = normalizeAccountId(raw)

    const last = lastDrip.get(recipient)
    if (last && Date.now() - last < COOLDOWN_MS) {
      const waitMins = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 60_000)
      return NextResponse.json(
        { error: `Cooldown active. Try again in ${waitMins} minute(s).` },
        { status: 429 }
      )
    }

    // HTS tokens cannot be delivered to an unassociated account. Say so
    // explicitly — the recipient has to associate; we cannot do it for them.
    if (!IS_HBAR) {
      const associated = await isTokenAssociated(recipient)
      if (!associated) {
        return NextResponse.json(
          {
            error: `Account ${recipient} has not associated token ${PAYMENT_ASSET_ID} (${PAYMENT_ASSET_SYMBOL}). Associate it, then request again.`,
            ...assetMeta(),
          },
          { status: 400 }
        )
      }
    }

    const transfer = await transferPaymentAsset(recipient, toUnits(DRIP_AMOUNT))
    lastDrip.set(recipient, Date.now())

    return NextResponse.json({
      success: true,
      account: recipient,
      tx_id: transfer.txId,
      explorer: transfer.explorer,
      amount: `${DRIP_AMOUNT} ${PAYMENT_ASSET_SYMBOL}`,
      ...assetMeta(),
    })
  } catch (err: unknown) {
    // Log details server-side; return a generic message so internal node/network
    // details are not disclosed to unauthenticated callers.
    console.error('[faucet] drip failed:', err)
    return NextResponse.json({ error: 'Faucet temporarily unavailable' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('account') ?? searchParams.get('address')

  if (!raw || !isHederaAccountId(raw)) {
    return NextResponse.json(assetMeta())
  }

  const account = normalizeAccountId(raw)

  try {
    const [balance, associated] = await Promise.all([
      getPaymentAssetBalance(account),
      isTokenAssociated(account),
    ])

    return NextResponse.json({
      ...assetMeta(),
      account,
      explorer: explorerAccount(account),
      associated,
      balance: fromUnits(balance),
    })
  } catch (err) {
    // Node hiccup — return metadata without a balance rather than a 500.
    console.error('[faucet] balance lookup failed:', err)
    return NextResponse.json(
      { ...assetMeta(), account, balance: null, error: 'balance unavailable' },
      { status: 200 }
    )
  }
}
