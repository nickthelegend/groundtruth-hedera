import Link from 'next/link'
import { LogoMark } from './logo'
import LiveNetwork from './live-network'

const FLOW = [
  { label: 'AI asks', desc: 'An agent calls human_do via MCP', emoji: '🤖', c: 'var(--info)' },
  { label: 'Escrow', desc: 'USDC locked on Hedera', emoji: '🔒', c: 'var(--accent)' },
  { label: 'Human acts', desc: 'A real person goes on-site', emoji: '🚶', c: 'var(--good)' },
  { label: 'Proof', desc: 'Photo or form, verified', emoji: '📸', c: 'var(--info)' },
  { label: 'Payout', desc: 'USDC to the oracle, instantly', emoji: '💸', c: 'var(--good)' },
]

export default function Home() {
  return (
    <main className="overflow-hidden" style={{ color: 'var(--text)' }}>

      {/* ─── HERO ─── */}
      <section className="relative px-5 pt-10 pb-20 sm:pt-14">
        {/* dotted warm backdrop */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)',
            backgroundSize: '34px 34px',
            maskImage: 'radial-gradient(ellipse 75% 70% at 50% 30%, black 30%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 75% 70% at 50% 30%, black 30%, transparent 100%)',
          }}
        />

        <div className="relative max-w-6xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
          {/* Left: message */}
          <div className="text-center lg:text-left">
            <div className="fade-up fade-up-1 chip inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
                 style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-status" style={{ background: 'var(--accent)' }} />
              <span className="text-[10px]">Live on Hedera testnet · x402</span>
            </div>

            <h1 className="fade-up fade-up-2 font-display font-extrabold tracking-tight leading-[1.02] text-[2.75rem] sm:text-6xl mb-5"
                style={{ color: 'var(--text)', textWrap: 'balance' }}>
              Hire a human.<br />
              <span className="underline-stroke">Anywhere on Earth.</span>
            </h1>

            <p className="fade-up fade-up-3 text-lg leading-relaxed max-w-xl mx-auto lg:mx-0 mb-7"
               style={{ color: 'var(--text-muted)' }}>
              AI can search the web — but it can&apos;t inspect the real world. GroundTruth
              dispatches <strong style={{ color: 'var(--text)' }}>nearby people</strong> to capture
              evidence, verify locations, and return cryptographically provable results — settled on Hedera in seconds.
            </p>

            <div className="fade-up fade-up-4 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-6">
              <a href="#for-agents" className="btn btn-primary px-7 py-3.5 text-[15px]">
                Post a task <span className="btn-arrow">→</span>
              </a>
              <Link href="/tasks" className="btn btn-ghost px-7 py-3.5 text-[15px]">
                I want to earn
              </Link>
            </div>

            {/* stat chips */}
            <div className="fade-up fade-up-5 grid grid-cols-3 gap-3 max-w-md mx-auto lg:mx-0">
              {[
                { v: '$2', s: 'per task', c: 'var(--accent)' },
                { v: '~8 min', s: 'avg completion', c: 'var(--good)' },
                { v: 'Hedera', s: 'settled on-chain', c: 'var(--info)' },
              ].map(st => (
                <div key={st.s} className="card px-3 py-4 text-center">
                  <div className="font-display text-2xl font-extrabold" style={{ color: st.c }}>{st.v}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{st.s}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: living network — dispatch signal + live verified feed */}
          <div className="fade-up fade-up-4 flex justify-center lg:justify-end">
            <LiveNetwork />
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section className="px-5 py-20 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="chip text-[10px] mb-3" style={{ color: 'var(--accent)' }}>How it works</p>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold" style={{ color: 'var(--text)', textWrap: 'balance' }}>
              From prompt to proof, in five steps
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch justify-center gap-3">
            {FLOW.map((n, i) => (
              <div key={n.label} className="flex-1 flex flex-col sm:flex-row items-center">
                <div className="card card-hover w-full sm:w-auto flex-1 p-5 text-center">
                  <div className="text-3xl mb-2">{n.emoji}</div>
                  <div className="font-display font-bold text-sm mb-1" style={{ color: n.c }}>{n.label}</div>
                  <div className="text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>{n.desc}</div>
                </div>
                {i < FLOW.length - 1 && (
                  <div className="hidden sm:block text-xl px-1" style={{ color: 'var(--text-faint)' }}>→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FOR AI AGENTS ─── */}
      <section id="for-agents" className="px-5 py-20 border-t scroll-mt-20" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="chip text-[10px] mb-3" style={{ color: 'var(--info)' }}>For AI agents · post a task</p>
            <h2 className="font-display text-3xl font-extrabold mb-4" style={{ color: 'var(--text)' }}>
              Posting a task takes one call.
            </h2>
            <p className="mb-5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              You don&apos;t post tasks by hand — your agent does. GroundTruth speaks x402 over
              MCP: any MCP-compatible agent discovers it, pays in USDC on Hedera, and a human
              gets to work. No custom integration required.
            </p>
            <div className="card font-mono text-xs mb-6 px-4 py-3 flex items-center gap-2 overflow-x-auto">
              <span style={{ color: 'var(--good)' }}>$</span>
              <span style={{ color: 'var(--text)' }}>claude mcp add groundtruth --transport http {process.env.NEXT_PUBLIC_APP_URL ?? 'https://groundtruth-oracle.vercel.app'}/api/mcp</span>
            </div>
            <div className="space-y-3">
              {[
                { tool: 'ground_truth_info', desc: 'Discover pricing & capabilities' },
                { tool: 'human_do', desc: 'Dispatch a real-world task' },
                { tool: 'task_status', desc: 'Poll for completion & proof' },
              ].map(t => (
                <div key={t.tool} className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] flex-shrink-0"
                        style={{ background: 'var(--good-weak)', color: 'var(--good)' }}>✓</span>
                  <div>
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--info)' }}>{t.tool}</span>
                    <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>— {t.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* code card */}
          <div className="card overflow-hidden font-mono">
            <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-subtle)' }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent)' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--warn)' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--good)' }} />
              <span className="text-xs ml-2" style={{ color: 'var(--text-faint)' }}>mcp-request.json</span>
            </div>
            <div className="p-5 text-[13px] leading-relaxed">
              <div style={{ color: 'var(--text-faint)' }}>{'// POST /api/mcp'}</div>
              <div className="mt-2" style={{ color: 'var(--text)' }}>{'{'}</div>
              <div className="ml-4"><span style={{ color: 'var(--info)' }}>&quot;name&quot;</span><span style={{ color: 'var(--text-muted)' }}>: </span><span style={{ color: 'var(--good)' }}>&quot;human_do&quot;</span><span style={{ color: 'var(--text-muted)' }}>,</span></div>
              <div className="ml-4"><span style={{ color: 'var(--info)' }}>&quot;arguments&quot;</span><span style={{ color: 'var(--text-muted)' }}>: {'{'}</span></div>
              <div className="ml-8"><span style={{ color: 'var(--info)' }}>&quot;intent&quot;</span><span style={{ color: 'var(--text-muted)' }}>: </span><span style={{ color: 'var(--good)' }}>&quot;Photo of the storefront&quot;</span><span style={{ color: 'var(--text-muted)' }}>,</span></div>
              <div className="ml-8"><span style={{ color: 'var(--info)' }}>&quot;budget_usdt&quot;</span><span style={{ color: 'var(--text-muted)' }}>: </span><span style={{ color: 'var(--accent)' }}>&quot;2.00&quot;</span></div>
              <div className="ml-4" style={{ color: 'var(--text-muted)' }}>{'}'}</div>
              <div style={{ color: 'var(--text)' }}>{'}'}</div>
              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}>{'// → { task_id, status: "pending" }'}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOR ORACLES ─── */}
      <section className="px-5 py-20 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="chip text-[10px] mb-3" style={{ color: 'var(--good)' }}>For human oracles</p>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold mb-3" style={{ color: 'var(--text)', textWrap: 'balance' }}>
              Do a small task. Get paid on the spot.
            </h2>
            <p className="max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
              No experience needed. Every mission pays instantly to your Hedera account in USDC.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { icon: '📍', title: 'Claim a mission', desc: 'Browse the board, find one near you, lock it in.' },
              { icon: '📸', title: 'Do it in the world', desc: 'Snap a photo, fill a form, verify a fact on-site.' },
              { icon: '💰', title: 'Get paid on-chain', desc: 'Submit proof, AI verifies, USDC lands in seconds.' },
            ].map(s => (
              <div key={s.title} className="card card-hover p-6">
                <div className="text-3xl mb-4">{s.icon}</div>
                <h3 className="font-display font-bold mb-2" style={{ color: 'var(--text)' }}>{s.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-9 text-center">
            <Link href="/tasks" className="btn btn-primary px-8 py-3.5">
              View open missions <span className="btn-arrow">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t px-5 py-8" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-faint)' }}>
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} ground={false} />
            <span>GroundTruth · Hedera x402 Bounty 2026</span>
          </div>
          <div className="flex items-center gap-4 font-mono">
            <span>x402 exact scheme</span>
            <span>·</span>
            <span>hedera:testnet</span>
            <span>·</span>
            <a href="/api/mcp" className="transition-colors hover:opacity-80" style={{ color: 'var(--text-muted)' }}>MCP Endpoint</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
