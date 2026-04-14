# Nimbus Gantt v10 Component Specification

## Overview

This document is the Phase 1A port specification — a complete visual + behavioural blueprint for rebuilding the `DeliveryTimelineV5` experience inside the `nimbus-gantt` package (monorepo) so it can also ship as an LWC inside Delivery Hub.

**Source of truth**:
- `cloudnimbusllc.com/src/app/mf/delivery-timeline-v5/DeliveryTimelineV5.tsx` (2864 LOC)
- `cloudnimbusllc.com/src/components/gantt-demo/FloatingDetailPanel.tsx`
- `cloudnimbusllc.com/src/components/gantt-demo/PriorityDragSidebar.tsx`
- `cloudnimbusllc.com/src/components/gantt-demo/AuditListView.tsx`
- `cloudnimbusllc.com/src/components/gantt-demo/DemoCanvas.tsx`
- `cloudnimbusllc.com/src/components/gantt-demo/renderers/{Gantt,Treemap,Bubble,Calendar,Flow}Renderer.ts`
- `cloudnimbusllc.com/src/components/gantt-demo/renderers/theme.ts`
- `cloudnimbusllc.com/src/components/gantt-demo/renderers/types.ts`

**Consumer**: Phase 2 (implementation) reads this doc to generate the React components, Tailwind class merge tables, and LWC equivalents. Phase 3 writes Storybook stories keyed to the section numbers here. Phase 4 writes cypress e2e tests that hit the `data-testid` attributes documented here.

**Non-goals**: back-end API shape, Apex controller design, proForma reducer semantics — those live in sibling docs.

---

## Color Constants

All colour literals used across the 15 sections. Extract into `packages/nimbus-gantt/src/theme/v10-tokens.ts` as typed constants when porting.

### `CATEGORY_COLORS` (leaf bar fill + legend swatches)
```ts
const CATEGORY_COLORS: Record<string, string> = {
  "in-flight":    "#10b981",  // emerald-500
  "next-up":      "#3b82f6",  // blue-500
  "paused":       "#94a3b8",  // slate-400
  "backlog":      "#f59e0b",  // amber-500
  "expansion":    "#a78bfa",  // violet-400
  "done":         "#cbd5e1",  // slate-300
  "group":        "#475569",  // slate-600
  "group-header": "#475569",  // slate-600
};
```

### `GROUP_COLORS` (priority-bucket header text + depth-tint base)
```ts
const GROUP_COLORS: Record<ProFormaGroup, string> = {
  "top-priority": "#dc2626", // red-600
  "active":       "#d97706", // amber-600
  "follow-on":    "#059669", // emerald-600
  "proposed":     "#2563eb", // blue-600
  "deferred":     "#94a3b8", // slate-400
};
```

### `GROUP_BG` (priority-bucket header background — strong for white text)
```ts
const GROUP_BG: Record<ProFormaGroup, string> = {
  "top-priority": "#ef4444", // red-500
  "active":       "#f59e0b", // amber-500
  "follow-on":    "#10b981", // emerald-500
  "proposed":     "#3b82f6", // blue-500
  "deferred":     "#94a3b8", // slate-400
};
```

### `GROUP_BAR_COLORS` (parent bar fill, themed per priority bucket)
```ts
const GROUP_BAR_COLORS: Record<ProFormaGroup, string> = {
  "top-priority": "#f87171", // red-400 — warm coral
  "active":       "#fbbf24", // amber-400 — golden
  "follow-on":    "#34d399", // emerald-400 — fresh green
  "proposed":     "#60a5fa", // blue-400 — sky blue
  "deferred":     "#cbd5e1", // slate-300 — muted gray
};
```

### Sidebar-only colours (PriorityDragSidebar.tsx)
```ts
// CATEGORY_DOT — the little dot next to each sidebar row
const CATEGORY_DOT: Record<string, string> = {
  "in-flight": "#10b981",
  "next-up":   "#3b82f6",
  "paused":    "#94a3b8",
  "backlog":   "#f59e0b",
  "expansion": "#a78bfa",
  "done":      "#cbd5e1",
};

// Ghost during drag
// background:#eff6ff (blue-50), border:2px solid #3b82f6 (blue-500)
// box-shadow: 0 8px 24px rgba(59,130,246,0.35), color:#1e40af (blue-800)
```

### AuditListView bucket backgrounds (softer, pastel)
```ts
const GROUP_BG_AUDIT: Record<ProFormaGroup, string> = {
  "top-priority": "#fef2f2", // red-50
  "active":       "#fffbeb", // amber-50
  "follow-on":    "#ecfdf5", // emerald-50
  "proposed":     "#eff6ff", // blue-50
  "deferred":     "#f8fafc", // slate-50
};
```

### Canvas renderer palette (`theme.ts` → LIGHT)
```ts
const LIGHT: ThemeTokens = {
  bg:         "#ffffff",
  headerBg:   "#f3f4f6",
  headerText: "#1f2937",
  gridLine:   "#e5e7eb",
  altRowBg:   "#f9fafb",
  text:       "#1f2937",
  textMuted:  "#6b7280",
  todayLine:  "#ef4444",
  todayBg:    "rgba(239,68,68,0.08)",
  weekendBg:  "rgba(229,231,235,0.4)",
  depLine:    "#94a3b8",
  barText:    "#ffffff",
  font:       "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};
```

### Calendar-renderer heatmap palette
```ts
// Light mode
const GREENS_LIGHT = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
// Dark mode
const GREENS_DARK  = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
```

### Renderer colorMap (`COLOR_MAP` in theme.ts, used by FlowRenderer stage bars)
```ts
const COLOR_MAP: Record<string, string> = {
  Planning:    "#6366f1", // indigo-500
  Development: "#3b82f6", // blue-500
  Testing:     "#a855f7", // purple-500
  Review:      "#f59e0b", // amber-500
  Done:        "#22c55e", // green-500
  Blocked:     "#ef4444", // red-500
};
```

### Drag/ghost/spacer colours (DeliveryTimelineV5 tree drag effect)
- Ghost background: `#dbeafe` (blue-200) · border `#2563eb` (blue-600) · text `#1d4ed8` (blue-700)
- Ghost shadow: `0 16px 40px rgba(37,99,235,0.45), 0 4px 12px rgba(0,0,0,0.15)`
- Spacer row background: `rgba(59,130,246,0.07)`
- Spacer border: `2px solid #3b82f6` top, `2px solid rgba(59,130,246,0.3)` bottom
- Drop-hint label colour: `#3b82f6`

### Row drag outline
- `dragRow.style.outline = '2px solid #3b82f6'`

---

## Feature Flags

Every state-driven conditional render in `DeliveryTimelineV5`. These are the toggles the LWC/React shell must support.

### Toolbar toggles (all persisted in React state only — no localStorage yet)
| State | Type | Default | Controls |
|-------|------|---------|----------|
| `sidebarOpen` | `boolean` | `false` | Renders `<PriorityDragSidebar>` pane on left |
| `showKpis` | `boolean` | `false` | Renders stat cards strip (`KpiCard` grid) |
| `showAuditPanel` | `boolean` | `true` | Renders fuchsia audit submit/reset strip |
| `fullscreen` | `boolean` | `true` | Toggles `fixed inset-0 z-[100]` wrapper |
| `chromeVisible` | `boolean` | `true` | Hides/shows entire toolbar drawer |
| `chromeHover` | `boolean` | `false` | Peek-mode when hovering top edge |
| `showAdminPanel` | `boolean` | `false` | Floating feature-flag panel (top-right) |
| `showAdvisor` | `boolean` | `false` | Renders `<AdvisorPanel>` overlay |
| `showResourcePanel` | `boolean` | `false` | Floating team-resources editor |

### View-mode toggle
| State | Type | Default | Controls |
|-------|------|---------|----------|
| `viewMode` | `"gantt" \| "list" \| "treemap" \| "bubbles" \| "calendar" \| "flow"` | `"gantt"` (via `initialViewMode` prop) | Which main-area renderer is shown |

### Filter toggles
| State | Type | Default |
|-------|------|---------|
| `filter` | `"all"\|"active"\|"proposal"\|"done"\|"real"\|"workstreams"` | `"active"` |
| `searchQuery` | `string` | `""` (read from `?search=` URL param on mount) |
| `zoom` | `"day"\|"week"\|"month"\|"quarter"` | `"week"` |
| `ganttGroupBy` | `"priority"\|"epic"` | `"priority"` |
| `sidebarGroupBy` | `"priority"\|"epic"` | `"priority"` |

### Nested feature-flag object (admin panel)
```ts
const [featureFlags, setFeatureFlags] = useState({
  showWeekends:     true,
  showDependencies: true,
  showProgress:     true,
  showToday:        true,
  criticalPath:     false,
  virtualScroll:    false,
  keyboard:         false,
  milestones:       false,
});
```

### Detail-panel stack state
- `openPanels: (ProFormaItem & { _initialEdit?: boolean })[]` — multiple floating panels open simultaneously, each offset by `idx * 30` pixels.
- `selectedItem: ProFormaItem | null` — lightweight selection (grid-click vs canvas-click distinction).

### Linking / context-menu state
- `contextMenu: { x, y, taskId, mode: "main" | "add-prereq" | "add-dependent" } | null`
- `linkingMode: { sourceTaskId: string; type: "prereq" | "dependent" } | null`

### Alt-renderer scroll state (non-Gantt views only)
- `scrollX`, `scrollY: number`
- `collapsedIds: Set<string>`
- `hoveredId: string | null`
- `mousePos: { x, y }`
- `isDragging: boolean`

### Audit state
- `auditNote: string`
- `auditSubmitting: boolean`
- `auditResult: { ok, msg, sha? } | null`

### Resource pool state
```ts
const [poolMembers, setPoolMembers] = useState<PoolMember[]>([
  { name: "Glen",   role: "Principal Engineer", hoursPerMonth: 80, active: true },
  { name: "Mahi",   role: "SFDC Dev",           hoursPerMonth: 50, active: true },
  { name: "Antima", role: "SFDC Dev (PT)",      hoursPerMonth: 40, active: true },
]);
```

### Estimation state
- `hoursPerMonth: number` — default `120`
- `resourceOverrides: Record<string, number>`
- `sidebarWidth: number` — default `280`, resizable 150–800

---

## Theme Tokens

The `V3_MATCH_THEME` object passed to `<NimbusGanttChart theme={...}>`. Lift verbatim into `v10-tokens.ts`.

