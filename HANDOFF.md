# nimbus-gantt — HANDOFF

Phase 0.5 (embedded/fullscreen mode prop) + two follow-up regression fixes
surfaced by /v12. Unblocks Delivery-Hub's LWC swap from the legacy
`window.DeliveryTimeline` bundle to the `window.NimbusGanttApp`
single-source-of-truth. Track A (A1–A7) is next.

## Release metadata

| Field | Value |
|---|---|
| Branch | `master` |
| Commit SHA (source — latest) | `3ffd7d327a1276315b86fd23c999e5cca1b40bcc` |
| Commit subject | `fix(app): 0.181 cut blockers — revert A1 unlock, AuditPanel state-gate, today-14d viewport` |
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
- Size: **267,674 bytes** (~261 KB)
- sha256: `1851cad1b99ad8b98753be4667a1973592851192d698624bbc85d2cca96e0bbf`
- **Unchanged** since Phase 0.5 (`fa6a25e`) — no core source edits.

### `nimbusganttapp.resource` source

- Path: `C:\Projects\nimbus-gantt\packages\app\dist\nimbus-gantt-app.iife.js`
- Size: **144,718 bytes** (~141 KB)
- sha256: `6f1846aebd406883f75170a03c969049be40f1149834d3f11f75b31e1b013f69`
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
