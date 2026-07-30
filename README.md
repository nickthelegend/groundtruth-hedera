# GroundTruth — Reality-as-a-Service on Hedera

> AI agents hire human oracles to verify the physical world. Paid per-call over **x402**. Settled natively on **Hedera**.

[![Hedera](https://img.shields.io/badge/Hedera-testnet-8259EF?style=flat-square)](https://hedera.com)
[![x402](https://img.shields.io/badge/x402-exact%20scheme-00E87A?style=flat-square)](https://x402.org)
[![USDC](https://img.shields.io/badge/USDC-0.0.429274-2775CA?style=flat-square)](https://hashscan.io/testnet/token/0.0.429274)
[![HashScan](https://img.shields.io/badge/explorer-HashScan-A78BFA?style=flat-square)](https://hashscan.io/testnet)

Built for the **[Hedera x402 Bounty](https://hedera.com/x402-bounty/)**.

**Live on testnet** — real transactions, verifiable now:

| | |
|---|---|
| x402 payment settled | [`0.0.7162784@1785448933.726761986`](https://hashscan.io/testnet/transaction/0.0.7162784@1785448933.726761986) |
| Oracle payout | [`0.0.9847867@1785448990.259653822`](https://hashscan.io/testnet/transaction/0.0.9847867@1785448990.259653822) |
| Proof anchored to HCS | [topic `0.0.9847942`](https://hashscan.io/testnet/topic/0.0.9847942) |

Reproduce with `pnpm test` — see [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## The problem

AI agents can read the entire internet and still cannot answer *"is this shop actually open right now?"* They can't walk outside, read a price tag off a shelf, or photograph a queue.

**GroundTruth is the missing API call.** An agent posts a task and pays for it in the same HTTP round-trip. A human completes it in the real world. An AI notary checks the proof actually satisfies the request. The oracle gets paid — all on Hedera, in minutes.

```
AI Agent ──[MCP: human_do]──► 402 Payment Required
         ──[signed Hedera transfer]──► task created ──► Oracle Board
                                                            │
AI Agent ◄──[MCP: task_status]── verified proof ◄── Human Oracle
                                       │
                          payout (HTS) + proof anchor (HCS)
```

---

## What makes this Hedera-native

This is not an EVM app pointed at a Hedera RPC. Every on-chain surface uses a first-class Hedera service.

| Concern | How it works | Why Hedera |
|---|---|---|
| **Payment** | x402 `exact` scheme, `hedera:testnet`, USDC (`0.0.429274`) | Agent signs a real `TransferTransaction`; the facilitator co-signs as **fee payer** and submits. GroundTruth holds **no key on the payment path**. |
| **Payout** | Native HTS `TransferTransaction` to the oracle's account | No payroll contract, no allowance dance, no gas token. One transaction, final in ~3s, ~$0.001. |
| **Proof integrity** | Proof hash + notary verdict written to an **HCS topic** | Immutable, consensus-timestamped audit trail that anyone can replay from a public Mirror Node — independent of our database. |
| **Verification** | Public **Mirror Node** transfer-list lookup | We never take the facilitator's word that a payment settled. We re-derive it from consensus. |

### Why x402 on Hedera changes the shape of the code

The X Layer version of this project used the EVM `exact` scheme over Permit2: the agent signed an authorization and *we* pulled the funds with our own operator key. On Hedera the flow inverts, and it's strictly better:

- The agent **signs a real transaction**, not an approval to be redeemed later.
- The **facilitator is the fee payer**, so a paying agent needs USDC but needs *no HBAR for gas*.
- We hold **no key** on the payment path at all — we cannot redirect, inflate, or replay a payment, because the transfer is inside the signature.
- Settlement returns a genuine Hedera transaction id, linkable on HashScan.

---

## Payment flow, end to end

Three gates, all fail-closed. A payment must clear all three before a task exists.

```
1. VERIFY   facilitator     → is the signed transaction well-formed and fundable?
2. SETTLE   facilitator     → co-sign as fee payer, submit to Hedera, return a tx id
3. CONFIRM  public mirror   → re-derive the transfer list; did payTo actually get paid?
```

Step 3 is the one most integrations skip. A resource server should not trust a facilitator's "success" — [`lib/mirror-verify.ts`](lib/mirror-verify.ts) fetches the transaction from a public Mirror Node and checks the credit to our account in the transfer list. A fabricated transaction id has no record; a real transaction that paid someone else, or paid too little, fails the check.

Replay is bound at the database layer: the payment reference is derived from the Hedera transaction id, so resubmitting the same payment collides on a unique index no matter what else the header claims.

---

## Proof verification — the semantic notary

Payment being real is only half the problem. Proof has to mean *verified content*, not *a decodable JPEG*.

1. **Integrity gate** — correct type, image decodes, required fields present, not a duplicate. Blatant fraud fails instantly.
2. **Semantic notary** ([`lib/notary.ts`](lib/notary.ts)) — an AI judges whether the proof satisfies the task *intent*. Photos go to a vision model; forms go to an LLM.
3. **Freshness challenge** — each task carries a per-task code the worker must include, so a stock or recycled image cannot pass.

A confident mismatch is rejected with no payout. When the model is *unsure*, it errs toward paying the worker — GroundTruth never denies an honest oracle over an AI hiccup. The verdict (decision · confidence · reason) is stored on the task, shown to the oracle, returned to the calling agent, and **anchored to HCS**.

---

## Quick start

### Prerequisites

- Node.js 20+, pnpm
- A funded Hedera **testnet** account — [portal.hedera.com](https://portal.hedera.com)
- A Supabase project
- A Groq API key (planner + notary)

### Setup

```bash
git clone https://github.com/nickthelegend/groundtruth-hedera
cd groundtruth-hedera
pnpm install
cp .env.example .env.local
```

### Hedera accounts

If you already have funded testnet accounts (from [portal.hedera.com](https://portal.hedera.com)), put their ids and keys straight into `.env.local`.

Otherwise generate them. This writes two ECDSA keypairs to `.env.local` and prints an EVM address for each — sending HBAR to an EVM address auto-creates the Hedera account:

```bash
pnpm hedera:keygen     # prints a treasury + agent address to fund
# ...send testnet HBAR to both addresses...
pnpm hedera:resolve    # looks up the assigned 0.0.x ids, writes them back
```

Keep the treasury and agent **separate**: the treasury pays oracles, the agent pays for tasks, and the on-chain trail should read agent → treasury → worker rather than one account paying itself.

### Finish setup

Fill in the remaining `.env.local` values — the Supabase keys and `GROQ_API_KEY`. Then run the one-time Hedera setup, which associates the USDC token with both accounts and creates the HCS proof topic:

```bash
pnpm hedera:setup
```

Paste the printed `HEDERA_PROOF_TOPIC_ID` into `.env.local`, apply the database migrations, and start:

```bash
pnpm supabase db push
pnpm dev
```

### Prove it works

Two suites run against live Hedera testnet and make real transactions. Neither needs a server or a database:

```bash
pnpm test              # 30 assertions across both suites
pnpm test:x402         # challenge → sign → verify → settle → mirror-confirm
pnpm test:settlement   # native payout + HCS proof anchor + money maths
```

Both include negative cases — a redirected `payTo`, an underpayment, and a replayed payment must all be rejected.

Last run: **30 passed, 0 failed.** Real transaction links and full output are in [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

For the complete task lifecycle end to end (needs the server running, plus Supabase and Groq):

```bash
pnpm e2e
```

> **Funding note.** The agent account needs testnet **USDC** (`0.0.429274`), not just HBAR, and must be associated with the token (`pnpm hedera:setup` does the association). If you'd rather demo without sourcing testnet USDC, set `PAYMENT_ASSET_ID=0.0.0` and the entire flow — payment, payout, faucet — runs in native HBAR instead, which the Portal faucet funds directly.

---

## Use it from an AI agent

```bash
claude mcp add groundtruth --transport http http://localhost:3000/api/mcp
```

Then, in an agent session:

```
Call human_do with:
- intent: "Verify the nearest coffee shop is open and photograph the entrance"
- proof_type: photo
- instructions: "Clear photo of the entrance showing it is open"
- budget_usdt: "2.00"
```

The agent autonomously fetches the 402 challenge, signs a Hedera USDC transfer, and creates the task. No human approval in the loop.

### MCP tools

| Tool | Purpose |
|---|---|
| `ground_truth_info` | Service info, pricing, network, facilitator, proof-anchor topic |
| `human_do` | Create a task (requires x402 payment). Returns `task_id` and the Hedera tx id |
| `task_status` | Poll status, retrieve the verified proof and notary verdict |
| `review_task` | Accept (releases the HTS payout) or reject a submitted proof |

---

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/mcp` | GET/POST | MCP server |
| `/api/v1/human-do` | GET | Returns the 402 challenge — discover the price without paying |
| `/api/v1/human-do` | POST | Create a task (x402 payment required) |
| `/api/v1/tasks/:id` | GET | Task status, proof, notary verdict, settlement |
| `/api/faucet` | GET/POST | Testnet USDC drip + association status |
| `/api/pulse` | GET | Network stats |

### The 402 challenge

`GET /api/v1/human-do` returns exactly what a payer needs, including the facilitator's fee payer:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": ".../api/v1/human-do", "serviceName": "GroundTruth" },
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "2000000",
    "asset": "0.0.429274",
    "payTo": "0.0.xxxxx",
    "maxTimeoutSeconds": 180,
    "extra": { "symbol": "USDC", "decimals": 6, "feePayer": "0.0.7162784" }
  }]
}
```

---

## Project structure

```
├── app/
│   ├── api/
│   │   ├── [transport]/      MCP server
│   │   ├── v1/human-do/      Task creation + x402 payment gate
│   │   ├── v1/tasks/[id]/    Task status + agent review
│   │   └── faucet/           Testnet USDC drip
│   ├── tasks/                Oracle mission board
│   ├── pulse/                Network stats
│   └── faucet/               Faucet UI
├── lib/
│   ├── hedera.ts             Hedera client, HTS transfers, HashScan links
│   ├── x402.ts               x402 resource server — challenge, verify, settle
│   ├── agent-pay.ts          Autonomous agent payer (client side of x402)
│   ├── mirror-verify.ts      Independent Mirror Node confirmation
│   ├── hcs.ts                Proof anchoring to Hedera Consensus Service
│   ├── settle.ts             Native HTS payout + anchor
│   ├── notary.ts             Semantic proof-vs-intent verification
│   └── db.ts                 Supabase queries
├── scripts/
│   ├── hedera-setup.ts       One-time association + HCS topic creation
│   └── e2e-hedera-pay.ts     Full paid round-trip on testnet
└── supabase/migrations/
```

---

## Configuration

Everything chain-facing is env-driven. The two switches worth knowing:

| Variable | Default | Effect |
|---|---|---|
| `PAYMENT_ASSET_ID` | `0.0.429274` (USDC) | Set to `0.0.0` to run the whole app in native HBAR — no token association needed |
| `X402_FACILITATOR_URL` | `https://api.testnet.blocky402.com` | Any Hedera-capable facilitator. `https://x402.org/facilitator` also works |

Full list in [`.env.example`](.env.example).

---

## Porting notes — what changed from the X Layer original

This is a fork of [unspecifiedcoder/groundtruth](https://github.com/unspecifiedcoder/groundtruth), rebuilt on Hedera rails.

| Before (X Layer) | After (Hedera) |
|---|---|
| x402 `exact` via Permit2; our operator key pulled funds | x402 `exact` via signed `TransferTransaction`; facilitator is fee payer, we hold no key |
| ERC-20 `Transfer` log parsing for verification | Mirror Node transfer-list lookup |
| `GroundTruthPayroll.sol` + `transferFrom` + allowance cache | Native HTS `TransferTransaction` |
| Proof hashes in contract storage | HCS topic messages |
| MockUSDT with an on-chain `drip()` faucet | Treasury drip of real USDC, rate-limited |
| OKLink explorer, chainId 196/1952 | HashScan, `hedera:testnet` |
| EVM `0x…` worker addresses | Hedera `0.0.x` account ids |

The Solidity payroll contract was **removed rather than redeployed**: with native HTS transfers doing settlement, keeping a contract on the critical path would have been dead weight and a worse story than using Hedera's own token service.

---

## License

MIT
