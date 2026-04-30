# Test Plan: Hero Stories — Nimbus Gantt Demo Pages on cloudnimbusllc.com

**Author:** NG CC
**Date:** 2026-04-30
**Status:** 9 hero scenarios. Each is a dual-purpose artifact:
  1. **A demo page concept** for cloudnimbusllc.com showcasing one
     Nimbus Gantt feature in the form of "hero saves the day."
  2. **A test scenario** runnable by a Cowork Claude agent that drives
     the gantt programmatically, verifies the rescue, and reports
     pass/fail.

Each story has the same structure:
  - **Hero & crisis** — narrative setup. Who needs saving, what's
    breaking.
  - **Features showcased** — which NG capabilities the rescue uses.
  - **Demo page implementation** — what CN builds: starting state,
    seeded data, page chrome.
  - **Hero arc** — the user-facing interaction sequence (also doubles
    as a script for a recorded walkthrough).
  - **Agent rescue brief** — the prompt for a Cowork Claude to drive
    via `window.gantt.agent.*` + the success criteria the agent self-
    checks. Pass/fail is verifiable without a human.

Together the 9 stories cover all 19 user-visible features shipped in
0.185.37 → 0.189.1.

---

## Hero Story 1 — "The Friday Reckoning"
### Past Concrete / Future Ghosty (Asymmetry)

**Hero:** Maya, a Director of Engineering, on her way to a Friday board
review. **Crisis:** She's about to walk into a meeting with 47 tasks
across three quarters and zero idea what's actually shipped vs. still
"in progress" (her PMs marked everything as 80% done two months ago).
The board wants to know what's *real*. She has 8 minutes before the
meeting starts.

**Features showcased:** TemporalAsymmetryPlugin (auto-installed).

**Demo page implementation:**
- Mount NG with cloudnimbus template, 47 sample tasks spanning
  2025-Q4 → 2026-Q2.
- ~30 tasks have `progress >= 1` and `endDate < today` — those render
  with full-opacity bars + ✓ checkmarks (concrete past).
- ~12 tasks span today — split-rendered (concrete past portion,
  ghosty future portion).
- ~5 tasks entirely future — translucent + dashed outline.
- Top-of-page banner: "Maya needs to know what shipped. Look at the
  bars." No hand-holding beyond that.

**Hero arc:** Page loads. Concrete past vs. ghosty future is visually
unmistakable. Maya can scan the gantt in seconds and see the gap
between "what we said we'd ship" and "what shipped." She walks into
the meeting with a one-glance answer.

**Agent rescue brief (for Cowork Claude):**
```
You are Maya. Open /demos/friday-reckoning. Your job:
1. Use window.gantt.agent.getSnapshot() to count tasks.
2. Classify each task by its visual state. A task is "concrete past"
   when endDate < today AND progress >= 1. "Ghosty future" when
   startDate > today. "Split" when startDate <= today <= endDate.
3. Save the day: produce a one-sentence answer to "what shipped this
   quarter?" by counting concrete-past tasks whose endDate is in the
   current quarter.
4. Pass criteria:
   - Concrete-past count is correct (matches dataset's known truth).
   - Future tasks are visually distinct (verify by inspecting
     window.__nga_diag for "decorator" emissions, or alternatively by
     screenshot comparison against /demos/friday-reckoning/expected.png).
   - Total count matches getSnapshot().tasks.length.
Report PASS / FAIL with the one-sentence answer.
```

---

## Hero Story 2 — "The Tuesday That Wasn't"
### Time Cursor Scrub + Inverse-Action Replay

**Hero:** Devon, a tech lead. **Crisis:** A senior dev was let go
yesterday afternoon and three of her tasks got reassigned in a panic.
The dates got dragged around in the gantt during the scramble. Now
nobody can remember what the original plan looked like before the
reshuffle, and the CEO is asking "weren't we going to ship feature X
on Tuesday?" Devon needs to show what Tuesday looked like *before
yesterday's panic*.

**Features showcased:** HistoryPlugin substrate, TimeCursorPlugin,
inverse-action replay, `gantt.history.scrubTo()`.

