# nimbus-gantt — HANDOFF

**📣 Latest cut: 0.199.1 zoom-blank-canvas + Views-clip fixes (2026-06-06).**
**TWO-bundle cut** (core AND app changed) — from the live v12 punch-list.
- **Month/Quarter zoom → blank canvas (CORE, high).** Zooming out shrank the
  timeline but `scrollX` stayed stale, so `ctx.translate(-scrollX,0)` pushed all
  bars off the left edge — DOM lanes showed, canvas bars vanished (Day/Week had
  enough width to survive). Fix: clamp scrollX/scrollY to the content extent in
  `NimbusGantt.render()` (also covers window-resize/row-collapse); syncs the DOM
  scrollbar + persists SET_SCROLL when it bites; in-range renders untouched.
- **Views dropdown clipped behind the toolbar (APP).** 0.199.0's `position:
  absolute` menu was clipped by the titlebar overflow context. Fix: `position:
  fixed` anchored to the trigger's measured rect (rAF after attach, viewport-
  clamped, LWS-guarded) + max-height/scroll for long lists.
- Core version literal bumped **0.198.0 → 0.199.1**. (Punch-list #4 — editing
  ops not firing via automation — is a synthetic-event limitation; needs a human
  click-through, no code change.)
Re-copy **BOTH** bundles: core md5 **`68953c5165a505d37804be82300dc1ef`**,
app md5 **`c4122a888997b692c303e3f9903acfdf`**. Merged PR #36. **163/163**, core
tsc clean, app 6 pre-existing (zero new).

**0.199.0 Saved Views (2026-06-06).** **APP-only** (core unchanged
**6fdb3a54636c6d4b25f8ceef98414b75**). The app-wide saved-views layer on the
0.198.0 pacing-prefs foundation — Glen's bigger ask, the optimal superset.
- A **view** = named layout snapshot: view-mode + filter/search/zoom/grouping/
  hide-completed + the Pacing view's full prefs blob.
- **Views dropdown** (next to the view pills): save current layout, apply a saved
  view, **★ star a default** (opens on load), ✕ delete. **Remember-last** when
  nothing is starred. Per-browser localStorage (key `nga.views.v1`), LWS-guarded.
- **Configurable:** seed via `config.savedViews` / `config.defaultViewId`; opt out
  with `config.viewsManager === false`; drive via handle methods
  `getSavedViews` / `saveView` / `applyView` / `deleteView` / `setDefaultView` /
  `getDefaultView`. Works with zero host changes (defaults on).
- New `savedViews.ts` (+ 8 unit tests); `pacing.ts` exports get/setPacingPrefs
  (opaque-blob round-trip, decoupled); `AppState`/`AppEvent` extended; IIFEApp
  mount-seeds initial layout + routes non-gantt first render; TitleBar dropdown.
Re-copy **APP** bundle only: app md5 **`33510f83d164b281b691c97e85cf69e2`**.
Merged PR #35. tsc-clean (6 pre-existing, zero new), **163/163** (155 + 8 new).
**NG queue now clear** of the 2026-06-06 dispatch items (range controls, version
bump, dupes, LWS guard, Calendar/Flow, saved views all shipped).

**0.198.1 audit dupes + LWS guard + Calendar/Flow pulled (2026-06-06).**
**APP-only** (core unchanged at **6fdb3a54636c6d4b25f8ceef98414b75**). Three
NG-queue items, the fast/low-risk lane:
- **Audit dupe-detection** (`AuditListView.vanilla.ts`) — `dupeIds` was an empty
  stub so the Dupes KPI/chip always read 0 even with obvious collisions
  (QBAG-PARENT ×2, "Can't Save Page Layout Edits" ×3). Now groups by normalized
  title (`trim().toLowerCase()`, empty skipped) and flags every member of a >1
  group; the existing chip + count were already wired to the set.
- **LWS blank-canvas guard** (`IIFEApp.ts` `rebuildView`) — double-RAF check
  (gantt view only) calls the gantt's existing `resize()` iff the canvas is still
  0×0 after a view-switch/reload re-mount at 0 layout size. try/catch guarded,
  no-op on the healthy path. *Repro-gated — confirm on a current SF bundle.*
- **Calendar/Flow** pulled from `CLOUD_NIMBUS_VIEWS` so the dead "coming in
  0.183" tabs stop rendering; union + stub + catch-all kept for an easy port.
Re-copy **APP** bundle only: app md5 **`d5eaf0780a84285ac211708a0085d409`**.
Merged PR #34. tsc-clean (6 pre-existing), 155/155. **Still open (NG queue):**
saved named multi-views + default-which-view-opens (Glen's bigger ask; 0.198.0
shipped the pacing-prefs foundation).

**0.198.0 pacing range controls + core version bump (2026-06-06).**
Two-bundle cut. **APP** (`packages/app/src/renderers/pacing.ts`):
- **Symmetric range presets** — `span3` (±3) / `span6` (±6) centred on today
  replace forward-only `next3`/`next6` (kept as back-compat aliases). **New
  default cut = bucket `week` + `span6`** (last 6 + next 6 weeks) — supersedes
  the "opens on one giant Month bar" finding.
- **Edge steppers** — Earlier `[− / +<unit>]` and Later `[+<unit> / −]` add/trim
  one bucket at each window end (first click resolves the active preset to a
  concrete custom window, then nudges; guards start<end).
- **Preference persistence** — localStorage (LWS-guarded try/catch) saves
  range/bucket/custom-window/measure/mode/series; restores on next mount.
  Precedence: **saved prefs > host `config.pacing.defaults` > built-in default**.
**CORE** (`NimbusGantt.ts`): `capabilities().version` bumped **0.187.0 → 0.198.0**
(was stale across 0.188→0.197) — unblocks version-guarded Auto-Schedule on CN.
Re-copy **both** bundles: core md5 **6fdb3a54636c6d4b25f8ceef98414b75**,
app md5 **b88b39b57294ca93ee7cd2c38e0d7c37**. Merged 0.198.0 (PR #33). tsc-clean
(6 pre-existing), 155/155. **Still open (NG queue):** Calendar/Flow stubs,
audit dupe-detection, LWS blank-canvas guard (repro-gated), saved named-views.

**0.197.0 pacingData pass-through (2026-06-06).** Closes the live
gap Cowork found on MF prod 0.264: the Pacing view was running NG's task-derived
**fallback preview** ("Forecast preview — remaining spread"), not DH's
authoritative numbers, because there was no way to feed `PacingData` in. Now:
- **`mountConfig.config.pacing.data`** seeds the Pacing view's authoritative data.
- **`handle.setPacingData(data)`** — live push, no reload (DH recompute →
  re-render if Pacing is active); `null` reverts to the task-derived preview.
- **`portfolioPacingToPacingData(dto)`** — exported adapter mapping DH's
  `PortfolioPacingDTO` (getPortfolioPacing) → NG `PacingData` in one call
  (period totals 1:1, granularity→bucket, blendedRate→rate, summary from totals).
- **items-hybrid** — DH's `PacingPeriodDTO` has no per-period `items[]`, so when
  an authoritative bucket lacks composition NG borrows drill-down items from its
  own task buckets (key/startMs/label match) — rich drill-down works, zero DH change.
- `index.ts` exports the adapter + `PacingData`/`PortfolioPacingDTO`/bucket types
  (npm/ESM contract; matches renderTreemap/renderBubble).
**APP-only** (core unchanged at 0.196.2 `39df71d7…`). APP IIFE md5
**`474705843fcb21f48a5fce1bf3dc9a13`** (adapter rides in via pacing.ts←IIFEApp;
the index re-export is npm-only, so the IIFE hash is unchanged from the
pre-export build — intentional, verified). Merged 4ed0d50 (PR #32). tsc-clean
(6 pre-existing), 155/155. **DH:** serialize getPortfolioPacing→PacingData (via
the adapter or directly), pass as `config.pacing.data` and/or call
`setPacingData` on recompute, re-copy the APP bundle. Resource-leveling still later.

**0.196.2 Gather vs Wired mode (2026-06-05).** The timeline now
has two host-toggleable modes (Glen's ask): **wired** = edits run the DML as
made; **gather** (hypothetical) = every edit buffers into the review/audit list
as a **potential DML**, committed later through review-and-edit. Two parts:
- **(A) field-generic buffer** — the pending-changes buffer/translator/revert
  now tracks **any** changed field (title, stage, assignee, progress, dates, …),
  old→new, not just dates. (Was the gap behind "are we tracking anything that
  changes?" — answer is now yes.) `PendingEdit.changes/original/before` widened.
- **(B) the mode** — `batchMode` is the gather flag; **field edits now buffer in
  gather mode too** (`onTaskPatch` was forwarding immediately — now it stages
  into the buffer like drags/reorders do). Runtime toggle on the handle:
  `setMode('wired'|'gather')` + `getMode()` so DH/CN expose the setting. Review
  surface is the existing audit panel + `commitEdits()`/`discardEdits()` +
  per-row reject; auto-schedule (0.196.1) hands its batch through the same gate.
**APP-only** (no core change — core stays 0.196.1 `39df71d7…`). APP
`nimbus-gantt-app.iife.js` md5 **`c793a4f86dbdf08ba332579588f42abd`**. Branch
`feat/0.196.2-field-generic-buffer` (A, merged `67ec303`) + the gather-mode cut.
tsc-clean (6 pre-existing unchanged), build clean, vitest 155/155. Demo:
`pacing.html` has a wired⇄gather toggle (logs pending-edit count). **DH/CN:
re-copy the APP bundle; wire the setMode toggle into a host setting; gather-mode
edits land in your review-before-DML audit list.** Resource-leveling still later.

**0.196.1 Auto-Schedule review-before-DML (2026-06-05).**
Auto-Schedule no longer applies silently. It now does **preview → review →
commit**: NG computes a **preview** (new core `autoSchedule:preview` event —
computes WITHOUT dispatching TASK_MOVE), the modal shows the **proposed
date-change diff** (old → new per work item), and on **Apply** NG hands the
host the batch — it does **not** write anything itself:
- `onAutoSchedule({ changes: AutoScheduleChange[] })` (preferred) → host stages
  the whole batch for commit/reject (**DH → its review-before-DML audit list**,
  the 0.190 audit-pass extension). Nothing hits the org until you commit there.
- else `onPatch` per change → same path drag edits use (host pending/audit list).
- else (standalone/CN/demo, no host handler) → in-engine `autoSchedule:run`.
This is the answer to Glen's "I want to review auto-schedule before DML."
Resource-leveling (team capacity → schedule math) still the later step.

**TWO-bundle cut** (core preview event + app review modal):
- CORE `nimbus-gantt.iife.js` md5 **`39df71d7f44dec64d35134f77c8f11a7`**.
- APP `nimbus-gantt-app.iife.js` md5 **`876bef0e4368e0b0fdb00284d27e3fe1`**.
**Merged to master at `fd15f3a` (PR #29); both md5s reproduce from a clean
build of master.** Verification: tsc-clean (6 pre-existing errors unchanged),
core+app build clean, vitest 155/155, `autoSchedule:preview` in both bundles.
Demo: Auto-Schedule in `pacing.html` shows the diff + logs the proposed batch
on Apply. **DH/CN: re-copy both bundles; visual-verify the review modal.**

**0.196.0 NG-owned modals + UI conventions (2026-06-05).**
Establishes the house rule **`docs/ng-ui-conventions.md`**: in-app surfaces
(modals/panels/tooltips/menus) are **NG-rendered + self-styled** (so they look
identical on web / Salesforce / demo); only **hand-offs** (open record / open
report) are host-rendered. Brings the two dead FilterBar buttons into it:
- **Auto-Schedule** — was a `console.log` stub *and untriggerable* (the
  `autoSchedule:run` event had no public trigger). Fixed by adding a public
  **`emit()` + `on()`** to `NimbusGantt` (core), then an NG-owned modal that
  runs the in-bundle scheduler and shows the result (scheduled count / span /
  violations). Host override: `onAutoSchedule` (DH's server-side ETA service).
- **Team** — NG-owned capacity modal (edit hours/active, live runway projection
  from remaining backlog). Host override: `onEditTeam`; emits `onTeamChange`.
  *Capacity → resource-leveling in the scheduler is the next step (not yet wired).*
- New modal primitive `packages/app/src/renderers/modal.ts` (`.ngm-*` injected
  styles) — reusable for future surfaces. UI intents (`AUTOSCHEDULE_OPEN` /
  `TEAM_OPEN`) intercepted in `IIFEApp.dispatch()` like `PATCH`.

**TWO-bundle cut** (core API addition + app):
- CORE `nimbus-gantt.iife.js` → `nimbusgantt.resource`, md5 **`72b9dc2d41309462c8839b97fa5659e5`**
  (adds public `emit`/`on`; required for Auto-Schedule to run).
- APP `nimbus-gantt-app.iife.js` → `nimbusganttapp.resource`, md5 **`d10ae855feb3b13f12a5303bcca296b3`**.
Both must be re-copied. **Merged to master at `b900397` (PR #28); both md5s
reproduce from a clean build of master.** Verification: tsc-clean (6 pre-existing
errors unchanged vs master), core+app build clean, vitest 155/155, modal +
`autoSchedule:run` present in the app bundle.
**DH/CN before release:** visually confirm the two modals render (Cowork/click)
— verified at the code level, but the rendered modals were not DOM-checked here.
Auto-Schedule overlaps DH's existing `deliveryGanttAutoScheduleModal` →
converge-or-keep is a DH integration call. Demo: buttons live in `pacing.html`.

**0.195.0 Pacing/Forecast subtab (2026-06-05).** New `pacing`
view-mode in the app (alongside Gantt/List/Treemap/Bubbles/Calendar/Flow) —
the in-gantt "budget" screen. Reads the **same task state the Gantt draws**,
so board edits flow into it. **Cuts (host-configurable):** Range
(Next 3/6 · Rest-of-yr · This-Qtr · YTD · All · Custom start→end) · Bucket
(W/M/Q) · Measure (Hours/$) · Mode (Per-period / Cumulative burn-up) · Series
(Actual/Forecast/Target). **Click a bucket → rich drill-down** of the work
items composing it (This-period · % of item · Est · Logged · Remaining · %used
+ group/assignee/status/dates), with `onOpenItem` (navigate) + `onItemHover`
(tooltip) + per-bucket `onOpenReport` — host owns nav. Chart reads
**actual → today → forecast** (logged spread over elapsed span, remaining over
the rest). Summary cards incl. an **Unscheduled** (estimate-but-no-dates)
signal.

**Per-client config** (`mountConfig.config.pacing = { defaults, controls }`,
+ `config.rate`): `controls.dollars=false` hides the $ measure (MF);
`controls.{mode,series,ranges,buckets}` restrict/hide groups; `defaults`
seed the initial bucket/range/measure/mode/series on load. See
`docs/dispatch-pacing-view-0195.md`.

**Styling parity:** the view **injects its own scoped stylesheet** (`.ngp-*`,
like TooltipManager/ContextMenuPlugin) — it does NOT depend on the host's
pre-compiled `styles.css`, so it renders identically on CN-web, DH-Salesforce,
and the demo.

**Architecture (decided across NG/DH/MF): DH is the forecast brain, NG is the
screen** — DH passes a render-ready `PacingData` (dated actuals + $ + scope +
grading); NG draws it. Standalone, NG falls back to a forecast-only preview.
**APP-bundle** re-copy: `nimbus-gantt-app.iife.js` → `nimbusganttapp.resource`,
md5 **`0945c97acc4906da507d4c4d2dde6474`** (core unchanged from 0.194.1 — do
NOT re-copy core). Interaction callbacks (`onItemClick` / `onItemHover` /
`onOpenReport`) + per-client `config.pacing` ({defaults, controls}) are wired.
**Merged to master at `dfcdc23` (PR #27); md5 above is reproducible from a
clean `packages/app` build of master — DH/CN cut from master.** The
`mountConfig.pacingData` data-object pass-through is intentionally **not
wired yet** (renderer + fallback + config + callbacks ship first; add the
data pass-through once DH confirms the contract). Demo:
`packages/demo/src/pacing.html` (`npx vite --config packages/demo/vite.config.ts`
→ `/pacing.html`; DH/MF preset toggle in the banner).

**0.194.2 app pipeline feeds core hours-contract keys
(2026-06-05).** The **app** adapter (`packages/app/src/pipeline.ts`) emitted
hours under its internal `metadata.hoursHigh`/`hoursLogged` rollup keys but
NOT the NG core contract keys, so the 0.194.0 sizing/actuals tooltip block
was dark on every app-mount surface (Cowork found it on CN's v12). Fixed
additively: the leaf map now also emits `estimatedHours`/`loggedHours` (kept
the rollup keys; parents reuse the same metadata object). This is an
**APP-bundle** change — first since 0.192 — so consumers re-copy
**`nimbus-gantt-app.iife.js`** (`nimbusganttapp.resource`), md5
**`dd3b75e965ccdbdc1448051bbeec768f`**. Core bundle unchanged from 0.194.1
(`65ba5d62…`). This was NG's lane (monorepo app adapter), NOT a consumer fix.
See `docs/dispatch-consumers-0194-tooltip-v2.md`.

**0.194.1 tooltip header honors `title` (2026-06-05).** The
hover tooltip header now uses `task.title || task.name`, matching the
LayoutEngine bar-label convention — so hosts that route a label string into
`name` but set a clean `title` get the right header text (Cowork live-test
found CN's v12 header showing `"120h (83% budget)"`). One-line engine fix;
**CORE bundle re-copy only**, md5 **`65ba5d62f470f41c4f540f0591c4d44c`**.
NOTE: the *dark sizing block* the same Cowork pass found is **not** an NG
bug — it's a CN `pipeline.ts` key mismatch (emits `metadata.hoursHigh`,
contract reads `estimatedHours`/`loggedHours`/`hours`); CN-side fix, see
`docs/dispatch-consumers-0194-tooltip-v2.md`.

**0.194.0 Tooltip v2 (2026-06-04).** Three additive tooltip
upgrades on the 0.193.0 base: (1) **`GanttTask.tooltipRows[]`** — hosts append
domain rows (request #, budget, forecast) without forking the renderer (the
fork-preventer); (2) **dependency summary** — `Blocked by N · Blocks N`,
engine-counted on hover, free for all consumers; (3) **baseline variance** —
`Start/Finish vs plan ±Nd` from host `metadata.baselineStart/End`, late = red.
Host contract unchanged. **CORE bundle re-copy only**, md5
**`ecf538f90b5618bc00606d6825477d56`**. See
**`docs/dispatch-consumers-0194-tooltip-v2.md`** — which also carries the
0.193.0 Cowork findings DH/CN must still act on (CN: feed hours +
refresh the stale vendored `src/lib/nimbus-gantt/core.js`).

**0.193.0 richer mouseover tooltip + right-click hit-test
parity (2026-06-04).** Default hover tooltip now surfaces the **work-item
ID** (copyable) plus a **sizing & actuals block** (Estimate / Logged /
Used % with `Nh left`·`Nh over`) and Dates-with-duration — reads
`estimatedHours`/`loggedHours`/`hours` from top-level or `metadata`, hides
when absent. `hitTestAt()` now mirrors the hover HitTest tolerance
(milestone diamond + 6px bar x-slop) so right-click stops falling through
to the "Create work item" menu on short bars/milestones. Both apply on a
bundle re-copy — `ContextMenuPlugin` (auto-installed) drives the hit-test;
DH/CN map estimate/logged onto the task to light up the sizing block. See
**`docs/dispatch-consumers-0193-tooltip-hittest.md`**. Unblocks the
MF-prod "sizing on mouseover" timeline ask.

> **Bundle to re-copy: CORE ONLY** (`nimbus-gantt.iife.js` →
> `nimbusgantt.resource`), md5 **`a0e38a04ac163839dd7cb2416e75e59c`**. The
> APP bundle is **unchanged** (`44fe7279…`, same as 0.192.0) and must NOT
> be re-deployed — the app never embeds core; it consumes `window.NimbusGantt`
> at runtime, so all 0.193.0 changes live in the core bundle. Merged to
> `master` at `ca7af90` (PR #23).

**0.192.0 AutoSchedule auto-install + hours-bridge
(2026-05-11).** Auto-installs `AutoSchedulePlugin` dormantly (default
`autoRun: false`) on every IIFE mount so hosts can fire
`gantt.events.emit('autoSchedule:run', cb)` from a button without
needing to install the plugin themselves. Adds a `mountConfig.hoursPerDay`
hours→duration bridge that pulls the
`endDate = startDate + ceil(estimatedHours / hoursPerDay)` math out of
host Apex / adapters and into NG. Both bundles MUST re-copy this cut
(md5 `9795d5cc…` core, `44fe7279…` app). DH/CN action items: see
**`docs/dispatch-consumers-0192-autoschedule.md`** for the one-flag
wireup path that collapses DH's Phase 4B+C into a button click.

**0.191.0 visibility sweep (2026-05-11).** Auto-installs HistoryPlugin
+ TimeCursorPlugin + HistoryStripPlugin on every IIFE mount; opens
BaselinePlugin to data-driven opt-in via `mountConfig.baseline`;
documents the 32 plugins exported from `@nimbus-gantt/core` in a new
Available Plugins reference. See
`docs/dispatch-consumers-0191-cascade.md` for the prior wave of
host-only wireup (dep-gestures via ContextMenuPlugin, v12
BUNDLE_VERSION bump).

**0.183 — interaction model cut.** IM-1/2/3 drag-to-edit dates + IM-4 drag-to-
reprioritize + IM-5 onItemClick + IM-6 pan-on-deadspace + IM-7 viewport state +
DM-3 hours/budget columns + DM-4 item-row over-budget warning + DM-5 header-row
completion bar + CH-1 chrome toggle. Async contract for IM-1..4: optimistic +
in-flight dim + per-task seq race resilience + revert-on-reject + error
callbacks. DH CC wires TRACK B (live Apex records) against this contract.

## Release metadata

| Field | Value |
|---|---|
| Branch | `master` (merged `6247cb4`, PR #26) |
| Commit SHA (source — latest) | `<this commit>` *(0.194.2 app pipeline hours-contract keys)* |
| Commit subject | `fix(0.194.2): app pipeline emits core hours-contract keys (lights up sizing block)` |
| 0.194.2 app pipeline hours (APP md5 `dd3b75e9…`) | merged `6247cb4` |
| 0.194.1 tooltip header→title (core md5 `65ba5d62…`) | `3c86acb` |
| 0.194.0 Tooltip v2 (core md5 `ecf538f9…`) | `f79121b` |
| 0.193.0 tooltip + hit-test parity (core md5 `a0e38a04…`) | `14f669b` |
| 0.192.0 AutoSchedule + hours-bridge | `58bde0d` |
| 0.191.0 visibility sweep | `3990764` |
| 0.190.2 AutoSchedulePlugin export | `7158dd8` |
| 0.190.1 ctxmenu click-fire fix | `3c5e0e4` |
| 0.190.0 audit-pass extension | `05a8aff` |
| 0.189.1 hardening | `9d0fb3e` |
| 0.189.0 context menu | `c41af52` |
| 0.186.0 + 0.187.0 temporal canvas | `b5f3176` |
| 0.185.37 remote-events skeleton | `4aa73d9` |
| 0.185.36 row-style decorators | `2e0919d` |
| 0.185.35 positional reorder | `d2ac51a` |
| 0.185.34 dep type sanitization | `f75e643` |
| 0.185.33 React-only DX polish | `24ba6d7` |
| 0.185.32 handle.taskAt | `16582e3` |
| 0.185.31 document-level ctx-menu (superseded) | `fd7d023` |
| 0.185.30 dragReparent collision fix | `ac76036` |
| 0.185.29 ctx-menu diag + fallback | `e0e117d` |
| 0.185.28 pointerdown ctx-menu | `23ce4bb` |
| 0.185.27 dependencies wire-through | `26d2eae` |
| 0.185.26 titleBarButtons slot | `534321d` |
| 0.185.25 chrome polish + liveDataUpdate | `df51a3b` |
| 0.185.24 bucket-scoped dragReparent | `5799b53` |
| 0.185.1 initialFocusDate + scrollToDate | `7a33285` |
| 0.185 batchMode + handle verbs | `5ba6d16` |
| 0.184 audit preview modal | `b9a3ccf` |
| 0.183.4 drag-save regression fix | `702d6b0` |
| 0.183.3-diag instrumentation | `f24cc24` |
| 0.183.2 silent-swallow fix | `ed82274` |
| 0.183.1 polish | `b2e22ef` |
| 0.183 interaction cut (source) | `41ec401eac5ce8…` |
| 0.183 HANDOFF bump | `5d509af…` |
| 0.182 four-change polish bundle | `639655645549d939caae769ded7daf18a78ff91e` |
| 0.182 VF pill-size defensive CSS | `7ea10aa6cf8f0c53ae76a8cf3674a5c780fcaa43` |
| 0.182 2-row TitleBar | `abc5fe0a0e7f07d90c4db0186a9a86af19123d8b` |
| 0.182 AuditListView v0 | `60d9891943632a2789017e9ad01abfb267f69aaa` |
| 0.182 A3+A2+A1 stage-1 | `a352a8c80baa41b7375df36f4dbbfcf045c8ccb8` |
| 0.182 Blocker 3 (today-14d viewport) | `f203c8f6903e7adf120521c4fedafd3fa62646e2` |
| 0.181 cut candidate (frozen) | `2a2af312ea6904c372091d7c0ee0fc52bf48706d` |
| Diagnostic-trace build (stripped by 2a2af31) | `33896c3ca2a1aa7f771e5ea7ede0ffc4c2e22a66` |
| Bisect baseline (bit-identical to 2a2af31) | `31c066f2327104e7b9823429c2c7be819e4455da` |
| 0.181 cut blocker fixes | `3ffd7d327a1276315b86fd23c999e5cca1b40bcc` |
| A1 stage-1 + diag v2 (A1 REVERTED in this release; diag stays) | `9ee542608fe327d419cce972799c2bedf6d2a7af` |
| Diag emitter v1 | `b202a85c14181f8b5d307ab8a33877ea97e72d96` |
| Zoombar dedup | `268354225c2457cac454436fcc19d9f7f636a263` |
| Non-destructive mount + vh floor | `330eba7b162964bf08fa58eda05bbb88dc32344b` |
| Audit dedup + critical CSS | `c9c765d40fe086f7b75d6a28741d966f751d5bab` |
| Phase 0.5 base commit | `fa6a25e2d40cac07390cbfbe9ba2a2f51d7c0525` |
| Parent commit | `a49a130eda7f38d84ef3ed143e6bee8e76bb8037` |

**If you copied any earlier bundle, re-copy from `3ffd7d3`.** The
`nimbusganttapp.resource` sha256 changed; `nimbusgantt.resource` has been
unchanged since `fa6a25e`. This bundle targets the 0.181 cut: reverts A1
stage-1 pill unlock (keeps only `gantt` view, defers full port to 0.182),
fixes the Audit pill state-sync so the panel actually toggles, and adds
a today-14d default viewport offset that matches v9 on initial mount.

## Bundle artifacts

Both IIFE bundles are built from commit `9ee5426`. Absolute paths, byte
sizes, and sha256 digests below. `dist/` is gitignored — Delivery-Hub CC
copies these bytes into `force-app/main/default/staticresources/…` as the
deploy step.

### `nimbusgantt.resource` source

- Path: `C:\Projects\nimbus-gantt\packages\core\dist\nimbus-gantt.iife.js`
- Size: **311,537 bytes** (~304 KB)
- md5: `24273d44818413a2b55ac91803de5f82`
- sha256: `4cc091da9a211e9e4491dcf8d8057d6f7257644700a8626d1f5f941e02e64388`
- **0.191.0 — bytes unchanged from 0.190.2.** The visibility sweep is
  all app-side: IIFE auto-install wiring + Baseline opt-in surface +
  AutoSchedule test coverage + HANDOFF docs. Core source unchanged.
- **Prior 0.190.2** — AutoSchedulePlugin + helpers now exported
  from the core public API. The plugin (739 LOC: full CPM forward +
  backward pass, all 4 dep types FS/SS/FF/SF, all 8 MS-Project constraint
  types, working-day calendar, middleware-level integration) existed
  since `c41af52`-era work but was never exported from
  `packages/core/src/index.ts`. ResourceLevelingPlugin was. The 1-line
  gap blocked DH from wiring auto-schedule. Now surfaced:
  `import { AutoSchedulePlugin, computeSchedule, buildDependencyGraph }
   from '@nimbus-gantt/core'`. Bundle grew +6 KB.
- Prior `3c5e0e4` (0.190.1) — ContextMenuPlugin click-fire fix. DH
  reported 2026-05-09: right-click menu items render but `onClick` never
  fires (custom items + default items both affected). Root cause: the
  `pointerdown` auto-dismiss listener registers on `document` in capture
  phase, so it fires BEFORE the item's bubble-phase click handler.
  `dismissMenu()` detached the menu mid-pointerdown, so `pointerup` →
  `click` never reached the item's listener. Fix: in the dismiss
  handler, bail when `e.target.closest('.ng-ctxmenu')` is truthy
  (covers both root menu and any submenu via shared `ROOT_CLASS`).
  Two-line change in `packages/core/src/plugins/ContextMenuPlugin.ts:304`.
- **0.190.0 — bytes unchanged from 0.189.1.** The audit-pass extension
  is app-layer only (per-record `before` alias, `removePendingPatch`,
  per-row reject). DH/CN consumers do NOT need to re-copy
  `nimbusgantt.resource` for 0.190.0 — only `nimbusganttapp.resource`.
  Prior `9d0fb3e` (0.189.1) hardens the context-menu plugin
  with: dependency-arrow hit-test, destructive-confirm gate on delete
  actions (default window.confirm; host overrides via
  onConfirmDestructive), token-bucket rate limit on agent ✦ items
  (default 1 call per 2s; configurable via agentRateLimit).
- Prior `c41af52` (0.189.0) adds zone-aware right-click context menu
  + `gantt.hitTestAt()` API + ContextMenuPlugin with default menus per
  zone.
- Prior `b5f3176` (0.186.0 + 0.187.0) adds three temporal-canvas plugins
  + agent API + state.timeCursorDate + getDisplayState replay path. See
  "0.186.0 + 0.187.0 — temporal canvas" section below.
- Prior `4aa73d9` (0.185.37) adds the remote-events skeleton
  — see "0.185.37 — remote-events skeleton" section below.
- Prior `2e0919d` (0.185.36) adds per-row style decorators — see
  "0.185.36 — per-row style decorators" section below.
- Prior `f24cc24` (0.183.3-diag) adds three `console.log`
  probes inside `DragManager.completeDrag` at the engine emit sites
  (move, resize-left, resize-right). Lets next-session diagnosis see
  whether the engine fires the callback at all on a problematic surface.
  Wrapped in try/catch — cannot throw inside the drag-release hot path.
  Probes will be removed once the regression is identified + fixed.

Prior entry (0.183 cut `41ec401`) added:
  - `DragManager.scrollManager` option + pan state (IM-6)
  - `PriorityGroupingPlugin` tracks `totalLogged` alongside `totalHours`;
    header task color switches to warning (`#f59e0b`) on aggregate over-
    budget; label uses unclamped aggregate % (DM-5)
  - `NimbusGantt` passes `scrollManager` into DragManager (IM-6 wire-up)

