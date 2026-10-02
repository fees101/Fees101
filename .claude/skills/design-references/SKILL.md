---
name: design-references
description: Curated list of real production design systems worth studying for inspiration or comparison against this repo's Modernist system. Use when asked to find design inspiration, benchmark a screen against real precedent, or justify a design decision by comparing it to how a known product handles the same problem. Not a copy-paste source — consult it, don't clone it.
---

# Design references

A short, real list of production design systems, spanning registers
relevant to Fees101 (a fintech/ledger product for schools). Consult this
when asked for inspiration or a comparison point — **never copy a pattern
wholesale**. This repo's own system is `docs/design.md`; these are precedent to
learn from and diverge from deliberately, not a target to match.

## Minimal / editorial

- **Linear** — linear.app/method — restrained motion, one accent color used
  sparingly, extremely disciplined type scale. Closest register to this
  repo's "one deliberate accent" rule.
- **Stripe** — stripe.com/docs (site itself, no public formal design-system
  doc) — best-in-class for making dense financial/API data legible without
  feeling cold; strong precedent for how a money product can still feel
  warm.
- **Vercel** — vercel.com/design — geometric, monochrome-first, sparing
  color use for status only. Good reference for the "borders not shadows,
  zero radius" instinct at Fees101 pushed further.

## Data-dense / dashboard

- **GitHub Primer** — primer.style — the most thoroughly documented public
  design system for dense, data-heavy interfaces; strong on accessible
  color tokens and table/list density guidance.
- **Vercel dashboard** (product itself, not just the marketing site above)
  — good precedent for project/resource lists at scale, useful for the
  platform console (`fees101-console`) specifically.
- **Atlassian Design System** — atlassian.design — mature precedent for
  permission/role UI and dense settings screens, relevant to Fees101's
  roles & permissions surfaces.
- **IBM Carbon** — carbondesignsystem.com — the deepest public reference
  for data-table, form, and enterprise-density patterns if a Fees101 screen
  needs to handle real scale (hundreds of rows) gracefully.

## Fintech / ledger-like (closest to Fees101's own domain)

- **Mercury** — mercury.com — a banking product that already does
  "ledger-green only when money arrived" as a real, shipped convention;
  the single closest external precedent to Fees101's own color semantics.
- **Ramp** — ramp.com — strong precedent for status chips/color semantics
  in a spend-management product (approved/pending/declined), comparable to
  Fees101's paid/partial/overdue states.
- **Wise** — wise.com/gb/brand (public brand guidelines) — a rare fintech
  with a genuinely distinctive, non-generic type/color identity; worth
  studying for how a payments product avoids looking like every other
  payments product.
- **Monzo** — monzo.com (blog posts on their design system, no single
  public doc) — good precedent for making transaction/ledger lists
  scannable at a glance, relevant to Fees101's invoices/payments lists.

## Government / high-trust, low-decoration

- **GOV.UK Design System** — design-system.service.gov.uk — the reference
  for a high-trust, zero-decoration, accessibility-first system; useful
  precedent for Fees101's "no rounded corners, no shadows, borders only"
  instinct when it's unclear whether a choice reads as "plain" vs.
  "trustworthy."

## USWDS

- **U.S. Web Design System** — designsystem.digital.gov — another public,
  fully documented accessibility-first system; a second data point beyond
  GOV.UK for contrast/focus-state guidance when auditing a Fees101 screen.

## How to use this list

When asked to find inspiration: pick 1-2 entries whose register matches the
surface in question (fintech/ledger for money screens, data-dense for the
platform console, editorial/minimal for marketing), read their actual
public doc, and note **specific, nameable differences** from what Fees101
does today — don't produce a vague "make it feel more like Stripe." When
asked to benchmark an existing Fees101 screen: name the closest reference
above and say concretely where Fees101 diverges and whether that divergence
is deliberate (matches `docs/design.md`) or accidental.
