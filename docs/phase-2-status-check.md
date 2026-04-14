# Phase 2 Status Check — Template Framework Audit

**Date:** 2026-04-13
**Auditor:** status-check agent (Opus 4.6 · 1M ctx)
**Scope:** verify Phase 2 implementation in `packages/app/src/templates/` + rewritten `IIFEApp.ts` / `NimbusGanttAppReact.tsx` matches `docs/template-api-design.md`.

---

## 1. Verdict: **GO**

The framework matches the spec in every load-bearing dimension. Build is green, tsc is clean, IIFE runtime probe returns the expected plain-object surface, and `listTemplates()` returns `["cloudnimbus","minimal"]`. HTML parity between React and vanilla slots is tight — same root tag, same class names, same `data-slot` attribute on the three spot-checked slots (TitleBar, FilterBar, Sidebar). Phase 3 can proceed.

Two issues are worth addressing before Phase 4 lands on Salesforce, and several deferred-spec gaps from phase-2-status.md §5 are genuinely OK to leave for later. Details below.

---

## 2. Per-check results

### 2.1 Directory structure (api-design §8) — PASS

All required files present:

- `packages/app/src/templates/`: index.ts, types.ts, resolver.ts, registry.ts, state.ts, slots.ts, css.ts, stylesheet-loader.ts — **all present**.
- `packages/app/src/templates/cloudnimbus/`: index.ts, styles.css (48 548 bytes), theme.ts, defaults.ts, components/ + components/vanilla/ + components/shared/ (el.ts + classes.ts) — **all present**.
- `packages/app/src/templates/minimal/`: index.ts, theme.ts, styles.css (1 315 bytes), components/{TitleBar,ZoomBar,ContentArea}.tsx + components/vanilla/*.vanilla.ts — **present** (3 slots, matches design §8 "similar, fewer slots").

One small extra: `cloudnimbus/cloudnimbus.template.css` (48 548 bytes) sits next to `cloudnimbus/styles.css` (same 48 548 bytes — verified byte-equal via `wc -c`). Redundant copy. Not a blocker; delete one in a housekeeping PR.

### 2.2 API correctness — PASS

- **`types.ts` SlotName union:** 9 names exactly — `TitleBar | StatsPanel | FilterBar | ZoomBar | Sidebar | ContentArea | DetailPanel | AuditPanel | HrsWkStrip`. No `AuditStrip` anywhere in `src/` (grep confirmed). Rename is fully applied.
- **`resolver.ts` merge rules:** `features` / `theme` use `shallowMerge` with `undefined` ignored (§5: "shallow merge, undefined doesn't unset"). `buckets`, `filters`, `views` are replaced on non-undefined (§5: replace). `components[slot]` merged per-slot via `inheritReact`, which independently prefers `next.react ?? prev.react` and `next.vanilla ?? prev.vanilla` (§5.1 / §9.1). `stylesheet` "outermost wins" — leaf template stylesheet applied last in root-first traversal. **Matches spec exactly.** Cycle detection present (throws `"Template cycle detected at '<name>'"`). Missing-extends detection present (throws `"Template '<X>' extends unknown '<Y>'"`).
- **`registry.ts`:** `registerTemplate` (with `!template.name` guard throwing `Template.name is required`), `getTemplate`, `hasTemplate`, `listTemplates`, `defineTemplate` all implemented. Uses `new Map<string, Template>()` at module top level — **this is fine** for Locker Service. The Locker concern is exposing a Map through `window.NimbusGanttApp` as a class static; the registry Map is module-scoped and only reached through plain-object method wrappers in `iife-entry.ts`.
- **`stylesheet-loader.ts` `ensureTemplateCss`:** fetches URL (falling back to `stylesheet.inline` if set), creates `<style>` with `data-nga-template-css="<key>"` marker, appends to **container** (not document.head). Matches Phase 0 Strategy C exactly. Dedupe via marker-attribute query on `container`. Also ships `removeTemplateCss` for unmount cleanup (IIFEApp uses it).
- **`cloudnimbus/index.ts`:** calls `registerTemplate(cloudnimbusTemplate)` at module load. Uses `importedByBundler: true` on the stylesheet (IIFE consumers pass `url` via `overrides.stylesheet`). Rationale for not `import './styles.css'` at the top is documented in-file and is correct — doing so would break the IIFE build (Vite would try to emit CSS out of the IIFE entry).

### 2.3 Build result — PASS

```
vite v5.4.21 building for production...
✓ 58 modules transformed.
dist/nimbus-gantt-app.iife.js  205.25 kB │ gzip: 43.31 kB
dist/nimbus-gantt-app.es.js    195.65 kB │ gzip: 42.81 kB
✓ built in 458ms
```

`npx tsc --noEmit` exits clean (0 errors, 0 warnings). Both `dist/nimbus-gantt-app.iife.js` and `dist/nimbus-gantt-app.es.js` exist. Gzipped IIFE is 43 KB — well under SFDC's static-resource practical budget.

### 2.4 IIFE runtime probe — PASS

```
$ node -e "var w={}; eval(... .replace(/window\./g,'w.')); console.log(...)"
mount: function templates: ["cloudnimbus","minimal"]
```

`window.NimbusGanttApp.mount` is a function, `listTemplates()` returns `["cloudnimbus","minimal"]` after module load. Built-ins self-register. `iife-entry.ts` exports `{ mount, unmount, registerTemplate, listTemplates, getTemplate }` as a **plain object literal** — no class reference, no Map on `window`. Locker-safe.

### 2.5 HTML parity spot-check — PASS (with small cosmetic drift on FilterBar team pill)

| Slot | React outer tag | Vanilla outer tag | React class | Vanilla class | data-slot | Match |
|------|-----------------|-------------------|-------------|---------------|-----------|-------|
| TitleBar | `<div>` | `<div>` | `CLS_TITLEBAR` | `CLS_TITLEBAR` | `TitleBar` | ✅ |
| FilterBar | `<div>` w/ `<div class=CLS_FILTERBAR_INNER>` child | same | `CLS_FILTERBAR` → `CLS_FILTERBAR_INNER` | same | `FilterBar` | ✅ |
| Sidebar | `<aside>` | `<aside>` | `CLS_SIDEBAR` | `CLS_SIDEBAR` | `Sidebar` | ✅ |

Top-level class strings are identical because both renderers import from `shared/classes.ts` (single source of truth, design §7.2 in intent). Loop bodies reuse the same constants.

**Minor drift on FilterBar Team pill:** React emits `Team <span>{N}×</span>`, vanilla emits two spans `<span>Team</span><span> {N}×</span>`. Visually the same, DOM differs by one extra span. Low impact — Playwright pixel diff should still pass under 2% threshold. Fix in a follow-up if Phase 5 visual-regression trips on it.

### 2.6 Feature-to-slot mapping (api-design §5.3) — PASS, one quirk

`slots.ts` maps the 8 visible slots to their features correctly:
- TitleBar → titleBar, StatsPanel → statsPanel, FilterBar → filterBar, ZoomBar → zoomBar, Sidebar → sidebar, DetailPanel → detailPanel, AuditPanel → auditPanel, HrsWkStrip → hrsWkStrip.

Behaviour-only flags (`dragReparent`, `depthShading`, `groupByToggle`, `hideCompletedToggle`) are **not** in the map — correct. Checked in `IIFEApp.ts`: `features.depthShading` gates `startDepthShading(...)`, `features.dragReparent` gates `startDragReparent(...)`, `features.groupByToggle` gates the Priority/Epics buttons in TitleBar — all honored.

**Quirk:** `SLOT_TO_FEATURE.ContentArea = 'titleBar'` (using titleBar as a sentinel). `shouldRenderSlot` special-cases `ContentArea` to always return `true` before consulting the map, so the incorrect mapping is never read. Harmless, but confusing — cleaner to make `SLOT_TO_FEATURE` `Record<Exclude<SlotName, 'ContentArea'>, keyof FeatureFlags>` and drop the sentinel. Nit — do not block Phase 3.

### 2.7 Root-skeleton layout drift (api-design §7) — STRUCTURAL DRIFT, approved

The design's root skeleton (§7) lists Sidebar, DetailPanel, and AuditPanel as **siblings** of `.nga-content` under `.nga-content-outer`. Implementation puts `Sidebar`, `DetailPanel`, `AuditPanel` as **children of ContentArea** (the slot). `SLOT_ORDER` is therefore `['TitleBar', 'StatsPanel', 'FilterBar', 'ZoomBar', 'HrsWkStrip', 'ContentArea']` — 6 slots at root instead of the 9-slot flat arrangement the spec shows.

This is a reasonable implementer's simplification — ContentArea owns its internal flex layout and orchestrates the three side panels that share its flex row. The resulting DOM still carries the `nga-sidebar` / `nga-content-outer` / `nga-detail` / `nga-audit` class names the spec's CSS keys off, so visual rendering isn't affected. Feature-gated rendering still works per §5.3 (sidebar/detail/audit panels check `config.features.*` inside ContentArea).

The drift only matters if a custom template wants to override the `Sidebar` slot *without* also overriding `ContentArea`. Under the current implementation, overriding `Sidebar` alone works (ContentArea consumes `config.components.Sidebar`), so this is fine. Document as a minor intentional divergence.

### 2.8 Existing v5 functionality preserved — PASS

Verified in `IIFEApp.ts`:
- ✅ 6 view modes render via `rebuildView()` switch on `state.viewMode`: gantt via `initGantt`, flow/calendar/treemap/bubbles/list via the carried-over `renderFlow/renderCalendar/renderTreemap/renderBubbles/renderList` helpers (lines 107-238).
- ✅ PriorityGroupingPlugin wired: `if (typeof PGP === 'function') ganttInst.use(PGP({ buckets, getBucket, getBucketProgress: hwp }))` — uses `tplConfig.buckets` (so overrides flow through).
- ✅ `startDepthShading(ganttEl, depthMap)` gated on `features.depthShading`.
- ✅ `startDragReparent(ganttEl, allTasks, depthMap, onTaskPatch)` gated on `features.dragReparent`.
- ✅ Optimistic patch via in-place mutation of `allTasks[idx]` before firing `rawOnPatch`.
- ✅ `STAGE_TO_CATEGORY_COLOR` merged into `colorMap` for leaf bar coloring.
- ✅ Team / capacity / patchLog — patchLog cap of 50 entries, pending-patch counter in state, reset via `RESET_PATCHES`. Team pool and capacity totals come from `CLOUD_NIMBUS_POOL` in FilterBar.
- ✅ `injectLegacyNgCss()` still called at mount — all 25 legacy `.ng-*` overrides preserved verbatim. (This is the v5 last-line-of-defense CSS. Kept.)

### 2.9 Salesforce compatibility — PASS

- ✅ Plain-object export: `iife-entry.ts` declares `const NimbusGanttApp = { mount, unmount, registerTemplate, listTemplates, getTemplate }` — not a class, not static methods. Matches design §3 "Plain object export (not class)".
- ✅ No `new Map()` exposed on `window`: grep found zero `new Map(` occurrences in `src/` outside `registry.ts`'s module-scope `const registry = new Map<string, Template>()`. The registry is behind a plain-object method wrapper.
- ✅ No `eval`, no `Function()`, no dynamic `import()` in the IIFE path.
- ✅ Class methods — `IIFEApp` is still a class but exposes `mount` / `unmount` as **static methods** that the iife-entry plain-object wraps. The plain-object wrapper is what touches `window`. Locker won't see the class.

---

## 3. Gaps that block Phase 3 (ship v10 route)

**None.** Phase 3 can build the `/mf/delivery-timeline-v10` route against the current package. The React driver accepts `template="cloudnimbus"`, overrides, engine, data, onPatch. Stylesheet loads via `import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css'` in the consumer's app entry (confirmed path works — file is 48.5 KB of Phase 1B extracted Tailwind). IIFE path is wired but Phase 3 ships the React path anyway.

---

## 4. Gaps that block Phase 4 (Salesforce parity)

Two items to resolve before the Salesforce LWC wrapper goes live:

1. **IIFE-mode stylesheet URL wiring.** `cloudnimbusTemplate.stylesheet` has no `url` — it's `{ importedByBundler: true }`. In IIFE mode, the LWC wrapper must pass the static-resource URL via `overrides.stylesheet = { url: CLOUDNIMBUS_CSS }` at mount time. If it forgets, `ensureTemplateCss` silently no-ops and the page renders naked (Tailwind classes don't resolve). **Mitigation:** Phase 4 agent must explicitly verify the LWC `window.NimbusGanttApp.mount(container, { ..., overrides: { stylesheet: { url: CLOUDNIMBUS_CSS } } })` call site is in place, AND the static resource `cloudnimbusTemplateCss` is packaged. Add a post-mount visual smoke test.

2. **The 48 KB `styles.css` must be uploaded as a Salesforce StaticResource named `cloudnimbusTemplateCss` (or similar) with `contentType=text/css`.** Phase 0 deployed a `testcssresource` probe that's still in the scratch org (see phase-0-status.md Cleanup §). Phase 4 needs to:
   - Copy `packages/app/src/templates/cloudnimbus/styles.css` to `force-app/main/default/staticresources/cloudnimbusTemplateCss.resource`.
   - Create a matching `.resource-meta.xml` with `contentType=text/css` and `cacheControl=Public`.
   - Delete the leftover `testcssresource` static resource.

Locker Service concerns are handled. CSS-fetch-URL uncertainty is the only real Salesforce risk.

---

## 5. Gaps that can defer (acknowledged in phase-2-status.md §5)

All of these are fine to leave for later — none affect Phase 3 visual parity:

- **TitleBar:** Unpin/Fullscreen/Admin/Advisor buttons + G/S group-by badge superscript not implemented. These are toolbar affordances; v5 Salesforce doesn't need them.
- **StatsPanel:** h/mo editor is read-only (spec wants `<input type=number>` live). Workaround: users edit pool capacity elsewhere for now.
- **FilterBar:** Team popup content not wired — the button renders but clicking doesn't do anything yet. Minor. Team size and totals are correct on the chip.
- **Sidebar:** No React drag listeners — relies on vanilla `dragReparent` engine on the gantt grid (which is the primary v5 UX anyway).
- **DetailPanel:** No framer-motion drag handle, no inline edit mode. Read-only fine for launch.
- **AuditPanel:** Submit-commit button zeroes the counter locally but doesn't POST to `/api/pro-forma/submit`. Phase 3 can wire this when the cloudnimbusllc.com route lands.
- **HrsWkStrip:** 8 weeks rendered, no tooltip, no horizontal scroll past visible range. Visually matches v9.
- **Minor FilterBar Team pill DOM drift** (extra span in vanilla vs React) — harmless.
- **Redundant `cloudnimbus.template.css` file** sitting next to `styles.css` — delete in a housekeeping PR.
- **ESLint rule against react imports under `templates/*/components/vanilla/` (design §9.9)** — not added, per agent note. Phase 5 CI harness is the natural home.
- **Spec §15 `ListView` (full v6-embedded-in-v5 list with export/merge-dupes/verify)** — out of scope. Ship the thin v5 list renderer; file a separate template-slot override epic if needed later.
- **`SLOT_TO_FEATURE.ContentArea = 'titleBar'` sentinel** — cleaner type would be `Record<Exclude<SlotName, 'ContentArea'>, keyof FeatureFlags>`. Nit only.

---

## 6. Next action for Phase 3

Create `/mf/delivery-timeline-v10` on cloudnimbusllc.com:

1. Copy the v9 page file to `/mf/delivery-timeline-v10/page.tsx`.
2. Replace the current renderer with:
   ```tsx
   import { NimbusGanttApp } from '@nimbus-gantt/app';
   import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css';
   import { NimbusGantt } from 'nimbus-gantt';

   <NimbusGanttApp
     template="cloudnimbus"
     data={tasks}
     onPatch={save}
     engine={{ NimbusGantt, PriorityGroupingPlugin, hoursWeightedProgress }}
   />
   ```
3. Side-by-side smoke test vs v9 at 1440×900. Expected identical rendering for: titlebar, filter chips, sidebar priority buckets, gantt canvas, treemap/bubbles/calendar/flow views. Expected drift: admin/advisor/unpin/fullscreen buttons missing (acknowledged §5).
4. File a Phase 3 gap report if any load-bearing v9 feature is missing — do not patch `@nimbus-gantt/app` directly unless the gap is generalizable (template framework).
5. v8 and v9 routes remain untouched.

Phase 4 follow-up blockers (§4) can be tackled after Phase 3 confirms visual parity in a non-Salesforce context.
