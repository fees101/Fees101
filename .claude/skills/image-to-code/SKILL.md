---
name: image-to-code
description: Turn a design reference image or mockup into accurate code by measuring it precisely rather than approximating from memory. Use whenever implementing a UI from a screenshot, exported design canvas, or mockup file (including this repo's .dc.html design canvases) — before writing any component code.
---

# Image to code

The goal is replication, not impression. A screen that's "close enough by
eye" is not done — this repo's own redesign standard is explicit about
this ("replicate not approximate": read exact inline styles and match every
number, not eyeball it).

## Before writing any code

1. **Read the image/canvas fully first.** If it's an `.dc.html` design
   canvas (this repo's format for App Shell / screen mockups), open and
   read the actual file/inline styles — colors, spacing, and type sizes are
   often literally in the markup, not something to estimate visually from
   a screenshot of it.
2. **Extract exact values before writing a single line of the target
   component:**
   - Spacing: measure gaps/padding in pixels (grid gaps, panel padding,
     row heights) — don't round "looks like about 24px" up or down without
     checking.
   - Type scale: exact font sizes, weights, and line-heights per text
     role (heading, body, label, figure) — not "roughly similar."
   - Color: exact hex/token values. In this repo, cross-check any color
     you read off an image against `docs/design.md`'s token list — a mockup
     color that's "close to" `--color-ledger` should resolve to the actual
     token, not a new similar-but-different hex.
   - Layout structure: exact grid ratios (this repo uses specific ratios
     like `1.6fr/1fr`, not arbitrary column splits) and breakpoints.
3. **If a value genuinely can't be read precisely** (compressed screenshot,
   ambiguous edge, occluded element) — say so explicitly and pick the
   nearest value from this repo's existing token system (`docs/design.md`)
   rather than silently guessing a one-off number. A flagged approximation
   is fine; a silent one is a bug that compounds across screens.

## While building

- Build against the real data/components this repo already has, not
  placeholder content that hides real wrapping/overflow/edge-case behavior.
- Match the House style rules from `docs/design.md` (zero radius, borders not
  shadows, no spinners, Archivo only) even where the mockup source might
  imply otherwise — `docs/design.md` is the system of record; a mockup is a
  target for layout/spacing/content, not license to reintroduce a rounded
  corner.

## Verify by rendering, not by reading the code back

1. Run the actual app (see the `run` skill / `playwright-cli` skill for
   this repo's pattern) and navigate to the real, live rendered result.
2. Screenshot it.
3. Put the source image and the live screenshot side by side and compare
   directly — spacing, alignment, type size, color — rather than
   re-reading your own JSX/CSS and trusting it matches. Code that looks
   right can still render wrong (a missed Tailwind class, a WASM-build
   safelist gap already documented in this repo, an unapplied CSS
   variable).
4. Iterate: fix concrete, named discrepancies ("the row height is 8px
   short," "the label uses neutral-600 instead of neutral-700") — not
   vague re-styling passes.
5. Only report the work done once the side-by-side comparison has actually
   been looked at, not once the code compiles/typechecks.

## Flag, don't guess

Any place a value couldn't be read precisely from the source — say so in
the final report, and name what was substituted instead and why. Silent
guessing on a design system this precise (zero-radius, exact grid ratios,
tabular-numeral alignment) is how small drifts accumulate into a redesign
that looks "almost right" everywhere and exactly right nowhere.
