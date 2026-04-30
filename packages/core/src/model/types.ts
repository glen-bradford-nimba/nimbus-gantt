// ─── Public Data Contracts ───────────────────────────────────────────────────
// These interfaces define the data shape consumers provide to NimbusGantt.
// Designed to map 1:1 with Delivery Hub's Apex DTOs (GanttTask, GanttDependency)
// while remaining generic enough for any project management tool.

export interface GanttTask {
  id: string;
  name: string;
  startDate: string;           // ISO YYYY-MM-DD
  endDate: string;             // ISO YYYY-MM-DD
  progress?: number;           // 0.0 - 1.0 (default 0)
  status?: string;             // Maps to colorMap key (e.g. "Planning", "Development")
  priority?: string;
  parentId?: string;           // Self-reference for tree hierarchy (primary/rendering parent)
  additionalParentIds?: string[]; // DAG: extra logical parents (e.g. item belongs to multiple proposals). Does NOT affect tree rendering — only logical rollups, dependency edges, and scheduler input. Hour rollups must dedupe shared descendants across parents.
  groupId?: string;            // Swimlane grouping (e.g. entity/client ID)
  groupName?: string;          // Display name for the group
  assignee?: string;           // Developer/owner display name
  sortOrder?: number;          // Manual ordering within parent
  isMilestone?: boolean;       // Zero-duration diamond marker
  isCompleted?: boolean;
  color?: string;              // Override color (hex)
  metadata?: Record<string, unknown>;
  // ── Group-header styling fields ─────────────────────────────────────
  // Consumed by the core renderer when status === "group-header". Used by
  // PriorityGroupingPlugin for the NOW/NEXT/PLANNED/PROPOSED/HOLD bucket
  // headers. Kept optional so regular tasks never need to populate them.
  groupBg?: string;            // Row background tint for the group header
  groupColor?: string;         // Border + text color for the group header
  hours?: number;              // Total hours rolled up (header rows only)
  hoursLabel?: string;         // Pre-formatted count · hours label
  title?: string;              // Display title override (distinct from `name`)
  // ── Per-row visual decorators ───────────────────────────────────────
  // Composable styling overlays driven by host data. Renderer applies
  // them on top of the existing bar fill. Ignored when status ===
  // "group-header" (PriorityGroupingPlugin uses its own legacy fields).
  style?: GanttRowDecorators;
}

export type DecoratorBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
export type DecoratorBorderWidth = 1 | 2 | 3;
export type DecoratorFillStyle = 'solid' | 'muted' | 'hatched' | 'gradient';
export type DecoratorBadgePlacement = 'start' | 'end';

export interface GanttRowDecoratorBadge {
  text: string;
  placement?: DecoratorBadgePlacement;  // Default: 'end'
  color?: string;                       // CSS color, default: derived from bar fill
}

export interface GanttRowDecorators {
  // Bar outline
  borderStyle?: DecoratorBorderStyle;
  borderWidth?: DecoratorBorderWidth;
  borderColor?: string;
  // Bar interior — 'hatched' and 'gradient' are reserved values; renderer
  // falls back to 'solid' until those are implemented in a follow-up.
  fillStyle?: DecoratorFillStyle;
  fillOpacity?: number;                 // 0–1, default 1
  // Optional inline label decoration
  badge?: GanttRowDecoratorBadge;
  // Tooltip override (host-tooltip plumbing already covers full custom HTML)
  styleNote?: string;
}

export interface GanttDependency {
  id: string;
  source: string;              // ID of the blocking (predecessor) task
  target: string;              // ID of the blocked (successor) task
  type?: DependencyType;       // Default: 'FS'
  lag?: number;                // Days offset (positive = delay, negative = lead)
}

export type DependencyType = 'FS' | 'FF' | 'SS' | 'SF';

export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

// ─── Remote Events ──────────────────────────────────────────────────────────
// Host-pumped server→client event channel (0.185.37+). Hosts subscribe to
// their platform-native push transport (Salesforce Platform Events via
// lightning/empApi, CN SSE/websocket, etc.), translate each message into a
// RemoteEvent, and call handle.pushRemoteEvent(event). NG applies per-row
// merge semantics — no full re-layout, scroll/selection/expansion preserved.
//
// See docs/dispatch-ng-remote-events.md for the full design including
// sequence-based stale-drop, clientNonce self-echo pattern, three-mode
// reconnect contract, and the 0.185.38–39 ship arc (deps + middleware).
//
// 0.185.37 ships the skeleton: task.upsert (per-field patch), task.delete,
// bulk.replace. ts-only stale-drop. Per-channel keying. No sequence,
// no onRemoteEvent middleware, no host.custom, no dep.* yet.

