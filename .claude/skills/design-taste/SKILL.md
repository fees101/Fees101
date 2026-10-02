---
name: design-taste
description: Pick a deliberate visual point of view before writing any UI in this repo's three apps (fees101-web, fees101-console, fees101-marketing). Use before starting any new screen, component, or redesign pass — not after something already looks generic. Grounds the design in the Modernist system (docs/design.md) and avoids AI-generated-design clichés.
---

# Design taste

Load `/Users/aadedeji/Downloads/Fees101/docs/design.md` before writing any UI in
this repo. It is the house style for all three apps (marketing is mid-
migration onto it as of 2026-09-30) — not a suggestion, a constraint.

## Before writing a line of UI code

1. **Name the point of view out loud, in one sentence**, grounded in what
   this specific screen is for — not a generic template. Fees101 is a
   ledger/instrument product for Nigerian school bursars handling real
   money, not a consumer app or a SaaS dashboard template. "This is a
   money-in ledger, so the ink ground and green-only-when-paid convention
   apply" is a point of view. "Make it look clean and modern" is not.
2. **Check `docs/design.md`'s semantics before picking a single color** for a
   new element: is this money that arrived (ledger green, nowhere else),
   an overdue/attention state (signal red, sparingly), or a
   waiting-on-a-human state (ochre)? If it's none of those, it should
   probably be ink/neutral, not a new color invented for this screen.
3. **Decide the one deliberate accent for this screen**, then stop —
   don't decorate every element. A screen with five different "interesting"
   touches (a gradient here, a shadow there, an icon badge, a colored pill,
   a custom font weight) reads as undirected, not rich. One considered
   choice — an ink-ground panel, a single red rule, a specific data-table
   density — beats five small ones.

## Avoid these AI-generated-design tells specifically

- Generic geometric sans fallback (Inter, Space Grotesk, system-ui as the
  actual rendered face) — this repo has exactly one typeface, Archivo,
  pinned in both `@theme` and `:root` in `globals.css`. If a font renders
  as anything else, that's a bug (the WASM Tailwind font-token bug
  documented in `globals.css`), not a style choice to accept.
- Purple/blue gradients, glassmorphism, soft drop shadows for elevation —
  none of these exist anywhere in the Modernist system. Structure comes
  from 2px borders and rules, never `box-shadow`.
- Emoji as section markers or bullet decoration in the product UI itself
  (emoji do appear in `ROADMAP.md` headers as internal shorthand — that's
  a planning doc convention, not a UI pattern to carry into the app).
- Rounded-everything — every radius token in this system is hardcoded to
  `0px`. A rounded card, button, or input is an immediate tell something
  didn't check `docs/design.md` first.
- Centered-everything / centered hero-card layouts with no real grid — this
  system uses a deliberate two-column workspace grid (`.m-2col`,
  `1.6fr/1fr`) and left-aligned, table-dense layouts. A centered stack of
  cards is the wrong shape for a ledger product.
- Spinners for loading state — this system uses a sweeping 2px ink rule
  (`.m-loading`) or a determinate ink fill instead.

## When in doubt

Look at how the same kind of element already appears elsewhere in the same
app (an existing settings row, an existing status chip, an existing table)
before inventing a new pattern. Consistency with the existing surface beats
a locally "nicer" one-off. If genuinely inventing something new (no
precedent exists yet), run it past the `design-audit` skill before calling
it done.
