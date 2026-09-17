# Fees101 redesign — handoff to Claude Code

Source of truth for visuals: the design mockups in the design project
(`Foundations.dc.html`, `App Shell.dc.html`, `Messages.dc.html`,
`Redesign Program.dc.html`). This file is the machine-readable extract.
**If a value is not in this file, do not invent it — ask.**

Ground rules, non-negotiable:

1. Do not change the data layer. No new Supabase queries, no schema edits,
   no changes to the job provider. If a screen seems to need new data, stop
   and raise it rather than writing the query.
2. Do not change the permission model. 21 keys (9 SEE, 12 DO). Every existing
   gate and redirect stays exactly as-is.
3. Zero corner radius anywhere. `border-radius: 0`. No exceptions.
4. No cards-on-gray. Ink on paper: one ground colour, structure made by rules.
5. Flush left everything — headings, copy, and button labels (a wide button
   starts its label at the left padding edge, never centred).
6. One PR per step below. Merge step 01 before starting anything else.

---

## 01 — Tokens and type (`app/globals.css` only)

This step touches **one file**. No component edits, no JSX. Merge first.

### Palette

```css
:root {
  /* ground + ink */
  --bg:            #f3f2f2;
  --surface:       #ffffff;
  --ink:           #201e1d;
  --ink-2:         #444141;   /* secondary copy */
  --ink-3:         #605d5d;   /* labels, meta, placeholders */
  --rule:          #201e1d;   /* 2px structural rules */
  --rule-soft:     #d7d3d3;   /* 1px row rules */
  --rule-faint:    rgba(32,30,29,0.4);

  /* signal red — brand + structure */
  --red:           #ec3013;
  --red-press:     #dd2b0f;
  --red-text:      #ae1800;   /* red text under 20px MUST use this (6.4:1) */
  --red-hairline:  #ffc4b8;

  /* ledger green — money that arrived */
  --green:         #0a6b3d;
  --green-on-ink:  #35c483;

  /* ochre — needs follow-up */
  --ochre:         #b45f06;

  /* hovers */
  --hover-tint:    #eae7e7;
  --ink-hover:     #444141;
  --ink-press:     #000000;
}
```

Role discipline — this is the whole point of the redesign, enforce it:

| Colour | Carries | Never |
| --- | --- | --- |
| Signal red `--red` | The mark. Section markers and emphasis rules. Collection bars. Destructive confirmation. Anything structurally Fees101. | A row status. The default button. Small text at pure `#EC3013`. |
| Ledger green `--green` | Money that actually arrived: amounts paid, settled rows, collected totals, receipts, successful reconciliation. | Decoration. Generic "success" toasts unrelated to money. |
| Ochre `--ochre` | Needs follow-up: overdue, partial, pending confirmation, expiring. | "Warning" styling on anything that isn't a money state. |

Nothing outside these three gets a hue. Everything else is ink on ground.

### Type

Archivo only, both heading and body. Load 400/600/800.

```css
--font-sans: Archivo, system-ui, sans-serif;
```

| Role | Size | Weight | Tracking | Leading |
| --- | --- | --- | --- | --- |
| Display | `clamp(44px, 7vw, 88px)` | 800 | `-0.03em` | 0.94 |
| H2 | 32px | 800 | normal | 1.1 |
| Lead paragraph | 19px | 400 | normal | 1.45 |
| Body | 16px | 400 | normal | 1.5 |
| UI / control | 14px | 600 | normal | 1.4 |
| Eyebrow label | 12px | 400 | `0.16em`, uppercase | 1.3 |
| Meta | 12–13px | 400 | `0.1em` where labelling | 1.4 |
| Wordmark | 15px | 800 | `0.14em`, uppercase | — |

All money figures: `font-variant-numeric: tabular-nums;`. No exceptions —
tables, cards, totals, receipts.

### Controls

Four button variants. 2px borders, square, left-aligned label,
`padding: 10px 18px`, 14px/600 Archivo.