**Demo page implementation:**
- Mount with HistoryPlugin + TimeCursorPlugin installed.
- Pre-seed the history log with 50 timestamped action entries spanning
  the past 7 days. Last 5 entries are "panic moves" all timestamped
  yesterday afternoon (TASK_MOVE actions touching three tasks).
- Each entry includes its inverse action so replay actually works.
- A small banner: "Press Home to see what Tuesday looked like."

**Hero arc:**
1. Page loads — current state shows the post-panic schedule.
2. Devon presses `Home` (or clicks "Show baseline") → cursor scrubs
   to 7 days ago. Dates rewind to original positions.
3. Devon scrubs cursor to "Tuesday" — exact state at Tuesday 6pm.
4. The CEO is right: feature X *was* on Tuesday before the panic.
5. Devon presses `End` to return to now.

**Agent rescue brief (for Cowork Claude):**
```
You are Devon. Open /demos/tuesday-that-wasnt. Your job:
1. Capture the live state's startDate/endDate for tasks t-101, t-102, t-103.
2. window.gantt.history.scrubTo(new Date('2026-04-22T12:00:00Z')).
3. Wait one rAF, then capture the same three tasks' dates from
   window.gantt.getDisplayState() — these should be the PRE-PANIC
   values seeded in the demo's expected.json.
4. window.gantt.history.scrubToNow().
5. Verify dates match the live state captured in step 1.
6. Pass criteria:
   - Pre-panic dates match expected.json[Tuesday] for all three tasks.
   - Post-scrub-to-now dates match the live state captured in step 1.
   - window.__nga_diag contains a 'history:scrub' emission with the
     correct cursorWallTs.
Report PASS / FAIL with the three task dates at each timepoint.
```

---

## Hero Story 3 — "Right-Click Saves the Sprint"
### Context Menu — Canvas-Empty → Create Work Item

**Hero:** Zara, a sprint planner. **Crisis:** Standup just ended.
Three new urgent items came up: a security patch for the NOW lane
starting Wednesday, a customer escalation to slot before Friday's
release, and a refactor parked in PROPOSED for next sprint. Zara has
a stand-up retro in 20 minutes. The old workflow: open a modal, fill
in 12 fields, three times, while looking at her notes for the right
priority bucket. She doesn't have time.

**Features showcased:** ContextMenuPlugin canvas-empty zone,
`gantt.hitTestAt`, bucket inference from row, `onCreateTask` callback.

**Demo page implementation:**
- Mount with ContextMenuPlugin + cloudnimbus PriorityGroupingPlugin
  (NOW / NEXT / PLANNED / PROPOSED / HOLD lanes seeded).
- `onCreateTask` wired to a quick inline form that prefills the date,
  bucket, and parentId from the click context.
- Banner: "Right-click anywhere in a lane to create a task there."

**Hero arc:**
1. Zara right-clicks Wednesday in the NOW lane → "Create work item
   starting 2026-05-06" with bucket prefilled to `top-priority`.
2. She types the security patch name + Enter. Task appears in NOW
   on Wednesday. ~3 seconds.
3. She right-clicks Thursday in NOW → another quick create.
4. She right-clicks next Monday in PROPOSED → refactor parked
   correctly.
5. Three tasks in three lanes in 20 seconds. She makes the retro.

**Agent rescue brief (for Cowork Claude):**
```
You are Zara. Open /demos/right-click-sprint. Your job:
1. Establish baseline: window.gantt.agent.getSnapshot().tasks.length
2. Programmatically simulate right-click at three locations:
   - Date 2026-05-06, Y inside NOW lane
   - Date 2026-05-07, Y inside NOW lane
   - Date 2026-05-11, Y inside PROPOSED lane
   For each, dispatch a synthetic 'contextmenu' event at clientX/clientY
   computed from window.gantt.timeScale.dateToX(date) + the lane's
   row offset.
3. After menu opens, find the "Create work item starting…" item
   (querySelector on .ng-ctxmenu-label) and click it.
4. The demo's onCreateTask handler auto-fills a name and submits.
5. Verify three new tasks now exist in the snapshot, with correct
   priorityGroup (or groupId) per click location.
6. Pass criteria:
   - 3 new tasks added.
   - Bucket assignment correct: 2 in 'top-priority', 1 in 'proposed'.
   - startDate matches the click position.
   - All happened within 5s wall-clock (this is a live-ux story).
Report PASS / FAIL with the new task IDs + their buckets.
```

