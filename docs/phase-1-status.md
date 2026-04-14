# Phase 1 Status — Gap Analysis for v10 Template Framework

**Date:** 2026-04-13
**Reviewer:** Opus 4.6 (status-check agent)
**Scope:** Deliverables from Phase 0 (CSP probe) + Phase 1A/B/C (spec + CSS + API)
**Source of truth for grading:** `docs/V10_PLAN.md`

---

## 1. Executive Verdict: **GO** (with 2 minor corrections)

Phase 1 produced the three deliverables the plan called for at a high quality level. The component spec is faithful to `DeliveryTimelineV5.tsx` (spot-checked against sidebar Props + state + v5 top-level state — all match verbatim). The CSS file is a real Tailwind-utility extraction (not minified Next.js sludge) and contains 100% of the classes listed in `v10-used-tailwind-classes.txt` (zero missing once `:where()` wrappers are accounted for). The template API covers all the abstractions Phase 2 needs (Template, FeatureFlags, ThemeTokens, ComponentSlot, overrides, registry, extends-chain resolution) and is Locker-Service-safe.

Two minor corrections must land before Phase 2 starts — neither is large. After those, Phase 2 can proceed. See sections 5 and 7 below.

---

## 2. Per-deliverable grades

| # | Deliverable | Grade | One-line verdict |
|---|---|---|---|
| 1 | `phase-0-status.md` | **A-** | Definitive "Strategy C" verdict with caveat clearly stated; implementation sketch provided; cleanup enumerated. Loses half a grade because the probe code never actually landed in the org — the verdict is reasoned from first principles + observed production-bundle patterns, not empirically measured. |
| 2 | `v10-component-spec.md` | **A** | 1850 lines, all 15 sections present, each with HTML tree + Tailwind + inline styles + dynamic classes + props + events + state. Color/feature/theme/layout/plugin constants all extracted. V8_INLINE_STYLES appendix included verbatim (lines 1622-1850). Sidebar Props + state list matches `PriorityDragSidebar.tsx` exactly. |
| 3 | `cloudnimbus.template.css` | **A-** | 720 lines, 63 KB. Real Tailwind-v4 utility extraction — theme vars, @property declarations, @layer utilities, responsive variants (sm:/md:/lg:), pseudo-variants (hover:/focus:/disabled:/active:), arbitrary values (`text-[9px]`, `z-[9999]`, `tracking-[0.15em]`), and opacity-slash utilities (`bg-fuchsia-50/60`, `text-white/70`, etc). All 229 .ng-* override rules from V8_INLINE_STYLES copied in verbatim. Font stack defined. Minor deduction for a duplicated depth-3 rule (lines 707-709 — two identical comment blocks + one selector, harmless but sloppy) and for defining `--font-sans` but `.font-mono` still referencing `--font-geist-mono` which won't resolve in Salesforce (line 331). |
| 4 | `template-api-design.md` | **B+** | Complete type surface; extension-chain resolution spelled out; per-field merge rules in a table; 9 edge cases enumerated; Locker-Service constraints explicit; file-organization concrete enough to implement from. Loses a full grade for two specific drifts — see Gaps section. |
| 5 | `v10-used-tailwind-classes.txt` | **A** | 386 classes, alphabetized, clean. Matches reality. |
| 6 | `V10_PLAN.md` | (reference only, not re-graded this round) |

---

## 3. Gaps identified (will block or degrade Phase 2)

1. **Naming collision: `AuditStrip` in API != `HrsWkStrip` in spec.**
   `template-api-design.md` lists a slot named `AuditStrip` (section 1.1, slot-to-feature mapping 5.x, root skeleton). The component spec has **no such section**; it has Section 8 `AuditPanel` (the fuchsia commit strip) and Section 9 `HrsWkStrip` (the hours-per-week sparkline). The API's `AuditStrip` name almost certainly intends to refer to the hours sparkline, but the name is actively misleading — `AuditPanel` already is an audit-related strip, and `AuditStrip` sounds like a sibling of it. Phase 2 will write a component file named after whichever side gets picked and it will cause confusion forever. **Fix:** rename `AuditStrip` → `HrsWkStrip` in `template-api-design.md` (4 call sites: types.ts SlotName union, FeatureFlags.auditStrip, slot-to-feature map, root skeleton `.nga-auditstrip`). Rename the feature flag to `hoursPerWeekStrip` or `weekStrip`.