```ts
const V3_MATCH_THEME = {
  // Timeline (chart area) — white base so weekend shading pops
  timelineBg:          "#ffffff",
  timelineGridColor:   "#e5e7eb",
  timelineHeaderBg:    "#f3f4f6",
  timelineHeaderText:  "#1f2937",
  timelineWeekendBg:   "rgba(229,231,235,0.4)",

  // Today marker
  todayLineColor:      "#ef4444",
  todayBg:             "rgba(239,68,68,0.08)",

  // Bars
  barDefaultColor:     "#94a3b8",
  barBorderRadius:     4,
  barProgressOpacity:  0.25,
  barTextColor:        "#ffffff",
  barSelectedBorder:   "#3b82f6",

  // Grid (left panel)
  gridBg:              "#ffffff",
  gridAltRowBg:        "rgba(255,255,255,0)",
  gridBorderColor:     "#e5e7eb",
  gridTextColor:       "#1f2937",
  gridHeaderBg:        "#f3f4f6",
  gridHeaderText:      "#1f2937",
  gridHoverBg:         "rgba(229,231,235,0.3)",

  // Dependencies — bold blue so they stand out
  dependencyColor:     "#3b82f6",
  dependencyWidth:     2,

  // Typography
  fontFamily:          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize:            12,
  selectionColor:      "#3b82f6",

  // Layout
  singleRowHeader:     true,
};
```

### Font stack
```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
```
Monospace (for hours columns + IDs):
```
'SF Mono', 'Cascadia Code', 'Consolas', monospace
```

### Spacing rhythm (inferred from repeated Tailwind utility usage)
| Token | Used for |
|-------|----------|
| `gap-2` / `8px` | Toolbar inter-button gap |
| `px-3 py-1.5` | All toolbar bars (toolbar, slicer, audit, weekly strip) |
| `px-3 py-2` | Modal/panel headers |
| `text-[9px]` / `text-[10px]` / `text-[11px]` / `text-xs` | Four-tier label hierarchy |

---

## Layout Constants

Pixel geometry used by both canvas renderers and the React shell.

### From `DemoCanvas.tsx` / `GanttRenderer.ts`
```ts
const MS_DAY     = 86_400_000;
const ROW_H      = 32;   // gantt row height
const BAR_H      = 20;   // gantt bar height
const HEADER_H   = 48;   // canvas date-axis header
const LABEL_W    = 240;  // grid left panel width (canvas)
const LEFT_PAD   = 240;  // GanttRenderer synonym for LABEL_W
const RIGHT_PAD  = 20;
const HANDLE_W   = 20;   // move-handle grip area
const EDGE_PX    = 8;    // bar-edge resize hit radius
```

### From `NimbusGanttChart` props (DeliveryTimelineV5)
```
rowHeight     = 32
barHeight     = 20
headerHeight  = 32
gridWidth     = 295
```

### Sidebar & detail panel
- Sidebar width: clamp `150..800`, default `280`
- Resizer thickness: `1px` (Tailwind `w-1`)
- Detail panel width: `380px` expanded, `280px` minimized
- Detail panel max body height: `400px` (scroll beyond)
- Detail panel corner radius: `rounded-xl` (12px)

### Depth-shading formulas (drag useEffect)
```
parent_padding(d) = 8 + d × 10   // px, for rows with ▶ expand icon
leaf_padding(d)   = max(0, d × 10)  // px, for rows with hamburger spacer
```

Library default depth map: depth 0→28px, 1→48px, 2→68px, 3→88px. CSS overrides to compact:
```
depth 0: 8px
depth 1: 18px
depth 2: 28px
depth 3: 38px
```

### Drag-effect thresholds
- `DRAG_THRESHOLD = 6` (pixels before drag activates)
- `DEPTH_CHANGE_STEP = 25` (horizontal pixels per depth level)
- Auto-scroll edge zone: `EDGE = 60px` · `MAX_SPEED = 18px/tick`
- Double-click window: `350ms`

### Sidebar drag-effect
- `THRESHOLD = 5` (pixels before sidebar drag activates)
- Ghost offset: `+12, -14` from cursor

### Audit panel
- No max width; flex-wrap with `min-w-[200px]` search
- Bucket bar header pill width: follows content

### Tooltip positioning
- `left = min(mouseX + 12, window.innerWidth - 340)`
- `top = mouseY < 200 ? mouseY + 16 : mouseY - 96`
- Max width: `320px`
- Background: `bg-slate-900 text-white`, `rounded-lg`, `shadow-xl`

### Resource / admin floating panels
- `absolute top-12 right-3 z-[110]` (admin)
- `absolute top-[110px] right-4 z-50 w-72` (resource)
- Both `rounded-xl shadow-2xl`

---

## Plugin Constants

Copy arrays **verbatim** into the LWC wire format. These drive the plugin registry.

### `VIEW_MODES`
```ts
const VIEW_MODES: { id: ViewMode; label: string; icon: string }[] = [
  { id: "gantt",    label: "Gantt",    icon: "▤" },
  { id: "list",     label: "List",     icon: "☰" },
  { id: "treemap",  label: "Treemap",  icon: "▦" },
  { id: "bubbles",  label: "Bubbles",  icon: "◉" },
  { id: "calendar", label: "Calendar", icon: "▥" },
  { id: "flow",     label: "Flow",     icon: "⟿" },
];
```

### `ALT_RENDERERS`
```ts
const ALT_RENDERERS: Record<string, DemoRenderer> = {
  treemap:  treemapRenderer,
  bubbles:  bubbleRenderer,
  calendar: calendarRenderer,
  flow:     flowRenderer,
};
```

### `FILTER_OPTIONS`
```ts
const FILTER_OPTIONS: [Filter, string][] = [
  ["active",      "Active"],
  ["proposal",    "Proposal & Expansion"],
  ["done",        "Done"],
  ["real",        "Real T-NNNN tickets"],
  ["workstreams", "Workstream rollups"],
  ["all",         "Everything"],
];
```

### `GROUP_ORDER`
```ts
const GROUP_ORDER: ProFormaGroup[] = [
  "top-priority",
  "active",
  "follow-on",
  "proposed",
  "deferred",
];
```

### `GROUP_LABELS` (v5 uppercase — matches canvas rendering)
```ts
const GROUP_LABELS: Record<ProFormaGroup, string> = {
  "top-priority": "NOW",
  "active":       "NEXT",
  "follow-on":    "PLANNED",
  "proposed":     "PROPOSED",
  "deferred":     "HOLD",
};
```

### Sidebar `GROUP_META` (mixed-case labels — sidebar-only)
```ts
const GROUP_META: Record<ProFormaGroup, { label; color; bg; border; activeBg }> = {
  "top-priority": { label: "Now",      color: "text-red-700",     bg: "bg-red-50",      border: "border-red-200",     activeBg: "bg-red-100" },
  active:         { label: "Next",     color: "text-amber-700",   bg: "bg-amber-50",    border: "border-amber-200",   activeBg: "bg-amber-100" },
  "follow-on":    { label: "Planned",  color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200", activeBg: "bg-emerald-100" },
  proposed:       { label: "Proposed", color: "text-blue-700",    bg: "bg-blue-50",     border: "border-blue-200",    activeBg: "bg-blue-100" },
  deferred:       { label: "Hold",     color: "text-slate-400",   bg: "bg-slate-50/50", border: "border-slate-200",   activeBg: "bg-slate-100" },
};
```

### `CATEGORY_LABELS`
```ts
const CATEGORY_LABELS: Record<string, string> = {
  "in-flight": "In Flight",
  "next-up":   "Next Up",
  "paused":    "Paused",
  "backlog":   "Backlog (sized)",
  "expansion": "Expansion (proposal)",
  "done":      "Done",
};
```

### `CLOUD_NIMBUS_PRIORITY_BUCKETS` (import shape from `@/lib/nimbus-gantt/PriorityGroupingPlugin`)
```ts
// Each bucket object has { id, label, colorBg, colorText } — array order
// matches GROUP_ORDER above. Port from PriorityGroupingPlugin.ts verbatim.
import {
  PriorityGroupingPlugin,
  CLOUD_NIMBUS_PRIORITY_BUCKETS,
  hoursWeightedProgress,
  isBucketHeaderId,
} from "@/lib/nimbus-gantt/PriorityGroupingPlugin";
```

Plugin instance is memoized:
```ts
const priorityPlugin = useMemo(
  () => PriorityGroupingPlugin({
    buckets:           CLOUD_NIMBUS_PRIORITY_BUCKETS,
    getBucket:         (task) => (task.groupId as string) ?? null,
    getBucketProgress: hoursWeightedProgress,
  }),
  []
);
```

### `FILTER` type (for Phase 2 typing)
```ts
type ViewMode = "gantt" | "list" | "treemap" | "bubbles" | "calendar" | "flow";
type Filter   = "all" | "active" | "proposal" | "done" | "real" | "workstreams";
type GroupBy  = "priority" | "epic";
type ZoomLevel = "day" | "week" | "month" | "quarter";
```

### Nimbus columns
```ts
const nimbusColumns = [
  { field: "title",      header: "", width: 210, tree: true },
  { field: "hoursLabel", header: "", width: 85,  align: "right" },
];
```

---

## Component Sections

Fifteen sections. Each maps to a discrete React component to be extracted during Phase 2.

---

### 1. TitleBar

**Purpose**: Top-of-toolbar brand + version tag + view-mode button row.

**HTML tree**:
```
<div className="bg-white border-b border-slate-200 px-3 py-1.5 flex items-center gap-2 flex-wrap min-w-0 overflow-x-hidden">
  <span className="text-sm font-bold text-slate-900">MF Delivery Timeline</span>
  <span className="text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
    v4 · Nimbus Gantt
  </span>
  <span className="text-slate-200">|</span>
  {VIEW_MODES.map(v => (
    <button key={v.id} onClick={...} className={...}>
      <span className="mr-1">{v.icon}</span>{v.label}
    </button>
  ))}
  <span className="text-slate-200">|</span>
  {/* Sidebar / Stats / Audit toggles */}
  <span className="text-slate-200">|</span>
  {/* Zoom pill group */}
  <span className="text-slate-200">|</span>
  {/* Group-by toggle with context-menu for sidebar-only binding */}
  <div className="flex-1" />
  <span className="text-[10px] text-slate-500 font-mono">{scheduledSummary}</span>
  <button>Unpin / Pin</button>
  <button>Fullscreen / Exit Fullscreen</button>
  <button>Admin</button>
  <button>Advisor</button>
  <Link href="/mf/delivery-timeline-v3">v3 (Canvas)</Link>
</div>
```

