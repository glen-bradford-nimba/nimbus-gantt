# nimbus-gantt — HANDOFF

Phase 0.5 (embedded/fullscreen mode prop) shipped and unblocks Delivery-Hub's
LWC swap from the legacy `window.DeliveryTimeline` bundle to the
`window.NimbusGanttApp` single-source-of-truth. Track A (A1–A7) is next.

## Release metadata

| Field | Value |
|---|---|
| Branch | `master` |
| Commit SHA (source) | `fa6a25e2d40cac07390cbfbe9ba2a2f51d7c0525` |
| Commit subject | `feat(app): Phase 0.5 — embedded/fullscreen mode prop + host-nav callbacks` |
| Parent commit | `a49a130eda7f38d84ef3ed143e6bee8e76bb8037` |

## Bundle artifacts

Both IIFE bundles were rebuilt from commit `fa6a25e`. Absolute paths, byte
sizes, and sha256 digests below. `dist/` is gitignored — Delivery-Hub CC
copies these bytes into `force-app/main/default/staticresources/…` as the
deploy step.

### `nimbusgantt.resource` source

- Path: `C:\Projects\nimbus-gantt\packages\core\dist\nimbus-gantt.iife.js`
- Size: **267,674 bytes** (~261 KB)
- sha256: `1851cad1b99ad8b98753be4667a1973592851192d698624bbc85d2cca96e0bbf`

### `nimbusganttapp.resource` source

- Path: `C:\Projects\nimbus-gantt\packages\app\dist\nimbus-gantt-app.iife.js`
- Size: **134,789 bytes** (~132 KB)
- sha256: `22c505b93ece2915b0c3ee9e2be4a9d3fee7b77b16b0d500d1a54fe7ff7e8606`

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

## Status: A1–A7

| Track | Status | Notes |
|---|---|---|
| Phase 0.5 (mode prop) | ✅ done | this release |
| A3 (CSS port, strip `!important` + `mf-depth-check`) | ⏳ next | largest visual delta |
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
