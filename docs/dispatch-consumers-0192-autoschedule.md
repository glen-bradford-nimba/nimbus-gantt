# Dispatch: 0.192.0 AutoSchedule auto-install + hours-bridge

**Cut by:** NG CC
**Date:** 2026-05-11
**Bundle status:** BOTH bundles MUST re-copy (this is the first cut since
`fa6a25e` that changes both).

| Bundle | md5 | sha256 | bytes |
|---|---|---|---|
| `nimbus-gantt.iife.js` (core) | `9795d5cc7113fec77bd190e431efd594` | `60854b22c7c403ade3be1bc7cf3a83c21d704b86240d07ea09a557b371fc1d48` | 311,564 |
| `nimbus-gantt-app.iife.js` (app) | `44fe727920c7547b7bafe8a46dc1c274` | `f73e04f5ad186002f1441414cf14dc825df529c0db498cfaee4f9c07d532db81` | 280,435 |

This cut takes DH's "Phase 4 hours/forecast plan (~2026-06-12)" and shrinks
its NG-touching surface to ~5 minutes of work — the substrate that DH was
going to write Apex-side now lives in NG.

---

## What changed in NG

### 1. AutoSchedulePlugin auto-installs DORMANT

`packages/app/src/IIFEApp.ts` adds the plugin to every IIFE mount with
`autoRun: false`. The plugin is loaded + listening, but its middleware
does NOT silently mutate task dates on `ADD_DEPENDENCY` /
`REMOVE_DEPENDENCY`. Hosts trigger it explicitly via the existing
`autoSchedule:run` event.

Opt-out:

```js
NimbusGanttApp.mount(container, { autoSchedule: false, ... });
```

Override (e.g. flip on the middleware OR enable work-calendar):

```js
NimbusGanttApp.mount(container, {
  autoSchedule: { autoRun: true, respectWorkCalendar: true },
  ...
});
```

### 2. `AutoScheduleOptions.autoRun: boolean`

New option on the plugin itself (`packages/core/src/plugins/AutoSchedulePlugin.ts`).
Default `true` (backward compat — existing direct
`gantt.use(AutoSchedulePlugin())` callers see no behavior change). Pass
`false` for dormant installs.

### 3. `mountConfig.hoursPerDay` hours→duration bridge

`packages/app/src/pipeline.ts` ships `applyHoursBridge(tasks, hoursPerDay)`
— a pure transform that runs at every IIFE intake point (mount, setTasks,
setData, pushRemoteEvent bulk.replace). When `hoursPerDay` is set, tasks
with both `startDate` and `estimatedHours` get:

```
endDate = startDate + max(1, ceil(estimatedHours / hoursPerDay)) - 1
```

Tasks without `estimatedHours` pass through untouched. Default behavior
when `hoursPerDay` is undefined: no derivation — host-supplied endDates
win as before.

### 4. Walkthrough demo

`packages/demo/src/autoschedule.html` + `.ts` — 6-task FS chain with a
Slip button, a Reschedule button, and a result panel. Proof point that
the plugin works end-to-end independent of any consumer integration.
Build target added to `packages/demo/vite.config.ts` as `autoSchedule`.

---

## DH CC — collapses Phase 4B+C into a button click

**Bundle re-copy:**
- Source: `C:\Projects\nimbus-gantt\packages\core\dist\nimbus-gantt.iife.js`
  (core changed this cut — autoRun gate added)
