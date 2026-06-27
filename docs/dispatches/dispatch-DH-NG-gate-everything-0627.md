# Dispatch — "Gate EVERYTHING behind Review & Commit" + cycle-time (2026-06-27)

**From:** NG-CC · **To:** DH-CC + NG-CC · **Trigger:** Glen, after the MF-Prod 0.290 live pass.

Glen's ask, verbatim intent: *"I thought the whole idea was to put everything behind review and commit — not just gantt
drags but every change made through that component — staged DML with review & commit. And right now when I click Review
& commit it doesn't work."*

---

## ✅ Shipped this cut (NG 0.209.0, app md5 `4818166a`) — HEADLESS-VERIFIED

The "Review & commit does nothing" keystone is fixed, plus two adjacent bugs. All reproduced + verified in a real browser
via `packages/app/dev/` (not reasoning):

1. **Pill click now opens the review/commit modal** on the embedded surface (was a dead no-op — `toggleChrome` can't
   reveal an `auditPanel` that `EMBEDDED_FEATURE_OVERRIDES` baked off at resolve time).
2. **Buffer clears after a successful commit** (NG wraps `onAuditSubmit`; DH's `setData` refetch never cleared it).
3. **`handle.dispatch(action)` exposed** — so host-pushed PATCHes stage into the audit buffer like drags.

DH action: **re-vendor app bundle `4818166a`** → deploy → run the round-trip (drag → pill → Confirm → **refresh → still
there**).

---

## ⛔ NOT fixed — joint rework so "EVERYTHING" is actually gated

The audit buffer only catches edits that flow through NG's PATCH path. These currently **bypass** it:

### DH-owned
- **Right-click → Change Priority / Move to top-bottom commits immediately.** DH's own context menu calls `_handlePatch`
  → `updateWorkItem*` immediate DML, even when audit-pass is ON. To gate it: when `_auditPassEnabled`, route those menu
  actions through **`handle.dispatch({type:'PATCH', patch:{id, priorityGroup|sortOrder}})`** (now exposed) instead of
  `_handlePatch`. They'll stage like drags and show in the pill/review list.
- **`onAuditSubmit` ignores per-row skip.** It reads `getPendingEdits()` (ALL rows) and commits everything, so the
  review modal's per-row "skip / include" checkboxes are cosmetic on the DH path. Either (a) honor the skip set, or (b)
  switch the commit to **`handle.commitEdits({only: selectedIds})`** which already implements subset commit + per-row
  continue-on-error. (NG clears the whole buffer on `onAuditSubmit` success — correct for "commit all"; if you move to
  subset commit, use `commitEdits`, which clears only what it committed.)
- **Auto-schedule applies** previously fell back to a buffer-BYPASSING `setData` because `handle.dispatch` was missing.
  Now that it's exposed, confirm `autoScheduleDispatcher` takes the dispatch branch (no more WARN at line ~550) so
  scheduled date moves stage behind review & commit too.

### NG-owned (next NG cut — audit + close)
- **Audit every mutation path in `batchMode`** and confirm it buffers: ✓ canvas date-drag, ✓ drag reorder / bucket move,
  ✓ host PATCH via `handle.dispatch`. **To verify:** DetailPanel field edits (onItemEdit), milestone toggles,
  progress-handle drags — confirm each routes through the buffering PATCH path under batchMode, or wire them in.
- Long-term cleaner fix (flagged, not urgent): **don't strip `auditPanel` when `batchMode` is on.** Embedded mode
  removes the commit surface while keeping the mode that *requires* one — the pill-modal works around it, but the
  surgical fix is to keep the audit chrome available whenever there's a buffer to commit.

---

## 🚀 Cycle-time (Glen: "how do we cut down test cycle time")

The 0.207.x bugs slipped because the audit-pass commit path was only ever **reasoned through, never executed** — and
scratch orgs gave false green (clean non-namespaced data can't reproduce prod/namespace/embedded-mode bugs).

- **NG:** `packages/app/dev/embedded-harness.html` + `verify-embedded.mjs` now exercise the embedded+batchMode commit
  path headlessly against the built bundle in seconds. **Run before any NG audit-pass merge.** This is plain state
  logic, not LWS — only genuine `document`-sandbox behavior needs a real org.
- **DH:** verify code on **dh-parent via direct `cci/sf deploy` (~min)**, not the promote→install→click chain; read
  **MF-Prod directly via SOQL + create-path debug logs** for prod-only/namespace issues instead of waiting on a
  click-through. Add a **namespaced sandbox** to the path so managed-package bugs surface before MF-Prod.
