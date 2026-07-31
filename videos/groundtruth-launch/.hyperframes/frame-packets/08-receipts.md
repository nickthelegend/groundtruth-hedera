# Frame packet: 08-receipts

## Project inputs

- Project: /Volumes/Extreme SSD/Projects/groundtruth/videos/groundtruth-launch
- Design tokens: /Volumes/Extreme SSD/Projects/groundtruth/videos/groundtruth-launch/frame.md
- RULES_DIR: /Users/jaibajrang/.claude/skills/hyperframes-animation/rules

## Assigned storyboard block

## Frame 8 — Real transactions

- scene: Two HashScan ids and the HCS topic stack in, each with its green verified tick
- voiceover: "Payment. Payout. Proof anchored to consensus. Two hundred and forty-three checks pass — a hundred and eleven of them against live infrastructure."
- duration: 9.28s
- transition_in: zoom-through
- status: outline
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

## Selected motion rule: svg-path-draw

---
name: svg-path-draw
description: Animate SVG paths drawing progressively using stroke-dasharray and stroke-dashoffset.
metadata:
  tags: svg, stroke, draw, path, reveal, icon, vector
---

# SVG Path Draw

Reveals an SVG shape by animating its stroke as if a pen were tracing it. Two stroke properties together: **`stroke-dasharray = <pathLength>`** makes the entire path one dash; **`stroke-dashoffset`** starts at the path length (dash shifted fully out of view → invisible) and tweens to `0` (fully drawn). The length comes from the DOM API `path.getTotalLength()` — measured, never guessed.

Works on anything with a stroke: `<path>`, `<circle>`, `<rect>`, `<line>`, `<polyline>`, `<polygon>`, `<ellipse>`.

## Recipe

```html
<!-- inside a standard scene clip -->
<svg class="logo-mark" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <path id="bar-left" d="M 60 40 L 60 160" />
  <path id="bar-right" d="M 140 40 L 140 160" />
  <path id="bar-mid" d="M 60 100 L 140 100" />
</svg>
```

```css
.logo-mark path {
  fill: none; /* outline-only draw — a fill would appear immediately and ruin the reveal */
  stroke: {accentColor};
  stroke-width: 12;
  stroke-linecap: round; /* softer endpoints */
  stroke-linejoin: round;
}
```

```js
// Setup: measure each path and set its dash pattern. Real measured geometry, not a magic number.
document.querySelectorAll(".logo-mark path").forEach((p) => {
  const len = p.getTotalLength();
  p.style.strokeDasharray = `${len}`;
  p.style.strokeDashoffset = `${len}`;
});

// Stagger draws so the eye reads continuous motion — each segment starts at
// ~70-80% of the previous segment's duration, before it finishes.
tl.to(
  "#bar-left",
  { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "power2.out" },
  SEG_1_START,
);
tl.to(
  "#bar-right",
  { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "power2.out" },
  SEG_2_START,
);
tl.to(
  "#bar-mid",
  { strokeDashoffset: 0, duration: FINAL_SEGMENT_DUR, ease: "power2.out" },
  SEG_3_START,
);

// Companion wordmark fades in only after the last stroke settles.
tl.to(
  ".brand-line",
  { opacity: 1, duration: BRAND_FADE_DUR, ease: "power1.out" },
  BRAND_FADE_START,
);
```

## Variations

- **Ring starting at 12 o'clock** — `<circle>` / `<rect>` strokes start at 3 o'clock by default; rotate the element `-90deg` so a progress ring draws from the top:

```html
<circle
  cx="100"
  cy="100"
  r="60"
  id="ring"
  style="transform-origin: 100px 100px; transform: rotate(-90deg)"
/>
```

- **Linear (constant-speed) draw** — `ease: "none"` for a steady-rate "real pen" trace.
- **Draw then fill** — for filled shapes, tween `fillOpacity: 0 → 1` AFTER the stroke completes (requires `fill-opacity: 0` initially and a real `fill` in CSS):

```js
tl.to(
  "#path",
  { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "power2.out" },
  SEG_1_START,
);
tl.to(
  "#path",
  { fillOpacity: 1, duration: FILL_FADE_DUR, ease: "power1.out" },
  SEG_1_START + SEGMENT_DRAW_DUR,
);
```

## Values

| token             | range                                   | notes                                                                                              |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SEGMENT_DRAW_DUR  | 0.3–0.8s                                | fast snap vs deliberate pen trace; >~1s feels sluggish for a logo reveal                           |
| FINAL_SEGMENT_DUR | 60–80% of SEGMENT_DRAW_DUR              | proportional to segment length — a short connector at full duration reads slower than its siblings |
| SEG_N_START       | previous start + 70–80% of its duration | reads as continuous motion, not N isolated animations                                              |
| SEG_1_START       | 0–0.4s                                  | a small ~0.2s lead-in lets the viewer settle before motion                                         |
| BRAND_FADE_START  | ≥ last stroke end (+ ~0.2s beat)        | earlier and the wordmark competes with the draw                                                    |
| BRAND_FADE_DUR    | 0.3–0.8s                                | snap (urgent) vs glide (premium)                                                                   |

Ease families are discrete choices: **stroke draws** use `power2.out` (a hand lifting at end of stroke) or `none` for constant speed — never `back.out` / `elastic.out` (pens don't bounce). **Fades** use `power1.out`.

## Critical Constraints

- **`fill: none`** for outline-only draws — otherwise the fill appears immediately.
- **Dasharray/dashoffset = the measured `getTotalLength()`**, set at setup; requires the SVG in the DOM (inline SVG is fine; a loaded `<image>` SVG is not).
- **Complex paths**: if `getTotalLength()` looks wrong, overestimate slightly (`len * 1.05`) — too large is invisible at animation start; too small clips the end.
- **Stagger multi-path draws at ~70–80%** of the previous segment's duration.

## See also

`svg-icon-enrichment` (internal parts animate after the outline draws) · `counting-dynamic-scale` (stroke draws an icon while a number counts up) · `hacker-flip-3d` (logo draws, wordmark decodes beneath).