### `nimbusganttapp.resource` source

- Path: `C:\Projects\nimbus-gantt\packages\app\dist\nimbus-gantt-app.iife.js`
- Size: **278,874 bytes** (~272 KB)
- md5: `6abd154031a292dba077304baa74c3d9`
- sha256: `c2cf0660febde28282b1ade6d621d7226352b967df8d4213a24be61c5711487f`
- **Must re-copy for 0.191.0.** Auto-installs HistoryPlugin +
  TimeCursorPlugin + HistoryStripPlugin on every IIFE mount (both
  engineOnly + chrome-aware paths). All three default ON; opt out via
  `mountConfig.history === false` / `timeCursor === false` /
  `historyStrip === false`. New opt-in surface for BaselinePlugin:
  `mountConfig.baseline = [{ id, startDate, endDate }, ...]` (or a
  full `BaselinePluginOptions` object). See "0.191.0 — visibility
  sweep" section below and the new "Available plugins" reference for
  the 12 plugins that ship in the core bundle but were never wired
  into the IIFE app shell.
- Prior `0.190.2` — bytes unchanged. AutoSchedulePlugin export is core-only.
- Prior `0.190.1` — bytes unchanged from 0.190.0. The ContextMenuPlugin
  click-fire fix is core-only; app bundle does not embed core plugins.
  DH/CN consumers re-copy `nimbusgantt.resource` only for 0.190.1.
