import { NextResponse } from 'next/server'
import { listRecentCompletions } from '@/lib/db'

// Recently verified missions for the landing-page activity feed.
// Returns an empty list rather than an error when the database is unreachable —
// the feed then shows an honest empty state instead of invented activity.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ completions: await listRecentCompletions(6) })
  } catch {
    return NextResponse.json({ completions: [] })
  }
}
