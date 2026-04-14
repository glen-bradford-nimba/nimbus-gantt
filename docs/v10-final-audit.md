# v10 Final Audit — 2026-04-14

**Auditor:** Opus 4.6 (1M ctx) — independent cross-repo audit
**Scope:** Verify every deliverable of the v10 Template-as-Framework ship. Flag any divergence between prior status reports and reality on disk / in orgs.

---

## Audit Verdict: **FLAGS PRESENT**

The core work is real and cohesive — framework code exists, builds clean, templates register, Salesforce org has the right resources. But **two material overclaims in memory / status docs** misrepresent the shipping surface, and **all the Phase 2/5/6 work is untracked in git**. Neither is fatal. Both need owner decisions before the next session can confidently call this "done."

Specifically:
1. **cloudnimbusllc.com `/mf/delivery-timeline-v10` is a placeholder stub, not a template-driven implementation.** MEMORY.md and session-april14-v10-shipped.md claim v10 is "live" and "shipped end-to-end." The deployed route is a 22-line "coming soon" page.
2. **The entire nimbus-gantt v10 framework (Phase 2 + Phase 5 + Phase 6 + all docs)** is on disk but not committed. Last commit on `master` is pre-v10.

---

## Per-section findings

### 1. Plan documents — PASS (with minor churn)
All expected files exist:
- `docs/V10_PLAN.md` (67 lines)
- `docs/template-api-design.md` (530 lines)
- `docs/v10-component-spec.md` (1850 lines — matches claim exactly)
- `docs/phase-0-status.md` through `docs/phase-6-status.md` (including `phase-1b-report.md`)
- `docs/phase-1-status.md` + `phase-2/3/4-status-check.md` all present
- No TODO/FIXME/STUB markers in any doc
- AuditStrip → HrsWkStrip rename consistently applied: no `AuditStrip` references in `packages/app/src/`. 12 references remain in `docs/` but all are historical commentary on the rename itself (phase-1-status.md, phase-2-status-check.md documenting the correction).

### 2. Template framework code — PASS
Expected files all present at `packages/app/src/templates/`:
```
css.ts, index.ts, registry.ts, resolver.ts, slots.ts, state.ts,
stylesheet-loader.ts, types.ts
cloudnimbus/   — cloudnimbus.template.css, defaults.ts, index.ts, styles.css, theme.ts
cloudnimbus/components/          — 9 React slots + shared/{classes,el}.ts
cloudnimbus/components/vanilla/  — 9 vanilla slots
minimal/       — components/, index.ts, styles.css, theme.ts
```
- `npx tsc --noEmit` → exit 0, zero errors.
- `npm run build` → `✓ 58 modules transformed. ✓ built in 384ms`.
- Output sizes: **IIFE 205,360 bytes (205.25 KB gzipped 43.31 KB), ES 195,759 bytes.** Matches Phase 4 / 205KB claim exactly.

### 3. IIFE functional — PASS
`window.NimbusGanttApp` exposes plain-object shape:
```
mount: function  unmount: function  registerTemplate: function
listTemplates: function  getTemplate: function
templates: ["cloudnimbus","minimal"]
```
Both built-ins self-register on module load (confirmed via `iife-entry.ts` side-effect imports of `./templates/cloudnimbus` and `./templates/minimal`).

### 4. cloudnimbusllc.com v10 route — **FAIL (overclaim)**
**Files exist** (`page.tsx`, `DeliveryTimelineV10.tsx`, `ProFormaAdapter.tsx`) but their content is the 52-line stub committed in `f13128c`:
> stub v10 DeliveryTimelineV10 + ProFormaAdapter — @nimbus-gantt/app not yet published
> ... shows a "coming soon" placeholder and links to v9.

`DeliveryTimelineV10.tsx` contents (verbatim):
```tsx
export default function DeliveryTimelineV10() {
  return (
    <div ...>
      <p>v10 — @nimbus-gantt/app template — in progress</p>
      <p>Package not yet published. Use v9 in the meantime.</p>
      <Link href="/mf/delivery-timeline-v9">→ Go to v9</Link>
    </div>
  );
}
```
`ProFormaAdapter.tsx` returns `{ tasks: [], onPatch: () => {} }`. No import of `@nimbus-gantt/app`. No `<NimbusGanttApp />` render.

**v5/v8/v9 untouched — PASS.** `git diff HEAD` against all three returns zero bytes.

