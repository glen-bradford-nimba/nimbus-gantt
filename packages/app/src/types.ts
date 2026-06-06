export interface PriorityBucket {
  id: string;
  label: string;
  color: string;
  bgTint: string;
  order: number;
}

/**
 * 0.185.15 — FieldDescriptor. Host-provided spec for a single row in the
 * DetailPanel's edit surface. `key` matches the property on NormalizedTask
 * (e.g. 'startDate', 'stage', 'estimatedHours'); `type` picks the widget
 * rendered; `options` populates picklist choices; `readOnly` shows the
 * value without an editable input even when the panel is in edit mode.
 * The panel emits onItemEdit(taskId, changes) with only the keys whose
 * drafts differ from the task's current value, so partial schemas (e.g.
 * date-only) still produce minimal patches.
 */
export interface FieldDescriptor {
  /** Property name on NormalizedTask, or a custom key host adapters map.
   *  Common values: 'startDate', 'endDate', 'title', 'stage',
   *  'priorityGroup', 'estimatedHours', 'loggedHours', 'description',
   *  'acceptance', 'assignee'. Host decides how to persist keys that
   *  don't map 1:1 to the NormalizedTask shape (via onItemEdit routing). */
  key: string;
  /** Human-readable label displayed above the input. */
  label: string;
  /** Widget type. `lookup` is reserved for future autocomplete widget; in
   *  0.185.15 it renders as a plain text input. */
  type: 'text' | 'date' | 'number' | 'textarea' | 'picklist' | 'lookup';
  /** Options for picklist type. Ignored for other types. */
  options?: string[];
  /** When true, render the value but don't let the user edit it even in
   *  edit mode. Useful for identifiers or computed fields surfaced for
   *  context (e.g. record ID chip). */
  readOnly?: boolean;
  /** Optional min/max for number type. */
  min?: number;
  max?: number;
  /** Optional placeholder text for text/textarea/number inputs. */
  placeholder?: string;
}

export interface NormalizedTask {
  id: string;
  title: string;
  name?: string;
  priorityGroup?: string | null;
  parentWorkItemId?: string | null;
  /** DAG: additional logical parents beyond parentWorkItemId. When a work
   *  item belongs to multiple proposals/groupings, list extra parent IDs
   *  here. Rendering tree uses parentWorkItemId only; rollups and scheduler
   *  constraints honor the full parent set. */
  additionalParentIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  estimatedHours?: number;
  /** Lower bound of estimate envelope (matches v8 hoursLow field). When absent, same as estimatedHours. */
  estimatedHoursLow?: number;
  loggedHours?: number;
  stage?: string;
  sortOrder?: number;
  isInactive?: boolean;
  developerName?: string;
  entityName?: string;
  [key: string]: unknown;
}

export interface TaskPatch {
  id: string;
  startDate?: string;
  endDate?: string;
  parentId?: string | null;
  priorityGroup?: string;
  sortOrder?: number;
  /** Dependency edges — full replacement list (not delta). When provided the
   *  consumer replaces the task's `dependencies` array wholesale. */
  dependencies?: string[];
  /** 0.185.35 — positional semantics emitted alongside sortOrder on drag-
   *  reorder patches. Hosts that want server-side dense numbering
   *  (e.g., keep sortOrder 1..N after every drag, no accumulating
   *  negatives from fractional-midpoint math) resolve position +
   *  beforeTaskId/afterTaskId to real values in Apex and ignore
   *  sortOrder. Hosts that want the current numeric contract ignore
   *  these fields and write sortOrder directly. */
  position?: 'above-all' | 'below-all' | 'between';
  /** Task ID the dragged row would land IMMEDIATELY BEFORE in its
   *  target bucket (null when `position === 'below-all'` — dropped
   *  below the bottommost row). */
  beforeTaskId?: string | null;
  /** Task ID the dragged row would land IMMEDIATELY AFTER in its
   *  target bucket (null when `position === 'above-all'` — dropped
   *  above the topmost row). */
  afterTaskId?: string | null;
}

/** Screen-space coordinates for right-click / context menu UX. */
export interface ScreenPos {
  x: number;
  y: number;
}

