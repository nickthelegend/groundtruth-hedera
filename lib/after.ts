// Run async work AFTER the HTTP response is sent, without blocking it.
//
// On Vercel, an un-awaited promise in a serverless function can be frozen the
// moment the response returns — so we use waitUntil() (via @vercel/functions),
// which keeps the function alive until the work settles. When that package
// isn't present (or we're in `next dev`, a long-lived Node process), we fall
// back to a floating promise, which finishes fine because the process persists.
export function runAfterResponse(work: () => Promise<unknown>): void {
  try {
    // Loaded via a runtime require the bundler can't statically resolve, so a
    // missing package is a graceful runtime miss (not a build-time warning).
    // eslint-disable-next-line no-eval
    const nodeRequire = eval('require') as (m: string) => unknown
    const mod = nodeRequire('@vercel/functions') as { waitUntil?: (p: Promise<unknown>) => void }
    if (mod?.waitUntil) {
      mod.waitUntil(work().catch((e) => console.error('[after] background work failed:', e)))
      return
    }
  } catch {
    // package not installed — fall through to floating promise
  }
  void work().catch((e) => console.error('[after] background work failed:', e))
}
