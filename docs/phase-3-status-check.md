# Phase 3 Status Check — v10 Ship Audit

**Date:** 2026-04-13
**Auditor:** Opus 4.6 (1M ctx) — independent status-check agent
**Subject:** Phase 3 self-report at `docs/phase-3-status.md` (implementation agent's claims)
**Scope:** Confirm `/mf/delivery-timeline-v10` ships cleanly, v5/v8/v9 unmodified, adapter wiring correct, and Phase 4 prereqs are in place.

---

## 1. Verdict: **GO for Phase 4, with a scheduled Phase 3b**

Phase 3 is functionally complete. v10 route exists, compiles, serves HTTP 200, loads the template stylesheet chunk, and the monorepo wiring resolves cleanly. v5/v8/v9 are byte-for-byte unmodified. Adapter field mapping and mutation method names are accurate against the real `useProFormaState` hook.

**Why not a clean GO?** The live smoke test could only validate the MFAuthGate shell (both v9 and v10 return identical unauthenticated HTML — the gantt chrome never renders via SSR). Post-login visual parity has NOT been validated by this agent. That requires a browser-session check (Phase 3b).

---

## 2. Sacred files check — **PASS**

`git diff HEAD -- src/app/mf/delivery-timeline-v5 src/app/mf/delivery-timeline-v8 src/app/mf/delivery-timeline-v9` returns **zero bytes** of diff.

Only untracked additions in the v10 tree (correct) and one pre-existing untracked file `src/app/mf/delivery-timeline-v5/ProFormaAdapter.tsx` that was NOT created by Phase 3 (confirmed by Phase 3 self-report §6; git log shows no commit history for it, and the file mtime predates Phase 3 work).

v8 and v9 are 21-line `page.tsx` files that import `DeliveryTimelineV5` directly — so "keeping v5 untouched" is equivalent to keeping v8 and v9 functional. Verified.

---

## 3. v10 route — **PASS (compile + run) / PARTIAL (render)**

| Check | Result |
|-------|--------|
| `page.tsx` matches v8's pattern (MFAuthGate + metadata export) | PASS |
| `DeliveryTimelineV10.tsx` imports `NimbusGanttApp` from `@nimbus-gantt/app` | PASS |
| Template stylesheet imported via aliased `@nimbus-gantt/app/styles.css` | PASS |
| `ProFormaAdapter.tsx` uses `NormalizedTask` + `TaskPatch` types from package | PASS |
| `next build` Turbopack compile step | PASS (65s, "Compiled successfully") |
| `next build` TypeScript step | FAIL but pre-existing (`vite.salesforce.config.ts` missing vite dep) — not caused by v10, present on `master` without Phase 3 work |
| Dev server HTTP 200 on `/mf/delivery-timeline-v10` | PASS (112,090 bytes) |
| Dev server HTTP 200 on `/mf/delivery-timeline-v9` | PASS (113,679 bytes) |
| Cloudnimbus template CSS chunk emitted (`nimbus-gantt_packages_app_src_templates_cloudnimbus_styles_a8442ab0.css`) | PASS — visible in v10 HTML `<link>` tags |

---

## 4. Adapter correctness — **PASS**

Verified against `C:/Projects/cloudnimbusllc.com/src/hooks/useProFormaState.ts`:

| Adapter call | Hook method exists? | Signature match? |
|---|---|---|
| `proForma.updateItem(id, { parentId })` | Yes (L370-379) | PASS — takes `(itemId, Partial<ProFormaItem>)` |
| `proForma.updateDates(id, start, end)` | Yes (L313-339) | PASS — takes `(itemId: string, start: string, end: string)` |
| `proForma.moveToGroup(id, group)` | Yes (L259-270) | PASS — takes `(itemId, ProFormaGroup)`; adapter casts `patch.priorityGroup as ProFormaGroup` |
| `proForma.reorder(id, newIndex)` | Yes (L272-311) | PASS — takes `(itemId, newIndex: number)` |

No ghost methods. No renamed-in-hook / old-name-in-adapter traps. The drag-reparent round trip (template `onPatch({ id, priorityGroup })` → adapter → `moveToGroup`) is correctly wired.

**Field mapping (`toTask`)** — PASS:
- `id`, `title`, `name` — direct
- `priorityGroup` — `it.group ?? getGroup(it)` (handles override + derived)
- `parentWorkItemId`, `startDate`, `endDate` — direct pass-through with null coalescing
- `estimatedHours` ← `hoursHigh`, `estimatedHoursLow` ← `hoursLow`, `loggedHours` ← `hoursLogged ?? 0`
- `stage` ← `category`, `sortOrder` ← `getSortOrder(it)`, `isInactive` ← `category === 'paused' || 'done'`
- `developerName` ← `owner || ''`

One latent risk flagged: adapter's `onPatch` is `useCallback(..., [proForma])` — depends on the entire proForma object, which rebuilds every render (useState + useCallback refs don't memoize the top-level object). Not a correctness bug (the inner hook refs are stable) but means `onPatch` gets a fresh identity each render. Acceptable for v10; worth tidying later if React sees strict-mode double-render pressure.