**Tailwind classes used**:
- outer div: `bg-white`, `border-b`, `border-slate-200`, `px-3`, `py-1.5`, `flex`, `items-center`, `gap-2`, `flex-wrap`, `min-w-0`, `overflow-x-hidden`
- brand span: `text-sm`, `font-bold`, `text-slate-900`
- version pill: `text-[9px]`, `font-bold`, `text-violet-600`, `bg-violet-50`, `border`, `border-violet-200`, `rounded-full`, `px-2`, `py-0.5`
- separator span: `text-slate-200`
- view-mode button: `text-[10px]`, `font-semibold`, `px-2`, `py-1`, `rounded-full`, `border`, `transition-colors`
- filler: `flex-1`
- summary: `text-[10px]`, `text-slate-500`, `font-mono`

**Inline styles**: none.

**Dynamic classes**:
- view-mode button:
  ```
  ${viewMode === v.id
    ? "bg-violet-600 text-white border-violet-600"
    : "bg-white text-slate-500 border-slate-200 hover:border-violet-300"}
  ```
- sidebar/stats/audit toggle (each):
  ```
  ${on
    ? "bg-blue-600 text-white border-blue-600"
    : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}
  ```
- zoom button:
  ```
  ${zoom === z
    ? "bg-slate-800 text-white border-slate-800"
    : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"}
  ```
- group-by button (4 variants based on `isGantt && isSidebar`, `isGantt`, `isSidebar`, neither):
  - both: `bg-indigo-600 text-white border-indigo-600`
  - gantt only: `bg-indigo-100 text-indigo-700 border-indigo-400`
  - sidebar only: `bg-blue-100 text-blue-700 border-blue-400`
  - neither: `bg-white text-slate-500 border-slate-200 hover:border-indigo-300`
- Unpin/Pin: `chromeVisible ? bg-amber-500 text-white border-amber-500 : bg-white ...`
- Fullscreen: `fullscreen ? bg-slate-700 text-white border-slate-700 : bg-white ...`
- Admin: `showAdminPanel ? bg-rose-500 text-white border-rose-500 : bg-white text-slate-400 ...`
- Advisor: `showAdvisor ? bg-indigo-600 text-white border-indigo-600 : bg-white text-indigo-500 ...`

**Props received**: none (owns state via parent).

**Events emitted**:
- `onViewModeChange(mode: ViewMode)` → `setViewMode`
- `onToggleSidebar() / onToggleKpis() / onToggleAudit()`
- `onZoomChange(z: ZoomLevel)`
- `onGanttGroupByChange(g: GroupBy)` (left-click)
- `onSidebarGroupByChange(g: GroupBy)` (right-click / context menu)
- `onTogglePin() / onToggleFullscreen() / onToggleAdmin() / onToggleAdvisor()`

**Local state**: none (pure render from parent state).

**Data-driven rendering**:
- Renders one button per entry in `VIEW_MODES`
- Renders one button per zoom level in `["day","week","month","quarter"]`
- Renders one button per group-by option `["priority","epic"]`
- Group-by button appends a superscript `G` or `S` single-letter tag when only one binding is active

---

### 2. FilterBar

**Purpose**: Slicer (filter chips) + search input + colour legend + Team button + Auto-Schedule.

**HTML tree**:
```
<div className="bg-white border-b border-slate-100 px-3 py-1.5 min-w-0 overflow-x-hidden">
  <div className="flex items-center gap-2 flex-wrap min-w-0">
    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">View:</span>
    {FILTER_OPTIONS.map(([f, label]) => (
      <button key={f}>{label}</button>
    ))}
    <span className="text-slate-200 mx-1">|</span>
    <div className="relative inline-flex items-center">
      <span className="absolute left-2 text-[10px] text-slate-400 pointer-events-none">🔎</span>
      <input data-testid="gantt-search-input" ... />
      {searchQuery && <button onClick={clear} ...>×</button>}
    </div>
    <span className="text-slate-200 mx-1">|</span>
    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Colors:</span>
    {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
      <span className="inline-flex items-center gap-1">
        <span className="w-3 h-3 rounded" style={{ background: CATEGORY_COLORS[cat] }} />
        <span className="text-[9px] text-slate-600">{label} ({count})</span>
      </span>
    ))}
    <span className="text-slate-200 mx-1">|</span>
    {/* Team button */}
    <button className="...indigo...">Team <span>{active.length}×</span></button>
    <span className="text-[9px] text-slate-400 font-mono">{totalH}h/mo</span>
    <button onClick={autoSchedule} className="...indigo-600...">Auto-Schedule</button>
    <div className="flex-1" />
    <span className="text-[10px] text-slate-400">{filteredItems.length} items · {scheduled.length} scheduled · {unscheduled.length} need dates</span>
    {isDirty && <button onClick={resetAll}>Reset changes</button>}
  </div>
</div>
```

**Tailwind classes used**:
- outer: `bg-white`, `border-b`, `border-slate-100`, `px-3`, `py-1.5`, `min-w-0`, `overflow-x-hidden`
- filter button: `text-[10px]`, `font-semibold`, `px-2.5`, `py-1`, `rounded-full`, `border`, `transition-colors`
- search input: `text-[10px]`, `pl-6`, `pr-6`, `py-1`, `rounded-full`, `border`, `border-slate-200`, `bg-white`, `text-slate-700`, `placeholder:text-slate-400`, `focus:border-blue-400`, `focus:outline-none`, `w-48`
- search clear: `absolute`, `right-2`, `text-[12px]`, `text-slate-400`, `hover:text-slate-700`
- legend swatch: `w-3`, `h-3`, `rounded`
- team pill: `inline-flex`, `items-center`, `gap-1`, `text-[9px]`, `font-semibold`, `text-indigo-600`, `border`, `border-indigo-200`, `bg-indigo-50`, `hover:bg-indigo-100`, `rounded`, `px-2`, `py-0.5`, `transition-colors`
- auto-schedule: `text-[9px]`, `font-bold`, `text-white`, `bg-indigo-600`, `hover:bg-indigo-700`, `px-2.5`, `py-1`, `rounded-full`, `transition-colors`
- dirty reset: `text-[9px]`, `text-rose-500`, `hover:text-rose-700`, `underline`

**Inline styles**:
- search input `w-48` (192px fixed)
- legend swatch: `{ background: CATEGORY_COLORS[cat] || "#94a3b8" }`

**Dynamic classes**:
- filter button:
  ```
  ${filter === f
    ? "bg-blue-600 text-white border-blue-600"
    : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}
  ```

**Props received**:
- `filter: Filter`
- `searchQuery: string`
- `categoryCounts: Record<string, number>`
- `filteredItems`, `scheduled`, `unscheduled`: arrays
- `poolMembers: PoolMember[]`
- `isDirty: boolean`

**Events emitted**:
- `onFilterChange(f: Filter)`
- `onSearchChange(q: string)`
- `onOpenResourcePanel()`
- `onAutoSchedule()` (batched resource pool auto-scheduler)
- `onResetAll()`

**Local state**: none.

**Data-driven rendering**:
- One chip per `FILTER_OPTIONS` entry
- One swatch per `CATEGORY_LABELS` entry where `count > 0`
- `data-testid="gantt-search-input"` on the search input for e2e

---

### 3. ZoomBar

**Purpose**: Four zoom-level buttons inside TitleBar — in v5 they are inline with the title bar but we separate them for reuse in embedded contexts.

**HTML tree**:
```
<div className="flex items-center gap-2">
  {(["day", "week", "month", "quarter"] as ZoomLevel[]).map((z) => (
    <button
      key={z}
      onClick={() => setZoom(z)}
      className={...}
    >
      {z.charAt(0).toUpperCase() + z.slice(1)}
    </button>
  ))}
</div>
```

**Tailwind classes**:
- button: `text-[10px]`, `font-semibold`, `px-2`, `py-1`, `rounded-full`, `border`, `transition-colors`

**Inline styles**: none.

**Dynamic classes**:
```
${zoom === z
  ? "bg-slate-800 text-white border-slate-800"
  : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"}
```

**Props received**:
- `zoom: ZoomLevel`

**Events emitted**:
- `onZoomChange(z: ZoomLevel)`

**Local state**: none.

**Data-driven rendering**: one button per entry in the literal array `["day","week","month","quarter"]`.

---

### 4. Sidebar (PriorityDragSidebar)

**Purpose**: Left-side drag-and-drop priority bucket editor. Users grab the ☰ handle and move items between NOW/NEXT/PLANNED/PROPOSED/HOLD.

**HTML tree**:
```
<div ref={containerRef} className="h-full flex flex-col bg-white border-r border-slate-200 select-none">
  {/* Header */}
  <div className="px-3 py-2 border-b border-slate-200 flex-shrink-0">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Priority Groups</p>
        <p className="text-[9px] text-slate-400 mt-0.5">Drag ☰ to move between buckets</p>
      </div>
      {isDirty && onReset && <button className="...rose...">Reset</button>}
    </div>
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span>Capacity</span>
        <input type="number" className="w-14 ..." />
        <span>h/mo</span>
      </div>
      <button onClick={handleAutoSchedule} className="...bg-blue-600...">Auto-Schedule</button>
      {lastResult && <div className="...bg-blue-50...">Completes: {date} · resourceSummary</div>}
    </div>
  </div>
  {/* Drag zones */}
  <div className="flex-1 overflow-y-auto">
    {GROUP_ORDER.map((g) => (
      <div key={g} data-group-id={g} className={...}>
        <div className={`px-3 py-1.5 ${meta.bg} flex items-center justify-between`}>
          <span className={`text-[9px] font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
          <span className="text-[9px] text-slate-400 font-mono">{groupItems.length} · {totalHours}h</span>
        </div>
        {/* Drop indicator for empty group */}
        {groupItems.length === 0 && <div className="mx-2 my-1 h-0.5 rounded ..." />}
        {groupItems.length === 0 && !isHover && <div className="px-3 py-3 text-[10px] text-slate-400 italic">Drop items here</div>}
        {groupItems.map((it) => (
          <>
            {showIndicator && <div className="mx-2 h-0.5 bg-blue-500 rounded pointer-events-none" />}
            <div data-item-id={it.id} data-item-title={it.title} className="px-3 py-1.5 flex items-center gap-2 border-b border-slate-50 hover:bg-slate-50 transition-colors" onClick={...}>
              <span data-drag-handle="1" className="text-[11px] text-slate-300 flex-shrink-0 leading-none cursor-grab active:cursor-grabbing hover:text-slate-500 transition-colors px-0.5 py-1">☰</span>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CATEGORY_DOT[it.category] || "#94a3b8" }} />
              <span className="text-[10px] text-slate-700 truncate flex-1 min-w-0">{it.title}</span>
              <span className="text-[9px] text-slate-400 font-mono flex-shrink-0">{it.hoursHigh}h</span>
            </div>
          </>
        ))}
      </div>
    ))}
  </div>
