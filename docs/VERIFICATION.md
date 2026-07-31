# Verification — real transactions on Hedera testnet

Every claim below is backed by a transaction anyone can open on HashScan.

**Network:** `hedera:testnet` · **Asset:** Circle USDC (`0.0.429274`) · **Facilitator:** `https://api.testnet.blocky402.com` · **Database:** MongoDB

| Role | Account |
|---|---|
| Treasury / `payTo` | [`0.0.9847867`](https://hashscan.io/testnet/account/0.0.9847867) |
| Paying agent | [`0.0.9847870`](https://hashscan.io/testnet/account/0.0.9847870) |
| Facilitator fee payer | [`0.0.7162784`](https://hashscan.io/testnet/account/0.0.7162784) |
| HCS proof topic | [`0.0.9847942`](https://hashscan.io/testnet/topic/0.0.9847942) |

---

## Reproduce it

```bash
pnpm test         # 102 unit + integration, offline, ~1s
pnpm test:db      # 27 against the real MongoDB
pnpm test:chain   # 30 against live Hedera testnet, real USDC
pnpm e2e          # 13-step full lifecycle (server must be running)
```

**172 passing, 0 failing.**

| Suite | Tests | Needs network? |
|---|---|---|
| `test/money.test.ts` | 13 | no |
| `test/types.test.ts` | 18 | no |
| `test/hedera.test.ts` | 17 | no |
| `test/mirror-verify.test.ts` | 11 | no |
| `test/x402.test.ts` | 12 | no |
| `test/api-human-do.test.ts` | 16 | no |
| `test/api-lifecycle.test.ts` | 15 | no |
| `scripts/test-x402.ts` | 15 | **live testnet** |
| `scripts/test-settlement.ts` | 15 | **live testnet** |
| `scripts/test-mongo.ts` | 27 | **live MongoDB** |
| `scripts/e2e-hedera-pay.ts` | 13 | **live testnet + MongoDB + server** |

The offline suites run in CI on every push. The chain and database suites hit live infrastructure and spend real USDC, so they are run deliberately and never in CI.

---

## x402 payment rail — 15/15

```
1. Build the 402 challenge
   ✓ x402Version is 2
   ✓ network is hedera:testnet
   ✓ scheme is exact
   ✓ amount is 500000 atomic units (= 0.50 USDC)
   ✓ facilitator fee payer merged in: 0.0.7162784

3. Agent signs a Hedera transfer for the challenge
   ✓ payment header produced

4. Facilitator verifies the signed payment
   ✓ verified — payer 0.0.9847870

5. Negative — a tampered payment must be rejected
   ✓ redirected payTo rejected — "wrong payTo"
   ✓ underpayment rejected — "amount below required price"

6. Facilitator settles on Hedera
   ✓ settled — tx 0.0.7162784@1785512615.505291844

7. Independent confirmation on a public Mirror Node
   ✓ confirmed in consensus at 1785512621.912942481
     payer 0.0.9847870 · payee 0.0.9847867 · amount 0.5 USDC

8. Negative — replaying the settled payment must fail
   ✓ replay rejected — DUPLICATE_TRANSACTION

9. Confirm value actually moved
   ✓ payee credited 0.5 USDC
   ✓ agent debited exactly the price — facilitator covered the network fee
```

**Settled payment:** [`0.0.7162784@1785512615.505291844`](https://hashscan.io/testnet/transaction/0.0.7162784@1785512615.505291844)

Two details worth pointing at:

- **The agent is debited exactly the price — no gas.** The transaction id belongs to `0.0.7162784`, the *facilitator*, because it is the fee payer. A paying agent therefore needs the payment asset and nothing else. This is the property the Hedera x402 scheme gives you that the EVM version does not.
- **Replay fails at the network, not just in our database.** The signed transaction carries its own id, so resubmitting it is rejected by consensus with `DUPLICATE_TRANSACTION` before it reaches our replay guard.

---

## Settlement primitives — 15/15

```
1. Money maths for the configured asset
   ✓ decimals resolved to 6 for USDC
   ✓ "1" → 1000000 atomic units
   ✓ round-trips "0.5" exactly
   ✓ fee split is lossless — 0.44 payout + 0.06 fee
   ✓ fee is exactly 1200 bps

2. Account id handling
   ✓ accepts 0.0.12345 · rejects an EVM address · trims whitespace
   ✓ HashScan ↔ mirror transaction-id conversion both directions

3. Native payout to an oracle account
   ✓ payout settled — 0.0.9847867@1785512631.414941066
   ✓ oracle credited exactly 0.44 USDC

4. Anchor a proof to Hedera Consensus Service
   ✓ anchored at sequence #3 — 0.0.9847867@1785512640.222691483

5. Read the anchor back from a public Mirror Node
   ✓ anchor readable from public mirror at consensus 1785512643.813714104
   ✓ anchored payload matches what we wrote
```

**Oracle payout:** [`0.0.9847867@1785512631.414941066`](https://hashscan.io/testnet/transaction/0.0.9847867@1785512631.414941066)
**Proof anchor:** [`0.0.9847867@1785512640.222691483`](https://hashscan.io/testnet/transaction/0.0.9847867@1785512640.222691483)
**Topic:** [`0.0.9847942`](https://hashscan.io/testnet/topic/0.0.9847942) — replay it yourself; the audit trail does not depend on our API.

---

## HTTP surface

`GET /api/v1/human-do` → **HTTP 402** with a usable challenge:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": ".../api/v1/human-do", "serviceName": "GroundTruth" },
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "500000",
    "asset": "0.0.429274",
    "payTo": "0.0.9847867",
    "maxTimeoutSeconds": 180,
    "extra": { "symbol": "USDC", "decimals": 6, "feePayer": "0.0.7162784" }
  }]
}
```

---

## Four bugs these tests caught

Worth recording, because every one of them was silent and each would have broken the demo.

**1. Mirror Node confirmation read the wrong record.**
One Hedera transaction id can map to *several* mirror records — the top-level `CRYPTOTRANSFER` plus children like the `CRYPTOUPDATEACCOUNT` emitted when a payer's account was auto-created from an EVM alias. The child is frequently returned **first** and carries an empty transfer list. Reading `transactions[0]` therefore found no payment and reported every genuine payment as unconfirmed. Fixed by scanning all successful records and summing credits to the payee.

The same fix corrected payer attribution: the largest debit is the *fee payer*, not the sender, so the payer is now matched on the exact transfer amount.

**2. Decimals were hardcoded to 6.**
`toUnits` assumed a 6-decimal asset. HBAR is quoted in tinybars at 8, so a task priced `"2.00"` would have charged **0.02 HBAR** — a 100× underpayment, silently. `lib/money.ts` now derives its scale from the configured asset.

**3. ED25519 keys were parsed as ECDSA, silently.**
`parsePrivateKey` tried `PrivateKey.fromStringECDSA` first and fell back on throw. But the SDK does **not** throw on an ED25519 DER string — it accepts it and derives a *different* public key, so the account id is wrong and every signature fails for no visible reason. Hedera Portal issues both key types, so roughly half of all users would have hit this. Now the curve is read from the DER algorithm identifier instead of guessed.

**4. The task state machine was decorative.**
`VALID_TRANSITIONS` and `canTransition` were exported and looked authoritative, but `transition()` in `lib/db.ts` did a bare compare-and-swap on status and never consulted them. Any illegal move — `pending → verified`, paying out for work nobody did — was one mistaken call away. `transition()` now enforces the machine, and the declared transitions were corrected to match what the code legitimately does (submission resolves in a single CAS from `claimed`; `failed` is retryable by the same worker).

---

## Proof storage

Photos were previously never stored: `storageKeys` were fabricated from the uploaded filename and no upload ever happened, so the deliverable an agent paid for did not exist. Proofs are now stored in MongoDB GridFS, keyed by content hash rather than by the worker-supplied filename, and handed back as short-lived HMAC-signed URLs on `task_status`. GridFS has no URL concept, so `/api/proofs/[key]` verifies the signature with a constant-time compare before serving a byte. A failed upload returns 502 and leaves the task unresolved, because a task marked verified with no retrievable proof is worse than a failed submission.

---

## Not covered here

The semantic notary's *judgement quality* is not tested — that needs a vision API key and is inherently probabilistic. What is tested is that an unverifiable proof never auto-pays: with no key configured the notary abstains and the task is held for the paying agent, which `pnpm e2e` step 5 demonstrates.


---

## Full lifecycle — 13/13

`pnpm e2e` walks the entire product in one run, in real USDC, against the real database.

```
[1] Agent fetches the 402 challenge and signs a Hedera payment
    ✓ signed by 0.0.9847870
[2] Paid request creates the task
    ✓ task 8447a7d5-c160-4041-ab5d-7fb323af946f created
[3] Mirror node confirms the payment
    ✓ confirmed — 0.5 USDC from 0.0.9847870
[4] A human oracle claims the mission
    ✓ claimed by 0.0.9847870
[5] Oracle submits photo proof
    ✓ submitted — status submitted
      notary: uncertain (vision skipped — no vision API key)
[6] Paying agent reviews the proof and accepts
    ✓ accepted by the paying agent
[7] Oracle is paid on Hedera and the proof is anchored to HCS
    ✓ payout tx 0.0.9847867@1785512804.941540023
    ✓ paid 0.44 USDC
    ✓ proof anchored at HCS sequence #4
[8] Paying agent retrieves the proof it paid for
    ✓ task reports verified
    ✓ 1 signed proof URL(s) returned
    ✓ proof image downloads and matches the bytes submitted
    ✓ the same URL without a signature is refused
```

**Payment:** [`0.0.7162784@1785512788.541262413`](https://hashscan.io/testnet/transaction/0.0.7162784@1785512788.541262413)
**Payout:** [`0.0.9847867@1785512804.941540023`](https://hashscan.io/testnet/transaction/0.0.9847867@1785512804.941540023)

Step 5 is worth reading closely. With no vision key configured the notary **abstains**, and the task is held for the paying agent rather than auto-paid. That is the fail-closed path working: an unverifiable photo never releases money on its own.

---

## Database — 27/27

`pnpm test:db` proves the guarantees the offline fake assumes actually hold in MongoDB:

```
✓ replay guard exists as a unique index on tx_hash
✓ index is partial, so demo rows with no tx do not collide
✓ exactly 1 of 10 concurrent claims won
✓ a later claim is refused
✓ same payment_ref rejected
✓ same tx_hash under a NEW payment_ref rejected
✓ illegal transition pending → verified refused
✓ exactly 1 of 2 concurrent resolutions won
✓ bytes round-trip through GridFS unchanged
✓ re-upload replaces rather than duplicates
✓ forged signature rejected
✓ signature bound to its own key — cannot be reused for another proof
✓ expired link rejected
```

The two that matter most: **ten concurrent claims on one task, exactly one wins**, and **a settled transaction refuses to pay twice even under a freshly invented payment reference**. Both are enforced by database constraints — a conditional `findOneAndUpdate` and a unique partial index — not by application-level checks, which would race.
