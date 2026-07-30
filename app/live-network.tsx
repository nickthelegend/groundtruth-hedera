'use client'

import { useEffect, useRef, useState } from 'react'

/* Living network — the hero's right side as a demonstration, not decoration.
   A dispatch signal glides from the network core out to a city; the pin lights
   up; a live feed logs the verified completion with a ticking timestamp. */

type City = { name: string; task: string; cx: number; cy: number; color: string }

const CITIES: City[] = [
  { name: 'Delhi',     task: 'Storefront verified',    cx: 178, cy: 122, color: 'var(--accent)' },
  { name: 'Tokyo',     task: 'QR code scanned',        cx: 200, cy: 150, color: 'var(--good)' },
  { name: 'London',    task: 'Restaurant photographed',cx: 120, cy: 100, color: 'var(--info)' },
  { name: 'Lagos',     task: 'Shelf price checked',    cx: 108, cy: 158, color: 'var(--warn)' },
  { name: 'Hyderabad', task: 'ATM inspected',          cx: 158, cy: 176, color: 'var(--good)' },
  { name: 'New York',  task: 'Address confirmed',      cx: 94,  cy: 128, color: 'var(--accent)' },
]

type Event = { id: number; name: string; task: string; color: string; t: number }

function ago(t: number): string {
  if (t < 3) return 'just now'
  if (t < 60) return `${t}s ago`
  const m = Math.floor(t / 60)
  return `${m}m ago`
}

export default function LiveNetwork() {
  const [active, setActive] = useState(0)
  const [events, setEvents] = useState<Event[]>([
    { id: 1, name: 'London', task: 'Restaurant photographed', color: 'var(--info)', t: 12 },
    { id: 2, name: 'Tokyo', task: 'QR code scanned', color: 'var(--good)', t: 41 },
    { id: 3, name: 'Lagos', task: 'Shelf price checked', color: 'var(--warn)', t: 74 },
  ])
  const idRef = useRef(4)
  const seqRef = useRef(0)

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const tick = setInterval(() => {
      setEvents(prev => prev.map(e => ({ ...e, t: e.t + 1 })))
    }, 1000)

    const dispatch = setInterval(() => {
      seqRef.current = (seqRef.current + 1) % CITIES.length
      const c = CITIES[seqRef.current]
      setActive(seqRef.current)
      // log the verified completion ~900ms after the signal arrives
      setTimeout(() => {
        setEvents(prev => [
          { id: idRef.current++, name: c.name, task: c.task, color: c.color, t: 0 },
          ...prev,
        ].slice(0, 4))
      }, 950)
    }, 3600)

    return () => { clearInterval(tick); clearInterval(dispatch) }
  }, [])

  const target = CITIES[active]

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

          {/* city pins */}
          {CITIES.map((c, i) => (
            <g key={c.name}>
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
            Live dispatch
          </div>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>Hedera</span>
        </div>
        <div className="space-y-1.5">
          {events.map(e => (
            <div key={e.id} className="fade-up flex items-center gap-2.5 text-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] flex-shrink-0"
                    style={{ background: 'var(--good-weak)', color: 'var(--good)' }}>✓</span>
              <span className="font-display font-bold flex-shrink-0" style={{ color: 'var(--text)' }}>{e.name}</span>
              <span className="truncate" style={{ color: 'var(--text-muted)' }}>{e.task}</span>
              <span className="font-mono text-[10px] ml-auto flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{ago(e.t)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