2. **Stylesheet-loader spec contradicts Phase 0 verdict.**
   `template-api-design.md` §7 "Stylesheet loading" says: *"IIFE: read `stylesheet.url`, inject `<link>`; fallback to `<style>` with `inline`"* — but Phase 0 explicitly found that injecting `<link>` into document.head does NOT pierce synthetic-shadow LWC DOM, and mandated Strategy C: `fetch('/resource/...')` + inject `<style>` INSIDE the shadow-root container. If Phase 2 builds the loader as §7 describes, the Salesforce deploy will silently render unstyled. **Fix:** rewrite the IIFE path in §7 to match the `ensureTemplateCss` snippet in `phase-0-status.md` lines 91-101 — fetch + inject into the passed container, not document.head. The React path can stay as `import './styles.css'`.

No other Phase-2-blocking gaps found.

---

## 4. Risks identified (non-blocking but worth watching)

1. **Canvas-renderer slot model is implicit.** The API only exposes 9 slot names. Sections 10-15 of the spec (Gantt / Treemap / Bubble / Calendar / Flow / List) all funnel into `ContentArea`. Spec Section 6 does acknowledge this: *"chooses renderer by viewMode"*. But the API never documents how a custom template overrides just the Treemap renderer without replacing the entire ContentArea. If a user wants "cloudnimbus but my own bubble view" they currently have to clone ContentArea wholesale. Probably fine for v10, but document it as a known limitation.

2. **Geist font reference will break on Salesforce.** CSS line 331: `.font-mono{font-family:var(--font-geist-mono)}`. The Geist CSS variables come from Next.js's `next/font/local` and won't be defined in the Salesforce IIFE context. The fallback added at line 487 only covers `--font-sans`, not `--font-geist-mono`. v5's `.ng-grid-cell[data-field="hoursLabel"]` explicitly sets `'SF Mono', 'Cascadia Code', 'Consolas', monospace` (line 629), so the library's hours column is fine — but any `.font-mono` class elsewhere (KpiCard value, tooltip mfRef, audit sha `<code>`) will fall back to whatever the browser picks. Phase 2 should add a sibling `--font-mono` fallback.

3. **`TemplateStylesheet.importedByBundler: true` is a marker, not a mechanism.** API §1.7 declares it but never says how the framework detects "I'm in React, import the CSS file" vs "I'm in IIFE, fetch it". The React driver needs `import` statements compile-time to extract CSS — you can't conditionally import at runtime and have the bundler see it. Phase 2 will have to hardcode the React import in `cloudnimbus/index.ts` (which is fine) but the API wording implies magic that doesn't exist.

4. **`FeatureFlags` doesn't model the v5 admin-panel nested flags.** Spec section "Feature Flags" lists a `featureFlags` object inside DeliveryTimelineV5 with `showWeekends / showDependencies / showProgress / showToday / criticalPath / virtualScroll / keyboard / milestones`. These are all chart-behavior flags passed to `<NimbusGanttChart>`. `FeatureFlags` in the API has NONE of these. Phase 2 may bolt them on via `TemplateDefaults` or `SlotProps.config`, but a decision needs making: are these template-level (theme-ish) or engine-level (pass-through)?

5. **Merge semantics for `buckets` / `filters` / `views` = "Replace" is blunt.** If a consumer wants to "add one filter" to cloudnimbus they have to copy the whole `FILTER_OPTIONS` array. Phase 2 may want a `{ ...prev, append, prepend, remove }` shape. Not a Phase 2 blocker but an ergonomic cliff.

6. **Sidebar `groupBy="epic"` is in Props but not in spec.** Spec Sidebar section declares `groupBy?: "priority" | "epic"` but the `GROUP_META` table only has priority-bucket entries. Epic grouping is a v5 feature flag in DeliveryTimelineV5 but the sidebar implementation for epic mode is not fully specified. Phase 2 will discover this hole.