/**
 * 0.185.27 — dependency edge between two tasks. Mirrors core's
 * GanttDependency shape exactly; duplicated here so the app layer
 * stays free of core imports (core is window.NimbusGantt at IIFE
 * runtime, not a bundler-resolved package).
 *
 * `source` is the predecessor (blocking) task; `target` is the
 * successor (blocked) task. `type` defaults to 'FS' (finish-to-start);
 * `lag` is days offset — positive delays, negative leads.
 *
 * DH Apex DTO field name is `dependencyType`, not `type`. Host adapters
 * must map before passing (see dispatch-dh-dependencies-wire.md).
 */
export interface GanttDependency {
  id: string;
  source: string;
  target: string;
  type?: 'FS' | 'FF' | 'SS' | 'SF';
  lag?: number;
}

/**
 * 0.185.26 — host-supplied button rendered in the TitleBar's right cluster,
 * immediately before the Full Screen button. Lets hosts (e.g. DH) surface
 * chrome-level affordances (show-header toggle, etc.) without NG owning the
 * label or the behavior. Zero-length array = invisible; no flag needed.
 *
 * `pressed` reflects toggle state — rendered with the same "active"
 * visual as the existing toggle pills (Audit, Hrs/Wk). Hosts flip it by
 * calling `handle.setTitleBarButtons(newButtons)` after their state changes.
 */
export interface TitleBarButton {
  /** Stable identifier for keying; must be unique within the array. */
  id: string;
  /** Displayed text. */
  label: string;
  /** Click handler. Library does not prescribe behavior. */
  onClick: () => void;
  /** Optional toggle-pressed visual state. Default false. */
  pressed?: boolean;
  /** Optional tooltip. */
  title?: string;
}

/** Origin of a task click — canvas bar vs grid row. v5 used this to decide
 *  whether to open the detail panel (canvas) or just highlight (grid). */
export type TaskClickSource = 'canvas' | 'grid';

export interface AppConfig {
  title?: string;
  version?: string;
  buckets: PriorityBucket[];
  colorMap?: Record<string, string>;
  features?: {
    statsPanel?: boolean;
    listView?: boolean;
    treemapView?: boolean;
    bubbleView?: boolean;
    depthShading?: boolean;
    dragReparent?: boolean;
    detailPanel?: boolean;
    groupByToggle?: boolean;
  };
}

/** Optional pre-resolved engine — lets bundler consumers (e.g. Next.js) pass
 *  NimbusGantt constructors directly rather than relying on window.NimbusGantt.
 *  If omitted, IIFEApp falls back to window.NimbusGantt as before (IIFE / SF). */
export interface NimbusGanttEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  NimbusGantt: new (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PriorityGroupingPlugin?: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hoursWeightedProgress?: (...args: any[]) => any;
  // 0.186.0 — temporal canvas plugins
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TemporalAsymmetryPlugin?: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HistoryPlugin?: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TimeCursorPlugin?: (...args: any[]) => any;
  // 0.189.0 — context-menu plugin (zone-aware right-click)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ContextMenuPlugin?: (...args: any[]) => any;
  // 0.191.0 — annotation strip + baseline ghost-bars
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HistoryStripPlugin?: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BaselinePlugin?: (...args: any[]) => any;
  // 0.192.0 — constraint-based scheduler (auto-installed dormant)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AutoSchedulePlugin?: (...args: any[]) => any;
}

/** Render mode — controls which chrome slots are rendered.
 *  'fullscreen' (default) = full toolbar + all template chrome (TitleBar,
 *  Stats, FilterBar, ZoomBar, Sidebar, DetailPanel, AuditPanel, HrsWkStrip).
 *  'embedded'             = ContentArea only + a single floating "↗ Full
 *  Screen" button top-right. All other chrome suppressed.
 *
 *  Hosts (e.g. Salesforce LWC) pass `mode` based on the Lightning app page
 *  they mount in. The library emits `onEnterFullscreen` / `onExitFullscreen`
 *  callbacks so the host owns navigation — nimbus-gantt does NOT hardcode
 *  any Salesforce URLs. */
export type AppMode = 'embedded' | 'fullscreen';

/** 0.196 — a team capacity entry (matches the template's CLOUD_NIMBUS_POOL
 *  shape). DH supplies these from Salesforce users / network entities. */
export interface TeamMember {
  name: string;
  role?: string;
  hoursPerMonth: number;
  active?: boolean;
}

/** 0.196.1 — one proposed Auto-Schedule date change, for review-before-commit.
 *  `startDate`/`endDate` are the NEW (proposed) dates; `previousStartDate`/
 *  `previousEndDate` are the current values, for the review diff. */
