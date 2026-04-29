# Dispatch: CN CC — bundle swap for temporal-canvas (0.186.0 + 0.187.0 + 0.188.0)

**Author:** NG CC
**Date:** 2026-04-29
**Source SHA on nimbus-gantt master:** `2439c71` (with HANDOFF bump at `87d0f12`)
**For:** CN CC (cloudnimbusllc.com `/v12`)
**Status:** Ready to deploy. No NG-side action remaining.

## TL;DR

Three temporal-canvas plugins shipped on nimbus-gantt master. **Asymmetry
plugin auto-installs in IIFE** — re-copy the two bundle files + bump
`BUNDLE_VERSION` and `/v12` lights up with past/future visual asymmetry on
real proForma data with zero adapter change. History substrate, time
cursor, and agent API are opt-in via 3 lines after mount if you want
those too.

## Bundle artifacts to copy

From the nimbus-gantt repo's build output:

- **`packages/core/dist/nimbus-gantt.iife.js`** — 288,867 bytes
  - sha256: `265e0943a014ba0c9ecef4f4731bfa200bdb0f6e9d0ff3af6d9ae9404af7bf86`
  - Copy to: `cloudnimbusllc.com/public/nimbus-gantt.iife.js`

- **`packages/app/dist/nimbus-gantt-app.iife.js`** — 270,825 bytes
  - sha256: `daccc75a29b99b04696e95bad1b24bc039f35bee60f8ca44da6e55a5811dadaa`
  - Copy to: `cloudnimbusllc.com/public/nimbus-gantt-app.iife.js`

(Path mappings match the existing v12 `<Script>` tags at
`DeliveryTimelineV12.tsx:450–461`.)

## BUNDLE_VERSION bump

In `src/app/mf/delivery-timeline-v12/DeliveryTimelineV12.tsx` line 339:

```diff
- const BUNDLE_VERSION = "d2ac51a";
+ const BUNDLE_VERSION = "2439c71";
```

`2439c71` is the latest temporal-canvas ship (HistoryStripPlugin + demo);
`b5f3176` is the temporal-canvas core cut (asymmetry + history + cursor +
agent API). Either SHA works as a cache-buster — I'd use `2439c71` since
it's the head.

## What lights up with zero further change

Past bars on /v12 render at full opacity; future bars render with a
translucent fade-toward-background overlay + dashed outline; bars that
span today render concrete on the left, ghosty on the right. Past
completed bars (`progress >= 1`) get a small ✓ checkmark.

This works because `IIFEApp.mount` auto-installs `TemporalAsymmetryPlugin`
on both engineOnly and chrome paths. Hosts opt out via
`mountConfig.temporalAsymmetry: false`. Customize via
`mountConfig.temporalAsymmetry: { futureFadeStrength: 0.7, ... }` —
options in `packages/core/src/plugins/TemporalAsymmetryPlugin.ts`
(`TemporalAsymmetryOptions` interface).

The today-line that already renders on /v12 is now the visible "seam"
between concrete past and ghosty future. No additional UI required.

## Optional: light up scrubbable history + agent API (3 lines)

If you want the time-cursor + history substrate + agent API on /v12:

```ts
// In DeliveryTimelineV12.tsx, after App.mount(...) returns instRef.current:
const ng = instRef.current?.gantt;  // 0.187.0 added .gantt accessor on the handle
if (ng) {
  ng.use(window.NimbusGantt.HistoryPlugin({
    capacity: 5000,
    onEntry: (entry) => {
      // Optional persistence — POST to /api/gantt/history
      // For dev play, leave undefined — entries stay in-memory only.
    },
  }));
  ng.use(window.NimbusGantt.TimeCursorPlugin({}));
  ng.use(window.NimbusGantt.HistoryStripPlugin({}));
}
```

Then keyboard scrub works (`Home` = baseline, `End` = live, `Alt+Arrow`
= step day). Console interaction:

```js
window.NimbusGanttApp.handle.gantt.agent.getSnapshot()
window.NimbusGanttApp.handle.gantt.agent.scrubTo("2026-04-15")
window.NimbusGanttApp.handle.gantt.history.entries()
window.NimbusGanttApp.handle.gantt.capabilities()
```

(Or whatever ref you store the mount handle on — the agent + history
APIs hang off the engine instance, accessible via `handle.gantt`.)

This is purely opt-in and changes nothing if you don't add it.

## Ship-readiness check

- ✅ Both bundles built and verified to contain the new symbols
  (TemporalAsymmetryPlugin, HistoryPlugin, TimeCursorPlugin,
  HistoryStripPlugin, agent API, `getDisplayState`, `registerReplayProvider`)
- ✅ 128/128 tests pass on master
- ✅ Per-row decorator path (0.185.36) and remote-events channel
  (0.185.37) both still work — additive cut, zero breaking change
- ✅ HANDOFF.md bumped at `87d0f12` with full release metadata

## v10 callout

`/v10` (cloudnimbusllc.com vendored framework copy at
`src/lib/nimbus-gantt-app/`) is still ~5+ commits behind monorepo per
existing memory (`reference_sibling_repos.md` notes /v10 drift).
Re-syncing the vendored copy is its own task; the bundle swap above
only affects `/v12`. /v10 will continue rendering as it does today.

## Verify

After bundle swap + version bump, /v12 should:

1. Render past bars at full opacity, future bars visibly faded with a
   dashed outline. Bars spanning today split-render at the today line.
2. Console error count: zero.
3. `window.NimbusGanttApp.version` (if exposed) or just bundle-load diag
   `lib:loaded` event reflects the new build (`__nga_diag` array on
   `window`).
4. No regression on existing right-click / context-menu / drag-reparent
   flows. Same handle surface as 0.185.37 plus the new `.gantt`
   accessor for plugin installs.

## If something breaks

The most likely failure mode is template engine namespace collision
(unlikely — the temporal plugins are additive renderCanvas overlays;
they don't touch existing slots). If /v12 throws on mount, check the
browser console for an error pointing at TemporalAsymmetryPlugin —
disable via `temporalAsymmetry: false` in the mount config and ping NG
CC with the stack trace.

For the optional opt-in plugins (HistoryPlugin / TimeCursorPlugin /
HistoryStripPlugin), if any of them error in install, they'll throw
synchronously from `gantt.use()` — catch and skip, don't bring down
the whole mount.
