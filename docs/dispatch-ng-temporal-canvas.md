# Dispatch: NG temporal canvas — time-as-canvas, scrubbable history, forecast preview

**Author:** NG CC
**Date:** 2026-04-29
**Stacks on:** 0.185.37 (remote-events skeleton)
**Targets:** 0.186.0 (asymmetry) → 0.187.0 (event log + cursor) → 0.188.0 (annotation strip) → 0.189.0 (forecast) → 0.190.0 (replay narration)
**Reviewers:** DH CC, CN CC
**Out of scope (separate dispatch):** ContextMenuPlugin / right-click record actions

---

## Design constraint (Glen's framing)

> "...all great potential functionality that doesn't really change anything we're currently doing unless it is enabled so it's like no harm and great potential benefits"

Everything in this dispatch is **additive**, **opt-in**, **zero-cost when off**, and **no breaking change**. Hosts that don't install the temporal plugins see the gantt exactly as it is at 0.185.37. The substrate (action patch log) only runs when at least one temporal plugin is installed.

## Problem

The gantt is a *schedule*. We want it to be a *desktop where work happens over time* — which means:

1. **Past and future shouldn't look the same.** Past is fact (concrete, immutable). Future is forecast (uncertain, ghosty). Today's renderer treats every bar identically regardless of where it sits on the time axis.
2. **You can't see how the timeline got here.** Every state-mutating action (move a date, change a parent, add a dep, complete a task) is discarded after the reducer applies it. Replaying "what did this look like Tuesday?" requires re-fetching from the host's audit table — a round-trip and a separate UI.
3. **You can't preview what-if.** Auto-scheduler computes critical paths against current state but offers no way to stage hypothetical mutations and see their cascade before committing.
4. **History is invisible.** Comments, edits, decisions, completed milestones — all happened *at a time*, but none of them surface on the same time axis the gantt already renders.

White-space confirmed by research: no major PM tool (Linear, Jira, Asana, Smartsheet, Monday, Notion) ships scrubbable schedule history. MS Project baselines (discrete snapshots, max 11) are the closest analog — and they're nothing like a continuous scrub. This is a genuine differentiator, not a copy.

## Conceptual lineage

This frame's direct ancestor is Bret Victor's **"Inventing on Principle"** (2012, ~14:00 mark, Vimeo 36579366) — the live-editing demo where dragging a time slider scrubs Mario's trajectory, with each frame as a translucent ghost. Also informed by:

- **"Stop Drawing Dead Fish"** (Victor, 2012) — direct manipulation of behavior over time
- **"Drawing Dynamic Visualizations"** (Victor, 2013) — every visualization element's full lifecycle visible at once
- **Chronicle** (Grossman et al., UIST 2010) — *event-anchored* scrubbing ("jump to when this changed") beats *time-anchored* scrubbing ("jump to 3pm Tuesday") for many tasks
- **Edward Tufte** — small multiples as a complement to scrubbing (last-week / now / next-week side-by-side)
- **DAW playhead conventions** (Logic, Ableton, Pro Tools, Final Cut, Premiere) — vertical playhead full-canvas height, time ruler at top, opaque past / alpha+dashed future, separate "NOW" bracket
- **Figma version history** — auto-resume on edit pattern (don't try to branch from past in v1)

## Goal

Five composable, opt-in plugins riding one substrate:

| Plugin | Frame | Renders |
|--------|-------|---------|
| `TemporalAsymmetryPlugin` | Past concrete, future ghosty | Per-bar visual split at today-line |
| `TimeCursorPlugin` | Draggable cursor, scrubbable replay | Vertical playhead + ruler controls |
| `HistoryStripPlugin` | Annotation track | Time-anchored markers above timeline |
| `ForecastPlugin` | Forward-scrub + hypothesis preview | Ghost-bar diff overlay |
| `ReplayNarrationPlugin` | Agent narrates "what changed" | Sticky narration panel |

Each shippable independently. Each can ship without the next.

## Substrate: the temporal patch log

**Architecture decision: patch-based, not action-based.** Per research findings (tldraw, Figma, Excalidraw all converge on this; cited at https://immerjs.github.io/immer/patches/), record forward + inverse patches per dispatched action using Immer's `produceWithPatches`. Scrubbing one step backward = applying one inverse patch = O(1). Eliminates the replay-from-snapshot question entirely. Bounds memory at ~200 bytes per action for typical Gantt edits.

```ts
type TemporalEntry = {
  ts: number;                          // performance.now() at dispatch time
  wallTs: number;                      // Date.now() — for host display only
  action: Action;                      // the dispatched action (for narration / replay-from-zero)
  forwardPatches: Patch[];             // Immer forward patches
  inversePatches: Patch[];             // Immer inverse patches
  actor?: string;                      // opaque host string, e.g. user id
  source?: string;                     // 'local' | 'remote' | 'agent-suggestion' | etc.
};

type TemporalAnnotation = {
  ts: number;
  wallTs: number;
  kind: string;                        // 'comment' | 'view' | 'agent-note' | host.custom
  taskId?: string;                     // optional anchor
  payload?: unknown;                   // host-defined
};
```

The log is **bounded** — default ring buffer of 5000 patch entries with idle-time compaction (after 30s of no input, patches older than the 500th get folded into a baseline snapshot and dropped). 5000 patches at ~200 bytes = ~1MB, well under any browser memory budget. Configurable.

**Recorded actions** (the 7 persistent ones; per-repo audit):
- `SET_DATA`, `TASK_MOVE`, `TASK_RESIZE`, `ADD_TASK`, `REMOVE_TASK`, `UPDATE_TASK`, `ADD_DEPENDENCY`, `REMOVE_DEPENDENCY`

**Skipped** (transient view state — would explode log size):
- All scroll, zoom, selection, expansion, drag-update, set-date-range, time-cursor-set actions

## Core changes (small)

```ts
// packages/core/src/model/types.ts

export interface GanttState {
  // ... existing ...
  timeCursorDate: Date | null;         // null = live
}

export type Action =
  // ... existing ...
  | { type: 'SET_TIME_CURSOR'; date: Date | null };

// packages/core/src/NimbusGantt.ts

class NimbusGantt {
  // ... existing ...

  /** History API — delegates to HistoryPlugin if installed. Returns null
   *  when no temporal plugin is providing the substrate. */
  history: HistoryAPI | null = null;

  /** Render path consults plugin-provided replayed state when cursor is
   *  set. When no cursor or no plugin, renders live state as today. */
  private getDisplayState(): GanttState {
    const live = this.store.getState();
    if (!live.timeCursorDate || !this.history) return live;
    return this.history.snapshotAt(live.timeCursorDate) ?? live;
  }
}

interface HistoryAPI {
  /** Live patch log. Read-only — host should not mutate. */
  entries(): readonly TemporalEntry[];
  /** Annotation log. */
  annotations(): readonly TemporalAnnotation[];
  /** Compute the state at a past timestamp. Walks inverse patches from
   *  current state. Returns null if ts is older than the log baseline. */
  snapshotAt(date: Date): GanttState | null;
  /** Append a host-side annotation (comment, decision marker, etc.). */
  appendAnnotation(annotation: Omit<TemporalAnnotation, 'ts' | 'wallTs'>): void;
  /** Last applied wall-clock ts — for host checkpointing across remounts. */
  lastWallTs(): number | null;
}
```

`getDisplayState()` is called by `render()`, replacing the current `this.store.getState()`. When no cursor is set or `history` is null, behavior is identical to today — no perf cost.

`SET_TIME_CURSOR` is the only new state-mutating action and it's not logged (it's view state, not data state).

**Total core change:** ~30 lines + the `getDisplayState` indirection on the render path. Substrate-only — no visual difference yet.

## Plugin 1: `TemporalAsymmetryPlugin` — 0.186.0

Past-concrete / future-ghosty rendering. **Doesn't need the patch log** — operates purely on each bar's relationship to the today-line.

```ts
mount(container, {
  // ...
});
gantt.use(TemporalAsymmetryPlugin({
  pastFill: 'concrete',                  // 'concrete' | 'plain' (default 'concrete')
  futureStyle: 'ghosty',                 // 'ghosty' | 'plain' (default 'ghosty')
  futureBarOpacity: 0.5,                 // 0–1, default 0.5
  futureBorderStyle: 'dashed',           // matches GanttRowDecorators.borderStyle
  pastShowCheckmark: true,               // ✓ on completed past bars
  splitBarsAtToday: true,                // bars spanning today get split rendering
  todayCursorBracket: true,              // colored "NOW" bracket so users can locate live edge
}));
```

**Renderer changes** (one new path in CanvasRenderer.renderTaskBars):
- Compute `todayX` once per render pass
- For each bar, classify: `entirelyPast | spansToday | entirelyFuture`
- Past bars: full opacity, optional checkmark badge if `progress >= 1.0`
- Future bars: alpha multiply by `futureBarOpacity`, dash border per `futureBorderStyle`
- Split bars: render `[barX, todayX]` as past, `[todayX, barX+barW]` as future, no seam line (the today-line itself provides the visual seam)

**No selection/drag interaction change.** Bars are still hit-testable as one unit; the visual is purely cosmetic.

**Backward compat:** plugin off = identical to 0.185.37. On = layered renderer effect.

## Plugin 2: `TimeCursorPlugin` — 0.187.0 (with substrate)

The DAW playhead. Draggable vertical line spanning the timeline canvas. Drag scrubs `state.timeCursorDate` backwards; on release, `getDisplayState()` returns the replayed state and the canvas renders that instead of live.

```ts
gantt.use(TimeCursorPlugin({
  cursorColor: '#3b82f6',
  cursorWidth: 2,
  showRuler: true,                       // tick marks across the time axis showing event density
  showNowBracket: true,                  // colored bracket at today
  scrubDebounceMs: 50,                   // throttle replay during drag
  autoResumeOnEdit: true,                // Figma convention: any edit gesture jumps cursor back to NOW
  confirmIfBackBy: 100,                  // if user is scrubbed > 100 entries back, confirm before edit
  keyboardShortcuts: {
    home: 'goto-start',                  // jump cursor to baseline
    end: 'goto-now',                     // jump cursor to live edge
    leftArrow: 'step-back',              // one entry back
    rightArrow: 'step-forward',          // one entry forward
  },
}));

gantt.use(HistoryPlugin({                // separate plugin — owns the patch log substrate
  capacity: 5000,
  compactAfterIdleMs: 30000,
  compactKeep: 500,
  recordActions: ['SET_DATA', 'TASK_MOVE', 'TASK_RESIZE', /* ... default = the 7 persistent */],
  onEntry: (entry) => { /* host persistence — write to delivery__GanttAuditLog__c or Postgres */ },
  hydrate: priorEntries,                 // host-supplied historical log on mount
  onSnapshotRequest: async (date) => {   // host-side seek for entries older than the in-memory ring
    return await fetchHistoricalEntries(date);
  },
}));
```

**Why two plugins?** `HistoryPlugin` owns the patch log substrate and exposes `gantt.history`. `TimeCursorPlugin` consumes it for the cursor UI. Other plugins (forecast, narration, asymmetry-with-replay) consume the same substrate independently. Splitting keeps each opt-in cleanly.

**Auto-resume convention:** any edit gesture (drag a bar, click a context menu action, type into the tree grid) dispatches a `SET_TIME_CURSOR { date: null }` first, then the actual edit. Past Figma users will recognize the pattern.

**`nimbus:history-scrub` event** fires on the existing `EventBus` whenever cursor changes. Hosts can subscribe to update their own URL / breadcrumbs / audit-trail UI. Per `feedback_host_owns_nav.md`: NG never navigates.

## Plugin 3: `HistoryStripPlugin` — 0.188.0

A horizontal strip docked above the timeline canvas. Renders annotations as time-anchored markers — comments, decisions, agent suggestions, "Glen viewed this 3pm Tuesday."

```ts
gantt.use(HistoryStripPlugin({
  height: 32,
  position: 'above-timeline',            // 'above-timeline' | 'below-timeline'
  density: 'auto',                       // collapse markers when overlap, show ★ for clusters
  markerRenderer: (annotation) => HTMLElement,  // host can override
  onMarkerClick: (annotation) => {       // default: cursor scrubs to annotation.ts
    gantt.history.scrubTo(annotation.wallTs);
  },
}));

// Hosts append annotations:
gantt.history.appendAnnotation({
  kind: 'comment',
  taskId: 'wi-42',
  payload: { author: 'Glen', text: 'Pushed back due to legal review' },
});
```

**Annotation kinds** (NG enumerates a few; `host.custom` for the rest):
- `comment` — chat / activity-feed entries
- `decision` — explicit "decision was made" markers
- `agent-note` — from `ReplayNarrationPlugin`
- `view` — opt-in "user opened this gantt" presence markers
- `host.custom` — anything else, host-rendered

## Plugin 4: `ForecastPlugin` — 0.189.0

Forward-scrub. When `timeCursorDate > now`, this plugin computes projected state via the existing `AutoSchedulePlugin` CPM logic plus any staged hypothetical mutations.

```ts
gantt.use(ForecastPlugin({
  forecastBadgeStyle: 'gradient-fade',   // visual marker that bars are extrapolated, not committed
  hypothesisStyle: 'pulse',              // pulsing outline on bars affected by staged mutations
  onHypothesisStage: (mutations) => { /* host UI — preview banner */ },
  onHypothesisAccept: (mutations) => { /* host writes via Apex / API; reducer dispatches for real */ },
  onHypothesisCancel: () => { /* clear staged set */ },
}));

// Agent or user stages a what-if:
gantt.forecast.stageHypothesis([
  { type: 'TASK_MOVE', taskId: 'wi-42', startDate: '2026-05-15', endDate: '2026-05-22' },
  { type: 'ADD_DEPENDENCY', dependency: { id: 'd-temp', source: 'wi-42', target: 'wi-43' } },
]);
// Plugin previews the cascade. User clicks accept → mutations dispatched for real.
```

**Two forecast modes:**
- **Passive** — cursor at T+future, no staged hypotheses. Shows pure CPM extrapolation given current dates and dependencies. Bars beyond their committed `endDate` render with `forecastBadgeStyle`.
- **Hypothetical** — staged mutations applied on top of passive. Affected bars get `hypothesisStyle` overlay. Accept commits; cancel discards.

Critical separation: hypothetical mutations live in plugin state, **not** in the store. They never enter the patch log unless accepted. Replay over-the-past is unaffected by staged future hypotheses.

## Plugin 5: `ReplayNarrationPlugin` — 0.190.0

Agent narration over scrub. When cursor moves, this plugin asks the host's agent to summarize what changed since the last cursor position. Renders a sticky narration panel.

```ts
gantt.use(ReplayNarrationPlugin({
  panelPosition: 'right',                // 'right' | 'top' | 'bottom' | 'floating'
  narrationTrigger: 'on-pause',          // 'on-pause' (after scrub stops 500ms) | 'on-frame' | 'manual'
  onRequestNarration: async (entries) => {
    // Host calls Anthropic API with the patch entries + task names; returns markdown
    return await askAgentToNarrate(entries);
  },
  onAgentNote: (note) => {
    // Optionally append a note as an annotation visible to other clients
    gantt.history.appendAnnotation({ kind: 'agent-note', payload: note });
  },
}));
```

**Why opt-in agent integration, not first-party:** every host has different LLM access (DH may use Anthropic via an Apex callout; CN uses direct API; demo apps may have no agent). NG describes *what* to narrate (the patch entries); the host owns *who* generates the narration. This matches the Skill-system pattern in CLAUDE.md.

## Cross-cutting: convergent histories via remote-events

The remote-events channel shipped at 0.185.37 (`pushRemoteEvent`) is **already the transport for cross-client history sync**. When client A makes an edit, the action publishes via the host's PE/SSE/WS channel to client B. Client B's `pushRemoteEvent` dispatches the same action through the same reducer. **Both clients log the same `(ts, action, patches)` tuple** with matching `wallTs`/`sequence`. All connected clients have convergent history logs without any extra wire format.

This is not a coincidence. The architectural choice that made 0.185.37 work (per-row reducer dispatch through existing actions) is what makes time-as-canvas work across multi-user surfaces. Memory: `feedback_per_row_dispatch.md`.

## Performance budget

Per research benchmarks (https://immerjs.github.io/immer/performance/):

- **Immer with patches**: ~50k–100k actions/sec on typical hardware. 5000 patches in memory = ~5MB structured cost.
- **Inverse-patch apply (scrub one step)**: O(1), <1ms. Comfortable in 16ms frame budget.
- **Replay from baseline (cold start)**: O(N) in patches. 5000 patches ≈ 50–100ms. Acceptable for cursor jumps; debounce drag.
- **Render budget**: existing 1000-task canvas render is ~5–8ms. Patches don't change this; renderer just consumes a different state object.

`scrubDebounceMs: 50` keeps drag at 20fps perceptually smooth without overdrawing. On scrub-end, full-frame render snaps to 60fps.

## Persistence — host-supplied durable storage

NG holds the in-memory ring (default 5000 entries, last ~1MB). Host owns durable storage. Pattern:

```ts
gantt.use(HistoryPlugin({
  onEntry: (entry) => {
    // DH: insert into delivery__GanttAuditLog__c (one record per entry)
    // CN: POST to /api/gantt/history
    persistAsync(entry);
  },
  hydrate: await fetchHistoryFromBackingStore(),
  onSnapshotRequest: async (date) => {
    // Host returns entries older than the in-memory ring's baseline
    return await fetchHistoricalEntries(date);
  },
}));
```

**DH** stores in a new `delivery__GanttAuditLog__c` SObject (or piggybacks on whatever audit infrastructure already exists — needs DH CC review). **CN** stores in Postgres or a dedicated event log table.

Schema for `delivery__GanttAuditLog__c` (proposal):
- `Ts__c` (DateTime) — `wallTs` from the entry
- `ActionTypeTxt__c` (Text) — action.type
- `ActionPayloadJson__c` (LongText) — action serialized
- `ForwardPatchesJson__c` (LongText)
- `InversePatchesJson__c` (LongText)
- `ActorId__c` (Lookup to User) — entry.actor
- `ClientNonceTxt__c` (Text) — for self-echo correlation with remote-events channel

DH CC: same Apex audit infrastructure that powers `DeliveryWorkItemChange__e` Platform Events can drive this — afterInsert/Update/Delete triggers serialize the patches inline with the existing event publish.

## API surface summary (additive)

```ts
// New mount config (all optional)
mount(container, {
  // ... existing ...
});

// New gantt.use plugins
gantt.use(TemporalAsymmetryPlugin(opts));
gantt.use(HistoryPlugin(opts));
gantt.use(TimeCursorPlugin(opts));
gantt.use(HistoryStripPlugin(opts));
gantt.use(ForecastPlugin(opts));
gantt.use(ReplayNarrationPlugin(opts));

// New runtime API on the gantt instance / IIFE handle
gantt.history?.entries();
gantt.history?.annotations();
gantt.history?.snapshotAt(date);
gantt.history?.appendAnnotation({...});
gantt.history?.lastWallTs();
gantt.history?.scrubTo(date);
gantt.history?.scrubToNow();
gantt.forecast?.stageHypothesis([...]);
gantt.forecast?.acceptHypothesis();
gantt.forecast?.cancelHypothesis();

// New EventBus events
gantt.on('history:scrub', (cursorDate) => {});
gantt.on('history:entry-recorded', (entry) => {});
gantt.on('history:annotation-added', (annotation) => {});
gantt.on('forecast:hypothesis-staged', (mutations) => {});
gantt.on('forecast:hypothesis-accepted', (mutations) => {});
```

## Diag emitters (extending the 0.185.37 pattern)

```
history:entry-recorded         { actionType, ts, source }
history:scrub-start            { fromCursor, toCursor }
history:scrub-end              { cursorDate, replayDurationMs }
history:annotation-added       { kind, taskId }
history:compaction             { compactedCount, baselineTs }
history:hydrate                { entryCount }
forecast:hypothesis-staged     { mutationCount }
forecast:hypothesis-accepted   { mutationCount }
forecast:hypothesis-cancelled  { mutationCount }
```

Writes via the same `diagEmit` pattern as 0.185.37 — `window.__nga_diag` push, gated by `localStorage.NGA_DIAG`. Memory: `reference_diag_side_channel.md`.

## Backward compatibility

Fully additive. Hosts that don't install any temporal plugin see:
- Zero behavior change
- Zero render change
- Zero memory cost (no patch log allocated)
- Zero perf cost (`getDisplayState()` early-returns to live state)

Existing `setData`, `pushRemoteEvent`, `handle.*` continue to work identically.

## Out of scope (deliberately)

- **Branching** — cursor in past + edit = create divergent timeline. CRDT territory. v1 auto-resumes cursor to NOW on any edit (Figma convention). Branch-from-here as an explicit user action lands in 0.191.0 if there's demand.
- **Multi-user history merge conflicts** — every client has its own log; remote-events provides shared mutation order via server-authoritative `sequence` (0.185.38). Last-write-wins. No OT, no CRDT.
- **Far-back queries** — entries older than the in-memory ring require host-side `onSnapshotRequest`. NG doesn't fetch its own history; that'd violate the host-owns-transport principle.
- **Compression** — patches are stored uncompressed. Hosts can compress at the persistence boundary if needed.
- **Per-bar history sparklines** (Tufte) — interesting future direction but not in v1. Easy to layer once the patch log exists.
- **Small-multiples mode** (3-panel side-by-side T-1 / NOW / T+1) — also future. Cheap to prototype on top of the same patch log.

## Ship arc

| Version | Plugin | Key cost | Visible win |
|---------|--------|----------|-------------|
| **0.186.0** | TemporalAsymmetryPlugin | ~150 lines, 1 renderer change, no substrate | "wait, my finished work *looks* finished now" |
| **0.187.0** | HistoryPlugin + TimeCursorPlugin | ~600 lines, Immer dep, core diff for `getDisplayState` | "drag to see Tuesday" |
| **0.188.0** | HistoryStripPlugin | ~250 lines, annotation API | "every change shows up on the timeline itself" |
| **0.189.0** | ForecastPlugin | ~400 lines, AutoSchedule integration | "preview what-if without committing" |
| **0.190.0** | ReplayNarrationPlugin | ~200 lines + host agent integration | "show me how this evolved, narrate" |

Each version independently shippable. Each can land with its own dispatch follow-up if scope shifts.

## Test plan

- **Asymmetry rendering** — past bars render concrete, future bars dashed+faded, today-spanning bars split correctly. Per-zoom-level snapshot tests.
- **Patch log capture** — every persistent action gets logged with valid forward + inverse patches; view-only actions skipped. Vitest against the middleware.
- **Replay correctness** — apply N actions, scrub back to entry K, assert state equals state-after-K. Critical: this is the load-bearing test.
- **Inverse-patch apply round-trip** — for every reducer action, `applyPatches(state, forwardPatches)` equals `reduce(state, action)`, and `applyPatches(reduce(state, action), inversePatches)` equals `state`. Property test.
- **Compaction** — after K patches + idle, verify the baseline snapshot folds correctly and replay from baseline still works.
- **Auto-resume on edit** — scrub cursor to past, dispatch a recorded action, verify cursor returns to null before action applies.
- **Cross-client convergence** — two clients receive the same remote-events sequence; both logs match on `(ts, action.type, patches)`.
- **Forecast hypothesis isolation** — staging hypotheses doesn't pollute the patch log; cancelling cleans up; accepting dispatches real actions.

## DH-side integration sketch

```js
// LWC connectedCallback
connectedCallback() {
  // ... existing mount ...

  // 0.187.0+ — install history substrate
  this._mountHandle.use(HistoryPlugin({
    onEntry: (entry) => persistGanttAuditEntry({ entry: JSON.stringify(entry) }),
    hydrate: this._historicalEntries,  // pre-fetched in connectedCallback
    onSnapshotRequest: async (date) => fetchGanttAuditEntriesBefore({ before: date.toISOString() }),
  }));
  this._mountHandle.use(TimeCursorPlugin({}));
}
```

Apex side: new `delivery__GanttAuditLog__c` SObject (or piggyback on existing audit). `DeliveryWorkItemTriggerHandler` (already publishing `DeliveryWorkItemChange__e`) inserts an audit row per change with serialized patches. Patches come from the LWC bridge — Apex doesn't need to know how to compute them, just store them.

## CN-side integration sketch

```ts
const handle = NimbusGanttApp.mount(container, { /* ... */ });
const historicalEntries = await fetch('/api/gantt/history').then(r => r.json());

handle.use(HistoryPlugin({
  onEntry: (entry) => {
    fetch('/api/gantt/history', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
  },
  hydrate: historicalEntries,
  onSnapshotRequest: async (date) => {
    return await fetch(`/api/gantt/history?before=${date.toISOString()}`).then(r => r.json());
  },
}));
handle.use(TimeCursorPlugin({}));
```

Backing table on the API tier: simple events table with `(ts, action_type, action_json, forward_patches_json, inverse_patches_json, actor, source)`. Index on `ts` for range queries.

## Open questions for review

1. **Patch storage size** — Immer patches for an `UPDATE_TASK` averaging 200 bytes is the assumption. Heavy hosts (DH with 30-field GanttTask + JSON metadata) may exceed this. **Should we add a configurable patch filter** (e.g. exclude `metadata` field from patches)?
2. **Annotation kinds** — should NG enumerate `comment | decision | agent-note | view`, or stay maximally generic with `host.custom` only? More explicit kinds give the strip better default rendering; fewer kinds avoid host-naming collisions.
3. **Wall-clock vs. monotonic ts** — patches use both (`ts` = `performance.now()` for ordering; `wallTs` = `Date.now()` for display). Replay uses `wallTs`. **Is host clock-skew across multi-tab a problem?** (Probably not — server `wallTs` from remote-events takes precedence on cross-client convergence.)
4. **`SET_DATA` in the log** — full snapshot dispatched as one entry could be huge (10k tasks). **Should `SET_DATA` reset the log baseline rather than appearing as an entry?** Probably yes — host snapshot reload via `bulk.replace` already clears the per-id stale-drop map; same pattern fits the patch log.
5. **CN-first or both-at-once?** CN is the faster iteration loop (no Salesforce deploy ceremony). DH inherits stable shape on 0.188.0+ once the persistence schema is settled. Same staging as 0.185.37.
6. **Forecast hypothesis API** — should hypotheses be host-visible (LWC stages mutations from a quick-action) or agent-only (only from `ReplayNarrationPlugin` AI suggestions)? Both is fine; question is what the v1 docs lead with.

## Non-goals

- ContextMenuPlugin / right-click record actions — separate parallel workstream (transport/interaction split).
- Per-bar history sparklines — future, easy on top of patch log.
- Small-multiples mode — future.
- Branching from past — explicitly v1.5+. Auto-resume to NOW on edit is the v1 model.
- Conflict resolution — last-write-wins via remote-events channel ordering.
- First-party LLM integration — host owns the agent; NG describes what to narrate.

## References

- Bret Victor, "Inventing on Principle" (2012), https://vimeo.com/36579366
- Bret Victor, "Stop Drawing Dead Fish" (2012), https://vimeo.com/64895205
- Bret Victor, "Drawing Dynamic Visualizations" (2013), https://vimeo.com/66085662
- Bret Victor, "Up and Down the Ladder of Abstraction" (2011), http://worrydream.com/LadderOfAbstraction/
- Grossman et al., "Chronicle: Capture, Exploration, and Playback of Document Workflow Histories" (UIST 2010), https://www.tovigrossman.com/papers/uist2010_chronicle.pdf
- Edward Tufte, *The Visual Display of Quantitative Information*, ch. 4 (small multiples)
- Immer patches: https://immerjs.github.io/immer/patches/
- Immer performance: https://immerjs.github.io/immer/performance/
- tldraw HistoryManager: https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/editor/managers/HistoryManager
- Excalidraw history: https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw/history.ts
- Figma version history: https://help.figma.com/hc/en-us/articles/360038006754
- MS Project baselines (analog, discrete-only): https://support.microsoft.com/en-us/office/create-or-update-a-baseline-or-an-interim-plan-c0875cdc-3093-46a0-ba03-f128b27aaedd