</div>
```

**Tailwind classes**:
- outer: `h-full`, `flex`, `flex-col`, `bg-white`, `border-r`, `border-slate-200`, `select-none`
- header: `px-3`, `py-2`, `border-b`, `border-slate-200`, `flex-shrink-0`
- label h1: `text-[10px]`, `font-bold`, `text-slate-500`, `uppercase`, `tracking-wide`
- label h2: `text-[9px]`, `text-slate-400`, `mt-0.5`
- reset button: `text-[9px]`, `font-bold`, `text-rose-500`, `hover:text-rose-700`, `uppercase`, `px-2`, `py-1`, `rounded`, `hover:bg-rose-50`, `transition-colors`
- capacity input: `w-14`, `text-[10px]`, `font-mono`, `bg-slate-50`, `border`, `border-slate-200`, `rounded`, `px-1.5`, `py-0.5`, `text-center`
- auto-schedule: `w-full`, `text-[10px]`, `font-bold`, `uppercase`, `px-2`, `py-1.5`, `rounded-lg`, `bg-blue-600`, `text-white`, `hover:bg-blue-500`, `transition-colors`
- result box: `text-[9px]`, `text-slate-600`, `bg-blue-50`, `rounded`, `px-2`, `py-1.5`, `border`, `border-blue-200`
- drag zones container: `flex-1`, `overflow-y-auto`
- bucket section: `border-b` + `meta.border` + `transition-colors`
- bucket header: `px-3`, `py-1.5`, `meta.bg`, `flex`, `items-center`, `justify-between`
- bucket label: `text-[9px]`, `font-bold`, `uppercase`, `tracking-wider`, `meta.color`
- bucket count: `text-[9px]`, `text-slate-400`, `font-mono`
- drop indicator (empty): `mx-2`, `my-1`, `h-0.5`, `rounded`, `transition-all`
- drop placeholder text: `px-3`, `py-3`, `text-[10px]`, `text-slate-400`, `italic`
- active indicator bar: `mx-2`, `h-0.5`, `bg-blue-500`, `rounded`, `pointer-events-none`
- item row: `px-3`, `py-1.5`, `flex`, `items-center`, `gap-2`, `border-b`, `border-slate-50`, `hover:bg-slate-50`, `transition-colors`
- drag handle: `text-[11px]`, `text-slate-300`, `flex-shrink-0`, `leading-none`, `cursor-grab`, `active:cursor-grabbing`, `hover:text-slate-500`, `transition-colors`, `px-0.5`, `py-1`
- category dot: `w-2`, `h-2`, `rounded-full`, `flex-shrink-0`
- title text: `text-[10px]`, `text-slate-700`, `truncate`, `flex-1`, `min-w-0`
- hours text: `text-[9px]`, `text-slate-400`, `font-mono`, `flex-shrink-0`

**Inline styles**:
- category dot: `{ background: CATEGORY_DOT[it.category] || "#94a3b8" }`
- Ghost element (during drag, injected via `document.createElement`):
  ```
  position:fixed; z-index:99999; pointer-events:none;
  left: cursorX+12; top: cursorY-14;
  max-width:220px;
  background:#eff6ff; border:2px solid #3b82f6; border-radius:6px;
  box-shadow:0 8px 24px rgba(59,130,246,0.35);
  padding:5px 10px; font-size:11px; font-weight:600; color:#1e40af;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  display:flex; align-items:center; gap:6px;
  cursor:grabbing; user-select:none;
  ```

**Dynamic classes**:
- bucket section: `${isHover ? meta.activeBg : ""}` appended to `border-b ${meta.border} transition-colors`
- empty-group indicator: `${isHover ? "bg-blue-400 opacity-100" : "bg-transparent opacity-0"}`

**Props received** (from `interface Props`):
```ts
{
  items: ProFormaItem[];
  onMoveToGroup: (itemId: string, newGroup: ProFormaGroup) => void;
  onReorder: (itemId: string, newIndex: number) => void;
  onAutoSchedule?: (result: ScheduleResult) => void;
  onItemClick?: (item: ProFormaItem) => void;
  onReset?: () => void;
  isDirty?: boolean;
  groupBy?: "priority" | "epic";
}
```

**Events emitted**: see `Props` above. Drag resolution calls `onMoveToGroup(id, targetGroup)` then (after `setTimeout(…,0)`) `onReorder(id, index)`.

**Local state**:
- `capacity: useState<number>(120)` — h/mo for auto-schedule
- `lastResult: useState<ScheduleResult | null>(null)` — summary of last auto-schedule run
- `hoverGroup: useState<ProFormaGroup | null>(null)` — which bucket is hover-highlighted
- `indicatorBeforeId: useState<string | null>(null)` — which row shows the drop indicator line above it
- `indicatorGroup: useState<ProFormaGroup | null>(null)` — which bucket the indicator line sits in

**Data-driven rendering**:
- Renders one section per entry in `GROUP_ORDER`
- Inside each section: items sorted by `getSortOrder`, each rendered as a row
- Drag uses **window capture-phase** mouse listeners (NOT `@hello-pangea/dnd`) to survive the nimbus-gantt canvas's `stopPropagation` calls
- `data-group-id="{g}"`, `data-item-id="{it.id}"`, `data-item-title="{it.title}"`, `data-drag-handle="1"` are the hit-test selectors

---

### 5. StatsPanel

**Purpose**: Six-card KPI strip. Visible only when `showKpis` is true.

**HTML tree**:
```
<div className="bg-white border-b border-slate-100 px-3 py-3">
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
    <KpiCard label="Items in View" value={filteredItems.length} tone="slate" />
    <KpiCard label="Active (scheduled)" value={scheduled.length} tone="emerald" hint={...} />
    <KpiCard label="Scheduled" value={scheduled.length} tone="blue" hint={`of ${filteredItems.length} total`} />
    <KpiCard label="Hours Logged" value={`${hoursLogged}h`} tone="purple" hint="Actuals" />
    <KpiCard label="Hours Range" value={`${hoursLow}–${hoursHigh}h`} tone="amber" hint="Estimate envelope" />
    <div className="bg-white rounded-xl border-2 border-indigo-200 px-3 py-2 shadow-sm">
      <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide opacity-70">Months to complete</p>
      <p className="text-xl font-bold font-mono mt-0.5 text-indigo-700">{monthsLow}–{monthsHigh}</p>
      <div className="mt-0.5 flex items-center gap-1">
        <span className="text-[9px] text-indigo-700">at</span>
        <input type="number" ... className="w-12 text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1 py-0.5 text-center" />
        <span className="text-[9px] text-indigo-700">h/mo</span>
      </div>
    </div>
  </div>
</div>
```

Each generic `KpiCard`:
```
<div className="bg-white rounded-xl border-2 ${t.border} px-3 py-2 shadow-sm">
  <p className="text-[10px] font-bold uppercase tracking-wide opacity-70 ${t.label}">{label}</p>
  <p className="text-xl font-bold font-mono mt-0.5 ${t.value}">{value}</p>
  {hint && <p className="text-[9px] text-slate-400 mt-0.5">{hint}</p>}
</div>
```

**Tailwind classes**:
- outer: `bg-white`, `border-b`, `border-slate-100`, `px-3`, `py-3`
- grid: `grid`, `grid-cols-2`, `sm:grid-cols-3`, `lg:grid-cols-6`, `gap-2`
- card: `bg-white`, `rounded-xl`, `border-2`, `px-3`, `py-2`, `shadow-sm`
- label: `text-[10px]`, `font-bold`, `uppercase`, `tracking-wide`, `opacity-70`
- value: `text-xl`, `font-bold`, `font-mono`, `mt-0.5`
- hint: `text-[9px]`, `text-slate-400`, `mt-0.5`
- h/mo input: `w-12`, `text-[10px]`, `font-mono`, `font-bold`, `text-indigo-700`, `bg-indigo-50`, `border`, `border-indigo-200`, `rounded`, `px-1`, `py-0.5`, `text-center`

**Inline styles**: none.

**Dynamic classes** (via `TONE_STYLES` table):
```ts
const TONE_STYLES = {
  slate:   { border: "border-slate-200",   label: "text-slate-500",   value: "text-slate-800" },
  emerald: { border: "border-emerald-200", label: "text-emerald-700", value: "text-emerald-800" },
  blue:    { border: "border-blue-200",    label: "text-blue-700",    value: "text-blue-800" },
  purple:  { border: "border-purple-200",  label: "text-purple-700",  value: "text-purple-800" },
  amber:   { border: "border-amber-200",   label: "text-amber-700",   value: "text-amber-800" },
  indigo:  { border: "border-indigo-200",  label: "text-indigo-700",  value: "text-indigo-800" },
};
```

**Props received**:
- `filteredItems: ProFormaItem[]`
- `scheduled`, `unscheduled: ProFormaItem[]`
- `hoursLow`, `hoursHigh`, `hoursLogged`, `monthsLow`, `monthsHigh`: numbers
- `hoursPerMonth: number`

**Events emitted**:
- `onHoursPerMonthChange(h: number)`

**Local state**: none.

**Data-driven rendering**: hardcoded 6-card layout; only the Months-to-complete card has an inline editor input.

---

### 6. ContentArea

**Purpose**: The `<div className="flex-1 flex overflow-hidden min-w-0 min-h-0">` wrapper that renders Sidebar + (Gantt | AuditListView | DemoCanvas) side by side.

**HTML tree**:
```
<div className="flex-1 flex overflow-hidden min-w-0 min-h-0">
  {sidebarOpen && (
    <>
      <div className="flex-shrink-0 border-r border-slate-200 bg-white overflow-y-auto overflow-x-hidden" style={{ width: sidebarWidth }}>
        <PriorityDragSidebar {...} />
      </div>
      <div className="w-1 flex-shrink-0 bg-slate-200 hover:bg-blue-400 cursor-col-resize transition-colors" onMouseDown={resizeHandler} />
    </>
  )}
  <div className="flex-1 relative min-w-0 min-h-0" style={{ overflow: "hidden" }}>
    {viewMode === "gantt" && (
      <div ref={ganttContainerRef} className="absolute inset-0 flex flex-col" ...>
        {linkingMode && <LinkingBanner ... />}
        <div className="flex-shrink-0 bg-slate-50 border-b border-slate-100 px-3 py-1">
          <input type="range" ... className="w-full h-1.5 appearance-none bg-slate-200 rounded-full cursor-pointer" style={{ accentColor: "#3b82f6" }} />
        </div>
        <div className="flex-1 relative min-h-0">
          <NimbusGanttChart ref={ganttRef} {...} />
        </div>
      </div>
    )}
    {viewMode === "list" && (
      <div className="absolute inset-0 overflow-hidden">
        <AuditListView {...} />
      </div>
    )}
    {viewMode !== "gantt" && viewMode !== "list" && ALT_RENDERERS[viewMode] && (
      <DemoCanvas renderer={ALT_RENDERERS[viewMode]} tasks={ganttTasks} deps={ganttDeps} options={altCanvasOptions} ... />
    )}
    {/* Gantt tooltip */}
    {/* Alt-view tooltip */}
  </div>
