# Dispatch: DH — wire dependencies through getGanttDependencies

**Requester:** NG CC (glen-bradford-nimba)
**Date:** 2026-04-21
**Pairs with:** NG 0.185.27 — re-exposes `dependencies` on IIFE init + setData

## Context

NG core has always supported dependencies (GanttDependency type,
DependencyRenderer, Map<string, GanttDependency> in the store, arrows
rendered between bars). In the v10/v11 rewrite, the IIFE app layer
hardcoded `dependencies: []` at both engine-init call sites, so even
though core could draw arrows the app never fed them in.

DH Apex already exposes `getGanttDependencies(Boolean showCompleted)`,
which returns `List<GanttDependency>` off `WorkItemDependency__c`
records (`BlockingWorkItemLookup__c` → `BlockedWorkItemLookup__c`,
`TypePk__c`). Apex test exists. The LWC never calls it — dead code
today.

NG 0.185.27 re-exposes the pipe:

- `MountOptions.dependencies?: GanttDependency[]` — initial set
- `handle.setData(tasks, dependencies)` — runtime replace (same signature
  as core)

No other NG-side work required. DH just needs to call the existing Apex
and pass the result through.

## DH-side changes

**File:** `force-app/main/default/lwc/deliveryProFormaTimeline/deliveryProFormaTimeline.js`

### 1. Call `getGanttDependencies` in parallel with `getProFormaTimelineData`

Currently the LWC only fetches timeline data. Add a parallel call:

```js
import getGanttDependencies from '@salesforce/apex/DeliveryGanttController.getGanttDependencies';

// In the connected / refresh path:
const [timelineData, dependencies] = await Promise.all([
  getProFormaTimelineData({ /* existing args */ }),
  getGanttDependencies({ showCompleted: this.hideCompleted === false }),
]);
```

Match the `showCompleted` flag to whatever toggle the LWC already
tracks — if dependencies reference completed tasks and those tasks
are filtered out, the arrows will dangle. Safest: pass
`showCompleted: true` for v0 and let NG render any orphan arrows as
no-ops (the engine already handles that gracefully). Tighten later
if orphans become a UX issue.

### 1b. Map Apex DTO field name to NG's expected shape

**Wire-compat bug to flag:** Apex DTO field is `dependencyType`; NG core's
`GanttDependency.type`. LWC must map before passing or FF/SS/SF arrows
render with the default type (wrong corner path). Cheapest fix is a
client-side map — renaming the Apex field would force a managed-package
bump.

```js
const deps = (dependencies || []).map((d) => ({
  id: d.id,
  source: d.source,
  target: d.target,
  type: d.dependencyType || 'FS',
}));
```

### 2. Pass dependencies into NG mount config

```js
window.NimbusGanttApp.mount(this.template.querySelector('.gantt-host'), {
  tasks: normalizedTasks,
  dependencies,                     // ← NEW
  // ... existing options
});
```

### 3. Pass through on refresh/re-hydrate

Wherever the LWC calls `handle.setTasks(newTasks)` today, switch to
`handle.setData(newTasks, newDependencies)`:

```js
const [timelineData, dependencies] = await Promise.all([...]);
this._ngHandle.setData(normalizeTasks(timelineData), dependencies);
```

(The old single-arg `setTasks(newTasks)` still works — passing no
second arg leaves dependencies alone. Only call `setData` when you
have a fresh deps array.)

## Out of scope (v0)

- Drag-to-create gesture. Users edit dependencies via record pages
  for now; Gantt just renders the arrows. Bolt-on for later: drag
  from task right-edge handle to another task's left-edge = create
  FS dependency. Delete via context menu. Requires onDependencyClick
  + new DragManager mode + Apex insert/delete endpoints.

## Verify on glen-walk

After NG 0.185.27 static resource is installed and DH PR lands:

1. Load `/lightning/n/Delivery_Timeline` with at least one
   `WorkItemDependency__c` in the org.
2. Open DevTools, confirm `getGanttDependencies` returns the expected
   array (check Network tab or Apex debug log).
3. Visual: arrows render between the two bars per the dep's type
   (FS/FF/SS/SF — DependencyRenderer draws the right corner path for
   each).
4. Drag a predecessor bar — arrow should redraw live as the bar moves.
5. Toggle hideCompleted — arrows to filtered-out tasks should either
   disappear (if you passed showCompleted=false) or render as
   dangling stubs (if true and the target is hidden).

## Release trigger

NG 0.185.27 bundle ships first. DH PR can be authored in parallel but
shouldn't merge until the NG static resource is deployed. Otherwise
the LWC passes a `dependencies` prop that older NG bundles ignore —
no error, just no arrows.

## Answers to open questions (confirmed by Glen 2026-04-21)

1. **`showCompleted: true` for v0.** Keep it simple — dangling arrows to
   hidden tasks are rare and NG renders them gracefully. Tighten later
   if it becomes ugly.
2. **Yes, route through `refreshApex`** alongside timeline data — cache
   parity + same invalidation triggers. Easiest is a single wire-adapter
   combining both, or parallel `@wire` with shared refresh handler.
3. **Test mocks:** existing LWC tests use the `getProFormaTimelineData`
   Jest mock pattern — add a parallel `getGanttDependencies` mock
   returning `[]` for the happy path, and a second test with one dep to
   verify the `dependencyType` → `type` mapping.

Ping NG CC when shipped so we can verify end-to-end on glen-walk.