---

## 5. Monorepo wiring — **PASS (with 3 documented workarounds)**

| Check | Result |
|---|---|
| `package.json`: `"@nimbus-gantt/app": "file:../nimbus-gantt/packages/app"` | PASS (line 18) |
| `next.config.ts`: `transpilePackages: ['@nimbus-gantt/app']` | PASS (line 11) |
| Turbopack `resolveAlias` for bare package + styles subpath | PASS (lines 22-26) |
| `turbopack.root: '..'` to widen filesystem root | PASS (line 20) |

The three knobs defeat three real Turbopack resolver issues, all correctly explained in phase-3-status.md §7:
1. `main: "src/index.ts"` — TS-not-JS entry; alias forces the `.ts` resolution.
2. Restrictive `exports` field — blocks deep imports; aliased virtual subpath works around it.
3. Monorepo symlink outside root — widening root to `..` follows the link.

**Phase 6 task flagged:** Ship a built `dist/` from `@nimbus-gantt/app` with proper `exports` subpaths so downstream React consumers don't need these workarounds. Not a Phase 3 blocker. (IIFE dist already exists — see §7.)

---

## 6. Live smoke test — **PASS on shell / BLOCKED on chrome**

Dev server on port 3099:
- v9 → HTTP 200, 113,679 bytes
- v10 → HTTP 200, 112,090 bytes

Both routes return the MFAuthGate sign-in shell (31 `<div>` elements, 2 `MFAuthGate` markers, identical first-3 buttons). Neither SSR-renders the gantt chrome because MFAuthGate short-circuits before mounting children.

| Metric | v9 | v10 |
|---|---|---|
| `<div>` count | 31 | 31 |
| `data-slot` count | 0 | 0 |
| `nga-*` class count | 0 | 0 |
| First 3 button texts | (identical) | (identical) |

**CSS evidence v10 will style correctly once authed:** v10's response HTML includes the emitted Next.js CSS chunk `nimbus-gantt_packages_app_src_templates_cloudnimbus_styles_a8442ab0.css`. The 726-line Tailwind-utility stylesheet is extracted at build time and served — Tailwind classes used by the template slot components (bg-white, text-slate-900, flex, rounded-full, etc. — visible in the cloudnimbus styles.css) WILL resolve at runtime.

**JS chunks v10 loads:** only the v10 page chunk (`delivery-timeline-v10_page_tsx_50cc1be1._.js`). v9 loads v5 component chunks. **This is fine** — both are at the auth gate, neither has split-chunked the gantt subtree into SSR yet. The gantt + template bundle will resolve client-side after sign-in.

First 20 classnames from v10 (all Tailwind utilities from the marketing shell):
`bg-gradient-to-r from-slate-800 to-slate-900 text-white text-center`, `sticky top-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl`, `max-w-7xl mx-auto`, `flex items-center gap-2.5 group`, etc. — full Tailwind density, not stripped.

---

## 7. Phase 4 prerequisites — Exact file locations

| What Phase 4 needs | Path | Verified? |
|---|---|---|
| IIFE bundle for Salesforce Static Resource | `C:/Projects/nimbus-gantt/packages/app/dist/nimbus-gantt-app.iife.js` (205 KB, `var NimbusGanttApp = function(exports) { ... }`) | PASS |
| Template CSS for Salesforce Static Resource | `C:/Projects/nimbus-gantt/packages/app/src/templates/cloudnimbus/styles.css` (726 lines, Tailwind utilities + ng-* overrides, no runtime Tailwind dep) | PASS |
| ES module (optional, if SF ever imports as ESM) | `C:/Projects/nimbus-gantt/packages/app/dist/nimbus-gantt-app.es.js` (195 KB) | PASS |
| Adapter contract for SF LWC wrapper | `NimbusGanttApp({ template: 'cloudnimbus', data: NormalizedTask[], onPatch: (TaskPatch) => void, engine: { NimbusGantt, PriorityGroupingPlugin, hoursWeightedProgress } })` — matches v10's call site in `DeliveryTimelineV10.tsx` | PASS |
| Stylesheet URL wiring for IIFE mode | LWC wrapper must pass `overrides.stylesheet.url = <static-resource-URL>` at `mount()` time, OR set `cloudnimbusTemplate.stylesheet.url` before mount. Template defines `importedByBundler: true` for React path only; IIFE consumers must provide URL. | FLAGGED in phase-3-status §8 — Phase 4 must explicitly verify the call site or `ensureTemplateCss` silently no-ops and Tailwind won't resolve in SF. |