/** Partial task with required `id` for per-field merge on remote upsert. */
export type TaskPatch = Partial<GanttTask> & { id: string };

export type RemoteEvent =
  | {
      kind: 'task.upsert';
      version: 1;
      tasks: TaskPatch[];
      ts?: number;
      channel?: string;
      source?: string;
    }
  | {
      kind: 'task.delete';
      version: 1;
      ids: string[];
      ts?: number;
      channel?: string;
      source?: string;
    }
  | {
      kind: 'bulk.replace';
      version: 1;
      tasks: GanttTask[];
      deps?: GanttDependency[];
      ts?: number;
      channel?: string;
      source?: string;
    };

// ─── Column Configuration ───────────────────────────────────────────────────

export interface ColumnConfig {
  field: string;               // Key in GanttTask or metadata
  header: string;              // Column header text
  width?: number;              // Pixel width (default 120)
  minWidth?: number;
  tree?: boolean;              // If true, this column renders the expand/collapse tree
  align?: 'left' | 'center' | 'right';
  renderer?: (task: GanttTask, field: string) => string; // Custom cell content
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface GanttConfig {
  // Data
  tasks: GanttTask[];
  dependencies?: GanttDependency[];

  // Layout
  columns?: ColumnConfig[];
  zoomLevel?: ZoomLevel;
  rowHeight?: number;          // Default 36
  barHeight?: number;          // Default 24
  headerHeight?: number;       // Default 56
  gridWidth?: number;          // Default 300; 0 hides the tree grid
  minBarWidth?: number;        // Default 8 (minimum rendered bar width in px)

  // Behavior
  readOnly?: boolean;
  fitToView?: boolean;         // Auto-compute date range to fit all tasks
  showToday?: boolean;         // Default true
  showWeekends?: boolean;      // Shade weekend columns. Default true
  showProgress?: boolean;      // Render progress fill inside bars. Default true
  snapToDays?: boolean;        // Snap drag to day boundaries. Default true

  // Appearance
  colorMap?: Record<string, string>;   // status → hex color
  theme?: 'light' | 'dark' | ThemeConfig;

  // Callbacks — all optional, async-friendly
  onTaskClick?: (task: GanttTask) => void;
  onTaskDblClick?: (task: GanttTask) => void;
  /** Fires on every canvas pointermove that hits a bar — task is null when
   *  the cursor leaves all bars. Internally used by the engine's own
   *  tooltipManager; consumers can opt-in for their own hover UX. */
  onHover?: (task: GanttTask | null, x: number, y: number, color?: string) => void;
  onTaskMove?: (task: GanttTask, startDate: string, endDate: string) => void | Promise<void>;
  onTaskResize?: (task: GanttTask, startDate: string, endDate: string) => void | Promise<void>;
  onTaskProgressChange?: (task: GanttTask, progress: number) => void | Promise<void>;
  /** 0.185.16 — getter for canvas bar vertical-drag reprioritize. When
   *  this returns true AND onBarReorderDrag is wired, a vertical-dominant
   *  drag of a bar body commits a reorder (onBarReorderDrag callback)
   *  instead of a date move (onTaskMove callback). Default: off. */
  isBarReprioritizeEnabled?: () => boolean;
  /** 0.185.16 — canvas bar reorder commit. Fires when the vertical-drag
   *  gesture lands on a different row than the drag started on. Host
   *  resolves the target row to newIndex/newPriorityGroup and forwards
   *  via its own onItemReorder chain. targetTaskId is null when the
   *  drop lands below the last row in the list. */
  onBarReorderDrag?: (task: GanttTask, targetTaskId: string | null, targetRowIndex: number, targetBucketId?: string | null) => void | Promise<void>;
  onDependencyCreate?: (source: string, target: string, type: DependencyType) => void | Promise<void>;
  onDependencyClick?: (dep: GanttDependency) => void;
  onViewChange?: (zoomLevel: ZoomLevel, startDate: string, endDate: string) => void;
  onTaskSelect?: (taskIds: string[]) => void;

  // Tooltip
  tooltipRenderer?: (task: GanttTask) => string | HTMLElement;
}

// ─── Theme Configuration ────────────────────────────────────────────────────

export interface ThemeConfig {
  // Timeline
  timelineBg?: string;
  timelineGridColor?: string;
  timelineHeaderBg?: string;
  timelineHeaderText?: string;
  timelineWeekendBg?: string;
  todayLineColor?: string;
  todayBg?: string;

