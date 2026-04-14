# Phase 2 Status — Template Framework Implementation

**Date:** 2026-04-13
**Agent:** Opus 4.6 (implementation)
**Scope:** Build the v10 template framework in `packages/app/src/templates/` and rewrite `IIFEApp.ts` + `NimbusGanttAppReact.tsx` to consume it.
**Source of truth:** `docs/template-api-design.md` + `docs/v10-component-spec.md` + Phase 1 corrections (§5 of `phase-1-status.md`).

---

## 1. Files created (31)

### Core framework (`packages/app/src/templates/`)
1. `packages/app/src/templates/types.ts` — full type surface per API design §1
2. `packages/app/src/templates/registry.ts` — Map-based registry + `defineTemplate`
3. `packages/app/src/templates/resolver.ts` — extension chain + per-field merge + `inheritReact` / `inheritVanilla`
4. `packages/app/src/templates/state.ts` — `INITIAL_STATE` + `reduceAppState`
5. `packages/app/src/templates/slots.ts` — `SLOT_TO_FEATURE` map + `shouldRenderSlot` + `SLOT_ORDER`
6. `packages/app/src/templates/css.ts` — `themeToCssVars` + `themeToScopedCss`
7. `packages/app/src/templates/stylesheet-loader.ts` — `ensureTemplateCss` (Phase 0 Strategy C: fetch + inject `<style>` into container)
8. `packages/app/src/templates/index.ts` — public API barrel

### cloudnimbus template
9. `packages/app/src/templates/cloudnimbus/index.ts` — `cloudnimbusTemplate` + self-registration
10. `packages/app/src/templates/cloudnimbus/styles.css` — copy of `cloudnimbus.template.css` (48 KB, identical bytes)
11. `packages/app/src/templates/cloudnimbus/theme.ts` — `cloudnimbusTheme: ThemeTokens`
12. `packages/app/src/templates/cloudnimbus/defaults.ts` — `CLOUD_NIMBUS_PRIORITY_BUCKETS`, `CLOUD_NIMBUS_FILTERS`, `CLOUD_NIMBUS_VIEW_MODES`, `CLOUD_NIMBUS_POOL`, `CLOUD_NIMBUS_CATEGORIES`
13. `packages/app/src/templates/cloudnimbus/components/index.ts` — React slot barrel
14. `packages/app/src/templates/cloudnimbus/components/TitleBar.tsx`
15. `packages/app/src/templates/cloudnimbus/components/StatsPanel.tsx`
16. `packages/app/src/templates/cloudnimbus/components/FilterBar.tsx`
17. `packages/app/src/templates/cloudnimbus/components/ZoomBar.tsx`
18. `packages/app/src/templates/cloudnimbus/components/Sidebar.tsx`
19. `packages/app/src/templates/cloudnimbus/components/ContentArea.tsx`
20. `packages/app/src/templates/cloudnimbus/components/DetailPanel.tsx`
21. `packages/app/src/templates/cloudnimbus/components/AuditPanel.tsx`
22. `packages/app/src/templates/cloudnimbus/components/HrsWkStrip.tsx`
23. `packages/app/src/templates/cloudnimbus/components/vanilla/index.ts` — vanilla slot barrel
24. `packages/app/src/templates/cloudnimbus/components/vanilla/TitleBar.vanilla.ts`
25. `packages/app/src/templates/cloudnimbus/components/vanilla/StatsPanel.vanilla.ts`
26. `packages/app/src/templates/cloudnimbus/components/vanilla/FilterBar.vanilla.ts`
27. `packages/app/src/templates/cloudnimbus/components/vanilla/ZoomBar.vanilla.ts`
28. `packages/app/src/templates/cloudnimbus/components/vanilla/Sidebar.vanilla.ts`
29. `packages/app/src/templates/cloudnimbus/components/vanilla/ContentArea.vanilla.ts`
30. `packages/app/src/templates/cloudnimbus/components/vanilla/DetailPanel.vanilla.ts`
31. `packages/app/src/templates/cloudnimbus/components/vanilla/AuditPanel.vanilla.ts`
32. `packages/app/src/templates/cloudnimbus/components/vanilla/HrsWkStrip.vanilla.ts`
33. `packages/app/src/templates/cloudnimbus/components/shared/el.ts` — DOM helpers
34. `packages/app/src/templates/cloudnimbus/components/shared/classes.ts` — single-source-of-truth class constants

