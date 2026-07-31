# GroundTruth — Reality-as-a-Service on Hedera

> AI agents hire human oracles to verify the physical world. Paid per-call over **x402**. Settled natively on **Hedera**.

[![Hedera](https://img.shields.io/badge/Hedera-testnet-8259EF?style=flat-square)](https://hedera.com)
[![x402](https://img.shields.io/badge/x402-exact%20scheme-00E87A?style=flat-square)](https://x402.org)
[![USDC](https://img.shields.io/badge/USDC-0.0.429274-2775CA?style=flat-square)](https://hashscan.io/testnet/token/0.0.429274)
[![HashScan](https://img.shields.io/badge/explorer-HashScan-A78BFA?style=flat-square)](https://hashscan.io/testnet)

Built for the **[Hedera x402 Bounty](https://hedera.com/x402-bounty/)**.

**Live: https://groundtruth-hedera.vercel.app** · demo script in [`SUBMISSION.md`](SUBMISSION.md)

**Live on testnet in real USDC** — full lifecycle, verifiable now:

| | |
|---|---|
| x402 payment settled | [`0.0.7162784@1785533088.095593612`](https://hashscan.io/testnet/transaction/0.0.7162784@1785533088.095593612) |
| Oracle payout | [`0.0.9847867@1785533108.731142427`](https://hashscan.io/testnet/transaction/0.0.9847867@1785533108.731142427) |
| Proof anchored to HCS | [topic `0.0.9847942`](https://hashscan.io/testnet/topic/0.0.9847942) |

Three distinct accounts — agent [`0.0.9847870`](https://hashscan.io/testnet/account/0.0.9847870)
→ treasury [`0.0.9847867`](https://hashscan.io/testnet/account/0.0.9847867)
→ oracle [`0.0.9860142`](https://hashscan.io/testnet/account/0.0.9860142) — so the on-chain trail
is a real two-sided market, not one wallet paying itself.

**243 assertions passing.** Reproduce with `pnpm test` — see [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

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
| **Payment** | x402 `exact` scheme, `hedera:testnet`, Circle USDC (`0.0.429274`) | The payer signs a real `TransferTransaction`; the facilitator co-signs as **fee payer** and submits. As the resource server GroundTruth holds **no key** — it only ever sees a signed transaction. |
| **Payout** | Native HTS `TransferTransaction` to the oracle's account | No payroll contract, no allowance dance, no approve-then-`transferFrom` round trip. One transaction, final in seconds, for [Hedera's published](https://hedera.com/fees) ~$0.001 HTS transfer fee — paid by the treasury. |
| **Proof integrity** | Proof hash + intent hash + verdict written to an **HCS topic** on every payout | Immutable, consensus-timestamped record anyone can replay from a public Mirror Node, independent of our database. Anchoring is best-effort and happens after payout, so a topic outage never costs a worker money — and rejected proofs are not anchored. |
| **Oracle identity** | **HashPack** over WalletConnect returns a native `0.0.x` account id | An EVM wallet would hand back a `0x…` address, which is not what an HTS transfer pays. Connecting a Hedera wallet skips the translation entirely — and because HTS refuses to deliver a token to an account that has not associated it, the app checks association on connect and offers it as one signature, rather than letting an oracle discover it after the work is done. |
| **Verification** | Public **Mirror Node** transfer-list lookup | We never take the facilitator's word that a payment settled — we re-read the transaction's transfer list from a public Mirror Node, a source independent of the facilitator, before believing it. |

### Why x402 on Hedera changes the shape of the code

The X Layer version of this project used the EVM `exact` scheme over Permit2: the agent signed an authorization and *we* pulled the funds with our own operator key. On Hedera the flow inverts, and it's strictly better:

- The payer **signs a real transaction**, not an approval to be redeemed later.
- The **facilitator is the fee payer for the transfer**, so the agent spends no HBAR on the payment itself. It still needs a little HBAR once, to associate the token.
- The **resource server holds no key** — it cannot redirect, inflate or replay a payment, because `payTo` and `amount` are inside the payer's signature and the payment reference is bound to the Hedera transaction id.
- Settlement returns a genuine Hedera transaction id, linkable on HashScan.

One honest caveat: the bundled MCP server also ships a *client-side* wallet (`AGENT_ACCOUNT_ID` / `AGENT_PRIVATE_KEY`) so an LLM with no Hedera account can pay. That wallet is the payer, not the resource server, and it must be a different account from the treasury — [`lib/agent-pay.ts`](lib/agent-pay.ts) refuses to start rather than falling back to the treasury key. A production agent would sign remotely and send only the `X-PAYMENT` header.

---

## Payment flow, end to end

Three gates, all fail-closed. A payment must clear all three before a task exists.

```
1. VERIFY   facilitator     → is the signed transaction well-formed and fundable?
2. SETTLE   facilitator     → co-sign as fee payer, submit to Hedera, return a tx id
3. CONFIRM  public mirror   → re-derive the transfer list; did payTo actually get paid?
```

There is exactly one way to create a task without paying: a local demo bypass, off by default. It needs **both** `ALLOW_DEMO_BYPASS=true` and a matching `ADMIN_SECRET`, and is refused outright when `NODE_ENV=production`. Tasks it creates are reported as `created_unpaid_demo` with `paid: false`, and no Hedera transaction exists for them. It is there so the UI can be demoed offline; leave it unset and the three gates above are the only path.

Step 3 is the one most integrations skip. A resource server should not trust a facilitator's "success" — [`lib/mirror-verify.ts`](lib/mirror-verify.ts) fetches the transaction from a public Mirror Node and checks the credit to our account in the transfer list. A fabricated transaction id has no record; a real transaction that paid someone else, or paid too little, fails the check.

Replay is bound at the database layer: the payment reference is derived from the Hedera transaction id, so resubmitting the same payment collides on a unique index no matter what else the header claims.

---

## Proof verification — the semantic notary

Payment being real is only half the problem. Proof has to mean *verified content*, not *a decodable JPEG*.

1. **Integrity gate** — correct type, image decodes, required fields present, and not a byte-for-byte repeat of a recent proof. Blatant fraud fails instantly. (A merely *similar* image is flagged as advisory, not failed — two honest photos of the same storefront minutes apart are legitimately alike.)
2. **Semantic notary** ([`lib/notary.ts`](lib/notary.ts)) — an AI judges whether the proof satisfies the task *intent*. Photos go to a vision model; forms go to an LLM.
3. **Freshness challenge** — each task carries a per-task code the worker must include, so a stock or recycled image cannot pass.

A confident mismatch is rejected with no payout. When the model **runs but is unsure**, the proof still pays — an honest oracle is not failed over a borderline score. When the model **cannot run at all** (no key, rate limit, timeout), nothing is auto-paid: the task is held for the paying agent to accept or reject. Those two states behave oppositely on purpose — the first is a judgement, the second is an absence of one. The verdict (decision · confidence · reason) is stored on the task, shown to the oracle, and returned to the calling agent. Paid tasks are additionally **anchored to HCS**.

With a vision key configured this runs fully autonomously: `pnpm e2e` submits a generated photo carrying that task's freshness code, the model reads the code back, and the payout fires with no human in the loop. Without a key the notary abstains and the task is held — safe, just not autonomous.

The freshness gate for *form* proofs is a deterministic string match performed **before** any model call, so a missing code is a hard reject even when every AI provider is down.

---

## The human side

The agent path is an API; the oracle path is a website.

1. **Connect** — HashPack over WalletConnect, or paste a `0.0.x` account id. If the
   account has not associated USDC, the page says so and offers the association as a
   single signature; without it Hedera would reject the payout *after* the work is done.
2. **Claim** a mission from the board. The claim is atomic — a second oracle claiming
   the same mission gets a 409, not a silent overwrite.
3. **Submit proof.** Every task carries a per-task **freshness code** that must appear
   in the photo, which is what stops a stock image or a re-used shot from passing.
4. **Get paid.** The notary reads the proof, quotes the code back in its verdict, and
   the payout settles to your account in seconds — 0.44 USDC of a 0.50 task after the
   12% platform fee.

---

## Quick start

### Prerequisites

- Node.js 20+, pnpm
- A funded Hedera **testnet** account — [portal.hedera.com](https://portal.hedera.com)
- A MongoDB database (Atlas free tier is fine)
- A Groq API key (planner + notary) — optional; without it the notary abstains
  and proofs are held for the paying agent to review rather than auto-paid

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

Fill in the remaining `.env.local` values — `MONGODB_URI`, `PROOF_URL_SECRET` and (optionally) `GROQ_API_KEY`. Then run the one-time Hedera setup, which associates the USDC token with both accounts and creates the HCS proof topic:

```bash
pnpm hedera:setup
```

Paste the printed `HEDERA_PROOF_TOPIC_ID` into `.env.local`, then start:

```bash
pnpm dev
```

MongoDB indexes — including the unique partial index on `payments.tx_hash` that stops one settled transaction paying for two tasks — are created automatically on first connection. There is no migration step.

### Prove it works

```bash
pnpm test             # 132 unit + integration assertions, offline, ~1s
pnpm test:db          # 27 assertions against the real MongoDB
pnpm test:chain       # 30 assertions against live Hedera testnet, real USDC
pnpm test:endpoints   # 41 assertions across 12 HTTP routes — spends one real payment
pnpm e2e              # full lifecycle on testnet: 8 steps, 13 assertions
```

**243 passing, 0 failing.** The last two need `pnpm dev` running.

[`docs/VERIFICATION.md`](docs/VERIFICATION.md) contains the **verbatim stdout** of every one of
those commands, captured in a single sitting, plus the seven silent bugs the tests caught.

`pnpm test` needs no network, database or keys — API routes run against an in-memory fake that reimplements the schema's real constraints, so the replay guard and payout gating are genuinely exercised. It runs in CI on every push to `main` and every pull request.

`pnpm test:db` proves the guarantees the offline fake assumes: ten concurrent claims on one task, exactly one wins; a settled transaction refuses to pay twice even under a fresh payment reference; illegal state transitions are rejected; proof bytes round-trip through GridFS; and a forged, reused or expired proof-URL signature is refused.

`pnpm test:chain` spends real USDC: it builds a 402 challenge, signs a Hedera transfer, settles it through the facilitator, confirms it on a public Mirror Node, pays an oracle, and anchors a proof to HCS. Negative cases included — a redirected `payTo`, an underpayment, and a replayed payment must all be rejected.



For the complete task lifecycle end to end (needs the server running):

```bash
pnpm e2e
```

> **Funding note.** The agent account needs testnet **USDC** (`0.0.429274`), not just HBAR, and must be associated with the token (`pnpm hedera:setup` does the association). If you'd rather demo without sourcing testnet USDC, set `PAYMENT_ASSET_ID=0.0.0` and payout, faucet and mirror verification all switch to native HBAR, which the Portal faucet funds directly. The payment leg additionally requires your facilitator to advertise the `exact` scheme for asset `0.0.0` — blocky402 does.

---

## Use it from an AI agent

```bash
claude mcp add groundtruth --transport http https://groundtruth-hedera.vercel.app/api/mcp
```

Then, in an agent session:

```
Call human_do with:
- intent: "Verify the nearest coffee shop is open and photograph the entrance"
- proof_type: photo
- instructions: "Clear photo of the entrance showing it is open"
- budget_usdt: "2.00"
```

GroundTruth's bundled agent wallet fetches the 402 challenge, signs a Hedera USDC transfer, and creates the task on the caller's behalf — no human approval in the loop. The MCP client itself needs no Hedera key.

### MCP tools

| Tool | Purpose |
|---|---|
| `ground_truth_info` | Service info, pricing, network, facilitator, proof-anchor topic |
| `human_do` | Create a task (requires x402 payment). Returns `task_id` and the Hedera tx id |
| `task_status` | Poll status, retrieve the verified proof and notary verdict |
| `review_task` | Accept (releases the HTS payout) or reject a submitted proof. Authenticates with `ADMIN_SECRET` or the task's `payment_ref` |

---

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/mcp` | POST | MCP server (streamable HTTP) |
| `/api/v1/human-do` | GET | Returns the 402 challenge — discover the price without paying |
| `/api/v1/human-do` | POST | Create a task (x402 payment required; a non-production demo bypass exists behind `ALLOW_DEMO_BYPASS`) |
| `/api/v1/tasks/:id` | GET | Task status, proof, notary verdict, settlement |
| `/api/faucet` | GET/POST | Testnet USDC drip + association status |
| `/api/pulse` | GET | Network stats |

### The 402 challenge

`GET /api/v1/human-do` returns the payment requirements, including the facilitator's fee payer (abridged — the real body also carries `resource.description` / `mimeType` / `tags`):

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
│   ├── verify.ts             Integrity gate — type, decode, fields, duplicates
│   └── payment.ts            Three-gate payment pipeline
├── scripts/
│   ├── hedera-keygen.ts      Generate fundable treasury + agent keypairs
│   ├── hedera-resolve.ts     Resolve auto-created account ids after funding
│   ├── hedera-setup.ts       Token association + HCS topic creation
│   ├── test-x402.ts          Live payment-rail suite
│   ├── test-settlement.ts    Live payout + anchoring suite
│   ├── test-mongo.ts         Live database suite
│   ├── test-endpoints.ts     Live HTTP route suite (needs a running server)
│   └── e2e-hedera-pay.ts     Full lifecycle on testnet
└── test/                     Offline unit + integration suites
```

---

## Configuration

Everything chain-facing is env-driven. The two switches worth knowing:

| Variable | Default | Effect |
|---|---|---|
| `PAYMENT_ASSET_ID` | `0.0.429274` (USDC) | Set to `0.0.0` to run the whole app in native HBAR — no token association needed |
| `X402_FACILITATOR_URL` | `https://api.testnet.blocky402.com` | Any Hedera-capable facilitator. `https://x402.org/facilitator` also works |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset | Enables the HashPack connect button ([free id](https://cloud.reown.com)). Unset is a supported state — the mission page falls back to pasting an account id |

Everything above and the common options are in [`.env.example`](.env.example). A few advanced knobs are read straight from the environment: `AUTO_ACCEPT` (set `false` to require manual review for every payout), `VISION_*`, `FORM_JUDGE_*`, `MIRROR_LOOKUP_*`, `PROOF_MAX_BYTES`, `HEDERA_MAX_TX_FEE_HBAR`.

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
| Supabase (Postgres + Storage) | MongoDB (documents + GridFS proof images) |
| OKLink explorer, chainId 196/1952 | HashScan, `hedera:testnet` |
| EVM `0x…` worker addresses | Hedera `0.0.x` account ids |

The Solidity payroll contract was **removed rather than redeployed**: with native HTS transfers doing settlement, keeping a contract on the critical path would have been dead weight and a worse story than using Hedera's own token service.

---

## License

MIT