  // Bars
  barDefaultColor?: string;
  barBorderRadius?: number;
  barProgressOpacity?: number;
  barTextColor?: string;
  barSelectedBorder?: string;

  // Tree grid
  gridBg?: string;
  gridAltRowBg?: string;
  gridBorderColor?: string;
  gridTextColor?: string;
  gridHeaderBg?: string;
  gridHeaderText?: string;
  gridHoverBg?: string;

  // Dependencies
  dependencyColor?: string;
  dependencyWidth?: number;
  criticalPathColor?: string;

  // General
  fontFamily?: string;
  fontSize?: number;
  selectionColor?: string;
}

// ─── Internal State ─────────────────────────────────────────────────────────

export interface TaskTreeNode {
  task: GanttTask;
  children: TaskTreeNode[];
  depth: number;
  expanded: boolean;
  visible: boolean;            // Visible in current tree state (parent expanded)
  rowIndex: number;            // Position in the flattened visible list
}

export interface TaskLayout {
  taskId: string;
  rowIndex: number;
  x: number;                  // Pixel x position (timeline)
  y: number;                  // Pixel y position
  width: number;              // Bar width in pixels
  barY: number;               // Y offset of the bar within the row
  barHeight: number;
  progressWidth: number;      // Width of progress fill
  color: string;
  textColor: string;
  label: string;              // Text rendered inside/beside the bar
  isMilestone: boolean;
}

export interface HeaderCell {
  label: string;
  x: number;
  width: number;
  date: Date;
}

export interface GanttState {
  tasks: Map<string, GanttTask>;
  dependencies: Map<string, GanttDependency>;
  tree: TaskTreeNode[];
  flatVisibleIds: string[];    // Flattened task IDs respecting expand/collapse
  expandedIds: Set<string>;
  selectedIds: Set<string>;
  zoomLevel: ZoomLevel;
  scrollX: number;
  scrollY: number;
  dateRange: { start: Date; end: Date };
  dragState: DragState | null;
  config: ResolvedConfig;
  /** 0.187.0 — temporal-canvas time cursor. null = live (default). When
   *  set to a Date, `gantt.getDisplayState()` resolves the visible state
   *  through the installed HistoryPlugin's replay rather than from the
   *  live store. View-only field; HistoryPlugin owns lifecycle. */
  timeCursorDate?: Date | null;
}

export interface DragState {
  type: 'move' | 'resize-left' | 'resize-right' | 'progress' | 'link';
  taskId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  originalStartDate: string;
  originalEndDate: string;
  previewStartDate?: string;
  previewEndDate?: string;
}

// ─── Resolved Config (defaults applied) ─────────────────────────────────────

export interface ResolvedConfig {
  columns: ColumnConfig[];
  zoomLevel: ZoomLevel;
  rowHeight: number;
  barHeight: number;
  headerHeight: number;
  gridWidth: number;
  minBarWidth: number;
  readOnly: boolean;
  fitToView: boolean;
  showToday: boolean;
  showWeekends: boolean;
  showProgress: boolean;
  snapToDays: boolean;
  colorMap: Record<string, string>;
  theme: ResolvedTheme;
}

export interface ResolvedTheme {
  timelineBg: string;
  timelineGridColor: string;
  timelineHeaderBg: string;
  timelineHeaderText: string;
  timelineWeekendBg: string;
  todayLineColor: string;
  todayBg: string;
  barDefaultColor: string;
  barBorderRadius: number;
  barProgressOpacity: number;
  barTextColor: string;
  barSelectedBorder: string;
  gridBg: string;
  gridAltRowBg: string;
  gridBorderColor: string;
  gridTextColor: string;
  gridHeaderBg: string;
  gridHeaderText: string;
  gridHoverBg: string;
  dependencyColor: string;
  dependencyWidth: number;
  criticalPathColor: string;
  fontFamily: string;
  fontSize: number;
  selectionColor: string;
}

// ─── Actions ────────────────────────────────────────────────────────────────

export type Action =
  | { type: 'SET_DATA'; tasks: GanttTask[]; dependencies?: GanttDependency[] }
  | { type: 'UPDATE_TASK'; taskId: string; changes: Partial<GanttTask> }
  | { type: 'ADD_TASK'; task: GanttTask }
  | { type: 'REMOVE_TASK'; taskId: string }
  | { type: 'TOGGLE_EXPAND'; taskId: string }
  | { type: 'EXPAND_ALL' }
  | { type: 'COLLAPSE_ALL' }
  | { type: 'SET_ZOOM'; level: ZoomLevel }
  | { type: 'SET_SCROLL'; x: number; y: number }
  | { type: 'SET_SCROLL_X'; x: number }
  | { type: 'SET_SCROLL_Y'; y: number }
  | { type: 'SELECT_TASK'; taskId: string; multi?: boolean }
  | { type: 'DESELECT_ALL' }
  | { type: 'DRAG_START'; drag: DragState }
  | { type: 'DRAG_UPDATE'; currentX: number; currentY: number }
  | { type: 'DRAG_END' }
  | { type: 'DRAG_CANCEL' }
  | { type: 'TASK_MOVE'; taskId: string; startDate: string; endDate: string }
  | { type: 'TASK_RESIZE'; taskId: string; startDate: string; endDate: string }
  | { type: 'ADD_DEPENDENCY'; dependency: GanttDependency }
  | { type: 'REMOVE_DEPENDENCY'; dependencyId: string }
  | { type: 'SET_DATE_RANGE'; start: Date; end: Date }
  | { type: 'SET_TIME_CURSOR'; date: Date | null };

// ─── Agent API (0.187.0) ────────────────────────────────────────────────
// Programmatic surface for LLMs / external controllers to drive the gantt
// without DOM events. Every method is JSON-serializable I/O so the API
// works over MCP / WebSocket / HTTP without custom marshaling.

/** JSON-serializable snapshot of gantt state at the current cursor. */
export interface AgentSnapshot {
  /** Current time cursor as ISO date string, or null when live. */
  cursorDate: string | null;
  zoomLevel: ZoomLevel;
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  selectedIds: string[];
  expandedIds: string[];
  flatVisibleIds: string[];
}

export interface AgentHistoryEntry {
  ts: number;
  wallTs: number;
  actionType: string;
  source?: string;
  actor?: string;
}

export interface AgentHistoryView {
  entries: AgentHistoryEntry[];
  annotations: Array<{
    ts: number;
    wallTs: number;
    kind: string;
    taskId?: string;
    payload?: unknown;
  }>;
  lastWallTs: number | null;
}

export interface AgentAPI {
  getSnapshot(): AgentSnapshot;
  updateTask(taskId: string, changes: Partial<GanttTask>): void;
  addTask(task: GanttTask): void;
  removeTask(taskId: string): void;
  moveTask(taskId: string, startDate: string, endDate: string): void;
  addDependency(dep: GanttDependency): void;
  removeDependency(dependencyId: string): void;
  setSelection(taskIds: string[]): void;
  setZoom(level: ZoomLevel): void;
  /** Scrub the time cursor. Pass an ISO string to scrub to a past
   *  moment, or null to return to live mode. */
  scrubTo(date: string | null): void;
  /** Returns a JSON-friendly view of the history log + annotations,
   *  or null if HistoryPlugin isn't installed. */
  history(): AgentHistoryView | null;
  /** Append an annotation (comment / decision / agent-note). Returns
   *  false when HistoryPlugin isn't installed. */
  appendAnnotation(kind: string, taskId?: string, payload?: unknown): boolean;
}

// ─── Context Menu Zones (0.189.0) ────────────────────────────────────────────
// gantt.hitTestAt(clientX, clientY) classifies the pixel into one of these
// zones. Hosts wire onContextMenu(hit, pos) and either return a MenuItem[]
// for NG to render, or void to render their own menu.
//
// Zones are mutually exclusive — first match wins, in priority order:
//   bar > row-label > date-header > bucket-header > canvas-empty >
//   below-rows > gap-between-rows > outside.

export type ZoneHit =
  | {
      zone: 'bar';
      task: GanttTask;
      rowIndex: number;
      /** If hit is on the dragable bar interior, edge resize handle, etc. */
      barType: 'body' | 'left-edge' | 'right-edge' | 'progress-handle';
    }
  | {
      zone: 'row-label';
      task: GanttTask;
      rowIndex: number;
    }
  | {
      zone: 'date-header';
      date: Date;
      /** Which row of the multi-row header was hit (top row = primary
       *  zoom level; lower rows = nested smaller intervals). */
      level: 'day' | 'week' | 'month' | 'quarter' | 'year';
    }
  | {
      zone: 'bucket-header';
      /** The header task itself (rendered with status='group-header' by
       *  PriorityGroupingPlugin). */
      bucketTask: GanttTask;
      /** Resolved bucket id from the header task's groupId, if available. */
      bucketId: string | null;
      rowIndex: number;
    }
  | {
      zone: 'canvas-empty';
      /** The date corresponding to the pixel x. */
      date: Date;
      /** The row index under the cursor (within current scroll), or null if
       *  below the last row. */
      rowIndex: number;
      /** The task in that row, if any. Lets host prefill parentId for
       *  "create work item here" when dropping below an existing parent. */
      nearestTask: GanttTask | null;
      /** Inferred bucket from the row (walks up the tree to the nearest
       *  group-header ancestor). null when no bucket grouping is active. */
      bucketId: string | null;
    }
  | {
      zone: 'below-rows';
      date: Date;
    }
  | {
      zone: 'dependency';
      depId: string;
    }
  | {
      zone: 'outside';
    };

/** A single context-menu entry. Host returns an array of these from
 *  onContextMenu; NG renders them. */
export interface ContextMenuItem {
  /** Unique within the menu. Used as React-style key + identifier in
   *  diag emitters. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional submenu — hover/click expands. */
  children?: ContextMenuItem[];
  /** Fires when item is clicked (no submenu) or when a leaf submenu
   *  item is clicked. Closes the menu after firing. */
  onClick?: () => void | Promise<void>;
  /** Disable the item — renders muted, doesn't fire onClick. */
  disabled?: boolean;
  /** Optional icon — single character or short string rendered before
   *  the label (e.g. '✓', '✦', '×'). */
  icon?: string;
  /** Render a horizontal divider before this item. */
  divider?: boolean;
  /** Mark this item as agent-suggested. NG renders with a ✦ glyph and
   *  routes clicks through onAgentRequest instead of onClick when set. */
  agentSuggested?: boolean;
  /** Prompt text passed to onAgentRequest for agent-suggested items. */
  prompt?: string;
  /** Optional keyboard shortcut hint (display-only — host wires the
   *  actual binding). */
  shortcut?: string;
}

/** Page-relative position where the menu should anchor. */
export interface ContextMenuPos {
  x: number;
  y: number;
}

/** Payload for the agent-request callback. The host calls Claude
 *  (or any LLM) with this context and resolves either by mutating
 *  state via the agent API, returning a string for a toast/notice,
 *  or by appending an annotation. */
export interface AgentMenuRequest {
  hit: ZoneHit;
  pos: ContextMenuPos;
  prompt: string;
  /** A snapshot of the gantt at request time — same shape as
   *  AgentAPI.getSnapshot(). Hosts pass this to the LLM as context. */
  snapshot: AgentSnapshot;
}

// ─── Plugin Interface ───────────────────────────────────────────────────────

export interface NimbusGanttPlugin {
  name: string;
  install(gantt: PluginHost): void;
  middleware?: (action: Action, next: (action: Action) => void) => void;
  renderCanvas?: (ctx: CanvasRenderingContext2D, state: GanttState, layouts: TaskLayout[]) => void;
  renderDOM?: (container: HTMLElement, state: GanttState) => void;
  destroy?: () => void;
}

export interface PluginHost {
  getState(): GanttState;
  dispatch(action: Action): void;
  on(event: string, handler: (...args: unknown[]) => void): () => void;
  getLayouts(): TaskLayout[];
  getTimeScale(): TimeScaleAPI;
  /**
   * Rebuild state.tree and state.flatVisibleIds from the current
   * state.tasks + state.expandedIds. Plugins that inject synthetic
   * tasks into state.tasks (e.g. PriorityGroupingPlugin's bucket
   * headers) MUST call this after mutating the tasks Map so the grid
   * (which renders from state.tree) stays in sync with the canvas
   * (which renders from state.flatVisibleIds via computed layouts).
   *
   * Without this call, any task added by a plugin middleware after the
   * reducer runs is invisible to the DomTreeGrid — the tree was already
   * built by the reducer before the plugin had a chance to mutate state.
   */
  rebuildTree(): void;
}

export interface TimeScaleAPI {
  dateToX(date: Date): number;
  xToDate(x: number): Date;
  getColumnWidth(): number;
}

// ─── Event Types ────────────────────────────────────────────────────────────

export type GanttEventType =
  | 'stateChange'
  | 'taskClick'
  | 'taskDblClick'
  | 'taskMove'
  | 'taskResize'
  | 'taskSelect'
  | 'taskProgressChange'
  | 'dependencyCreate'
  | 'dependencyClick'
  | 'viewChange'
  | 'scroll'
  | 'render';
