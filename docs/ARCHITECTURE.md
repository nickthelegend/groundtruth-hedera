# GroundTruth — Architecture

> **One line:** AI agents hire human oracles to do real-world tasks; a human submits proof; an AI notary verifies the proof actually matches the request; the oracle is paid — all via an MCP server, a spec-faithful x402 payment, and native settlement on Hedera.

---

## System map

```
┌──────────────────────────────────────────────────────────────┐
│                       AI Agent (MCP)                         │
│   ground_truth_info · human_do · task_status · review_task   │
└───────────────────────────┬──────────────────────────────────┘
                            │ 1. GET  → 402 challenge
                            │ 2. sign Hedera TransferTransaction
                            │ 3. POST + payment header
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                  GroundTruth (Next.js)                       │
│                                                              │
│   lib/x402.ts        challenge · verify · settle             │
│   lib/mirror-verify  independent consensus confirmation      │
│   lib/notary.ts      semantic proof-vs-intent gate           │
│   lib/settle.ts      HTS payout + HCS anchor                 │
└──────┬─────────────────────────────┬─────────────────────────┘
       │                             │
       ▼                             ▼
┌──────────────┐   ┌──────────────────────────────────────────┐
│   MongoDB    │   │              Hedera                      │
│  tasks       │   │  x402 facilitator  → co-signs, submits   │
│  payments    │   │  HTS               → USDC transfers      │
│  workers     │   │  HCS               → proof anchors       │
│  proof_hashes│   │  Mirror Node       → public verification │
│  GridFS      │   │                                          │
└──────────────┘   └──────────────────────────────────────────┘
```

---

## Module responsibilities

| Concern | File | Notes |
|---|---|---|
| Hedera primitives | `lib/hedera.ts` | Client construction, key-flavour detection, HTS transfers, token association, balances, HashScan links. The only module that constructs a Client or moves value; `lib/hcs.ts` imports the SDK's topic transactions but reuses this module's operator client. |
| x402 resource server | `lib/x402.ts` | Builds the 402 challenge, verifies and settles via the facilitator. Owns `initialize()` so the facilitator's fee payer is merged into what we advertise. |
| Agent payer | `lib/agent-pay.ts` | The client side: associate token, check balance, fetch the 402, sign a real transfer. |
| Payment orchestration | `lib/payment.ts` | The three-gate pipeline (verify → settle → confirm). |
| Independent verification | `lib/mirror-verify.ts` | Re-derives a payment from a public Mirror Node's transfer list. |
| Proof anchoring | `lib/hcs.ts` | Writes proof hash + verdict to an HCS topic; reads them back from Mirror Node. |
| Settlement | `lib/settle.ts` | Native HTS payout to the oracle, then anchor. |
| Persistence | `lib/db.ts`, `lib/mongo.ts` | MongoDB. The atomic claim and the payment replay guard are database constraints, not application checks — an application-level check would race. |
| Proof images | `lib/storage.ts` | GridFS, served through `/api/proofs/[key]` behind a short-lived HMAC signature. |
| Proof verification | `lib/verify.ts`, `lib/notary.ts` | Integrity gate, then the semantic notary. |

---

## The payment path in detail

### 1. Challenge

`GET /api/v1/human-do` → `buildChallenge()`.

The resource server must be `initialize()`d first — that call fetches each facilitator's `supported` kinds, and the Hedera exact scheme folds the facilitator's **fee payer account** into `extra`. Without it the client cannot build a transaction the facilitator will co-sign, so the challenge would be advertised but unusable. The init promise is cached per process, and a failure clears the cache so the next request retries rather than pinning a broken server.

### 2. Signature

The agent's `x402Client` builds a real `TransferTransaction` (agent → `payTo`, in USDC) and signs it. It does **not** submit. Because the transfer is inside the signature, no downstream party can change the amount, the asset, or the recipient.

### 3. Verify → Settle → Confirm

```
verify   facilitator  well-formed? fundable? signature valid?
settle   facilitator  co-sign as fee payer, submit, return tx id
confirm  mirror node  does the transfer list actually credit payTo?
```

Before any of this, `verifyPayment` re-derives the requirements server-side and compares them against the `accepted` block the client echoed back. A client cannot negotiate a cheaper price, a different asset, or a different payee.

The third gate is the one integrations usually skip. It exists because the resource server should not take the facilitator's word for it. A settled-but-unconfirmed payment (mirror lag) is reported distinctly from a rejected one, with the transaction id, so it can be reconciled rather than silently lost.

### 4. Replay protection

The payment reference is derived from the Hedera transaction id (`hedera-<txId>`), and `payments.tx_hash` carries a unique index. Resubmitting the same settled payment collides at the database layer regardless of what the header claims. A collision deletes the just-created task so no unpaid orphan reaches the board.

---

## Proof and payout

1. **Integrity gate** (`lib/verify.ts`) — type match, image decodes, required fields, duplicate-hash check.
2. **Semantic notary** (`lib/notary.ts`) — a vision model for photos, an LLM for forms, judging proof against *intent*. Confident mismatch → reject, no payout. Unsure but *checked* → pay the worker; we do not punish an honest oracle for a borderline score. Could not run at all → hold for the paying agent, so an unverifiable proof never auto-pays.
3. **Freshness challenge** — a per-task code the worker must include, so a stock image cannot pass.
4. **Payout** (`lib/settle.ts`) — native HTS transfer to the oracle's `0.0.x` account.
5. **Anchor** (`lib/hcs.ts`) — proof hash, intent hash, verdict, confidence, payout, timestamp → HCS topic. Only *paid* tasks are anchored: `anchorProof` is called from `settleTask` alone, so the topic is a payout record rather than a log of every verdict.

Ordering is deliberate: **pay first, anchor second**. Anchoring is best-effort and never throws; a topic outage must not cost a worker their money. The anchor result is recorded on the task either way.

Payout idempotency is guarded by the recorded settle block on the task — there is no on-chain `settled` flag to consult, unlike the contract-based design this replaced.

---

## Notable constraints Hedera introduces

- **Token association.** An account cannot send *or* receive an HTS token until it associates it. Both the agent and the oracle need this. `pnpm hedera:setup` handles our own accounts; workers are told explicitly rather than failing with an opaque `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`.
- **Two key flavours.** Portal accounts default to ECDSA but ED25519 is common. For a DER-encoded key `parsePrivateKey` reads the curve from the algorithm identifier, because `fromStringECDSA` accepts an ED25519 key without complaining and derives the wrong public key — and therefore the wrong account. A bare 32-byte hex key carries no curve information at all, so there it does fall back to trying ECDSA first (the Portal default); set `HEDERA_KEY_TYPE` when you know which you have.
- **Mirror lag.** Mirror Nodes trail consensus by a beat, so confirmation polls briefly instead of failing a just-settled payment.
- **No minting.** We cannot mint Circle's USDC, so the faucet drips from the treasury's own balance — which makes its rate limits load-bearing rather than cosmetic.

---

## What is deliberately *not* here

- **No payroll smart contract.** Settlement is a native HTS transfer. A Solidity contract on the critical path would be dead weight next to Hedera's own token service.
- **No custody.** GroundTruth never holds an agent's funds and holds no key on the payment path. The facilitator submits; we only observe.
- **No public proof bucket.** Proofs can show storefronts, addresses and people, so they are never served from a guessable public URL. GridFS has no URL concept, so `/api/proofs/[key]` is the signed-URL equivalent: key, expiry and HMAC, verified with a constant-time compare.