export interface AutoScheduleChange {
  id: string;
  name?: string;
  startDate: string;
  endDate: string;
  previousStartDate?: string;
  previousEndDate?: string;
}

export interface MountOptions {
  tasks: NormalizedTask[];
  /** 0.185.27 — initial dependency edges rendered as arrows between bars.
   *  The app layer previously stubbed dependencies:[] at both engine-init
   *  sites; this re-exposes the pipe so hosts (DH via
   *  `getGanttDependencies` Apex) can pass them through. Runtime updates
   *  via `handle.setData(tasks, dependencies)`. Omit or pass [] for no
   *  dependency rendering (legacy behavior). */
  dependencies?: GanttDependency[];
  onPatch: (patch: TaskPatch) => Promise<void> | void;
  config?: Partial<AppConfig>;
  /** Pre-resolved engine — bypasses window.NimbusGantt lookup when provided. */
  engine?: NimbusGanttEngine;
  /** Render mode — default 'fullscreen'. See AppMode. */
  mode?: AppMode;
  /** Fired when the user clicks the embedded-mode "↗ Full Screen" button.
   *  Host (LWC) should navigate to the full-screen Lightning app page. */
  onEnterFullscreen?: () => void;
  /** Fired when the user clicks the fullscreen-mode "← Exit Full Screen"
   *  button. Host (LWC) should navigate back to the embedded tab. */
  onExitFullscreen?: () => void;
  /** Optional URL to the template stylesheet. When set, the library fetches
   *  this URL and injects it inside the container (Strategy C — pierces
   *  Salesforce synthetic shadow DOM). Overrides the template's own
   *  stylesheet.url. Typical use: the LWC passes a static-resource URL. */
  cssUrl?: string;
  /** 0.186.0 — temporal-asymmetry rendering (past concrete, future ghosty).
   *  Default ON. Pass `false` to disable, or an options object to customize
   *  fade strength, dash pattern, checkmark behavior, etc. See
   *  TemporalAsymmetryOptions in @nimbus-gantt/core. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  temporalAsymmetry?: false | Record<string, any>;
  /** 0.189.0 — zone-aware right-click context menu. Default ON. Pass
   *  `false` to disable, or a ContextMenuOptions object to wire host
   *  callbacks (onContextMenu / onCreateTask / onTaskAction /
   *  onDateAction / onAgentRequest). See ContextMenuOptions in
   *  @nimbus-gantt/core. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contextMenu?: false | Record<string, any>;
  /** 0.191.0 — append-only history substrate enabling scrubbable replay
   *  + cross-client convergence. Default ON. Pass `false` to disable,
   *  or a HistoryOptions object to tune the ring-buffer size /
   *  compaction interval. Substrate for TimeCursorPlugin +
   *  HistoryStripPlugin. See HistoryOptions in @nimbus-gantt/core. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history?: false | Record<string, any>;
  /** 0.191.0 — DAW-style playhead at state.timeCursorDate plus a "NOW"
   *  bracket marker. Default ON. Pass `false` to disable, or a
   *  TimeCursorOptions object to tune cursor color / NOW bracket /
   *  keyboard shortcuts (Home/End/arrows). Requires history. See
   *  TimeCursorOptions in @nimbus-gantt/core. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  timeCursor?: false | Record<string, any>;
  /** 0.191.0 — annotation-marker strip above the timeline header.
   *  Default ON; bails entirely when history has zero annotations
   *  (zero visual cost when no host or plugin has called
   *  gantt.history.annotate). Pass `false` to disable, or a
   *  HistoryStripOptions object to tune position / marker colors /
   *  strip height. Requires history. See HistoryStripOptions in
   *  @nimbus-gantt/core. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  historyStrip?: false | Record<string, any>;
  /** 0.191.0 — translucent baseline ghost-bar overlay for planned-vs-
   *  actual schedule comparison. Default OFF (opt-in with data). Pass
   *  an array of `{ id, startDate, endDate }` entries, a full
   *  BaselinePluginOptions object, or omit / `false` to skip. See
   *  BaselinePluginOptions in @nimbus-gantt/core. */
  baseline?:
    | false
    | Array<{ id: string; startDate: string; endDate: string }>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | Record<string, any>;
  /** 0.192.0 — constraint-based scheduler (forward/backward pass over
   *  the dependency DAG, all 8 MS Project constraint types). Default
   *  ON but DORMANT (`autoRun: false`) — installs the plugin so hosts
   *  can fire `gantt.events.emit('autoSchedule:run', cb)` from a
   *  button, but the middleware does NOT silently mutate dates on
   *  every ADD_DEPENDENCY / REMOVE_DEPENDENCY. Pass `false` to skip
   *  install entirely. Pass an `AutoScheduleOptions` object to
   *  override (e.g. `{ respectWorkCalendar: true }`); the auto-
   *  install always sets `autoRun: false` unless the override
   *  explicitly sets it true. See AutoScheduleOptions in
   *  @nimbus-gantt/core. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoSchedule?: false | true | Record<string, any>;
  /** 0.192.0 — hours→duration bridge. When set, NG derives each
   *  task's `endDate` from `startDate + ceil(estimatedHours /
   *  hoursPerDay)` working calendar days at the IIFE app boundary.
   *  Applies to tasks where both `startDate` and `estimatedHours`
   *  are present; leaves all other tasks untouched. Pulls the
   *  hours→duration math out of host Apex / adapters and into NG.
   *  Default: undefined (no derivation; consumers' supplied
   *  endDates win as before). Sensible value: 8. */
  hoursPerDay?: number;
  /** Optional consumer-facing interaction callbacks. Each is forwarded from
   *  the underlying NimbusGantt engine event (plus a container-level
   *  contextmenu listener) so host apps can render tooltips, context menus,
   *  dependency-linking UI, edit-mode panels, etc. Mirrors v5 interaction
   *  layer — same surface NimbusGantt already exposes via its engine opts. */
  onTaskClick?: (task: NormalizedTask, source: TaskClickSource) => void;
  onTaskDoubleClick?: (task: NormalizedTask) => void;
  onTaskHover?: (taskId: string | null) => void;
  onTaskContextMenu?: (task: NormalizedTask, pos: ScreenPos) => void;

