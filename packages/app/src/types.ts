export interface PriorityBucket {
  id: string;
  label: string;
  color: string;
  bgTint: string;
  order: number;
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
}

/** Screen-space coordinates for right-click / context menu UX. */
export interface ScreenPos {
  x: number;
  y: number;
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

export interface MountOptions {
  tasks: NormalizedTask[];
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
    changes: { startDate?: string; endDate?: string },
  ) => Promise<void> | void;

  /** Fired on single-click of a gantt bar (click, not drag). Host decides
   *  destination (record page, modal, side panel). Library does not
   *  navigate itself. Passes taskId only — full task lookup is host-side. */
  onItemClick?: (taskId: string) => void;

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
