import { describe, it, expect } from 'vitest'
import {
  canTransition,
  VALID_TRANSITIONS,
  HumanDoInputSchema,
  SubmitProofInputSchema,
  HederaAccountIdSchema,
  type TaskStatus,
} from '../lib/types'

const ALL: TaskStatus[] = [
  'pending',
  'claimed',
  'submitted',
  'needs_review',
  'verified',
  'failed',
  'expired',
]

describe('task state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('pending', 'claimed')).toBe(true)
    expect(canTransition('claimed', 'submitted')).toBe(true)
    expect(canTransition('submitted', 'verified')).toBe(true)
  })

  it('resolves a submission in one hop from claimed', () => {
    // Submission resolves in a single compare-and-swap; two writes would leave
    // a window where a concurrent request could resolve the task twice.
    expect(canTransition('claimed', 'verified')).toBe(true)
    expect(canTransition('claimed', 'failed')).toBe(true)
  })

  it('treats verified and expired as terminal', () => {
    for (const terminal of ['verified', 'expired'] as TaskStatus[]) {
      expect(VALID_TRANSITIONS[terminal]).toEqual([])
      for (const to of ALL.filter(s => s !== terminal)) {
        expect(canTransition(terminal, to)).toBe(false)
      }
    }
  })

  it('allows a same-status write so settlement can merge its result', () => {
    expect(canTransition('verified', 'verified')).toBe(true)
  })

  it('lets a failed task be retried but never re-claimed', () => {
    // An honest worker who blurred the freshness code can resubmit; nobody can
    // put the task back on the open board.
    expect(canTransition('failed', 'verified')).toBe(true)
    expect(canTransition('failed', 'submitted')).toBe(true)
    expect(canTransition('failed', 'claimed')).toBe(false)
    expect(canTransition('failed', 'expired')).toBe(false)
  })

  it('cannot pay out a task nobody claimed', () => {
    // The invariant that matters most: money never moves for unclaimed work.
    expect(canTransition('pending', 'verified')).toBe(false)
    expect(canTransition('pending', 'submitted')).toBe(false)
    expect(canTransition('pending', 'needs_review')).toBe(false)
  })

  it('cannot resurrect a verified or expired task', () => {
    expect(canTransition('verified', 'submitted')).toBe(false)
    expect(canTransition('expired', 'claimed')).toBe(false)
  })

  it('never routes to needs_review from an unworked state', () => {
    const sources = ALL.filter(s => s !== 'needs_review' && canTransition(s, 'needs_review'))
    expect(sources.sort()).toEqual(['claimed', 'failed', 'submitted'])
    expect(canTransition('pending', 'needs_review')).toBe(false)
  })

  it('declares no transition to an unknown state', () => {
    for (const from of ALL) {
      for (const to of VALID_TRANSITIONS[from]) {
        expect(ALL).toContain(to)
      }
    }
  })
})

describe('HederaAccountIdSchema', () => {
  it('accepts shard.realm.num ids', () => {
    for (const id of ['0.0.1', '0.0.12345', '1.2.3']) {
      expect(HederaAccountIdSchema.safeParse(id).success).toBe(true)
    }
  })

  it('rejects EVM addresses and malformed ids', () => {
    for (const bad of [
      '0xf566aaf0e2421c45fa280c59e0c46e5e898d1795',
      '0.0',
      '0.0.',
      'abc',
      '',
      '0.0.1.2',
      '0.0.-1',
    ]) {
      expect(HederaAccountIdSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('HumanDoInputSchema', () => {
  const valid = {
    intent: 'Check if the coffee shop is open',
    budget_usdt: '2.00',
  }

  it('accepts a minimal valid input and defaults the timeout', () => {
    const parsed = HumanDoInputSchema.parse(valid)
    expect(parsed.timeout_seconds).toBe(3600)
  })

  it('requires a decimal budget string', () => {
    for (const budget of ['2', '2.0', '0.000001', '100.5']) {
      expect(HumanDoInputSchema.safeParse({ ...valid, budget_usdt: budget }).success).toBe(true)
    }
    for (const budget of ['2.0000001', 'abc', '-1', '', '1e6', '2,00']) {
      expect(HumanDoInputSchema.safeParse({ ...valid, budget_usdt: budget }).success).toBe(false)
    }
  })

  it('rejects an empty or oversized intent', () => {
    expect(HumanDoInputSchema.safeParse({ ...valid, intent: '' }).success).toBe(false)
    expect(HumanDoInputSchema.safeParse({ ...valid, intent: 'x'.repeat(501) }).success).toBe(false)
  })

  it('bounds the timeout so a task cannot be parked forever', () => {
    expect(HumanDoInputSchema.safeParse({ ...valid, timeout_seconds: 59 }).success).toBe(false)
    expect(HumanDoInputSchema.safeParse({ ...valid, timeout_seconds: 86401 }).success).toBe(false)
    expect(HumanDoInputSchema.safeParse({ ...valid, timeout_seconds: 3600 }).success).toBe(true)
  })

  it('accepts an explicit proof_spec', () => {
    const parsed = HumanDoInputSchema.parse({
      ...valid,
      proof_spec: { type: 'photo', instructions: 'Photo of the entrance', minPhotos: 2 },
    })
    expect(parsed.proof_spec?.minPhotos).toBe(2)
  })
})

describe('SubmitProofInputSchema', () => {
  const base = {
    task_id: '550e8400-e29b-41d4-a716-446655440000',
    proof: { type: 'photo' as const, storageKeys: ['a/0-abc.jpg'] },
  }

  it('requires a Hedera account id for the worker', () => {
    expect(SubmitProofInputSchema.safeParse({ ...base, worker_wallet: '0.0.123' }).success).toBe(
      true
    )
    expect(
      SubmitProofInputSchema.safeParse({
        ...base,
        worker_wallet: '0xf566aaf0e2421c45fa280c59e0c46e5e898d1795',
      }).success
    ).toBe(false)
  })

  it('requires a uuid task id', () => {
    expect(
      SubmitProofInputSchema.safeParse({ ...base, task_id: 'nope', worker_wallet: '0.0.1' }).success
    ).toBe(false)
  })
})