- **Must re-copy for 0.190.0.** Audit-pass extension shipped — see
  "0.190.0 — audit-pass extension" section below for the three new
  surfaces hosts can wire (DH-Claude requested, batch-mode mounts only).
- Prior `c41af52` (0.189.0) auto-installs ContextMenuPlugin
  on both engineOnly + chrome mount paths. Right-click anywhere on the
  gantt opens a zone-tailored menu (bar / row-label / date-header /
  canvas-empty / bucket-header / below-rows). Default items render out
  of the box; hosts wire callbacks (onCreateTask / onTaskAction /
  onDateAction / onAgentRequest) to make them do things. Opt out via
  `mountConfig.contextMenu: false`. See
  `docs/dispatch-context-menu-integration.md` for full integration guide
  + recommended wirings for DH and CN.
- Prior `b5f3176` (0.186.0) auto-installs TemporalAsymmetryPlugin so
  glen-walk + /v12 light up with past/future visual asymmetry without
  any host-side change.
- Prior `4aa73d9` (0.185.37) adds `handle.pushRemoteEvent` +
  `handle.getLastAppliedTs` on both runtime handle paths.

**0.191.0 — visibility sweep + temporal-canvas auto-install** *(app bundle only)*.
Closes the long-standing gap where 12 of NG's plugins were exported
from `@nimbus-gantt/core` but never wired into the IIFE app shell — so
DH and CN consumers reading HANDOFF.md or `gantt.use(...)` had no idea
they existed. Three concrete changes:

**(1) HistoryPlugin + TimeCursorPlugin + HistoryStripPlugin auto-install
on every IIFE mount.** Both `engineOnly` and `chrome-aware` paths get
the same three blocks immediately after the existing
TemporalAsymmetryPlugin / ContextMenuPlugin auto-installs. Mirror the
established pattern: default ON, opt out via `mountConfig.history ===
false` / `timeCursor === false` / `historyStrip === false`, or pass an
options object to tune. HistoryStripPlugin bails entirely when the
history log has zero annotations (verified at
`HistoryStripPlugin.ts:102`), so the strip costs nothing visually
until a host or plugin calls `gantt.history.annotate(...)`. Hosts get
the scrubbable-history substrate + DAW-style playhead + annotation-
marker strip immediately on bundle re-copy. The dispatch in
`docs/dispatch-ng-temporal-canvas.md` explicitly targeted these for
0.187/0.188 auto-install; that step was skipped at the time. 0.191.0
finishes it.

**(2) BaselinePlugin opt-in with data.**
`mountConfig.baseline = Array<{ id, startDate, endDate }>` or a full
`BaselinePluginOptions` object. Zero-cost when omitted. Hosts that
have a "planned schedule" stored separately (e.g. DH's
`OriginalSchedule__c` field) can now render translucent ghost bars
showing variance without writing any plugin-installation code.

**(3) AutoSchedule test coverage** (`packages/core/src/plugins/AutoSchedule.test.ts`).
10 tests exercising the plugin factory, `buildDependencyGraph` topology
+ cycle detection, and `computeSchedule` for empty / single-task / FS
cascade with lag / MSO constraint override / circular violation
reporting. Brings the just-exposed 739 LOC plugin into the same Mahipal-
review-grade test posture as `CriticalPath.test.ts`.

## Available plugins (opt-in unless noted as auto-installed)

Quick reference for plugins exported from `@nimbus-gantt/core` that
hosts can install via `gantt.use(...)` after the IIFE has booted.
Auto-installed plugins are wired in `IIFEApp.ts` and need no host
action; opt-in plugins require an explicit `gantt.use()` call.

| Plugin | Status in IIFE | One-line purpose |
|---|---|---|
| `PriorityGroupingPlugin` | auto-install | Swimlane bucket grouping by `groupId` |
| `TemporalAsymmetryPlugin` | auto-install (opt-out via `temporalAsymmetry: false`) | Past concrete, future ghosty |
| `ContextMenuPlugin` | auto-install (opt-out via `contextMenu: false`) | Zone-aware right-click menu |
| `HistoryPlugin` | auto-install (opt-out via `history: false`) | Append-only action log for scrubbable replay |
| `TimeCursorPlugin` | auto-install (opt-out via `timeCursor: false`) | DAW-style playhead + NOW bracket |
| `HistoryStripPlugin` | auto-install (opt-out via `historyStrip: false`) | Annotation marker strip above timeline |
| `BaselinePlugin` | opt-in with data via `mountConfig.baseline` | Ghost-bar overlay for planned-vs-actual variance |
| `AutoSchedulePlugin` | auto-install **dormant** (opt-out via `autoSchedule: false`; override via `autoSchedule: AutoScheduleOptions`) | CPM forward/backward + 4 dep types + 8 MS-Project constraint types. Default `autoRun: false` — fire `gantt.events.emit('autoSchedule:run', cb)` to trigger. 0.192.0 |
| `CriticalPathPlugin` | opt-in | CPM analysis; highlights critical path bars/dependencies |
| `ResourceLevelingPlugin` | opt-in | Resolve over-allocation conflicts; level by priority |
| `MonteCarloPlugin` | opt-in | Probabilistic schedule simulation |
| `RiskAnalysisPlugin` | opt-in | Risk factor + project health + recommendations |
| `NetworkGraphPlugin` | opt-in | PERT-style network diagram view |
| `MSProjectPlugin` | opt-in + `importMSProjectXML` / `exportMSProjectXML` helpers | MS Project XML import/export |
| `WorkCalendarPlugin` | opt-in | Non-working days, holidays, custom work hours |
| `VirtualScrollPlugin` | opt-in | Virtual rendering for 1000+ tasks |
| `KeyboardPlugin` | opt-in | Arrow nav, zoom, Home/End/Delete shortcuts |
| `UndoRedoPlugin` | opt-in | Ctrl+Z / Ctrl+Y action history |
| `MilestonePlugin` | opt-in | Zero-duration diamond markers |
| `GroupingPlugin` | opt-in | Generic grouping (alt to PriorityGrouping) |
| `DarkThemePlugin` | opt-in | One-call dark theme toggle |
| `ExportPlugin` | opt-in | Export gantt to PNG/SVG |
| `MotionControlPlugin` | opt-in | Phone accelerometer/gyroscope navigation |
| `TelemetryPlugin` | opt-in | Batched usage analytics |
| `SplitTaskPlugin` | opt-in | Split a task into multiple segments |
| `MiniMapPlugin` | opt-in | Thumbnail overview viewport |
| `HeatmapViewPlugin` | opt-in | Density heatmap over timeline |
| `TimelineNotesPlugin` | opt-in | Time-anchored note overlays |
| `TimeTravelPlugin` | opt-in | Replay-style time-travel UI |
| `NarrativePlugin` | opt-in | Generate text narration of schedule changes |
| `WhatIfPlugin` | opt-in | Sandbox what-if branches without committing |
| `SonificationPlugin` | opt-in | Audio rendering of schedule events |
| `ConfigPanelPlugin` | opt-in | In-canvas config editor for theme + features |

Most "opt-in" plugins are documented in their own source files at
`packages/core/src/plugins/*.ts`. Test coverage exists for `CriticalPath`,
`ContextMenu`, `History`, `RowDecorators`, `RemoteEvents`, and
(new in 0.191.0) `AutoSchedule`. The other 28 are exported but un-
tested in this repo — production-burning surfaces should be Mahipal-
reviewed before relying on them at scale.

**0.190.0 — audit-pass extension** *(source `05a8aff`; app bundle only)*.
DH CC requested via dispatch from C:\Projects\Delivery-Hub. Three
additive surfaces extending the existing 0.185 batchMode +
`getPendingEdits()` / `commitEdits()` / `discardEdits()` flow so DH can
build a "review changes before DML" audit list with FROM → TO display
and per-row cherry-pick. **All three are additive** — hosts that ignore
the new fields/methods/callbacks see no behavior change.

**Ask 1 — `before` alias on `PendingEdit`** (`packages/app/src/types.ts`,
`PendingEdit.before`). Every entry returned by `handle.getPendingEdits()`
now carries both `original` (legacy name; unchanged) and `before` (new
alias; same object reference, identical shape:
`{ startDate?, endDate?, priorityGroup?, sortOrder?, parentId? }`). Hosts
building "from → to" audit displays can read either name. Both fields
populated together at every buffer write, so they never diverge.

**Ask 2 — `handle.removePendingPatch(taskId, kind)`**
(`packages/app/src/types.ts`, `AppInstance.removePendingPatch`;
`packages/app/src/IIFEApp.ts`). Visual-only revert for one buffered
entry. `kind` is `'edit'` (date change) or `'reorder'` (parent /
priorityGroup / sortOrder). Restores the row's `before` snapshot on the
canvas, deletes the entry from `pendingBuffer`, syncs
`tplConfig.pendingChanges`, and re-renders the gantt. Returns `true`
when a matching buffered entry was removed; `false` on no-op
(already-committed, never-staged, divergence). The host never sees a
callback — the patch never existed as far as persistence is concerned.
EngineOnly mounts (`React` driver path) return `false` unconditionally;
batch-buffering on the React driver remains queued for a follow-up cut.

**Ask 3 — per-row ✗ in the AuditPanel preview modal**
(`packages/app/src/templates/types.ts`, `TemplateConfig.onRejectPendingChange`;
both `AuditPanel.tsx` + `AuditPanel.vanilla.ts`). When the host wires
`config.onRejectPendingChange = (taskId) => void`, every row in the
preview modal's pending-changes list renders an ✗ button (data-testid
`audit-preview-reject`, data-task-id attribute carries the id) that
calls the callback for that taskId. The IIFE chrome-aware mount path
auto-wires this for `batchMode` mounts: clicking ✗ removes BOTH `'edit'`
AND `'reorder'` entries for the taskId so a single click collapses the
row visually. The modal auto-closes when the last row is rejected.
Hosts on per-patch mounts (legacy CN v10) can wire their own reject
flow; when the field is left unset, the modal renders without the ✗
column (legacy bulk-only behavior preserved).

