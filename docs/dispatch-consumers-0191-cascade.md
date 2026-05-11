# Dispatch: 0.191.0 consumer cascade (DH-CC + CN-CC + Glen)

**Cut by:** NG CC
**Date:** 2026-05-11
**Source commit:** `3990764` (visibility sweep) + `4bc1e44` (HANDOFF bump)
**Bundle status:** `nimbusganttapp.resource` MUST re-copy (md5 `6abd1540…`,
278,874 bytes). `nimbusgantt.resource` unchanged (still md5 `24273d44…`,
311,537 bytes from 0.190.2).

This cut front-runs the DH/CN work that was queued behind NG capability
gaps. Every action below is host-only — no further NG release required
unless an explicit follow-up dispatch goes the other way.

---

## DH CC — pull master, re-copy app bundle, wire three things

**Bundle re-copy:**
- Source: `C:\Projects\nimbus-gantt\packages\app\dist\nimbus-gantt-app.iife.js`
- Target: `C:\Projects\Delivery-Hub\force-app\main\default\staticresources\nimbusganttapp.resource`
- After copy: redeploy the static resource. `nimbusgantt.resource` does
  NOT need re-copy.

**(1) Close dispatch-dh-dependency-gestures via ContextMenuPlugin wireup.**
The NG-side hit-test + auto-installed menu shipped in 0.189.0. Right-
click any arrow now opens a default menu (Change to FS/SS/FF/SF, Delete
with confirm gate). Host receives one verb callback:

```js
this._mountHandle = NimbusGanttApp.mount(container, {
  // ... existing
  contextMenu: {
    onDependencyAction: async (verb, depId, _pos) => {
      if (verb === 'delete') {
        await deleteWorkItemDependency({ depId });
        this._dependencies = this._dependencies.filter(d => d.id !== depId);
        this._mountHandle.setData(this._tasks, this._dependencies);
      } else if (verb.startsWith('change-type-')) {
        const newType = verb.slice('change-type-'.length).toUpperCase();
        await updateWorkItemDependencyType({ depId, type: newType });
        this._dependencies = this._dependencies.map(d =>
          d.id === depId ? { ...d, type: newType } : d
        );
        this._mountHandle.setData(this._tasks, this._dependencies);
      }
    },
  },
});
```

Need Apex `updateWorkItemDependencyType(depId, type)` to ship alongside
the existing `deleteWorkItemDependency` (which the dispatch's original
spec already called for).

**(2) AutoSchedule wireup against the audit-pass buffer.** Now possible
since NG 0.190.2 exported `AutoSchedulePlugin`. Two hosts work to land:

```js
const handle = NimbusGanttApp.mount(container, {
  batchMode: true,
  // ... existing
});

// After mount, install AutoSchedule on the underlying engine:
handle.gantt.use(NimbusGantt.AutoSchedulePlugin({
  direction: 'forward',
  respectWorkCalendar: false, // flip on once WorkCalendarPlugin is wired
}));

// Trigger reschedule on demand (e.g., from a "Reschedule" button):
handle.gantt.events.emit('autoSchedule:run', (result) => {
  // result.scheduledTasks: Map<taskId, {startDate, endDate}>
  // result.violations: [{taskId, type, message}]
  // Drag-derived patches already land in pendingBuffer — same does this
});
```

DH-side bridge work (per the strategic analysis):
- `EstimatedHoursNumber__c` → date math. Compute
  `endDate = startDate + Math.ceil(estimatedHours / HoursPerDay__c)`
  in the Apex DTO mapper before handing tasks to NG. Add
  `HoursPerDay__c` to `DeliverySettings__c` (default 8).
- Decide whether AutoSchedule fires automatically on every `setData`,
  on host-triggered button, or on every `ADD_DEPENDENCY` / `REMOVE_DEPENDENCY`
  middleware tick (plugin already does the last one for free).
- The middleware-induced `TASK_MOVE` dispatches land in `pendingBuffer`
  the same way drag-induced ones do, so the audit-pass review modal
  shows algorithmic proposals alongside manual changes.

**(3) Layer 0 Watcher — `DeliveryWatcherService` + daily Slack digest.**
Independently surfaced by the strategic analysis as THE keystone for
delegating other work. Per `docs/SUBTRACT_GLEN_ROADMAP_2026-04-24.md`,
SLA fields + escalation rules + Slack service already exist; ~16h of
composition (3-PR MVP). No NG dependency. Highest leverage on Glen's
day-to-day burden.

**(4) Lower-effort polish (shovel-ready):** Brand-neutralize 3
`'Cloud Nimbus LLC%'` literals in `DeliveryHubSetupController.cls`
(`:61, :84, :91`). Auto-assign installer to `DeliveryHubAdmin` PSG +
auto-call `scheduleAll()` in `DeliveryHubInstallHandler.onInstall`.
Flip 6 report date filters to `INTERVAL_CUSTOM`+All-Time. Total ~3-4h.

---