**Config bits exist but are uncommitted:**
- `package.json` has `"@nimbus-gantt/app": "file:../nimbus-gantt/packages/app"` (staged but unpushed — matches `git diff HEAD` output).
- `next.config.ts` has the `transpilePackages` + `turbopack.resolveAlias` block matching Phase 3's plan (uncommitted diff).
- `node_modules/@nimbus-gantt/app` is linked and present.

So the wiring is partially present, but the actual v10 page does not exercise it. The phase-3-status.md document describes code that never survived to HEAD — commit history shows Phase 3's real `DeliveryTimelineV10.tsx` (which did `<NimbusGanttApp template="cloudnimbus" ... />`) was replaced by the stub in commit `f13128c` on 2026-04-14 12:42 to "prevent Vercel build failures while the nimbus-gantt monorepo package is being developed." Phase 4 (Salesforce) then shipped at 12:59 — 17 minutes later.

### 5. Salesforce deployment — PASS
| Artifact | Local | Expected |
|---|---|---|
| `nimbusganttapp.resource` | 205,360 bytes | ~205KB ✓ |
| `cloudnimbustemplatecss.resource` | 48,548 bytes | ~48KB ✓ |
| `deliverytimeline.resource` | 2,489 bytes | ~2KB ✓ |
| `nimbusgantt.resource` | 267,627 bytes | legacy, retained ✓ |
| `testcssresource.resource` | — | absent ✓ (Phase 0 cleanup done) |

LWC has correct wiring:
- Line 16: `import CLOUDNIMBUS_CSS from '@salesforce/resourceUrl/cloudnimbustemplatecss';`
- Line 124: `cssUrl: CLOUDNIMBUS_CSS,` (passed into `window.DeliveryTimeline.mount`)
Two hits total, matches expectation exactly.

Latest DH commit: `0ae1a72b feat(gantt): Phase 4 — Salesforce consumes v10 template framework`. Repo clean on that path; only unrelated untracked files in `scripts/` and `force-app/main/default/profiles/` etc.

Branch is 15 commits ahead of origin (not pushed yet — this PR has been accumulating for days on `feat/priority-grouping-v5-port`).

### 6. Salesforce org state — PASS
Live query against `Delivery Hub__dev` scratch org:
```
nimbusgantt: 267627
deliverytimeline: 2489
nimbusganttapp: 205360
testcssresource: 121     ← leftover in org (only removed from repo)
cloudnimbustemplatecss: 48548
```
Matches local files. `testcssresource` still exists in the org but is the 121-byte Phase 0 probe file — harmless.

`deliverytimeline.resource` content is the v10 thin adapter (not the old in-bundle React) — calls `window.NimbusGanttApp.mount(container, { template: 'cloudnimbus', overrides: cssUrl ? { stylesheet: { url: cssUrl } } : undefined, engine: window.NimbusGantt })`. Correct per Strategy C.

### 7. Visual regression harness — PASS
All expected files in `tools/visual-regression/`:
```
capture.ts, compare.ts, run.ts, report.ts, sections.ts, targets.ts,
playwright.config.ts, package.json, package-lock.json, tsconfig.json,
README.md + diffs/, reports/, screenshots/, node_modules/
```
`package.json` has correct scripts (`capture`, `compare`, `report`, `all`) and deps (`playwright`, `pixelmatch`, `pngjs`, `tsx`). `node_modules/` + `.bin/` confirm `npm install` already ran successfully (playwright, pixelmatch, tsx all present in `.bin/`).

Smoke-test outputs exist: `diffs/_report.json`, `screenshots/_summary.json`, `reports/visual-regression-report.html`, plus `diffs/v9-vs-v10/` + `diffs/v10-vs-salesforce/` directories. Harness was actually run at least once.

### 8. Documentation — PASS
`packages/app/docs/` contains all 5 expected files:
- `README.md` (43 lines)
- `templates.md` (311 lines)
- `overrides.md` (351 lines)
- `theming.md` (380 lines)
- `examples/minimal-template.md` (277 lines)
Total 1,362 lines. Slightly shorter than Phase 6 status's claimed byte counts but all content is present and cross-referenced.

### 9. Memory files — PASS (content) / FAIL (accuracy)
- `session-april14-v10-shipped.md` present at expected path.
- `MEMORY.md` references it at line 4: *"v10 Template-as-Framework shipped end-to-end... v10 live at `/mf/delivery-timeline-v10`..."*

**Overclaim**: both files say v10 is "live" on cloudnimbusllc.com. It is not. What's live is a stub that links to v9. The session memo at line 69 does acknowledge *"nimbus-gantt — Phase 2 + Phase 5 work uncommitted (docs/, packages/app/, tools/). User will need to commit."* so the author was aware of the git gap, but did not carry that caveat into the top-of-file summary or MEMORY.md.