  /** 0.183 interaction-model callbacks. Separate from onPatch/onTaskClick so
   *  hosts can wire the new IM-1/2/3/5 flows without touching legacy paths. */

  /** Fired on pointer-up after a drag-to-move or drag-to-resize gesture.
   *  `changes` carries only the fields the user actually moved (both when
   *  dragging the bar body, start when dragging the left edge, end when
   *  dragging the right edge). Returning a Promise gates the "in-flight"
   *  visual state — the bar shows as dimmed until it settles. On resolve,
   *  the new position is committed. On reject, the bar reverts to its
   *  original start/end and `onItemEditError` fires.
   *
   *  Race resilience: if the user drags a task twice in quick succession,
   *  the older promise's settle is ignored (per-task sequence numbering).
   *  Latest edit wins; stale settles never revert. */
  onItemEdit?: (
    taskId: string,
    // 0.185.15 — widened from {startDate?, endDate?} to a permissive record
    // so DetailPanel fieldSchema edits (stage, priority, hours, description,
    // assignee, any host-custom key) flow through the same callback as
    // drag-to-edit. Canvas-drag still emits only startDate/endDate (same
    // shape as before), so existing handlers see no behavior change — the
    // union just adds new possible keys when the host wires a fieldSchema.
    // Host routes keys to the right Apex / persistence path; NG doesn't
    // prescribe which fields exist on a task.
    changes: { startDate?: string; endDate?: string } & Record<string, unknown>,
  ) => Promise<void> | void;

  /** Fired on single-click of a gantt bar (click, not drag). Host decides
   *  destination (record page, modal, side panel). Library does not
   *  navigate itself. Passes taskId only — full task lookup is host-side.
   *  Also fired by the Pacing drill-down rows (open the underlying work item). */
  onItemClick?: (taskId: string) => void;

  /** Pacing (0.195) — fired as the cursor moves over a Pacing drill-down row
   *  (taskId) and on leave (null), with viewport coords. Host renders its own
   *  richer tooltip/mouseover (e.g. DH's detail card). Library stays UI-agnostic. */
  onItemHover?: (taskId: string | null, pos: { x: number; y: number }) => void;

  /** Pacing (0.195) — fired by a bucket's "Open report ↗" action. Host owns
   *  the destination (e.g. a Salesforce report filtered to those task IDs). */
  onOpenReport?: (ctx: { bucketKey: string; taskIds: string[] }) => void;

  /** 0.196 — host-supplied team capacity pool. Overrides the template default
   *  (CLOUD_NIMBUS_POOL) for the Team modal + capacity display. DH feeds this
   *  from Salesforce (users / network entities). */
  team?: TeamMember[];