---

## Hero Story 4 — "The Phantom Dependency"
### Right-Click Dependency Arrow → Delete + Change Type

**Hero:** Jamal, integrations engineer. **Crisis:** A scheduling
inheritance from his predecessor: a tangled web of dependencies, half
of which are wrong. There's one specific FS dependency between two
services that is blocking deployment — but the services don't actually
depend on each other, that arrow was added by mistake six months ago.
Until now, removing it required Jamal to open Apex / paste an Id /
run a SOQL update. Today: right-click and delete.

**Features showcased:** DependencyRenderer.hitTest, dep zone in
ContextMenuPlugin, `onDependencyAction` callback, destructive-confirm
gate.

**Demo page implementation:**
- Mount with 5 tasks + 8 dependencies, one of which is the "phantom"
  (id `dep-phantom`) — visibly long arrow connecting two unrelated
  bars in the middle of the chart.
- `onDependencyAction` wired to remove via `gantt.agent.removeDependency`
  on 'delete' or change type via dispatch on 'change-type-*'.
- Confirm prompt fires before deletion (default window.confirm or
  custom toast-with-undo).

**Hero arc:**
1. Jamal sees the phantom arrow snaking across the gantt.
2. Right-clicks the arrowhead → menu opens with "Delete dependency"
   + "Change type → ..." submenu.
3. Clicks Delete → confirm dialog ("Delete dependency dep-phantom?")
   → confirms.
4. Arrow disappears. Critical-path recomputes. Deployment unblocks.

**Agent rescue brief (for Cowork Claude):**
```
You are Jamal. Open /demos/phantom-dependency. Your job:
1. Find dep-phantom in window.gantt.agent.getSnapshot().dependencies.
2. Compute the arrowhead screen position: timeScale.dateToX(target.startDate)
   for FS, etc. Fire a synthetic right-click at that position.
3. Verify menu opens with 5 items (4 type-changes + Delete).
4. Stub window.confirm = () => true to bypass the confirm prompt
   (for the test only — production keeps it).
5. Click "Delete dependency".
6. Verify dep-phantom is gone from getSnapshot().dependencies.
7. Pass criteria:
   - Menu opened on dep-phantom (not the wrong arrow).
   - After delete, dependencies.length decreased by exactly 1.
   - dep-phantom.id is no longer in the list.
   - The remaining 7 dependencies are unchanged.
Report PASS / FAIL with the before/after dep counts.
```

---

## Hero Story 5 — "The 11pm Capacity Crisis"
### Agent API + ✦ Ask Claude: Reschedule with CPM

**Hero:** Priya, a project lead at 11pm the night before a release.
**Crisis:** A capacity audit showed her team is overcommitted by 38
hours next week. Critical path is at risk. She needs to know which
tasks to push, but the dependency tree is 200+ items deep. Manual
analysis is a 4-hour exercise. She has 30 minutes before her partner
goes to bed and she's promised to actually be there.

**Features showcased:** Agent API (`gantt.agent.*`), ContextMenuPlugin
✦ items, `onAgentRequest` plumbing, agent rate-limit, agent-driven
mutations through the same reducer as user gestures.

**Demo page implementation:**
- Mount with 200 tasks, intentional capacity hotspots seeded.
- `onAgentRequest` wired to a `/api/ask-claude` endpoint that calls
  Anthropic API with the supplied snapshot + prompt, then resolves by
  staging mutations via `gantt.agent.moveTask(...)` or
  `gantt.agent.updateTask(...)`.
- `agentRateLimit: { maxCalls: 5, windowMs: 60000 }` — 5 calls per
  minute, generous for a deliberate workflow.

**Hero arc:**
1. Priya right-clicks the most-overcommitted task bar.
2. ✦ menu shows "Ask Claude: reschedule with critical-path
   optimization."
3. Click. 4 seconds later, ghost previews appear on 6 tasks (Claude's
   suggested moves).
4. She accepts 4 of them, rejects 2. Capacity now 4 hours under, not
   38 hours over. Critical path holds.
5. 28 minutes elapsed. She closes the laptop.

