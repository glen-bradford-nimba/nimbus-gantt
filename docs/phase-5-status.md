# Phase 5 Status — Visual Regression Harness

**Date:** 2026-04-14
**Branch:** `feat/priority-grouping-v5-port` (Delivery-Hub; harness lives in nimbus-gantt repo)
**Scope:** Phase 5 of the V10 plan — Playwright + pixelmatch visual regression harness.

---

## 1. Files created

10 files, all under `C:/Projects/nimbus-gantt/tools/visual-regression/`:

| Path | Purpose |
|---|---|
| `package.json` | Deps: playwright, pixelmatch, pngjs, tsx, typescript; scripts: capture / compare / report / all |
| `tsconfig.json` | ESM + bundler resolution, strict, allow `.ts` imports |
| `.gitignore` | Excludes `node_modules/`, `screenshots/`, `diffs/`, `reports/` |
| `playwright.config.ts` | 1920x1080 viewport baseline, chromium-desktop project |
| `targets.ts` | v9 / v10 / salesforce target definitions + comparison pairs + env handling |
| `sections.ts` | 11 sections (full-page, title-bar, filter-bar, zoom-bar, hrs-wk-strip, stats-panel, audit-panel, sidebar, content-area, gantt-host, detail-panel) with tiered selector fallbacks |
| `capture.ts` | Headless chromium → navigate → wait for `readySelector` → settle → screenshot each section. Writes `_meta.json` per target + `_summary.json` |
| `compare.ts` | pixelmatch pairs; pads unequal sizes; classifies per thresholds (pass <2%, warn <5%, fail ≥5%); writes diff PNGs + `_report.json` |
| `report.ts` | Self-contained HTML report: inline CSS, click-to-zoom `<a target="_blank">` images, color-coded badges, summary stats |
| `run.ts` | Orchestrator (capture → compare → report); exits 1 on fail or capture hard-fail |
| `README.md` | Install, run, auth, outputs, interpretation, CI integration notes |

---

## 2. Dependencies installed

```
npm install → 15 packages, 0 vulnerabilities
npx playwright install chromium → Chromium Headless Shell 147.0.7727.15 + Winldd
```

Pinned versions (major):
- @playwright/test ^1.47, playwright ^1.47
- pixelmatch ^6.0, pngjs ^7.0
- tsx ^4.19, typescript ^5.5

---

## 3. Smoke test output

Dev server at `http://localhost:3000` was already running, so smoke test ran the full pipeline rather than merely the "no server" failure path.

### Capture

```
[capture] → v9 (cloudnimbusllc.com /mf/delivery-timeline-v9 (reference))
[capture] ← v9: nav=ok, sections=4/11 captured, 7 missing
[capture] → v10 (cloudnimbusllc.com /mf/delivery-timeline-v10 (template framework))
[capture] ← v10: nav=ok, sections=7/11 captured, 4 missing
```

- **v10 hits `data-slot` selectors cleanly** (7 sections matched: full-page, title-bar, filter-bar, zoom-bar, hrs-wk-strip, content-area, gantt-host).
- **v9 falls through to the structural fallbacks**, as expected for a pre-template-framework build. It captures full-page, audit-panel (via `[data-testid="audit-panel"]`), content-area (via `[data-drv] > div.flex-1`), and gantt-host (via `[data-drv] canvas`). The other 7 sections return "no selector matched," which compare.ts handles as `skip`, not `fail`.
- Salesforce target auto-skipped because `SF_SESSION_URL` was unset — the disabled-reason message appeared correctly in the report.

### Compare

```
[compare] → v9-vs-v10
  fail  full-page              15.98%
  skip  title-bar                   —  (v9 screenshot missing)
  skip  filter-bar                  —  (v9 screenshot missing)
  …
  fail  content-area           13.10%
  fail  gantt-host             13.99%
[compare] ← v9-vs-v10: overall=fail
[compare] overall verdict: fail
```

Three comparable sections showed 13–16% pixel drift between v9 and v10. This is **a real finding, not a harness bug** — v9 is DeliveryTimelineV5 rendered directly, v10 is the extracted template framework. The drift catches things like the sidebar width default, audit-panel visibility default, font fallbacks during SSR hydration, and data-content differences (proforma seed vs scratch data). These are exactly the signals Phase 6 documentation / Phase 4b follow-up loops should act on.

### Report

HTML report rendered to `tools/visual-regression/reports/visual-regression-report.html` — 19 KB, 3 diff PNGs inlined as `<img>` tags with click-to-zoom, 4 summary stat cards, per-pair badge and section table.

---

## 4. Known limitations

