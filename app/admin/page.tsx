export const dynamic = 'force-dynamic'

async function getPendingReviews() {
  try {
    const url = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const res = await fetch(`${url}/api/admin/queue`, { cache: 'no-store' })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

export default async function AdminPage() {
  const tasks = await getPendingReviews()

  return (
    <main className="min-h-screen p-6" style={{ color: 'var(--text)' }}>
      <div className="max-w-2xl mx-auto">
        <h1 className="font-display text-2xl font-extrabold mb-2" style={{ color: 'var(--text)' }}>Admin Review Queue</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Tasks flagged for manual verification</p>

        {tasks.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--text-faint)' }}>
            <div className="text-4xl mb-4">✅</div>
            <p>No tasks pending review.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task: { id: string; intent: string; worker_wallet: string; budget_usdt: string; submitted_at: string }) => (
              <div key={task.id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>{task.intent}</p>
                    <p className="text-xs mt-1 font-mono" style={{ color: 'var(--text-faint)' }}>
                      Worker: {task.worker_wallet?.slice(0, 10)}…
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      Submitted: {new Date(task.submitted_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display font-bold" style={{ color: 'var(--good)' }}>${task.budget_usdt}</div>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <form action={`/api/admin/review/${task.id}`} method="POST">
                    <input type="hidden" name="action" value="approve" />
                    <button type="submit" className="btn text-sm font-medium px-4 py-2"
                            style={{ background: 'var(--good)', color: 'var(--accent-ink)' }}>
                      Approve & Pay
                    </button>
                  </form>
                  <form action={`/api/admin/review/${task.id}`} method="POST">
                    <input type="hidden" name="action" value="reject" />
                    <button type="submit" className="btn btn-ghost text-sm font-medium px-4 py-2">
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
