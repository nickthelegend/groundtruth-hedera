'use client'

import { useState } from 'react'
import Link from 'next/link'

interface FaucetMeta {
  symbol?: string
  asset?: string
  network?: string
  drip_amount?: string
}

export default function FaucetPage() {
  const [account, setAccount] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [txId, setTxId] = useState('')
  const [explorer, setExplorer] = useState('')
  const [meta, setMeta] = useState<FaucetMeta>({})

  async function handleDrip() {
    if (!account.match(/^\d+\.\d+\.\d+$/)) {
      setStatus('error')
      setMessage('Enter a valid Hedera account id, e.g. 0.0.12345')
      return
    }
    setStatus('loading')
    setMessage('')
    try {
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data.error ?? 'Faucet failed')
      } else {
        setStatus('success')
        setTxId(data.tx_id ?? '')
        setExplorer(data.explorer ?? '')
        setMeta(data)
        setMessage(`${data.amount ?? 'Tokens'} sent!`)
      }
    } catch {
      setStatus('error')
      setMessage('Network error — try again')
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-5" style={{ color: 'var(--text)' }}>
      <div className="max-w-md w-full">

        <div className="text-center mb-10">
          <div className="chip inline-flex items-center gap-2 mb-5" style={{ color: 'var(--info)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-status" style={{ background: 'var(--info)' }} />
            <span className="text-[10px]">Hedera testnet</span>
          </div>
          <h1 className="font-display text-4xl font-extrabold mb-3" style={{ color: 'var(--text)' }}>
            USDC Faucet
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Get testnet USDC to try GroundTruth task payments.<br />
            One drip per hour per account.
          </p>
        </div>

        <div className="card p-6 space-y-4">
          <div>
            <label className="chip block text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
              Hedera account id
            </label>
            <input
              type="text"
              placeholder="0.0.12345"
              value={account}
              onChange={e => setAccount(e.target.value)}
              className="font-mono w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
              Your account must associate the USDC token before it can receive it.
            </p>
          </div>

          <button
            onClick={handleDrip}
            disabled={status === 'loading'}
            className="btn btn-primary w-full py-4 disabled:opacity-40"
          >
            {status === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-ink)', borderTopColor: 'transparent' }} />
                Sending USDC...
              </span>
            ) : 'Request USDC →'}
          </button>

          {status === 'error' && (
            <p className="text-sm text-center flex items-center justify-center gap-2" style={{ color: 'var(--accent)' }}>
              <span>⚠</span> {message}
            </p>
          )}

          {status === 'success' && (
            <div className="rounded-xl p-4 text-center" style={{ background: 'var(--good-weak)', border: '1px solid var(--good)' }}>
              <p className="font-semibold flex items-center justify-center gap-2" style={{ color: 'var(--good)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {message}
              </p>
              {txId && (
                <a
                  href={explorer || `https://hashscan.io/testnet/transaction/${txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs mt-2 block break-all transition-colors hover:opacity-80"
                  style={{ color: 'var(--text-faint)' }}
                >
                  {txId} ↗
                </a>
              )}
            </div>
          )}
        </div>

        <div className="card font-mono mt-5 p-4 text-xs space-y-1.5" style={{ color: 'var(--text-faint)' }}>
          <p><span style={{ color: 'var(--text-muted)' }}>Token:</span> USDC {meta.symbol ? `(${meta.symbol})` : ''}</p>
          <p className="break-all"><span style={{ color: 'var(--text-muted)' }}>Token id:</span> {meta.asset ?? '0.0.429274'}</p>
          <p><span style={{ color: 'var(--text-muted)' }}>Network:</span> {meta.network ?? 'hedera:testnet'}</p>
          <p><span style={{ color: 'var(--text-muted)' }}>Amount:</span> {meta.drip_amount ?? '5.00'} USDC per drip</p>
        </div>

        <div className="mt-6 text-center">
          <Link href="/tasks" className="text-sm font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            → Browse missions and earn USDC on Hedera
          </Link>
        </div>

      </div>
    </main>
  )
}
