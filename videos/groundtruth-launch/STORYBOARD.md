---
format: 1920x1080
duration: 60s
mode: autonomous
message: "Your AI can read the internet. It still can't look outside — so GroundTruth pays a human to, over x402, settled on Hedera."
arc: Hook → Pain → Product intro → Mechanism → Proof → CTA
audience: Hedera x402 bounty judges and agent developers
music: minimal electronic premium fintech underscore, restrained, confident, no drop
---

## Video direction

**The invariants, written once. Every frame obeys these.**

- **Ground.** Every frame is `#04060A` full-bleed, laid on its own full-duration background clip (never on `#root`). A dot grid at `rgba(13,204,255,0.10)`, 34px pitch, sits on top of the ground with a soft radial mask fading toward the edges — the same grid the product's own hero uses. The grid is always present and never animates except where a Scene says so.
- **One accent, and it means something.** `#0DCCFF` marks exactly one thing per window: the element the voiceover is naming right now. When the VO moves on, the previous accent drops to `#7A9AB5`. Never two cyan highlights competing in the same window.
- **Green is a state, not a colour.** `#00E87A` appears in only two places in the whole film: the notary verdict in Frame 7 and the three verified ticks in Frame 8. If a frame reaches for green as decoration, it is wrong.
- **Type roles.** Display lines: Bricolage Grotesque 800, tight negative tracking. Any account id, transaction id, JSON, endpoint or code: JetBrains Mono. Body/supporting copy: Inter. Never set an id in a proportional face — the mono IS the credibility signal.
- **Hairlines only.** `1px #1C2A3A` borders. No filled cards, no drop shadows, no gradient fills. The one permitted glow is `0 0 34px rgba(13,204,255,0.32)` behind an accent element at its moment of arrival, and it decays.
- **Motion doctrine.** Everything settles on `power3`. Nothing bounces. Entrances travel ≤ 40px and resolve; the frame then HOLDS. Held beats are deliberate — Frames 1, 6b and 10 are almost entirely still, and Frame 8 ends still. Prefer stillness to invented drift.
- **Never show:** browser chrome, scrollbars, nav bars, cursors, floating particles, lens flare, purple-blue "AI" gradients, or a decorative shape standing in for a real asset. Every number and id on screen is real.
- **Caption keep-out.** Karaoke captions occupy the bottom 180px. No content below y=900.

---

## Frame 1 — Cold open

- scene: Dot grid breathes up on near-black; a single mono caret blinks, then the hedera:testnet chip fades in bottom-left
- voiceover: ""
- duration: 4.8s
- transition_in: cut
- status: animated
- src: compositions/frames/01-cold-open.html
- type: branding
- persuasion: Restraint as a status signal
- beat: anticipation
- blueprint: titlecard-reveal (Adapt)
- focal: (typography only)
- roles: (no captured asset in this beat)
- sfx:
- asset_candidates:

Adapt: keep the near-still title prelude, but there is no title yet — the "card" is an empty command line. The signature stillness carries it.

Scene 1 (0.0–1.6s): black. The dot grid fades up from 0 to full across the whole canvas via `ambient-glow-bloom`, centre-out, very slow. Nothing else. Full-bleed, 1 depth layer.
Scene 2 (1.6–3.0s): a single JetBrains Mono caret block (cyan) appears dead-centre and begins a steady 1.1s blink. Centered, deliberately tiny against all that space; the emptiness is the composition.
Scene 3 (3.0–5.0s): a hairline chip fades in lower-left reading `hedera:testnet` in mono `#7A9AB5`, with a small `#0DCCFF` dot at its left. Caret keeps blinking. Everything else HOLDS dead still. Rule-of-thirds anchor, 2 depth layers.

narrativeRole: Give the piece a floor to start from. Silence buys the first spoken line its weight.
keyMessage: This is a serious, deployed thing.

## Frame 2 — The blind spot