</div>
```

**Tailwind classes**:
- outer: `flex-1`, `flex`, `overflow-hidden`, `min-w-0`, `min-h-0`
- sidebar wrap: `flex-shrink-0`, `border-r`, `border-slate-200`, `bg-white`, `overflow-y-auto`, `overflow-x-hidden`
- resizer: `w-1`, `flex-shrink-0`, `bg-slate-200`, `hover:bg-blue-400`, `cursor-col-resize`, `transition-colors`
- canvas wrap: `flex-1`, `relative`, `min-w-0`, `min-h-0`
- gantt frame: `absolute`, `inset-0`, `flex`, `flex-col`
- scroll slider wrap: `flex-shrink-0`, `bg-slate-50`, `border-b`, `border-slate-100`, `px-3`, `py-1`
- scroll slider: `w-full`, `h-1.5`, `appearance-none`, `bg-slate-200`, `rounded-full`, `cursor-pointer`
- gantt inner: `flex-1`, `relative`, `min-h-0`
- list wrap: `absolute`, `inset-0`, `overflow-hidden`
- linking banner: `flex-shrink-0`, `bg-blue-600`, `text-white`, `px-4`, `py-2`, `flex`, `items-center`, `gap-3`, `text-xs`

**Inline styles**:
- sidebar wrap: `{ width: sidebarWidth }` (dynamic 150..800)
- canvas wrap: `{ overflow: "hidden" }`
- scroll slider: `{ accentColor: "#3b82f6" }`

**Dynamic classes**: none beyond `viewMode`-gated rendering.

**Props received** (as a composite shell):
- `sidebarOpen: boolean`, `sidebarWidth: number`
- `viewMode: ViewMode`
- `linkingMode: { sourceTaskId, type } | null`
- All Gantt / AuditListView / DemoCanvas props (relayed)

**Events emitted**:
- `onSidebarResize(newW: number)` — bounded [150, 800]
- Relays task-click / task-move / task-resize events upward

**Local state**: none (pure orchestrator).

**Data-driven rendering**: chooses renderer by `viewMode`; scroll slider controls the nimbus-gantt internal `scrollManager.scrollToX`.

---

### 7. DetailPanel (FloatingDetailPanel)

**Purpose**: Floating, draggable popover that shows one item's details and supports inline edit. Multiple instances can stack via `stackOffset`.

**HTML tree**:
```
<>
  <div ref={constraintsRef} /> {/* full-screen drag constraints */}
  <motion.div
    drag
    dragMomentum={false}
    dragConstraints={constraintsRef}
    initial={{ opacity: 0, scale: 0.95, y: 20 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.95 }}
    className="fixed z-[9999] shadow-2xl rounded-xl border-2 overflow-hidden bg-white"
    style={{
      bottom: 80 + stackOffset,
      right: 24 + stackOffset,
      width: minimized ? 280 : 380,
      borderColor: categoryColor,
      cursor: "default",
    }}
  >
    {/* Header */}
    <div className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none" style={{ background: categoryColor + "15" }}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: categoryColor }} />
        <span className="text-[10px] font-mono font-bold text-slate-500 flex-shrink-0">{item.id}</span>
        <span className="text-xs font-bold text-slate-900 truncate">{item.title}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
        {onSave && <button>✎</button>}
        <button>−/+</button>
        <button>×</button>
      </div>
    </div>
    {/* Body */}
    {!minimized && (
      <div className="px-3 py-3 space-y-2 max-h-[400px] overflow-y-auto text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: categoryColor+"20", color: categoryColor }}>{item.category}</span>
          {item.mfRef && <span className="text-slate-400 font-mono text-[10px]">{item.mfRef}</span>}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
          <Field label="Status"  value={item.status} />
          <Field label="Client"  value={item.client} />
          <Field label="Owner"   value={item.owner} />  {/* or EditField when editing */}
          <Field label="Group"   value={item.group || "—"} />
          <Field label="Start"   value={item.start || "—"} />
          <Field label="End"     value={item.end   || "—"} />
          <Field label="Hours est." value={hoursRangeStr} />
          <Field label="Logged"     value={loggedStr} />
        </div>
        {/* Progress bar */}
        {pct != null && <ProgressBar pct={pct} />}
        {item.variance != null && <VarianceField />}
        {item.source && <SourceLink />}
        {(item.notes || editing) && <NotesField />}
        {(editing || item.dependencies?.length) && <PrerequisitesSection />}
        {/* Save / Cancel / Edit buttons */}
      </div>
    )}
  </motion.div>
</>
```

**Tailwind classes**:
- outer motion.div: `fixed`, `z-[9999]`, `shadow-2xl`, `rounded-xl`, `border-2`, `overflow-hidden`, `bg-white`
- header: `flex`, `items-center`, `justify-between`, `px-3`, `py-2`, `cursor-grab`, `active:cursor-grabbing`, `select-none`
- header button: `text-slate-400`, `hover:text-slate-700`, `text-sm`, `px-1`, `transition-colors`
- body: `px-3`, `py-3`, `space-y-2`, `max-h-[400px]`, `overflow-y-auto`, `text-xs`
- category pill: `text-[9px]`, `font-bold`, `uppercase`, `px-1.5`, `py-0.5`, `rounded-full`, `flex-shrink-0`
- mfRef text: `text-slate-400`, `font-mono`, `text-[10px]`
- grid of Fields: `grid`, `grid-cols-2`, `gap-x-4`, `gap-y-1.5`, `pt-1`
- progress bar track: `h-1.5`, `bg-slate-100`, `rounded-full`, `overflow-hidden`
- progress bar fill: `h-full`, `rounded-full`, `transition-all`
- notes textarea: `w-full`, `mt-0.5`, `px-1.5`, `py-1`, `text-xs`, `text-slate-800`, `border`, `border-slate-300`, `rounded`, `bg-white`, `focus:outline-none`, `focus:ring-1`, `focus:ring-slate-400`, `resize-y`
- prereq row: `flex`, `items-center`, `gap-1.5`, `text-xs`, `bg-slate-50`, `rounded`, `px-2`, `py-1`
- prereq search dropdown: `absolute`, `left-0`, `right-0`, `top-full`, `mt-0.5`, `bg-white`, `border`, `border-slate-200`, `rounded`, `shadow-lg`, `max-h-[120px]`, `overflow-y-auto`, `z-10`
- save button: `flex-1`, `text-[10px]`, `font-bold`, `uppercase`, `px-2`, `py-1.5`, `rounded-lg`, `bg-emerald-600`, `text-white`, `hover:bg-emerald-700`, `transition-colors`
- cancel button: `flex-1`, `...`, `bg-slate-100`, `text-slate-600`, `hover:bg-slate-200`
- edit button: depending on `onSave`, either `bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer` or `bg-slate-100 text-slate-500 cursor-not-allowed`

**Inline styles**:
- outer:
  ```
  {
    bottom: 80 + stackOffset,
    right: 24 + stackOffset,
    width: minimized ? 280 : 380,
    borderColor: categoryColor,
    cursor: "default",
  }
  ```
- header background: `{ background: categoryColor + "15" }` (15 = 8% alpha in hex)
- category dot: `{ background: categoryColor }`
- category pill: `{ background: categoryColor + "20", color: categoryColor }` (20 = 12% alpha)
- progress fill width: `{ width: ${Math.min(pct,100)}% }`
- constraints ref mount effect: sets `position:fixed; inset:0; pointer-events:none; zIndex:9998`

**Dynamic classes**:
- progress % text colour:
  ```
  ${pct > 100 ? "text-red-600" : pct > 75 ? "text-amber-600" : "text-emerald-600"}
  ```
- progress fill colour:
  ```
  ${pct > 100 ? "bg-red-500" : pct > 75 ? "bg-amber-500" : "bg-emerald-500"}
  ```
- variance colour: `${item.variance < 0 ? "text-red-600 font-bold" : "text-emerald-600 font-bold"}`

**Props received**:
```ts
interface Props {
  item: FloatingDetailItem;
  onClose: () => void;
  categoryColor?: string;        // default "#64748b"
  stackOffset?: number;          // default 0
  initialEdit?: boolean;         // default false
  allTasks?: { id: string; title: string }[];
  onSave?: (updates: {
    start?: string;
    end?: string;
    hoursLow?: number;
    hoursHigh?: number;
    owner?: string;
    notes?: string;
    dependencies?: string[];
  }) => void;
}
```

**Events emitted**:
- `onClose()` — when the × button is clicked
- `onSave(updates)` — only the dirty fields are sent

**Local state**:
- `minimized: useState<boolean>(false)`
- `editing: useState<boolean>(initialEdit && !!onSave)`
- `editValues: useState<{ start, end, hoursLow, hoursHigh, owner, notes, dependencies }>`
- `depSearch: useState<string>("")`
- `constraintsRef: useRef<HTMLDivElement>` (framer-motion drag bounds)

**Data-driven rendering**:
- Two-column `Field` grid (Status, Client, Owner, Group, Start, End, Hours est., Logged)
- Progress bar only when `pct != null` (i.e., `hoursHigh > 0 && hoursLogged != null`)
- Variance row only when `item.variance != null`
- Source link only when `item.source` set
- Prerequisite section only when `editing || dependencies?.length > 0`
- Search filters tasks by id or title; excludes current id and already-added deps; top-8 results

---

### 8. AuditPanel

**Purpose**: Fuchsia strip with commit-note input + Submit + Reset. Persists pro-forma overrides to the backing Git repo via `/api/pro-forma/submit`.

**HTML tree**:
```
<div className="bg-fuchsia-50/60 border-b border-fuchsia-200 px-3 py-2" data-testid="audit-panel">
  <div className="flex flex-wrap items-center gap-2">
    <span className="text-[10px] font-bold text-fuchsia-700 uppercase tracking-wide shrink-0">📤 Audit pass</span>
    <span className={statusPillClass}>{isDirty ? "unsaved changes" : "clean"}</span>
    <input type="text" ... className="flex-1 min-w-[200px] text-[11px] px-2 py-1 border border-slate-300 rounded focus:outline-none focus:border-fuchsia-500" data-testid="audit-note-input" />
    <button className="text-[11px] font-bold px-3 py-1 rounded bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50 disabled:cursor-not-allowed" data-testid="audit-submit-btn">
      {auditSubmitting ? "Committing…" : "📤 Submit + commit"}
    </button>
    <button className="text-[11px] font-bold px-3 py-1 rounded bg-white text-slate-700 border border-slate-300 hover:border-rose-400 hover:text-rose-600" data-testid="audit-reset-btn">↺ Reset</button>
    <Link href="/mf/delivery-timeline-v8-api" className="text-[10px] text-slate-500 hover:text-fuchsia-600 underline decoration-dotted shrink-0" title="API docs — how to automate submits">API docs</Link>
  </div>
  {auditResult && (
    <div className={`mt-1.5 text-[11px] ${auditResult.ok ? "text-emerald-700" : "text-rose-700"}`}>
      {auditResult.ok ? "✓" : "✗"} {auditResult.msg}
      {auditResult.sha && <code className="ml-2 font-mono bg-slate-100 px-1 rounded">{auditResult.sha}</code>}
    </div>
  )}