### minimal template
35. `packages/app/src/templates/minimal/index.ts`
36. `packages/app/src/templates/minimal/theme.ts`
37. `packages/app/src/templates/minimal/styles.css`
38. `packages/app/src/templates/minimal/components/TitleBar.tsx`
39. `packages/app/src/templates/minimal/components/ZoomBar.tsx`
40. `packages/app/src/templates/minimal/components/ContentArea.tsx`
41. `packages/app/src/templates/minimal/components/vanilla/TitleBar.vanilla.ts`
42. `packages/app/src/templates/minimal/components/vanilla/ZoomBar.vanilla.ts`
43. `packages/app/src/templates/minimal/components/vanilla/ContentArea.vanilla.ts`

### Deliverable doc
44. `docs/phase-2-status.md` — this report

**Total:** 43 new source files + 1 new doc.

## 2. Files modified (4)

- `packages/app/src/IIFEApp.ts` — rewritten: resolves a template, mounts vanilla slots via `SLOT_ORDER`, delegates to the existing alt-view renderers (list/treemap/bubbles/calendar/flow) + the nimbus-gantt engine via the ContentArea host. All existing behaviours preserved: depthShading, dragReparent, all 6 view modes, search/filter, STAGE_TO_CATEGORY_COLOR coloring, engine auto-detection on `window.NimbusGantt`.
- `packages/app/src/NimbusGanttAppReact.tsx` — rewritten: renders React slots from the resolved template, imperatively mounts the IIFEApp gantt engine inside the ContentArea host. Legacy `tasks` prop still accepted; new `template`, `data`, `overrides`, `engine` props added per API design §2.
- `packages/app/src/iife-entry.ts` — plain-object export extended with `registerTemplate`, `listTemplates`, `getTemplate`. Still a plain object (Locker Service safe).
- `packages/app/src/index.ts` — barrel extended: re-exports the full template API surface per API design §10.
- `packages/app/tsconfig.json` — added `"jsx": "react-jsx"`, bumped target to `ES2019` to match TSX consumers, added `esModuleInterop` + `isolatedModules`.

`pipeline.ts`, `depthShading.ts`, `dragReparent.ts`, `types.ts`, `renderers/treemap.ts`, `renderers/bubble.ts` — all unchanged as specified.

## 3. Build result

```
vite v6.4.1 building for production...
✓ 59 modules transformed.
dist/nimbus-gantt-app.iife.js  205.56 kB │ gzip: 43.34 kB
dist/nimbus-gantt-app.es.js    195.95 kB │ gzip: 42.83 kB
✓ built in 445ms
```

`npx tsc --noEmit` exits clean (0 errors, 0 warnings). Gzipped IIFE bundle is 43 KB — comfortable under the 100 KB Salesforce static-resource budget.

## 4. IIFE verification

```
$ node -e "var w={}; ...eval... console.log(typeof w.NimbusGanttApp?.mount)..."
mount: function
unmount: function
registerTemplate: function
listTemplates: function
templates: ["cloudnimbus","minimal"]
```

All four surface methods exist on `window.NimbusGanttApp` after IIFE evaluation. `listTemplates()` returns both built-in templates. The object is a plain object (not a class reference) — confirmed by the earlier CLAUDE.md/Locker rule: `window.NimbusGanttApp = NimbusGanttApp.NimbusGanttApp || NimbusGanttApp` in `vite.config.ts` footer.

## 5. Known gaps / deliberate scope limits

