# Dispatch: ContextMenuPlugin (0.189.0) — DH + CN integration guide

**Author:** NG CC
**Date:** 2026-04-30
**Source SHA on nimbus-gantt master:** `c41af52`
**For:** DH CC + CN CC
**Stacks on:** 0.187.0 agent API + handle.gantt accessor

## TL;DR

Right-click anywhere on the gantt now opens a zone-tailored context menu.
Auto-installed in IIFE — re-copy bundles + `BUNDLE_VERSION` bump and your
gantts get default menus on every right-click site (bar / row label /
date header / empty canvas / bucket header / below last row). Wire host
callbacks (`onCreateTask`, `onTaskAction`, `onDateAction`,
`onAgentRequest`) to make the actions actually do things in your stack.

## Bundle artifacts to copy

- **`packages/core/dist/nimbus-gantt.iife.js`** — 302,263 bytes
  - sha256: `35902b4edb7c4d6633aae44996de125a4c7769171773bc65063086237df7027b`
- **`packages/app/dist/nimbus-gantt-app.iife.js`** — 272,364 bytes
  - sha256: `207bdc4e48177b5273d6075594429fd3c1326efdac6097beabb6d75a2b62d80c`

CN: `BUNDLE_VERSION` bump to `c41af52` in
`src/app/mf/delivery-timeline-v12/DeliveryTimelineV12.tsx:339`.

DH: re-copy both `.resource` files and redeploy.

## What you get with zero further wiring

The default menu fires on every right-click site with a useful set of
items. **The actions don't do anything yet** because hosts haven't wired
the callbacks — but the menu opens, items appear, and clicks fire
no-op handlers. Use this to verify the plugin is alive end-to-end before
investing in the host plumbing.

## Wire it up — minimum useful integration

```ts
// In DeliveryTimelineV12.tsx (CN) or deliveryProFormaTimeline.js (DH):

const handle = NimbusGanttApp.mount(container, {
  // ...existing config...
  contextMenu: {
    // The simplest case: just hook "Create work item here" so right-click
    // on empty canvas → modal/quick-add. NG defaults handle everything else.
    onCreateTask: (init, pos) => {
      // init: { startDate, endDate, parentId, bucket }
      // pos:  { x, y } in page coordinates
      hostCC.openCreateTaskModal({
        startDate: init.startDate,
        endDate: init.endDate,
        parentId: init.parentId ?? undefined,
        priorityGroup: init.bucket ?? 'top-priority',
      });
    },

    // Bar / row-label menu actions — open your existing edit UI.
    onTaskAction: (action, task, pos) => {
      switch (action) {
        case 'edit':           hostCC.openEditModal(task.id); break;
        case 'reparent':       hostCC.openReparentPicker(task.id, pos); break;
        case 'change-bucket':  hostCC.openBucketPicker(task.id, pos); break;
        case 'mark-complete':  hostCC.markComplete(task.id); break;
        case 'delete':         hostCC.confirmDelete(task.id); break;
        case 'collapse':       handle.gantt.collapseAll(); break; // or scoped
        case 'expand':         handle.gantt.expandAll(); break;
      }
    },

    // Date-header right-click — scroll/zoom/add milestone.
    onDateAction: (action, date, pos) => {
      switch (action) {
        case 'scroll-here':    handle.gantt.scrollToDate(date); break;
        case 'zoom-to':        hostCC.zoomToRange(date); break;
        case 'add-milestone':  hostCC.openAddMilestoneModal(date); break;
      }
    },
  },
});
```

That's the minimum viable integration. ~30 lines of host code. **Right-
click on empty canvas now opens a "Create work item starting <date>"
prompt that prefills startDate, endDate (default +5d), parentId
(inferred from the row above), and bucket (inferred from the bucket
ancestor) — exactly the "click an empty spot to create a task there"
flow Glen asked for.**

## Wire the agent-augmented items (✦ Ask Claude…)

Each default menu has a divider followed by ✦-prefixed items routed
through `onAgentRequest`. NG provides the prompt template + a complete
JSON snapshot of gantt state at click time. Host owns the LLM call.