### 10. End-to-end smoke test — MIXED
- Salesforce side: static resources in the org, LWC wired to `CLOUDNIMBUS_CSS`, IIFE exposes template API. End-to-end render not verified (requires browser session in scratch org) but all artefacts in place.
- cloudnimbusllc.com side: **v10 route serves the stub, not the template**. Even though the file-link + Turbopack config are ready, nothing consumes them.

---

## Discrepancies between status reports and reality

| Claim | Source | Reality |
|---|---|---|
| "v10 live on cloudnimbusllc.com" | MEMORY.md line 4 | v10 is a 52-line stub. `DeliveryTimelineV10.tsx` does not import `@nimbus-gantt/app`. |
| "Phase 3: v10 route shipped... `<NimbusGanttApp template="cloudnimbus" .../>`" | phase-3-status.md §3 | That code existed in working tree at the time. It was replaced by a stub 17 min before Phase 4 commit, via `f13128c`. Neither phase-3-status-check nor phase-4-status-check caught the reversion. |
| "Regression harness correctly flags v9/v10 drift (13-16%)" | session-april14 line 21 | Harness ran, but the v10 target it measured was the stub page, not a template-rendered gantt. The drift number is meaningless for what it purports to measure. |
| "clean working tree after Phase 4" | session-april14 line 68 | True for Delivery-Hub. Not true for nimbus-gantt — Phase 2/5/6 are all untracked. |
| Phase 3 §4 "compile PASSES... v10 code itself is type-clean" | phase-3-status.md | Was true for the real v10 file at the time. Not verifiable now since that file is the stub. |

Internally within the docs tree everything is consistent (AuditStrip rename applied, Strategy C stylesheet loading described everywhere). The inconsistencies are all between docs and the working tree / git HEAD.

---

## User decisions needed

1. **Resume cloudnimbusllc.com v10 port** — is the plan to un-stub `DeliveryTimelineV10.tsx` by publishing `@nimbus-gantt/app` to npm, keep the file-link and fix the Vercel build issue that forced the stub, or let v10 stay stubbed and treat Salesforce as the sole v10 deployment?
2. **Commit nimbus-gantt work** — Phase 2 framework (`packages/app/src/templates/`, `IIFEApp.ts`, `dragReparent.ts`, `pipeline.ts`, `NimbusGanttAppReact.tsx`, etc.), Phase 5 `tools/visual-regression/`, Phase 6 `packages/app/docs/`, and all Phase 0–6 status docs under `docs/` are all untracked on `master`. Does the user want one big "v10 template framework" commit, phased commits matching the plan, or a PR branch?
3. **Delivery-Hub branch** — `feat/priority-grouping-v5-port` is 15 ahead of origin. Ready to push and open PR, or wait for visual-regression verification?
4. **testcssresource leftover in scratch org** — 121-byte Phase 0 probe still present. Purge it (destructive deploy), leave it (harmless), or keep for future CSP tests?
5. **Vercel deploy state** — even if we re-commit the real v10 code, it has never been `vercel deploy --prod`'d. What's the release gate?
6. **The 7 known follow-ups enumerated in the session memo** (no error boundary around slot overrides, no `unregisterTemplate`, dead-code sentinel in `SLOT_TO_FEATURE.ContentArea`, `ViewMode` closed union vs. doc claim, IIFE registration ordering, stylesheet replace-not-merge, no runtime override validation) — which of these, if any, are ship-blockers vs. "future"?
7. **Memory file accuracy** — should the "v10 live" line be corrected to "v10 live on Salesforce; cloudnimbusllc.com stubbed pending package publish"?

---

## Recommended next actions (before/after user returns)

**Before the user gets back:** nothing destructive. The audit is complete. Everything already on disk is recoverable.

**After the user returns, in order:**
1. Tell them about the cloudnimbusllc.com stub so MEMORY.md doesn't drift further.
2. Get a decision on Question 1 (publish vs. file-link vs. Salesforce-only).
3. Commit the nimbus-gantt work (Question 2) so the framework survives an accidental `git clean`.
4. Decide the Delivery-Hub PR flow (Question 3).
5. If re-activating cloudnimbusllc.com v10: restore `DeliveryTimelineV10.tsx` + `ProFormaAdapter.tsx` from the Phase 3 self-report (real signatures documented there), rerun `npm run build` with the existing `next.config.ts` diff applied, deploy.
6. Re-run visual regression once cloudnimbusllc.com v10 is real, not stubbed — the current baseline comparison is meaningless.

---

## What to showcase (wins)