**Wiring sketch for DH (PR #1 — already in flight on C:\Projects\Delivery-Hub):**

```js
// 1. Mount with batchMode true (drag stages instead of DMLing).
const handle = NimbusGanttApp.mount(host, {
  batchMode: true,
  tasks, dependencies, /* ... */
});

// 2. The audit-pass UX is then driven entirely by the bundle:
//    - Drag a bar → enters pendingBuffer (visual: dim row + before snapshot kept)
//    - Click "📤 Submit + commit" in AuditPanel
//    - Confirm modal lists every change with FROM → TO descs
//    - Per-row ✗ reverts that single change (handle.removePendingPatch internally)
//    - Confirm + commit fires commitEdits() → host's onItemEdit / onItemReorder
//      land in DH's @AuraEnabled commitGanttPatches(...) Apex method.

// 3. Optional: wire a "Reset all" outside the modal:
document.querySelector('[data-testid="audit-reset-btn"]')
  .addEventListener('click', () => handle.discardEdits());
```

**Test surfaces** for hero stories / Cowork verification:
- `data-testid="audit-submit-btn"` — opens preview modal
- `data-testid="audit-preview-confirm"` — fires commitEdits
- `data-testid="audit-preview-reject"` — per-row ✗ (only when
  `onRejectPendingChange` is wired)
- `data-task-id` attribute on each ✗ button — taskId of the row

**0.186.0 + 0.187.0 — temporal canvas** (source `b5f3176`). DH CC and
CN CC, both bundles re-copy. Implements
`docs/dispatch-ng-temporal-canvas.md` across three composable plugins on
top of one substrate. Per Glen's design constraint: additive, opt-in,
zero-cost when off.

**0.186.0 — TemporalAsymmetryPlugin (auto-installed in IIFE)**

Past bars render concrete (full opacity), future bars render ghosty
(translucent fade toward theme background + dashed outline). Bars
spanning today render split — concrete left of today-line, ghosty
right. Past completed bars (progress >= 1) get a ✓ checkmark.

Auto-installed by IIFEApp on both engineOnly + chrome mount paths.
**Hosts see the visual change automatically on bundle re-copy** — no
LWC change required. Opt out via `mountConfig.temporalAsymmetry: false`.
Customize via `mountConfig.temporalAsymmetry: { ... TemporalAsymmetryOptions ... }`.

```ts
interface TemporalAsymmetryOptions {
  futureFadeStrength?: number;        // 0–1, default 0.55
  futureFadeColor?: string;           // default theme.timelineBg
  futureDashedBorder?: boolean;       // default true
  futureDashPattern?: [number, number]; // default [4, 3]
  futureDashWidth?: number;           // default 1
  futureDashColor?: string;           // default desaturated bar color
  pastShowCheckmark?: boolean;        // default true
  pastCheckmarkColor?: string;        // default auto-contrast vs bar
  todayProvider?: () => Date;         // default () => new Date()
}
```

Bret Victor's "Inventing on Principle" (2012, vimeo 36579366, ~14:00) is
the conceptual ancestor — direct visual distinction between concrete
past and uncertain future.

**0.187.0 — HistoryPlugin substrate (opt-in)**

Append-only ring buffer of `(action, inverseAction)` pairs captured via
store middleware. Replay-to-past = dispatch inverse actions backwards
through the same pure reducer that handles forward actions. Each
action's inverse is itself a valid Action, so no special replay reducer
is needed and zero runtime dependencies are added (CLAUDE.md invariant
preserved).

```ts
import { HistoryPlugin } from '@nimbus-gantt/core';

gantt.use(HistoryPlugin({
  capacity: 5000,                // ring buffer size, default 5000
  compactAfterIdleMs: 30000,     // compaction trigger, default 30s
  compactKeep: 500,              // entries kept after compaction
  hydrate: priorEntries,         // host-supplied historical log on remount
  hydrateAnnotations: priorAnno, // host-supplied annotations
  onEntry: (entry) => {          // persist to durable storage (DH/CN)
    saveToBackingStore(entry);
  },
  onAnnotation: (a) => { ... },
  onSnapshotRequest: async (date) => { ... },  // far-back queries
  defaultActor: 'glen@nimba',
  defaultSource: 'local',
}));
```

Public API exposed at `gantt.history.*`:

```ts
interface HistoryAPI {
  entries(): readonly HistoryEntry[];
  annotations(): readonly HistoryAnnotation[];
  snapshotAt(date: Date): GanttState | null;
  appendAnnotation(annotation): void;
  lastWallTs(): number | null;
  scrubTo(date: Date | null): void;
  scrubToNow(): void;
}
```

Records only the 7 persistent action types (`SET_DATA`, `UPDATE_TASK`,
`ADD_TASK`, `REMOVE_TASK`, `TASK_MOVE`, `TASK_RESIZE`, `ADD_DEPENDENCY`,
`REMOVE_DEPENDENCY`). View-only actions (scroll, zoom, selection,
expansion, drag-update, set-time-cursor) are deliberately skipped to
keep the log size bounded under normal UI use.

Diag emitters wired (writes to `window.__nga_diag` per the standard
opt-in flag): `history:entry-recorded`, `history:scrub`,
`history:compaction`, `history:snapshot-miss`,
`history:annotation-added`, `history:hydrate`, `history:overflow-drop`.

**0.187.0 — TimeCursorPlugin (opt-in)**

DAW-convention vertical playhead at `state.timeCursorDate` + colored
"NOW" bracket so users always locate the live edge. Keyboard
shortcuts: `Home` jumps to baseline (oldest log entry), `End` returns
to live, `Alt/Cmd+Arrow` steps by 1 day. Bails on keyboard scrub when
an input/textarea/contenteditable is focused.

```ts
gantt.use(TimeCursorPlugin({
  cursorColor: '#3b82f6',
  cursorWidth: 2,
  showNowBracket: true,
  nowBracketColor: '#10b981',
  enableKeyboardShortcuts: true,
  stepMs: 86_400_000,  // 1 day
}));
```

Pointer drag-to-scrub deferred to 0.187.1. Hosts can wire custom drag
UI today via `gantt.history.scrubTo(date)`.

**0.187.0 — Agent API (`gantt.agent.*`)**

JSON-serializable programmatic surface for LLMs / external controllers
to drive the gantt without DOM events. Every method routes through the
same reducer pipeline as user gestures, so HistoryPlugin captures
agent-driven mutations identically to user-driven ones.

```ts
interface AgentAPI {
  getSnapshot(): AgentSnapshot;       // ISO-string dates, JSON-friendly
  updateTask(taskId, changes): void;
  addTask(task): void;
  removeTask(taskId): void;
  moveTask(taskId, startDate, endDate): void;
  addDependency(dep): void;
  removeDependency(depId): void;
  setSelection(taskIds): void;
  setZoom(level): void;
  scrubTo(isoDateOrNull): void;
  history(): AgentHistoryView | null;
  appendAnnotation(kind, taskId?, payload?): boolean;
}
```

Plus `gantt.capabilities()` for runtime feature detection. Agents
discover what plugins are loaded and which capabilities are wired
without out-of-band coordination. Designed for MCP / WebSocket / HTTP
exposure — every input/output is JSON-serializable.

**0.187.0 — Core wiring**

  * `state.timeCursorDate: Date | null` — view-only, not logged.
  * `SET_TIME_CURSOR` action + reducer case.
  * `gantt.getDisplayState()` returns replayed state when cursor is
    set + a replay provider is registered, else live state.
    Single-indirection on the render path; zero perf cost when no cursor.
  * `gantt.registerReplayProvider({snapshotAt})` — HistoryPlugin
    auto-registers; future plugins can layer on top.
  * `gantt.setTimeCursor`, `gantt.getTimeCursor`, `gantt.getState`
    public methods on the NimbusGantt class.

**Cross-client convergence is free** via the 0.185.37 remote-events
channel — when client A makes an edit, client B receives via
`pushRemoteEvent` → dispatches the same action through the same
reducer → middleware captures the matching inverse with the matching
wallTs → both clients have convergent history logs without any extra
wire format. The architectural choice that made remote events correct
(per-row reducer dispatch through existing actions) is what makes
scrubbable history correct across multi-user surfaces.

**Tests:** 11 new HistoryPlugin tests covering inverse-action
round-trips, multi-step replay correctness, probe-store isolation
(replay does not perturb live store), `SET_TIME_CURSOR` reducer
semantics. Full vitest suite: 128/128 pass (was 117).

**DH CC / CN CC integration sketch:**

```js
// 0.187.0 — opt in to scrubbable history
import { HistoryPlugin, TimeCursorPlugin } from '@nimbus-gantt/core';

const handle = NimbusGanttApp.mount(container, { /* ... */ });
const historicalEntries = await fetchHistoryFromBackingStore();

handle.gantt.use(HistoryPlugin({
  hydrate: historicalEntries,
  onEntry: (entry) => persistToBackingStore(entry),
}));
handle.gantt.use(TimeCursorPlugin({}));

// Agent (Anthropic SDK / MCP / WebSocket)
const snapshot = handle.gantt.agent.getSnapshot();
handle.gantt.agent.scrubTo('2026-04-15T00:00:00Z');
handle.gantt.agent.appendAnnotation('agent-note', 'wi-42', {
  text: 'Suggesting move to next sprint based on capacity analysis',
});
```

DH CC: schema for `delivery__GanttAuditLog__c` (proposal) — see the
temporal-canvas dispatch (`docs/dispatch-ng-temporal-canvas.md`) for
the field layout. Persistence is incremental on the Apex audit infra
already publishing `DeliveryWorkItemChange__e`.

CN CC: store events in a `gantt_history` table on Postgres / API
tier. Same `(ts, action_type, action_json, forward_patches_json,
inverse_patches_json, actor, source)` shape — but for 0.187.0
patches aren't needed (replay uses inverse actions). Schema:
`(ts, wall_ts, action_type, action_json, inverse_action_json,
actor, source)`. Index on `wall_ts`.

**Out of scope (deferred to 0.188.0+):**
- HistoryStripPlugin (annotation track above timeline) — straightforward
  add on top of `gantt.history.annotations()`.
- ForecastPlugin (forward-scrub + hypothesis preview) — layers on
  AutoSchedulePlugin + agent.appendAnnotation.
- ReplayNarrationPlugin (agent narrates "what changed during scrub").
- Pointer drag-to-scrub UI (host can wire today via API).
- Branching from past (Figma-convention auto-resume to NOW on edit
  is the v1 model).

---

Prior entry (0.185.37 `4aa73d9`):

**0.185.37 — remote-events skeleton** (source `4aa73d9`). DH CC and CN
CC, both bundles re-copy. Implements the host-pumped server→client
event channel from `docs/dispatch-ng-remote-events.md` (committed at
`ae23410`). NG never opens a transport — hosts subscribe to their
platform-native push channel (Salesforce Platform Events via
`lightning/empApi`, CN websocket / SSE), translate each message to a
`RemoteEvent`, and pump it in.

**Motivation:** today, hosts repaint the gantt by re-fetching their
backend and calling `handle.setData(tasks, deps)`. That works for
self-initiated writes, but other clients' writes are invisible until
the user manually refreshes. Live multi-tenant collaboration on the
gantt requires push.

**What ships (additive — zero breaking change):**

Two new handle methods:

```ts
handle.pushRemoteEvent(event: RemoteEvent): void;
handle.getLastAppliedTs(channel?: string): number | null;
```

`RemoteEvent` discriminated union (skeleton kinds — full set in
0.185.38–39):

```ts
type TaskPatch = Partial<GanttTask> & { id: string };

type RemoteEvent =
  | { kind: 'task.upsert';  version: 1; tasks: TaskPatch[]; ts?: number; channel?: string; source?: string }
  | { kind: 'task.delete';  version: 1; ids: string[];      ts?: number; channel?: string; source?: string }
  | { kind: 'bulk.replace'; version: 1; tasks: GanttTask[]; deps?: GanttDependency[]; ts?: number; channel?: string; source?: string };
```

**Reducer semantics — per-row, not full-array rebuild.** `task.upsert`
dispatches `UPDATE_TASK` per existing-id patch (merging only the keys
present, preserving untouched fields) or `ADD_TASK` per new-id patch
that has the required `{name, startDate, endDate}`. `task.delete`
dispatches `REMOVE_TASK`. `bulk.replace` is `setData(tasks, deps)`.
Scroll, selection, expansion, and concurrent in-flight inline edits
on other clients survive every event.

**Why per-row matters:** drag-reorder fires many `sortOrder` updates
per second. If the wire format were full-row replace, those bursts
would clobber a concurrent name-edit a user is typing on another
client. Hosts MUST send the smallest patch capturing their write.

**Stale-drop is per-id ts.** NG keeps a `Map<taskId, lastTs>`. Events
with `ts < lastTs[id]` are dropped silently. Per-id (not per-channel)
because different tasks have independent edit timelines — a stale
event on task X shouldn't be gated by the freshest event for task Y.
Events without `ts` always apply (host opt-out). `bulk.replace`
clears the entire map — host signaled snapshot reload, prior
checkpoints are no longer authoritative. `getLastAppliedTs()` returns
the max ts across all tasks, for the host to checkpoint before
disconnect.

**Diag emitters wired** (writes to `window.__nga_diag` when
`localStorage.NGA_DIAG === '1'` / `?nga_diag=1` / `window.NGA_DIAG = true`):

```
remote:received          { kind, source, ts }
remote:applied           { kind, merged?, added?, removed?, taskCount? }
remote:dropped-stale     { kind, count }
remote:dropped-malformed { reason, kind?, version?, count? }
```

Cowork `nga-verify.js` can assert two-tab convergence by capturing
`remote:applied` events on both clients and comparing taskIds.

**DH CC — integration sketch (per dispatch):**

```js
// LWC connectedCallback (Salesforce-side)
import { subscribe, unsubscribe } from 'lightning/empApi';

connectedCallback() {
  this._clientNonce = crypto.randomUUID();
  // ... mount NG ...

  // 0.185.37: subscribe-from-tip. 0.185.38 will add replayId cursor.
  subscribe('/event/WorkItemChange__e', -1, (msg) => {
    const event = this._translatePlatformEvent(msg);  // ~30 lines
    if (event.clientNonce === this._clientNonce) return;  // self-echo
    this._mountHandle.pushRemoteEvent(event);
  }).then(sub => { this._subscription = sub; });
}

disconnectedCallback() {
  if (this._subscription) unsubscribe(this._subscription);
}
```

Apex side stays as scoped in dispatch — `WorkItemChange__e` Platform
Event published from `DeliveryWorkItemTriggerHandler.afterInsert/Update/
Delete`, `ClientNonceTxt__c` write-only field on `WorkItem__c`. Naming
is `WorkItemChange__e` not `Gantt_Update__e` to avoid collision with the
existing `GanttRemoteEvent__e` phone-remote channel.

**CN CC — integration sketch:**

```ts
const clientNonce = crypto.randomUUID();
const handle = NimbusGanttApp.mount(container, { /* ... */ });

const es = new EventSource('/api/gantt/stream');
es.onmessage = (msg) => {
  const event = JSON.parse(msg.data);
  if (event.clientNonce === clientNonce) return;
  handle.pushRemoteEvent(event);
};

// On every CN-side mutation
fetch('/api/gantt/task', {
  method: 'PATCH',
  headers: { 'X-Client-Nonce': clientNonce },
  body: JSON.stringify(patch),
});
```

**Backward compat:** fully additive. Hosts that don't call
`pushRemoteEvent` see zero behavior change. Existing `setData` is
unchanged and fully equivalent to a `bulk.replace` event.

**Out of scope (0.185.38+ per dispatch):**
- `sequence` field for monotonic-cursor stale-drop (CometD `replayId`,
  websocket sequence numbers). Skeleton uses `ts` only.
- `dep.upsert` / `dep.delete` events.
- `host.custom` escape hatch for plugin-routed events.
- `onRemoteEvent` middleware for self-echo filtering / sanitization.
- Bounded queue + `remote:queue-overflow` diag.
- `getLastAppliedSequence(channel)` per-channel cursor for replay-from-cursor reconnect.

**Files touched:** `core/model/types.ts` (RemoteEvent + TaskPatch),
`core/store/GanttStore.ts` (`translateRemoteEvent` pure helper),
`core/NimbusGantt.ts` (`pushRemoteEvent`, `getLastAppliedTs`,
`diagEmit`), `core/store/RemoteEvents.test.ts` (16 vitest cases —
action-shape correctness + per-id stale-drop semantics),
`app/IIFEApp.ts` (handle wiring on engineOnly + chrome paths). Full
vitest suite: 117/117 pass.

---

Prior entry (0.185.36 `2e0919d`):

**0.185.36 — per-row style decorators** (source `2e0919d`). DH CC,
re-copy `nimbusgantt.resource` (the *core* bundle, NOT the app
bundle — `nimbusganttapp.resource` is unchanged at this release)
when you're ready to render visual cues on a subset of rows.

**Motivation:** consumers (DH, MF, CN portal) want to mark subsets
of rows with visual cues — recently-completed items with a faded
dashed bar, at-risk items with a red border, externally-blocked
items with an inline badge — without inventing a new
`priorityGroup` for each state. Today the only signal a host can
pass that affects rendering is `status` (color) and `priorityGroup`
(bucket). Those are not enough.

**What ships (additive — zero breaking change):**

`GanttTask` gains an optional `style?: GanttRowDecorators` block:

```ts
interface GanttRowDecorators {
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  borderWidth?: 1 | 2 | 3;     // default 2
  borderColor?: string;        // default: darkened bar fill

  fillStyle?: 'solid' | 'muted' | 'hatched' | 'gradient';
  fillOpacity?: number;        // 0–1 — wins over fillStyle if both set

  badge?: {
    text: string;              // e.g. '✓', 'RISK', 'NEW'
    placement?: 'start' | 'end';   // default 'end'
    color?: string;            // pill bg; text auto-contrasts
  };

  styleNote?: string;          // optional tooltip hint
}
```

Renderer applies decorators on top of the existing bar fill in this
order: muted/opacity fill → progress fill (existing) → decorator
border → label → badge (overlays everything). Selection border still
wins visually over decorator border.

`fillStyle: 'hatched' | 'gradient'` are RESERVED values — type
accepts them; renderer falls back to `'solid'` until a follow-up
ships pattern fills.

**Renderer bail:** decorators are skipped when
`task.status === 'group-header'` so they don't collide with
PriorityGroupingPlugin's legacy `groupBg / groupColor / hours /
hoursLabel / title` fields. Folding those legacy header fields under
a sibling `group?: {...}` block is a worthwhile follow-up dispatch
but explicitly out of scope for 0.185.36.

**DH CC — Apex integration pattern:**

```apex
// In DeliveryGanttController.cls when mapping WorkItem__c → GanttTask
private static final Set<String> TERMINAL_STAGES = new Set<String>{
    'Done', 'Deployed to Prod', 'Completed', 'Cancelled', 'Closed'
};

if (TERMINAL_STAGES.contains(item.delivery__StageNamePk__c)
    && item.LastModifiedDate >= System.now().addDays(-7)) {
    task.style = new Map<String, Object>{
        'borderStyle' => 'dashed',
        'borderWidth' => 2,
        'fillStyle'   => 'muted',
        'badge'       => new Map<String, Object>{
            'text' => '✓',     // ✓
            'placement' => 'end'
        },
        'styleNote' => 'Recently completed (last 7 days)'
    };
}
```

The `task.style` field on the Apex DTO ships as a Map<String,Object>
that JSON-serializes to the shape core expects. **Sanitize at the
adapter boundary** the same way `dependency.type` is normalized
today — strip unknown enum values, coerce `borderWidth` to 1|2|3,
clamp `fillOpacity` to [0,1]. The salesforce-adapter is the right
place; core is enum-strict and won't gracefully degrade malformed
input.

**CN CC — zero required change.** Demo already wires four decorated
sample rows for the showcase. Hosts that don't populate `style`
render exactly as today.

**Backward-compat test matrix (verified):**
- Host doesn't set `style` → bars render identically to 0.185.35
- Host sets `style` on a `group-header` row → renderer ignores it
  (legacy header fields still apply)
- Host sets only `badge` (no border, no fill change) → just the pill
- Host sets `fillStyle: 'hatched'` → renders as `'solid'` (TODO)

**Files touched:** `model/types.ts` (new types + field),
`render/CanvasRenderer.ts` (decorator pass + 3 helpers:
`resolveFillOpacity`, `renderDecoratorBorder`, `renderDecoratorBadge`),
`index.ts` barrel (export new types), `model/RowDecorators.test.ts`
(5 vitest cases), `demo/sample-data.ts` (4 decorated samples).
Full vitest suite: 101/101 pass.

---

Prior entry (0.185.35 `d2ac51a`):

**0.185.35 — positional reorder payload** (source `d2ac51a`). DH CC,
re-copy this bundle into `staticresources/nimbusganttapp.resource`
when you're ready to adopt the dense-numbering story.

**Motivation:** Glen observed 2026-04-21 that MF-Prod sortOrder
shows accumulating negatives (`-481`, `-482`, `-1964`) from the
fractional-midpoint math. Cosmetic, but confusing. The numeric
`newIndex` contract doesn't give hosts enough info to do dense
1..N numbering without reverse-engineering position from the
value.

**What ships (additive — zero breaking change):**

`onItemReorder` payload gains three optional fields alongside
the existing `newIndex`:

```ts
payload: {
  newIndex: number;                       // existing — fractional
  newParentId?: string | null;
  newPriorityGroup?: string;
  position?: 'above-all' | 'below-all' | 'between';  // NEW
  beforeTaskId?: string | null;           // NEW
  afterTaskId?: string | null;            // NEW
}
```

Semantics:
- `position: 'above-all'` — dropped above topmost-in-bucket.
  `afterTaskId: null`, `beforeTaskId: <topmost id>`.
- `position: 'below-all'` — dropped below bottommost-in-bucket.
  `beforeTaskId: null`, `afterTaskId: <bottommost id>`.
- `position: 'between'` — dropped between two tasks. Both IDs set.

**DH CC — dense-renumber integration pattern:**

```js
onItemReorder: async (taskId, p) => {
  if (p.position) {
    // NEW: dense-renumber path
    await renumberBucketWithInsert({
      taskId,
      position: p.position,
      beforeTaskId: p.beforeTaskId,
      afterTaskId: p.afterTaskId,
      newParentId: p.newParentId,
      newPriorityGroup: p.newPriorityGroup,
    });
    // Apex side: load bucket ordered by sortOrder, splice dragged
    // at the correct index (before beforeTaskId OR after afterTaskId),
    // write sortOrder = 1..N contiguously, single DML, single cascade.
  } else {
    // Legacy: numeric path (older bundles that didn't ship positional)
    await updateWorkItemSortOrder({ taskId, sortOrder: p.newIndex, ... });
  }
}
```

Guard the `if (p.position)` — it's always set by 0.185.35+, absent
from 0.185.34 and earlier. Lets you deploy the DH wiring before
deploying the NG bundle or vice versa without crashes.

**CN CC — zero required change.** v12's existing `onItemReorder`
handler reads `newIndex` and ignores the new fields. Works fine.
Adopt positional only if CN ever wants dense numbering for demos.

**Backward-compat test matrix (verified):**
- Host reads only `newIndex` → works as before, ignores new fields
- Host reads `position` but it's undefined (pre-0.185.35 bundle) →
  guard falls to legacy path
- Host reads `position` from 0.185.35+ bundle → resolves server-side

**Files touched:** types.ts, dragReparent.ts (InsertionPoint +
3 return sites + onMouseUp dispatch), IIFEApp.ts (2 interceptor
sites + batch-buffer delta + commitEdits flush).

Prior entry (0.185.34 `f75e643`) — CRITICAL mount-crash fix:

**Root cause:** core's `DependencyRenderer.getConnectionPoints`
switch is exhaustive over `'FS' | 'SS' | 'FF' | 'SF'` with no
default branch. Unknown `type` → undefined return →
`Cannot destructure property 'sourceX' of ... as it is undefined`
at render time → whole timeline fails to mount. This was the first
real-dependency mount since 0.185.27 re-opened the pipe; the bug
was latent until DH started passing actual deps from Apex.

**Fix:** `normalizeDependencies()` at all four handoff sites
(engineOnly + chrome-aware × initial-mount + setData). Accepts
aliases like 'Finish-Start', 'FINISH_START', 'finish to start',
lowercase, underscores — maps to terse NG enum. Falls back to
'FS' for anything unrecognized. Also drops entries missing
source or target.

**Why app-layer not core:** avoids the two-static-resource
redeploy (DH would need `nimbusgantt.resource` too if core changed).
Also correct architectural split per recent Agent 1 research:
host-facing boundary normalizes, internal core stays strict.
Follow-up: add defensive default in core's `getConnectionPoints`
too, next core rebuild cycle.

**Stacks with 0.185.33's React improvements** — one bundle covers
both.

Prior entry (0.185.33 `24ba6d7`) — React adapter DX polish
(React-only, bit-identical IIFE):

Changes in `NimbusGanttAppReact.tsx`:
- Added `onReady?: (handle | null) => void` prop. Fires on mount
  with the handle, on unmount with null. Idiomatic for React 19
  + Zustand / context-based state stores. Parallel to `handleRef`
  (both can coexist; both fire if both provided).
- `handleRef` unchanged — no breaking change.

Changes in `packages/app/package.json`:
- `sideEffects` array lists files with intentional side effects
  (CSS imports, template-registration modules, IIFE entry).
  Everything else is pure → Next.js/SWC can tree-shake unused
  plugin exports from the ES module. Per Vercel benchmarks, this
  + `experimental.optimizePackageImports` yields ~28% faster
  builds on consumer sites.

**DH CC — right-click (parallel dispatch by DH CC 2026-04-21):**
DH's own research found the `oncontextmenu={handler}` template
binding in `deliveryProFormaTimeline.html` fires correctly under
LWS (element-level listener, not document-level — LEX suppression
targets `document`). DH's 5-line change calls
`this._mountHandle.taskAt(e.clientX, e.clientY)` from that
handler. NG's 0.185.32 `handle.taskAt` contract is exactly what
DH needs — no further NG change required for right-click UX.

**0.185.34+ (deferred):** Tier 2 research ideas from 2026-04-21
agents — `handle.version` + `handle.capabilities` feature
detection, optional `CustomEvent`-based event bus parallel to
callbacks. Not shipping yet; want to see how DH's right-click
popover lands first.

Prior entry (0.185.32 `16582e3`) — handle.taskAt(x, y) + strip
0.185.29/30/31 diag logs:

DH CC's 2026-04-21 14:12 UTC probe confirmed 0.185.31's in-bundle
`document.addEventListener` never fires under LWS — DH's own
document listener (attached from the LWC class) fires normally.
Same API, different call site → LWS sandboxes NG's `document`
reference. Event-wiring inside the NG bundle is a **dead end**
for LWC-hosted contexts. Flipping strategy: host does the event
wiring, NG does the hit-test.

**New handle method:**
```ts
handle.taskAt(clientX: number, clientY: number): NormalizedTask | null
```
Returns the task at the page-relative point, or null if the point
isn't over a bar or grid row. Internally uses the same resolver as
the `onTaskContextMenu` path: `.closest('[data-task-id]')` →
`lastHoveredTaskId` fallback → `elementFromPoint` + walk.

**DH-side wiring (copy-paste):**
```js
// In deliveryProFormaTimeline's connectedCallback / onRender:
document.addEventListener('contextmenu', (e) => {
  const rect = this.template.querySelector('.gantt-host').getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right) return;
  if (e.clientY < rect.top  || e.clientY > rect.bottom) return;
  const task = this._ngHandle.taskAt(e.clientX, e.clientY);
  if (!task) return;
  e.preventDefault();
  this._openContextMenu(task, e.clientX, e.clientY);
});
```

**Strip:** 0.185.29/30/31 diag logs removed (`[NG ctx-pd]`,
`[NG ctx-cm]`, `[NG ctx-resolve]`, `[NG ctx-pd-doc]`,
`[NG ctx-cm-doc]`). Served their purpose — LWS-sandbox
finding is now understood. Keeping them would be permanent noise.

**Existing `onTaskContextMenu` callback + ganttEl-scoped
listeners stay in place** for non-LWS hosts (CN React, standalone
localhost). No regression. `taskAt` is purely additive.

**Known-good arc on glen-walk (logged 2026-04-21):**
- 0.185.30 drag collision fix — confirmed firing. `[NG dragReparent]`
  lines show `dragSort=` + `collided=` fields + distinct
  `targetSort` values. Tasks move correctly.
- 0.185.32 handle.taskAt — shipped, awaiting DH wiring.

**Remaining DH-side follow-up (out of NG scope):** reorder writes
may not be reflecting in `[DH positions] BEFORE onItemReorder`
dumps across multiple drags. Could be `refreshApex` cadence,
stale local `_tasks` snapshot, or Apex write failure. Investigate
DH-side.

Prior entry (0.185.31 `fd7d023`) — document-level ctx-menu
listeners for LWS shadow DOM (superseded by 0.185.32 handle method):

DH CC's glen-walk probe 2026-04-21 13:41 UTC confirmed 0.185.29's
ganttEl-scoped pointerdown/contextmenu listeners never fire under
LWS/Locker — `[DH doc-pd]` and `[DH doc-cm]` fire at the document
level, but NG's `ganttEl.addEventListener` silently loses the event.
Salesforce's synthetic shadow DOM retargets events at the shadow
boundary before bubbling reaches NG's internal listeners.

**Fix:** attach contextmenu + pointerdown on `document` too,
capture-phase, filtered by `(clientX,clientY)` inside
`ganttEl.getBoundingClientRect()`. Passes `null` as the event target
so the resolver uses `lastHoveredTaskId` (populated by the engine's
own `onHover` callback — bypasses shadow DOM entirely) +
`elementFromPoint` fallback. Existing ganttEl-scoped listeners stay
in place for non-LWS environments.

**New diag log lines:**
- `[NG ctx-pd-doc] x y`  — document-level pointerdown hit
- `[NG ctx-cm-doc] x y`  — document-level contextmenu hit

DH CC — deploy this bundle. Glen-walk right-click should now fire
`[NG ctx-pd-doc]` → `[NG ctx-resolve] resolved=<taskId>` → host's
`onTaskContextMenu` callback. If `resolved=` is still null, the issue
is the `lastHoveredTaskId` not being populated (engine `onHover` not
firing in LWS), not the event reaching us.

**Stacks with 0.185.30 (dragReparent collision fix) + 0.185.29
(ctx-menu diag + elementFromPoint fallback).** One bundle covers all
three; no separate deployments needed.

Prior entry (0.185.30 `ac76036`) — dragReparent collision-with-self
fix for bucket-edge drops:

Glen's glen-walk session 2026-04-21: T-0114 couldn't move within its
own top-priority bucket. Log trail:
```
aboveId=T-0135 aboveSort=13750.25
belowId=T-0148 belowSort=25687.5625
→ targetSort=19718.90625   ← T-0114's own current sortOrder
```
Every drop in T-0114's natural Y slot computed T-0114's own sortOrder,
so the Apex write was a no-op. DH CC's "top-of-bucket clamp" framing
was close but the underlying shape is broader: *anywhere in the
dragged task's natural slot* computes to in-place.

**Fix:** `bucketVis` excludes the dragged task (already implicit via
`vis` filter; now explicit too, defense-in-depth). After midpoint math,
if `targetSort === dragCurrentSort`, nudge based on cursor direction
vs `dragRow.midY`:
- cursor above dragRow's midY → user wants UP → midpoint of
  nearestAboveSort + dragCurrentSort; or `dragCurrentSort / 2` when no
  upstairs neighbor (top-of-bucket)
- cursor below dragRow's midY → user wants DOWN → midpoint of
  dragCurrentSort + nearestBelowSort; or `dragCurrentSort + 1000` when
  no downstairs neighbor (bottom-of-bucket)

Diag log now includes `dragSort=` and `collided=` fields so glen-walk
sessions show exactly when the nudge branch fires. Previous "won't
move" traces will now read `collided=true → targetSort=<nudged>`.

**Stacks with 0.185.29.** DH CC — the right-click diag logs from
0.185.29 (`[NG ctx-pd]` / `[NG ctx-cm]` / `[NG ctx-resolve]`) are
still present in 0.185.30. Re-deploy both together; one bundle
covers both fixes.

Prior entry (0.185.29 `e0e117d`) — ctx-menu diag + elementFromPoint
fallback:

Glen's probe on `/c/DeliveryTimelineStandalone.app` (2026-04-21)
proved the prior "LEX swallows contextmenu" narrative wrong — DH's
document-level `[DH doc-pd]` / `[DH doc-cm]` probes DO fire. What
failed in 0.185.28 was NG's `fireCtxMenu` resolver returning false
(task not resolved), so `preventDefault` never ran and the host
callback never fired.

**Two changes in 0.185.29:**

1. **Unconditional diag logs** in both listeners + resolver:
   - `[NG ctx-pd]   x y tag`            — pointerdown button===2 fires
   - `[NG ctx-cm]   x y tag`            — contextmenu fires
   - `[NG ctx-resolve] target= rowId= last= resolved=`  — resolution
   Next glen-walk session will tell us whether the listener fires at
   all, and if so which resolution branch failed.

2. **`document.elementFromPoint(clientX, clientY)` fallback** when the
   standard lookup (grid-row `.closest` + `lastHoveredTaskId`) yields
   null. Walks `.closest('[data-task-id]')` from whatever element is
   at the click point. Handles canvas-bar right-clicks without a prior
   pointermove hover (synthetic clicks, teleports, or hover races).

Same changes on both mount paths (engineOnly + chrome-aware).

**DH CC next step:** re-copy the bundle, redeploy, reload
`/c/DeliveryTimelineStandalone.app` with Ctrl+Shift+R, right-click a
canvas bar, paste the console output. Three possible outcomes:

- `[NG ctx-pd]` fires + `[NG ctx-resolve] resolved=<id>` → fix landed,
  remove diag in 0.185.30, then DH pops the menu.
- `[NG ctx-pd]` fires + `[NG ctx-resolve] resolved= null` → elementFromPoint
  also failed; need engine HitTest path. Ship 0.185.30 with it.
- `[NG ctx-pd]` does NOT fire → listener isn't attached or something
  upstream stopPropagates. Ship 0.185.30 with listener on document
  itself (scoped to events within ganttEl bounds).

Prior entry (0.185.28 `23ce4bb`) — pointerdown ctx-menu fallback for
LEX/Locker:

DH CC probe on glen-walk 2026-04-21 13:05 UTC confirmed Salesforce
LEX/Locker suppresses the canvas `contextmenu` event before NG's
listener sees it. The stale warning comment at IIFEApp.ts:749 was
correct. This release adds a `pointerdown + event.button === 2`
fallback alongside the existing `contextmenu` listener on both mount
paths — right-button pointerdown survives LEX/Locker.

**No API changes.** Existing `onTaskContextMenu(task, pos)` callback
signature unchanged; listeners just have one more entry point. Hosts
that have already wired the callback (CN v12 React browser-native
right-click) see zero behavior change. DH CC's probe starts firing the
moment this bundle lands — the entire right-click UX is then DH-side
work (popover LWC + Apex `createWorkItemDependency` /
`deleteWorkItemDependency`).

**Delete-by-menu workaround (no arrow hit-test needed):** task menu
renders "Delete predecessor → [list]" + "Delete successor → [list]"
submenus sourced from `dependencies.filter(d => d.target === task.id)`
/ `.source === task.id`. No NG 0.185.29 required. Arrow hit-test path
(right-click the arrow itself) is deferred until Glen asks for it.

Non-obvious design note: `preventDefault()` fires only when the host
has actually consumed the event (callback wired + task resolved at
event target). Hosts without a callback, or right-clicks that miss a
task bar, fall through to the browser's default right-click menu —
preserves Inspect Element etc. for developers and matches 0.185.27
behavior exactly.

Prior entry (0.185.27 `26d2eae`) — dependencies wire-through:

NG core has always supported dependency rendering (GanttDependency
type, DependencyRenderer, arrows between bars). The v10/v11 rewrite
stubbed the pipe shut in the IIFE app layer — both engine-init sites
hardcoded `dependencies: []`. This release re-opens the pipe.

**Mount option:**
```ts
dependencies?: GanttDependency[]; // { id, source, target, type?, lag? }
```

**Handle method (runtime full replace):**
```ts
handle.setData(tasks, dependencies?);
// setTasks(tasks) still works — leaves existing deps alone.
```

**DH-side consumption pattern** (spec at
`docs/dispatch-dh-dependencies-wire.md` — wire-compat note: Apex DTO
field is `dependencyType`, NG core's `type`. LWC maps before passing):
```js
import getGanttDependencies from '@salesforce/apex/DeliveryGanttController.getGanttDependencies';

