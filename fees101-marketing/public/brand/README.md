# Brand assets

The logo is the "buildings" mark — three buildings (black, black with
ledger-line window cuts, signal-red) beside the FEES101 wordmark. Source
files live in `docs/brand-concepts/buildings-101/` at the repo root; the
PNGs here are copies used by `src/components/Logo.tsx`:

- `logo-horizontal.png` / `logo-horizontal-invert.png` — `LogoHorizontal`
- `icon.png` / `icon-invert.png` — `IconMark`
- `logo-stacked.png` — `LogoStacked`

`src/app/icon.png` (outside this folder) is the browser-tab favicon, a
256x256 resize of `icon-appicon-square.png` from the same source set.
Next.js picks it up automatically as `/icon.png`, also referenced as the
`Organization.logo` URL in JSON-LD.