- scene: One line lands, then its last word swaps — "read the internet" becomes "look outside"
- voiceover: "Your AI has read the entire internet. It still can't tell you if this shop is open."
- duration: 5.696s
- transition_in: cut
- status: animated
- src: compositions/frames/02-blind-spot.html
- type: hook
- persuasion: Pain validation via negative contrast
- beat: curiosity + recognition
- blueprint: kinetic-type-beats (Reproduce)
- focal: (typography only)
- roles: (no captured asset in this beat)
- sfx: click-soft
- asset_candidates:

Scene 1 (0.0–1.5s): the caret from Frame 1 is still blinking centre; on "Your AI has read", the line `Your AI has read the entire internet.` types on in Bricolage 800 at display scale, left-set on a rule-of-thirds column, `#EDF2F7`, via `discrete-text-sequence` per phrase (never per letter). The caret rides the end of the line. Grid holds. ~55% of frame.
Scene 2 (1.5–3.2s): the line completes and settles. Held — nothing moves but the grid and the caret. This pause is the setup for the turn.
Scene 3 (3.2–4.6s): on "It still can't tell you", a second line drops in beneath the first, smaller, `#7A9AB5`: `It still can't tell you if this shop is open.` The word **open** arrives in `#0DCCFF` via `asr-keyword-glow` — the accent's first appearance in the film, glow blooming once and decaying. Two-line stack, asymmetric 60/40 with the right 40% left empty.
Scene 4 (4.6–5.696s): HOLD. The first line dims to `#3A5269`; the cyan **open** stays lit. The frame reads as a question with the answer missing.

narrativeRole: Open on the gap the viewer already feels. No product, no logo, no claim.
keyMessage: Knowing everything is not the same as seeing anything.

## Frame 3 — The call

- scene: An agent's MCP call types itself, hits the endpoint, and the server answers HTTP 402
- voiceover: "So it makes one call. And the server answers — payment required."
- duration: 4.309s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/03-the-call.html
- type: product_intro
- persuasion: Show-don't-tell proof
- beat: intrigue
- blueprint: prompt-type-submit-generate (Adapt)
- focal: (typography only)
- roles: (no captured asset in this beat)
- sfx: key-press
- asset_candidates:

Adapt: keep the type→submit→response signature, but the "prompt" is an HTTP request and the "generation" is a status code. No composer UI, no send button — a terminal line and a response.

Scene 1 (0.0–1.4s): a hairline-bordered code surface (`#0A1119`) slides up 32px into the upper two-thirds and settles. Inside, one mono line types live on the spoken cue "one call": `GET /api/v1/human-do`, with the path segment in `#0DCCFF`. `discrete-text-sequence`. Centered surface, ~60% of frame, 3 depth layers (grid / surface / text).
Scene 2 (1.4–2.6s): a beat of nothing — the caret blinks at the end of the request. Deliberate dead air while the VO says "And the server answers". Held.
Scene 3 (2.6–4.309s): the response slams in below the request on "payment required" — `HTTP/1.1 402 Payment Required` — via `kinetic-beat-slam`, the numerals **402** at roughly twice the surrounding size in `#0DCCFF` with a single glow bloom that decays. The request line above dims to `#3A5269`. HOLD on the 402.

narrativeRole: Introduce GroundTruth by its interface, not its description. The 402 IS the product.
keyMessage: Paying for real-world work is one HTTP round-trip.

## Frame 4 — What the 402 actually says

- scene: The challenge JSON holds; four fields highlight in turn — scheme, network, asset, feePayer
- voiceover: "Exact scheme. Hedera testnet. USDC. And a fee payer — so the agent spends no gas at all."
- duration: 7.36s
- transition_in: crossfade
- status: animated
- src: compositions/frames/04-challenge.html
- type: key_feature
- persuasion: Feature-to-benefit translation
- beat: clarity
- blueprint: panel-edit-live-sync (Adapt)
- focal: (typography only)
- roles: (no captured asset in this beat)
- sfx: click-soft
- asset_candidates:

Adapt: keep the cause→effect couplet signature — but the "gesture" is the VO naming a field and the "live mirror" is a plain-English gloss appearing in a right rail. Four couplets, one per cue.

