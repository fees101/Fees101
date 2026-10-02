---
name: playwright-cli
description: Boot this repo's dev server and drive it headlessly to visually verify a UI change with a real screenshot, instead of only checking it compiles or typechecks. Use after any UI change in fees101-web, fees101-console, or fees101-marketing, before reporting the work done.
---

# Playwright CLI — visual QA

A UI change is not verified by `tsc --noEmit` or a passing build alone —
this repo's own history has repeated cases of code that typechecked but
rendered wrong (a Tailwind class silently dropped by the WASM build, a CSS
variable that resolved empty at runtime). Always take an actual screenshot
of the rendered result before reporting a UI change done.

## Check for an existing project pattern first

Before writing a fresh Playwright script, check for a project-specific
runner already used in this repo — this codebase has a history of live
browser-driven verification (real Playwright scripts saved under a
`pw-test-fees101` walkthrough directory, referenced by filename in
`ROADMAP.md` entries, e.g. `walkthrough/70-cycle-pagination-test.js`) and
this environment separately has a bundled `run` skill for launching and
screenshotting apps in general. Prefer reusing either of those over
inventing a third pattern:

- If a `run` skill is available, use it to launch and screenshot the app —
  it already knows this environment's conventions for booting a Next.js
  dev server headlessly.
- If a prior walkthrough script exists for the surface you're touching,
  read it and adapt it rather than starting from a blank Playwright script
  — it already encodes the right login/navigation path for that app.

## Generic Playwright fallback

If no existing pattern fits, use `npx playwright` directly:

```bash
# one-time per app, if not already installed
cd fees101-web && npx playwright install chromium

# boot the dev server (respects the Node 20 + WASM Tailwind workaround
# already documented for this machine — see project dev-env-setup memory)
npm run dev &

# drive it headlessly
node - <<'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/the-route-you-changed');
  await page.screenshot({ path: '/tmp/fees101-check.png', fullPage: true });
  await browser.close();
})();
EOF
```

Then **read the screenshot back** (the Read tool renders images) before
reporting anything done — don't just confirm the script exited 0.

## What to check in the screenshot

Run it against the `design-audit` skill's checklist, not just "does it
look plausible": zero radius, borders not shadows, no spinner mid-load,
correct color semantics, tabular numerals aligned, correct ground variant
(ink vs. paper) for the surface. For a redesign/mockup match specifically,
follow the `image-to-code` skill's side-by-side comparison step instead of
a one-off screenshot.

## Practical notes for this repo

- Each app is self-contained (`cd fees101-web && npm run dev`, etc.) — boot
  the specific app you changed, not a guess at which port is which.
- `fees101-console` and `fees101-web` both sit behind auth — a screenshot
  of a protected route needs an authenticated session (reuse an existing
  test-login pattern from a prior walkthrough script if one exists) rather
  than screenshotting a login-redirect by mistake.
- Kill the dev server when done if you started it in the foreground of a
  shell you need back.

## Always, before reporting a UI change complete

1. Boot the app.
2. Navigate to the actual changed route.
3. Screenshot it.
4. Read the screenshot.
5. Only then say the work is done — and mention that it was visually
   verified, not just typechecked.