## CN CC — bump v12 to 0.191.0 + ship the AutoSchedule walkthrough

**Bundle re-copy:**
- Sources:
  - `C:\Projects\nimbus-gantt\packages\core\dist\nimbus-gantt.iife.js`
    (unchanged from 0.190.2 — only re-copy if you haven't already)
  - `C:\Projects\nimbus-gantt\packages\app\dist\nimbus-gantt-app.iife.js`
    (must re-copy for 0.191.0)
- Target: `C:\Projects\cloudnimbusllc.com\public\nimbus-gantt.iife.js`
  + `nimbus-gantt-app.iife.js`
- Update `BUNDLE_VERSION` constant in
  `src/app/mf/delivery-timeline-v12/DeliveryTimelineV12.tsx` from
  `05a8aff` (0.190.0) to `3990764` (0.191.0).

**(1) Wire `/mf/auto-schedule-walkthrough` to a live NG.** Page exists
as a concept doc; replace the static content with an actual mounted
v12 gantt that has `AutoSchedulePlugin` installed and a "Reschedule"
button that fires `autoSchedule:run`. Pair with a "drag a finish date,
watch successors cascade" interaction. The stakeholder-facing visual
that closes the MF Phase 3 forecasting pitch.

**(2) Fix `/mf/charts/capacity` — Developer Capacity Heatmap.** Has
been a "Planned" placeholder for 3+ weeks. ProForma seed has hour
data. Use `HeatmapViewPlugin` (now documented in the Available
Plugins table) or a vanilla ECharts heatmap fed from the same data
source the other 3 charts use. Glen's hours-forecast-plan asks for
exactly this view; broken-promise pages on stakeholder URLs erode
credibility.

**(3) Bundle-hash assertion test on v12.** A Vitest/Playwright check
asserting the `BUNDLE_VERSION` constant matches the sha256 of
`/public/nimbus-gantt-app.iife.js` would catch the entire class of
bundle-version-vs-source-version drift that's bit you in
`HANDOFF_FROM_DH_CLAUDE.md` and Glen's memory. ~30 min of CI work,
prevents an entire failure mode at PR-time.

**(4) Retire `src/lib/nimbus-gantt-app/` + dead v3-v11 routes.** Per
v12 page header comment + Glen's memory
(`project_sf_adapter_dead.md`), 8 importers still hot. Migrate them
to `@nimbus-gantt/core` or to script-loading the IIFE, then nuke the
vendored copy. v3-v11 (10 routes total) appear to be sediment;
confirm with Glen which (if any) need to stay as reference, archive
the rest.

**(5) Hero stories for AutoSchedule + CriticalPath + RiskAnalysis.**
9 hero stories already shipped at NG `c81061d` for CN demo pages.
None showcase the temporal-canvas triad (now auto-installed) or
the CPM/analytics plugins. A "what slips if this slips?" CPM demo
+ a "Monte Carlo over your delivery dates" page would land cleanly
on the AutoSchedule walkthrough cascade.

---

## Glen — glenbradford.com `/consulting` is broken

The page still has literal `{{CALENDLY_URL}}` placeholder tokens at
`src/app/consulting/page.tsx:19-25`. This is the ONLY converting
surface for Cloud Nimbus pipeline. ~30 min of edits gated on three
decisions only you can make:

1. Calendly URL — pick one (or pick a Cal.com / SavvyCal alternative).
2. Three testimonials — Mahipal Jyani (Untangle It), a DH client,
   and... ?
3. Capacity / rate framing — keep the $10K/hr quote, or shift to
   retainer/value framing per `/fractional-architect`?

Side note from the strategic analysis: the `glenbradford-salesforce`
subdomain (`/hire-me`, `/career-guide`, `/mistakes`,
`/delivery-hub-roi`, `/appexchange-listing-checklist`) is a much
cleaner Cloud Nimbus hiring + product funnel than the main domain
trying to be both personal-brand and B2B. Push that as the public
face and stop making `glenbradford.com` do double duty.

Also: the `Act As If` framework + voice profile + 886 pages of
context across glenbradford repos = best fine-tune corpus for a
$29-$99 productized course OR a "voice-trained Glen-bot" on
`/consulting`. Lowest-effort revenue diversification beyond
consulting. Track as a side-quest, not in the way of the cascade.

---

## Coordination — what NG CC is doing next

Nothing, until one of the above lands and surfaces a real NG-side
follow-up (e.g. WorkCalendarPlugin auto-install request from DH once
the hours-bridge work flushes out the working-day edge cases, or a
`dependencyDrag` create-gesture request once the Add Successor menu
proves insufficient). The visibility sweep is the unlock; consumers
own the cascade.

If anything in this dispatch is wrong — e.g. you tried the
`onDependencyAction` wireup and the menu didn't fire, or the
AutoSchedule install threw — drop the symptom into a new
`docs/dispatch-ng-*.md` and bump HANDOFF.md so this CC picks it up
on its next session.