Scene 1 (0.0–1.1s): the real challenge body fades up as formatted JSON on `#0A1119`, occupying the left 60%, mono, keys `#7A9AB5` and values `#EDF2F7`. It is on screen complete and dim — this frame is about reading it, not building it. Right 40% empty. Asymmetric 60/40, 3 depth layers.
Scene 2 (1.1–2.2s): on "Exact scheme", the `"scheme": "exact"` line lifts to full white, a cyan hairline bar draws down its left edge via `svg-path-draw`, and the gloss `the exact-amount scheme` types into the right rail in Inter `#7A9AB5`.
Scene 3 (2.2–3.3s): the previous highlight drops to `#7A9AB5`; `"network": "hedera:testnet"` takes the accent the same way; rail gloss swaps to `settles on Hedera`.
Scene 4 (3.3–4.4s): accent moves to `"asset": "0.0.429274"` — the value takes the cyan, not the key; rail reads `Circle USDC`.
Scene 5 (4.4–6.315s): accent lands on `"feePayer": "0.0.7162784"` and STAYS. The rail gloss lands as the payoff, larger than the others: `the facilitator pays the fee — the agent spends no gas`. A single `ambient-glow-bloom` behind the feePayer line, decaying. HOLD to the end with that one line lit.

narrativeRole: The one technical beat that earns credibility with this audience.
keyMessage: The facilitator pays the fee, so the agent only needs USDC.

## Frame 5 — Agent to treasury to human

- scene: Three account chips left to right; value travels the hairline between them, twice
- voiceover: "The agent signs. Hedera settles. A human goes and looks — and gets paid."
- duration: 5.312s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-flow.html
- type: key_feature
- persuasion: Rule of three
- beat: clarity + inevitability
- blueprint: spatial-pan-stations (Reproduce)
- focal: assets/flow-dark.png
- roles: flow-dark.png = background (dim ~35%, blurred, behind the station rail)
- sfx: whoosh-short
- asset_candidates: assets/flow-dark.png — the product's own five-step strip, as the station rail
- handoff_out: three station chips on a horizontal rail at y=520 — chip 1 x=420, chip 2 x=960, chip 3 x=1500, each 260x88, opacity 1, scale 1; chip 3 accent `#0DCCFF`, chips 1–2 `#7A9AB5`; rail 1px `#1C2A3A` spanning x=300→1620; cyan value dot resting at chip 3 centre, opacity 1, motionless

Scene 1 (0.0–1.3s): the product's own five-step strip sits full-width behind, dimmed to ~35% and softly blurred — recognisable as the real page, never competing. Over it, a single 1px `#1C2A3A` rail draws left-to-right across the middle third via `svg-path-draw`. Full-width strip, 3 depth layers.
Scene 2 (1.3–2.3s): on "The agent signs", station 1 pops onto the rail at the left third — a hairline chip, mono label `agent`, `spring-pop-entrance` (short, no overshoot). It takes the cyan.
Scene 3 (2.3–3.4s): on "Hedera settles", a small cyan value dot detaches from station 1 and travels the rail to station 2, which pops in at centre labelled `Hedera` — `motion-blur-streak` on the dot's travel, settling on `power3`. Station 1 drops to `#7A9AB5`; station 2 takes the cyan.
Scene 4 (3.4–5.205s): on "A human goes and looks — and gets paid", the dot travels again to station 3 at the right third, which pops in labelled `oracle`. On arrival the dot lands and the chip's border flashes once. HOLD — three stations placed, only the last in cyan, the rail still.

narrativeRole: The mechanism, in one pass, as motion rather than a diagram.
keyMessage: Three real accounts, one direction of travel.

## Frame 6 — Three real accounts