7. **Duplicate depth-3 CSS rule.** Lines 707-709 of `cloudnimbus.template.css` have two identical `/* ── depth 3 ... */` comments followed by one selector. Harmless (deterministic specificity) but suggests a copy-paste error in extraction. Clean up in passing.

8. **V8_INLINE_STYLES appendix in the spec is in the docs, but the CSS file already contains the same bytes.** Not wrong, but two copies of the same ~230 lines in two different files will drift. Recommend: treat `cloudnimbus.template.css` as sole source of truth and let the spec reference it by file path.

---

## 5. Corrections needed before Phase 2

Two concrete edits, both to `docs/template-api-design.md`:

1. **Rename slot `AuditStrip` → `HrsWkStrip`** (and feature flag `auditStrip` → something like `hoursPerWeekStrip` or just `weekStrip`). Call sites: §1.1 SlotName union, §1.2 FeatureFlags, §5 slot-to-feature map, §7 root skeleton className, §8 file name.
2. **Rewrite §7 IIFE stylesheet loading** to match Phase 0 Strategy C: fetch static-resource URL, inject `<style>` element inside the `container` (shadow root), NOT document.head. Keep the `<link>` path as a "not recommended, kept for debugging" fallback only. The `ensureTemplateCss` helper from `phase-0-status.md` lines 91-101 is the spec.

Optional but recommended:

3. Add a `--font-mono` fallback token to `cloudnimbus.template.css` alongside the existing `--font-sans` fallback (after line 487).
4. Delete the duplicate comment + selector at lines 707-709 of `cloudnimbus.template.css`.

None of these are large. Estimate: 30 minutes of edits.

---

## 6. Alignment with v8/v9 source — spot checks

| Check | Spec claim | v5 reality | Verdict |
|---|---|---|---|
| Sidebar `Props` interface | 8 fields (items, onMoveToGroup, onReorder, onAutoSchedule, onItemClick, onReset, isDirty, groupBy) | `PriorityDragSidebar.tsx:74-83` — 8 fields, identical names + types | **Match** |
| Sidebar local state | `capacity, lastResult, hoverGroup, indicatorBeforeId, indicatorGroup` | `PriorityDragSidebar.tsx:95-100` — all 5 names present, verbatim | **Match** |
| DeliveryTimelineV5 top-level toggle state | `sidebarOpen (false), showKpis (false), showAuditPanel (true), fullscreen (true), chromeVisible (true)` | `DeliveryTimelineV5.tsx:514-524` — all match, with the exact defaults called out | **Match** |
| `FILTER_OPTIONS` / `GROUP_ORDER` / `GROUP_LABELS` | arrays with 6/5/5 entries, specific strings | `DeliveryTimelineV5.tsx:63,92,100` — all three constants exist and exported | **Match** |
| V8_INLINE_STYLES appendix | "lines 1598-1826, verbatim" | CSS file lines 493-719 reproduce this block verbatim including comments; the `@keyframes mf-depth-check` and `.ng-gantt-container` animation trick at the end are both preserved | **Match** |

No drift found in any spot check. The port spec is trustworthy.

---

## 7. Phase 2 readiness

**Ready to start after the two §5 corrections land.** Everything Phase 2 needs is on disk: a 76KB spec that tells an implementer what DOM to produce for every slot, a 63KB CSS file that provides every utility class those components reference, a TypeScript API surface that covers the framework shape end-to-end, and a Phase 0 verdict on how to ship the CSS to Salesforce. Phase 2's first action should be to fix the `AuditStrip`→`HrsWkStrip` rename in `template-api-design.md` and the stylesheet-loader contradiction, then open the types.ts skeleton and paste in §1 of the API verbatim. From there it's mechanical: resolver, registry, react driver, iife driver, then one slot at a time starting with the simplest (ZoomBar — 4 buttons, no state).

One strategic reminder for Phase 2: the plan says "no static inline styles — only dynamic values (bucket colors, computed widths)". The spec has a LOT of dynamic style objects (category-color-based borders/backgrounds, stackOffset positioning, tooltip clamp math). Those are expected and fine. What's NOT allowed is hardcoding `style={{ padding: '4px' }}` when `px-1` is available. Keep that bright line visible during implementation.

---

**File:** `C:\Projects\nimbus-gantt\docs\phase-1-status.md`