  /** 0.196.1 — Auto-Schedule **review-before-DML** hand-off. NG always computes
   *  a PREVIEW (no in-engine apply) and shows the proposed date changes for
   *  review. On Apply, if this is provided NG hands the host the full proposed
   *  batch — the host stages it for commit/reject (e.g. DH's review-before-DML
   *  audit list) and owns when DML happens. Nothing is applied in-engine in
   *  this path. If absent but `onPatch` is present, NG emits each change via
   *  `onPatch` (same path drag edits use → host's pending/audit list). If
   *  neither, NG applies in-engine (standalone/CN/demo fallback). */
  onAutoSchedule?: (result: { changes: AutoScheduleChange[] }) => void;

  /** 0.196 — Team/capacity host override. When provided, NG hands off (the
   *  team lives in Salesforce); host pops its own capacity source. When absent,
   *  NG opens its own capacity modal over `team` / the template default. */
  onEditTeam?: () => void;

  /** 0.196 — fired when NG's own Team modal saves an edited capacity pool, so
   *  the host can persist it. Not fired when `onEditTeam` is provided. */
  onTeamChange?: (team: TeamMember[]) => void;

  /** Fired when `onItemEdit` rejects. Host surfaces its own UX (e.g.
   *  Lightning ShowToastEvent in Salesforce). Library stays UI-agnostic.
   *  Called AFTER the bar reverts to its original start/end so the host
   *  toast appears alongside the restored position. */
  onItemEditError?: (taskId: string, error: Error) => void;

  /** IM-4 (0.183) — drag-to-reprioritize (row drag changing parent or
   *  sort order). Same async contract as `onItemEdit`: resolve commits,
   *  reject reverts, stale settles are ignored. `newIndex` is the task's
   *  new position within its siblings (same parent / root). `newParentId`
   *  is provided when the drag changed the parent too (re-parent + re-
   *  sort can happen in one gesture). */
  onItemReorder?: (
    taskId: string,
    payload: {
      newIndex: number;
      newParentId?: string | null;
      /** 0.183.1 — coalesced from the priorityGroup patch dragReparent emits
       *  when the drop crossed a bucket boundary. Optional; omitted when the
       *  drop stayed within the same bucket. */
      newPriorityGroup?: string;
      /** 0.185.35 — positional semantics. Hosts that want server-side
       *  dense 1..N numbering (no accumulating negatives from fractional-
       *  midpoint math) use these three fields and ignore `newIndex`;
       *  hosts that want the current numeric-sortOrder contract use
       *  `newIndex` and ignore these.
       *
       *  - `position: 'above-all'` + `beforeTaskId: <topmostId>` + `afterTaskId: null`
       *    → drop above the topmost row in the target bucket
       *  - `position: 'below-all'` + `beforeTaskId: null` + `afterTaskId: <bottommostId>`
       *    → drop below the bottommost row in the target bucket
       *  - `position: 'between'` + both IDs set
       *    → drop between two real tasks */
      position?: 'above-all' | 'below-all' | 'between';
      beforeTaskId?: string | null;
      afterTaskId?: string | null;
    },
  ) => Promise<void> | void;

  /** Fired when `onItemReorder` rejects. Same convention as
   *  `onItemEditError` — host surfaces the toast. */
  onItemReorderError?: (taskId: string, error: Error) => void;

  /** IM-7 (0.183) — viewport state emission. Fires on scroll / zoom
   *  changes, debounced ~150 ms so host persistence doesn't thrash.
   *  `zoom` is the current zoom pill value ('day' | 'week' | 'month' |
   *  'quarter'). Host stores the last-known viewport per user; passes
   *  it back via `initialViewport` on the next mount. */
  onViewportChange?: (state: {
    scrollLeft: number;
    scrollTop: number;
    zoom: string;
  }) => void;

  /** IM-7 (0.183) — initial viewport to apply at mount time. Fields are
   *  all optional. Unspecified scroll falls back to the default
   *  "today - 14 days on the left edge" positioning; unspecified zoom
   *  falls back to the template default. Pass the last-known viewport
   *  the host persisted via `onViewportChange` for session continuity. */
  initialViewport?: {
    scrollLeft?: number;
    scrollTop?: number;
    zoom?: string;
  };

