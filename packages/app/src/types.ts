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
}

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
}

export interface AppInstance {
  setTasks(tasks: NormalizedTask[]): void;
  destroy(): void;
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