1. **Template framework is real and builds clean.** 58 modules, 205KB IIFE, TypeScript strict-mode clean, both `cloudnimbus` and `minimal` templates self-register, full `window.NimbusGanttApp` surface (mount/unmount/registerTemplate/listTemplates/getTemplate) works.
2. **Salesforce is genuinely consuming the new framework.** Scratch org has 205KB nimbusganttapp + 48KB cloudnimbustemplatecss + 2KB thin adapter. LWC passes `cssUrl` through to the mount call. The old 99KB monolithic bundle has been decoupled — the LWC no longer ships its own gantt chrome.
3. **v5/v8/v9 are provably untouched.** `git diff HEAD` on all three returns zero bytes. The "sacred files" rule held.
4. **The visual regression harness is real code.** 11 files, dependencies installed, at least one run already executed (diffs/ + reports/ populated). Runnable in CI as soon as there's a non-stub v10 to compare.
5. **1,362 lines of public-facing developer docs.** README + templates.md + overrides.md + theming.md + minimal-template.md cover the full API surface, merge semantics, and theming pipeline — good enough to onboard an external consumer.

## What to flag (concerns)

1. **cloudnimbusllc.com v10 is a stub.** MEMORY.md and session memo say "live end-to-end" — it's not. This is a materially misleading status-report claim that the user should correct before it propagates further.
2. **All nimbus-gantt framework code, tooling, and docs are untracked.** One `git clean -fd` away from gone. Needs to be committed before any other work on that repo.
3. **Phase 5 visual regression numbers are invalid.** The 13-16% drift was measured against the stub, not against a template-rendered v10. Needs to be re-run.
4. **Delivery-Hub branch is 15 commits ahead of origin** and has never been pushed for CI validation. The Phase 4 commit on it hasn't been tested in any environment other than the one scratch org.
5. **Seven known template-framework follow-ups remain undocumented outside the session memo** — no tickets, no issues, no `TODO:` in the code. They will be forgotten unless surfaced into a tracker.

---

## What a future session needs to pick this up

- **Branch (Delivery-Hub):** `feat/priority-grouping-v5-port`, 15 commits ahead of origin. Latest: `0ae1a72b`.
- **Branch (nimbus-gantt):** `master`, last commit `47610c0`. All v10 work is uncommitted in working tree — see `git status` for the full list.
- **Branch (cloudnimbusllc.com):** `master`, last commit `eaac47a`. v10 stub at `f13128c`. Uncommitted: `next.config.ts` + `package.json` with `@nimbus-gantt/app` wiring.
- **Scratch org:** `Delivery Hub__dev` (test-bcqaurrchjr9@example.com, `00DO300000PxVm9MAF`). Has all v10 artefacts. Legacy `nimbusgantt` + Phase 0 `testcssresource` also still present.
- **Key code entry points:**
  - `C:/Projects/nimbus-gantt/packages/app/src/iife-entry.ts` — `window.NimbusGanttApp` shape
  - `C:/Projects/nimbus-gantt/packages/app/src/IIFEApp.ts` — vanilla mount pipeline
  - `C:/Projects/nimbus-gantt/packages/app/src/NimbusGanttAppReact.tsx` — React entry (uncommitted, not inspected in this audit)
  - `C:/Projects/nimbus-gantt/packages/app/src/templates/registry.ts` — template registry
  - `C:/Projects/Delivery-Hub/force-app/main/default/lwc/deliveryProFormaTimeline/deliveryProFormaTimeline.js` — LWC consumer
  - `C:/Projects/Delivery-Hub/force-app/main/default/staticresources/deliverytimeline.resource` — thin adapter ship
  - `C:/Projects/cloudnimbusllc.com/src/app/mf/delivery-timeline-v10/DeliveryTimelineV10.tsx` — stub to replace
- **Build commands:**
  - Framework: `cd C:/Projects/nimbus-gantt/packages/app && npm run build`
  - Visual regression: `cd C:/Projects/nimbus-gantt/tools/visual-regression && npm run all`
  - cloudnimbusllc.com: `cd C:/Projects/cloudnimbusllc.com && npm run dev` (port 3000 or 3001)
- **Salesforce deploy:** `cd C:/Projects/Delivery-Hub && cci task run deploy --org dev` (handles namespace tokens).
- **URLs:**
  - cloudnimbusllc.com v10 (stub): `http://localhost:3000/mf/delivery-timeline-v10`
  - cloudnimbusllc.com v9 (working): `http://localhost:3000/mf/delivery-timeline-v9`
  - Salesforce: Pro Forma Timeline Lightning tab in `Delivery Hub__dev`