  /** 0.185.15 — schema describing what fields the DetailPanel renders and
   *  which are editable. When absent (or empty), DetailPanel falls back to
   *  its legacy behavior: read-only Status + Priority + Estimated + Logged,
   *  editable Start + End dates. When present, the schema fully replaces
   *  that default and the panel renders exactly the descriptors given.
   *
   *  Hosts (DH, CN v12, v10 scratch) can pass different schemas — the
   *  library doesn't prescribe which fields a surface should expose. Each
   *  descriptor maps to a widget type (text, date, number, textarea,
   *  picklist); on Save the panel diffs the drafts against the current
   *  task and emits onItemEdit(taskId, changes) with ONLY the changed
   *  keys, exactly matching the existing date-edit contract.
   *
   *  Example (DH):
   *    fieldSchema: [
   *      { key: 'startDate', label: 'Start',   type: 'date' },
   *      { key: 'endDate',   label: 'End',     type: 'date' },
   *      { key: 'stage',     label: 'Stage',   type: 'picklist',
   *        options: ['Backlog','In Development','Ready for QA','Done'] },
   *      { key: 'priorityGroup', label: 'Priority', type: 'picklist',
   *        options: ['top-priority','active','backlog'] },
   *      { key: 'estimatedHours', label: 'Hours', type: 'number', min: 0 },
   *      { key: 'description', label: 'Description', type: 'text' },
   *      { key: 'acceptance',  label: 'Acceptance', type: 'textarea' },
   *    ]
   */
  fieldSchema?: FieldDescriptor[];

  /** 0.185.11 — enables the drop-onto-row nest + bucket-header deparent
   *  gestures. Default FALSE. When false, drag only reorders (within
   *  group or across groups via bucket header drop); `newParentId` is
   *  never emitted. Flip true after the host's reparent handler is
   *  stable. Runtime-toggleable via AdminPanel checkbox. */
  enableDragReparent?: boolean;

  /** 0.185.16 — enables canvas-bar vertical drag to reprioritize. When
   *  true, vertical-dominant drag of a bar body commits a reorder
   *  via onItemReorder instead of shifting dates via onItemEdit.
   *  Horizontal-dominant drag still shifts dates. Default FALSE.
   *  Runtime-toggleable via AdminPanel checkbox. */
  enableDragBarToReprioritize?: boolean;

  /** 0.185.4 — record-URL template for the task-detail panel's ID chip.
   *  When provided, DetailPanel renders the task ID as an `<a href>` link
   *  with `{id}` in the template replaced by `task.id`. When omitted, ID
   *  stays as plain text. Example (DH):
   *    recordUrlTemplate: '/lightning/r/delivery__WorkItem__c/{id}/view'
   *  Library does NOT navigate itself — host-provided anchors handle it. */
  recordUrlTemplate?: string;

  /** 0.185.1 — declarative initial focus date. When set, the library
   *  computes scrollLeft to land the given date at the left edge of the
   *  viewport, snapped to start-of-period for the active zoom:
   *    - `zoom: 'day'`     → date as-is
   *    - `zoom: 'week'`    → snap to Monday of the date's ISO week
   *    - `zoom: 'month'`   → snap to the 1st of the date's month
   *    - `zoom: 'quarter'` → snap to the 1st of the date's quarter
   *
   *  Mount-time precedence (most specific wins):
   *    1. `initialViewport.scrollLeft` (explicit pixels)
   *    2. `initialFocusDate` (semantic — library computes pixels)
   *    3. today-14d default (library v9-parity fallback)
   *
   *  Useful for fullscreen surfaces that know "land on today" but can't
   *  compute pxPerDay themselves. DH path C: ship the prop wiring
   *  unconditionally — older NG bundles ignore it (no-op), newer bundles
   *  honor it (no further host change needed). */
  initialFocusDate?: string;

  /** Initial chrome visibility. Default true. When false the TitleBar,
   *  FilterBar, ZoomBar, StatsPanel, Sidebar, AuditPanel, and HrsWkStrip
   *  are all hidden at mount — embedded-mode-ish without forcing mode
   *  to 'embedded'. Consumers can flip at runtime via `handle.toggleChrome()`. */
  chromeVisibleDefault?: boolean;

  /** 0.185.26 — host-supplied buttons rendered in TitleBar's right cluster,
   *  immediately before the Full Screen button. Each button carries its own
   *  label, click handler, and optional pressed state. Default: none.
   *  Use `handle.setTitleBarButtons(newButtons)` for runtime updates (e.g.
   *  toggling the pressed state after a click). */
  titleBarButtons?: TitleBarButton[];

