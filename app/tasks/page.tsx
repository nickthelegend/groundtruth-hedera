import Link from 'next/link'
import { listOpenTasks, listTransactions, listTopWorkers, type LedgerEntry, type WorkerRep } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function getOpenTasks() {
  try {
    return await listOpenTasks()
  } catch {
    return []
  }
}

async function getTransactions(): Promise<LedgerEntry[]> {
  try {
    return await listTransactions(20)
  } catch {
    return []
  }
}

// Hedera account ids (0.0.12345) are short enough to show in full.
function shortAddr(a: string): string {
  if (!a) return '—'
  if (a === '0.0.0') return 'agent wallet'
  return a
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

async function getTopWorkers(): Promise<WorkerRep[]> {
  try {
    return await listTopWorkers(5)
  } catch {
    return []
  }
}

export default async function TasksPage() {
  const [tasks, ledger, oracles] = await Promise.all([getOpenTasks(), getTransactions(), getTopWorkers()])

  return (
    <main className="min-h-screen pb-20" style={{ color: 'var(--text)' }}>
      <div className="max-w-2xl mx-auto px-5">

        {/* Header */}
        <div className="pt-12 pb-8 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="chip flex items-center gap-2 mb-4" style={{ color: 'var(--good)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-status" style={{ background: 'var(--good)' }} />
            <span className="text-[10px]">Live · open missions</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold" style={{ color: 'var(--text)' }}>
                Mission Board
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                Do it on the ground. Collect proof. Get paid instantly in USDC on Hedera.
              </p>
            </div>
            <div className="text-right">
              <div className="font-display text-3xl font-extrabold" style={{ color: 'var(--accent)' }}>
                {tasks.length}
              </div>
              <div className="chip text-[10px]" style={{ color: 'var(--text-faint)' }}>Available</div>
            </div>
          </div>
        </div>

        {/* Task list */}
        <div className="mt-6">
          {tasks.length === 0 ? (
            <div className="card text-center py-24">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
                   style={{ background: 'var(--bg-subtle)' }}>
                🔭
              </div>
              <p className="font-medium" style={{ color: 'var(--text)' }}>No missions right now</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>AI agents haven&apos;t dispatched anything yet. Check back soon.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task: {
                id: string
                intent: string
                budget_usdt: string
                proof_spec: { type: string }
                expires_at: string
              }) => {
                const isPhoto = task.proof_spec.type === 'photo'
                const expiresAt = new Date(task.expires_at)
                const minsLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000))
                const urgent = minsLeft < 30
                const shortId = task.id.replace(/-/g, '').slice(0, 8).toUpperCase()
                const typeColor = isPhoto ? 'var(--info)' : 'var(--accent)'

                return (
                  <Link key={task.id} href={`/tasks/${task.id}`}>
                    <div className="card card-hover group relative p-5 cursor-pointer overflow-hidden">
                      {/* Left accent stripe */}
                      <div className="absolute left-0 top-4 bottom-4 w-1 rounded-full" style={{ background: typeColor }} />

                      <div className="pl-4">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>#{shortId}</span>
                            <span className="chip text-[10px] px-2 py-0.5 rounded-md font-bold"
                                  style={{ background: isPhoto ? 'var(--info-weak)' : 'var(--accent-weak)', color: typeColor }}>
                              {isPhoto ? '◉ Photo' : '◉ Form'}
                            </span>
                            {urgent && (
                              <span className="chip text-[10px] px-2 py-0.5 rounded-md font-bold"
                                    style={{ background: 'var(--warn-weak)', color: 'var(--warn)' }}>
                                ⚡ Urgent
                              </span>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="font-display text-2xl font-extrabold" style={{ color: 'var(--accent)' }}>
                              ${task.budget_usdt}
                            </div>
                            <div className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>USDC</div>
                          </div>
                        </div>

                        <p className="font-medium leading-snug line-clamp-2 mb-3" style={{ color: 'var(--text)' }}>
                          {task.intent}
                        </p>

                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs" style={{ color: urgent ? 'var(--warn)' : 'var(--text-faint)' }}>
                            {minsLeft < 60 ? `${minsLeft}m left` : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left`}
                          </span>
                          <span className="font-display text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ color: 'var(--accent)' }}>
                            Accept mission →
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Top oracles — reputation */}
        {oracles.length > 0 && (
          <div className="mt-14 pt-8 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="mb-4">
              <h2 className="font-display text-xl font-extrabold" style={{ color: 'var(--text)' }}>Top oracles</h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Humans who’ve delivered the most verified proof, ranked by completed missions.</p>
            </div>
            <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
              {oracles.map((w: WorkerRep, i: number) => {
                const total = w.tasks_completed + w.tasks_failed
                const rate = total > 0 ? Math.round((w.tasks_completed / total) * 100) : 100
                return (
                  <div key={w.wallet} className="flex items-center gap-3 py-3 px-1">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-display font-bold text-xs"
                         style={{ background: i === 0 ? 'var(--accent-weak)' : 'var(--bg-subtle)', color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {i + 1}
                    </div>
                    <span className="font-mono text-xs flex-1 truncate" style={{ color: 'var(--text)' }}>
                      {w.wallet.slice(0, 6)}…{w.wallet.slice(-4)}
                    </span>
                    <span className="chip text-[10px]" style={{ color: 'var(--good)' }}>{rate}% verified</span>
                    <div className="text-right flex-shrink-0">
                      <div className="font-display font-bold text-sm" style={{ color: 'var(--text)' }}>{w.tasks_completed}</div>
                      <div className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>missions</div>
                    </div>
                    <div className="text-right flex-shrink-0 w-16">
                      <div className="font-display font-bold text-sm" style={{ color: 'var(--good)' }}>{w.earned_usdt}</div>
                      <div className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>USDC</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Settlement ledger */}
        <div className="mt-14 pt-8 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-xl font-extrabold" style={{ color: 'var(--text)' }}>
                Settlement Ledger
              </h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Every payment in and payout out — who got paid, how much, on-chain.
              </p>
            </div>
            <span className="chip text-[10px]" style={{ color: 'var(--text-faint)' }}>Live</span>
          </div>

          {ledger.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No settlements yet. Completed missions will appear here.</p>
            </div>
          ) : (
            <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
              {ledger.map((tx: LedgerEntry, i: number) => {
                const isIn = tx.direction === 'in'
                const color = isIn ? 'var(--info)' : 'var(--good)'
                const weak = isIn ? 'var(--info-weak)' : 'var(--good-weak)'
                return (
                  <div key={i} className="flex items-center gap-3 py-3 px-1" style={{ borderColor: 'var(--border)' }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm"
                         style={{ background: weak, color }}>
                      {isIn ? '↓' : '↑'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                          {isIn ? 'Agent paid' : 'Oracle paid'}
                        </span>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
                          {isIn ? 'from' : 'to'} {shortAddr(tx.address)}
                        </span>
                      </div>
                      {tx.intent && (
                        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{tx.intent}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-display font-bold text-sm" style={{ color }}>
                        {isIn ? '+' : '−'}{tx.amount_usdt} <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>USDC</span>
                      </div>
                      <div className="flex items-center gap-2 justify-end mt-0.5">
                        <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>{timeAgo(tx.at)}</span>
                        {tx.explorer ? (
                          <a href={tx.explorer} target="_blank" rel="noopener noreferrer"
                             className="font-mono text-[10px] underline" style={{ color: 'var(--accent)' }}>
                            tx ↗
                          </a>
                        ) : (
                          <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>demo</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="mt-10 text-center font-mono text-xs" style={{ color: 'var(--text-faint)' }}>
          Settled natively on Hedera · USDC via HTS · proofs anchored to HCS
        </div>
      </div>
    </main>
  )
}
