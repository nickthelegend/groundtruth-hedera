import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
} from '@hiero-ledger/sdk'
import { getOperator, explorerTx, explorerTopic, MIRROR_NODE_URL } from './hedera'

// ── Proof anchoring via Hedera Consensus Service ──────────────────────────────
//
// The original design hashed proofs into an EVM contract. On Hedera the natural
// home is HCS: every verified task writes an immutable, consensus-timestamped
// message to a topic. That gives an auditable trail of *what was proven and
// when* — independent of our database — for a fraction of a cent per task, and
// anyone can replay the topic from a public Mirror Node to reconstruct it.
//
// Anchoring is deliberately best-effort: a topic outage must never block a
// worker's payout. Failures are recorded on the task, not thrown.

const TOPIC_ID = process.env.HEDERA_PROOF_TOPIC_ID

export interface ProofAnchor {
  anchored: boolean
  topicId?: string
  sequenceNumber?: string
  txId?: string
  explorer?: string
  topicExplorer?: string
  consensusTimestamp?: string
  error?: string
}

/**
 * The message body written to the topic. Deliberately small — a hash and the
 * verdict, never the proof itself or any worker PII. The topic is public.
 */
export interface ProofAnchorMessage {
  v: 1
  taskId: string
  proofHash: string
  intentHash: string
  verdict: 'accept' | 'reject' | 'uncertain'
  confidence: number
  worker: string
  payoutUnits: string
  asset: string
  at: string
}

/**
 * Create the proof topic. Run once via `pnpm hedera:setup`; the resulting id
 * goes in HEDERA_PROOF_TOPIC_ID.
 */
export async function createProofTopic(memo = 'GroundTruth proof anchor'): Promise<{
  topicId: string
  txId: string
  explorer: string
}> {
  const { client } = getOperator()
  const submitted = await new TopicCreateTransaction().setTopicMemo(memo).execute(client)
  const receipt = await submitted.getReceipt(client)
  const topicId = receipt.topicId?.toString()
  if (!topicId) throw new Error('Topic creation returned no topic id')
  const txId = submitted.transactionId.toString()
  return { topicId, txId, explorer: explorerTx(txId) }
}

/**
 * Anchor one verified task to the topic. Never throws — a failed anchor is
 * reported in the return value so the caller can record it and still pay out.
 */
export async function anchorProof(message: ProofAnchorMessage): Promise<ProofAnchor> {
  if (!TOPIC_ID) {
    return { anchored: false, error: 'HEDERA_PROOF_TOPIC_ID not configured' }
  }

  try {
    const { client } = getOperator()
    const submitted = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(TOPIC_ID))
      .setMessage(JSON.stringify(message))
      .execute(client)

    const receipt = await submitted.getReceipt(client)
    const txId = submitted.transactionId.toString()

    return {
      anchored: true,
      topicId: TOPIC_ID,
      sequenceNumber: receipt.topicSequenceNumber?.toString(),
      txId,
      explorer: explorerTx(txId),
      topicExplorer: explorerTopic(TOPIC_ID),
    }
  } catch (e) {
    return {
      anchored: false,
      topicId: TOPIC_ID,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export interface TopicMessage {
  sequenceNumber: number
  consensusTimestamp: string
  payload: ProofAnchorMessage | { raw: string }
}

/**
 * Read anchored proofs back from a public Mirror Node. This is what makes the
 * anchor useful: the audit trail is verifiable by anyone, without our API.
 */
export async function readAnchoredProofs(limit = 25): Promise<TopicMessage[]> {
  if (!TOPIC_ID) return []

  try {
    const res = await fetch(
      `${MIRROR_NODE_URL}/api/v1/topics/${TOPIC_ID}/messages?limit=${limit}&order=desc`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) return []

    const data = (await res.json()) as {
      messages?: { sequence_number: number; consensus_timestamp: string; message: string }[]
    }

    return (data.messages ?? []).map((m) => {
      const decoded = Buffer.from(m.message, 'base64').toString('utf8')
      let payload: TopicMessage['payload']
      try {
        payload = JSON.parse(decoded) as ProofAnchorMessage
      } catch {
        payload = { raw: decoded }
      }
      return {
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        payload,
      }
    })
  } catch {
    return []
  }
}

export function proofTopicId(): string | undefined {
  return TOPIC_ID
}

export function proofTopicExplorer(): string | undefined {
  return TOPIC_ID ? explorerTopic(TOPIC_ID) : undefined
}