</div>
```

**Tailwind classes**:
- outer: `bg-fuchsia-50/60`, `border-b`, `border-fuchsia-200`, `px-3`, `py-2`
- header label: `text-[10px]`, `font-bold`, `text-fuchsia-700`, `uppercase`, `tracking-wide`, `shrink-0`
- status pill (dirty): `text-[10px]`, `font-semibold`, `px-2`, `py-0.5`, `rounded-full`, `bg-amber-100`, `text-amber-800`
- status pill (clean): `...`, `bg-emerald-100`, `text-emerald-800`
- note input: `flex-1`, `min-w-[200px]`, `text-[11px]`, `px-2`, `py-1`, `border`, `border-slate-300`, `rounded`, `focus:outline-none`, `focus:border-fuchsia-500`
- submit button: `text-[11px]`, `font-bold`, `px-3`, `py-1`, `rounded`, `bg-fuchsia-600`, `text-white`, `hover:bg-fuchsia-700`, `disabled:opacity-50`, `disabled:cursor-not-allowed`
- reset button: `...`, `bg-white`, `text-slate-700`, `border`, `border-slate-300`, `hover:border-rose-400`, `hover:text-rose-600`
- API link: `text-[10px]`, `text-slate-500`, `hover:text-fuchsia-600`, `underline`, `decoration-dotted`, `shrink-0`
- result success: `mt-1.5`, `text-[11px]`, `text-emerald-700`
- result fail: `mt-1.5`, `text-[11px]`, `text-rose-700`
- sha code: `ml-2`, `font-mono`, `bg-slate-100`, `px-1`, `rounded`

**Inline styles**: none.

**Dynamic classes**:
- status pill toggles between amber-100/emerald-100 per `isDirty`
- result row class toggles per `auditResult.ok`

**Props received**:
- `isDirty: boolean`
- `onSubmit(note, overrides): Promise<{ success, commit? }>`
- `onReset(): void`

**Events emitted**:
- submit POST to `/api/pro-forma/submit` with `{ note, overrides }`

**Local state**:
- `auditNote: useState<string>("")`
- `auditSubmitting: useState<boolean>(false)`
- `auditResult: useState<{ ok, msg, sha? } | null>(null)`

**Data-driven rendering**:
- Shows result row only after a submit/reset attempt
- `data-testid` hooks: `audit-panel`, `audit-note-input`, `audit-submit-btn`, `audit-reset-btn`

---

### 9. HrsWkStrip

**Purpose**: 8-week horizontal sparkline of weekly hour totals (current week highlighted indigo).

**HTML tree**:
```
<div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex items-end gap-1 overflow-x-auto">
  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mr-1 shrink-0 self-center">Hrs/wk</span>
  {weeks.map((w) => (
    <div key={w.label} className="flex flex-col items-center gap-0.5 shrink-0 w-12">
      <span className={`text-[9px] font-bold ${w.isCurrent ? "text-indigo-600" : "text-slate-500"}`}>{w.hours}h</span>
      <div className="w-full rounded-sm overflow-hidden bg-slate-200 h-2">
        <div className={`h-full rounded-sm ${w.isCurrent ? "bg-indigo-500" : "bg-slate-400"}`} style={{ width: `${Math.round((w.hours / maxH) * 100)}%` }} />
      </div>
      <span className={`text-[8px] ${w.isCurrent ? "text-indigo-500 font-semibold" : "text-slate-400"}`}>{w.label}</span>
    </div>
  ))}
</div>
```

**Tailwind classes**:
- outer: `bg-slate-50`, `border-b`, `border-slate-200`, `px-3`, `py-1.5`, `flex`, `items-end`, `gap-1`, `overflow-x-auto`
- label: `text-[9px]`, `font-bold`, `text-slate-400`, `uppercase`, `tracking-wide`, `mr-1`, `shrink-0`, `self-center`
- week column: `flex`, `flex-col`, `items-center`, `gap-0.5`, `shrink-0`, `w-12`
- hours number: `text-[9px]`, `font-bold`
- bar track: `w-full`, `rounded-sm`, `overflow-hidden`, `bg-slate-200`, `h-2`
- bar fill: `h-full`, `rounded-sm`
- date label: `text-[8px]`

**Inline styles**:
- bar fill width: `{ width: ${(w.hours / maxH) * 100}% }`

**Dynamic classes**:
- hours text: `${w.isCurrent ? "text-indigo-600" : "text-slate-500"}`
- bar fill: `${w.isCurrent ? "bg-indigo-500" : "bg-slate-400"}`
- date label: `${w.isCurrent ? "text-indigo-500 font-semibold" : "text-slate-400"}`

**Props received**:
- `filteredItems: ProFormaItem[]`
- `today: Date`

**Events emitted**: none (pure display).

**Local state**: none. All derivation done in a synchronous IIFE inside the render.

**Data-driven rendering**:
- Computes 8 weeks starting at current ISO Monday
- For each week, sums `hoursHigh × overlapDays / itemDays` across items whose [start, effectiveEnd] overlaps the week range
- `maxH = max(weeks.hours, 1)` for proportional bar-widths

---

### 10. GanttChart

**Purpose**: The primary view — wrapping `<NimbusGanttChart>` with a horizontal-scroll slider, linking-mode banner, and tooltip.

**HTML tree**:
```
<div ref={ganttContainerRef} className="absolute inset-0 flex flex-col" onMouseMove={...} onMouseLeave={...}>
  {linkingMode && <LinkingBanner sourceTask={...} onCancel={...} />}
  <div className="flex-shrink-0 bg-slate-50 border-b border-slate-100 px-3 py-1">
    <input type="range" min={0} max={100} defaultValue={50} onChange={scrollHandler} className="w-full h-1.5 appearance-none bg-slate-200 rounded-full cursor-pointer" style={{ accentColor: "#3b82f6" }} />
  </div>
  <div className="flex-1 relative min-h-0">
    <NimbusGanttChart
      ref={ganttRef}
      tasks={nimbusGanttTasks}
      dependencies={featureFlags.showDependencies ? ganttDeps : []}
      columns={nimbusColumns}
      zoomLevel={zoom}
      rowHeight={32}
      barHeight={20}
      headerHeight={32}
      gridWidth={295}
      readOnly={false}
      showToday={featureFlags.showToday}
      showWeekends={featureFlags.showWeekends}
      showProgress={featureFlags.showProgress}
      colorMap={CATEGORY_COLORS}
      theme={V3_MATCH_THEME}
      plugins={[priorityPlugin]}
      onTaskClick={handleNimbusTaskClick}
      onTaskDblClick={handleNimbusTaskDblClick}
      onTaskHover={...}
      onTaskMove={handleNimbusTaskMove}
      onTaskResize={handleNimbusTaskResize}
      height="100%"
    />
  </div>
</div>
```

**Tailwind classes** (outer wrap): `absolute`, `inset-0`, `flex`, `flex-col`.
Scroll slider: see ContentArea above.
Linking banner: `flex-shrink-0`, `bg-blue-600`, `text-white`, `px-4`, `py-2`, `flex`, `items-center`, `gap-3`, `text-xs`.
Banner cancel button: `ml-auto`, `text-white/80`, `hover:text-white`, `text-sm`, `font-bold`, `px-2`, `py-0.5`, `rounded`, `hover:bg-white/20`, `transition-colors`.

Tooltip:
```
<div data-testid="gantt-hover-tooltip" className="fixed pointer-events-none z-40 bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-[320px] border border-slate-700" style={{ left: ..., top: ... }}>
  <p className="font-bold truncate">{item.title}</p>
  <p className="text-slate-300 text-[10px] mt-0.5">
    <code className="text-indigo-300">{item.name || item.id}</code>
    {item.owner && <span className="ml-2">{item.owner}</span>}
  </p>
  <div className="flex gap-3 mt-1 text-[10px] text-slate-300">
    <span>{hoursStr}{loggedStr}</span>
    {pct != null && <span>{pct}%</span>}
    {datesStr && <span className="truncate">{datesStr}</span>}
  </div>
  {item.source && <p className="text-[10px] text-indigo-300 mt-1 truncate">↗ {item.source}</p>}
  {item.notes && <p className="text-[10px] text-slate-400 mt-1 line-clamp-2">{item.notes}</p>}