```ts
contextMenu: {
  // ...callbacks above...
  onAgentRequest: async ({ hit, pos, prompt, snapshot }) => {
    // Send to Claude API / your LLM endpoint with the structured context.
    const response = await fetch('/api/ask-claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        ganttState: snapshot,
        cursor: { x: pos.x, y: pos.y },
        zone: hit.zone,
      }),
    });
    const { reply, suggestedMutations } = await response.json();

    // Resolution patterns — pick whichever fits the response:
    // 1. Toast the reply text
    hostCC.showToast(reply);

    // 2. Append an annotation visible on the history strip
    handle.gantt.history?.appendAnnotation({
      kind: 'agent-note',
      taskId: hit.zone === 'bar' ? hit.task.id : undefined,
      payload: { prompt, reply },
    });

    // 3. Apply suggested mutations directly via the agent API
    for (const m of suggestedMutations ?? []) {
      if (m.kind === 'move')   handle.gantt.agent.moveTask(m.id, m.startDate, m.endDate);
      if (m.kind === 'update') handle.gantt.agent.updateTask(m.id, m.changes);
      if (m.kind === 'add')    handle.gantt.agent.addTask(m.task);
    }
  },
},
```

The ✦ items only render when `onAgentRequest` is wired. Without it, the
menu is purely user-driven actions; no surprise LLM costs.

## What menu fires for each right-click site

| Right-click on | Zone | Default items |
|---|---|---|
| A task bar | `bar` | Edit / Change parent / Change bucket / Mark complete / Delete + ✦ why scheduled / what blocks / reschedule |
| A row label (left tree-grid, not on a bar) | `row-label` | Same task actions (no bar geometry) + ✦ summarize task |
| The date header at top | `date-header` | Scroll to / Zoom to range / Add milestone here + ✦ what's happening around this date |
| An empty canvas spot | `canvas-empty` | **Create work item starting <date>** (prefilled) / Insert milestone + ✦ suggest a task here |
| A bucket header (NOW / NEXT / etc) | `bucket-header` | Add to bucket / Collapse / Expand + ✦ rebalance bucket |
| Below the last row | `below-rows` | Add task at end |

`canvas-empty` infers the row's bucket by walking up the tree to the
nearest `status === 'group-header'` ancestor. So right-clicking inside
the NOW lane prefills `bucket: 'top-priority'`; clicking inside NEXT
prefills `bucket: 'active'`; etc.

## Custom menus (full override)

Pass `onContextMenu` if you want to fully replace the default item set
for some/all zones. Return an array of items to render, or `void` to
fall back to the NG default for that zone.

```ts
contextMenu: {
  onContextMenu: (hit, pos) => {
    if (hit.zone === 'bar') {
      return [
        { id: 'open-record', label: 'Open record', icon: '↗', onClick: () => hostCC.openRecord(hit.task.id) },
        { id: 'chat', label: 'Chat about this', icon: '💬', onClick: () => hostCC.openChat(hit.task.id) },
        { id: 'div', label: '', divider: true },
        { id: 'edit', label: 'Edit dates', onClick: () => hostCC.editDates(hit.task.id) },
      ];
    }
    // Fall through to default for everything else
    return undefined;
  },
}
```

Host-supplied items support nested `children: ContextMenuItem[]` for
submenus. Submenus open on hover.

## What I recommend you USE this for

**Glen's framing: "autotelic genius options that people would want to
see wherever they are right clicking."** The menu is the natural place to
expose actions that are normally buried in panels / modals / kebab menus.
Things to consider:

### DH-side high-value wirings

1. **`canvas-empty` → "Create work item here"** — inserts a draft
   `WorkItem__c` at the implied date + bucket. Replaces the existing
   "+ New Item" button flow with a click-where-you-want-it gesture.
2. **`bar` → "Open record"** — opens the SF record page in a new tab
   (uses `[NavigationMixin].Navigate({type: 'standard__recordPage'})`).
   This was the "open record" / "chat about this record" feature Glen
   raised yesterday.
3. **`bar` → "Chat about this"** — opens the existing chat LWC scoped
   to the WorkItem__c id. Reuses the channel from `deliveryWorkItemChat`.
4. **`bucket-header` → "Add task to NOW/NEXT/..."** — opens the existing
   create modal with `priorityGroup` prefilled.
