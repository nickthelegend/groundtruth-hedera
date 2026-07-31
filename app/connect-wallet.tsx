'use client'

import { useWallet } from './providers'

/**
 * HashPack connect / connected pill.
 *
 * There is no network-switch control here on purpose: a Hedera wallet session
 * is scoped to a specific network at pairing time, so the wallet either paired
 * on the network this dApp asked for or the pairing does not exist.
 */
export function ConnectWallet({ compact = false }: { compact?: boolean }) {
  const { accountId, connecting, error, enabled, connect, disconnect } = useWallet()

  if (!enabled) {
    // Without a WalletConnect projectId there is nothing to connect to. Say so
    // rather than rendering a button that always fails; manual account entry
    // remains available on the mission page.
    return compact ? null : (
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        Wallet connection isn&apos;t configured on this deployment.
      </p>
    )
  }

  if (accountId) {
    return (
      <button
        onClick={disconnect}
        className={`btn font-mono ${compact ? 'px-3 py-1.5 text-xs' : 'w-full py-3 text-sm'}`}
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--text)' }}
        title="Disconnect"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--good)' }} />
          {accountId}
        </span>
      </button>
    )
  }

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <button
        onClick={connect}
        disabled={connecting}
        className={`btn btn-primary disabled:opacity-40 ${compact ? 'px-4 py-1.5 text-sm' : 'w-full py-4'}`}
      >
        {connecting ? 'Opening wallet…' : 'Connect wallet'}
        {!compact && !connecting && <span className="btn-arrow">→</span>}
      </button>
      {error && !compact && (
        <p className="text-xs" style={{ color: 'var(--accent)' }}>
          {error.slice(0, 160)}
        </p>
      )}
    </div>
  )
}
