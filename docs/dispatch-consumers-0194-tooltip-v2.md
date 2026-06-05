# Dispatch → DH + CN: 0.194.0 — Tooltip v2 (host rows + dependency + baseline)

**Cut:** 0.194.0 (branch `feat/0.194.0-tooltip-v2` → merged `master`)
**Builds on:** 0.193.0 (`docs/dispatch-consumers-0193-tooltip-hittest.md`).
**Origin:** Glen — *"a lot more we can do on the mouseover to make it
actually useful."* Three additive pieces, all at the NG substrate so DH/CN
inherit on a core-bundle re-copy.

## What shipped (NG core)

### 1. `GanttTask.tooltipRows?: {label, value, emphasis?}[]` — the fork-preventer
Hosts append domain rows to the default tooltip (request #, budget line,
forecast, owner) **without forking the renderer**. Rendered in their own
block; `emphasis: true` renders the value red. This is the clean answer to
"we need custom tooltip content" — the exact itch that produced the DH and
CN tooltip forks. One uniform renderer, host-configurable content.

### 2. Dependency summary — `Blocked by N · Blocks N`
Engine counts graph edges on hover (`computeDepSummary`): `blockedBy` =
predecessors (this task waits), `blocks` = successors (wait on this task).
Renders only when non-zero. Free for every consumer — no data to feed.

### 3. Baseline variance — `Start vs plan +3d · Finish vs plan −2d`
Reads host-supplied `metadata.baselineStart` / `metadata.baselineEnd` (ISO);
shows signed day drift vs. `startDate`/`endDate`, late = red. Hides when no
baseline metadata. Decoupled from `BaselinePlugin` (which keys baseline by
ID internally) — to light this up, drop the same baseline dates onto the
task's `metadata`.

**Contract unchanged:** `onHover` and custom `tooltipRenderer` signatures are
untouched; a custom renderer still owns its full markup (and should read
`task.tooltipRows` itself if it wants parity).

## Consumer adoption
- **Re-copy CORE bundle only** — `nimbus-gantt.iife.js`, md5
  **`ecf538f90b5618bc00606d6825477d56`**. App bundle still doesn't embed core
  (unchanged). Verify hash after copy.
- **`tooltipRows`** — opt-in; populate it on the task DTO where you want extra
  rows.
- **Dependency summary** — automatic once deps are passed to NG (DH/CN already
  do).
- **Baseline** — optional; feed `metadata.baselineStart/End` when available.

## ⚠️ Carried-over findings from the 0.193.0 Cowork live test (act on these)
The Cowork pass found 0.193.0's engine work correct but the **rollout
half-applied** — these block the tooltip from being *visible*, and 0.194.0
inherits the same gap:
1. **CN never feeds hours.** The sizing/actuals block (and now baseline/host
   rows) render only when the data exists. CN's seed/adapter must map hours →
   `metadata.estimatedHours` / `metadata.loggedHours` (DH already does this in
   `_mapTasksForNg`). Until then the block is shipped-but-dark on CN.
2. **CN has a stale vendored core.** `/gantt-demo` imports
   `src/lib/nimbus-gantt/core.js` (April 16, pre-0.193) instead of the swapped
   `public/nimbus-gantt.iife.js`. Refresh the vendored copy or repoint the demo
   at the iife, or it shows none of 0.193/0.194.
3. **Tooltip ownership** — decide per surface: inherit NG's native tooltip
   (drop the local React/LWC overlay) vs. keep a custom `tooltipRenderer`.
   `tooltipRows` (#1 above) exists specifically so you can inherit and still
   add domain rows — prefer that over a fork.

## Verification
- `npx vite build` clean (all formats); `npx vitest run` 155/155.
- Bundle-verify: new markers present in core iife (`tooltipRows`,
  `blockedBy`/`computeDepSummary`, `Start vs plan`).
- Live (rendered) verification of the new blocks is a Cowork/visual job — the
  Node test env has no DOM.

---

## 0.194.1 patch (2026-06-05) — header honors `title` + Cowork findings

A Cowork live-test of the 0.193/0.194 rollout on cloudnimbusllc.com confirmed
the engine work is correct (right-click hit-test ✅, work-item ID ✅) but
surfaced two real issues:

### NG-side fix shipped (0.194.1)
**Tooltip header showed the wrong text** — CN's v12 header read
`"120h (83% budget)"` instead of the task title. Root cause: the tooltip
header read `task.name` only, while the bar label uses `task.title || task.name`.
Fixed: the header now also prefers `task.title || task.name`. Any host that sets
a clean `title` (even if a label string lands in `name`) gets the right header.
**CORE bundle re-copy**, md5 `65ba5d62f470f41c4f540f0591c4d44c`.

### Dark sizing block — FIXED in NG 0.194.2 (ownership correction)
**The sizing/actuals block was dark on the app-mount timeline** because the
app adapter emitted hours under `metadata.hoursHigh`/`hoursLogged`, but the NG
tooltip reads `estimatedHours`/`loggedHours`/`hours`.

**Ownership:** this transform is **`packages/app/src/pipeline.ts` in the
monorepo** (NG's lane) — CN's `src/lib/nimbus-gantt-app/pipeline.ts` is only a
*mirror* that arrives via the app-bundle copy. So the fix is NG's, not a
consumer edit, and **CN must not patch/fork its inline mirror** (that would
diverge from the bundle). Fixed at the source in 0.194.2: the leaf map now
emits `estimatedHours`/`loggedHours` alongside the internal rollup keys.
> Distinction from [[the don't-couple-core rule]]: the *core* tooltip stays
> consumer-agnostic (we did NOT add `hoursHigh` to it). The *app adapter* —
> also NG-owned — is exactly the right layer to map its own shape onto the core
> contract. App-layer mapping = NG's job; core-layer key-chasing = not.

**Consumer action (CN + DH):** re-copy the **APP** bundle
`nimbus-gantt-app.iife.js` → `nimbusganttapp.resource`, md5
`dd3b75e965ccdbdc1448051bbeec768f`. (Core bundle unchanged from 0.194.1.)
This is the first app-bundle change since 0.192 — prior 0.193/0.194 cuts were
core-only.