</div>
```

**Inline styles**:
- scroll slider: `{ accentColor: "#3b82f6" }`
- tooltip positioning:
  ```
  {
    left: Math.min(mousePos.x + 12, window.innerWidth - 340),
    top:  mousePos.y < 200 ? mousePos.y + 16 : mousePos.y - 96,
  }
  ```

**Dynamic classes**: none on the wrapper (the library handles bar styling internally).

**Props received**:
```ts
{
  nimbusGanttTasks: Task[];      // cleaned of group-header rows
  ganttDeps: Dependency[];
  nimbusColumns: Column[];
  zoom: ZoomLevel;
  featureFlags: {...};
  priorityPlugin: Plugin;
  V3_MATCH_THEME: theme object;
  linkingMode: { sourceTaskId, type } | null;
  hoveredId: string | null;
  mousePos: { x, y };
  isDragging: boolean;
  proFormaItems: ProFormaItem[];  // to resolve hover tooltip content
}
```

**Events emitted**:
- `onTaskClick(task)` — grid vs canvas distinguished by `task._clickSource`
- `onTaskDblClick(task)` — opens detail panel in edit mode
- `onTaskHover(id)` — updates hover state + tooltip
- `onTaskMove(task, newStart, newEnd)` → `proForma.updateDates`
- `onTaskResize(task, newStart, newEnd)` → `proForma.updateDates`
- Right-click (on `.ng-grid-row:not(.ng-group-row)`) → opens context menu
- Cancel linking mode: `Escape` key or banner cancel button

**Local state**:
- `mousePos: { x, y }` — from `onMouseMove`
- `hoveredId: string | null`

**Data-driven rendering**:
- Tasks cleaned: strips `status === "group-header"` rows, strips `parentId` starting with `group-`/`epic-`
- Parent bars (tasks with children): darkened color via `darkenColor(color, 0.25)`, name suffix ` · N tasks`, `isEpic: true` flag
- Parent dates: computed recursively from descendants' min(start)..max(end)
- PriorityGroupingPlugin injects bucket header rows via middleware; the plugin's `getBucket: task => task.groupId` maps tasks to `CLOUD_NIMBUS_PRIORITY_BUCKETS` entries
- Depth-shading effect (MutationObserver-driven) applies inline background colours to rows + canvas `<canvas>` background gradient

---

### 11. TreemapView

**Purpose**: Canvas renderer — area proportional to hours, grouped by `groupName`. Read-only drill view.

**HTML tree** (as rendered via `<DemoCanvas>`):
```
<canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-grab" style={{ display: "block" }} onMouseMove={...} onMouseDown={...} onMouseLeave={...} onDoubleClick={...} />
```

**Tailwind classes**: `absolute`, `inset-0`, `w-full`, `h-full`, `cursor-grab`.

**Inline styles**: `{ display: "block" }`.

**Dynamic classes**: cursor swaps at runtime (`grab` → `grabbing` etc.) via `canvas.style.cursor`.

**Props received** (from `DemoCanvas`):
```ts
{
  renderer: treemapRenderer;
  tasks: DemoTask[];
  deps: DemoDependency[];
  options: RenderOptions;
  onHover, onClick, onLabelClick, onScroll, onMousePosition, onDragChange: callbacks;
  wheelContainerRef?: RefObject<HTMLElement>;
}
```

**Events emitted**: bubbled up from DemoCanvas — `onHover`, `onClick`, `onMousePosition`, `onDragChange`.

**Local state** (inside DemoCanvas): mode refs (idle/pan), dragTaskId, origStart, origEnd.

**Data-driven rendering** (TreemapRenderer):
- Filters: `status !== "group-header" && hours > 0 && startDate && endDate`
- Groups by `groupName`; `squarify` algorithm lays out rects
- Group background: `theme.altRowBg` rounded rect, label-height `22px` if `h > 50`
- Leaf rect fill: `colorMap[status] || "#6b7280"`; rounded radius 5
- Hover: white 2px stroke on hovered rect
- Label inside if `w > 50 && h > 28`: bold 10px task.name + 10px `${hours}h`
- Title (canvas top, centered): "Task Treemap — Area by Hours"

---

### 12. BubbleView

**Purpose**: Canvas renderer — x-axis = midpoint date, y-axis = group row, bubble size = √hours.

**HTML tree**: same canvas element as TreemapView (shared DemoCanvas host).

**Tailwind classes / inline styles / dynamic classes**: identical to TreemapView (DemoCanvas wrapper).

**Props received**: same as TreemapView; `renderer = bubbleRenderer`.

**Events emitted**: same.

**Local state**: same.

**Data-driven rendering** (BubbleRenderer):
- Layout: title height 40, label width 120, bottom padding 36
- Groups = distinct `task.groupName` list → one horizontal row per group
- `dateRange = maxDate - minDate || 1`
- Bubble radius = `max(sqrt(hours) * scaleFactor, 4)` where `scaleFactor = min(rowH * 0.35, 28) / sqrt(maxHours)`
- Today line: dashed (6,4), colour `theme.todayLine`, label "Today"
- Monthly x-axis labels along bottom
- Bubble fill: `colorMap[status] || "#6b7280"`, alpha 0.8, black shadow offset 1px
- Hover: white 2px stroke
- Label inside bubble if `r > 18`

---

### 13. CalendarView

**Purpose**: Canvas renderer — GitHub-style contribution heatmap of active-task count per day.

**HTML tree**: same canvas host via DemoCanvas.

**Props received**: same; `renderer = calendarRenderer`.

**Data-driven rendering** (CalendarRenderer):
- Extends `rangeStart` back to prior Sunday
- For each task: increments `dayCounts[d]` between parseDay(start)..parseDay(end)
- Cell grid: week-columns × 7-day-rows; cell size = `min(floor(availW/totalWeeks)-1, floor(availH/7)-1, 18)`
- Color scale (light): `["#ebedf0","#9be9a8","#40c463","#30a14e","#216e39"]`
- Color scale (dark): `["#161b22","#0e4429","#006d32","#26a641","#39d353"]`
- `colorForCount`: 0→[0], 1→[1], 2-3→[2], 4-6→[3], 7+→[4]
- Day labels on left: only M, W, F positions labeled
- Month labels along top; change-only when month differs from previous
- Today cell: 2px stroke in `theme.todayLine`
- Legend row at bottom: "Less" + 5 swatches + "More"

---

### 14. FlowView

**Purpose**: Canvas renderer — 5-stage funnel (Planning, Development, Testing, Review, Done) with per-stage bar chart and completion progress bar.

**HTML tree**: same canvas host.

**Props received**: same; `renderer = flowRenderer`.

**Data-driven rendering** (FlowRenderer):
- `STAGES = ["Planning","Development","Testing","Review","Done"]`
- Counts tasks per stage (via `task.status`); unknown statuses increment their own bucket but are not drawn
- Bar width = `min(chartW / STAGES.length * 0.55, 80)`
- Grid-line count labels (`gridSteps = 4`) on left axis
- Bar colour: `colorMap[stage] || "#6b7280"` (uses `COLOR_MAP` from theme.ts: Planning=indigo, Development=blue, Testing=purple, Review=amber, Done=green)
- Shadow: `rgba(0,0,0,0.08)` offset 2px
- Count text inside bar when `barH > 20`, else above bar in slate text
- Flow arrow between stages: colour `theme.depLine`, 1.5px stroke, arrowhead triangle
- Progress bar at bottom: width = `max(progW * pct, progressH)`; shows `Completion ... X% (done/total)`
- Inside-bar percentage label when `pct > 0.12`

---

### 15. ListView (AuditListView)

**Purpose**: Full-featured audit / triage list view — the "v6" experience embedded as a v5 view mode.

**HTML tree** (top level):
```
<div className="h-full w-full overflow-auto bg-slate-50 text-slate-900">
  <div className="bg-white border-b border-slate-200 shadow-sm">
    <div className="px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 mr-2">
        <span className="text-sm font-bold text-slate-900">Audit view</span>
        <span className="text-xs text-slate-400">·</span>
        <Link href="/mf/delivery-timeline-v6/help" className="text-xs text-blue-600 hover:text-blue-800 underline decoration-dotted">? Help</Link>
      </div>
      {/* KPI pills */}
      <div className="flex items-center gap-3 text-xs">
        <KpiPill label="items" value="..." color="slate" />
        <KpiPill label="sized" value="...h" color="slate" />
        <KpiPill label="needs attention" value="..." color={needs > 0 ? "amber" : "emerald"} />
        <KpiPill label="dupes" value="..." color={dupes > 0 ? "rose" : "emerald"} />
        <KpiPill label={`ready / ${total}`} value="..." color={readyColor} />
      </div>
      {/* Search */}
      <div className="flex-1 min-w-[200px] max-w-md ml-auto">
        <input type="search" placeholder="Search title / owner / mfRef / notes…" className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
      </div>
      {/* ...filter chips row, sort dropdown, export menu, submit pass, proposal mode toggle, verify against DH... */}
    </div>
  </div>
  {/* Bucket sections — each is a Droppable */}
  <DragDropContext onDragEnd={handleDragEnd}>
    {GROUP_ORDER.map(g => (
      <section key={g} className="mb-4">
        <Droppable droppableId={g}>
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {/* Bucket header */}
              {/* Bucket items via <Draggable> */}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </section>
    ))}
  </DragDropContext>
