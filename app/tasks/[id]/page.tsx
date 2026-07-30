'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const VERIFY_STEPS = [
  { label: 'Uploading proof to GroundTruth network...', duration: 700 },
  { label: 'Running integrity checks...', duration: 900 },
  { label: 'Confirming acceptance...', duration: 900 },
  { label: 'Finalizing…', duration: 1200 },
]

function VerifyingScreen() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    let i = 0
    function next() {
      i++
      if (i < VERIFY_STEPS.length) {
        setStep(i)
        setTimeout(next, VERIFY_STEPS[i].duration)
      }
      // On the last step we stop advancing and hold here — the spinner keeps
      // going until the backend responds and the parent unmounts this screen.
    }
    setTimeout(next, VERIFY_STEPS[0].duration)
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ color: 'var(--text)' }}>
      <div className="max-w-sm w-full">
        <div className="flex justify-center mb-8">
          {/* Always spinning while mounted — this screen only ever means "work in progress". */}
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
               style={{ background: 'var(--accent-weak)', border: '1px solid var(--accent-line)' }}>
            <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          </div>
        </div>

        <h2 className="font-display text-xl font-extrabold text-center mb-8 transition-colors duration-300"
            style={{ color: 'var(--text)' }}>
          {VERIFY_STEPS[step].label}
        </h2>

        <div className="space-y-2">
          {VERIFY_STEPS.map((s, i) => {
            const isDone = i < step
            const isActive = i === step
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300"
                   style={{
                     opacity: isDone ? 0.3 : isActive ? 1 : 0.1,
                     background: isActive ? 'var(--bg-elev)' : 'transparent',
                     border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                   }}>
                <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                     style={{
                       background: isDone ? 'var(--good)' : 'transparent',
                       border: isDone ? 'none' : `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                     }}>
                  {isDone ? (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : isActive ? (
                    <div className="w-2.5 h-2.5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                  ) : null}
                </div>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface Task {
  id: string
  intent: string
  proof_spec: {
    type: 'photo' | 'form'
    instructions: string
    minPhotos?: number
    formFields?: string[]
    challenge?: string
  }
  budget_usdt: string
  status: string
  expires_at: string
  result?: {
    settle?: {
      worker?: string
      payout?: string
      asset_symbol?: string
      tx_id?: string | null
      explorer?: string | null
      anchor?: {
        anchored?: boolean
        topicId?: string
        sequenceNumber?: string
        topicExplorer?: string
      }
    }
    notary?: {
      decision?: 'accept' | 'reject' | 'uncertain'
      confidence?: number
      reason?: string
      checked?: boolean
      mode?: 'photo' | 'form'
      checks?: { label: string; passed: boolean }[]
    }
  } | null
}

export default function TaskDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [task, setTask] = useState<Task | null>(null)
  const [phase, setPhase] = useState<'loading' | 'view' | 'claimed' | 'verifying' | 'awaiting' | 'done' | 'rejected' | 'error'>('loading')
  const [loading, setLoading] = useState(false)
  const [wallet, setWallet] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [vision, setVision] = useState<{ checked: boolean; match: boolean; confidence: number; reason: string } | null>(null)

  useEffect(() => {
    fetch(`/api/v1/tasks/${params.id}`)
      .then(r => r.json())
      .then(t => {
        setTask(t)
        // Restore the right screen from the task's real status, so a refresh
        // on the awaiting/done/rejected screen doesn't drop back to the submit
        // form (which would 409 as "Submission failed" on a re-submit).
        const settleWorker = t.result?.settle?.worker
        if (settleWorker) setWallet(settleWorker)
        if (t.status === 'submitted') setPhase('awaiting')
        else if (t.status === 'verified') setPhase('done') // payout link fills in via poll if pending
        else if (t.status === 'failed') setPhase('rejected')
        else setPhase('view') // pending / claimed / expired
      })
      .catch(() => setPhase('error'))
  }, [params.id])

  // Poll for resolution: while awaiting an agent (manual mode), or on the done
  // screen until the background payout tx lands so its link can fill in.
  useEffect(() => {
    if (phase !== 'awaiting' && phase !== 'done') return
    if (task?.result?.settle?.tx_id) return // already have the tx, nothing to poll
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/v1/tasks/${params.id}`)
        const t = await r.json()
        setTask(t)
        if (t.status === 'failed') { setPhase('rejected'); clearInterval(iv) }
        else if (t.status === 'verified') {
          setPhase('done')
          if (t.result?.settle?.tx_id) clearInterval(iv) // paid — stop polling
        }
      } catch {}
    }, 1500)
    return () => clearInterval(iv)
  }, [phase, params.id, task?.result?.settle?.tx_id])

  async function handleClaim() {
    if (!wallet.match(/^\d+\.\d+\.\d+$/)) {
      setError('Enter a valid Hedera account id, e.g. 0.0.12345')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/tasks/${params.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_wallet: wallet }),
      })
      if (!res.ok) { setError('Failed to claim — mission may already be taken'); return }
      setPhase('claimed')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit() {
    if (!task) return
    setLoading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('task_id', task.id)
      fd.append('worker_wallet', wallet)
      fd.append('proof_type', task.proof_spec.type)
      if (task.proof_spec.type === 'photo') {
        for (const f of files) fd.append('photos', f)
      } else {
        fd.append('form_data', JSON.stringify(formData))
      }
      // Show the settling screen while the request runs — with auto-accept the
      // server verifies and settles on-chain inline, so this can take a few sec.
      setPhase('verifying')
      const res = await fetch(`/api/tasks/${params.id}/submit`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) { setError('Submission failed'); setPhase('claimed'); return }
      const data = await res.json().catch(() => ({}))
      setVision(data.vision ?? null)
      // Settlement is synchronous, so by now the result (notary verdict + settle
      // tx) is persisted — pull the fresh task so the done/rejected screens show
      // the full explainable verdict and the on-chain payout.
      try { const t = await fetch(`/api/v1/tasks/${params.id}`).then(r => r.json()); setTask(t) } catch {}
      if (data.status === 'failed') { setPhase('rejected'); return }
      // 'verified' → success (payout already settled). 'submitted' (manual mode) → awaiting.
      setPhase(data.status === 'verified' ? 'done' : 'awaiting')
    } catch {
      setError('Network error')
      setPhase('claimed')
    } finally {
      setLoading(false)
    }
  }

  /* ── Loading ── */
  if (phase === 'loading') return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        <p className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>Loading mission...</p>
      </div>
    </div>
  )

  /* ── Error ── */
  if (phase === 'error' || !task) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="card w-16 h-16 flex items-center justify-center mx-auto mb-4 text-3xl">🔍</div>
        <p style={{ color: 'var(--text-muted)' }}>Mission not found</p>
        <button onClick={() => router.push('/tasks')} className="mt-4 text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          ← Back to board
        </button>
      </div>
    </div>
  )

  /* ── Verifying (integrity checks) ── */
  if (phase === 'verifying') return <VerifyingScreen />

  /* ── Awaiting the agent's decision ── */
  if (phase === 'awaiting') return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center" style={{ color: 'var(--text)' }}>
      <div className="max-w-sm">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
             style={{ background: 'var(--accent-weak)', border: '1px solid var(--accent-line)' }}>
          <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
        <h2 className="font-display text-2xl font-extrabold mb-2" style={{ color: 'var(--text)' }}>
          {task?.status === 'verified' ? 'Accepted ✓' : 'Proof submitted ✓'}
        </h2>
        <p className="mb-4" style={{ color: 'var(--text-muted)' }}>
          {task?.status === 'verified' ? (
            <>Passed the checks and accepted. <strong style={{ color: 'var(--text)' }}>Releasing your payout on-chain</strong> now — this takes a few seconds.</>
          ) : (
            <>Passed integrity checks. Now awaiting the <strong style={{ color: 'var(--text)' }}>agent&apos;s</strong> verification — your payout releases on-chain the moment they accept.</>
          )}
        </p>

        {vision?.checked && (
          vision.match ? (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-left text-sm"
                 style={{ background: 'var(--good-weak)', border: '1px solid var(--good)' }}>
              <span style={{ color: 'var(--good)' }}>✓</span>
              <span style={{ color: 'var(--text)' }}><strong style={{ color: 'var(--good)' }}>AI vision confirmed</strong> the photo matches the task{vision.confidence ? ` · ${Math.round(vision.confidence * 100)}%` : ''}.</span>
            </div>
          ) : (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-left text-sm"
                 style={{ background: 'color-mix(in srgb, #E5484D 14%, transparent)', border: '1px solid #E5484D' }}>
              <span style={{ color: '#E5484D' }}>⚠</span>
              <span style={{ color: 'var(--text)' }}><strong style={{ color: '#E5484D' }}>AI vision flagged a possible mismatch</strong>{vision.reason ? ` — ${vision.reason}` : ''}. Shared with the agent for their decision.</span>
            </div>
          )
        )}

        <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>Live — updates automatically</p>
      </div>
    </div>
  )

  /* ── Rejected by agent / failed integrity ── */
  if (phase === 'rejected') return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center" style={{ color: 'var(--text)' }}>
      <div className="max-w-sm">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
             style={{ background: 'color-mix(in srgb, #E5484D 12%, transparent)', border: '1px solid #E5484D' }}>
          <span className="text-3xl">✕</span>
        </div>
        <h2 className="font-display text-2xl font-extrabold mb-2" style={{ color: 'var(--text)' }}>Not accepted</h2>
        <p className="mb-4" style={{ color: 'var(--text-muted)' }}>The proof didn&apos;t match the mission, so no payout was released.</p>
        {task?.result?.notary?.decision === 'reject' && (
          <div className="rounded-xl p-4 mb-6 text-left" style={{ background: 'color-mix(in srgb, #E5484D 10%, transparent)', border: '1px solid #E5484D' }}>
            <p className="chip text-[10px] font-bold mb-2" style={{ color: '#E5484D' }}>AI Notary — rejected</p>
            <div className="space-y-1.5">
              {(task.result.notary.checks ?? [{ label: task.result.notary.reason ?? 'Proof did not match', passed: false }]).map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                  <span style={{ color: c.passed ? 'var(--good)' : '#E5484D' }}>{c.passed ? '✓' : '✗'}</span>
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs mt-2 font-bold" style={{ color: '#E5484D' }}>→ Payment rejected.</p>
          </div>
        )}
        <div className="space-y-2">
          <button onClick={() => { setError(''); setFiles([]); setPhase('claimed') }} className="btn btn-primary w-full py-3">Try again →</button>
          <button onClick={() => router.push('/tasks')} className="btn w-full py-2.5" style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>Find another mission</button>
        </div>
      </div>
    </div>
  )

  /* ── Accepted → paid ── */
  if (phase === 'done') return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center" style={{ color: 'var(--text)' }}>
      <div className="max-w-sm">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
             style={{ background: 'var(--good-weak)', border: '1px solid var(--good)' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="font-display text-2xl font-extrabold mb-2" style={{ color: 'var(--text)' }}>
          Mission complete.
        </h2>
        <p className="mb-2" style={{ color: 'var(--text-muted)' }}>Your proof was verified and accepted.</p>

        {/* Notary verdict — explainable checklist that gated this payout */}
        {task.result?.notary?.checked && task.result.notary.decision !== 'reject' && (
          <div className="rounded-xl p-4 mb-4 text-left" style={{ background: 'var(--good-weak)', border: '1px solid var(--good)' }}>
            <p className="chip text-[10px] font-bold mb-2" style={{ color: 'var(--good)' }}>AI Notary — verified</p>
            <div className="space-y-1.5">
              {(task.result.notary.checks ?? [{ label: `Matches the task · ${Math.round((task.result.notary.confidence ?? 0) * 100)}%`, passed: true }]).map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                  <span style={{ color: c.passed ? 'var(--good)' : '#E5484D' }}>{c.passed ? '✓' : '✗'}</span>
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs mt-2 font-bold" style={{ color: 'var(--good)' }}>→ Payment released.</p>
          </div>
        )}

        {/* Legacy advisory vision block (kept for photo tasks without notary) */}
        {!task.result?.notary?.checked && vision?.checked && (
          vision.match ? (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-left text-sm"
                 style={{ background: 'var(--good-weak)', border: '1px solid var(--good)' }}>
              <span style={{ color: 'var(--good)' }}>✓</span>
              <span style={{ color: 'var(--text)' }}>
                <strong style={{ color: 'var(--good)' }}>AI vision confirmed</strong> the photo matches the task
                {vision.confidence ? ` · ${Math.round(vision.confidence * 100)}% confident` : ''}.
              </span>
            </div>
          ) : (
            <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-left text-sm"
                 style={{ background: 'color-mix(in srgb, #E5484D 14%, transparent)', border: '1px solid #E5484D' }}>
              <span style={{ color: '#E5484D' }}>⚠</span>
              <span style={{ color: 'var(--text)' }}>
                <strong style={{ color: '#E5484D' }}>AI vision flagged a possible mismatch</strong>
                {vision.reason ? ` — ${vision.reason}` : ''}. Logged for review; payout still processed.
              </span>
            </div>
          )
        )}
        {(() => {
          const settle = task.result?.settle
          const payAddr = settle?.worker ?? wallet
          // Hedera account ids are already short and human-readable — show them
          // in full rather than truncating an 0x-style hash.
          const addrShort = payAddr
          // Only claim "paid on-chain" when a real tx exists. If it verified but
          // the payout tx isn't recorded yet, say so honestly — never fake it.
          if (settle?.tx_id) return (
            <p className="text-sm mb-8" style={{ color: 'var(--text-faint)' }}>
              <span className="font-bold" style={{ color: 'var(--good)' }}>{settle.payout ?? ''} {settle.asset_symbol ?? 'USDC'}</span> paid on Hedera to{' '}
              <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{addrShort}</span>{' '}
              <span style={{ color: 'var(--text-faint)' }}>(after 12% fee)</span>
              {settle.explorer && (
                <> · <a href={settle.explorer} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>HashScan ↗</a></>
              )}
              {settle.anchor?.anchored && settle.anchor.topicExplorer && (
                <> · <a href={settle.anchor.topicExplorer} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--info)' }}>proof anchored to HCS #{settle.anchor.sequenceNumber} ↗</a></>
              )}
            </p>
          )
          return (
            <p className="text-sm mb-8 flex items-center justify-center gap-2" style={{ color: 'var(--text-faint)' }}>
              <span className="w-3.5 h-3.5 border-2 rounded-full animate-spin flex-shrink-0" style={{ borderColor: 'var(--good)', borderTopColor: 'transparent' }} />
              <span>Payout confirming on-chain{addrShort ? <> to <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{addrShort}</span></> : ''}…</span>
            </p>
          )
        })()}
        <button onClick={() => router.push('/tasks')} className="btn btn-primary w-full py-3">
          Find more missions →
        </button>
      </div>
    </div>
  )

  const isPhoto = task.proof_spec.type === 'photo'
  const expiresAt = new Date(task.expires_at)
  const minsLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000))
  const urgent = minsLeft < 30
  const shortId = task.id.replace(/-/g, '').slice(0, 8).toUpperCase()
  const typeColor = isPhoto ? 'var(--info)' : 'var(--accent)'

  return (
    <main className="min-h-screen pb-20" style={{ color: 'var(--text)' }}>
      <div className="max-w-lg mx-auto px-5 py-8">

        <button
          onClick={() => router.push('/tasks')}
          className="chip text-sm mb-8 flex items-center gap-2 transition-colors hover:opacity-80"
          style={{ color: 'var(--text-faint)' }}
        >
          ← Mission board
        </button>

        {/* Mission brief */}
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>MISSION #{shortId}</span>
              <span className="chip text-[10px] px-2 py-0.5 rounded-md font-bold"
                    style={{ background: isPhoto ? 'var(--info-weak)' : 'var(--accent-weak)', color: typeColor }}>
                {isPhoto ? '◉ Photo' : '◉ Form'}
              </span>
            </div>
            <div className="text-right">
              <div className="font-display text-3xl font-extrabold" style={{ color: 'var(--accent)' }}>
                ${task.budget_usdt}
              </div>
              <div className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>USDC reward</div>
            </div>
          </div>

          <h1 className="font-display text-xl font-bold mb-3" style={{ color: 'var(--text)' }}>
            {task.intent}
          </h1>

          <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>{task.proof_spec.instructions}</p>

          <div className="font-mono flex items-center gap-2 text-xs" style={{ color: urgent ? 'var(--warn)' : 'var(--text-faint)' }}>
            <span>{urgent ? '⚡' : '⏱'}</span>
            <span>
              {minsLeft < 60 ? `Expires in ${minsLeft}m` : `Expires in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`}
            </span>
          </div>
        </div>

        {/* ── CLAIM ── */}
        {phase === 'view' && (
          <div className="space-y-4">
            <div>
              <label className="chip block text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
                Your Hedera account id (to receive USDC)
              </label>
              <input
                type="text"
                placeholder="0.0.12345"
                value={wallet}
                onChange={e => setWallet(e.target.value)}
                className="font-mono w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
            </div>

            {error && (
              <p className="text-sm flex items-center gap-2" style={{ color: 'var(--accent)' }}>
                <span>⚠</span> {error}
              </p>
            )}

            <button onClick={handleClaim} disabled={loading} className="btn btn-primary w-full py-4 disabled:opacity-40">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-ink)', borderTopColor: 'transparent' }} />
                  Locking mission...
                </span>
              ) : 'Accept this mission →'}
            </button>

            <p className="font-mono text-xs text-center" style={{ color: 'var(--text-faint)' }}>
              Once accepted, complete before the timer expires
            </p>
          </div>
        )}

        {/* ── SUBMIT ── */}
        {phase === 'claimed' && (
          <div className="space-y-5">
            <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'var(--good-weak)', border: '1px solid var(--good)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <p className="text-sm font-medium" style={{ color: 'var(--good)' }}>Mission locked. Submit your proof before it expires.</p>
            </div>

            {/* Freshness challenge — proves the proof was made for THIS task */}
            {task.proof_spec.challenge && (
              <div className="rounded-xl p-4" style={{ background: 'var(--accent-weak)', border: '1px solid var(--accent-line)' }}>
                <p className="chip text-[10px] font-bold mb-2" style={{ color: 'var(--accent)' }}>Freshness code — required</p>
                <div className="font-mono text-3xl font-extrabold tracking-[0.3em] text-center py-2" style={{ color: 'var(--accent-deep, var(--accent))' }}>
                  {task.proof_spec.challenge}
                </div>
                <p className="text-xs mt-1 text-center" style={{ color: 'var(--text-muted)' }}>
                  {isPhoto
                    ? 'Write this code on paper and include it in your photo. It proves the photo is fresh (not a stock image), and the AI notary checks for it.'
                    : 'Include this exact code in one of your answers. It proves the proof was made for this task.'}
                </p>
              </div>
            )}

            {isPhoto ? (
              <div>
                <label className="chip block text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
                  Upload {task.proof_spec.minPhotos ?? 1}+ photo{(task.proof_spec.minPhotos ?? 1) > 1 ? 's' : ''}
                </label>
                <label
                  className="block w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all group"
                  style={{
                    borderColor: dragActive ? 'var(--accent)' : 'var(--border-strong)',
                    background: dragActive ? 'var(--accent-weak)' : 'var(--bg-subtle)',
                  }}
                  onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                  onDragEnter={e => { e.preventDefault(); setDragActive(true) }}
                  onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
                  onDrop={e => {
                    e.preventDefault(); setDragActive(false)
                    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                    if (dropped.length) setFiles(dropped)
                  }}
                >
                  <input type="file" accept="image/*" multiple capture="environment"
                         onChange={e => setFiles(Array.from(e.target.files ?? []))} className="hidden" />
                  {files.length === 0 ? (
                    <>
                      <div className="text-3xl mb-3 group-hover:scale-110 transition-transform">📸</div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{dragActive ? 'Drop your photo here' : 'Tap to take photo, or drag & drop'}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>JPG, PNG up to 10MB</p>
                    </>
                  ) : (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {files.map((f, i) => (
                        <div key={i} className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                             style={{ background: 'var(--good-weak)', border: '1px solid var(--good)', color: 'var(--good)' }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          {f.name}
                        </div>
                      ))}
                    </div>
                  )}
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                {(task.proof_spec.formFields ?? []).map((field: string) => (
                  <div key={field}>
                    <label className="chip block text-xs font-bold mb-2 capitalize" style={{ color: 'var(--text-muted)' }}>
                      {field}
                    </label>
                    <input
                      type="text"
                      value={formData[field] ?? ''}
                      onChange={e => setFormData(prev => ({ ...prev, [field]: e.target.value }))}
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                      style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      placeholder={`Enter ${field}...`}
                    />
                  </div>
                ))}
              </div>
            )}

            {error && (
              <p className="text-sm flex items-center gap-2" style={{ color: 'var(--accent)' }}>
                <span>⚠</span> {error}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || (isPhoto && files.length === 0)}
              className="btn w-full py-4 disabled:opacity-40"
              style={{ background: 'var(--info-weak)', border: '1px solid var(--info)', color: 'var(--info)' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--info)', borderTopColor: 'transparent' }} />
                  Uploading proof...
                </span>
              ) : 'Submit proof →'}
            </button>
          </div>
        )}

      </div>
    </main>
  )
}
