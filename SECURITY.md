# Security

## Threat model

GroundTruth mediates money between three untrusted parties: a paying agent, a human oracle, and an x402 facilitator. The design assumes each may misbehave.

### Payments

| Attack | Mitigation |
|---|---|
| Forged payment header | The facilitator verifies the signature, then the settled transaction is **re-derived from a public Mirror Node**. A fabricated transaction id has no consensus record. |
| Replayed payment | The payment reference is bound to the Hedera transaction id, and `payments.tx_hash` carries a unique index. A replay collides at the database layer and the orphan task is deleted. |
| Underpayment via a low declared budget | `budget_usdt` is caller-supplied and becomes the enforced price, so the route rejects any budget below the configured list price before the payment pipeline runs. |
| Underpayment / asset swap / payee redirect | Requirements are re-derived server-side and compared to the client's echoed `accepted` block before the facilitator is involved. The transfer is also inside the client's signature, so it cannot be mutated in flight. |
| Malicious facilitator claims a payment settled | Gate 3 (Mirror Node confirmation) rejects it. A "settled but unconfirmed" result is surfaced distinctly with the transaction id so it can be reconciled, never silently accepted. |
| Server steals agent funds | Not possible on this path — the x402 *resource server* holds no key: it only ever sees a signed transaction, and the facilitator submits. Caveat: the bundled MCP agent (`lib/agent-pay.ts`) runs in the same process and does hold `AGENT_PRIVATE_KEY`. It refuses to fall back to the treasury key, and a production agent would sign remotely. |

### Proofs and payouts

| Attack | Mitigation |
|---|---|
| Stock or recycled image | Per-task freshness challenge the proof must contain, plus a perceptual-hash check: an exact repeat of a recent proof is a hard fail, a similar one is advisory. |
| Proof unrelated to the task | Semantic notary judges proof against intent; a confident mismatch is rejected with no payout. |
| Double payout | Idempotency guard on the recorded settle block; a task with a payout transaction is never paid twice. |
| Payout to an unassociated account | Checked before transfer, with an explicit instruction rather than an opaque SDK failure. |
| Faucet drain | Per-IP rate window (keyed on `X-Forwarded-For`, so trustworthy only behind a proxy that overwrites it) plus a per-account cooldown. Both are in-memory; the treasury's finite balance is the hard cap. |

## Trust boundaries

- **Never trusted:** the payment header, the client's `accepted` block, worker-submitted proof, the facilitator's settlement claim.
- **Trusted:** Hedera consensus as reported by a public Mirror Node.

## Key handling

- `HEDERA_OPERATOR_KEY` (treasury) signs payouts, faucet drips, and HCS messages. It never touches the x402 payment path.
- `AGENT_PRIVATE_KEY` is the bundled agent's key and **must** be a separate account from the treasury, so the on-chain trail reads agent → treasury → worker. `lib/agent-pay.ts` throws rather than falling back to the operator key, which would otherwise make the treasury pay itself silently.
- No key is ever logged, returned in an API response, or written to a topic.

## Known limitations

- Agent review authorisation is a bearer `payment_ref`. It is returned only to the paying agent, never from a public route, and compared in constant time — but it is still a shared secret, and a production build should move to a signed capability token.
- A local demo bypass can create tasks with no payment. It requires `ALLOW_DEMO_BYPASS=true` **and** a matching `ADMIN_SECRET`, is refused when `NODE_ENV=production`, and labels what it creates `paid: false`.

- Several pieces of state are process-local and reset on cold start or split across instances: faucet rate limiting and per-account cooldowns, the notary's verdict cache, and the facilitator's initialised supported-kinds. None of them gate money; the treasury balance and the database constraints do.
- The notary errs toward paying the worker when uncertain. This is a deliberate trade: a false accept costs one task's budget, a false reject costs an honest oracle their work.
- The HCS anchor is best-effort. A topic outage is recorded on the task but does not block or reverse a payout.

## Reporting

Open an issue, or contact the maintainer directly for anything affecting funds.
