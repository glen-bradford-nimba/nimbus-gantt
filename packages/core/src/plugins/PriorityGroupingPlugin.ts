// ─── Priority Grouping Plugin ───────────────────────────────────────────────
//
// Buckets tasks into a fixed, ordered set of priority groups (e.g.
// NOW / NEXT / PLANNED / PROPOSED / HOLD), each with its own color, label,
// and a hours-weighted span bar in the timeline. Designed for the Cloud
// Nimbus pro-forma timeline use case but generic enough for any
// "swimlane with rich headers" layout.
//
// HOW IT WORKS — synthetic header tasks
// =====================================
// The plugin's middleware INJECTS synthetic "bucket header" tasks directly into
// state.tasks and state.flatVisibleIds at the position right above each bucket's
// real members. The default renderer then handles them like any other task —
// the DomTreeGrid renders the bucket label in the grid column, and the canvas
// renderer draws a colored bar in the timeline column. They stay aligned
// because both use the same row indices.
//
// This is the same pattern v4's `toGanttTasks()` used inline (see
// cloudnimbusllc.com/src/app/mf/delivery-timeline-v4/DeliveryTimelineV4.tsx).
// The plugin extracts it into the framework so consumers like the Delivery Hub
// deliveryProFormaTimeline LWC can reuse the same logic against real
// WorkItem__c records.
//
// Built 2026-04-10 for the v4 → v5 → Delivery Hub port.

import type {
  NimbusGanttPlugin,
  PluginHost,
  Action,
  GanttState,
  GanttTask,
} from '../model/types';
import { parseDate } from '../layout/LayoutEngine';

const HEADER_PREFIX = '__bucket_header__';

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Public config types ────────────────────────────────────────────────────

export interface PriorityBucket {
  id: string;
  label: string;
  color: string;
  bgTint?: string;
  order: number;
}

export interface PriorityGroupingConfig {
  buckets: PriorityBucket[];
  /**
   * Returns the bucket id for a task, or null if the task is unbucketed.
   * Default: reads `task.groupId`. Pass a custom fn to derive from any
   * combination of task fields — this is the seam between hardcoded data
   * (cloudnimbusllc.com pro forma) and Salesforce data (DH WorkItem__c).
   */
  getBucket?: (task: GanttTask) => string | null;
  /**
   * Returns the progress (0..1) shown on a bucket's header row. Default:
   * arithmetic mean of task.progress. v4 passes a hours-weighted version
   * (see hoursWeightedProgress export).
   */
  getBucketProgress?: (tasks: GanttTask[]) => number;
  /** Whether buckets start collapsed. Default: false. */
  startCollapsed?: boolean;
}

// ─── Internal state ─────────────────────────────────────────────────────────

