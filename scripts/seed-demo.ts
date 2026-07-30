#!/usr/bin/env node
/**
 * Seed demo tasks for judging / live demo.
 * Run: npx tsx scripts/seed-demo.ts
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

const DEMO_TASKS = [
  {
    intent: 'Take a photo of the parking availability outside the main entrance of this building',
    proof_spec: {
      type: 'photo',
      instructions: 'Walk to the main entrance. Take a clear photo showing the parking area and any available spaces. Make sure the photo is well-lit and the parking area is clearly visible.',
      minPhotos: 1,
    },
    budget_usdt: '2.00',
    payment_ref: `demo-parking-${Date.now()}`,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
  },
  {
    intent: 'Check if the hotel lobby coffee shop is currently open and confirm today\'s closing time',
    proof_spec: {
      type: 'form',
      instructions: 'Visit the coffee shop in the hotel lobby. Check if it is open. Ask a staff member or check the posted hours for today\'s closing time.',
      formFields: ['is_open', 'closing_time', 'notes'],
    },
    budget_usdt: '2.00',
    payment_ref: `demo-coffee-${Date.now() + 1}`,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    intent: 'Photograph the current price of a standard espresso at the nearest café',
    proof_spec: {
      type: 'photo',
      instructions: 'Find the nearest café. Take a clear photo of their price menu showing the espresso price. The price must be clearly readable in the photo.',
      minPhotos: 1,
    },
    budget_usdt: '2.00',
    payment_ref: `demo-espresso-${Date.now() + 2}`,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  },
]

async function seed() {
  console.log('Seeding demo tasks...')

  for (const task of DEMO_TASKS) {
    const { data, error } = await db
      .from('tasks')
      .insert({
        intent: task.intent,
        proof_spec: task.proof_spec,
        budget_usdt: task.budget_usdt,
        payment_ref: task.payment_ref,
        status: 'pending',
        expires_at: task.expires_at,
      })
      .select('id, intent')
      .single()

    if (error) {
      console.error(`Failed to insert task: ${task.intent.slice(0, 50)}...`)
      console.error(error.message)
    } else {
      console.log(`✓ Created task ${data.id}: ${data.intent.slice(0, 60)}...`)
    }
  }

  console.log('Done!')
}

seed().catch(console.error)
