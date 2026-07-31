'use client'

import { useCallback, useEffect, useState } from 'react'
import { ConnectWallet } from './connect-wallet'
import { useWallet } from './providers'
import { associatePaymentAsset, isPaymentAssetReceivable } from '@/lib/hashpack'
import { PAYMENT_ASSET_SYMBOL } from '@/lib/public-config'

/**
 * Where the oracle's payout goes.
 *
 * A connected HashPack session hands back a native Hedera account id, so unlike
 * an EVM wallet there is nothing to translate. One thing still has to be true
 * before the payout can land: HTS will not deliver a token to an account that
 * has not associated it, and an oracle discovering that *after* doing the work
 * is the worst possible time. So the association is checked on connect and
 * offered as a single signature.
 *
 * Manual entry stays available: not every oracle uses HashPack, and the flow
 * should never be hostage to a wallet extension.
 */
export function PayoutAccount({
  value,
  onChange,
}: {
  value: string
  onChange: (accountId: string) => void
}) {
  const { accountId, enabled, getConnectorInstance } = useWallet()
  const [receivable, setReceivable] = useState<boolean | null>(null)
  const [associating, setAssociating] = useState(false)
  const [assocError, setAssocError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)

  const refresh = useCallback(async (id: string) => {
    setReceivable(await isPaymentAssetReceivable(id))
  }, [])

  // Adopt the connected account as the payout target, then check association.
  useEffect(() => {
    if (!accountId) {
      setReceivable(null)
      return
    }
    onChange(accountId)
    void refresh(accountId)
  }, [accountId, onChange, refresh])

  async function handleAssociate() {
    if (!accountId) return
    setAssociating(true)
    setAssocError(null)
    try {
      const connector = await getConnectorInstance()
      await associatePaymentAsset(connector, accountId)
      await refresh(accountId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/reject|cancel/i.test(msg)) setAssocError(msg)
    } finally {
      setAssociating(false)
    }
  }

  const label = (
    <label className="chip block text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
      Where your {PAYMENT_ASSET_SYMBOL} gets paid
    </label>
  )

  const manualInput = (
    <input
      type="text"
      placeholder="0.0.12345"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="font-mono w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--text)' }}
    />
  )

  // ── not connected ────────────────────────────────────────────────────────
  if (!accountId) {
    return (
      <div className="space-y-3">
        {label}
        {enabled && <ConnectWallet />}
        {enabled ? (
          <button
            onClick={() => setManual(m => !m)}
            className="text-xs underline"
            style={{ color: 'var(--text-faint)' }}
          >
            {manual ? 'Use HashPack instead' : 'Or paste an account id'}
          </button>
        ) : null}
        {(manual || !enabled) && manualInput}
      </div>
    )
  }

  // ── connected ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {label}
      <div
        className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)' }}
      >
        <div className="min-w-0">
          <p className="font-mono text-sm truncate" style={{ color: 'var(--text)' }}>
            {accountId}
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
            connected wallet
          </p>
        </div>
        {receivable === true && (
          <span
            className="chip text-[10px] px-2 py-1 rounded-full whitespace-nowrap"
            style={{ background: 'var(--good-weak)', color: 'var(--good)' }}
          >
            ready
          </span>
        )}
      </div>

      {receivable === false && (
        <div
          className="rounded-xl px-4 py-3 space-y-2"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            This account hasn&apos;t associated {PAYMENT_ASSET_SYMBOL} yet, so Hedera would reject
            the payout. One signature fixes it — you only do this once.
          </p>
          <button
            onClick={handleAssociate}
            disabled={associating}
            className="btn btn-primary w-full py-3 text-sm disabled:opacity-40"
          >
            {associating ? 'Confirm in HashPack…' : `Associate ${PAYMENT_ASSET_SYMBOL}`}
          </button>
          {assocError && (
            <p className="text-xs" style={{ color: 'var(--accent)' }}>
              {assocError.slice(0, 140)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
