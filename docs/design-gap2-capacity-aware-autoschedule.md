# Design — Capacity-Aware Auto-Schedule (GAP 2) + Preview-Before-Commit

**Status:** design / pre-build · **Owner:** NG · **Drafted:** 2026-06-10
**Targets:** NG core (`AutoSchedulePlugin`) + app (`pacing.ts`, modal apply path)
**Decided last session (2026-06-09):** pursue **option (a)** — extend the
auto-scheduler to resource-constrained scheduling. Explicitly **reject option
(b)** — writing forecast-leveled dates back onto task schedule (data-flow
inversion; would make the forecast overlay authoritative over DH's task dates).

**Companion doc:** [design-dml-staging-layer.md](./design-dml-staging-layer.md).
Auto-schedule is one **producer** into the session-wide DML staging cart. The
"pro-forma → confirm → commit" behavior described in §3.4 here is the *same*
gather-mode buffer the staging layer governs — when gather mode is on, an
auto-schedule run **stages its proposed dates into the cart** (no DML) rather
than dispatching `TASK_MOVE`. Read the two together.

---

## 1. The two gaps (why this exists)

Live on MF-Prod (0.271 / app capacity-leveling), the forecast view and the Gantt
disagree:

- **GAP 1 — Gantt bars cluster at the start.** Many work items share a start date
  (every proposed "rock" dated *today*) and carry no `WorkItemDependency` edges,
  so the auto-scheduler has nothing to sequence them against. They all lay out
  stacked on the same week — a vertical wall, not a plan.

- **GAP 2 — the PACE dial moves the forecast but not the Gantt.** Turning the
  Pace selector (Off / 1× / 2× / 3×) re-levels the **forecast overlay** —
  `levelForecast()` in `packages/app/src/renderers/pacing.ts` spreads forecast
  hours so no bucket exceeds `capacityPerBucket(hoursPerMonth, size, pace)`. But
  it operates **only on the forecast's bucketed hours**; it never emits new task
  dates. The Gantt bars and the per-item ETAs stay where they were. So the
  forecast says "smooth ramp through August" while the Gantt still says
  "everything starts Jun 8." Two layers, two truths.

Both gaps share one root: **the schedule isn't capacity-aware.** The CPM engine
(`computeSchedule`) sequences by dependencies + constraints only — it has no
notion of a finite team. Fix that and *both* gaps close: capacity-leveling
spreads the no-dependency cluster forward (GAP 1) **and** produces real dates the
Gantt can draw + the forecast can derive from (GAP 2).

---

## 2. Current architecture (what we're extending)

### 2a. The scheduler — `packages/core/src/plugins/AutoSchedulePlugin.ts`
- `computeSchedule(tasks, deps, opts, calendar)` → `ScheduleResult`.
- Kahn topo-sort → forward pass (ES/EF per task from FS/SS/FF/SF + lag + the 8
  MSP constraints) → selective backward pass for ALAP. O(V+E). Proven correct on
  a real dependency pair (RRF alerting → Phase III lays out to Jul 16).
- **No resource dimension.** A task's only "demand" is its calendar duration;
  nothing caps how many tasks occupy the same day.
- Two entry points already exist and matter here:
  - `scheduleAll()` — computes **and applies** (dispatches `TASK_MOVE` per
    changed task). Wired to `autoSchedule:run` + the auto-reschedule middleware.
  - `previewSchedule()` — computes **without applying** (no dispatch). Wired to
    `autoSchedule:preview` (added 0.196.1 for review-before-DML).
- `AutoScheduleOptions` already carries `projectStart`, `direction`,
  `constraints`, `respectWorkCalendar`, `autoRun`. We add capacity here.

### 2b. The forecast overlay — `packages/app/src/renderers/pacing.ts`
- `levelForecast(d: PacingData, capPerBucket)` — **pure, display-only.** Splits
  each bucket into its actual (kept in place) and forecast (lifted out as
  schedulable "units"), then greedily re-fills buckets earliest-first so no
  bucket's `actual + forecast` exceeds `capPerBucket`, spilling overflow into
  later buckets and extending the horizon. Preserves tier (segment) attribution
  and per-item drill-down. **Never returns dates — only re-bucketed hours.**
- `capacityPerBucket(hoursPerMonth, size, pace)` — the ceiling math:
  `hoursPerMonth × (size factor) × pace`, where week = 12/52, month = 1,
  quarter = 3. The Pace selector picks `pace ∈ {0, 1, 2, 3}` (0 = off).
- Capacity pool is fed via `PacingViewOptions.capacity.hoursPerMonth` (IIFE
  passes `CLOUD_NIMBUS_POOL`; DH/CN feed the real team pool).

**Key observation for convergence:** `levelForecast` and a capacity-aware
scheduler are the *same greedy serial leveling*, run on different substrates —
one on forecast hours, one on task dates. They must share the **same ceiling
function and the same bucketing**, or the two views will disagree by rounding.

---

## 3. Design

### 3.1 Resource model (single team pool, v1)
- One renewable resource: the team, `capacityHoursPerDay = hoursPerMonth / 21.7`
  (working-day basis; reuse the pacing month→bucket factor so the two layers
  match exactly — do **not** invent a second constant).
- A task's **demand** is its `estimatedHours` (remaining = `est − logged`),
  spread evenly across its scheduled span. v1 ignores per-assignee pools; the
  pool is the whole team. (Per-owner leveling is a v2 noted in §6.)
- The Pace multiplier scales the daily ceiling identically to the forecast:
  `dailyCeiling = capacityHoursPerDay × pace`. **Pace is the single dial that
  drives both the forecast leveler and the schedule leveler** — one source of
  truth, so they cannot diverge.

### 3.2 Capacity-aware forward pass (the core change)
Layer resource-leveling **on top of** the existing dependency forward pass —
don't replace it. After a task's earliest dependency/constraint-feasible start
`es` is computed (today's logic, unchanged), run it through a capacity gate:

1. Maintain a running **load ledger**: `dayLoad: Map<dayKey, hoursPlaced>`.
2. Process tasks in topo order, **breaking ties within the ready-set by
   priority** (`priorityGroup` / tier order: greenlit → predicted → ready),
   then by `es`. (This is the resource-leveling priority rule; the dependency
   topo order is still the hard constraint — we only reorder among tasks that
   are *simultaneously* ready.)
3. For each task, find the earliest start `≥ es` where its per-day demand fits
   under `dailyCeiling − dayLoad[day]` for **every** day of its span. If a day is
   saturated, push the start forward (date-shift) until the whole span fits.
4. Commit: add the task's per-day demand to `dayLoad`, set its new ES/EF.

This is greedy serial resource-leveling (RCPSP is NP-hard; greedy + priority
rule is the industry-standard heuristic — what MS Project's "Level Resources"
does). Deterministic given the priority rule. Still O(V·span) in practice.

**v1 choice: date-shift, not duration-stretch.** A task keeps its duration and
slides later until it fits. Simpler, and it directly cures GAP-1 clustering
(the wall of today-dated items fans out into a ramp). Duration-stretch (place
hours at the capacity rate, lengthening the bar) is more faithful to "39 h/wk"
but mutates durations and complicates dependency math — deferred to v2 (§6).

### 3.3 Convergence with the forecast (closing GAP 2)
Once the schedule is capacity-leveled, the forecast **derives from the leveled
dates** instead of re-leveling independently:

- `computeFromTasks()` already spreads each task's hours across its *scheduled*
  span. If the scheduled dates are already capacity-leveled, the forecast ramp
  falls out for free — **no separate `levelForecast` pass needed** on the
  scheduled path.
- Therefore: **when capacity-aware AutoSchedule is active and applied,
  `levelForecast` becomes redundant** and should be bypassed (else we double-level
  and under-count near buckets). `levelForecast` stays for two cases it still
  owns: (a) **standalone / no scheduler** (CN web preview with no DH dates), and
  (b) **pro-forma preview** before the schedule is committed (see §3.4) — the
  forecast can show the *proposed* leveled ramp by leveling the overlay while the
  Gantt shows the *proposed* leveled bars from `previewSchedule`, both off the
  same pace.

Net: the Pace dial drives `previewSchedule(capacity)` → proposed Gantt dates **and**
the forecast overlay off the same `capacityPerBucket`. They move together.

### 3.4 Preview-before-commit (Glen's explicit ask)
> *"I'm not sure if applying them does the DML now or just shows it on the page.
> I want to separate the two — look at pro-formas on the page and see what things
> look like before committing them."* — MF/ATLARGE, 2026-06-10

The seam already exists (`previewSchedule` vs `scheduleAll`). Harden it into a
first-class two-step:

- **Pro-forma (preview):** `autoSchedule:preview` runs `computeSchedule` with
  capacity, returns the `ScheduleResult` (proposed dates + violations) **without
  any dispatch**. NG renders proposed bars as a ghost/diff overlay (before→after,
  the modal already shows the changed-items list) and the forecast shows the
  proposed ramp. **Zero state mutation, zero DML.**
- **Commit (apply):** only `scheduleAll()` (via `autoSchedule:run`) dispatches
  `TASK_MOVE`. On Salesforce, `TASK_MOVE` is what the host turns into DML — so the
  preview/commit split *is* the no-DML/DML split. Keep `autoRun:false` for the
  IIFE auto-install so nothing levels silently.

**Invariant to enforce & test:** `previewSchedule()` dispatches **nothing**.
Add a regression test asserting no actions flow through the store during a
preview. This is the contract that lets DH safely wire "show me the pro-forma"
to a button that never writes.

### 3.5 Pace dial → both layers (wiring)
- Extend `AutoScheduleOptions` with
  `capacity?: { hoursPerMonth?: number; pace?: number }` (mirror the pacing
  shape exactly).
- The pacing view's Pace selector, on change, additionally fires
  `autoSchedule:preview` (or `:run` when the user commits) with the chosen pace,
  so turning the dial re-lays-out the Gantt pro-forma in lockstep with the
  forecast overlay it already re-levels.
- Single ceiling helper shared by core + app (extract `capacityPerBucket` /
  `capacityHoursPerDay` to one place both import — today it lives only in
  pacing.ts). Prevents the rounding-divergence failure mode.

---

## 4. Why not option (b) — write leveled dates back
Rejected last session and re-affirmed: `levelForecast` produces *bucketed hours*,
not task dates, and it's a display artifact. Promoting it to author task dates
would (1) invert ownership — the forecast overlay would dictate the schedule DH
owns; (2) lose dependency/constraint correctness the CPM pass guarantees;
(3) create a hidden write-back path that's hard to preview/commit cleanly. The
clean direction is the reverse: **schedule is the source of truth; forecast
derives from it.**

---

## 5. Build phases (≈2 weeks, not an evening)

- **P0 — shared ceiling + capacity option (½ day).** Extract `capacityHoursPerDay`
  / `capacityPerBucket` to a shared module; add `capacity` to
  `AutoScheduleOptions`. No behavior change yet. Tests pin the math.
- **P1 — capacity-aware forward pass (core, ~3–4 days).** Load ledger + ready-set
  priority rule + date-shift placement in `computeSchedule`. New
  `ScheduleViolation` type `'resource'` already reserved. Unit tests: cluster of
  N today-dated items with pool P fans into a ramp; dependency order still
  respected; pace scales the spread.
- **P2 — preview/commit hardening (core+app, ~2 days).** Assert preview dispatches
  nothing (regression test). Modal before→after diff already renders the changed
  list; confirm it reads from `previewSchedule`, not `scheduleAll`.
- **P3 — forecast convergence (app, ~2 days).** Bypass `levelForecast` on the
  scheduled+applied path; keep it for standalone + pro-forma preview. Test:
  applied leveled schedule → forecast ramp matches the pace dial with no double-
  leveling.
- **P4 — pace-dial wiring + demo (app, ~1–2 days).** Pace selector drives
  `autoSchedule:preview`; Gantt pro-forma re-lays-out as the dial turns. Hero
  test / demo page.

GAP-1 clustering is **substantially fixed by P1 alone** (no-dependency items fan
out under the ceiling) — that's the earliest shippable win and worth cutting on
its own if the demo needs it before the full arc lands.

---

## 6. Deferred / v2
- **Per-assignee resource pools** (level each owner independently, not one team
  pool). Needs an owner→capacity map from the host.
- **Duration-stretch mode** (place hours at the capacity rate, lengthen bars)
  as an alternative to date-shift — more faithful to "39 h/wk", more invasive.
- **Work-calendar-aware ceilings** (holidays reduce that period's capacity) —
  the calendar bridge already exists; fold in once P1 is stable.
- **Backward (deadline-driven) capacity leveling** — current design is
  forward/ASAP only.

---

## 7. Open questions for Glen
1. **Demand basis** — level on `estimatedHours` remaining (recommended) or full
   `estimatedHours`? Remaining matches the forecast's "work left to do."
2. **Priority rule** — tie-break the ready-set by `priorityGroup`/tier (matches
   the forecast cohorts) — confirm that's the intended business priority, or is
   it sortOrder?
3. **v1 = date-shift** (slide whole bars) vs duration-stretch — confirm date-shift
   for the first cut.
4. **Apply scope on Salesforce** — does committing mean a bulk `TASK_MOVE`→DML of
   every shifted item, gated behind the existing audit/review list? (Ties to DH's
   review-before-DML governance.)