  /** 0.185 — when true, drag-edits and reorders are BUFFERED inside the IIFE
   *  instead of firing onItemEdit / onItemReorder per-edit. The host commits
   *  the whole buffer via `handle.commitEdits()` (typically wired to the
   *  AuditPanel Submit+commit button) or reverts via `handle.discardEdits()`.
   *
   *  When `batchMode: true`, the library auto-populates
   *  `TemplateConfig.pendingChanges` from its internal buffer, so the
   *  AuditPanel preview modal activates with no host-side `pendingChanges`
   *  plumbing required.
   *
   *  Default: false — existing per-patch flow (CN v10, DH today) untouched. */
  batchMode?: boolean;
}

/**
 * 0.185 — single buffered edit returned by `handle.getPendingEdits()`.
 *
 * `kind === 'edit'` carries date changes; `kind === 'reorder'` carries
 * structural changes (parent / sortOrder / priorityGroup). A single task
 * can have one of each in the buffer simultaneously (key: taskId+kind).
 *
 * `original` snapshots the pre-first-edit state for that taskId+kind, so
 * `discardEdits` restores truly-persisted values rather than a prior
 * in-flight optimistic value (same pattern as the 0.183 pendingEdits
 * registry).
 */
export interface PendingEdit {
  taskId: string;
  kind: 'edit' | 'reorder';
  /** Populated when kind === 'edit'. */
  changes?: { startDate?: string; endDate?: string };
  /** Populated when kind === 'reorder'. Mirrors TaskPatch fields. */
  reorderPayload?: {
    priorityGroup?: string;
    sortOrder?: number;
    parentId?: string | null;
  };
  /** Pre-edit-chain snapshot — used by discardEdits to revert. */
  original: {
    startDate?: string;
    endDate?: string;
    priorityGroup?: string | null;
    sortOrder?: number;
    parentId?: string | null;
  };
  /** 0.190 — alias of `original`. Same object reference; same shape. Hosts
   *  building "from → to" audit lists tend to reach for `before` first.
   *  Both populated together so old hosts reading `original` keep working. */
  before: {
    startDate?: string;
    endDate?: string;
    priorityGroup?: string | null;
    sortOrder?: number;
    parentId?: string | null;
  };
  /** ms-since-epoch of the LAST coalesced edit on this taskId+kind. */
  ts: number;
}

/**
 * 0.185 — result returned by `handle.commitEdits()`.
 *
 * On success: `{ committed: PendingEdit[] }` — every buffered edit cleared
 * and forwarded to the host.
 *
 * On failure: thrown as `{ failedAt, successful, error }`. `successful`
 * are the edits that already landed (cleared from the buffer). `failedAt`
 * is the edit that threw — it stays in the buffer along with everything
 * after it, so the host can re-call `commitEdits()` to retry from the
 * failure point or call `discardEdits()` to drop the rest.
 */
export interface CommitEditsResult {
  committed: PendingEdit[];
}
export interface CommitEditsFailure {
  failedAt: PendingEdit;
  successful: PendingEdit[];
  error: unknown;
}

export interface AppInstance {
  setTasks(tasks: NormalizedTask[]): void;
  /** 0.185.27 — full replace of tasks AND dependencies. Use this when the
   *  host has a fresh dependencies array (e.g. after Apex refresh pulls
   *  both `getProFormaTimelineData` + `getGanttDependencies` in parallel).
   *  Passing `undefined` for dependencies leaves the existing set alone —
   *  equivalent to calling setTasks(tasks) alone. */
  setData?(tasks: NormalizedTask[], dependencies?: GanttDependency[]): void;
  destroy(): void;
  /** Optional bridge methods exposed by the engineOnly IIFE mount so the
   *  React driver can forward slot state changes (filter/search, zoom,
   *  groupBy) to the live gantt canvas without re-mounting the engine. */
  setFilter?(filter: string, search: string): void;
  setZoom?(zoom: string): void;
  setGroupBy?(groupBy: string): void;
  /** Toggle chrome visibility at runtime (CH-1). With no argument, flips
   *  the current state. With a boolean, sets explicitly. Hides/shows the
   *  TitleBar, FilterBar, ZoomBar, StatsPanel, Sidebar, AuditPanel, and
   *  HrsWkStrip slots. Only available on the chrome-aware mount path —
   *  engineOnly instances do not expose it (React already owns chrome). */
  toggleChrome?(visible?: boolean): void;

