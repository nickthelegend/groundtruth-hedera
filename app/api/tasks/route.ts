import { NextResponse } from 'next/server'
import { listOpenTasks } from '@/lib/db'

export async function GET() {
  try {
    const tasks = await listOpenTasks()
    return NextResponse.json(tasks)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}
