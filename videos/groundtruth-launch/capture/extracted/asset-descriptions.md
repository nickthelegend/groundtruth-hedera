# Asset Descriptions

⚠️  GEMINI_API_KEY not set — descriptions below are catalog-derived (alt text, headings, section context, filename) instead of Vision-generated. To get richer Vision descriptions on the next capture, set GEMINI_API_KEY (or GOOGLE_API_KEY) and re-run.

The `logo-<hash>.svg` filename prefix is a structural hint (DOM said this SVG was inside a `<header>`, home-link `<a>`, or had an aria-label matching the page brand). To pick the actual brand logo without Vision, open the `logo-*` candidates in a previewer or rasterize them with `sharp` before referencing — composing a fake logo ships off-brand in the final video.

- svgs/logo-3a2aa0cd.svg — logo 3a2aa0cd
- svgs/logo-d52442ef.svg — logo d52442ef
- svgs/svg-933ba80e.svg — svg 933ba80e
- svgs/svg-a65b07fd.svg — svg a65b07fd

## Captured dark-theme screens (the product's real UI)

The site defaults to its light theme; these were captured with the app's own
`[data-theme='dark']` active, which is the palette this video uses. Each is a
1920-wide plate of the real deployed product — not a mockup.

- assets/screens/hero-dark.png — landing hero, 1920x1080. "Hire a human. Anywhere on Earth." with cyan underline, the LIVE ON HEDERA TESTNET · X402 chip, three stat tiles (0.50 USDC / ~3s consensus finality / ~$0.001 HTS transfer fee), the wireframe globe with node pins, and the VERIFIED MISSIONS feed with green check rows.
- assets/screens/flow-dark.png — the five-step "From prompt to proof" strip: AI asks → Paid → Human acts → Proof → Payout, as hairline cards with arrows between.
- assets/screens/oracles-dark.png — the "For human oracles" section: claim a mission / do it in the world / get paid on-chain.
- assets/screens/landing-full.png — full-page dark plate of the whole landing page, 1920 wide. Use for a scroll/pan shot.
- assets/screens/board-dark.png — the /tasks mission board in dark: open missions with USDC amounts, the top-oracles table, and the settlement ledger.
- assets/screens/pulse-dark.png — the /pulse network stats page in dark: total tasks, verified tasks, total paid in by agents, active workers.
- assets/svgs/logo-d52442ef.svg — THE brand mark, 30px header logo: a location pin with a check inside, drawn in var(--accent) cyan with ground-line strokes beneath. This is the real GroundTruth logo.
- assets/svgs/logo-3a2aa0cd.svg — the same pin mark at 22px (footer variant), coral-filled — prefer the d52442ef cyan variant on dark.