interface BucketRuntime {
  config: PriorityBucket;
  /** Visible task IDs (for rendering count/order, post-collapse-filter) */
  taskIds: string[];
  /** All task IDs assigned to this bucket (pre-filter, source of truth for span) */
  allTaskIds: string[];
  collapsed: boolean;
  progress: number;
  /** Earliest startDate across ALL bucket members */
  startDate: Date | null;
  /** Latest endDate across ALL bucket members */
  endDate: Date | null;
  /** Sum of metadata.hoursHigh across all bucket members (0 if no metadata) */
  totalHours: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

function defaultGetBucket(task: GanttTask): string | null {
  return task.groupId ?? null;
}

function defaultGetBucketProgress(tasks: GanttTask[]): number {
  if (tasks.length === 0) return 0;
  let sum = 0;
  for (const t of tasks) sum += t.progress ?? 0;
  return sum / tasks.length;
}

// ─── Plugin factory ─────────────────────────────────────────────────────────

export function PriorityGroupingPlugin(
  config: PriorityGroupingConfig,
): NimbusGanttPlugin {
  const sortedBuckets = [...config.buckets].sort((a, b) => a.order - b.order);
  const bucketIndexById = new Map<string, number>();
  sortedBuckets.forEach((b, i) => bucketIndexById.set(b.id, i));

  const getBucket = config.getBucket ?? defaultGetBucket;
  const getBucketProgress =
    config.getBucketProgress ?? defaultGetBucketProgress;

  const collapsedIds = new Set<string>();
  if (config.startCollapsed) {
    for (const b of sortedBuckets) collapsedIds.add(b.id);
  }

  let host: PluginHost | null = null;
  let runtime: BucketRuntime[] = [];
  let unsubClick: (() => void) | null = null;

  // ── Build buckets from a clean (header-free) view of state ──────────────
  function buildBuckets(state: GanttState, cleanVisibleIds: string[]): void {
    runtime = sortedBuckets.map((cfg) => ({
      config: cfg,
      taskIds: [],
      allTaskIds: [],
      collapsed: collapsedIds.has(cfg.id),
      progress: 0,
      startDate: null,
      endDate: null,
      totalHours: 0,
    }));

    // Pass 1: walk visible IDs to capture rendering order for visible tasks
    for (const taskId of cleanVisibleIds) {
      const task = state.tasks.get(taskId);
      if (!task) continue;
      const bucketId = getBucket(task);
      if (!bucketId) continue;
      const idx = bucketIndexById.get(bucketId);
      if (idx === undefined) continue;
      runtime[idx].taskIds.push(taskId);
    }

    // Pass 2: walk state.tasks (the FULL Map, source of truth) to compute
    // span/progress/hours from ALL bucket members regardless of visibility.
    for (const [taskId, task] of state.tasks) {
      if (taskId.startsWith(HEADER_PREFIX)) continue;
      const bucketId = getBucket(task);
      if (!bucketId) continue;
      const idx = bucketIndexById.get(bucketId);
      if (idx === undefined) continue;
      runtime[idx].allTaskIds.push(taskId);
    }

    for (const b of runtime) {
      if (b.allTaskIds.length === 0) {
        b.progress = 0;
        b.startDate = null;
        b.endDate = null;
        b.totalHours = 0;
        continue;
      }
      const tasksFull: GanttTask[] = [];
      let minTime = Infinity;
      let maxTime = -Infinity;
      let totalHigh = 0;
      for (const id of b.allTaskIds) {
        const t = state.tasks.get(id);
        if (!t) continue;
        tasksFull.push(t);
        if (t.startDate) {
          const s = parseDate(t.startDate).getTime();
          if (!isNaN(s) && s < minTime) minTime = s;
        }
        if (t.endDate) {
          const e = parseDate(t.endDate).getTime();
          if (!isNaN(e) && e > maxTime) maxTime = e;
        }
        const md = t.metadata as Record<string, unknown> | undefined;
        if (typeof md?.hoursHigh === 'number') totalHigh += md.hoursHigh;
      }
      b.startDate = isFinite(minTime) ? new Date(minTime) : null;
      b.endDate = isFinite(maxTime) ? new Date(maxTime) : null;
      b.totalHours = totalHigh;
      b.progress = Math.max(0, Math.min(1, getBucketProgress(tasksFull)));
    }
  }

  // ── Compose a synthetic header task for a bucket ────────────────────────
  function makeHeaderTask(bucket: BucketRuntime): GanttTask | null {
    if (!bucket.startDate || !bucket.endDate) return null;
    const pct = Math.round(bucket.progress * 100);
    const labelText =
      bucket.totalHours > 0
        ? `${bucket.config.label} · ${bucket.totalHours}h (${pct}%)`
        : `${bucket.config.label} · ${bucket.allTaskIds.length} items`;
    return {
      id: `${HEADER_PREFIX}${bucket.config.id}`,
      name: labelText,
      startDate: toISODate(bucket.startDate),
      endDate: toISODate(bucket.endDate),
      progress: bucket.progress,
      color: bucket.config.color,
      status: 'bucket-header',
      groupId: bucket.config.id,
      groupName: bucket.config.label,
      assignee: '',
      metadata: {
        __bucketHeader: true,
        bucketId: bucket.config.id,
        hoursHigh: bucket.totalHours,
        taskCount: bucket.allTaskIds.length,
      },
    };
  }

  // ── Toggle a bucket's collapse state and trigger a re-render ────────────
  function toggleBucket(bucketId: string): void {
    if (collapsedIds.has(bucketId)) collapsedIds.delete(bucketId);
    else collapsedIds.add(bucketId);
    if (host) {
      const state = host.getState();
      host.dispatch({ type: 'SET_SCROLL', x: state.scrollX, y: state.scrollY });
    }
  }

  // ── Plugin contract ────────────────────────────────────────────────────
  return {
    name: 'PriorityGroupingPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      unsubClick = gantt.on('taskClick', ((...args: unknown[]) => {
        const first = args[0];
        let taskId: string | null = null;
        if (typeof first === 'string') {
          taskId = first;
        } else if (
          first &&
          typeof first === 'object' &&
          'id' in (first as object)
        ) {
          taskId = String((first as { id: unknown }).id);
        }
        if (taskId && taskId.startsWith(HEADER_PREFIX)) {
          toggleBucket(taskId.substring(HEADER_PREFIX.length));
        }
      }) as (...args: unknown[]) => void);
    },

    middleware(action: Action, next: (action: Action) => void): void {
      next(action);
      if (!host) return;

      const state = host.getState();

      // 1. Clean any stale synthetic headers from state.tasks
      const staleHeaderIds: string[] = [];
      for (const id of state.tasks.keys()) {
        if (id.startsWith(HEADER_PREFIX)) staleHeaderIds.push(id);
      }
      for (const id of staleHeaderIds) state.tasks.delete(id);

      // 2. Get a clean view of flatVisibleIds (no synthetic headers)
      const cleanIds = state.flatVisibleIds.filter(
        (id) => !id.startsWith(HEADER_PREFIX),
      );

      // 3. Bail if no tasks have a bucket assignment
      let hasAny = false;
      for (const t of state.tasks.values()) {
        if (getBucket(t) != null) {
          hasAny = true;
          break;
        }
      }
      if (!hasAny) {
        runtime = [];
        if (cleanIds.length !== state.flatVisibleIds.length) {
          state.flatVisibleIds.length = 0;
          for (const id of cleanIds) state.flatVisibleIds.push(id);
        }
        return;
      }

      // 4. Build buckets fresh from the clean state
      buildBuckets(state, cleanIds);

      // 5. Recompose flatVisibleIds: ungrouped first, then per-bucket
      //    header + members (skipping members of collapsed buckets)
      const newVisible: string[] = [];

      for (const id of cleanIds) {
        const t = state.tasks.get(id);
        if (!t) continue;
        const b = getBucket(t);
        if (!b || !bucketIndexById.has(b)) {
          newVisible.push(id);
        }
      }

      for (const bucket of runtime) {
        if (bucket.allTaskIds.length === 0) continue;
        const headerTask = makeHeaderTask(bucket);
        if (headerTask) {
          state.tasks.set(headerTask.id, headerTask);
          newVisible.push(headerTask.id);
        }
        if (!bucket.collapsed) {
          for (const tid of bucket.taskIds) newVisible.push(tid);
        }
      }

      // 6. Apply
      state.flatVisibleIds.length = 0;
      for (const id of newVisible) state.flatVisibleIds.push(id);
    },

    destroy(): void {
      if (unsubClick) unsubClick();
      host = null;
      runtime = [];
      unsubClick = null;
      collapsedIds.clear();
    },
  };
}

