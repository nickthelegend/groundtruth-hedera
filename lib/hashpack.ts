import type { DAppConnector, DAppSigner } from '@hashgraph/hedera-wallet-connect'
import { HEDERA_NETWORK_NAME, MIRROR_NODE_URL, PAYMENT_ASSET_ID } from './public-config'

/**
 * HashPack (and every other Hedera wallet) speaks WalletConnect through the
 * `hedera-wallet-connect` dApp connector.
 *
 * Two deliberate choices here:
 *
 *  • Everything is loaded with a dynamic import inside `getConnector()`. The
 *    connector reaches for `window` at module scope, so a static import would
 *    break the server render of every page that mounts the nav.
 *
 *  • The connector is a module-level singleton. `init()` opens a relay socket
 *    and restores any existing session; constructing a second one silently
 *    competes with the first for the same pairing topic.
 *
 * Unlike an EVM wallet, HashPack returns a native Hedera account id (`0.0.x`),
 * which is exactly what the payout needs — there is no address translation and
 * no chain to switch.
 */

/** WalletConnect projectId. Free from https://cloud.reown.com — required by the relay. */
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ''

export const WALLET_ENABLED = WC_PROJECT_ID.length > 0

let connectorPromise: Promise<DAppConnector> | null = null

export function getConnector(): Promise<DAppConnector> {
  if (!WALLET_ENABLED) {
    return Promise.reject(
      new Error(
        'Wallet connection is not configured — set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.'
      )
    )
  }
  if (!connectorPromise) {
    connectorPromise = (async () => {
      const [
        { DAppConnector, HederaChainId, HederaJsonRpcMethod, HederaSessionEvent },
        { LedgerId },
      ] = await Promise.all([
        import('@hashgraph/hedera-wallet-connect'),
        import('@hiero-ledger/sdk'),
      ])

      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const connector = new DAppConnector(
        {
          name: 'GroundTruth',
          description: 'AI agents pay humans to verify the physical world.',
          url: origin,
          icons: [`${origin}/icon.png`],
        },
        HEDERA_NETWORK_NAME === 'mainnet' ? LedgerId.MAINNET : LedgerId.TESTNET,
        WC_PROJECT_ID,
        Object.values(HederaJsonRpcMethod),
        [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
        [HederaChainId.Testnet],
      )
      await connector.init({ logger: 'error' })
      return connector
    })().catch(err => {
      // Let the next attempt rebuild rather than caching a dead connector.
      connectorPromise = null
      throw err
    })
  }
  return connectorPromise
}

/** The account id of the first connected signer, or null when not connected. */
export function accountIdOf(connector: DAppConnector): string | null {
  const signer: DAppSigner | undefined = connector.signers?.[0]
  return signer ? signer.getAccountId().toString() : null
}

/**
 * Associate the payment asset, signed by the connected wallet.
 *
 * HTS refuses to deliver a token to an account that has not associated it, so
 * without this an oracle can complete the work and still have the payout fail.
 * The SDK is imported here rather than at module scope to keep it out of the
 * initial page bundle.
 */
export async function associatePaymentAsset(connector: DAppConnector, accountId: string) {
  const { TokenAssociateTransaction, TokenId, AccountId } = await import('@hiero-ledger/sdk')
  const signer = connector.getSigner(AccountId.fromString(accountId))
  const tx = await new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenIds([TokenId.fromString(PAYMENT_ASSET_ID)])
    .freezeWithSigner(signer)
  return tx.executeWithSigner(signer)
}

/**
 * Whether the account can already receive the payment asset.
 *
 * A negative auto-association count means unlimited (HIP-904), in which case no
 * explicit association is needed.
 */
export async function isPaymentAssetReceivable(accountId: string): Promise<boolean> {
  try {
    const acct = await fetch(`${MIRROR_NODE_URL}/api/v1/accounts/${accountId}`, {
      headers: { accept: 'application/json' },
    })
    if (acct.ok) {
      const data = await acct.json()
      if (Number(data?.max_automatic_token_associations ?? 0) < 0) return true
    }
    const res = await fetch(
      `${MIRROR_NODE_URL}/api/v1/accounts/${accountId}/tokens?token.id=${PAYMENT_ASSET_ID}`,
      { headers: { accept: 'application/json' } }
    )
    if (!res.ok) return false
    const data = await res.json()
    return Array.isArray(data?.tokens) && data.tokens.length > 0
  } catch {
    return false
  }
}
