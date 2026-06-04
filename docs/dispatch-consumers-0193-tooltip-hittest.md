# Dispatch → DH + CN: 0.193.0 — richer mouseover tooltip + right-click hit-test parity

**Cut:** 0.193.0 (branch `feat/0.193.0-tooltip-hittest`)
**Origin:** Glen's billing/navigation call (2026-06-04) — two NG-side asks
pulled out of the DH thread and shipped at the substrate so DH **and** CN
(and MF-prod timeline) all inherit them on a bundle re-copy.

> Glen, verbatim: *"on the delivery timeline mouse overs don't make it easy
> for me to see what the work item I need… the task ID in there, so I can
> reference it… sizing should be on mouse over, or the estimate and actuals
> so far… there's a lot more we can do on this mouse over thing to make that
> actually more useful."* and *"when I right click… sometimes it doesn't
> detect that I was actually over one when I was… if it's showing the move
> one [cursor], [right-click should be on the bar] — that's the issue."*

---

## What shipped (NG core)

### 1. Richer default hover tooltip — `render/TooltipManager.ts`
The built-in tooltip now surfaces, in two blocks:

- **Header:** task name **+ the work-item ID** (small monospace, `user-select:all`
  so you can copy it to reference the item). This is the "I need the task ID
  on mouseover so I can reference it" ask.
- **Primary block:** Status, Priority (if set), Assignee, **Dates + duration
  in days**, Progress %.
- **Sizing & actuals block** (only renders when hours data exists):
  - **Estimate** — the sizing.
  - **Logged** — actuals so far.
  - **Used** — burn %, with **`Nh left`** or **`Nh over`** (over renders red).

Field resolution is forgiving — it reads top-level first, then `metadata`,
across aliases:
| Tooltip line | Keys tried (top-level → metadata) |
|---|---|
| Estimate | `estimatedHours`, `estimateHours`, `hours` |
| Logged | `loggedHours`, `actualHours` |

**Consumer action:** to light up the sizing/actuals block, populate those
fields on the `GanttTask` you hand NG. DH's adapter already has the numbers
(`EstimatedHoursNumber__c`, `TotalLoggedHoursSum__c`) — map them to
`metadata.estimatedHours` / `metadata.loggedHours` (or top-level `hours` for
the estimate). No NG change needed; if the fields are absent the block just
hides. Hosts using a **custom tooltip renderer** are unaffected (the custom
renderer still wins) — adopt the new fields there if you want parity.

### 2. Right-click hit-test parity — `NimbusGantt.hitTestAt()`
Root cause of the flaky right-click: there were **two divergent hit-tests.**
Hover used `interaction/HitTest.ts` (precise bar geometry, 6px edge
thresholds, a centered diamond for milestones) while right-click used
`hitTestAt()` with a **strict x-range and no milestone handling**. So a short
bar / milestone would show a grab cursor on hover but the right-click fell
through to the **canvas-empty "Create work item" menu** — exactly the
"shows move but right-clicks create" mismatch.

Fix: `hitTestAt()` now mirrors the hover tolerance —
- **Milestones** get a centered diamond hit area (±`barHeight/2` around the
  marker center), matching `HitTest.testMilestone`.
- **Regular bars** get a 6px x hit-slop so 1-day / near-zero-width bars stay
  right-clickable.

Only one task occupies a row, so the slop can't bleed into a neighbor.

**Consumer action:** none. `ContextMenuPlugin` is auto-installed on the IIFE
mount (0.189.0+), and it calls `hitTestAt()` — re-copy the bundle and
right-click reliability improves automatically.

---

## MF-prod timeline angle (Glen, same session)
Glen wants MF-prod work items *"organized in the timeline based on how we
want them to get started, with sizing easy to see (sizing on mouseover, or
the estimate and actuals so far)."* That's precisely what (1) delivers — once
the MF dataset maps estimate/logged into the tooltip fields above, the
sizing-on-mouseover requirement is met with zero new UI. Ordering by
intended start is host-side (sortOrder / scheduled dates) and already
supported.

---

## "A lot more we can do on the mouseover" — candidate follow-ups (NOT in 0.193.0)
Surfaced for the DH/CN backlog so we can pick the next slice deliberately:
- **Dependency summary** — "blocks 3 · blocked by 1" with the predecessor
  names.
- **Variance vs. baseline** — start/end drift in days when a baseline exists.
- **Mini burn sparkline** — logged-over-time inside the tooltip.
- **Assignee avatar / link** and **status pill** styling instead of plain rows.
- **Sticky / pinnable tooltip** so it survives mouse-out for copy-paste of
  the ID and notes (today it's hover-only with a 100ms hide delay).
- **Host-supplied extra rows** via a lightweight `tooltipRows?: {label,value}[]`
  on `GanttTask` — lets DH add domain rows (request #, budget line) without a
  full custom renderer.

---

## Verification
- `npx vite build` (core) — clean, all formats emit.
- `npx vitest run` — 155/155 pass (no regressions).
- Lint: repo's eslint config predates ESLint v9 and errors before evaluating
  any file (pre-existing, unrelated to this cut); `tsc`/dts in the build is
  the effective typecheck and passes.

## Bundle to re-copy — CORE ONLY
All 0.193.0 changes live in the **core** bundle. The **app** bundle never
embeds core (it consumes `window.NimbusGantt` at runtime — two independent
deploy artifacts), so it is byte-identical to 0.192.0 and must **not** be
re-deployed.

| Artifact | SF static resource | md5 | Action |
|---|---|---|---|
| `nimbus-gantt.iife.js` (core) | `nimbusgantt.resource` | `a0e38a04ac163839dd7cb2416e75e59c` | **re-copy** |
| `nimbus-gantt-app.iife.js` (app) | `nimbusganttapp.resource` | `44fe727920c7547b7bafe8a46dc1c274` (unchanged) | leave as-is |

Merged to `master` at `ca7af90` (PR #23). Build with `cd packages/core && npx vite build`.

## Adoption checklist
- [ ] DH + CN re-copy **only** the core 0.193.0 IIFE bundle (md5
      `a0e38a04…`); verify the hash after copy. Tooltip + hit-test then apply
      automatically.
- [ ] DH adapter maps `estimatedHours` / `loggedHours` (or `hours`) onto the
      `GanttTask` so the sizing/actuals tooltip block renders.
- [ ] Confirm right-click on short bars / milestones now opens the bar menu
      (was falling through to "Create work item").
- [ ] MF-prod dataset: ensure work items carry estimate + logged for the
      sizing-on-mouseover requirement.
