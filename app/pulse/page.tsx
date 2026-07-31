import { pulseStats } from '@/lib/db'
import Link from 'next/link'

export const revalidate = 30

async function getStats() {
  try {
    return await pulseStats()
  } catch {
    return null
  }
}

export default async function PulsePage() {
  const stats = await getStats()

  return (
    <main className="min-h-screen pb-16" style={{ color: 'var(--text)' }}>
      <div className="max-w-xl mx-auto px-5 py-12">

        <div className="mb-10">
          <div className="chip inline-flex items-center gap-2 mb-4" style={{ color: 'var(--good)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-status" style={{ background: 'var(--good)' }} />
            <span className="text-[10px]">Live · updates every 30s</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold" style={{ color: 'var(--text)' }}>
            Network Pulse
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Real-time GroundTruth economy stats</p>
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: stats.total_paid_usdt, label: 'Total paid in by agents', accent: 'var(--accent)' },
              { value: String(stats.verified_tasks), label: 'Missions verified', accent: 'var(--good)' },
              { value: String(stats.active_workers), label: 'Active oracles', accent: 'var(--info)' },
              { value: String(stats.total_tasks), label: 'Tasks posted', accent: 'var(--warn)' },
            ].map(s => (
              <div key={s.label} className="card card-hover p-6">
                <div className="font-display text-3xl font-extrabold" style={{ color: s.accent }}>
                  {s.value}
                </div>
                <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-4" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
            <p className="font-mono text-sm" style={{ color: 'var(--text-faint)' }}>Loading stats...</p>
          </div>
        )}

        <div className="card mt-8 p-5">
          <p className="font-mono text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            All payouts settled on-chain via{' '}
            <a
              href="https://hashscan.io/testnet"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              style={{ color: "var(--info)" }}
            >
              HashScan
            </a>{" "}
            · hedera:testnet · native USDC transfers via HTS · proofs anchored to HCS.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link href="/tasks" className="text-sm font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            → Browse open missions and start earning
          </Link>
        </div>

      </div>
    </main>
  )
}
