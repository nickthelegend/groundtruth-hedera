import { NextResponse } from 'next/server'
import { pulseStats } from '@/lib/db'

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