</div>
```

**Tailwind classes** (primary):
- outer: `h-full`, `w-full`, `overflow-auto`, `bg-slate-50`, `text-slate-900`
- header strip: `bg-white`, `border-b`, `border-slate-200`, `shadow-sm`
- strip inner: `px-4`, `py-3`, `flex`, `flex-wrap`, `items-center`, `gap-3`
- title: `text-sm`, `font-bold`, `text-slate-900`
- help link: `text-xs`, `text-blue-600`, `hover:text-blue-800`, `underline`, `decoration-dotted`
- KPI row: `flex`, `items-center`, `gap-3`, `text-xs`
- search input: `w-full`, `px-3`, `py-1.5`, `rounded-lg`, `border`, `border-slate-300`, `text-sm`, `focus:outline-none`, `focus:ring-2`, `focus:ring-blue-500`, `focus:border-transparent`

**Inline styles**: Bucket header uses `{ background: GROUP_BG_AUDIT[g], color: GROUP_COLORS[g] }` (soft pastel palette).

**Dynamic classes**:
- KpiPill colour variants: `slate | amber | emerald | rose` (rose for dupes > 0, amber for needsAttention > 0, etc.)
- Sort dropdown / filter chips: `isActive ? bg-blue-600 text-white : bg-white ...`

**Props received** (from `AuditListViewProps`):
```ts
{
  items: ProFormaItem[];
  isDirty: boolean;
  onUpdateItem: (id, changes) => void;
  onMoveToGroup: (id, newGroup) => void;
  onMergeDupes: (keepId, mergeId) => void;
  onAddItem: (item) => string;
  onDeleteItem: (id) => void;
  onGetOverrides: () => overrides;
  onResetAll: () => void;
}
```

**Events emitted**:
- `onDragEnd(result)` → `onMoveToGroup` when destination group differs from source
- Inline edits → `onUpdateItem(id, patch)`
- Merge dupes modal → `onMergeDupes(keepId, mergeId)`
- Add modal → `onAddItem(partial)`
- Delete button → `onDeleteItem(id)`
- Export menu → downloads JSON / CSV / Markdown via `toJson` / `toCsv` / `toMarkdown`
- Submit pass → POST `/api/pro-forma/submit` with `{ overrides, created, note }`
- Verify against DH → GET `/api/delivery-hub/work-items` then builds `Map<id, verified:boolean>`

**Local state**:
- `search: useState<string>("")`
- `filterChip: useState<FilterChip>("all")` — one of `all | needs-attention | no-mf-ref | no-mf-page | no-owner | no-dates | no-hours | dupes`
- `sortKey: useState<SortKey>("default")` — one of `default | hours-desc | hours-asc | owner | last-activity | audit-score`
- `expandedIds: useState<Set<string>>(new Set())`
- `collapsedBuckets: useState<Set<ProFormaGroup>>(new Set())`
- `editingId: useState<string | null>(null)`
- `mergeModal: useState<{ keepId, mergeId } | null>(null)`
- `addModalOpen: useState<boolean>(false)`
- `addBucket: useState<ProFormaGroup>("proposed")`
- `proposalMode: useState<boolean>(false)` — hides not-ready items
- `exportMenuOpen: useState<boolean>(false)`
- `dhVerified: useState<Map<string, boolean>>(new Map())`
- `dhVerifying: useState<boolean>(false)`
- `dhError: useState<string | null>(null)`
- `submitModalOpen: useState<boolean>(false)`
- `submitting: useState<boolean>(false)`
- `submitResult: useState<{ success, message, commitSha?, commitUrl? } | null>(null)`

**Data-driven rendering**:
- Five bucket sections rendered in `GROUP_ORDER`
- Each bucket uses `<Droppable droppableId={g}>` from `@hello-pangea/dnd`
- Items within a bucket sorted by `getSortFn(sortKey, audits)`
- Per-bucket roll-up stats: count, hours, logged, issues (computed post-filter)
- Dupe detection via `findDupeCandidates(items, 0.7)`
- Audit via `computeAuditScore(item, items)` — each item gets `issues[]` + `flags` + `score`
- Filter chips narrow by audit flags; search narrows by haystack of title/name/owner/mfRef/notes/status
- Export menu: 3 formats (JSON, CSV, Markdown) × 2 scopes (proposal-ready vs full)
- Intra-bucket reorder not wired yet — spec comment "lands when Glen asks for it"

---

## V8_INLINE_STYLES appendix

The entire `<style>{...}</style>` block from `DeliveryTimelineV5.tsx` lines 1598-1826, verbatim.

```css
/* Grid panel font matching v3 canvas renderer */
.ng-grid {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  font-size: 12px !important;
  color: #1f2937 !important;
  letter-spacing: -0.01em;
}
/* Ensure grid table has no border-spacing that could affect row alignment */
.ng-grid table {
  border-collapse: collapse !important;
  border-spacing: 0 !important;
}
.ng-grid-header {
  background: #f3f4f6 !important;
  visibility: hidden !important;
}
.ng-grid-th {
  font-size: 12px !important;
  font-weight: 700 !important;
  color: #1f2937 !important;
  padding: 0 6px !important;
}
/* Parent/group rows: bold like v3 (but not priority-group header rows) */
.ng-grid-row:not(.ng-group-row) .ng-tree-cell .ng-expand-icon + .ng-grid-cell-text {
  font-weight: 700 !important;
  color: #1f2937 !important;
}
/* Child rows (indented): lighter/muted like v3 canvas */
.ng-grid-row .ng-tree-cell .ng-expand-spacer + .ng-grid-cell-text {
  font-weight: 400 !important;
  color: #6b7280 !important;
  font-size: 11px !important;
}
.ng-grid-cell {
  padding-top: 0 !important;
  padding-right: 6px !important;
  padding-bottom: 0 !important;
  padding-left: 6px; /* no !important — JS depth-indent overrides this */
  line-height: 32px !important;
}
/* Zero out the spacer so ≡ aligns with ▶ at the same depth */
.ng-expand-spacer {
  width: 0 !important;
  min-width: 0 !important;
}
/* Expand arrow styling */
.ng-expand-icon {
  font-size: 9px !important;
  opacity: 0.5 !important;
  color: #6b7280 !important;
  width: 14px !important;
  min-width: 14px !important;
}
.ng-expand-icon:hover {
  opacity: 1 !important;
}
/* Row borders — use box-shadow instead of border to avoid layout shift */
.ng-grid-row {
  border: none !important;
  box-shadow: inset 0 -1px 0 #f3f4f6;
  box-sizing: border-box !important;
}
/* Leaf rows are draggable from anywhere */
.ng-grid-row:not(.ng-group-row) {
  cursor: grab;
}
.ng-grid-row:not(.ng-group-row):hover {
  background: rgba(59,130,246,0.04) !important;
  outline: 1px solid rgba(59,130,246,0.12) !important;
  outline-offset: -1px;
}
.ng-grid-row:not(.ng-group-row):active {
  cursor: grabbing;
}
.ng-grid-row td {
  border: none !important;
  box-sizing: border-box !important;
}
/* Remove cell right borders for cleaner look */
.ng-grid-cell {
  border-right: none !important;
}
.ng-grid-th {
  border-right: none !important;
}
/* Kill alternating row color — depth shading handles backgrounds.
   Use unset (not !important) so inline depth-shading can override. */
.ng-row-alt:not(.ng-group-row) {
  background: unset;
}
/* Keep the gantt canvas sticky so it stays in view on horizontal scroll.
   The nimbus-gantt library sets this at init (core.js:1332) but something
   can reset it; this !important ensures it's always honoured. */
.ng-scroll-content > canvas {
  position: sticky !important;
  left: 0 !important;
}
/* Belt-and-suspenders: hide any legacy stripe overlay div from cached
   old code that created a position:absolute div bleeding past canvas. */
[data-depth-stripes] {
  display: none !important;
}
/* Bucket header rows (NOW / NEXT / PLANNED / etc.)
   Strong background from GROUP_BG, white text, no top-accent border. */
.ng-group-row {
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.03em;
  box-sizing: border-box !important;
  box-shadow: none !important;
  color: #fff !important;
}
.ng-group-row .ng-grid-cell-text {
  font-weight: 700 !important;
  font-size: 12px !important;
  color: #fff !important;
  letter-spacing: 0.02em;
  color: inherit !important;
  text-transform: uppercase;
}
.ng-group-row .ng-expand-icon {
  color: inherit !important;
  opacity: 0.5 !important;
}
/* Hours/count column for group rows — full size, never truncate */
.ng-group-row .ng-grid-cell[data-field="hoursLabel"] {
  font-weight: 600 !important;
  font-size: 11px !important;
  color: inherit !important;
  opacity: 0.75;
  white-space: nowrap !important;
  overflow: visible !important;
  text-overflow: unset !important;
}
/* Hours column for child rows — monospace, muted, lighter weight */
.ng-grid-cell[data-field="hoursLabel"] {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 10px;
  color: #94a3b8;
  font-weight: 400;
}
/* Drag handle icon — always visible, like v3 sidebar */
.ng-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  opacity: 0.3;
  font-size: 11px;
  color: #94a3b8;
  vertical-align: middle;
  user-select: none;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-left: -5px !important;
  margin-right: 4px;
}
.ng-grid-row:hover .ng-drag-handle {
  opacity: 0.6;
  color: #64748b;
}
.ng-drag-handle:active {
  cursor: grabbing;
  opacity: 1;
}
/* Selected row — subtle highlight that doesn't clash with group bg colors */
.ng-row-selected:not(.ng-group-row) {
  background: rgba(59, 130, 246, 0.06) !important;
  box-shadow: inset 3px 0 0 #3b82f6 !important;
}
.ng-row-selected.ng-group-row {
  box-shadow: inset 0 2px 0 currentColor, inset 3px 0 0 currentColor, inset 0 -1px 0 #f3f4f6 !important;
}
/* Canvas cursor: let core.js hit-test control cursor via inline style */
/* Group row hours column inherits group color too */
.ng-group-row .ng-grid-cell[data-field="hoursLabel"] {
  color: inherit !important;
  opacity: 0.7;
}

/*
 * DEPTH-INDENTATION FIX — CSS !important beats the library's inline
 * padding-left (which has no !important).  We read the library's own
 * depth-indicator value (28 / 48 / 68 / 88 px) and map it to our compact
 * spacing so that:
 *   • Depth-0 parent ▼ caret aligns with the NOW/NEXT bucket ▼ caret (both at 8px)
 *   • Depth-1+ leaf ≡ hamburgers align with their sibling parent ▼ carets
 *
 * Formula: parent_padding(d) = 8 + d×10
 *          leaf_padding(d)   = max(0, 8 + d×10 − 10) = max(0, (d−1)×10 + 8 − 10)
 *   d=0 → parent: 8px ; leaf:  0px (hamburger at 10px)
 *   d=1 → parent: 18px; leaf:  8px (hamburger at 18px = parent caret ✓)
 *   d=2 → parent: 28px; leaf: 18px (hamburger at 28px = parent caret ✓)
 *   d=3 → parent: 38px; leaf: 28px (hamburger at 38px = parent caret ✓)
 *
 * Library depth→px map: depth 0→28px, 1→48px, 2→68px, 3→88px.
 * Selectors use :has() (Chrome 105+) to distinguish parent vs leaf rows.
 */

/* ── depth 0 (library sets 28px) ─────────────────────────────── */
/* Both parent (▶) and leaf (≡) align at same X — icon type is the distinction */
.ng-grid-row:not(.ng-group-row)
  .ng-tree-cell[style*="padding-left: 28px"] { padding-left: 8px  !important; }

/* ── depth 1 (library sets 48px) ─────────────────────────────── */
.ng-grid-row:not(.ng-group-row)
  .ng-tree-cell[style*="padding-left: 48px"] { padding-left: 18px !important; }

/* ── depth 2 (library sets 68px) ─────────────────────────────── */
.ng-grid-row:not(.ng-group-row)
  .ng-tree-cell[style*="padding-left: 68px"] { padding-left: 28px !important; }

/* ── depth 3 (library sets 88px) — future-proofing ───────────── */
/* ── depth 3 (library sets 88px) — future-proofing ──────────── */
.ng-grid-row:not(.ng-group-row)
  .ng-tree-cell[style*="padding-left: 88px"] { padding-left: 38px !important; }
/*
 * DEPTH-INDENT FALLBACK via CSS animation trick.
 * The JS chunk may be cached — this animation fires onAnimationStart which
 * the shading useEffect intercepts to re-apply correct indentation.
 * Animation name is deliberately unique so it only targets our container.
 */
@keyframes mf-depth-check { from { outline-color: transparent; } to { outline-color: transparent; } }
.ng-gantt-container {
  animation: mf-depth-check 0.001s linear 1 !important;
}
```