// ─── Pre-built bucket palette for the cloud-nimbus pro-forma use case ───────

export const CLOUD_NIMBUS_PRIORITY_BUCKETS: PriorityBucket[] = [
  {
    id: 'top-priority',
    label: 'NOW',
    color: '#dc2626',
    bgTint: '#fef2f2',
    order: 0,
  },
  {
    id: 'active',
    label: 'NEXT',
    color: '#d97706',
    bgTint: '#fffbeb',
    order: 1,
  },
  {
    id: 'follow-on',
    label: 'PLANNED',
    color: '#059669',
    bgTint: '#ecfdf5',
    order: 2,
  },
  {
    id: 'proposed',
    label: 'PROPOSED',
    color: '#2563eb',
    bgTint: '#eff6ff',
    order: 3,
  },
  {
    id: 'deferred',
    label: 'HOLD',
    color: '#94a3b8',
    bgTint: '#f8fafc',
    order: 4,
  },
];

/**
 * Hours-weighted progress fn — used by both v4 and the eventual DH LWC.
 * Reads `hoursHigh` and `hoursLogged` from `task.metadata`. Falls back to
 * the arithmetic mean of `task.progress` if metadata is absent.
 */
export function hoursWeightedProgress(tasks: GanttTask[]): number {
  let totalHigh = 0;
  let totalLogged = 0;
  let usedMetadata = false;
  for (const t of tasks) {
    const md = t.metadata as Record<string, unknown> | undefined;
    const high = typeof md?.hoursHigh === 'number' ? md.hoursHigh : 0;
    const logged = typeof md?.hoursLogged === 'number' ? md.hoursLogged : 0;
    if (high > 0) {
      totalHigh += high;
      totalLogged += logged;
      usedMetadata = true;
    }
  }
  if (!usedMetadata) {
    if (tasks.length === 0) return 0;
    let sum = 0;
    for (const t of tasks) sum += t.progress ?? 0;
    return sum / tasks.length;
  }
  return totalHigh > 0 ? Math.min(totalLogged / totalHigh, 1) : 0;
}
