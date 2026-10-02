---
name: design-audit
description: Self-audit checklist for a UI surface in this repo before calling it done — checks it against the Modernist design system (docs/design.md), baseline accessibility/usability, and internal consistency with the rest of the app. Use after building or editing any screen/component in fees101-web, fees101-console, or fees101-marketing, before reporting the work complete.
---

# Design audit

Run this checklist against the actual rendered surface (screenshot it —
see the `playwright-cli` skill — don't audit from reading the code alone).
Output a short pass/fail list per item, not prose. Fix failures before
reporting the work done; if something can't be fixed in scope, say so
explicitly rather than silently passing it.

## (a) docs/design.md rules

- [ ] No rounded corners anywhere on this screen (buttons, inputs, cards,
      chips, images/avatars if any).
- [ ] No `box-shadow` used for elevation or separation — structure comes
      from 2px borders / 1px hairlines only.
- [ ] No spinners — loading states use the sweeping ink rule (`.m-loading`)
      or a determinate ink fill.
- [ ] Ledger green (`--color-ledger`) appears only on money that has
      actually arrived (paid amounts, settled rows, receipts) — not as a
      generic success/saved indicator.
- [ ] Signal red (`--color-signal`) is used as the sparse brand accent
      (structure, overdue/attention, irreversible actions) — not applied
      to more than one or two elements on the same screen.
- [ ] Ochre is confined to "awaiting a human" states (partial, overdue, not
      sent, pending approval) — not used as a generic warning color.
- [ ] Single typeface (Archivo) rendered throughout — no visible fallback
      to a system sans.
- [ ] All money/count/date figures use tabular numerals and align in
      columns.
- [ ] New components reuse the existing `.m-btn`/`.m-input`/`.m-chip`/
      `.m-table`/`.m-panel` vocabulary rather than a one-off recipe.
- [ ] Correct ground variant: an ink-ground money surface uses
      `.m-btn-ink*`, not the paper-ground button set.

## (b) Baseline usability / accessibility

- [ ] Text contrast: body/secondary text is neutral-700 or darker on paper
      (5.8:1+) — nothing lighter used for readable text.
- [ ] Every interactive element has a visible `:focus-visible` state (this
      system's default is a 2px signal-red outline at 2px offset — check
      it wasn't suppressed).
- [ ] Tap targets are at least ~40px in the smallest dimension (buttons/
      inputs already default to `min-height: 40px` — check any custom
      icon-only buttons meet this too).
- [ ] Full keyboard navigation: every action reachable by mouse is also
      reachable via Tab/Enter/Space, in a sensible order.
- [ ] Responsive down to mobile width: two-column layouts (`.m-2col`)
      collapse to one column below 1024px; `.m-setrow` stacks below 640px;
      no horizontal scroll introduced at phone width.
- [ ] Color is never the only signal — a status chip's text/label carries
      the same meaning as its color, for colorblind users.

## (c) Internal consistency

- [ ] This kind of element (a status chip, a filter chip, a settings row, a
      table) looks the same here as it does elsewhere in the same app —
      check at least one existing precedent screen, don't assume.
- [ ] Spacing rhythm matches (28px between stacked `.m-panel`s, the
      documented grid gaps) rather than an arbitrary value invented for
      this screen.
- [ ] Copy tone/casing matches the rest of the app (see the project's
      "no AI slop" writing preference — no emoji, no em dashes, no
      buzzwords in UI copy).

## Reporting

List every item above as pass/fail (not prose paragraphs). For any fail,
say what was wrong and whether it was fixed or is a known/flagged gap.
