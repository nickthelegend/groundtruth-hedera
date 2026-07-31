# Frame packet: 06-accounts

## Project inputs

- Project: /Volumes/Extreme SSD/Projects/groundtruth/videos/groundtruth-launch
- Design tokens: /Volumes/Extreme SSD/Projects/groundtruth/videos/groundtruth-launch/frame.md
- RULES_DIR: /Users/jaibajrang/.claude/skills/hyperframes-animation/rules

## Assigned storyboard block

## Frame 6 — Three real accounts

- scene: Agent / treasury / oracle chips with their real 0.0.x ids; a value dot travels agent to treasury to oracle
- voiceover: "Three real accounts. Agent, treasury, oracle. You can open every hop yourself."
- duration: 5.5s
- transition_in: crossfade
- status: outline
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

## Selected motion rule: scale-swap-transition

---
name: scale-swap-transition
description: Coordinated shrink-out + spring pop-in morph-like transition between two elements — no SVG path interpolation needed.
metadata:
  tags: transition, morph, scale, swap, spring, pop
---

# Scale-Swap Transition

Simulates a "morph" between two DOM elements by overlapping exit and entrance scale animations. Lighter weight than [card-morph-anchor.md](card-morph-anchor.md) (which morphs container dimensions — use that for SHAPE changes; this rule is for SAME-shape state swaps) and easier than SVG path interpolation.

At a single trigger, two coordinated tweens fire:

1. **Outgoing**: scale `1.0 → EXIT_SCALE` + opacity `1 → 0`, fast `power2.in` (rushing away).
2. **Incoming**: scale `EXIT_SCALE → 1.0` + opacity `0 → 1`, `back.out(BOUNCE_FACTOR)` (arriving with weight).

A small `OVERLAP` window during which both are mid-tween creates the morph illusion; the incoming sits on top via z-index so the outgoing's fade-tail doesn't bleed through.

## Recipe

```html
<!-- Both cards position: absolute; inset: 0 in one fixed-size wrapper — same
     footprint, same transform-origin: 50% 50%. Incoming starts opacity: 0,
     transform: scale(EXIT_SCALE), z-index above the outgoing. -->
<div class="swap-wrap">
  <div class="card outgoing" id="outgoing">{outgoingIcon} {outgoingLabel}</div>
  <div class="card incoming" id="incoming">
    {incomingIcon} {incomingLabel}
    <div class="sub" id="sub">{incomingSubline}</div>
  </div>
</div>
```

```js
// Outgoing: shrink + fade fast
tl.to(
  "#outgoing",
  { scale: EXIT_SCALE, opacity: 0, duration: EXIT_DUR, ease: "power2.in" },
  TRIGGER,
);

// Incoming: pops in with overshoot, starting OVERLAP before the exit finishes
tl.to(
  "#incoming",
  { scale: 1.0, opacity: 1, duration: ENTER_DUR, ease: `back.out(${BOUNCE_FACTOR})` },
  TRIGGER + EXIT_DUR - OVERLAP,
);

// Inner content reveals AFTER the incoming settles
tl.fromTo(
  "#sub",
  { opacity: 0, y: SUB_REVEAL_Y_PX },
  { opacity: 1, y: 0, duration: SUB_REVEAL_DUR, ease: "power3.out" },
  TRIGGER + EXIT_DUR + SUB_REVEAL_DELAY,
);
```

## Variations

- **Delayed inner content reveal** — the classic pattern above: morph the container, then reveal inner text once it settles; the 0.2–0.4 s gap lets the eye land on the new shape before reading.
- **Triple swap (3-state cycle)** — chain A→B→C with triggers `TRIGGER_AB` / `TRIGGER_BC`; each transition is its own tween pair, the previous incoming becoming the next outgoing. State-evolution narratives (early → mid → final labels).
- **Color-shift transition (no scale)** — for a flat morph between same-shape states, drop the scale and keep opacity + a brief background hue tween; less dramatic, more product-UI tone.

## Values

| token            | range                                 | notes                                                                                                  |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TRIGGER          | ≥ outgoing settled + a presence-dwell | the outgoing must "land" before transforming                                                           |
| EXIT_DUR         | 0.3–0.5 s                             |                                                                                                        |
| ENTER_DUR        | 0.45–0.7 s                            | longer than `EXIT_DUR` so the overshoot can settle                                                     |
| OVERLAP          | 0.1–0.2 s                             | >0.3 s both are clearly visible together (no morph); <0.05 s leaves a visible empty gap                |
| EXIT_SCALE       | 0.6–0.8                               | smaller exits feel dramatic but risk reading as "vanish" instead of "morph"                            |
| BOUNCE_FACTOR    | 1.4 soft · 1.8 firm · 2.2 cartoony    |                                                                                                        |
| SUB_REVEAL_DELAY | 0.2–0.4 s                             | reveals during the morph compete with the swap for attention                                           |
| BRAND_REVEAL_AT  | < TRIGGER                             | context (brand, eyebrow) sets the stage early; revealed AT the swap it competes with the headline beat |

## Critical Constraints

- **Incoming z-index ABOVE outgoing** — otherwise the outgoing's fade-tail (opacity 0.3–0.5) bleeds through and double-exposes the frame.
- **Both elements share `transform-origin: 50% 50%`** — different origins make the morph read as one thing teleporting elsewhere.
- **Bouncy ease ONLY on the incoming** — outgoing `power2.in`, incoming `back.out`; reversed, the swap feels mechanical.
- **Both cards `position: absolute; inset: 0`** in the same fixed-size wrapper (sized to fit both states; the wrap never resizes).
- **Don't `display: none` the outgoing** after the fade — leave it at `opacity: 0` so layout doesn't reflow.
- **Inner content reveals after the container settles**; **climax dwell ≥ 1 s** after the final state + subline land.

## See also

`press-release-spring` (a button press TRIGGERS the swap — cause and effect) · `card-morph-anchor` (shape-changing alternative) · `reactive-displacement` (when the replacement should read as a causal collision) · `sine-wave-loop` (idle breathing on the final state).
