# Dispatch: DH requests in-gantt dependency create/delete gestures

**Requester:** DH CC
**Date:** 2026-04-21
**Stacks on:** 0.185.27 (dependencies pipe re-opened)
**Blocks:** Glen's "add/remove dependencies inside the gantt" UX

## ✅ STATUS 2026-05-11 — RESOLVED on NG side. DH wireup is now host-only work.

The arrow-delete + type-change gestures are fully wired via the
ContextMenuPlugin auto-install path (0.189.0 + the 0.190.1 click-fire
fix). DH does NOT need an `onDependencyContextMenu` mountConfig
callback — the menu auto-renders on right-click of any arrow, and the
host receives a single verb-action callback.

**What ships today (NG 0.191.0):**
- `DependencyRenderer.hitTest()` — arrowhead + final-approach + source-
  exit segment hit-test, 8px tolerance default
  (`packages/core/src/render/DependencyRenderer.ts:116`)
- `gantt.hitTestAt(clientX, clientY)` — classifies any pixel into a
  ZoneHit; returns `{ zone: 'dependency', depId }` when the cursor
  hovers an arrow (`packages/core/src/NimbusGantt.ts:628-640`)
- `ContextMenuPlugin` auto-installed in IIFEApp.ts. On the `dependency`
  zone, the default menu renders "Change to Finish-Start", "Change to
  Start-Start", "Change to Finish-Finish", "Change to Start-Finish",
  and "Delete" (with destructive-confirm gate)
- `mountConfig.contextMenu.onDependencyAction(verb, depId, pos)` — host
  hook that fires for every menu pick
- `mountConfig.contextMenu.onConfirmDestructive(kind, id) => boolean` —
  host override for the Delete confirm gate (default uses
  `window.confirm`)

**DH wireup (host-only):**

```js
this._mountHandle = NimbusGanttApp.mount(container, {
  // ... existing config
  contextMenu: {
    onDependencyAction: async (verb, depId, _pos) => {
      if (verb === 'delete') {
        await deleteWorkItemDependency({ depId });
        this._dependencies = this._dependencies.filter(d => d.id !== depId);
        this._mountHandle.setData(this._tasks, this._dependencies);
        return;
      }
      if (verb.startsWith('change-type-')) {
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

The create-gesture (drag from bar edge to bar) is still a separate
piece — that one DOES need new NG code (drag-handle render + DragManager
state machine for the cross-bar drag). Out of scope for 0.191.0; track
it as a follow-up if/when Glen prioritizes create-by-drag over the
existing right-click "Add successor / predecessor" menu pattern.

## 🚨 UPDATE 2026-04-21 — NG 0.185.28 REQUIRED (probe failed)

**Probe result from glen-walk (2026-04-21 13:05 UTC):** Right-click over a
task bar on `/lightning/n/Delivery_Timeline` produced zero `[DH ctx-probe]`
logs. The `onTaskContextMenu` callback wired in IIFEApp.ts:768-781 +
:2006-2018 does NOT fire in LEX/Locker context. The stale comment at
IIFEApp.ts:749 was correct — Salesforce's LEX container suppresses the
canvas `contextmenu` event before NG's listener ever sees it.

**NG 0.185.28 ask — `pointerdown + event.button === 2` fallback:**

Replace (or supplement) the `contextmenu` listener on task bars and
dependency arrows with a `pointerdown` listener that fires
`onTaskContextMenu` / `onDependencyContextMenu` when `event.button === 2`
(right-button). Also listen for `contextmenu` and `preventDefault()` on it
to suppress any default browser menu that leaks through on platforms that
don't swallow it. Both listeners fire the same callback with page-relative
`{x, y}`.

```ts
// Pseudo — both on task bars and dep arrows
el.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  e.preventDefault();
  const task = hitTestTask(e.clientX, e.clientY);
  if (task && opts.onTaskContextMenu) {
    opts.onTaskContextMenu(task, { x: e.clientX, y: e.clientY });
  }
});
el.addEventListener('contextmenu', (e) => {
  e.preventDefault();  // belt and suspenders — browser may surface this in non-LEX contexts
});
```

DH probe stays in place; it'll start firing the moment 0.185.28 bundle
lands. Then the entire right-click UX is DH-only work.

**Remaining NG work (deferred until Glen wants arrow-delete gesture):**
- `onDependencyContextMenu(depId, pos)` for right-clicking the arrow
  itself. Requires new hit-test in core's DependencyRenderer. 0.185.28+.
- **Workaround that needs zero additional NG work:** task menu renders
  "Delete predecessor → [list]" + "Delete successor → [list]" submenus
  sourced from `dependencies.filter(d => d.target === task.id)` / `.source
  === task.id`. No arrow hit-test — pure list from the data DH already
  has.

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
