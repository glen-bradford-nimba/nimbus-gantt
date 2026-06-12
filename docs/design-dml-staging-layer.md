# Design — Session-Wide DML Staging Layer ("change cart")

**Status (2026-06-11):** P0–P2 SHIPPED (NG 0.203.0, PR #50 — auto-schedule
stages into the gather buffer; `commitEdits({only})` + skip checkboxes).
P3 NG-side SHIPPING (NG 0.205.0 — continue-on-error + per-entry outcomes +
✗-per-row; full per-record fidelity still gated on DH's GAP-C bulk save).
P4 = DH. P5 partially superseded: the Pace dial drives the SCHEDULER directly
(0.204.0) rather than staging via the forecast overlay.
**Owner:** NG + DH (it takes two) · **Drafted:** 2026-06-10
**Targets:** NG app (`IIFEApp.ts` pending buffer, AuditPanel, handle API) +
DH Apex (bulk save). Capacity-aware AutoSchedule
([design-gap2-capacity-aware-autoschedule.md](./design-gap2-capacity-aware-autoschedule.md))
is one **producer** into this layer.

---

## 1. The vision (Glen, 2026-06-10)

> *Auto-schedule should let me see the proposed changes on the page before they
> come in. Then confirm the DMLs before actually saving. I want to move to
> pacing, switch that around, come back to the Gantt and the list, keep making
> changes — and capture all the DML changes, but keep working the existing
> records until they're ready to commit. Then choose which updates from the whole
> tracked list of changes to actually send, and track success/failure on each one.*

In one line: a **session-wide staging cart for DML.** Every change from any view
(Gantt drag, list edit, detail panel, pacing-driven re-layout, auto-schedule
proposal) accumulates as a *pending change* against an optimistic local copy.
Nothing is written. You keep working the staged version across view switches.
When ready, you open the cart, **select which changes to commit**, send them, and
see **per-record success/failure** — wins clear, failures stay staged to retry.

---

## 2. What already exists (NG, verified 2026-06-10)

NG is ~80% of the way there. Confirmed in `packages/app/src/IIFEApp.ts` and
`packages/app/src/types.ts`:

| Capability | Status | Where |
|---|---|---|
| Buffer edits instead of firing DML | ✓ `setMode('gather')` / `batchMode` | IIFEApp `setMode`/`getMode` |
| Field-generic (any changed field, not just dates) | ✓ 0.196.2 | `pendingBuffer`, optimistic apply loop |
| Records keep working locally (optimistic apply) | ✓ | `allTasks[idx] = {…}` on each buffered edit |
| One buffer, survives view switches | ✓ (app-singleton, not per-view) | `pendingBuffer` Map on the instance |
| Snapshot the whole staged set | ✓ `getPendingEdits()` | returns `PendingEdit[]` |
| Live diff review modal | ✓ AuditPanel + `tplConfig.pendingChanges` | `buildPendingChangesFromBuffer`, `syncPendingChanges` |
| Cherry-pick **reject** one change | ✓ `removePendingPatch(taskId, kind)` | reverts `before`, drops the entry |
| `before`/`original` snapshot for clean revert | ✓ 0.190 | single source for discard + remove |
| Commit the buffer to the host | ✓ `commitEdits()` | edits-then-reorders ordering |
| Revert everything | ✓ `discardEdits()` | visual-only, host never sees it |

So "capture changes across views, keep working the records, review them, reject
individual ones, commit, revert" — **already shipped.** The vision is mostly an
*extension* of gather mode, not a greenfield build.

---

## 3. The three real gaps

### GAP A — auto-schedule (and other "engine" producers) don't feed the buffer
`AutoSchedulePlugin.scheduleAll()` dispatches `TASK_MOVE` per changed task → the
host turns that into DML. In **gather mode** those proposed dates must instead
**stage into `pendingBuffer`** (kind `'edit'`, date fields) like a drag does — so
the auto-schedule result appears in the cart as N pending changes you can review,
deselect, and commit, *without writing*. This is the seam that makes "see the
proposed dates on the page before they come in" true.

- **Fix (NG):** when `batchMode` is on, route auto-schedule output (and the
  capacity-aware re-layout) through the same buffering path drag uses
  (`onTaskPatch`/buffer), not a direct `TASK_MOVE`→DML dispatch. Use
  `previewSchedule()` (no dispatch) to compute, then stage each delta.
- Generalize: **any producer** (pacing-driven re-layout, bulk ops) stages through
  one funnel in gather mode. "Wired" mode keeps today's per-edit DML behavior.

### GAP B — commit a chosen **subset**, not all-or-nothing
Today `commitEdits()` flushes the entire buffer. You want to pick which staged
changes actually go. `removePendingPatch` lets you *drop* one before commit, but
that also discards it — you may want to **keep it staged but skip it this round.**

- **Fix (NG):** add selection state to the audit list (per-row checkbox, default
  all-selected) and `commitEdits(opts?: { only?: Array<{taskId, kind}> })`. Commit
  only the selected set; unselected stay in the buffer untouched. Keep the
  no-arg form (= commit all) for back-compat.

### GAP C — per-record success/failure (continue-on-error)
Today `commitEdits` is **fail-fast**: it throws `CommitEditsFailure { failedAt,
successful, error }` at the first failure and leaves failed + everything after it
in the buffer. You want **continue-on-error**: attempt every selected change,
collect a per-record result, clear the successes, keep the failures staged with
their error shown in the list.

- **Fix (NG):** new commit contract that returns
  `{ results: Array<{ taskId, kind, ok: boolean, error?: string }> }`. Successes
  are removed from the buffer; failures remain with `error` surfaced on the row
  (a ✗ + tooltip). Add a "retry failed" action (= `commitEdits({ only: failures })`).
- **Fix (DH) — required, NG can't do this alone:** the commit must hit a **bulk
  Apex DML with `allOrNone = false`** that returns `Database.SaveResult[]` keyed
  by record Id. A per-item callback that throws on first error *cannot* yield
  per-record results. So the host commit hook NG calls must accept the **whole
  selected batch** and return per-record outcomes — not be invoked once-per-item.
  This is the load-bearing DH change.

---

## 4. NG / DH split (it takes two)

**NG owns (the screen + the buffer):**
- The staging buffer + optimistic local copy (have it).
- One funnel so **every** producer stages in gather mode — incl. auto-schedule
  (GAP A) and pacing-driven re-layout.
- Audit/cart UI: per-row select/deselect, reject (have), per-record ✓/✗ + error
  display, "retry failed."
- Pro-forma overlay (proposed bars/dates rendered as a diff before commit).
- New handle API: `commitEdits({ only })` (subset) + continue-on-error result
  shape (GAP B + C, NG side).

**DH owns (the writes + governance):**
- Bulk `allOrNone=false` Apex save returning per-record `SaveResult` (GAP C, the
  enabling change).
- A commit hook that takes the **batch** and returns per-record outcomes (replaces
  the per-item fail-fast `onItemEdit` for the gather path).
- Its existing review-before-DML audit governance (this cart is the UI for it).
- Authoritative recompute on pacing param changes (already wired via
  `onParamsChange` → `getPacing` → `setPacingData`).

**Both:** agree the commit-batch contract (request: selected `PendingEdit[]`;
response: per-record results keyed by `taskId`+`kind`). That contract is the
NG↔DH handshake for the whole feature.

---

## 5. Flow (target)

```
gather mode ON
  ├─ drag a bar          ─┐
  ├─ edit a list row     ─┤
  ├─ detail-panel save   ─┼─► pendingBuffer (optimistic local apply; NO DML)
  ├─ pacing pace dial    ─┤        records keep "working" the staged version
  └─ auto-schedule run   ─┘        across Gantt ↔ list ↔ pacing switches
                                          │
                                   open the cart (AuditPanel)
                                          │
                            review N changes · deselect some · reject some
                                          │
                                 commitEdits({ only: selected })
                                          │
                            DH bulk save (allOrNone=false) → SaveResult[]
                                          │
                          per-record ✓/✗ painted back on each row
                          successes cleared · failures stay staged (retry)
```

---

## 6. Build phases

- **P0 — confirm coverage (½ day).** Verify pacing/list/detail edits already feed
  `pendingBuffer` in gather mode; document which producers do/don't. (Auto-schedule
  is the known gap.)