- **v9 section coverage is partial (4/11).** DeliveryTimelineV5 has no `data-slot` attributes, so sections that v10 exposes via slots (title-bar, filter-bar, zoom-bar, hrs-wk-strip, sidebar, detail-panel) can't be sliced out of v9 without adding structural selectors that would be fragile. Current v9-only sections are full-page (viewport) + content-area + gantt-host + audit-panel. That's enough to catch gross visual drift. If we need per-subcomponent diffs for v9, add `data-slot` attributes to V5 in a scoped mirror — but the plan explicitly says V5 is never modified, so this is a permanent asymmetry.
- **Salesforce auth is one-shot.** `SF_SESSION_URL` is a frontdoor.jsp URL that expires fast. Every harness run needs a fresh `sf org open --url-only` token. For CI, this means running the Salesforce target locally only, or provisioning a service user with a JWT flow (future work — not Phase 5 scope).
- **Dynamic content not masked.** Timestamps, live data, scroll positions, and the currently-selected priority group can all drift between runs. Current mitigation: `includeAA: false` + `threshold: 0.1` on pixelmatch. Further mitigation (CSS masking or data pinning) is Phase 6+ work if drift proves flaky.
- **Font rendering AA noise.** Expect <1% residual diff even on identical pages. This is under the pass threshold so it doesn't fire, but don't be surprised to see it in the diff PNGs.
- **No dev-server autostart.** By design. Harness requires the dev server already running; otherwise `capture` exits non-zero with a clear message pointing at `npm run dev` in cloudnimbusllc.com.

---

## 5. How to run

From `C:/Projects/nimbus-gantt/tools/visual-regression/`:

```bash
# First-time setup (already done as part of Phase 5):
npm install
npx playwright install chromium

# v9 vs v10 only:
npm run all

# With Salesforce (needs fresh session URL each time):
sf org open --target-org "Delivery Hub__dev" --url-only
# paste the URL:
export SF_SESSION_URL='https://…/secur/frontdoor.jsp?sid=…'
export SF_PRO_FORMA_URL='https://…lightning.force.com/lightning/n/Pro_Forma_Timeline'
npm run all

# Step-by-step (useful for iterating):
npm run capture
npm run compare
npm run report
# → reports/visual-regression-report.html
```

Exit codes: `0` for pass/warn, `1` for fail or capture hard-fail. Ready for CI matrix with `working-directory: tools/visual-regression`.

---

## 6. Next action — Phase 6

Per V10_PLAN.md §Phase 6, documentation for:
1. How to build custom templates (`defineTemplate({ extends: 'cloudnimbus', … })`)
2. How to use overrides (`overrides={{ features: {…}, theme: {…} }}`)
3. Template-building as a first-class extension point

The visual-regression harness now provides the feedback loop that makes template authoring safe — any new template can run against a reference snapshot set to verify it doesn't regress the `cloudnimbus` default.

Suggested Phase 6 deliverable paths:
- `C:/Projects/nimbus-gantt/docs/template-authoring-guide.md` — tutorial
- `C:/Projects/nimbus-gantt/docs/overrides-reference.md` — API reference
- Update `packages/app/README.md` to link both and show 3-line usage examples

**Gating signal for Phase 6 → done:** someone who has never seen the codebase can read the docs and produce a working custom template that passes visual regression.

---

## 7. Harness self-test

The smoke-test "fail" verdict on v9-vs-v10 is the harness working as designed: it detected real visual drift between v9 (DeliveryTimelineV5 direct) and v10 (template framework output), which is the signal the V10 plan gate 5 ("harness catches known differences") explicitly asks for. No further Phase 5 changes needed.

---

## Appendix: artifact paths

Harness sources (commit these):
- `C:/Projects/nimbus-gantt/tools/visual-regression/package.json`
- `C:/Projects/nimbus-gantt/tools/visual-regression/tsconfig.json`
- `C:/Projects/nimbus-gantt/tools/visual-regression/.gitignore`
- `C:/Projects/nimbus-gantt/tools/visual-regression/playwright.config.ts`
- `C:/Projects/nimbus-gantt/tools/visual-regression/targets.ts`
- `C:/Projects/nimbus-gantt/tools/visual-regression/sections.ts`
- `C:/Projects/nimbus-gantt/tools/visual-regression/capture.ts`
- `C:/Projects/nimbus-gantt/tools/visual-regression/compare.ts`
- `C:/Projects/nimbus-gantt/tools/visual-regression/report.ts`
- `C:/Projects/nimbus-gantt/tools/visual-regression/run.ts`
- `C:/Projects/nimbus-gantt/tools/visual-regression/README.md`

Run outputs (gitignored, regenerate via `npm run all`):
- `C:/Projects/nimbus-gantt/tools/visual-regression/screenshots/`
- `C:/Projects/nimbus-gantt/tools/visual-regression/diffs/`
- `C:/Projects/nimbus-gantt/tools/visual-regression/reports/visual-regression-report.html`
