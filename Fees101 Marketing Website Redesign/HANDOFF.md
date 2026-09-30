# Fees101 website redesign — handoff

**File:** `Fees101 Website.dc.html` (single Design Component, Modernist system: Archivo + JetBrains Mono, brand navy `#0D1B36` / mint `#5AD8A6`).
**Positioning:** revenue operations platform for Nigerian schools (not "fee management").

## Flow
- Hash router: `#/`, `#/features`, `#/how-it-works`, `#/about`, `#/faq`, `#/privacy`, `#/terms`. Set in `componentDidMount` (`onHash`). `initialRoute` prop = default.
- Shell = masthead (top of template) + `<main>` page blocks (`<sc-if isHome|isFeatures|isHow|isAbout|isFaq|isLegal>`) + shared closing CTA (`showCta`, copy in `data().cta[route]`) + footer.
- All copy/data lives in `data()`; `renderVals()` derives view state. Add a page: add route to `ok` list, `data().pages` (nav), an `isX` flag, and a `<sc-if>` block.
- State: `tab` (Features), `cat`/`openQ`/`query` (FAQ), `matched` (hero ledger tick, `autoplay` prop).

## Repo mapping (fees101/fees101-website)
| Route | Repo source |
|---|---|
| Home | `src/app/page.tsx`, `AfricaSection`, `HeroPreview`, `Counter` |
| Features | `src/app/features/page.tsx` |
| How it works | `src/app/how-it-works/*`, `components/ProductScreens.tsx` (specimens simplified to data rows) |
| About | `src/app/about/*` |
| FAQ | `src/app/faq/FaqContent.tsx` |
| Privacy / Terms | `src/app/privacy`, `src/app/terms`, `LegalLayout` |
| Shell | `Header.tsx`, `Footer.tsx`, `layout.tsx` |

## Deliberately dropped / to decide
- Nigeria map, hero illustrations (`public/images/*`), logo PNGs: replaced by type; swap in real assets (use `.grayscale` wrapper) if wanted.
- framer-motion, TiltCard, blobs, marquee, emoji-style icon badges: removed on purpose (generic patterns).
- Hero ledger and "How it works" specimens use illustrative names/amounts.
- Copy edits vs. repo: "fee management" → "revenue operations" in hero, features, footer, FAQ #1, privacy intro, about. Review other product claims with the team.
- Legal text otherwise verbatim.
