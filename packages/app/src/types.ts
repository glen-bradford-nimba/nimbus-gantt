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

export interface MountOptions {
  tasks: NormalizedTask[];
  onPatch: (patch: TaskPatch) => Promise<void> | void;
  config?: Partial<AppConfig>;
  /** Pre-resolved engine — bypasses window.NimbusGantt lookup when provided. */
  engine?: NimbusGanttEngine;
  /** Optional consumer-facing interaction callbacks. Each is forwarded from
   *  the underlying NimbusGantt engine event (plus a container-level
   *  contextmenu listener) so host apps can render tooltips, context menus,
   *  dependency-linking UI, edit-mode panels, etc. Mirrors v5 interaction
   *  layer — same surface NimbusGantt already exposes via its engine opts. */
  onTaskClick?: (task: NormalizedTask, source: TaskClickSource) => void;
  onTaskDoubleClick?: (task: NormalizedTask) => void;
  onTaskHover?: (taskId: string | null) => void;
  onTaskContextMenu?: (task: NormalizedTask, pos: ScreenPos) => void;
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
}

/** Internal mapped task passed to NimbusGantt engine */
export interface MappedTask {
  id: string;
  title: string;
  name: string;
  hoursLabel: string;
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
