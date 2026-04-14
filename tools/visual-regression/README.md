# nimbus-gantt visual regression harness

Playwright + pixelmatch tool that compares three renderings of the same gantt:

| Target       | URL                                               | Auth                                             |
| ------------ | ------------------------------------------------- | ------------------------------------------------ |
| `v9`         | `http://localhost:3000/mf/delivery-timeline-v9`   | auto on localhost (MFAuthGate bypass)            |
| `v10`        | `http://localhost:3000/mf/delivery-timeline-v10`  | auto on localhost (MFAuthGate bypass)            |
| `salesforce` | Pro Forma Timeline Lightning tab                  | one-shot frontdoor URL via `SF_SESSION_URL` env  |

Pairs compared: `v9-vs-v10` and `v10-vs-salesforce`.

Thresholds per section:

| Diff %   | Verdict |
| -------- | ------- |
| < 2%     | pass    |
| 2%–5%    | warn    |
| ≥ 5%     | fail (exit code 1) |

## Prereqs

- Node 18+
- cloudnimbusllc.com dev server running at `http://localhost:3000`
  (from that repo: `npm run dev` or `pnpm dev`)
- Chromium installed by Playwright (see `npm run install-browsers` below)

## Install

```bash
cd C:/Projects/nimbus-gantt/tools/visual-regression
npm install
npx playwright install chromium
```

First install pulls ~150 MB (Playwright's bundled Chromium).

## Run

### v9 vs v10 only (default)

```bash
npm run all
# or step by step:
npm run capture && npm run compare && npm run report
```

### Include Salesforce

```bash
# Get a one-shot frontdoor URL (expires fast — run this immediately before the harness):
sf org open --target-org "Delivery Hub__dev" --url-only

# Export it and the Pro Forma Timeline tab URL:
export SF_SESSION_URL='https://…/secur/frontdoor.jsp?sid=…'
export SF_PRO_FORMA_URL='https://…lightning.force.com/lightning/n/Pro_Forma_Timeline'

npm run all
```

If `SF_PRO_FORMA_URL` is omitted, the harness navigates directly to `SF_SESSION_URL`
(frontdoor typically redirects to the org home page, which is usually *not* what you want
for visual comparison — set both).

### Override BASE_URL

```bash
BASE_URL='http://127.0.0.1:3001' npm run all
```

## Outputs

```
screenshots/<target>/<section>.png   # raw PNGs
screenshots/<target>/_meta.json      # per-section selector match log
screenshots/_summary.json            # run summary
diffs/<pair>/<section>.png           # red-highlighted diff PNGs
diffs/_report.json                   # machine-readable comparison data
reports/visual-regression-report.html # open in browser to review
```

All four directories are gitignored.

## Interpreting the report

Open `reports/visual-regression-report.html` in a browser. Each row shows:

- Section slug + label (and any capture-time note)
- Target A screenshot, Target B screenshot, diff PNG (red = mismatched pixels)
- Diff percentage
- Pass / warn / fail / skip badge

Click any image for full-size in a new tab.

**Common skip reasons:**

- `salesforce` target not enabled — `SF_SESSION_URL` was not set.
- Section selector didn't match on one side — e.g., audit panel hidden by default,
  or a v9-only region that v10 doesn't render. Check the `_meta.json` files to see
  which selectors resolved.

**Common warn / fail causes:**

- Font rendering differences between runs (AA rasterisation) — compare.ts uses
  `includeAA: false` to minimise this, but some residual noise is normal (< 1%).
- Dynamic content (timestamps, live data) — mask with a selector-specific wait or
  by short-circuiting the data source in the dev server.
- Genuine visual regression — fix the underlying template / CSS.

## How it works

1. `capture.ts` boots headless Chromium, navigates each enabled target, waits for
   `readySelector`, then screenshots every section defined in `sections.ts`. Each
   section has a prioritised selector list — first match wins. Full-page sections
   use a viewport screenshot.
2. `compare.ts` pads images to the larger of the two dimensions (padding pixels
   count as differences), runs `pixelmatch(threshold: 0.1, includeAA: false)`,
   writes a diff PNG, classifies per thresholds above, and computes an overall
   verdict per pair.
3. `report.ts` reads `diffs/_report.json` and produces a self-contained HTML
   report with inline CSS and click-to-zoom image links.
4. `run.ts` chains all three. Exits non-zero on capture hard-fails or on any
   `fail` verdict.

## Scope / non-goals

- Does NOT start the dev server — bring your own at `localhost:3000`.
- Does NOT run against production cloudnimbusllc.com.
- Does NOT modify any production code in `packages/`, `cloudnimbusllc.com/`, or
  `Delivery-Hub/`. Pure black-box observer.
- Screenshots / diffs / reports are intentionally gitignored; commit only the
  harness source itself.

## CI integration (future Phase 6+)

Suitable for a GitHub Actions matrix job:

```yaml
- run: npm ci
  working-directory: tools/visual-regression
- run: npx playwright install --with-deps chromium
  working-directory: tools/visual-regression
- run: npm run all
  working-directory: tools/visual-regression
  env:
    BASE_URL: http://localhost:3000
# Exit code propagates — job fails on ≥5% drift.
# Upload reports/ as an artifact for reviewers.
```

Salesforce target should stay off CI unless a service user's session URL can be
minted by the workflow — `sf org open --url-only` tokens are short-lived.