**Agent rescue brief (for Cowork Claude):**
```
You are Priya. Open /demos/capacity-crisis. Your job:
1. Identify the most overcommitted task by getSnapshot() (highest
   estimatedHours of those starting in the next 7 days).
2. Synthesize a right-click contextmenu at that bar's position.
3. Click the ✦ "reschedule with critical-path optimization" item.
4. Wait for the demo's onAgentRequest stub to call back (the demo
   pre-seeds a deterministic response, not a live LLM call).
5. The stub stages 6 mutations via gantt.agent.moveTask. Verify
   the gantt updated.
6. Compute total capacity for next week before vs after. Should drop
   by ~38 hours.
7. Pass criteria:
   - 6 mutations applied.
   - Capacity overrun resolved (under-budget after the moves).
   - Critical-path task didn't move.
   - HistoryPlugin.entries() contains 6 new TASK_MOVE entries with
     source='agent'.
Report PASS / FAIL with before/after capacity numbers.
```

---

## Hero Story 6 — "Convergent Truth"
### pushRemoteEvent — Two Tabs, One Truth

**Hero:** Kai, on the design ops team, in a war room with his director
on a video call. **Crisis:** They're triaging a customer escalation,
each looking at the gantt on their own laptop. The director keeps
saying "I see X" but Kai sees Y. They're looking at stale data on one
machine and nobody knows which. With three other escalations queued,
they can't afford another round of "refresh your browser" confusion.

**Features showcased:** Remote-events channel (0.185.37
`pushRemoteEvent`), per-row reducer dispatch, cross-client convergence,
HistoryPlugin's matching `(ts, action)` tuples on both clients.

**Demo page implementation:**
- Two browser tabs mount the same gantt instance against the same
  fake "server" (a SharedWorker or BroadcastChannel that fans out
  events).
- Each tab's mutations publish to the channel; the other tab pumps
  via `pushRemoteEvent`.
- Side panel shows live "you are user A / user B" + a real-time event
  log identical on both tabs.

**Hero arc:**
1. Tab A drags a bar 3 days right. ~200ms later Tab B's bar slides
   to the same position.
2. Tab B clicks "Mark complete" on a different task. Tab A flips.
3. Both tabs' history strip shows the same annotations in the same
   order with the same timestamps. The director and Kai are looking
   at the same gantt now.
4. They resolve the escalation in 10 minutes flat.

**Agent rescue brief (for Cowork Claude — runs both halves):**
```
You are Kai. Open /demos/convergent-truth in two iframes (or two
windows controlled by the agent). Your job:
1. In tab A, dispatch gantt.agent.moveTask('t-1', '2026-05-10', '2026-05-15').
2. Wait 500ms. In tab B, getSnapshot().tasks.find(t => t.id === 't-1').
   Verify startDate === '2026-05-10' and endDate === '2026-05-15'.
3. In tab B, dispatch gantt.agent.updateTask('t-2', { progress: 1 }).
4. Wait 500ms. In tab A, getSnapshot().tasks.find(t => t.id === 't-2').
   Verify progress === 1.
5. Compare both tabs' history.entries() — should have identical
   actionType + wallTs sequences.
6. Pass criteria:
   - Cross-tab convergence latency < 1 second per event.
   - Both tabs' history logs are byte-identical (same actionType
     in same order with matching ts).
   - Total entries on both = 2 (one TASK_MOVE + one UPDATE_TASK).
Report PASS / FAIL with both tabs' final state hashes.
```

---

## Hero Story 7 — "The Annotation Trail"
### History Strip + Annotations as Audit Trail

**Hero:** Aiko, an internal auditor doing a post-mortem. **Crisis:** A
project shipped 3 weeks late. Leadership wants to know "when did we
know?" Was there a moment where someone could have raised a flag and
prevented the slip? She has 200 tasks of project history to walk and
no patience for grep-ing Slack archives.

**Features showcased:** HistoryPlugin annotations, HistoryStripPlugin,
agent-note kind, click-to-scrub on annotation markers, time-anchored
narrative.

**Demo page implementation:**
- Mount with HistoryPlugin pre-hydrated with 200 entries spanning
  3 months + 40 annotations of various kinds (comments, decisions,
  agent-notes flagged "risk detected here", "capacity concern raised").
