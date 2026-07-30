# Verification — real transactions on Hedera testnet

Every claim below is backed by a transaction anyone can open on HashScan.

**Network:** `hedera:testnet` · **Asset:** native HBAR (`0.0.0`) · **Facilitator:** `https://api.testnet.blocky402.com`

| Role | Account |
|---|---|
| Treasury / `payTo` | [`0.0.9847867`](https://hashscan.io/testnet/account/0.0.9847867) |
| Paying agent | [`0.0.9847870`](https://hashscan.io/testnet/account/0.0.9847870) |
| Facilitator fee payer | [`0.0.7162784`](https://hashscan.io/testnet/account/0.0.7162784) |
| HCS proof topic | [`0.0.9847942`](https://hashscan.io/testnet/topic/0.0.9847942) |

---

## Reproduce it

```bash
pnpm test              # both suites below
pnpm test:x402         # payment rail
pnpm test:settlement   # payout + proof anchoring
```

Both run against live Hedera testnet and make real transactions. Results as of the last run: **30 passed, 0 failed**.

---

## x402 payment rail — 15/15

```
1. Build the 402 challenge
   ✓ x402Version is 2
   ✓ network is hedera:testnet
   ✓ scheme is exact
   ✓ amount is 50000000 atomic units (= 0.50 HBAR)
   ✓ facilitator fee payer merged in: 0.0.7162784

3. Agent signs a Hedera transfer for the challenge
   ✓ payment header produced

4. Facilitator verifies the signed payment
   ✓ verified — payer 0.0.9847870

5. Negative — a tampered payment must be rejected
   ✓ redirected payTo rejected — "wrong payTo"
   ✓ underpayment rejected — "amount below required price"

6. Facilitator settles on Hedera
   ✓ settled — tx 0.0.7162784@1785448933.726761986

7. Independent confirmation on a public Mirror Node
   ✓ confirmed in consensus at 1785448939.705625598
     payer 0.0.9847870 · payee 0.0.9847867 · amount 0.5 HBAR

8. Negative — replaying the settled payment must fail
   ✓ replay rejected — DUPLICATE_TRANSACTION

9. Confirm value actually moved
   ✓ payee credited 0.5 HBAR
   ✓ agent debited exactly the price — facilitator covered the network fee
```

**Settled payment:** [`0.0.7162784@1785448933.726761986`](https://hashscan.io/testnet/transaction/0.0.7162784@1785448933.726761986)

Two details worth pointing at:

- **The agent is debited exactly the price — no gas.** The transaction id belongs to `0.0.7162784`, the *facilitator*, because it is the fee payer. A paying agent therefore needs the payment asset and nothing else. This is the property the Hedera x402 scheme gives you that the EVM version does not.
- **Replay fails at the network, not just in our database.** The signed transaction carries its own id, so resubmitting it is rejected by consensus with `DUPLICATE_TRANSACTION` before it reaches our replay guard.

---

## Settlement primitives — 15/15

```
1. Money maths for the configured asset
   ✓ decimals resolved to 8 for HBAR
   ✓ "1" → 100000000 atomic units
   ✓ round-trips "0.5" exactly
   ✓ fee split is lossless — 0.44 payout + 0.06 fee
   ✓ fee is exactly 1200 bps

2. Account id handling
   ✓ accepts 0.0.12345 · rejects an EVM address · trims whitespace
   ✓ HashScan ↔ mirror transaction-id conversion both directions

3. Native payout to an oracle account
   ✓ payout settled — 0.0.9847867@1785448990.259653822
   ✓ oracle credited exactly 0.44 HBAR

4. Anchor a proof to Hedera Consensus Service
   ✓ anchored at sequence #1 — 0.0.9847867@1785448996.698445465

5. Read the anchor back from a public Mirror Node
   ✓ anchor readable from public mirror at consensus 1785449002.286020784
   ✓ anchored payload matches what we wrote
```

**Oracle payout:** [`0.0.9847867@1785448990.259653822`](https://hashscan.io/testnet/transaction/0.0.9847867@1785448990.259653822)
**Proof anchor:** [`0.0.9847867@1785448996.698445465`](https://hashscan.io/testnet/transaction/0.0.9847867@1785448996.698445465)
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
    "amount": "50000000",
    "asset": "0.0.0",
    "payTo": "0.0.9847867",
    "maxTimeoutSeconds": 180,
    "extra": { "symbol": "HBAR", "decimals": 8, "feePayer": "0.0.7162784" }
  }]
}
```

---

## Two bugs these tests caught

Worth recording, because both were silent and both would have broken the demo.

**1. Mirror Node confirmation read the wrong record.**
One Hedera transaction id can map to *several* mirror records — the top-level `CRYPTOTRANSFER` plus children like the `CRYPTOUPDATEACCOUNT` emitted when a payer's account was auto-created from an EVM alias. The child is frequently returned **first** and carries an empty transfer list. Reading `transactions[0]` therefore found no payment and reported every genuine payment as unconfirmed. Fixed by scanning all successful records and summing credits to the payee.

The same fix corrected payer attribution: the largest debit is the *fee payer*, not the sender, so the payer is now matched on the exact transfer amount.

**2. Decimals were hardcoded to 6.**
`toUnits` assumed a 6-decimal asset. HBAR is quoted in tinybars at 8, so a task priced `"2.00"` would have charged **0.02 HBAR** — a 100× underpayment, silently. `lib/money.ts` now derives its scale from the configured asset.

---

## Not covered here

The task lifecycle (claim → submit proof → notary → payout) is exercised by `pnpm e2e`, which needs a running server with Supabase and Groq configured. The on-chain half of that flow — payment in, payout out, proof anchored — is what the two suites above prove.
