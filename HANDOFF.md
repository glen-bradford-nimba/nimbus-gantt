# nimbus-gantt — HANDOFF

**0.183 — interaction model cut.** IM-1/2/3 drag-to-edit dates + IM-4 drag-to-
reprioritize + IM-5 onItemClick + IM-6 pan-on-deadspace + IM-7 viewport state +
DM-3 hours/budget columns + DM-4 item-row over-budget warning + DM-5 header-row
completion bar + CH-1 chrome toggle. Async contract for IM-1..4: optimistic +
in-flight dim + per-task seq race resilience + revert-on-reject + error
callbacks. DH CC wires TRACK B (live Apex records) against this contract.

## Release metadata

| Field | Value |
|---|---|
| Branch | `master` |
| Commit SHA (source — latest) | `ac76036` *(0.185.30 dragReparent collision-with-self fix)* |
| Commit subject | `feat(0.185.30): dragReparent collision-with-self fix for bucket-edge drops` |
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
- Size: **269,229 bytes** (~263 KB)
- sha256: `3c48790efd885cb5f7bbafb3e38b297037c0bbbef750a52c3fcd1bd19461852b`
- **Must re-copy.** `f24cc24` (0.183.3-diag) adds three `console.log`
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
- Size: **263,295 bytes** (~258 KB)
- sha256: `603c0db0039920c9618ee8e537b779abe5658e72750c16df05c582d0311a63bc`

**0.185.30 — dragReparent collision-with-self fix** (source `ac76036`).
DH CC, re-copy this bundle into `staticresources/nimbusganttapp.resource`.

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