  /** 0.185 — snapshot of the current buffered-edit set. Empty when not in
   *  batch mode or the buffer is clean. Insertion order preserved. */
  getPendingEdits?(): PendingEdit[];

  /** 0.185 — flush every buffered edit to the host by calling onItemEdit
   *  (date edits first) then onItemReorder (structural reorders second —
   *  edits-before-reorders avoids DH's Apex sortOrder neighbor-shift race).
   *  Resolves with `{ committed }` on full success. Throws
   *  `{ failedAt, successful, error }` on first failure; failed + remaining
   *  stay in the buffer so the host can retry or discard. */
  commitEdits?(): Promise<CommitEditsResult>;

  /** 0.185 — visual-only revert: restores the pre-edit originals on every
   *  buffered task and clears the buffer. The host never sees any
   *  callback — these edits never existed as far as persistence is
   *  concerned. */
  discardEdits?(): void;

  /** 0.190 — visual-only revert for ONE buffered patch. Restores `before`
   *  on the row (date for kind='edit'; parent/group/sortOrder for
   *  kind='reorder') and clears that single buffer entry. The host never
   *  sees a callback — the edit never existed as far as persistence is
   *  concerned. Returns true when an entry was removed; false when no
   *  matching entry was buffered (already-committed, never-staged, etc.).
   *
   *  Use case: per-row ✗ in the AuditPanel preview modal so the operator
   *  can cherry-pick which buffered changes to commit vs reject without
   *  having to discard the whole buffer + redo the keepers. */
  removePendingPatch?(taskId: string, kind: 'edit' | 'reorder'): boolean;

  /** 0.185.26 — runtime update of the host-supplied TitleBar buttons. Pass
   *  the full desired array (not a diff); replacing pressed state on an
   *  existing button is the typical use. Re-renders the TitleBar slot.
   *  No-op on engineOnly mounts. */
  setTitleBarButtons?(buttons: TitleBarButton[]): void;

  /** 0.185.32 — coordinate-based hit-test. Returns the task at page-
   *  relative (clientX, clientY), or null if the point isn't over a bar
   *  or grid row.
   *
   *  Motivation: Salesforce Locker/LWS sandboxes the IIFE's `document`
   *  reference, so listeners attached from inside NG silently no-op
   *  (0.185.29/30/31 pointerdown + contextmenu probes never fired).
   *  Hosts wanting a right-click popover attach their own document-
   *  level listener (which DOES fire under LWS when attached from the
   *  LWC class), then call `handle.taskAt(e.clientX, e.clientY)` to
   *  resolve which task — NG does the hit-test; host does the event
   *  wiring.
   *
   *  Resolution strategy (same as the legacy onTaskContextMenu path):
   *    1. `elementFromPoint(x, y)` + `.closest('[data-task-id]')`
   *    2. Fallback to the internally-tracked lastHoveredTaskId when
   *       the element lookup fails (e.g., retargeted shadow host). */
  taskAt?(clientX: number, clientY: number): NormalizedTask | null;

  /** 0.185.1 — scroll the gantt so `date` lands at the LEFT edge of the
   *  viewport. Host doesn't need to know `pxPerDay` for the current zoom —
   *  the library uses its own `timeScale.dateToX` to compute the offset.
   *  Useful for fullscreen surfaces that want to land on "today" or any
   *  named date after mount. Accepts either an ISO string ('2026-04-19')
   *  or a Date. No-op if the engine isn't mounted yet. */
  scrollToDate?(date: string | Date): void;
}

/** Internal mapped task passed to NimbusGantt engine */
export interface MappedTask {
  id: string;
  title: string;
  name: string;
  hoursLabel: string;
  /** DM-3 (0.183) — column-ready hours string ("40h", or '' when 0). Split
   *  out from hoursLabel so surfaces that enable the separate Hours column
   *  get a clean numeric rather than the "40h (75% budget)" combined form. */
  hours?: string;
  /** DM-3 (0.183) — column-ready budget-used percent string ("75%",
   *  "116%", or '' when unavailable). Uncapped per spec — surfaces see the
   *  overrun directly. */
  budgetUsedPct?: string;
  startDate: string;
  endDate: string;
  progress: number;
  status: string;
  color: string;
  groupId: string | null | undefined;
  parentId: string | undefined;
  sortOrder: number;
  isInactive: boolean;
  isParent?: boolean;
  metadata: { hoursHigh: number; hoursLogged: number };
}
