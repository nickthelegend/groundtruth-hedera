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

## The 5-minute demo video

Total: **4:40**, leaving buffer. Record in this order. Everything below has been rehearsed
against the live deployment.

### Before you hit record

```bash
# One terminal, in the repo
cd groundtruth-hedera
set -a && . ./.env.production.local && set +a
```

Open these tabs:
1. https://groundtruth-hedera.vercel.app
2. https://hashscan.io/testnet/topic/0.0.9847942
3. A terminal, font size up.

Check the agent still has USDC — each run costs 0.50:

```bash
curl -s "https://groundtruth-hedera.vercel.app/api/faucet?account=0.0.9847870" | python3 -m json.tool
```

---

### 0:00–0:35 — The problem (landing page)

Open **https://groundtruth-hedera.vercel.app**.

> "AI agents can read the entire internet. They still can't tell you if this shop is open right
> now, what's actually on the shelf, or whether the queue is out the door. They can't walk
> outside."

Scroll to **How it works**. Point at the five steps.

> "GroundTruth is the missing API call. An agent posts a task and pays for it in the same HTTP
> round-trip. A human goes and looks. An AI notary checks the proof actually matches what was
> asked. The human gets paid — all on Hedera, in about a minute."

Scroll to the hero stats: the price, ~3s finality, ~$0.001 fee.

---

### 0:35–1:10 — The 402 handshake (this is the bounty)

Terminal:

```bash
curl -s https://groundtruth-hedera.vercel.app/api/v1/human-do | python3 -m json.tool
```

> "This is the whole protocol in one response. An unpaid request gets HTTP 402 and the exact
> payment requirements: the `exact` scheme, `hedera:testnet`, the price in atomic units, USDC
> token `0.0.429274`, and the account to pay."

Point at `extra.feePayer`.

> "And that — the facilitator's fee payer — is the part that makes this Hedera and not EVM. The
> agent signs a real Hedera transfer. The facilitator co-signs as fee payer and submits it. So a
> paying agent needs USDC and **no gas at all**, and we — the resource server — hold no key on
> the payment path. We only ever see a signed transaction."

---

### 1:10–2:40 — The full loop, live (the money shot)

```bash
pnpm e2e
```

Talk over it as the eight steps print:

- **[1] signs** — "The agent fetches that 402 and signs a Hedera transfer for exactly the price."
- **[2] task created** — "Payment settled. That's a real transaction id."
- **[3] mirror confirms** — "We don't take the facilitator's word for it. We re-read the transfer
  list from a public Mirror Node before creating anything. Three gates, all fail-closed."
- **[4] claimed** — "A human oracle picks it up."
- **[5] proof + notary** — *pause here.* "Every task carries a per-task freshness code. The proof
  has to contain it, so a stock photo can't pass. Watch — the vision model read the code back."
  Read the notary line aloud; it quotes the actual code.
- **[6] auto-accepted** — "No human in the loop."
- **[7] paid + anchored** — "Oracle paid in USDC. Proof hash anchored to HCS."
- **[8] deliverable** — "And the agent downloads the photo it paid for. The same URL without a
  signature is refused — proofs aren't public."

Then click the **payment** and **payout** links it printed. Show both on HashScan.

> "Two different accounts. Agent paid the treasury, treasury paid the oracle."

---

### 2:40–3:20 — The proof is public and independent

Switch to the **HCS topic tab** and refresh:
https://hashscan.io/testnet/topic/0.0.9847942

> "Every verified task writes its proof hash, the intent hash and the notary's verdict to this
> topic. That's a consensus-timestamped audit trail anyone can replay from a public Mirror Node —
> it doesn't depend on our database, or on us being honest, or on us still being online."

Point at the newest sequence number matching the run.

---

### 3:20–4:10 — It's actually tested

```bash
pnpm test
```

> "132 offline assertions in under a second. No network, no keys — API routes run against an
> in-memory fake that reimplements the real database constraints."

Then:

```bash
pnpm test:db
```

> "27 against the real database. The two that matter: ten concurrent claims on one task and
> exactly one wins, and a settled transaction refusing to pay twice even under a freshly invented
> payment reference. Those are database constraints, not application checks — an application
> check would race."

> "243 assertions in total. 111 of them run against live Hedera, live MongoDB and the deployed
> app. Full verbatim output is in `docs/VERIFICATION.md`."

---

### 4:10–4:40 — Close on the honesty

> "One thing I'd point at. We ran an adversarial audit of our own README against the code — nine
> judges, each told to *refute* claims rather than confirm them. They flagged 92 of 132 claims.
> Most were wording. Three were security bugs: a credential leaking from a public endpoint, a
> duplicate-proof check that had never once fired, and a caller being able to set their own
> price. All three are fixed and covered by tests."

> "`docs/VERIFICATION.md` documents all ten silent bugs we found — including two that only
> surfaced *after* deploying. It's verbatim output, not a summary. If a line isn't in the
> terminal, it isn't in the doc."

End on the landing page.

---

## If something breaks on camera

| Symptom | Cause | Do this |
|---|---|---|
| `agent holds X but needs 0.50` | Agent out of USDC | Send USDC to `0.0.9847870`, or lower `ASP_PRICE_USDT` |
| Notary says `uncertain (vision unavailable HTTP 429)` | Groq free-tier rate limit | Wait 60s and re-run. The task is *held*, not failed — say so, it's the fail-closed path working |
| `status: submitted` instead of `verified` | Same as above | Point out this is correct: an unverifiable proof never auto-pays |
| `Task is not awaiting review` | Previous run left state | Just run `pnpm e2e` again — each run creates a fresh task |

**Turn the 429 into a feature if it happens.** "The model was rate-limited, so the notary
abstained and the task is waiting for the agent to decide. It never auto-pays something it
couldn't verify."

---

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