const [timelineData, rawDeps] = await Promise.all([
  getProFormaTimelineData({ /* existing args */ }),
  getGanttDependencies({ showCompleted: true }),
]);

const dependencies = (rawDeps || []).map((d) => ({
  id: d.id,
  source: d.source,
  target: d.target,
  type: d.dependencyType || 'FS',
}));

// Initial mount:
window.NimbusGanttApp.mount(host, {
  tasks: normalizedTasks,
  dependencies,
  // ... existing options
});

// On refresh:
handle.setData(normalizedTasks, dependencies);
```

Backwards compatible: omit `dependencies` → behavior identical to
0.185.26 (no arrows rendered). Existing hosts that only call
`setTasks(tasks)` keep working unchanged.

Out of scope for v0: drag-to-create gesture. Users edit dependencies
via record pages; Gantt just renders arrows. Bolt-on for later.

Prior entry (0.185.26 `534321d`) — titleBarButtons slot:

Generic host-supplied buttons slot in TitleBar's right cluster,
immediately before the Full Screen button. Addresses DH CC's
dispatch 2026-04-20 for a "Show Header" toggle on Salesforce's
single-tab Timeline layout. Pattern is reusable for any future
host-level chrome (reset-viewport, open-resource-panel, etc).

**Mount option:**
```ts
titleBarButtons?: Array<{
  id: string;       // stable key; unique within array
  label: string;    // displayed text
  onClick: () => void;
  pressed?: boolean;  // toggle-pressed visual (blue active variant)
  title?: string;     // tooltip
}>;
```

**Handle method (runtime updates, e.g. flipping pressed state):**
```ts
handle.setTitleBarButtons(newButtons);
```

**DH-side consumption pattern:**
```js
// In deliveryNimbusGantt LWC (or equivalent host mount):
let headerVisible = false;