- Source: `C:\Projects\nimbus-gantt\packages\app\dist\nimbus-gantt-app.iife.js`
- Target: matching static resources in
  `force-app\main\default\staticresources\`. Both `nimbusgantt.resource`
  AND `nimbusganttapp.resource` need re-copy this cut.

**Three things go away from your Phase 4 plan:**

1. **Phase 4B (AutoSchedule install) — collapses to one button.** The
   plugin is already installed on every mount. Wire your "Reschedule"
   button to:

   ```js
   this._mountHandle.gantt.events.emit('autoSchedule:run', (result) => {
     // result.scheduledTasks: Map<taskId, {startDate, endDate}>
     // result.violations: [{taskId, type, message}]
     // The plugin already dispatched TASK_MOVE for each changed task;
     // your existing pendingBuffer + audit-review pipeline picks them up.
   });
   ```

2. **Phase 4C (hours-bridge in Apex) — moves to NG.** Drop the
   `HoursPerDay__c` field on `DeliverySettings__c`. Drop the Apex DTO
   mapper math. Just pass `estimatedHours` per task and flip a mount flag:

   ```js
   NimbusGanttApp.mount(container, {
     hoursPerDay: 8,        // single setting → NG owns the math
     tasks: mappedTasks,    // each task carries estimatedHours from
                            // EstimatedHoursNumber__c via your adapter
     ...
   });
   ```

   If you DO want a `HoursPerDay__c` setting for end-user configurability,
   keep it — but the setting now feeds one prop on the mount call instead
   of driving Apex code.

3. **Optional: flip on the middleware reschedule.** If you'd rather have
   dates cascade automatically on every dependency edit (e.g. from
   the context-menu Add Successor flow), pass:

   ```js
   autoSchedule: { autoRun: true }
   ```

   Off by default because silent date mutation on dep edits would
   surprise users. With this on, dragging a successor arrow from A→B
   reschedules B immediately (and pendingBuffer picks up the resulting
   TASK_MOVE for audit review).

**What's left in your Phase 4 hours/forecast plan after this cut:**
- 4A (populate dependencies) — unchanged, still on you.
- 4B (AutoSchedule wireup) — one button click + one event emit.
- 4C (hours-bridge Apex) — DELETED; NG owns it.
- 4D (dependencies dispatch wiring) — unchanged.
- 4E (what-if-engineer button) — unchanged.

Net: Phase 4 should land 1.5+ weeks earlier per your relay.

**One thing to watch:** if your existing tasks already have
host-computed `endDate` values from a stale snapshot AND you flip
`hoursPerDay: 8` on, the hours-bridge will OVERRIDE the host endDate
on every task that has `estimatedHours`. That's the intended behavior
(hours-as-source-of-truth) but it'll move bars on existing data if
the hours field has been treated as advisory. Verify a small batch
before flipping on broadly.

---

## CN CC — walkthrough page lands easier

**Bundle re-copy:**
- Both bundles changed; both need re-copy this cut. App bundle md5
  was `6abd1540…` at 0.191.0; now `44fe7279…` at 0.192.0. Core was
  unchanged from 0.190.2 through 0.191.0; now `9795d5cc…` at 0.192.0.
- Update `BUNDLE_VERSION` constant in
  `src/app/mf/delivery-timeline-v12/DeliveryTimelineV12.tsx` and
  `src/app/mf/auto-schedule-walkthrough/HeroGanttDemo.tsx` (and any
  other consumer of v12) from `3990764` to whatever 0.192.0 lands at.

**Walkthrough wireup (cascade item #1 from 0.191):** The auto-install
means you no longer need to call `gantt.use(AutoSchedulePlugin(...))`
yourself. Mount the gantt as usual, then wire the Reschedule button
to emit the event:

```jsx
const handle = NimbusGanttApp.mount(container, {
  tasks,
  dependencies,
  hoursPerDay: 8,           // optional — gives you hours-driven durations on the demo
  // autoSchedule defaults to dormant — no explicit config needed
});

function onReschedule() {
  handle.gantt.events.emit('autoSchedule:run', (result) => {
    setLastResult(result);  // render scheduledTasks + violations in the side panel
  });
}
```

Use `packages/demo/src/autoschedule.ts` in this repo as a reference
implementation — same shape will work on the `/mf/auto-schedule-walkthrough`
page. The "slip task A by 7 days, watch successors cascade" interaction
demonstrated there is the headline stakeholder visual the cascade brief
asked for.

---

## Coordination — what NG CC is doing next

Nothing automatic. The auto-install + hours-bridge are the substrate
moves DH explicitly called out as the headline wins; everything else on
DH's Phase 4 list is host-side work. If a real follow-up surfaces (e.g.
`WorkCalendarPlugin` auto-install request once the hours-bridge flushes
out working-day edge cases, or a need for `dependencyDrag` create-
gesture beyond the right-click Add Successor menu), drop a new
`docs/dispatch-ng-*.md` and bump HANDOFF.md so this CC picks it up.
