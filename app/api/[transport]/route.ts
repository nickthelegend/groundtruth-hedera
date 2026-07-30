import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'
import { agentPay } from '@/lib/agent-pay'
import { HEDERA_NETWORK, PAYMENT_ASSET_ID, PAYMENT_ASSET_SYMBOL } from '@/lib/hedera'
import { proofTopicId, proofTopicExplorer } from '@/lib/hcs'
import { facilitatorUrl } from '@/lib/x402'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = createMcpHandler(
  (server: any) => {
    server.registerTool(
      'ground_truth_info',
      {
        title: 'GroundTruth Info',
        description: 'Get info about the GroundTruth ASP — what it does, pricing, and how to call it',
        inputSchema: {},
      },
      async () => ({
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            name: 'GroundTruth',
            tagline: 'Reality-as-a-Service for AI agents',
            description: 'Delegate physical-world tasks to human oracles. Submit a task (photo or form) with a budget; you immediately receive a task_id. A human completes it in minutes and an AI notary verifies the proof; poll task_status to retrieve the verified result and on-chain settlement.',
            how_it_works: [
              'Call human_do with an intent, proof_type (photo|form), instructions, and budget → returns a task_id.',
              'A human oracle claims and completes the task in the real world.',
              'An AI notary verifies the submitted proof against your intent.',
              'Call task_status with the task_id to retrieve the verified proof and the on-chain settlement transaction.',
            ],
            endpoint: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/v1/human-do`,
            method: 'POST',
            authentication: 'x402 payment on Hedera (handled automatically by the agent wallet)',
            pricing: {
              amount: process.env.ASP_PRICE_USDT ?? '2.00',
              currency: PAYMENT_ASSET_SYMBOL,
              asset: PAYMENT_ASSET_ID,
              network: HEDERA_NETWORK,
              scheme: 'exact',
              facilitator: facilitatorUrl,
              fee_bps: process.env.ASP_FEE_BPS ?? '1200',
            },
            settlement: {
              payouts: `native Hedera ${PAYMENT_ASSET_SYMBOL} transfer to the oracle's account`,
              proof_anchor: proofTopicId()
                ? `Hedera Consensus Service topic ${proofTopicId()}`
                : 'Hedera Consensus Service (topic not configured)',
              proof_topic_explorer: proofTopicExplorer() ?? null,
              explorer: 'https://hashscan.io',
            },
            proof_types: {
              photo: 'Agent asks for a photo; human takes it on-site and uploads',
              form: 'Agent asks for structured data; human fills a form',
            },
            typical_completion: 'varies with human-oracle availability',
            response: 'asynchronous — human_do returns a task_id; the verified proof and settlement are retrieved via task_status',
          }),
        }],
      })
    )

    server.registerTool(
      'human_do',
      {
        title: 'Human Do',
        description: 'Create a task for a human oracle to complete in the real world. Requires x402 payment. Returns a task_id to poll with task_status.',
        inputSchema: {
          intent: z.string().min(1).max(500).describe('What you want the human to do'),
          proof_type: z.enum(['photo', 'form']).describe('Type of proof'),
          instructions: z.string().min(1).max(1000).describe('Detailed instructions for the human'),
          budget_usdt: z.string().regex(/^\d+(\.\d{1,6})?$/).optional().default('2.00'),
          timeout_seconds: z.number().int().min(60).max(86400).optional().default(3600),
        },
      },
      async ({ intent, proof_type, instructions, budget_usdt, timeout_seconds }: { intent: string; proof_type: 'photo' | 'form'; instructions: string; budget_usdt?: string; timeout_seconds?: number }) => {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
        const amount = budget_usdt ?? '2.00'

        // Step 1: Autonomous x402 payment on Hedera — associate the token if
        // needed, check balance, fetch the 402 challenge, sign a real Hedera
        // transfer. The facilitator co-signs as fee payer and submits.
        let payResult: Awaited<ReturnType<typeof agentPay>> | null = null
        let payError: string | null = null
        try {
          payResult = await agentPay(amount, `${appUrl}/api/v1/human-do`)
        } catch (err) {
          payError = err instanceof Error ? err.message : String(err)
        }

        if (payResult) {
          // Step 2: Submit task with real x402 payment header
          try {
            const res = await fetch(`${appUrl}/api/v1/human-do`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-PAYMENT': payResult.paymentHeader,
              },
              body: JSON.stringify({
                intent,
                proof_spec: {
                  type: proof_type,
                  instructions,
                  ...(proof_type === 'photo' ? { minPhotos: 1 } : {}),
                },
                budget_usdt: amount,
                timeout_seconds: timeout_seconds ?? 3600,
              }),
              signal: AbortSignal.timeout(30_000),
            })
            const data = await res.json()
            if (res.ok) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'created',
                    task_id: data.task_id,
                    budget_usdt: data.budget_usdt ?? amount,
                    expires_at: data.expires_at,
                    poll_url: `${appUrl}/api/v1/tasks/${data.task_id}`,
                    board_url: `${appUrl}/tasks/${data.task_id}`,
                    estimated_completion: 'varies with human-oracle availability',
                    next_step: 'Call task_status with this task_id to retrieve the human-completed, AI-verified proof and the on-chain settlement transaction.',
                    message: 'Task submitted to the human-oracle network. A human completes it in the real world and an AI notary verifies the proof; payout settles on Hedera. Poll task_status for the verified result.',
                    payment: {
                      network: HEDERA_NETWORK,
                      asset: `${PAYMENT_ASSET_SYMBOL} (${PAYMENT_ASSET_ID})`,
                      agent_account: payResult.agentAccount,
                      tx_id: data.payment?.tx_id ?? null,
                      hashscan: data.payment?.tx_id
                        ? `https://hashscan.io/${HEDERA_NETWORK.split(':')[1]}/transaction/${data.payment.tx_id}`
                        : null,
                      steps: payResult.steps,
                    },
                  }),
                }],
              }
            }
            // x402 payment rejected — fall through to demo bypass
          } catch {
            // network error — fall through to demo bypass
          }
        }

        // Fallback: demo bypass if ADMIN_SECRET is set
        const adminSecret = process.env.ADMIN_SECRET
        if (adminSecret) {
          try {
            const res = await fetch(`${appUrl}/api/v1/human-do`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-DEMO-KEY': adminSecret },
              body: JSON.stringify({
                intent,
                proof_spec: { type: proof_type, instructions, ...(proof_type === 'photo' ? { minPhotos: 1 } : {}) },
                budget_usdt: amount,
                timeout_seconds: timeout_seconds ?? 3600,
              }),
              signal: AbortSignal.timeout(10_000),
            })
            const data = await res.json()
            if (res.ok) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'created',
                    task_id: data.task_id,
                    budget_usdt: data.budget_usdt ?? amount,
                    expires_at: data.expires_at,
                    poll_url: `${appUrl}/api/v1/tasks/${data.task_id}`,
                    board_url: `${appUrl}/tasks/${data.task_id}`,
                    estimated_completion: 'varies with human-oracle availability',
                    next_step: 'Call task_status with this task_id to retrieve the human-completed, AI-verified proof and the on-chain settlement transaction.',
                    message: 'Task submitted to the human-oracle network. A human completes it in the real world and an AI notary verifies the proof; payout settles on-chain. Poll task_status for the verified result.',
                  }),
                }],
              }
            }
          } catch {
            // fall through
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'payment_required',
              error: payError ?? 'No agent wallet or demo key configured',
              message: `To create this task, configure AGENT_ACCOUNT_ID + AGENT_PRIVATE_KEY (a Hedera account funded with ${PAYMENT_ASSET_SYMBOL}) for autonomous x402 payment, or ADMIN_SECRET for demo bypass.`,
              endpoint: `${appUrl}/api/v1/human-do`,
            }),
          }],
        }
      }
    )

    server.registerTool(
      'task_status',
      {
        title: 'Task Status',
        description: 'Check the status and result of a GroundTruth task by its task_id',
        inputSchema: {
          task_id: z.string().uuid().describe('The task ID returned by human_do'),
        },
      },
      async ({ task_id }: { task_id: string }) => {
        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
          const res = await fetch(`${appUrl}/api/v1/tasks/${task_id}`, { signal: AbortSignal.timeout(5000) })
          if (!res.ok) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found', task_id }) }] }
          const task = await res.json()
          const awaitingReview = task.status === 'submitted'
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                task_id: task.id,
                status: task.status,
                intent: task.intent,
                // Proof is available once the human submits (awaiting your review) and after.
                proof: (awaitingReview || task.status === 'verified') ? (task.proof_payload ?? null) : null,
                // Signed, short-lived links to the actual photos — this is the
                // deliverable the agent paid for, not just a list of keys.
                proof_urls: (awaitingReview || task.status === 'verified') ? (task.proof_urls ?? null) : null,
                proof_urls_expire_in_seconds: task.proof_urls_expire_in_seconds ?? null,
                ai_vision: task.result?.vision ?? null,
                integrity_checks: task.result?.checks ?? null,
                awaiting_your_review: awaitingReview,
                next_action: awaitingReview
                  ? 'Review the proof, then call review_task with decision "accept" (pays the oracle on-chain) or "reject".'
                  : undefined,
                result: task.result ?? null,
                created_at: task.created_at,
                expires_at: task.expires_at,
              }),
            }],
          }
        } catch {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to fetch task status', task_id }) }] }
        }
      }
    )

    server.registerTool(
      'review_task',
      {
        title: 'Review Task',
        description: 'Review a submitted proof and accept or reject it. Accept releases the on-chain payout to the human oracle; reject fails the task with no payout. Call this after task_status shows the proof.',
        inputSchema: {
          task_id: z.string().uuid().describe('The task ID to review'),
          decision: z.enum(['accept', 'reject']).describe('accept = pay the oracle; reject = no payout'),
          reason: z.string().max(300).optional().describe('Optional note explaining the decision'),
        },
      },
      async ({ task_id, decision, reason }: { task_id: string; decision: 'accept' | 'reject'; reason?: string }) => {
        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
          const adminSecret = process.env.ADMIN_SECRET
          const res = await fetch(`${appUrl}/api/v1/tasks/${task_id}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(adminSecret ? { 'X-DEMO-KEY': adminSecret } : {}) },
            body: JSON.stringify({ decision, reason }),
            signal: AbortSignal.timeout(90_000),
          })
          const data = await res.json()
          return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
        } catch (err) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Review failed', detail: err instanceof Error ? err.message : String(err), task_id }) }] }
        }
      }
    )
  },
  {},
  {
    basePath: '/api',
    maxDuration: 60,
  }
)

export const GET = handler
export const POST = handler