const toggleHeader = () => {
  headerVisible = !headerVisible;
  // existing header-toggle CSS trick (whatever __cnEdit.toggleHeader did)
  document.body.__cnEdit.toggleHeader();
  handle.setTitleBarButtons(buildHostButtons());
};

const buildHostButtons = () => [{
  id: 'dh-show-header',
  label: headerVisible ? 'Hide Header' : 'Show Header',
  onClick: toggleHeader,
  pressed: headerVisible,
  title: 'Toggle the Salesforce page header',
}];

mount(container, {
  titleBarButtons: buildHostButtons(),
  // ... other mount options
});
```

Backwards compatible: no host change needed unless you want the
button. Omit `titleBarButtons` → TitleBar renders exactly as
0.185.25. Existing mount paths untouched.

Prior entry (0.185.25 `df51a3b`) — chrome polish + liveDataUpdate:

1. **Search bar single-char typing fixed.** Root cause: `document.activeElement === searchInput`
   identity check in `FilterBar.vanilla.ts:56` returns the shadow host (not the
   input) inside Salesforce's Locker/LWS shadow DOM, so the focus-preservation
   branch was never entering. Replaced the activeElement check with
   own-listener state (`focus`/`blur` on the input toggles a local boolean).
   Works on every surface, no more one-char-at-a-time re-click.
2. **Auto-Schedule button stays visible** (Glen's call 2026-04-20: "i want it;
   DH sorts out what it does"). Click still hits the placeholder
   `console.log('[FilterBar] auto-schedule (placeholder)')` stub. Follow-up:
   NG emits an `onAutoSchedule(taskIds?: string[])` callback; DH wires it to
   `DeliveryWorkItemETAService.cls` or equivalent scheduler.
3. **Audit panel defaults collapsed.** `auditPanelOpen: true → false` in
   `state.ts`. TitleBar Audit toggle still opens it — same UX, just quieter
   first paint.
4. **Hrs/Wk strip defaults collapsed + gets a Hrs/Wk toggle** next to Audit
   in the TitleBar. Added `hrsWkStripOpen: boolean` to AppState +
   `TOGGLE_HRSWK_STRIP` event + reducer case + toggle button (vanilla + React)
   + render gating in `HrsWkStrip.vanilla.ts` / `HrsWkStrip.tsx`. Mirrors the
   existing AuditPanel pattern exactly.
5. **`liveDataUpdate` feature flag (default true).** Public `setTasks()`
   now routes through `refreshGantt()` — light-touch `setData()` on the
   engine — instead of `rebuildView()` (full destroy + re-mount). Kills
   the post-drop "snap 2-4 times" glitch when hosts fire setTasks multiple
   times during drop settlement (optimistic → server response → refetch).
   Canvas, scroll position, and timescale survive. Legacy behavior still
   available via `overrides.features.liveDataUpdate = false`. DH CC — on
   your side, you may also want to reduce to one setTasks call per drop;
   this flag just makes NG robust to the multi-call pattern either way.

Files touched (all `packages/app/src/`):
- `IIFEApp.ts` — setTasks routes through refreshGantt under liveDataUpdate flag
- `templates/state.ts` — audit default + hrs/wk default + TOGGLE_HRSWK_STRIP case
- `templates/types.ts` — `hrsWkStripOpen`, `TOGGLE_HRSWK_STRIP`, `liveDataUpdate`
- `templates/cloudnimbus/components/vanilla/FilterBar.vanilla.ts` — search focus fix
- `templates/cloudnimbus/components/vanilla/TitleBar.vanilla.ts` — Hrs/Wk toggle btn
- `templates/cloudnimbus/components/vanilla/HrsWkStrip.vanilla.ts` — render gate
- `templates/cloudnimbus/components/TitleBar.tsx` — React Hrs/Wk toggle btn
- `templates/cloudnimbus/components/HrsWkStrip.tsx` — React render gate

No localStorage persistence yet — if DH wants toggle-state to survive page
reload, say so and NG will add a minimal persist helper. For now both
toggles reset to closed on every mount.

DH-side TODO: none. This is an NG-only pass; data contract unchanged.

Prior entry (0.185.24 bucket-scoped dragReparent `5799b53`):
- `dragReparent.ts` hit-test now filters visible rows by `priorityGroup`
  before computing `rowAbove`/`rowBelow`. Closes the `targetSort=23000`
  glitch at bucket top + symmetric bottom-of-bucket boundary bug —
  the walk was crossing bucket lines and picking preceding bucket's
  last row as the above-row.

Prior entry (0.185.1 `7a33285`):
- **Must re-copy.** `7a33285` (0.185.1) adds for DH Full Bleed unblock:
  - **`initialFocusDate?: string`** mount option — declarative
    "land on this date" with snap-to-period (week → Mon, month → 1st,
    quarter → 1st of Jan/Apr/Jul/Oct). Mount-time priority:
    `initialViewport.scrollLeft` > `initialFocusDate` > today-14d default.
    DH ships the prop wiring unconditionally (path C); older NG bundles
    no-op, this bundle honors.
  - **`handle.scrollToDate(date: string | Date)`** — imperative variant
    for post-mount focus changes (e.g. "press T for today" shortcut).
    Same snap+scroll path. Available on both mount paths.

Prior entry (0.185 batchMode `5ba6d16`):
  - `batchMode: true` mount option — buffers onItemEdit/onItemReorder
    instead of forwarding per-edit. Default false → existing per-patch
    consumers (CN v10, DH today) untouched.
  - `handle.getPendingEdits()` → `PendingEdit[]` snapshot of buffer.
  - `handle.commitEdits()` → flushes buffer (edits first, reorders second
    to dodge DH Apex sortOrder neighbor-shift race). Resolves with
    `{ committed }` on full success; throws `{ failedAt, successful, error }`
    on first failure (partial-rollback — failed + remaining stay in
    buffer for retry or discard).
  - `handle.discardEdits()` → visual-only revert to captured originals.
    Host never sees the buffered edits.
  - Auto-derives `tplConfig.pendingChanges` from buffer when batchMode
    is true → AuditPanel preview modal activates with NO host-side
    plumbing. Host-supplied pendingChanges still wins on batchMode=false.
  - Buffered bars dim via new `dirtyTaskIds` set (parallels inflight).
  - `NimbusGanttAppReact` gets `batchMode?: boolean` + `handleRef?:
    MutableRefObject` props. React-driver caveat: engineOnly mount stubs
    the batch verbs (returns empty/no-op) — real React-driver batch is
    a follow-up cut.
  - `onItemReorder` payload type extended with `newPriorityGroup?: string`
    (formalizes the field 0.183.1 has been passing implicitly).

Prior entry (0.184 audit modal `b9a3ccf`):
  - **`702d6b0` (0.183.4 demo-blocker fix)** — removes infinite-recursion
    `dispatch({ type: 'PATCH', patch })` call from inside `onTaskPatch`.
    The reducer's PATCH case routed back to `onTaskPatch`, creating
    mutual recursion that blew the call stack. RangeError got swallowed
    by `onTaskEditAsync`'s try/catch, producing the silent-fail observed
    on CN v12 (bar moves visually, zero callback, zero network). Closes
    the regression introduced in `a49a130`. The 0.183.3-diag probes
    confirm the chain works end-to-end after this fix; probes will be
    removed in a follow-up commit once CN + DH report a clean drag.
  - **`b9a3ccf` (0.184 audit preview modal)** — clicking Submit+commit
    on the AuditPanel now opens a modal listing every pending change
    (id / title / per-field diff) when `config.pendingChanges` is
    populated. Cancel / Confirm buttons; Esc + backdrop click close.
    Adds `AuditPreviewItem` + `pendingChanges?: AuditPreviewItem[]` to
    `TemplateConfig`. Vanilla variant also fixes a long-standing bug
    where it dispatched `RESET_PATCHES` and silently swallowed the
    commit path — now actually calls `config.onAuditSubmit(note)` with
    loading/success/error state.

Prior entry (0.183.3-diag `f24cc24`) added four console.log
  probes + one permanent `diag('edit:commit', ...)` emit:
  - `[NG] main onTaskMove received` at IIFEApp.ts:1215 — engine→app entry
  - `[NG] main onTaskResize received` at IIFEApp.ts:1220 — resize variant
  - `[NG] onTaskEditAsync hit` at line ~744 — logs idx + onItemEdit/onPatch presence
  - `[NG] rawOnPatch firing` at line ~797 — at the legacy-fallback fire site
  - **Permanent** `diag('edit:commit', { taskId, nextStart, nextEnd, via: 'rawOnPatch' })`
    so future regressions on the legacy branch don't go silent (today's
    bug hid because no code path on the happy/legacy branch emitted anything).
  - Probes wrapped in try/catch; cannot throw inside hot paths.
  - Used to diagnose CN v12 drag-save regression observed 2026-04-18 evening.

Prior entry (0.183.2 demo-blocker `ed82274`) patched a
  silent-return regression vs the legacy onPatch contract:
  - `onTaskEditAsync` + `onTaskReorderAsync` were returning silently
    when `allTasks.findIndex(id) === -1`. The engine had already
    painted the bar at the new position via its internal TASK_MOVE
    state dispatch, so the user saw a successful visual move — but the
    host callback never fired, no Apex save, zero `[DH onItemEdit]`
    logs. Legacy `onTaskPatch` always fired `rawOnPatch` in this case;
    the 0.183 async path regressed that contract.
  - Patched: when idx === -1, skip the optimistic update + seq tracking
    (no originals to capture), emit `diag('warn:task-not-in-allTasks')`
    so divergence is observable, and STILL call
    `options.onItemEdit` / `options.onItemReorder` (or `rawOnPatch`
    fallback). Also fires the `*Error` callbacks on reject even
    without a revert target.
  - Closes the round-4 symptom (bar moved visually, no callback,
    no Apex) AND the parallel IM-4 tree-row zero-fires on DH
    fd9cf675 + successors.

Prior entry (0.183.1 hotfix `b2e22ef`) added:
  - **Reorder patch coalescing** — onItemReorder now fires exactly once
    per drop with `{ newIndex, newParentId?, newPriorityGroup? }` merged
    payload. Was firing up to 3 times with partial payloads (priorityGroup,
    parentId, sortOrder each triggered their own stale-settle race).
  - **cursor: pointer** on all chrome buttons via injectLegacyNgCss +
    CLS_PILL_BTN_BASE. UA default for `<button>` is `cursor: default` per
    HTML spec; this forces pointer so users read pills as interactive.
  - **Unpin button** wired to `config.toggleChrome` (CH-1 mechanism from
    0.183). Click → chrome hides. Re-show is programmatic via
    `handle.toggleChrome(true)` — the in-chrome "show toolbar" affordance
    for re-show is a follow-up.

Prior entry (0.183 cut `41ec401`):
  - `onItemEdit` / `onItemEditError` async contract (IM-1/2/3) with
    per-task seq race resilience + revert-on-reject + in-flight dim
  - `onItemReorder` / `onItemReorderError` async contract (IM-4) via
    intercepted dragReparent patch routing
  - `onItemClick(taskId)` id-first click alias (IM-5, both paths)
  - `onViewportChange` debounced (150ms) + `initialViewport` (IM-7)
  - `chromeVisibleDefault` + `handle.toggleChrome()` (CH-1)
  - `features.hoursColumn` / `features.budgetUsedColumn` conditional
    gantt columns (DM-3)
  - `features.headerRowCompletionBar` flag (DM-5 fill suppression)
  - `pipeline.ts` OVER_BUDGET_COLOR warning branch on leaves + parents (DM-4)

### `cloudnimbustemplatecss.resource` source (Salesforce) / v12 stylesheet path

- Path: `C:\Projects\nimbus-gantt\packages\app\src\templates\cloudnimbus\styles.css`
- Size: **52,751 bytes**
- sha256: `2834969004b6c2bc3e4142d9539ec8cf4a55094eeb356668303846e2b0d4a482`
- **Must re-copy.** `6396556` updated `.ng-expand-icon` with the
  ARROW_DIFF font-family normalization (`-apple-system, "Segoe UI
  Symbol", "Apple Symbols", ...` stack + 10px + 16px width). Closes
  Full_Bleed vs Standalone U+25B6 rendering variance. Also retains
  the `7ea10aa` pill-size defensive rules and the `abc5fe0` 2-row
  titlebar layout (`.nga-titlebar { flex-direction: column }` +
  `.nga-titlebar-row` companion). One refresh covers all three.