- scene: Agent / treasury / oracle chips with their real 0.0.x ids; a value dot travels agent to treasury to oracle
- voiceover: "Three real accounts. Agent, treasury, oracle. You can open every hop yourself."
- duration: 5.5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/06-accounts.html
- type: social_proof
- persuasion: Verifiability as proof
- beat: trust
- blueprint: spatial-pan-stations (Adapt)
- focal: (typography only)
- roles: (no captured asset in this beat)
- sfx: click-soft
- asset_candidates:
- handoff_in: three station chips already in place at y=520 — chip 1 x=420, chip 2 x=960, chip 3 x=1500, each 260x88, opacity 1, scale 1; chip 3 accent `#0DCCFF`, chips 1–2 `#7A9AB5`; rail 1px `#1C2A3A` x=300→1620; cyan value dot at chip 3 centre, opacity 1, motionless. Nothing re-enters; the chips GROW from here.
- handoff_out: same three chips, now 260x148 (grown to hold their ids), y=520; all three ids visible in mono; chip 3 accent `#0DCCFF`, chips 1–2 `#7A9AB5`; amounts `0.50 USDC` at x=690 and `0.44 USDC` at x=1230 on the rail, opacity 1; `hashscan.io/testnet` line at y=700, opacity 1; value dot at chip 3 centre, motionless

Adapt: same station rail as Frame 5 so the two beats rhyme — but the abstractions resolve into REAL ids. The signature travel is kept; what changes is that each station now carries a verifiable 0.0.x number, and the amounts appear.

Scene 1 (0.0–1.2s): the three stations are already in position (handoff), still in their end state. On "Three real accounts", each chip GROWS downward to reveal a second mono line beneath its label — the real id — via `scale-swap-transition` on height only: `agent 0.0.9847870` · `treasury 0.0.9847867` · `oracle 0.0.9860142`. Full-width strip.
Scene 2 (1.2–2.4s): on "Agent," the left chip takes the cyan and its id brightens to `#EDF2F7`.
Scene 3 (2.4–3.2s): on "treasury," accent steps to the centre chip; a mono amount `0.50 USDC` fades in on the rail between chip 1 and 2.
Scene 4 (3.2–4.3s): on "oracle," accent steps to the right chip; a second amount `0.44 USDC` fades in on the rail between chip 2 and 3, with a smaller `−12% fee` beneath it in `#3A5269`.
Scene 5 (4.3–5.5s): on "You can open every hop yourself", a mono line fades up under the whole rail: `hashscan.io/testnet` in `#7A9AB5`. HOLD, everything still.

narrativeRole: Kill the "one wallet paying itself" suspicion before anyone forms it.
keyMessage: Three distinct accounts, every hop openable.

## Frame 6b — Held breath

- scene: The three account chips hold; the value dot completes its second hop and settles on the oracle chip
- voiceover: ""
- duration: 2.4s
- transition_in: cut
- status: animated
- src: compositions/frames/06b-held.html
- type: benefit_highlight
- persuasion: Let the proof sit
- beat: settle
- blueprint: titlecard-reveal (Adapt)
- focal: (typography only)
- roles: (no captured asset in this beat)
- sfx:
- asset_candidates:
- handoff_in: identical to Frame 6's end state — three chips 260x148 at y=520 (x=420/960/1500), all ids visible, chip 3 accent `#0DCCFF`, chips 1–2 `#7A9AB5`, amounts at x=690 and x=1230, `hashscan.io/testnet` at y=700, value dot at chip 3 centre, opacity 1. Nothing re-enters and nothing repositions.

Adapt: there is no new card and no new copy. The whole "reveal" is one dot settling and the frame breathing. Deliberately the stillest beat in the film.

Scene 1 (0.0–0.9s): identical composition to Frame 6's end state (handoff — nothing re-enters). The chip 3 hairline border flashes once to `#0DCCFF` and decays back to `#1C2A3A` as the value dot makes one final settle of a few pixels.
Scene 2 (0.9–2.4s): absolute HOLD. Nothing animates except the dot grid's slow ambient shimmer at very low amplitude. No text enters, no camera move. The silence is the point.

narrativeRole: One breath after the money lands, before the objection beat. The pause is the confidence.
keyMessage: It completed.

## Frame 7 — The notary reads the code

