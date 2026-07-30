# Security

## Threat model

GroundTruth mediates money between three untrusted parties: a paying agent, a human oracle, and an x402 facilitator. The design assumes each may misbehave.

### Payments

| Attack | Mitigation |
|---|---|
| Forged payment header | The facilitator verifies the signature, then the settled transaction is **re-derived from a public Mirror Node**. A fabricated transaction id has no consensus record. |
| Replayed payment | The payment reference is bound to the Hedera transaction id, and `payments.tx_hash` carries a unique index. A replay collides at the database layer and the orphan task is deleted. |
| Underpayment / asset swap / payee redirect | Requirements are re-derived server-side and compared to the client's echoed `accepted` block before the facilitator is involved. The transfer is also inside the client's signature, so it cannot be mutated in flight. |
| Malicious facilitator claims a payment settled | Gate 3 (Mirror Node confirmation) rejects it. A "settled but unconfirmed" result is surfaced distinctly with the transaction id so it can be reconciled, never silently accepted. |
| Server steals agent funds | Not possible on this path — GroundTruth holds **no key** involved in payment. The agent signs; the facilitator submits. |

### Proofs and payouts

| Attack | Mitigation |
|---|---|
| Stock or recycled image | Per-task freshness challenge the proof must contain, plus a duplicate-hash check. |
| Proof unrelated to the task | Semantic notary judges proof against intent; a confident mismatch is rejected with no payout. |
| Double payout | Idempotency guard on the recorded settle block; a task with a payout transaction is never paid twice. |
| Payout to an unassociated account | Checked before transfer, with an explicit instruction rather than an opaque SDK failure. |
| Faucet drain | Per-IP rate window plus a per-account cooldown. The faucet drips from the treasury's finite balance, so limits are load-bearing. |

## Trust boundaries

- **Never trusted:** the payment header, the client's `accepted` block, worker-submitted proof, the facilitator's settlement claim.
- **Trusted:** Hedera consensus as reported by a public Mirror Node.

## Key handling

- `HEDERA_OPERATOR_KEY` (treasury) signs payouts, faucet drips, and HCS messages. It never touches the x402 payment path.
- `AGENT_PRIVATE_KEY` is the demo agent's own key and should be a **separate account** from the treasury, so the on-chain trail reads agent → treasury → worker.
- No key is ever logged, returned in an API response, or written to a topic.

## Known limitations

- Faucet rate limiting is in-memory and per-instance; it resets on cold start. The treasury balance is the hard cap.
- The notary errs toward paying the worker when uncertain. This is a deliberate trade: a false accept costs one task's budget, a false reject costs an honest oracle their work.
- The HCS anchor is best-effort. A topic outage is recorded on the task but does not block or reverse a payout.

## Reporting

Open an issue, or contact the maintainer directly for anything affecting funds.