5. **`bar` → ✦ Ask Claude: why scheduled** — your new agent endpoint
   gets the full snapshot + prompt; user sees a reply toast / annotation.
   Trial run for the broader Claude-narrated feature.

### CN-side high-value wirings

1. **`canvas-empty` → "Create work item here"** — wires to the proForma
   POST endpoint with prefilled fields. No modal — go straight to inline
   editor, since CN's dataset is smaller and adds happen frequently.
2. **`bar` → "Edit"** — opens the existing inline-editor (you already
   have one). The current onTaskClick double-click pattern is more
   discoverable as a right-click "Edit" item.
3. **`date-header` → "Add milestone here"** — milestones on the proForma
   are currently editable only via a modal. Right-click on the date axis
   is a cleaner gesture.
4. **`bar` → ✦ "why is this scheduled here?"** — call your existing
   `/api/narrate` endpoint with the snapshot + prompt. Demonstrates the
   replay-narration vision from `dispatch-ng-temporal-canvas.md` ahead
   of the dedicated 0.190.0 plugin.

### Things NOT to wire yet

- **Don't ship destructive actions without a confirm.** "Delete" in the
  default menu calls `onTaskAction('delete', ...)` — make sure your
  handler does an inline confirm or modal. NG won't.
- **Don't wire `onAgentRequest` to a paid LLM endpoint without rate-
  limiting.** ✦ items are easy to misclick; cap calls per minute per
  user.
- **Don't override the menu globally with `onContextMenu` and return
  empty arrays for zones you haven't designed for.** Returning `undefined`
  falls through to NG's default; returning `[]` shows nothing. Pick the
  intentional one.

## Edge cases worth knowing

- **LWS / Salesforce contextmenu suppression**: the plugin listens for
  both `contextmenu` AND `pointerdown + button === 2` so it works on
  surfaces where Salesforce LWS swallows contextmenu events. No host
  action required.
- **Menu inside iframe**: positioning uses `clientX/clientY` against
  `position: fixed` on the menu element — works inside Lightning iframes
  per the same pattern Modal LWCs use.
- **Cursor on a sub-row of the date header (day vs week)**: the
  multi-row header (e.g. "April 2026" on top, "W14" / "W15" / "W16"
  below) gets a `level: 'month' | 'week' | 'day' | 'quarter' | 'year'`
  hint on the `date-header` zone. Use it to differentiate "zoom to the
  whole month" vs "zoom to this week."
- **Cursor on a bar in a bucket-header row**: NG resolves to
  `bucket-header` zone, not `bar`. Bucket header rows aren't editable
  as tasks; the bucket actions take precedence.
- **Cursor between rows (gap)**: currently classified as `canvas-empty`
  with the row at the cursor's Y. If you want a "gap" zone, request it.

## What ships next

- **0.190.0 ReplayNarrationPlugin** — the dedicated agent-narration
  plugin from the temporal-canvas dispatch. Calls the same
  `onAgentRequest` callback when the user scrubs the time cursor, but
  with a different prompt template ("explain what changed since
  cursor moved").
- **`dependency` zone resolution** — currently NG can't hit-test the
  rendered dependency arrows. Requires a hit-test pass in
  `DependencyRenderer`. Carry-over from the 0.185.28 ctx-menu dispatch.
  Until that ships, right-clicking an arrow falls through to whatever
  zone is below it (usually `canvas-empty`).

## Verify

After bundle swap + version bump:

1. Right-click anywhere on the gantt — a styled menu should appear.
2. Right-click on a task bar — see "Edit task / Change parent / Change
   bucket / Mark complete / Delete" + a divider + ✦ Ask Claude items
   (only if `onAgentRequest` is wired).
3. Right-click on empty canvas — see "Create work item starting
   <date>" with the right date in the label.
4. Press Escape or click anywhere outside — menu dismisses.
5. Console: `window.NimbusGanttApp.handle.gantt.hitTestAt(x, y)` returns
   a discriminated union object describing the zone.

If the menu doesn't appear: open the browser console; the plugin emits
no errors silently when bundles are mismatched. Most likely cause is
missed `BUNDLE_VERSION` bump — bundle's still cached at the prior SHA.
