# GroundTruth — Hedera x402 Bounty Submission

**Live:** https://groundtruth-hedera.vercel.app
**Repo:** https://github.com/nickthelegend/groundtruth-hedera
**Network:** Hedera testnet · x402 `exact` scheme · Circle USDC (`0.0.429274`)
**Facilitator:** `https://api.testnet.blocky402.com`

---

## The one-sentence pitch

AI agents can read the whole internet and still cannot tell you whether a shop is open right now
— GroundTruth is the API call that hires a human to go and look, pays them per-call over x402,
and settles it natively on Hedera.

---

## Copy-paste answers for the submission form

**What it does.** An AI agent posts a real-world task and pays for it in the same HTTP
round-trip. A human oracle completes it, an AI notary checks the proof actually satisfies the
request, and the oracle is paid in USDC on Hedera. Proof hashes are anchored to a Hedera
Consensus Service topic.

**How it uses Hedera rails.** Payments use the x402 `exact` scheme on `hedera:testnet` — the
payer signs a real `TransferTransaction` and the facilitator co-signs as fee payer and submits,
so the resource server holds no key on the payment path. Payouts are native HTS transfers, not a
payroll contract. Proofs are anchored to HCS. Settlement is independently re-confirmed against a
public Mirror Node before a task is created.

**What's verifiable.** 243 assertions pass, of which 111 run against live Hedera testnet, live
MongoDB and the deployed app. Every transaction linked below is real.

### Key transactions