1. **React components render simplified DOM compared to v10-component-spec.md §1-§15.** The spec has fifteen 20+-line sections; the slot React components implement the visual skeleton (same class names, same slot hierarchy, data-testid hooks on AuditPanel + FilterBar search) but stop short of some features:
   - `TitleBar`: Unpin/Fullscreen/Admin/Advisor buttons not implemented. Group-by superscript badge (`G`/`S`) not implemented.
   - `StatsPanel`: inline h/mo editor is read-only (spec has a live `<input type="number">`).
   - `FilterBar`: Team popup, dirty-state rose-pill reset chip are rendered but the Team popup content is not yet wired.
   - `Sidebar`: no real drag listeners in the React slot — relies on the vanilla `dragReparent` engine on the gantt grid (which is the primary v5 UX anyway). Capacity input + auto-schedule button visual-only.
   - `DetailPanel`: no framer-motion drag. Fields are read-only; inline edit mode not ported.
   - `AuditPanel`: "Submit + commit" button zeroes the pending-patch counter but does not yet POST to `/api/pro-forma/submit`. API docs link omitted.
   - `HrsWkStrip`: 8 weeks (spec: 8) but no tooltip, no horizontal scroll past the visible range.
   - Gantt/List/Treemap/Bubble/Calendar/Flow renderers: delegated to the existing IIFEApp vanilla implementations from v5. The ContentArea slot exposes a `[data-nga-gantt-host]` host div that IIFEApp populates imperatively. This is the "same rendering everywhere" contract — Phase 3 and Phase 4 both consume the exact same IIFE engine.

   **Impact:** The cloudnimbusllc.com v10 route (Phase 3) should render pixel-compatible with v9 for the 80% case (gantt view, filter chips, priority sidebar, audit strip). The 20% gap (admin panel, advisor panel, resource panel, fullscreen toggle, unpin chrome, inline edit in detail panel) is intentionally deferred — these are toolbar affordances that don't ship in Salesforce anyway.

2. **React CSS import not added to `cloudnimbus/index.ts`.** Per design §9.3, `importedByBundler: true` is a marker, not a mechanism. Consumers that use the React driver must add `import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css'` in their own app entry. The minimal stylesheet is similarly marker-only. Adding `import './styles.css'` to cloudnimbus/index.ts would have broken the IIFE build (Vite would try to emit CSS out of the IIFE entry), so I kept the import out of the shared module. Document this in Phase 3 when wiring /mf/delivery-timeline-v10.

3. **Stylesheet URL defaults to undefined for cloudnimbus.** In IIFE mode, consumers must pass a URL via `overrides.stylesheet.url = CLOUDNIMBUS_CSS` (a `@salesforce/resourceUrl` import) for Strategy C loading to kick in. The LWC wrapper (Phase 4) will do this. If undefined, `ensureTemplateCss()` is a no-op and the raw IIFE still renders — Tailwind classes just won't resolve. Acceptable fallback.

4. **Minimal template CSS is smaller (~1 KB) but also untested.** It has `.nga-root`, `.nga-titlebar`, `.nga-content-outer`, `.nga-content`, and handful of flex utilities. Phase 3 verification will tell whether minimal is good enough for the "override everything" use case or whether Phase 5 visual-regression picks up too much drift.

5. **ESLint rule `no react imports under templates/*/components/vanilla/` (design §9.9) not added.** Out-of-scope for this agent — no ESLint config currently in the package. Phase 5 (CI harness) is the natural home for this rule.

6. **Spec §15 `ListView` (AuditListView)** is the full v6-embedded-in-v5 experience with drag/drop, export menus, merge-dupes, verify-against-DH, etc. We ship only the thin list renderer from the v5 IIFEApp carry-over. A richer "audit list" view can land as a separate template-slot override later.

## 6. Next action for Phase 3

Ship the `/mf/delivery-timeline-v10` route on cloudnimbusllc.com using:

```tsx
import { NimbusGanttApp } from '@nimbus-gantt/app';
import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css';

<NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save} engine={NimbusGantt} />
```

Phase 3 verification should compare v10 side-by-side with v9 at 1440×900 (the Playwright default used in Phase 5) and tolerate drift only in:
- the gaps listed in §5.1 above (admin/advisor/unpin/fullscreen buttons)
- gantt canvas rendering (same engine, should be bit-identical)
- audit history panel content (logic ported but not wired to an API yet)

Phase 3 agent should check out the cloudnimbusllc.com repo, copy the v9 page, swap the renderer for `NimbusGanttApp`, and confirm the template CSS is imported at app bootstrap so the Tailwind utility classes resolve. If any v9 feature is load-bearing and not yet ported, file a Phase 3 gap report rather than diverging from the template framework.

---

**Phase 2: COMPLETE.** Ready for Phase 3 approval gate.
