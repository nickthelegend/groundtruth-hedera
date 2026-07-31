# Verification — real transactions on Hedera testnet

Every block below is **verbatim stdout** from the command named above it, captured in one
sitting. Nothing is summarised, compressed, or retyped — if a line is not in the output, it is
not in this document.

**Network:** `hedera:testnet` · **Asset:** Circle USDC (`0.0.429274`) · **Facilitator:** `https://api.testnet.blocky402.com` · **Database:** MongoDB

| Role | Account |
|---|---|
| Paying agent | [`0.0.9847870`](https://hashscan.io/testnet/account/0.0.9847870) |
| Treasury / `payTo` | [`0.0.9847867`](https://hashscan.io/testnet/account/0.0.9847867) |
| Human oracle | [`0.0.9860142`](https://hashscan.io/testnet/account/0.0.9860142) |
| Facilitator fee payer | [`0.0.7162784`](https://hashscan.io/testnet/account/0.0.7162784) |
| HCS proof topic | [`0.0.9847942`](https://hashscan.io/testnet/topic/0.0.9847942) |

Three distinct accounts, so the on-chain trail reads agent → treasury → oracle rather than one
wallet paying itself.

---

## Reproduce it

```bash
pnpm test             # 130 unit + integration assertions, offline, ~1s
pnpm test:db          # 27 assertions against the real MongoDB
pnpm test:chain       # 30 assertions against live Hedera testnet, real USDC
pnpm test:endpoints   # 41 assertions across 12 HTTP routes — spends one real payment
pnpm e2e              # full lifecycle: 8 steps, 13 assertions
```

**241 assertions passing, 0 failing.**

| Suite | Assertions | Needs network? |
|---|---|---|
| `test/api-human-do.test.ts` | 18 | no |
| `test/api-lifecycle.test.ts` | 16 | no |
| `test/hedera.test.ts` | 17 | no |
| `test/mirror-verify.test.ts` | 11 | no |
| `test/money.test.ts` | 13 | no |
| `test/notary.test.ts` | 18 | no |
| `test/types.test.ts` | 18 | no |
| `test/verify.test.ts` | 7 | no |
| `test/x402.test.ts` | 12 | no |
| `scripts/test-mongo.ts` | 27 | **live MongoDB** |
| `scripts/test-x402.ts` | 15 | **live testnet** |
| `scripts/test-settlement.ts` | 15 | **live testnet** |
| `scripts/test-endpoints.ts` | 41 | **live testnet + MongoDB + server** |
| `scripts/e2e-hedera-pay.ts` | 13 | **live testnet + MongoDB + server** |

Only the offline suite runs in CI — on every push to `main` and every pull request. The rest
need funded keys, a live database and a running server, and spend real USDC.

---

## `pnpm test` — offline

```
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v2.1.9 /Volumes/Extreme SSD/Projects/groundtruth

 ✓ test/money.test.ts (13 tests) 27ms
 ✓ test/types.test.ts (18 tests) 6ms
 ✓ test/api-human-do.test.ts (18 tests) 36ms
 ✓ test/notary.test.ts (18 tests) 164ms
 ✓ test/api-lifecycle.test.ts (16 tests) 108ms
 ✓ test/verify.test.ts (7 tests) 220ms
 ✓ test/x402.test.ts (12 tests) 459ms
 ✓ test/mirror-verify.test.ts (11 tests) 481ms
 ✓ test/hedera.test.ts (17 tests) 476ms

 Test Files  9 passed (9)
      Tests  130 passed (130)
   Start at  00:15:56
   Duration  856ms (transform 573ms, setup 0ms, collect 905ms, tests 1.98s, environment 1ms, prepare 764ms)
```

---

## `pnpm test:x402` — payment rail, real USDC

```
x402 payment rail — hedera:testnet
  facilitator : https://api.testnet.blocky402.com
  asset       : USDC (0.0.429274)
  price       : 0.50 USDC
  agent       : 0.0.9847870
  payTo       : 0.0.9847867

1. Build the 402 challenge
  ✓ x402Version is 2
  ✓ network is hedera:testnet
  ✓ scheme is exact
  ✓ amount is 500000 atomic units (= 0.50 USDC)
  ✓ facilitator fee payer merged in: 0.0.7162784

2. Record balances before payment
      agent  19.22 USDC
      payTo  15.78 USDC
  ✓ balances read

3. Agent signs a Hedera transfer for the challenge
  ✓ payment header produced
      header is 3432 bytes of base64

4. Facilitator verifies the signed payment
  ✓ verified — payer 0.0.9847870

5. Negative — a tampered payment must be rejected
  ✓ redirected payTo rejected — "wrong payTo"
  ✓ underpayment rejected — "amount below required price"

6. Facilitator settles on Hedera
  ✓ settled — tx 0.0.7162784@1785523571.436932810
      https://hashscan.io/testnet/transaction/0.0.7162784@1785523571.436932810

7. Independent confirmation on a public Mirror Node
  ✓ confirmed in consensus at 1785523576.829423104
      payer  0.0.9847870
      payee  0.0.9847867
      amount 0.5 USDC

8. Negative — replaying the settled payment must fail
  ✓ replay rejected — "transaction 0.0.7162784@1785523571.436932810 failed precheck with status DUPLICATE_TRANSACTION against node account id 0.0.5"

9. Confirm value actually moved
      agent  19.22 → 18.72  (-0.5)
      payTo  15.78 → 16.28  (0.5)
  ✓ payee credited 0.5 USDC
  ✓ agent debited exactly the price — facilitator covered the network fee

  HashScan: https://hashscan.io/testnet/transaction/0.0.7162784@1785523571.436932810

ALL PASS — 15 passed, 0 failed
```

Two details worth pointing at:

- **The agent is debited exactly the price — no gas on the payment itself.** The transaction id
  belongs to `0.0.7162784`, the *facilitator*, because it is the fee payer. An agent needs the
  payment asset and a little HBAR for the one-time token association, nothing more. This is the
  property the Hedera x402 scheme gives you that the EVM version does not.
- **Replay is refused before it reaches our database.** The signed transaction carries its own
  id, so resubmitting it inside its validity window is rejected with `DUPLICATE_TRANSACTION`.
  Past that window, the unique index on `payments.tx_hash` is what stops it — `pnpm test:db`
  covers that path.

---

## `pnpm test:settlement` — payout and proof anchoring

```
Settlement primitives
  asset  : USDC (0.0.429274, 6dp)
  topic  : 0.0.9847942

1. Money maths for the configured asset
  ✓ decimals resolved to 6 for USDC
  ✓ "1" → 1000000 atomic units
  ✓ round-trips "0.5" exactly
  ✓ fee split is lossless — 0.44 payout + 0.06 fee
  ✓ fee is exactly 1200 bps

2. Account id handling
  ✓ accepts 0.0.12345
  ✓ rejects an EVM address
  ✓ trims whitespace
  ✓ converts mirror tx id → HashScan form
  ✓ converts HashScan tx id → mirror form

3. Native payout to an oracle account
      oracle 0.0.9847870 before: 18.72 USDC
  ✓ payout settled — 0.0.9847867@1785523580.252095185
      https://hashscan.io/testnet/transaction/0.0.9847867@1785523580.252095185
  ✓ oracle credited exactly 0.44 USDC

4. Anchor a proof to Hedera Consensus Service
  ✓ anchored at sequence #16 — 0.0.9847867@1785523589.511680375
      https://hashscan.io/testnet/transaction/0.0.9847867@1785523589.511680375

5. Read the anchor back from a public Mirror Node
  ✓ anchor readable from public mirror at consensus 1785523593.685741104
  ✓ anchored payload matches what we wrote
      anyone can replay this topic — no GroundTruth API required

ALL PASS — 15 passed, 0 failed
```

---

## `pnpm test:db` — real MongoDB

```
MongoDB integration
  db: groundtruth

1. Connection and constraints
  ✓ cluster reachable
  ✓ replay guard exists as a unique index on tx_hash
  ✓ index is partial, so demo rows with no tx do not collide

2. Task round trip
  ✓ inserted task 2b53f76c-7159-4962-99b2-b09aa82cfd20
  ✓ read back with matching fields
  ✓ starts pending

3. Atomic claim
  ✓ exactly 1 of 10 concurrent claims won (0.0.900000)
  ✓ task is claimed
  ✓ a later claim is refused

4. Payment replay guard
  ✓ first payment recorded
  ✓ same payment_ref rejected
  ✓ same tx_hash under a NEW payment_ref rejected
  ✓ two tx-less rows coexist

5. Status transitions
  ✓ illegal transition pending → verified refused
  ✓ exactly 1 of 2 concurrent resolutions won
  ✓ same-status write allowed so settlement can merge

6. Proof storage (GridFS)
  ✓ uploaded proof: 2b53f76c-7159-4962-99b2-b09aa82cfd20/0-c414cd0e.png
  ✓ content type sniffed from bytes, not the filename
  ✓ bytes round-trip through GridFS unchanged
  ✓ re-upload replaces rather than duplicates

7. Signed proof URLs
  ✓ signed URL minted
      http://localhost:3000/api/proofs/2b53f76c-7159-4962-99b2-b09aa82cfd20/0-c414cd0e.png?exp=1785527168&sig=123e6ebe3ab2c7754c06aecbfa678b854dd4a64c60e23d9ac2dd85de6fbe95dc
  ✓ valid signature accepted
  ✓ forged signature rejected
  ✓ signature bound to its own key — cannot be reused for another proof
  ✓ expired link rejected

8. Worker reputation
  ✓ counters accumulate (4 completed)

Cleanup
  ✓ test data removed

ALL PASS — 27 passed, 0 failed
```

The two that matter most: **ten concurrent claims on one task, exactly one wins**, and **a
settled transaction refuses to pay twice even under a freshly invented payment reference**. Both
are enforced by database constraints — a conditional `findOneAndUpdate` and a unique partial
index — not by application-level checks, which would race.

---

## `pnpm test:endpoints` — every HTTP route

```
Endpoint suite  http://localhost:3210

Public endpoints
  ✓ GET  /api/v1/human-do (unpaid discovery) → 402
  ✓ 402 challenge carries the facilitator fee payer
  ✓ GET  /api/pulse → 200
  ✓ pulse returns numeric stats
  ✓ GET  /api/recent → 200
  ✓ recent returns a completions array
  ✓ GET  /api/tasks → 200
  ✓ tasks returns an array
  ✓ public task list does not leak payment_ref
  ✓ GET  /api/faucet (metadata) → 200
  ✓ faucet advertises asset 0.0.429274
  ✓ GET  /api/v1/tasks/<unknown> → 404

Authorisation
  ✓ GET  /api/admin/queue (no secret) → 401
  ✓ GET  /api/admin/queue (with secret) → 200
  ✓ GET  /api/admin/queue (wrong secret) → 401

Payment gate
  ✓ POST /api/v1/human-do (no payment) → 402
  ✓ POST /api/v1/human-do (garbage payment header) → 402
  ✓ POST /api/v1/human-do (malformed JSON, paid header absent) → 402

Paid task creation (real USDC)
  ✓ POST /api/v1/human-do (valid payment) → 201
  ✓ task created cfe95a04-e24f-41c0-95e0-6241e68c696a
      payment tx 0.0.7162784@1785523604.983018738
  ✓ POST /api/v1/human-do (replayed payment) → 402
  ✓ GET  /api/v1/tasks/:id → 200

Claim
  ✓ POST /api/tasks/:id/claim (EVM address) → 400
  ✓ POST /api/tasks/:id/claim (valid) → 200
  ✓ POST /api/tasks/:id/claim (already claimed) → 409

Submit proof
      freshness code: BDHMAJ
  ✓ POST /api/tasks/:id/submit (not your task) → 403
  ✓ POST /api/tasks/:id/submit (no freshness code) → 200
  ✓ proof without the freshness code is rejected
  ✓ no payout on a rejected proof
  ✓ POST /api/tasks/:id/submit (valid retry) → 200
      notary: accept — It provides a clear statement of shop hours.

Review and payout
  ✓ notary auto-accepted and settled inline
  ✓ oracle paid — 0.44 USDC
      https://hashscan.io/testnet/transaction/0.0.9847867@1785523621.110283295
  ✓ proof anchored at HCS #17

Proof access control
  ✓ GET  /api/v1/tasks/:id (verified) → 200
  ✓ task reports verified
  ✓ GET  /api/proofs/<key> (no signature) → 403
  ✓ GET  /api/proofs/<key> (forged signature) → 403

Faucet
  ✓ POST /api/faucet (invalid account) → 400
  ✓ GET  /api/faucet?account=<id> → 200

MCP transport
  ✓ POST /api/mcp (tools/list) → 200
  ✓ MCP advertises human_do

ALL PASS — 41 passed, 0 failed
```

---

## `pnpm e2e` — full lifecycle

```
GroundTruth — full lifecycle on hedera:testnet
  server : http://localhost:3210
  asset  : USDC (0.0.429274)
  budget : 0.50
  oracle : 0.0.9860142

[1] Agent fetches the 402 challenge and signs a Hedera payment
      Agent account: 0.0.9847870
      Network: hedera:testnet
      Asset: USDC (0.0.429274, 6dp)
      Token already associated
      Balance: 18.66 USDC (need 0.50)
      Requesting 402 challenge from http://localhost:3210/api/v1/human-do...
      Challenge: 500000 atomic units of 0.0.429274 to 0.0.9847867 (hedera:testnet)
      Signing Hedera transfer for x402 exact scheme...
      Payment signed — facilitator will co-sign as fee payer and submit to Hedera.
  ✓ signed by 0.0.9847870

[2] Paid request creates the task
  ✓ task b31d77c6-f2c1-40f2-b467-90ba2c1b141a created
      payment tx 0.0.7162784@1785523629.505413662
      https://hashscan.io/testnet/transaction/0.0.7162784@1785523629.505413662

[3] Mirror node confirms the payment
  ✓ confirmed — 0.5 USDC from 0.0.9847870

[4] A human oracle claims the mission
  ✓ claimed by 0.0.9860142

[5] Oracle submits photo proof
      freshness code for this task: JCKTPA
  ✓ submitted — status verified
      notary: accept (The image is a graphic representation of a coffee shop entrance with an 'OPEN' sign and the required code 'JCKTPA' clearly visible.)

[6] Notary auto-accepted — no manual review needed
  ✓ auto-verified

[7] Oracle is paid on Hedera and the proof is anchored to HCS
  ✓ payout tx 0.0.9847867@1785523695.053277836
      https://hashscan.io/testnet/transaction/0.0.9847867@1785523695.053277836
  ✓ paid 0.44 USDC
  ✓ proof anchored at HCS sequence #18
      https://hashscan.io/testnet/topic/0.0.9847942
      oracle balance 0.44 → 0.88 (0.44)

[8] Paying agent retrieves the proof it paid for
  ✓ task reports verified
  ✓ 1 signed proof URL(s) returned
  ✓ proof image downloads and matches the bytes submitted
  ✓ the same URL without a signature is refused

  HashScan
    payment : https://hashscan.io/testnet/transaction/0.0.7162784@1785523629.505413662
    payout  : https://hashscan.io/testnet/transaction/0.0.9847867@1785523695.053277836
    anchor  : https://hashscan.io/testnet/topic/0.0.9847942
    board   : http://localhost:3210/tasks/b31d77c6-f2c1-40f2-b467-90ba2c1b141a

ALL PASS — 13 passed, 0 failed
```

**Payment:** [`0.0.7162784@1785523629.505413662`](https://hashscan.io/testnet/transaction/0.0.7162784@1785523629.505413662)
**Payout:** [`0.0.9847867@1785523695.053277836`](https://hashscan.io/testnet/transaction/0.0.9847867@1785523695.053277836)

The freshness code is generated per task and rendered into the proof image at submit time, so the
vision model is reading that task's code rather than matching a fixture.

---

## Bugs these tests caught

Every one was silent — none threw an error, and the app appeared to work throughout.

**1. Mirror Node confirmation read the wrong record.**
One Hedera transaction id can map to *several* mirror records — the top-level `CRYPTOTRANSFER`
plus children like the `CRYPTOUPDATEACCOUNT` emitted when a payer's account was auto-created from
an EVM alias. The child is frequently returned **first** and carries an empty transfer list.
Reading `transactions[0]` therefore found no payment and reported every genuine payment as
unconfirmed. Fixed by scanning all successful records and summing credits to the payee. The same
fix corrected payer attribution: the old code took the first debit in the list, which can be the
fee payer rather than the sender, so the payer is now matched on the exact transfer amount.

**2. Decimals were hardcoded to 6.**
`toUnits` assumed a 6-decimal asset. HBAR is quoted in tinybars at 8, so a task priced `"2.00"`
would have charged **0.02 HBAR** — a 100× underpayment. `lib/money.ts` now derives its scale from
the configured asset.

**3. ED25519 keys were parsed as ECDSA.**
`parsePrivateKey` tried `fromStringECDSA` first and fell back on throw. The SDK does **not** throw
on an ED25519 DER string — it derives a *different* public key, so the account id is wrong and
every signature fails for no visible reason. Hedera Portal issues both key types. For DER keys the
curve is now read from the algorithm identifier.

**4. The task state machine was decorative.**
`VALID_TRANSITIONS` and `canTransition` looked authoritative, but `transition()` did a bare
compare-and-swap and never consulted them, so `pending → verified` — paying out for work nobody
did — was one call away. Now enforced at the only place status is written.

**5. A 429 sent verifiable proofs to manual review.**
The vision client rotated to the next provider on rate-limit, which does nothing with a single
key. One rate-limited second forced human review. Now retries with backoff, honouring
`Retry-After`. Safe before, just slow.

**6. The duplicate-proof check was dead code.**
The submit route stored a SHA-256 digest while `lib/verify.ts` compared perceptual hashes. Both
are 64 characters, so the length guard passed and nothing ever matched — an anti-fraud control
named in the README that had never once fired. The route now stores the perceptual hash, an exact
repeat is a **hard** fail, and `test/verify.test.ts` submits a byte-identical image and asserts
the proof is rejected.

**7. `payment_ref` leaked from a public endpoint.**
`GET /api/tasks` returned whole task documents, including the `payment_ref` that authorises a
payout through the review route. Anyone could have harvested it and force-accepted or rejected a
proof. The route now projects an explicit allowlist, the credential is compared in constant time,
and the endpoint suite asserts it is absent.

**8. A caller could set their own price.**
`budget_usdt` is caller-supplied and becomes the price the entire pipeline enforces — verify,
settle and the mirror gate all check against it. The schema constrained only the format, so a
caller could declare a budget of `0.000001`, pay that, and clear all three gates legitimately.
The route now rejects any budget below the configured list price.

Findings 6, 7 and 8 came from an adversarial audit of this repository's own documentation against
its code — nine judges, one per claim group, each instructed to refute rather than confirm. They
examined 132 claims and flagged 92; most were wording, four were defects, and two of those were
security bugs.

---

## Not covered here

The semantic notary's *judgement quality* is not tested — that is inherently probabilistic. What
is tested is that an unverifiable proof never auto-pays: when the model cannot run, the notary
abstains and the task is held for the paying agent.