- **Replaces** prior bundles (`22c505b9…8606` at `fa6a25e`, `8394edb3…3fc0` at `c9c765d`, `e9f835e9…4899` at `330eba7`, `d6919dae…11eb` at `2683542`, `5a2210ba…bf29` at `b202a85`, `2ed90644…a200` at `9ee5426`).

Copy mapping (Delivery-Hub CC):

```text
packages/core/dist/nimbus-gantt.iife.js   →  staticresources/nimbusgantt.resource
packages/app/dist/nimbus-gantt-app.iife.js →  staticresources/nimbusganttapp.resource
```

The third resource `deliverytimeline.resource` (built from
`cloudnimbusllc.com/src/salesforce/SalesforceDeliveryTimeline.tsx`) is now
retired by this release — once the LWC swap lands, delete that resource +
its `.resource-meta.xml` from Delivery-Hub. cloudnimbusllc.com CC will
subsequently delete `src/salesforce/SalesforceDeliveryTimeline.tsx` and its
build entry.

## Mode-prop API contract (for Delivery-Hub CC)

`window.NimbusGanttApp.mount(container, options)` now accepts a `mode` prop
plus two host-nav callbacks. The LWC already passes these fields (`@api mode`
is plumbed through `window.DeliveryTimeline.mount` today); switching the
`loadScript` + `mount` call from `DeliveryTimeline` to `NimbusGanttApp` is a
near-zero-diff change.

```javascript
window.NimbusGanttApp.mount(container, {
  mode: this.mode,                 // 'embedded' | 'fullscreen' (default 'fullscreen')
  tasks,
  onPatch:          (patch) => { /* Apex write-back */ },
  onEnterFullscreen: () => { /* NavigationMixin → Delivery_Gantt_Standalone */ },
  onExitFullscreen:  () => { /* NavigationMixin → Delivery_Timeline */ },
  cssUrl: CLOUDNIMBUS_CSS,         // @salesforce/resourceUrl/cloudnimbustemplatecss
  engine: window.NimbusGantt,      // passed explicitly avoids window-lookup races
  overrides: { /* optional TemplateOverrides */ },
});
window.NimbusGanttApp.unmount(container);
```

**Mode semantics:**

- `'fullscreen'` renders full chrome (TitleBar + FilterBar + ZoomBar + Stats
  + Sidebar + DetailPanel + AuditPanel + HrsWkStrip). When
  `onExitFullscreen` is provided, TitleBar's Fullscreen pill becomes
  "← Exit Full Screen" and invokes the callback (DOM selector:
  `[data-nga-fullscreen-exit="1"]`).
- `'embedded'` forces all chrome feature flags off at resolve time, leaving
  ContentArea (canvas + buckets + rows) plus one floating top-right button
  `↗ Full Screen` that invokes `onEnterFullscreen`. DOM selector:
  `[data-nga-fullscreen-enter="1"]`.

**Navigation policy:** nimbus-gantt never navigates. The library emits
click events via the callbacks above; the LWC owns `NavigationMixin`
routing between the embedded tab (`Delivery_Timeline`) and the standalone
app page (`Delivery_Gantt_Standalone`).

**Stylesheet loading:** `cssUrl` is threaded into the resolved
`TemplateConfig.stylesheet.url`. The stylesheet loader (Strategy C) fetches
it and injects a `<style>` element INSIDE the container element — this is
the path that reliably pierces Salesforce synthetic shadow DOM under
`lwc:dom="manual"`.

## 0.183 interaction-model API (for DH CC + CN CC)

New callbacks and options on `NimbusGanttApp.mount(container, options)`.
All are optional — mounts that don't wire them keep legacy behaviour.

```typescript
window.NimbusGanttApp.mount(container, {
  // ...existing mode/tasks/onPatch/cssUrl/engine...

  // IM-1/2/3 — drag-to-edit dates (bar body moves both; edges move one).
  onItemEdit?: (taskId: string, changes: { startDate?: string; endDate?: string })
    => Promise<void> | void,
  onItemEditError?: (taskId: string, error: Error) => void,

  // IM-4 — drag-to-reprioritize (row drag, same async contract as IM-1..3).
  onItemReorder?: (taskId: string, payload: { newIndex: number; newParentId?: string | null })
    => Promise<void> | void,
  onItemReorderError?: (taskId: string, error: Error) => void,

  // IM-5 — id-first click alias (alongside legacy onTaskClick).
  onItemClick?: (taskId: string) => void,

  // IM-7 — viewport emission (debounced 150ms) + restore at mount.
  onViewportChange?: (state: { scrollLeft: number; scrollTop: number; zoom: string })
    => void,
  initialViewport?: { scrollLeft?: number; scrollTop?: number; zoom?: string },

  // CH-1 — chrome visibility.
  chromeVisibleDefault?: boolean,   // default true

  // DM-3 / DM-5 feature flags.
  overrides: {
    features: {
      hoursColumn?: boolean,              // default false
      budgetUsedColumn?: boolean,         // default false
      headerRowCompletionBar?: boolean,   // default true
    },
  },
});

// CH-1 — runtime toggle, same handle returned by mount().
const handle = window.NimbusGanttApp.mount(container, { ... });
handle.toggleChrome(false);   // hide all chrome slots
handle.toggleChrome();         // flip (back on)
```

**Async contract for IM-1/2/3 + IM-4:**

1. On drop, library applies an optimistic update to its internal task state
   and renders the affected bar/row with a dimmed color (in-flight visual).
2. Library calls `onItemEdit` / `onItemReorder` and awaits the returned
   promise.
3. **Resolve** → commit; in-flight dim clears.
4. **Reject** → library reverts the task to its captured original dates /
   parent / sortOrder, re-renders, then calls `onItem{Edit,Reorder}Error`.
   Hosts surface their own toast (Lightning `ShowToastEvent`, etc.) — the
   library stays UI-agnostic.
5. **Race resilience** — each edit gets a per-task sequence number. If the
   user drags again before the first promise settles, the stale settle is
   ignored. Last-edit-wins, without losing the in-flight edit that
   resolves last.

**Originals capture:** library captures original values at the FIRST in-
flight edit of a chain and reuses them until the chain clears. Revert
restores truly-persisted state, not a prior in-flight optimistic value.

**IM-6 pan viewport** — pointer-drag on canvas deadspace (non-bar area)
pans horizontally and vertically. Automatic in interactive (non-readOnly)
mode — no config required; readOnly mounts do not pan today. Built into
`DragManager` via the `scrollManager` option, wired from `NimbusGantt`.

