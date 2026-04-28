# Dispatch: Per-row style decorators (border / fill / more)

**Requester:** Glen via Cloud Nimbus session
**Date:** 2026-04-28
**Blocks:** Any consumer (DH, MF, or other) that wants to visually distinguish a subset of rows without changing the data model

## Problem

Today every Gantt row gets the same bar treatment. The consumer (DH today, others later) has no way to say "render *these* rows with a different visual cue" — e.g. mark recently-completed items, flag items at risk, indicate items in a different ownership state, etc.

The natural question that surfaced this: Glen wants a "Recently Done (last 7 days)" group on his Delivery Timeline with dashed-outline + lighter-fill bars so stakeholders can see what just shipped without the bars looking exactly like in-flight work. But that specific use case is one of many — the underlying ask is for **composable per-row visual decorators**.

Today the only signal a host can pass is `priorityGroup` (which buckets the row into a group). That's grouping, not styling. A row in any group should be able to opt into a styling overlay independently.

## What's a row decorator?

A small set of optional style fields on `GanttTask` (or a sibling shape) that the renderer reads and applies on top of the existing bar. The host decides which decorators apply to which rows; nimbus-gantt is responsible for rendering them consistently.

Composable means: a single row can have border + fill at the same time. They don't conflict.

## Preferred design — extend GanttTask with `style?` block

```ts
type GanttRowDecorators = {
  /** Bar outline */
  borderStyle?: "solid" | "dashed" | "dotted" | "double" | "none";
  borderWidth?: 1 | 2 | 3;
  borderColor?: string;        // CSS color, defaults to bar fill darkened

  /** Bar interior */
  fillStyle?: "solid" | "shaded" | "hatched" | "gradient" | "muted";
  fillOpacity?: number;        // 0–1, defaults to 1

  /** Optional inline label decoration */
  badge?: {
    text: string;              // e.g. "✓", "RISK", "NEW"
    placement?: "start" | "end";
    color?: string;
  };

  /** Tooltip override (otherwise host sets via existing tooltip plumbing) */
  styleNote?: string;          // shown as small italic line in tooltip
};

type GanttTask = {
  // ... all existing fields ...
  style?: GanttRowDecorators;  // NEW — optional, no-op when absent
};
```

The host populates `style` per row when constructing the task list. nimbus-gantt reads it during bar render and applies the corresponding CSS / SVG attributes.

When `style` is undefined or empty, the row renders exactly as today — fully backwards compatible.

## Two reference decorators to ship in v1

These two cover the immediate use cases and prove the pattern. More can land later.

### 1. `borderStyle: "dashed"` + `fillStyle: "muted"`

Use case: "This row is in a special state — recently completed, on hold, externally blocked, etc." Generic enough that the consumer assigns meaning per their own workflow.

Visual: bar is rendered with a 2px dashed outline and the interior fill is shifted to ~60% opacity (or a lighter tint). The bar still occupies the same horizontal extent and clicks/drags behave normally.

### 2. `badge: { text: "✓", placement: "end" }`

Use case: A small inline mark on the bar — e.g. a checkmark for done, an exclamation for at-risk, a star for milestone-adjacent.

Visual: small circular pill at the start or end of the bar, drawn over the bar fill with a subtle drop shadow so it reads on any background color.

## Group-level styling — separate but related

A complementary feature: if a host wants to put a *visual frame around an entire group* (e.g. a dashed box around a whole `priorityGroup` bucket with a small legend line), that's a group-level decorator, not a row-level one. Suggest a follow-up dispatch for `GanttGroupStyle` — same shape but applied to the group container instead of individual rows. Out of scope for this dispatch but worth flagging so v1 row decorators don't paint into a corner.

## Acceptance for v1

- Add `style?: GanttRowDecorators` to the public `GanttTask` type.
- Renderer applies `borderStyle`, `borderWidth`, `borderColor`, `fillStyle: "solid" | "muted"`, `fillOpacity`, and `badge` when present. `fillStyle: "hatched" | "gradient"` are reserved values and stubbed as TODO — type accepts them, renderer falls back to `solid` until implemented.
- Renderer bails on the entire `style` block when `task.status === "group-header"` so it doesn't collide with the legacy `groupBg / groupColor / hours / hoursLabel / title` fields PriorityGroupingPlugin already uses on header rows. (Folding those legacy fields under a sibling `group?: {...}` block is a worthwhile follow-up but explicitly out of scope here.)
- Backwards-compatible: every existing host that doesn't set `style` renders identically to today.
- Demo-package example panel with 3-4 example rows demonstrating each decorator alone and combined (this repo has Vitest + the demo package, no Storybook).
- Type exports updated — `GanttRowDecorators` exported from the package barrel — so external consumers (DH salesforce-adapter, MF v4, CN portal) can import the type and sanitize at the boundary the same way `dependency.type` is normalized today.
- Canvas renderer (not SVG) — nimbus-gantt is canvas-first per `CanvasRenderer.ts`. Badge pill renders as canvas primitives with drop-shadow.

## Scope notes / non-goals

- **Not** a CSS theming system — these are per-row overrides driven by data, not stylesheet rules.
- **Not** tied to any specific bucket or workflow concept — the host decides which rows get which decorators.
- **Not** a heatmap (`HeatmapViewPlugin` already covers continuous color encoding). Decorators are discrete state markers.
- **Not** a milestone (existing `MilestonePlugin` covers point-in-time markers). Decorators apply to bars with duration.

## Why row-level rather than a plugin

A plugin would install once and apply globally. Row decorators are per-row data, like start/end dates — they belong on the task shape so any host can drive them without configuring a plugin. The renderer reads them inline. This is closer to how `priority` / `dependencies` / `progress` already work on `GanttTask` than how `AutoSchedulePlugin` or `CriticalPathPlugin` work.

## First consumer

DH's `DeliveryGanttController.cls` will populate `style` when mapping `WorkItem__c` → `GanttTask`. Specifically:

```apex
if (TERMINAL_STAGES.contains(item.StageNamePk__c)
    && item.LastModifiedDate >= System.now().addDays(-7)) {
    task.style = new Map<String, Object>{
        'borderStyle' => 'dashed',
        'borderWidth' => 2,
        'fillStyle'   => 'muted',
        'badge'       => new Map<String, Object>{ 'text' => '✓', 'placement' => 'end' }
    };
}
```

DH PR will follow once nimbus-gantt v1 of this is exposed in the published types.

## Estimate

Rough first-pass: 6-12 hours in nimbus-gantt (type extension + renderer + Storybook). Then 2-4 hours in DH to populate `style` for its terminal-recent items. Other consumers add as they need them.