```css
.btn-ink   { background:#201e1d; color:#f3f2f2; border:2px solid #201e1d; }
.btn-ink:hover   { background:#444141; }
.btn-ink:active  { background:#000; }

.btn-out   { background:transparent; color:#201e1d; border:2px solid #201e1d; }
.btn-out:hover   { background:#eae7e7; }

.btn-red   { background:#ec3013; color:#fff; border:2px solid #ec3013; }
.btn-red:hover   { background:#dd2b0f; }

.btn-ghost { background:transparent; color:#201e1d; border:2px solid transparent; }
.btn-ghost:hover { background:#eae7e7; }

.btn-ink:disabled, .btn-out:disabled { opacity:.45; cursor:not-allowed; }
```

`.btn-ink` is the default action. `.btn-red` is **only** destructive
confirmation and the single primary action on an empty/first-run screen.

Inputs:

```css
.fin { background:#fff; border:2px solid #201e1d; padding:10px 12px;
       font:400 14px Archivo, sans-serif; color:#201e1d; width:100%; }
.fin::placeholder { color:#605d5d; }
```

Focus, on every interactive element, no browser defaults:

```css
:focus-visible { outline: 2px solid #ec3013; outline-offset: 2px; }
```

### Structure

- Page max width `1240px`, side padding `24px`.
- Section opens with a 2px ink rule (`border-top: 2px solid var(--rule)`).
- Rows inside a section separate with 1px `var(--rule-soft)`.
- Grid cells: `background: var(--bg); border: 1px solid var(--rule-faint); padding: 22px;`
- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 52 / 56 / 120.
- Photographs go through a grayscale wrapper. Never tinted.

### Motion

Two only. Both respect reduced motion.

```css
@keyframes ruleIn   { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes sweepRule{ 0% { transform: translateX(-100%); } 100% { transform: translateX(340%); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
}
```

`ruleIn` — 700ms `cubic-bezier(0.2,0,0,1)`, `transform-origin: left`, on the
rule that closes a page header. `sweepRule` — loading indicator only.
Nothing else animates. No fades on route change, no card lifts.

Links, globally (users add links we haven't styled otherwise):

```css
a        { color:#ae1800; text-decoration:none; border-bottom:1px solid #ffc4b8; }
a:hover  { color:#ec3013; border-bottom-color:#ec3013; }
```

---

## 02 — Parent-facing messages (own PR)

Self-contained. Templates only — no send-path changes. Match `Messages.dc.html`
verbatim for copy and hierarchy. Plain text and HTML variants, same wording.

## 03 — Invoice PDF (own PR)

Self-contained. Same tokens, tabular numerals throughout, 12pt minimum body.
Ink on white; red only in the mark and the total rule; green only on amounts
already paid.

## 04 — Workspace restructure (one PR, no visual work)

Collapse 20+ routes into **7 workspaces**, each with 2–3 modes:

| Workspace | Modes |
| --- | --- |
| Today | Now · Record |
| Students | Roster · Profile |
| Money | Collections · Reconciliation · Payouts |
| Fees | Structures · Assignments |
| Discounts | Scholarships · Exemptions |
| School | Sessions · Terms · Settings |
| Team & Trust | People · Roles · Audit |

19 workspace/mode pairs total — the pairing is drawn in `App Shell.dc.html`;
read it before routing. Preserve every existing permission gate and redirect
and the job provider. Old routes redirect; none are deleted in this PR.

## 05–06 — Surfaces, one screen per PR, in traffic order

Traffic order: Today/Now → Students/Roster → Money/Collections →
Students/Profile → Today/Record → Fees/Structures → everything else.

Each drawn surface exists in `App Shell.dc.html`. Open it, match it. For the
five surfaces not yet drawn, the written specs are in
`Redesign Program.dc.html` sections 09–10 — build from those, and stop if the
spec doesn't cover a state you hit.

States that must ship with every surface, not as a follow-up: loading,
empty/first-run, error, permission-denied, and the offline/stale case.