- **P1 — auto-schedule → buffer (GAP A, ~1–2 days).** In gather mode, stage
  `previewSchedule()` deltas instead of dispatching `TASK_MOVE`. Ties directly to
  the capacity-aware design doc's preview/commit split.
- **P2 — subset commit + selection UI (GAP B, ~2 days).** Per-row checkbox in the
  cart; `commitEdits({ only })`.
- **P3 — continue-on-error + per-record results (GAP C, NG side, ~2 days).** New
  result shape; paint ✓/✗ + error per row; "retry failed." Behind the DH contract.
- **P4 — DH bulk save contract (DH side).** `allOrNone=false` SaveResult batch
  hook. NG + DH co-test against a forced partial-failure.
- **P5 — pacing-driven re-layout into the cart (depends on GAP-2 P1).** Turning the
  pace dial stages the proposed schedule as pending changes (pro-forma), not a
  silent overlay.

P0–P2 are NG-only and independently shippable. P3 needs the DH contract (P4) to be
*meaningfully* per-record, but the NG result-shape can land first with a single
aggregate result as the degenerate case.

---

## 7. Decisions (Glen, 2026-06-10) + remaining questions

**Decided:**
1. **Reject vs. skip — both.** Each cart row gets a **skip checkbox** (unchecked =
   kept staged, excluded from *this* commit) **and** an **✕ to drop** (reverts the
   row to original, removes it from the cart). The skip path is new selection
   state (GAP B); the drop path is the existing `removePendingPatch`.
2. **Gather mode is a toggle, default OFF (wired).** Everyday drags/edits write
   immediately as today. The user flips to gather ("Plan mode") for a planning
   pass → edits stage into the cart → commit when ready → back to wired. So the
   staging cart is an opt-in planning surface, not the default write path. (NG
   already supports the live flip via `setMode`; MF surface defaults `batchMode`
   off and exposes a Plan-mode toggle.)

**Still open:**
3. **Partial-failure UX** — after commit, stay on the cart showing ✓/✗ inline, or
   close and badge the failures elsewhere? (Leaning: stay on the cart; failures
   remain as rows with the error + a "retry failed" action.)
4. **Auto-schedule in gather** — should running auto-schedule *replace* prior
   pending date edits for the same tasks, or stack/merge with them? (Leaning:
   replace the date edit for any task the scheduler touches, since the scheduler's
   output supersedes a manual drag for those rows.)
