# Fees101 — Design System ("Modernist")

> Source of truth for tokens: `fees101-web/src/app/globals.css` — read that
> file directly for exact values/comments; this doc mirrors and explains it,
> it doesn't replace it. If the two ever disagree, `globals.css` wins.

As of 2026-09-30, `fees101-marketing` is being migrated onto this same
system (folded into the monorepo the same day) — treat it as the target
for that app too, not a `fees101-web`-only convention.

## Grounds

Two grounds, used deliberately, not interchangeably:

- **Paper** (`--color-paper: #f3f2f2`) — the default operating ground, for
  day-to-day work.
- **Ink** (`--color-ink: #201e1d`) — the "instrument surface" ground, used
  for money-focused screens: invoices ledger, invoice detail, analytics/
  cycle-close. Ink-ground surfaces get their own button variants
  (`.m-btn-ink`, `.m-btn-ink-primary`, `.m-btn-ink-danger`) rather than the
  paper-ground buttons, which are unreadable on dark.
- `--color-surface: #eae9e9` — a slightly recessed neutral, between paper
  and the neutral ramp below.

## Neutral ramp

A 9-step OKLCH-generated ramp (`--color-neutral-100` through `-900`), with
a hard rule: **secondary text floors at neutral-700** (`#605d5d`,
contrast ratio 5.8:1 on paper). Neutral-600 and lighter are for rules and
disabled states only — never text. If you reach for a neutral lighter than
700 for anything readable, that's a contrast bug, not a style choice.

## Color semantics (the part most likely to be gotten wrong)

- **Signal red** (`--color-signal: #ec3013`) — the brand mark, structural
  rules, collection bars, overdue/unsent/rejected states, and irreversible
  actions. It is **never** a default button color, a row status color, or
  decoration. Under 20px, small text drops to `--color-signal-text`
  (`#ae1800`, 6.4:1) since the full-saturation signal color fails contrast
  at small sizes.
- **Ledger green** (`--color-ledger: #0a6b3d`, or `--color-ledger-on-ink:
  #35c483` on the ink ground) — reserved **exclusively** for money that has
  actually arrived: amounts paid, settled rows, collected totals, receipts.
  It is never a button, a link, or a nav highlight, and never used for
  "success" in a generic UI sense (a saved-settings toast is not green).
- **Follow-up ochre** (`--color-ochre: #b45f06`, text variant
  `--color-ochre-text: #8a4805`) — states awaiting a human: partial
  payment, overdue, not sent, needs resend, pending approval. Confined to a
  status column or a bar's arrears segment, not a general "warning" color
  used freely.
- Status chips (`.m-chip-*`) codify this: green = money received, ochre =
  needs a human, red = attention/failed, neutral = inert. If a new status
  doesn't fit one of these four, that's a sign it needs its own considered
  color decision, not a default pick.

## Type

**One typeface, Archivo, three weights**, tabular numerals everywhere a
figure appears (`font-variant-numeric: tabular-nums` on `<body>`) so money
columns align and count-up animations don't jitter. `--font-sans` and
`--font-heading` both resolve to the same Archivo stack — there is no
separate display face. Fonts are pinned in both `@theme` and `:root`
directly, because the WASM Tailwind build used in this project doesn't
reliably emit `@theme` font tokens into `:root` on its own — dropping that
duplication reintroduces a real "fonts silently fall back to system UI"
bug (see the comment in `globals.css` around line 92).

## Radius: zero, everywhere, on purpose

Every radius token (`--radius-xs` through `--radius-4xl`) is hardcoded to
`0px`. No rounded corners, anywhere, on any component — buttons, inputs,
chips, cards. This is a hard rule, not a default that individual
components override.

## Borders, not shadows

Structure comes from 2px ink rules (`.m-rule`), 1px neutral hairlines
(`.m-rule-soft`), and 2px borders on inputs/panels — never `box-shadow` for
elevation or separation. `.m-panel` (a 2px top rule + 18px top padding,
28px between stacked panels) is the standard way a titled section is
delimited, not a card with a shadow.

## Motion: no spinners

Loading states are never a spinner. Indeterminate loading is a 2px ink rule
sweeping its track (`.m-loading`); determinate progress fills in ink, and
turns red only on a failed job. Four durations (`--dur-tick` 120ms,
`--dur-move` 200ms, `--dur-enter` 320ms, `--dur-settle` 560ms) and two
easing curves (`--ease-out` for nearly everything, `--ease-in` for exits)
cover the whole system — don't introduce a fifth duration or a third curve
without a real reason. `prefers-reduced-motion: reduce` collapses every
animation/transition to near-instant globally; any new animation should
work correctly with that media query already handling it, not need its own
reduced-motion escape hatch.

## Layout conventions

- Two-column workspace body (`.m-2col`): stacks to one column below
  1024px, then splits `1.6fr / 1fr` with a 36px gap above it. The student
  profile layout (`.m-2col-profile`) uses a slightly wider primary column
  (`1.5fr / 1fr`) as its own class — don't reuse `.m-2col` there and expect
  the same ratio.
- Section rhythm is 28px between stacked `.m-panel`s, not an arbitrary
  `space-y` value.
- `.m-setrow` (School-profile-style settings rows) — fixed 320px label
  column + flexible value column above 640px, stacking to one column below
  it so values never get crushed on mobile.
- A handful of Tailwind utility classes (arbitrary `gap`/`space-y`/`py`/
  `text-{size}` values used by the redesigned pages) are explicitly
  safelisted via `@source inline(...)` at the top of `globals.css` — see
  `tailwind-dynamic-class-safelist` context in project memory. If a
  redesigned page's spacing silently doesn't apply on hot reload, check
  whether the class needs adding to that safelist before assuming the CSS
  itself is wrong.

## Definition of done for any new UI surface

Before calling a screen finished, check it against all of these (see also
the `design-audit` Claude Code skill, which runs this as a checklist):

- [ ] No rounded corners anywhere (radius tokens are 0; don't override them
      locally with an arbitrary Tailwind radius class).
- [ ] No `box-shadow` used for elevation/separation — borders/rules only.
- [ ] No spinners — loading states use `.m-loading` or a determinate ink
      fill.
- [ ] Ledger green appears **only** where money has actually arrived —
      never as a generic "success" or "saved" color.
- [ ] Signal red is used sparingly, as the one brand accent (structure,
      overdue/attention states, irreversible actions) — not decorating
      multiple unrelated elements on the same screen.
- [ ] Single typeface (Archivo) throughout; no incidental system-font
      fallback (would indicate the `--font-sans` pinning broke).
- [ ] All numeric/money columns use tabular figures and align vertically.
- [ ] Buttons/inputs/chips match the existing `.m-btn`/`.m-input`/`.m-chip`
      vocabulary rather than a one-off recipe for this screen alone.
- [ ] Correct ground variant used — ink-ground money surfaces use the
      `.m-btn-ink*` button set, not the paper-ground set.
- [ ] Responsive down to mobile width — two-column layouts collapse to one
      column at the documented breakpoint, `.m-setrow` stacks below 640px.