- scene: A proof photo lands; the freshness code lifts out of it; the verdict resolves to accept
- voiceover: "Every task carries a code. The proof has to show it — so a stock photo can't pass."
- duration: 5.312s
- transition_in: crossfade
- status: animated
- src: compositions/frames/07-notary.html
- type: key_feature
- persuasion: Show-don't-tell proof
- beat: skepticism → trust
- blueprint: device-surface-showcase (Adapt)
- focal: assets/board-dark.png
- roles: board-dark.png = background (dim ~30%, blurred); the proof card = cutout
- sfx: click-soft
- asset_candidates: assets/board-dark.png — the real mission board, as the surface the verdict returns to

Adapt: the "device" is the mission board and the "flow" is one verification. Keep the inside-its-real-surface framing; the hero object is a proof card composited over it.

Scene 1 (0.0–1.2s): the real mission board sits behind at ~30%, blurred. A proof card slides up 28px into the left 55% and settles — a dark plate showing a simple rendered shopfront with an `OPEN` sign and, on a white note at its foot, the mono code `RR86NF`. Asymmetric 55/45, 3 depth layers.
Scene 2 (1.2–2.4s): on "Every task carries a code", the code `RR86NF` lifts OUT of the card — duplicating up and right into the empty 45%, scaling up, landing as a large mono token in `#0DCCFF` with one glow bloom. `card-morph-anchor` between the in-card code and the lifted token.
Scene 3 (2.4–3.7s): on "The proof has to show it", a hairline connector draws from the lifted token back down to the code's position on the card via `svg-path-draw`, and a mono label types beside it: `freshness code · per task`.
Scene 4 (3.7–5.312s): on "so a stock photo can't pass", the verdict resolves in the right column: `accept` in `#00E87A` — the film's first green — preceded by a small tick that draws on with `svg-path-draw`, and beneath it in `#7A9AB5` the real notary sentence, truncated: `required code 'RR86NF' clearly visible`. HOLD.

narrativeRole: Answer the obvious objection — how do you know the human actually did it?
keyMessage: Proof means verified content, not a decodable JPEG.

## Frame 8 — Real transactions

- scene: Two HashScan ids and the HCS topic stack in, each with its green verified tick
- voiceover: "Payment. Payout. Proof anchored to consensus. Two hundred and forty-three checks pass — a hundred and eleven of them against live infrastructure."
- duration: 9.28s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/08-receipts.html
- type: social_proof
- persuasion: Statistical proof
- beat: confidence
- blueprint: dataviz-countup (Adapt)
- focal: assets/pulse-dark.png
- roles: pulse-dark.png = background (dim ~25%, blurred)
- sfx: click-soft
- asset_candidates: assets/pulse-dark.png — the live network stats page

Adapt: keep the count-up signature for the closing numbers, but lead with three literal receipts first — the ids are stronger evidence than any statistic, so the stat is the chaser, not the hook. This is the longest frame in the film; its reveals must spread across all 9.3s.

Scene 1 (0.0–1.4s): the live stats page sits behind at ~25%, blurred. Three empty hairline rows draw on, stacked centre, left-aligned, each with space for a label and a mono id. Centered, ~70% of frame, 3 depth layers.
Scene 2 (1.4–2.6s): on "Payment.", row 1 fills — label `payment` in Inter `#7A9AB5`, then the real id `0.0.7162784@1785525175.463617976` types in mono `#EDF2F7`, then a `#00E87A` tick draws on at the right via `svg-path-draw`. Row takes the cyan left-edge bar.
Scene 3 (2.6–3.8s): on "Payout.", row 2 fills identically with `0.0.9847867@1785525201.407410064`. Row 1's accent bar drops to `#1C2A3A`; its green tick stays.
Scene 4 (3.8–5.4s): on "Proof anchored to consensus.", row 3 fills with `topic 0.0.9847942` and a third tick. All three ticks now lit green; all three ids mono and readable.
Scene 5 (5.4–7.4s): on "Two hundred and forty-three checks pass", the three rows compress upward and dim to `#3A5269`, and a large number counts 0→**243** dead-centre beneath them in Bricolage 800 via `count-up`, in `#0DCCFF`, with `assertions passing` in Inter beneath it.
Scene 6 (7.4–9.28s): on "a hundred and eleven of them against live infrastructure", a second, smaller count-up runs to **111** beside the first, labelled `against live infrastructure`, in `#EDF2F7`. Then HOLD — no drift, no push. Both numbers still, three green ticks above.

