import { NextResponse } from 'next/server'
import { pulseStats } from '@/lib/db'

// This route reads live database state on every request. Without an explicit
// dynamic marker the App Router prerenders it at build time and serves that
// build-time snapshot forever — in production the mission board came back empty
// even with open tasks in Mongo.
export const dynamic = 'force-dynamic'


export async function GET() {
  try {
    const stats = await pulseStats()
    return NextResponse.json(stats)
  } catch {
    return NextResponse.json(
      { total_tasks: 0, verified_tasks: 0, total_paid_usdt: '0', active_workers: 0 },
      { status: 200 }
    )
  }
}