- HistoryStripPlugin renders all 40 markers above the timeline.
- Side panel shows annotation details when one is clicked.

**Hero arc:**
1. Aiko sees the strip — 40 markers across 3 months. Two clusters
   stand out: 6 markers in one week (mid-March), and 4 in another
   (early-April).
2. She clicks the March cluster → cursor scrubs there → side panel
   shows "agent-note: capacity overrun detected, recommend re-prioritize."
3. She finds the post-mortem's smoking gun: a March 14 risk that was
   dismissed. She has her answer.
4. Files a process recommendation. Saves the next quarter's project.

**Agent rescue brief (for Cowork Claude):**
```
You are Aiko. Open /demos/annotation-trail. Your job:
1. Get all annotations: window.gantt.history.annotations().
2. Group by kind. There should be 40 total, split across
   comment/decision/agent-note/view.
3. Find the agent-note that contains 'capacity overrun' in its
   payload. Note its wallTs.
4. window.gantt.history.scrubTo(new Date(thatAnnotation.wallTs)).
5. Verify gantt.getDisplayState() shows the project state at that
   moment (a known-overcommitted week per expected.json).
6. Pass criteria:
   - All 40 annotations enumerated, kinds match expected.json
     distribution.
   - The 'capacity overrun' note found at wallTs in expected.json's
     critical-week range.
   - After scrubbing, getDisplayState's tasks include the dropped-or-
     postponed tasks per expected.json.
Report PASS / FAIL with the annotation count by kind + the
critical-week summary.
```

---

## Hero Story 8 — "The Bucket Migration"
### Bucket Header Right-Click + Reparent + Change Bucket

**Hero:** Lin, a director re-organizing priorities for the next
quarter. **Crisis:** Six tasks currently sitting in PLANNED need to
move to NOW because a customer just signed an enterprise deal that
depends on them. The traditional flow: drag-drop one at a time,
hoping they land in the right order, fixing sortOrder afterwards.
With six tasks and meeting starting in 5 minutes, she needs a faster
path.

**Features showcased:** ContextMenuPlugin bucket-header zone,
`onTaskAction('change-bucket', ...)`, row-label right-click, agent
API for bulk operations.

**Demo page implementation:**
- Mount with 6 specific tasks visibly in PLANNED that need to move.
- Right-click on any of them → "Change bucket…" → submenu with
  NOW / NEXT / PROPOSED / HOLD options.
- Bonus: right-click on the PLANNED bucket header → "Move all to NOW"
  custom action (host-supplied via onContextMenu override).

**Hero arc:**
1. Lin right-clicks task 1 in PLANNED → Change bucket → NOW.
2. Repeats for tasks 2–5 in 30 seconds.
3. For task 6 she experiments with the bucket-header right-click →
   sees "Add task to NOW" option, realizes she needs the converse.
   Right-clicks task 6 directly, moves it.
4. All 6 tasks now in NOW lane in the right order. 90 seconds total.

**Agent rescue brief (for Cowork Claude):**
```
You are Lin. Open /demos/bucket-migration. Your job:
1. Identify the 6 tasks in 'follow-on' (PLANNED) bucket that the
   demo flags via metadata.targetBucket === 'top-priority'.
2. For each, simulate right-click on the row label → click "Change
   bucket…" → submenu → NOW. Or directly call
   gantt.agent.updateTask(id, { groupId: 'top-priority' }) since
   the menu fires that callback.
3. Wait 200ms after each.
4. Verify all 6 tasks now in 'top-priority' bucket via
   getSnapshot().
5. Verify sortOrder is monotonic within the bucket (no collisions).
6. Pass criteria:
   - 6 tasks moved.
   - PLANNED bucket no longer contains them.
   - NOW bucket contains them, sortOrder consistent.
   - HistoryPlugin captured 6 UPDATE_TASK entries (replayable).
Report PASS / FAIL with the bucket distribution before/after.
```

---

## Hero Story 9 — "The Walkthrough"
### Date Header Right-Click + Add Milestone + Scroll-To-Date

**Hero:** Ren, an engineering manager prepping a stakeholder
walkthrough. **Crisis:** They're presenting Q2 progress to leadership
in 1 hour and the gantt is too zoomed-in to show the quarterly
narrative. They need to mark four key milestones on the date axis so
the audience knows what to look at, then walk through each one in
sequence. Doing this with the existing milestone-add modal would take
20 clicks per milestone.