| | |
|---|---|
| x402 payment settled | [`0.0.7162784@1785524910.807306689`](https://hashscan.io/testnet/transaction/0.0.7162784@1785524910.807306689) |
| Oracle payout | [`0.0.9847867@1785524943.299405326`](https://hashscan.io/testnet/transaction/0.0.9847867@1785524943.299405326) |
| HCS proof topic | [`0.0.9847942`](https://hashscan.io/testnet/topic/0.0.9847942) |

### Accounts — a genuine three-party trail

| Role | Account |
|---|---|
| Paying agent | [`0.0.9847870`](https://hashscan.io/testnet/account/0.0.9847870) |
| Treasury | [`0.0.9847867`](https://hashscan.io/testnet/account/0.0.9847867) |
| Human oracle | [`0.0.9860142`](https://hashscan.io/testnet/account/0.0.9860142) |

Three distinct accounts, so the money visibly moves agent → treasury → oracle. Not one wallet
paying itself.

---
## The demo video — record this, in the browser

**The product is a website.** A human oracle claims and completes missions in the web app;
the *agent* side is an API because an agent is software — there is no UI for "an AI pays a
bill". So the demo lives in the browser, and the agent appears exactly once: as the thing
that makes a paid mission land on the board.

**No curl.** The raw 402 challenge JSON is already rendered, legibly, in the launch video —
it does not need to be typed on camera. Showing a terminal for four minutes would sell this
as a CLI, which it isn't.

Total: **3:00**. Shorter is easier to record and easier to watch.

### Before you hit record

Two windows, nothing else:

- **A — browser**, three tabs already open: `/` · `/tasks` · `/pulse`
- **B — an MCP client** (Claude Desktop) connected to
  `https://groundtruth-hedera.vercel.app/api/mcp`

You do **not** type `human_do` anywhere. You ask a normal question in plain English; the
agent decides to call the tool, fills in the arguments, and pays. That decision is the
demo. The oracle's payout address is a typed Hedera account id on the mission page —
there is no wallet-connect extension, so have `0.0.9860142` on your clipboard.

Have the proof photo on your desktop, ready to drag. Do one full dry run first — the
agent wallet `0.0.9847870` holds **15.10 USDC**, so at 0.50/task you get ~30 attempts.

> **Fallback if the MCP client won't connect in time:** run `pnpm e2e` in a small terminal
> for the 0:30–1:00 beat instead, then cut straight back to the browser. Same story, one
> less moving part. Do not restructure the rest of the demo around it.

### 0:00–0:30 — The landing page

Scroll slowly. Stop on the line that already frames the whole product:

> *"You don't post tasks by hand — your agent does."*

### 0:30–1:00 — An AI hires a human

In the MCP client, type a real question:

> *Is the coffee shop on the corner open right now? Use GroundTruth.*

The agent calls `human_do`, pays over x402 on Hedera, and returns a `task_id`. Let the tool
result sit on screen — it shows `paid: true` and the payment transaction id. **That is the
bounty criterion, shown by the product paying for itself rather than by a curl command.**

> You cannot accidentally record an unpaid task. The demo bypass requires
> `ALLOW_DEMO_BYPASS=true` **and** `NODE_ENV !== 'production'`, and production satisfies
> neither — if the x402 payment ever fails, the tool returns an error and creates nothing.
> Rehearsed live: the call charges 0.50 USDC and returns a real payment tx id.

### 1:00–1:30 — The mission is live

Cut to `/tasks`. The mission you just paid for is on the board with its **0.50 USDC**
bounty. Claim it. This is the money shot: an AI spent real money and a human now has work.

### 1:30–2:10 — A human does it

On the mission page: read the per-task **freshness code**, drag in the proof photo, submit.
Stay on the verifying state until the notary returns — it quotes the freshness code back in
its verdict. That sentence is what makes the proof non-fakeable; let it be read.

### 2:10–2:35 — Money moved

Cut to `/pulse`. Payment, payout and proof-anchor all land on the live feed. Say the split
out loud: **0.50 in, 0.44 to the oracle, 12% platform fee.**

### 2:35–3:00 — Anyone can check it

Open HashScan on the payment tx, the payout tx, and the HCS topic `0.0.9847942`. Close on
the topic — every verified proof is anchored to public consensus.

---

### Narration — edit here, then TTS

One line per beat. Calm and flat; do not sell.

```text
[0:00] GroundTruth is a marketplace where AI agents pay humans to verify the physical world.
[0:12] Agents don't post work by hand. They discover it over MCP and pay for it over x402.
[0:30] So let's ask one. This is a normal assistant, connected to GroundTruth.
[0:44] It priced the job, paid half a dollar of USDC on Hedera, and got back a task id. No gas.
[1:00] That payment put a real mission on the board.
[1:12] Any human can claim it. This one is worth forty-four cents to whoever does it.
[1:30] Every task carries a freshness code. The proof has to show it.
[1:50] The notary reads the photo and quotes the code back. A stock photo cannot pass.
[2:10] Payment in, payout out, proof anchored to consensus.
[2:22] Fifty cents in. Forty-four to the oracle. A twelve percent platform fee.
[2:35] None of this is a screenshot. Every hop is a real transaction on Hedera testnet.
[2:50] And every verified proof is anchored to a public topic. Anyone can audit it.
```

### If something breaks on camera

- **Mission already claimed** — you left a dry run open. Post a new one; it takes 20 seconds.
- **Notary is rate-limited (429)** — turn it into a feature: *"the model was rate-limited, so
  the notary abstained and the task waits for the agent to decide. It never auto-pays
  something it couldn't verify."*
- **The tool returns an error instead of a task** — the x402 payment failed (most likely the
  agent wallet ran dry). Check the balance; the bypass cannot fire in production.

### The longer 4:40 cut, if you want it

Keep everything above, then append: `pnpm test` and `pnpm test:db` (3:00–3:50), and close on
the adversarial audit (3:50–4:40). Only do this if you have time to spare — the 3:00 cut is
the stronger submission.

## Bounty checklist

- [x] Public open-source repo
- [x] Real on-chain transactions on Hedera testnet
- [x] HashScan links to payment, payout and proof anchor
- [x] Working end-to-end flow, deployed and reproducible
- [x] Uses Hedera rails natively — x402 `exact`, HTS, HCS, Mirror Node
- [ ] Demo video under five minutes ← **the script above**
- [ ] Submission form

---

## What I'd say if a judge asks "what's not done?"

Straight answers, because they're better than being caught out:

- **The oracle side is a web form, not an app.** A real deployment needs a mobile client with
  camera capture and GPS.
- **The notary's judgement quality isn't benchmarked.** It's inherently probabilistic. What *is*
  tested is that an unverifiable proof never auto-pays.
- **Review authorisation is a bearer `payment_ref`.** Never returned from a public route, compared
  in constant time — but a production build should use a signed capability token.
- **Testnet only.** Mainnet needs a funded treasury and real oracle onboarding.
- **Faucet rate limiting is in-memory**, so it resets on cold start. The treasury balance is the
  real cap.

All of these are in [`SECURITY.md`](SECURITY.md) under Known limitations. None of them were
found by a judge — they're there because we went looking.