narrativeRole: The credibility beat. Nothing here is a mockup and the ids prove it.
keyMessage: Every claim resolves to a transaction you can open.

## Frame 9 — Live on Hedera testnet

- scene: The pin-and-check mark draws on, the URL sets beneath it, the testnet chip holds
- voiceover: "GroundTruth. Deployed and live on Hedera testnet."
- duration: 3.563s
- transition_in: crossfade
- status: animated
- src: compositions/frames/09-cta.html
- type: cta
- persuasion: Risk reversal — it already exists, go look
- beat: resolve
- blueprint: logo-assemble-lockup (Reproduce)
- focal: assets/logo-d52442ef.svg
- roles: logo-d52442ef.svg = cutout (the hero; dead-centre, drawn on)
- sfx: impact-bass-1
- asset_candidates: assets/logo-d52442ef.svg — the cyan pin-and-check brand mark
- handoff_out: brand mark centred at x=960, y=430, 150px tall, opacity 1, scale 1, motionless; wordmark `GroundTruth` Bricolage 800 centred at y=580, opacity 1; URL `groundtruth-hedera.vercel.app` JetBrains Mono `#0DCCFF` centred at y=660, opacity 1; `hedera:testnet` chip lower-left at x=120, y=843 (lifted clear of the 180px caption keep-out), opacity 1; dot grid at full opacity

Scene 1 (0.0–1.3s): everything from Frame 8 clears off the edges. The brand mark assembles dead-centre: first its two ground-line strokes draw in from left and right via `svg-path-draw`, then the cyan pin body scales up from 0.9 on `power3`, then the check inside it draws on last in `#04060A`. Centered, 2 depth layers.
Scene 2 (1.3–2.3s): on "GroundTruth.", the wordmark sets beneath the pin in Bricolage 800, `#EDF2F7`, arriving as one piece — no per-letter animation.
Scene 3 (2.3–3.563s): on "Deployed and live on Hedera testnet", the URL `groundtruth-hedera.vercel.app` fades up beneath the lockup in JetBrains Mono `#0DCCFF`, and the `hedera:testnet` chip from Frame 1 returns lower-left — closing the loop the cold open opened. A single `ambient-glow-bloom` behind the mark, decaying. HOLD.

narrativeRole: Land the name, the state, and the address. Nothing else.
keyMessage: It is not a concept. It is deployed.

## Frame 10 — End hold

- scene: The lockup holds dead still; only the caret in the URL blinks. Grid fades a touch.
- voiceover: ""
- duration: 5.0s
- transition_in: cut
- status: animated
- src: compositions/frames/10-end-hold.html
- type: branding
- persuasion: Confidence through stillness
- beat: resolve
- blueprint: titlecard-reveal (Adapt)
- focal: assets/logo-d52442ef.svg
- roles: logo-d52442ef.svg = cutout (unchanged from Frame 9 — pure handoff)
- sfx:
- asset_candidates: assets/logo-d52442ef.svg — the cyan pin-and-check brand mark
- handoff_in: identical to Frame 9's end state — mark at x=960, y=430, 150px tall, opacity 1, scale 1; wordmark at y=580; URL at y=660; `hedera:testnet` chip at x=120, y=843; grid at full opacity. Nothing re-enters, nothing repositions, nothing scales.

Adapt: no reveal at all. This frame exists so the address stays legible long enough to be read and typed. The only motion permitted is a blinking caret.

Scene 1 (0.0–5.0s): identical to Frame 9's end state (handoff). A mono caret blinks at the end of the URL at the same 1.1s cadence as Frame 1's. The dot grid eases down ~30% in opacity across the full 5s, so the frame quietly darkens toward the cut. Everything else is dead still for the entire duration.

narrativeRole: Let the address stay on screen long enough to be read and typed.
keyMessage: groundtruth-hedera.vercel.app
