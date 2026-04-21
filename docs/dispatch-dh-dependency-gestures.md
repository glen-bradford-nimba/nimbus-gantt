# Dispatch: DH requests in-gantt dependency create/delete gestures

**Requester:** DH CC
**Date:** 2026-04-21
**Stacks on:** 0.185.27 (dependencies pipe re-opened)
**Blocks:** Glen's "add/remove dependencies inside the gantt" UX

## 🚨 UPDATE 2026-04-21 — NG 0.185.28 likely NOT needed for the add flow

After grepping NG source, `onTaskContextMenu(task, pos)` is already wired
on both engineOnly and chrome-aware mount paths in 0.185.27.
Listener calls `preventDefault()` and fires with page-relative `{ x, y }`
(sites: `IIFEApp.ts:768-781` + `:2006-2018`). A stale comment in
IIFEApp.ts:749 claims Locker/LWS swallows contextmenu events — Glen's
LEX research says otherwise. Untested in glen-walk until now.

**DH-side probe (run this first, 30 seconds):**
```js
// In deliveryProFormaTimeline mount config:
onTaskContextMenu: (task, pos) => {
  console.log('[DH ctx-probe]', task.id, pos);
}
```
Right-click a bar in glen-walk → if the log fires, the entire right-click
UX is DH-only work. No NG release needed. Proceed with Apex + popover LWC
against existing 0.185.27.

If the log does NOT fire (stale comment was correct + LEX really does
swallow canvas contextmenu), ping NG CC and 0.185.28 ships a fallback via
`pointerdown` + `event.button === 2` detection.

**Remaining NG work (deferred until Glen wants arrow-delete gesture):**
- `onDependencyContextMenu(depId, pos)` for right-clicking the arrow
  itself. Requires new hit-test in core's DependencyRenderer. 0.185.28+.
- **Workaround that needs zero NG work:** task menu renders "Delete
  predecessor → [list]" + "Delete successor → [list]" submenus sourced
  from `dependencies.filter(d => d.target === task.id)` / `.source === task.id`.
  No arrow hit-test — pure list from the data DH already has.

## Problem

0.185.27 draws dependency arrows from a host-supplied array but offers no way
for users to create or delete them inside the gantt canvas. Glen wants direct
manipulation — drag from a task's right edge to another task to create a
predecessor→successor link, click an arrow and delete to remove.

## Ask

Three new callbacks on the mount config + one render affordance:

```ts
mount(container, {
  // ... existing config
  onDependencyCreate?(source: string, target: string, type: 'FS' | 'SS' | 'FF' | 'SF'): void | Promise<void>;
  onDependencyClick?(depId: string, event: { x: number; y: number }): void;
  onDependencyDelete?(depId: string): void | Promise<void>;
});
```

**Create gesture — drag from bar edge to bar:**
- Right edge of each task bar renders a small drag handle (visual affordance —
  a vertical tick or circle on hover).
- `mousedown` on the handle + drag fires a preview line following the cursor.
- `mouseup` on another task bar fires `onDependencyCreate(sourceId, targetId, 'FS')`.
  `'FS'` is the v0 default; later iterations can expose a type picker mid-drag.
- Release over empty space cancels silently — no callback, no record.
- Optimistic: preview line disappears on mouseup; host calls
  `handle.setData(tasks, newDeps)` to commit the visual once Apex write
  succeeds. On reject, host re-fetches and re-pushes to revert.

**Delete gesture — click arrow + key or click delete button:**
- Click on a rendered dependency arrow fires `onDependencyClick(depId, {x,y})`.
  Arrow gets a "selected" visual state (thicker stroke or color shift).
- `Delete` / `Backspace` key while selected fires `onDependencyDelete(depId)`.
- Alternative (preferred for discoverability): `onDependencyClick` also shows a
  small floating `×` button near the arrow midpoint; clicking the `×` fires
  `onDependencyDelete(depId)`.
- Optimistic: host removes from its array and calls `setData` to commit.

## Contract details

- `type` on create defaults to `'FS'` but caller can override by writing a
  type-picker dropdown mid-drag in a later version (flag for 0.185.29).
- `onDependencyCreate` may return a Promise. If the host rejects (Apex fail),
  NG shows a toast or just logs — host handles user feedback.
- `onDependencyDelete` ditto. Host is authoritative; NG never mutates the
  dependency array itself.
- If no callback is wired, the gesture is disabled (no drag handle rendered,
  arrow click is a no-op). Hosts can progressively enable features.

## Backward compat

Fully additive. 0.185.27 hosts see zero change. DH wires the callbacks on
0.185.28+.

## DH-side integration

DH will ship new Apex endpoints alongside this NG release:
- `DeliveryGanttController.createWorkItemDependency(blockingId, blockedId, type)`
  → inserts `WorkItemDependency__c`, returns the new dep DTO.
- `DeliveryGanttController.deleteWorkItemDependency(depId)` → deletes by id.

LWC wiring:

```js
mountConfig.onDependencyCreate = async (source, target, type) => {
  const dto = await createWorkItemDependency({ blockingId: source, blockedId: target, type });
  this._dependencies = [...this._dependencies, this._mapDependenciesForNg([dto])[0]];
  this._mountHandle.setData(this._mapTasksForNg(this._tasks), this._dependencies);
};

mountConfig.onDependencyDelete = async (depId) => {
  await deleteWorkItemDependency({ depId });
  this._dependencies = this._dependencies.filter(d => d.id !== depId);
  this._mountHandle.setData(this._mapTasksForNg(this._tasks), this._dependencies);
};
```

## Out of scope

- Cycle detection. If user creates a cycle (A→B→A), Apex rejects via trigger
  validation (or DH logic). NG doesn't need to pre-check.
- Dependency type picker mid-drag. 0.185.29.
- Bulk dependency editing UI. Future.

## Test plan

- Draft arrow follows cursor smoothly during drag; no flicker.
- Drop on a target bar commits via `onDependencyCreate`, arrow appears on
  `setData` round-trip.
- Click existing arrow shows selected state + `×` button.
- Click `×` fires `onDependencyDelete`, arrow disappears on `setData` round-trip.
- Rejection (host throws) leaves canvas unchanged and logs to console — no
  ghost arrows.
