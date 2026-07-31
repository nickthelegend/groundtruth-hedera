---
workflow: product-launch-video
flow: automation
storyboard: no
destination: youtube
aspect: 1920x1080
length: 60s
language: en
narration: yes
---

# BRIEF — GroundTruth launch video

## Product

GroundTruth — Reality-as-a-Service on Hedera. AI agents hire human oracles to
verify the physical world, paid per call over x402, settled natively on Hedera.

**Tagline:** *Your AI can read the internet. It still can't look outside.*

## Intent

Sell (promo), but built from the product's **own UI and real data** — captured
screens and real HashScan transaction ids, not invented mockups. No stock
imagery, no generic "AI" visuals.

## Length & destination

60 seconds. 16:9 (YouTube / hackathon submission embed).

## Angle

**"The API call that goes outside."** Positioning taken from the product's own
README: an agent posts a task and pays for it in the same HTTP round-trip; a
human completes it; an AI notary checks the proof actually matches; the oracle
is paid on Hedera. The credibility beat is that every claim is a real, linkable
transaction — that's the differentiator versus a slide-deck demo.

## Narrative

No hard split. One continuous escalation:

1. **0–8s — Hook.** The blind spot. An agent knows everything and can't see a
   shop's front door.
2. **8–18s — Problem → the call.** `human_do` over MCP. The 402 challenge.
3. **18–34s — How it works.** The flow: agent signs → facilitator co-signs as
   fee payer → Hedera settles → Mirror Node confirms → human acts → notary
   verifies → oracle paid. Kinetic, one step per beat.
4. **34–50s — Proof.** Three features that are actually differentiated:
   x402 exact on Hedera (no gas for the payer), the semantic notary reading a
   per-task freshness code, HCS proof anchoring. Real tx ids on screen.
5. **50–60s — CTA.** Live URL + "deployed on Hedera testnet".

## VO_MODE

`restructured` — no verbatim script supplied; narration authored to the beats
above. Calm, assured, low-hype. No superlatives, no "revolutionary".

## Customizations

- Feature the product's own captured screens as the video's assets.
- Show, on screen and legibly: the 402 challenge JSON, a real HashScan
  transaction id, the mission board, and the notary verdict quoting a freshness
  code.
- State explicitly that it is **deployed and live on Hedera testnet**.

## Design system — taken from the app, not invented

Dark theme, lifted verbatim from `app/globals.css` `[data-theme='dark']`:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#04060A` | page ground |
| `--bg-elev` | `#0C1420` | cards / panels |
| `--bg-subtle` | `#0A1119` | insets |
| `--text` | `#EDF2F7` | primary type |
| `--text-muted` | `#7A9AB5` | secondary type |
| `--text-faint` | `#3A5269` | tertiary / grid labels |
| `--border` | `#1C2A3A` | hairlines |
| `--accent` | `#0DCCFF` | **the only accent** — active/keyword/highlight |
| `--accent-ink` | `#04060A` | text on accent blocks |
| `--good` | `#00E87A` | verified/paid state ONLY, sparingly |
| `--grid-dot` | `rgba(13,204,255,0.10)` | hairline dot grid |

**Fonts:** Bricolage Grotesque (display), JetBrains Mono (mono / code / tx ids),
Inter (body). All three are the app's real faces.

**Look:** premium, clean, kinetic. Hairline grid. One accent colour only —
cyan marks the active element, nothing else competes. Green appears exactly
twice, on "verified" and "paid". No gradients-as-decoration, no floating
particles, no glow soup, no fake dashboards.

## Audio

- **BGM:** minimal electronic, premium fintech. Confident, restrained. **5%.**
- **SFX:** transition-only — soft clicks, a low switch on scene changes.
  Nothing per-word, nothing decorative. **20%.**
- **VO:** calm assured narrator, low-hype, unhurried.

## Subtitles

Karaoke. Active word = **dark text (`#04060A`) on a cyan (`#0DCCFF`) block**.
Inactive words in `#EDF2F7`. Never white-on-accent.

## Hard constraints

- No AI slop: no generic robot/brain imagery, no stock-video feel, no
  meaningless particle fields, no lens flares.
- Every number and transaction id on screen must be real and verifiable.
- Render at the end. No approval gate.

## Ground truth for on-screen facts

- Live: `https://groundtruth-hedera.vercel.app`
- Network: `hedera:testnet` · asset Circle USDC `0.0.429274`
- Facilitator fee payer: `0.0.7162784`
- Payment tx: `0.0.7162784@1785525175.463617976`
- Payout tx: `0.0.9847867@1785525201.407410064`
- HCS proof topic: `0.0.9847942`
- Accounts: agent `0.0.9847870` → treasury `0.0.9847867` → oracle `0.0.9860142`
- Price 0.50 USDC · oracle receives 0.44 after a 12% platform fee
- 243 assertions passing, 111 against live infrastructure