**DM-4 over-budget color** (item rows) — when `loggedHours >= estimatedHours`,
the bar renders in the warning hue `#f59e0b`. Applies to leaves in pass 1
and parent rows in pass 3 of `buildTasks`. Progress fill is clamped 0-1 so
bar width never exceeds the task duration.

**DM-5 over-budget color** (header rows) — `PriorityGroupingPlugin` tracks
`totalLogged` alongside `totalHours` and switches the header task color to
`#f59e0b` when aggregate `totalLogged >= totalHours`. Header label uses the
UNCLAMPED aggregate % so overruns like `(116% budget)` read at a glance.

## Validation checklist (Cowork after Delivery-Hub scratch deploy)

Once Delivery-Hub CC swaps the LWC and redeploys to `saas-enterprise-2912`,
Cowork DOM inspection should show:

| Surface | Expected |
|---|---|
| `Delivery_Timeline` tab (embedded) | `toolbarEls: 0`, `auditPassEls: 0`, `hrsWkEls: 0`; **one** button matching `[data-nga-fullscreen-enter="1"]` |
| `Delivery_Gantt_Standalone` (fullscreen) | `toolbarEls ≥ 1`, `auditPassEls ≥ 1`, `hrsWkEls ≥ 1`, `versionBadge ≥ 1`; **one** button matching `[data-nga-fullscreen-exit="1"]` |

Both compositions ship from the same `.resource` bytes — no dual-build.

## Consumer contract (mount container sizing)

The library no longer clobbers the mount container's inline styles. Since
`330eba7`, `IIFEApp.mount` sets only `display: flex; flex-direction: column;
overflow: hidden; background; font-family` via individual property writes —
height/width/position are untouched.

**The consumer MUST give the mount container a real height.** Any of:

1. Position out-of-flow — `position: fixed; inset: 0` (v12's approach) or
   `position: absolute; inset: 0` inside a positioned parent.
2. Explicit pixel height — `height: 600px` or similar.
3. Flex/grid child with defined height — parent is `display: flex` with
   height, container is a flex item that stretches.
4. `height: 100%` with a full chain up to the viewport.

### Salesforce-specific

`deliveryProFormaTimeline.css` already has the right shape:

```css
:host { display: block; height: 100%; min-height: 600px; }
.timeline-root { height: 100%; width: 100%; overflow: hidden; position: relative; }
.timeline-container { height: 100%; width: 100%; overflow: hidden; }
```

As a safety floor, the library adds
`.nga-root[data-mode="fullscreen"] { min-height: 100vh }` in its critical
synchronous CSS. This catches cases where the Lightning app page layout
doesn't resolve `:host` to a real viewport height — the canvas will still
get 100 vh to work with. Embedded mode is NOT floored — embedded consumers
opt into small container sizes by design.

### Web-specific

v12 wraps the mount container in `<div style={{ position: 'fixed', inset: 0, zIndex: 100 }} />`.
After `330eba7` this is preserved, so `.nga-root` is 100 vw × 100 vh and
ContentArea claims all the surplus below the chrome strips.

## Opt-in diagnostic emitter (new in `b202a85`)

Cowork's `C:\Projects\nga-verify.js` can cross-reference DOM state with
library lifecycle events. Default OFF — zero runtime cost on prod.

**Enable before the bundle loads** via any of:

```js
// 1. persistent (survives refresh)
localStorage.setItem('NGA_DIAG', '1');

// 2. per-session (set before <script> tags load)
window.NGA_DIAG = true;

// 3. URL flag
// cloudnimbusllc.com/mf/delivery-timeline-v12?nga_diag=1
```

For console echoing, also set `window.NGA_DIAG_VERBOSE = true`.

**Consume events** from `window.__nga_diag` (array of `{t, kind, ...data}`):

| `kind` | Fires when | Key fields |
|---|---|---|
| `lib:loaded` | bundle module load | `app` (version — currently 'unknown') |
| `mount:start` | `NimbusGanttApp.mount()` entry | `containerId`, `containerRect`, `mode`, `hasOnExit`, `hasOnEnter`, `engineOnly`, `template` |
| `mount:styles-applied` | after non-destructive style writes (chrome path only) | `containerId`, `propsWritten[]`, `preservedConsumer{height,width,position}` |
| `mount:data-mode` | after `data-mode` attribute set (chrome path only) | `containerId`, `mode` |
| `mount:slots-rendered` | after first `renderSlots()` (chrome path only) | `containerId`, `slotOrder`, `rendered[]`, `features` |
| `mount:chrome-heights` | after rAF (both paths — zeros in engineOnly) | `containerId`, `engineOnly`, `root`, `titlebar`, `stats`, `filterbar`, `zoombar`, `audit`, `hrswkstrip`, `contentOuter`, `content` |
| `mount:init-gantt` | canvas initialised (both paths) | `containerId`, `engineOnly`, `canvasW`, `canvasH`, `cssW`, `cssH` |
| `mount:complete` | layout + canvas measurements done (both paths) | `containerId`, `engineOnly`, `taskCount`, `durationMs` |
| `warn:zero-height` | canvas < 64 px sanity trip | `containerId`, `canvasH` |
| `warn:no-canvas` | canvas missing | `containerId` |
| `err:engine-missing` | `window.NimbusGantt` not loaded when mount ran (both paths) | `containerId`, `path` (`'engineOnly'` or `'chrome'`) |
| `err:post-mount` | caught layout errors | `containerId`, `message` |
| `unmount` | `IIFEApp.unmount()` completed | `containerId`, `hadGantt`, `mode` |

**Schema:** every event is `{ t: number (perf.now()), kind: string, ...data }`.
Push order is emission order — grep by `kind` or slice by `t` to correlate
with page events.

## Regression fixes

### `3ffd7d3` — 0.181 cut blockers (HQ's 2026-04-17 empirical check)

Three fixes, one revert. Targets the 0.181 cut specifically.

**B1 — A1 stage-1 view-mode unlock REVERTED.** `CLOUD_NIMBUS_VIEWS` flipped
back to `['gantt']`. Rationale: the alt-view renderers wired in
`IIFEApp.ts:137-242` are ~30-line stubs, not a port of v9's 2,225-line
`AuditListView` component. Shipping 6 pills where only 1 produces a
functional view is worse product than 1 pill that works. Full A1 (unlock
+ vanilla slot ports + keyboard + persistence) bundles into 0.182.

**B2 — AuditPanel state-gate added.** Previously the AuditPanel slot was
only feature-gated (rendered whenever `features.auditPanel === true`), so
clicking the Audit pill in TitleBar flipped `state.auditPanelOpen` but
nothing read it — the panel stayed visible regardless. Added
`root.style.display = p.state.auditPanelOpen ? '' : 'none'` to
`AuditPanel.vanilla.ts`, mirroring the pattern `StatsPanel.vanilla.ts:48`
has used since it shipped.

**B2 (partial) — Stats + Sidebar pill bugs: NOT REPRODUCED.** Static
analysis shows the dispatch + renderSlots + update cycle is correct.
TitleBar's `render(p)` does `clear(root) + rebuild` every call,
`ContentArea.vanilla.ts:34` correctly gates sidebar on `state.sidebarOpen`,
`StatsPanel.vanilla.ts:48` correctly toggles display. Could not reproduce
the symptoms without a browser. Recommend post-rebuild re-check on v12
localhost — if symptoms persist, a console.log at `dispatch()` entry will
confirm whether the events fire, isolating render-cycle vs dispatch-path.

**B3 — viewport now scrolls to today-14d on initial mount.** Previously
the chrome-path `initGantt` never called `scrollToDate` at all; only the
engineOnly (React driver) branch did, and it scrolled to `new Date()`
exactly. Both sites now use `new Date(Date.now() - INITIAL_VIEWPORT_OFFSET_MS)`
where `INITIAL_VIEWPORT_OFFSET_MS = 14 * 24 * 60 * 60 * 1000`. Matches v9
initial viewport; gives ~2 weeks of recent past context instead of flushing
today to the left edge. Library-side default — no new `@api` prop required.

### `9ee5426` — A1 stage-1 + diag observability patches

**A1 stage-1 (view-mode unlock, 1-line flip of `CLOUD_NIMBUS_VIEWS`).** The
alt-view renderers (List / Treemap / Bubbles / Calendar / Flow) have been
wired in `IIFEApp.ts:137-242` since Phase 2, and `rebuildView()` already
dispatches to the correct renderer based on `state.viewMode`. The gantt-only
default was the only thing hiding them from the TitleBar UI (which renders
pills only when `enabledViews.length > 1`). Flipping the array to all six
gets the `6 view modes (A1)` soft-fail on `nga-verify.js` flipped to pass.
Stage-2 work — keyboard shortcuts + URL/localStorage persistence — follows
separately.

**Diag observability patches** (3 gaps identified by `MORNING_BRIEF.md`):

1. `engineOnly` branch (React driver) now emits a symmetric rAF-deferred
   `mount:chrome-heights` + `mount:init-gantt` + `mount:complete` block.
   /v10 (once re-synced) gets the same 8-event signature as /v12.
2. Engine-missing error paths (both `engineOnly` and chrome) emit
   `err:engine-missing` with `{ path: 'engineOnly' | 'chrome' }`.
3. `IIFEApp.unmount()` emits `unmount` with `{ containerId, hadGantt, mode }`.

Support changes: `Registry` entries gained `hadGantt`, `mode`,
`containerId`; a `mountSeq` counter tags each mount with `data-nga-id="nga-N"`;
all existing diag events gained a `containerId` field so Cowork probes can
correlate multi-mount pages.

### `2683542` — zoom-pill dup

`/v12` DOM probe post-`330eba7` showed 8 zoom buttons instead of 4 — one
inline set in `.nga-titlebar`, one standalone `.nga-zoombar` row. Same
latent-vanilla-path pattern as `c9c765d`: cloudnimbus template defaults
had `zoomBar: true`, `TitleBar` renders the pills inline, top-level
`ZoomBar` slot renders a second set. React escaped via the
`features: { zoomBar: false }` override in `DeliveryTimelineV10.tsx`;
/v12 passes no overrides so the dup landed. Fix: flip the cloudnimbus
default to `false` in BOTH `index.ts` (React path) and `index.vanilla.ts`
(IIFE path — the one the Salesforce bundle actually imports).

### `330eba7` — canvas still 0 px post-`c9c765d`

`c9c765d` added the critical flex rules but the canvas was still 0 px on
/v12 and SF because `IIFEApp.mount` was destroying the consumer's inline
positioning via `container.style.cssText = ...`. On /v12 this wiped
`position: fixed; inset: 0`, collapsing `.nga-root` to the 240 px
chrome-sum content height — ContentArea's `flex: 1` had zero surplus.

Fix: replaced both `cssText =` sites with individual property writes that
preserve consumer styles, added `data-mode` attribute + the fullscreen
viewport floor.

### `c9c765d` — on top of Phase 0.5

Diagnosed against `/v12` DOM inspection 2026-04-16. Both bugs pre-existed
Phase 0.5 but only surfaced when /v12 became the first real IIFE-path
consumer (v10 used the React driver, which had already corrected both).

1. **AUDIT PASS rendered twice.** `SLOT_ORDER` ships `AuditPanel` as a
   top-level strip AND `ContentArea.vanilla.ts` re-rendered it inline
   inside the content row-flex. React's `ContentArea.tsx` had dropped the
   inline render months ago when the audit panel moved to a top-level
   commit bar; vanilla never got the same cleanup. Fix: delete the inline
   `AuditPanelVanilla` mount from `ContentArea.vanilla.ts`.
2. **Gantt canvas stuck at ~43 px tall.** The template stylesheet
   (`cssUrl` / Strategy-C injection) is fetched asynchronously via
   `ensureTemplateCss`; but `initGantt()` runs synchronously right after
   `renderSlots()`. Without the `.nga-*` flex rules applied yet, the host
   column-flex hasn't resolved — `ContentArea` measures content-sized
   (tiny), the canvas sizes to ~40-60 px and sticks there. Fix: carry the
   4 load-order-critical flex rules (`.nga-root`, `.nga-content-outer`,
   `.nga-content`, and `flex-shrink:0` on the chrome-strip classes) in
   `injectLegacyNgCss`, which already runs synchronously before
   `initGantt`. The async template stylesheet still owns colours,
   spacing, and typography.

## Status: A1–A7

| Track | Status | Notes |
|---|---|---|
| Phase 0.5 (mode prop) | ✅ done | `fa6a25e` |
| Regression patch (audit dup + critical CSS) | ✅ done | `c9c765d` |
| Regression patch (non-destructive mount + vh floor) | ✅ done | `330eba7` |
| Zoombar dedup | ✅ done | `2683542` |
| Opt-in diagnostic emitter (v1) | ✅ done | `b202a85` |
| A1 stage-1 view-mode unlock + diag observability patches | ⏸ reverted in `3ffd7d3` | A1 unlock reverts for 0.181; diag patches remain active |
| 0.181 cut blockers (revert + AuditPanel gate + today-14d viewport) | ✅ done | `3ffd7d3` — this release |
| A1 full port (stage-1 re-unlock + AuditListView.vanilla + keyboard + persistence) | ⏳ 0.182 | |
| A3 (CSS port, strip `!important` + `mf-depth-check`) | ⏳ 0.182+ | largest visual delta |
| A1 (multi-view switcher) | pending | v10 currently ships `CLOUD_NIMBUS_VIEWS = ['gantt']` |
| A2 (top-bar controls) | pending | Unpin/Admin/Advisor/v3/API-docs wiring |
| A6 (progress % toggle) | pending | |
| A5 (expansion persistence) | pending | Apex coordination likely needed on SF path |
| A4 (scheduler diff) | pending | discovery-only, stops for Glen's pick |
| A7 (version string fix) | pending | |

## Known follow-ups

- `packages/salesforce-adapter/deliveryNimbusGantt/` is a stale standalone
  LWC (targets `window.NimbusGantt` directly, not the app shell). It's not
  consumed by Delivery-Hub and can be removed in a later pass; out of scope
  for this release.
- The `@keyframes mf-depth-check` hack and inline `!important` overrides
  still live in `DeliveryTimelineV5.tsx`; both get killed during A3.

## Consumer-visible behaviour changes

None when `mode` is omitted — default `'fullscreen'` preserves existing
behaviour for `/v10` (cloudnimbusllc.com) and any other caller that doesn't
opt in. `onExitFullscreen` only alters TitleBar when both `mode==='fullscreen'`
and the callback is set; otherwise the pill keeps the v9 local-toggle
behaviour.