**Features showcased:** ContextMenuPlugin date-header zone,
`onDateAction('add-milestone')`, `onDateAction('scroll-here')`, level
inference (week vs month).

**Demo page implementation:**
- Mount with cloudnimbus template at `month` zoom.
- Date header has two rows (year on top, month below).
- `onDateAction` wired to actually drop a milestone task at the
  clicked date when 'add-milestone' fires.

**Hero arc:**
1. Ren right-clicks April in the month header → "Add milestone on
   2026-04-01" → milestone diamond appears on the gantt.
2. Repeats for May 1, June 1, July 1. Four milestones in 30 seconds.
3. During the meeting, right-clicks April → "Scroll to 2026-04-01"
   → gantt scrolls smoothly. Walks through the quarter.
4. Stakeholders nod. Promotion conversation gets warmer.

**Agent rescue brief (for Cowork Claude):**
```
You are Ren. Open /demos/walkthrough. Your job:
1. Capture initial milestones: getSnapshot().tasks.filter(t => t.isMilestone).
2. For each of [2026-04-01, 2026-05-01, 2026-06-01, 2026-07-01]:
   - Compute clientX = timelineRect.left + timeScale.dateToX(d).
   - clientY = inside date-header band.
   - Synthesize right-click; click "Add milestone on …" item.
3. Verify 4 new milestone tasks now exist.
4. Then synthesize right-click on April again, click "Scroll to
   2026-04-01". Verify state.scrollX moved.
5. Pass criteria:
   - 4 new milestones added at correct dates.
   - Each milestone has isMilestone === true.
   - scrollX after scroll-to is consistent with timeScale.dateToX(2026-04-01)
     adjusted for viewport center.
Report PASS / FAIL with the new milestone IDs + final scrollX.
```

---

## Test Plan Mechanics — for Cowork Claude

### Per-story setup

Each demo page (cloudnimbusllc.com `/demos/<story-slug>/`) is a
self-contained mount of NimbusGanttApp + cloudnimbus template +
deterministic seeded data. The page exposes:

- `window.gantt` — the engine instance (history + agent + context-menu APIs)
- `window.handle` — the IIFE app handle (setData / pushRemoteEvent / etc)
- `window.expected` — the per-story expected state (counts, IDs, bucket
  distributions, etc.) for the agent to assert against
- `window.scenario` — a small object with helper methods the demo
  exposes (e.g. `scenario.simulateContextMenu(x, y)`,
  `scenario.acceptHypothesis(id)`).

### Pass/fail reporting format

Each agent reports as:
```
STORY: <name>
RESULT: PASS | FAIL
DETAIL: <one-paragraph summary>
TELEMETRY: <relevant captured numbers / IDs / hashes>
DIAG: <window.__nga_diag tail (last N events)>
```

### Running the full battery

```bash
# CN side, one terminal per agent
for slug in friday-reckoning tuesday-that-wasnt right-click-sprint \
  phantom-dependency capacity-crisis convergent-truth annotation-trail \
  bucket-migration walkthrough; do
  cowork agent --task "Run hero story $slug per docs/test-plan-cn-hero-stories.md"
done
```

Or in parallel via Cowork's batch mode. Each agent is fully isolated
(separate browser, separate seeded state) so one story's failure
doesn't poison the others.

### What "save the day" actually means at the test level

Each agent must:
1. **Establish a baseline** — confirm the demo loaded and the crisis
   is real (e.g. capacity overrun is actually 38h, the phantom dep is
   actually phantom).
2. **Drive the rescue** — exercise the feature end-to-end through the
   public APIs (no internal hacks; if the agent has to reach into
   private state to make the test pass, that's a bug in the demo
   page).
3. **Verify the rescue worked** — the crisis state has resolved
   according to deterministic criteria.
4. **Confirm no collateral damage** — unrelated state didn't change,
   diag emissions are clean, no console errors.

When all 9 agents return PASS, every shipped feature has been
exercised by an autonomous test that mirrors a real user crisis. Glen
gets to do whatever he wants instead of regression-testing. That is
the day saved.