Suggested SF Static Resource names (per phase-3-status §8): `cloudnimbusTemplateCss` (contentType=text/css, cacheControl=Public).

---

## 8. Gaps for Phase 3b (visual parity)

The audit could not perform post-login visual diff via curl (MFAuthGate is client-side after initial load; requires browser automation). Phase 3b should:

1. **Authenticated DOM diff:** use Playwright to sign in, screenshot both `/mf/delivery-timeline-v9` and `/mf/delivery-timeline-v10` at 1440×900, count post-auth `<div>`s in the gantt tree, count elements carrying `nga-*` or `data-slot` in v10, count `grouping-bar`/`priority-group` in v9. If v10 shows an empty slot tree (toolbar missing, sidebar missing), drop to HOLD and fix before Phase 4.
2. **Drag-reparent exercise:** drag one item from NOW→NEXT in v10, confirm state flows `onPatch` → `moveToGroup` → rerender → bucket reassigned. Confirms §4 wiring at runtime, not just statically.
3. **Stats panel numerics:** v9 and v10 must show identical total-hours / item counts given the same seed data (both consume `useProFormaState` → identical baseline).

None of these block Phase 4 starting. They block the "v10 visually matches v9" approval gate stated in V10_PLAN §Approval gates #4. Phase 4 work can proceed in parallel with 3b.

---

## 9. Next action for Phase 4

**Start here:**

1. Build the IIFE — already done, at `packages/app/dist/nimbus-gantt-app.iife.js` (205 KB). Confirm build is current: `cd C:/Projects/nimbus-gantt/packages/app && npm run build`.
2. Upload two Static Resources to the target Salesforce scratch/sandbox:
   - `cloudnimbusTemplateCss` ← `packages/app/src/templates/cloudnimbus/styles.css` (text/css, Public)
   - `nimbusGanttAppIife` ← `packages/app/dist/nimbus-gantt-app.iife.js` (application/javascript, Public)
3. Update or create the LWC wrapper that consumes `window.NimbusGanttApp.IIFEApp.mount(container, { template: 'cloudnimbus', data, onPatch, overrides: { stylesheet: { url: CLOUDNIMBUS_CSS_URL } } })`. The `overrides.stylesheet.url` is load-bearing — omit it and the page renders unstyled.
4. Delete the Phase 0 `testcssresource` probe from the scratch org (cleanup noted in phase-3-status §8).
5. Wire the LWC's `data` prop to the Salesforce WorkItem adapter that maps SObject rows → `NormalizedTask[]` with the SAME field contract validated in §4 above (id, title, priorityGroup, parentWorkItemId, startDate, endDate, estimatedHours, estimatedHoursLow, loggedHours, stage, sortOrder, isInactive, developerName).
6. Run Phase 4 status-check agent to confirm v10/SF visual parity before gate #5.

**Do NOT** try to also convert SF to the React driver — Phase 4 is IIFE-only per V10_PLAN.

---

## Summary table

| Check | Result |
|---|---|
| Sacred files (v5/v8/v9) | PASS — zero diff |
| v10 route exists + compiles | PASS |
| v10 HTTP 200 | PASS |
| Adapter method names match hook | PASS (all 4: updateItem, updateDates, moveToGroup, reorder) |
| Adapter field mapping | PASS (13 fields verified) |
| Monorepo wiring | PASS (3 documented Turbopack workarounds, justified) |
| Template CSS chunk served | PASS (visible in v10 HTML) |
| IIFE bundle exists for SF | PASS (205 KB at packages/app/dist/) |
| Post-login visual parity | NOT TESTED — Phase 3b |
| Pre-existing typecheck error | Unchanged — not caused by Phase 3 |

**Gate:** GO for Phase 4. Schedule Phase 3b in parallel for visual/interaction parity sign-off before the combined V10_PLAN gate #4.
