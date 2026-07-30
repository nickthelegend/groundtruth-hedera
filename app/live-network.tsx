'use client'

import { useEffect, useRef, useState } from 'react'

/* Living network — the hero's right side.

   The globe is decorative: abstract nodes on a stylised sphere, making no claim
   about where anything happened. The FEED is not decorative — it lists real
   verified missions from /api/recent, or says plainly that there are none.
   Inventing plausible activity on a marketplace landing page would misrepresent
   how much is actually going on. */

type Node = { cx: number; cy: number; color: string }

const NODES: Node[] = [
  { cx: 178, cy: 122, color: 'var(--accent)' },
  { cx: 200, cy: 150, color: 'var(--good)' },
  { cx: 120, cy: 100, color: 'var(--info)' },
  { cx: 108, cy: 158, color: 'var(--warn)' },
  { cx: 158, cy: 176, color: 'var(--good)' },
  { cx: 94, cy: 128, color: 'var(--accent)' },
]

interface Completion {
  id: string
  intent: string
  resolved_at: string
  explorer: string | null
}

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function LiveNetwork() {
  const [active, setActive] = useState(0)
  const [completions, setCompletions] = useState<Completion[] | null>(null)
  const seqRef = useRef(0)

  // Real completions, refreshed periodically.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/recent')
        const data = await res.json()
        if (!cancelled) setCompletions(data.completions ?? [])
      } catch {
        if (!cancelled) setCompletions([])
      }
    }
    load()
    const poll = setInterval(load, 20_000)
    return () => { cancelled = true; clearInterval(poll) }
  }, [])

  // Ambient node animation only — carries no data, so it is safe to idle.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const dispatch = setInterval(() => {
      seqRef.current = (seqRef.current + 1) % NODES.length
      setActive(seqRef.current)
    }, 3600)
    return () => clearInterval(dispatch)
  }, [])

  const target = NODES[active]

  return (
    <div className="w-full max-w-[420px]">
      {/* Globe with dispatch signal */}
      <div className="relative w-full aspect-square animate-float">
        <div
          className="absolute inset-0 rounded-full blur-2xl"
          style={{ background: 'radial-gradient(circle at 50% 45%, var(--accent-weak), transparent 65%)' }}
        />
        {/* rotating orbit */}
        <svg viewBox="0 0 280 280" className="absolute inset-0 w-full h-full animate-spin-slow" aria-hidden>
          <ellipse cx="140" cy="140" rx="132" ry="52" fill="none" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 7" />
        </svg>

        <svg viewBox="0 0 280 280" className="absolute inset-0 w-full h-full" role="img" aria-label="Live network dispatching tasks to human oracles around the world">
          <defs>
            <radialGradient id="ln-sphere" cx="42%" cy="38%" r="70%">
              <stop offset="0%" stopColor="var(--bg-elev)" />
              <stop offset="100%" stopColor="var(--bg-subtle)" />
            </radialGradient>
          </defs>
          <circle cx="140" cy="140" r="96" fill="url(#ln-sphere)" stroke="var(--border-strong)" strokeWidth="1.5" />
          {[28, 55, 82].map((rx, i) => (
            <ellipse key={`lo${i}`} cx="140" cy="140" rx={rx} ry="96" fill="none" stroke="var(--border)" strokeWidth="1" />
          ))}
          {[-52, 0, 52].map((off, i) => (
            <ellipse key={`la${i}`} cx="140" cy={140 + off} rx="96" ry={off === 0 ? 96 : 74} fill="none" stroke="var(--border)" strokeWidth="1" />
          ))}

          {/* network core */}
          <circle cx="140" cy="140" r="4" fill="var(--accent)" opacity="0.55" />

          {/* dispatch beam: core → active city */}
          <line
            x1="140" y1="140" x2={target.cx} y2={target.cy}
            stroke={target.color} strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 4" opacity="0.5"
            style={{ transition: 'all 0.9s cubic-bezier(0.3,0.7,0.2,1)' }}
          />

          {/* network nodes */}
          {NODES.map((c, i) => (
            <g key={`${c.cx}-${c.cy}`}>
              {i === active && (
                <circle cx={c.cx} cy={c.cy} r="12" fill={c.color} opacity="0.18">
                  <animate attributeName="r" values="6;16;6" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.35;0;0.35" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={c.cx} cy={c.cy} r={i === active ? 5.5 : 4} fill={c.color} style={{ transition: 'r 0.4s ease' }} />
              <circle cx={c.cx} cy={c.cy} r="1.8" fill="var(--bg-elev)" />
            </g>
          ))}

          {/* traveling signal dot — glides from core to active pin */}
          <circle
            r="3.5" fill={target.color}
            cx="140" cy="140"
            style={{
              transform: `translate(${target.cx - 140}px, ${target.cy - 140}px)`,
              transition: 'transform 0.9s cubic-bezier(0.3,0.7,0.2,1)',
              filter: `drop-shadow(0 0 5px ${target.color})`,
            }}
          />
        </svg>
      </div>

      {/* Live dispatch feed */}
      <div className="card mt-3 p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <div className="chip flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--good)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-status" style={{ background: 'var(--good)' }} />
            Verified missions
          </div>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>Hedera</span>
        </div>
        <div className="space-y-1.5">
          {completions === null ? (
            <p className="text-sm py-1" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          ) : completions.length === 0 ? (
            <p className="text-sm py-1 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              No missions verified yet. Completed missions appear here with their
              Hedera transaction.
            </p>
          ) : (
            completions.slice(0, 4).map(c => (
              <div key={c.id} className="fade-up flex items-center gap-2.5 text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] flex-shrink-0"
                      style={{ background: 'var(--good-weak)', color: 'var(--good)' }}>✓</span>
                {c.explorer ? (
                  <a href={c.explorer} target="_blank" rel="noopener noreferrer"
                     className="truncate hover:underline" style={{ color: 'var(--text-muted)' }}>
                    {c.intent}
                  </a>
                ) : (
                  <span className="truncate" style={{ color: 'var(--text-muted)' }}>{c.intent}</span>
                )}
                <span className="font-mono text-[10px] ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                  {ago(c.resolved_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
