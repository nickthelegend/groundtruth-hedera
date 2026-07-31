'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { DAppConnector } from '@hashgraph/hedera-wallet-connect'
import { accountIdOf, getConnector, WALLET_ENABLED } from '@/lib/hashpack'

type WalletState = {
  /** Connected Hedera account id (`0.0.x`), or null. */
  accountId: string | null
  connecting: boolean
  error: string | null
  /** False when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is unset — UI falls back to manual entry. */
  enabled: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  getConnectorInstance: () => Promise<DAppConnector>
}

const WalletContext = createContext<WalletState | null>(null)

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside <Providers>')
  return ctx
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Restore an existing pairing on load. HashPack keeps the session alive
  // across reloads, so without this a returning oracle appears disconnected
  // and would be asked to approve again.
  useEffect(() => {
    if (!WALLET_ENABLED) return
    let cancelled = false
    getConnector()
      .then(c => {
        if (!cancelled) setAccountId(accountIdOf(c))
      })
      .catch(() => {
        /* no existing session — normal on a first visit */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const connector = await getConnector()
      await connector.openModal()
      setAccountId(accountIdOf(connector))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Closing the pairing modal is a normal user action, not a failure.
      if (!/reject|closed|cancel/i.test(msg)) setError(msg)
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      const connector = await getConnector()
      await connector.disconnectAll()
    } catch {
      /* already gone */
    } finally {
      setAccountId(null)
    }
  }, [])

  const value = useMemo<WalletState>(
    () => ({
      accountId,
      connecting,
      error,
      enabled: WALLET_ENABLED,
      connect,
      disconnect,
      getConnectorInstance: getConnector,
    }),
    [accountId, connecting, error, connect, disconnect]
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
