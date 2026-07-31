// Display-safe configuration for UI chrome.
//
// Kept separate from lib/hedera.ts so a page that only wants to render the
// network name does not pull the Hedera SDK into its bundle. Values here must
// stay in step with lib/hedera.ts — that module remains the source of truth for
// anything that actually touches the network.

const HBAR_ASSET_ID = '0.0.0'

/** CAIP-2 network id, e.g. `hedera:testnet`. */
export const HEDERA_NETWORK = process.env.HEDERA_NETWORK ?? 'hedera:testnet'

/** Bare network name, e.g. `testnet` — what HashScan URLs use. */
export const HEDERA_NETWORK_NAME = HEDERA_NETWORK.split(':')[1] ?? 'testnet'

/** Short human label for the header chip. */
export const NETWORK_LABEL = `Hedera ${HEDERA_NETWORK_NAME}`

export const PAYMENT_ASSET_ID = process.env.PAYMENT_ASSET_ID ?? '0.0.429274'

export const PAYMENT_ASSET_SYMBOL =
  process.env.PAYMENT_ASSET_SYMBOL ?? (PAYMENT_ASSET_ID === HBAR_ASSET_ID ? 'HBAR' : 'USDC')

export const HASHSCAN_BASE = `https://hashscan.io/${HEDERA_NETWORK_NAME}`

/** Task price and platform fee, for copy that quotes them. */
export const TASK_PRICE = process.env.ASP_PRICE_USDT ?? '2.00'
export const FEE_BPS = Number(process.env.ASP_FEE_BPS ?? '1200')
export const FEE_PERCENT = `${FEE_BPS / 100}%`
