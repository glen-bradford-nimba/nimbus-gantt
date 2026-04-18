// ─── Priority Grouping Plugin ───────────────────────────────────────────────
//
// Buckets tasks into a fixed, ordered set of priority groups (e.g.
// NOW / NEXT / PLANNED / PROPOSED / HOLD), each with its own color, label,
// and a hours-weighted span bar in the timeline. Designed for the Cloud
// Nimbus pro-forma timeline use case but generic enough for any
// "swimlane with rich headers" layout.
//
// HOW IT WORKS — synthetic header tasks via middleware + rebuildTree()
// ====================================================================
// The plugin's middleware runs AFTER the reducer (via next(action)). It:
//   1. Strips any stale synthetic header tasks from state.tasks
//   2. Builds bucket membership from the real tasks
//   3. Injects synthetic "bucket header" tasks into state.tasks and
//      re-parents each real member task to its bucket header (setting
//      t.parentId = headerTask.id) so the tree builder produces a proper
//      parent-child structure with native expand/collapse
//   4. Updates state.expandedIds to match the plugin's own collapsed set
//   5. Calls host.rebuildTree() so the grid (which renders from state.tree)
//      picks up the injected tasks — this is the key call that makes the
//      plugin pattern work for row injection (the reducer built the tree
//      BEFORE our middleware ran, so mutating state.tasks alone isn't
//      enough — the tree has to be recomputed from the new tasks Map).
//
// The same plugin ports directly to Delivery Hub's LWC: Apex serves
// WorkItem__c records with a PriorityGroup__c field, the LWC instantiates
// PriorityGroupingPlugin with buckets from the PriorityGroup__c picklist
// values, and the plugin handles header injection, collapse, and progress
// rollup. Zero LWC-specific code.
//
// Built 2026-04-10 for the v4 → v5 → Delivery Hub port. Refactored from
// canvas-overlay rendering to synthetic-task injection 2026-04-10 after
// tracking down the tree-render bug (see the comment block in the
// cloudnimbusllc.com vendor copy for the full tracedown).

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
  getBucket?: (task: GanttTask) => string | null;
  getBucketProgress?: (tasks: GanttTask[]) => number;
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
  /** Earliest startDate across ALL bucket members (not just visible) */
  startDate: Date | null;
  /** Latest endDate across ALL bucket members */
  endDate: Date | null;
  /** Sum of metadata.hoursHigh across all bucket members (0 if no metadata) */
  totalHours: number;
  /** DM-5 (0.183) — sum of metadata.hoursLogged across all bucket members.
   *  Retained separately from progress (which is clamped 0-1 so overage
   *  info is lost there) so the header over-budget branch can compare
   *  totalLogged vs totalHours directly. */
  totalLogged: number;
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
      totalLogged: 0,
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
    // Skip any synthetic header tasks (we just deleted them but be defensive).
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
        b.totalLogged = 0;
        continue;
      }
      const tasksFull: GanttTask[] = [];
      let minTime = Infinity;
      let maxTime = -Infinity;
      let totalHigh = 0;
      let totalLogged = 0;
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
        if (typeof md?.hoursLogged === 'number') totalLogged += md.hoursLogged;
      }
      b.startDate = isFinite(minTime) ? new Date(minTime) : null;
      b.endDate = isFinite(maxTime) ? new Date(maxTime) : null;
      b.totalHours = totalHigh;
      b.totalLogged = totalLogged;
      b.progress = Math.max(0, Math.min(1, getBucketProgress(tasksFull)));
    }
  }

  // ── Compose a synthetic header task for a bucket ────────────────────────
  function makeHeaderTask(bucket: BucketRuntime): GanttTask | null {
    if (!bucket.startDate || !bucket.endDate) return null;
    // DM-5 (0.183) — over-budget aggregate: aggregate logged >= aggregate
    // estimated. Uses raw totals so the comparison survives the 0-1 clamp
    // applied to `progress`. Aggregate % label shows the UNCLAMPED ratio
    // too, so overruns read at a glance on the header row.
    const overBudget = bucket.totalHours > 0 && bucket.totalLogged >= bucket.totalHours;
    const aggregatePct = bucket.totalHours > 0
      ? Math.round((bucket.totalLogged / bucket.totalHours) * 100)
      : Math.round(bucket.progress * 100);
    const labelText =
      bucket.totalHours > 0
        ? `${bucket.totalHours}h (${aggregatePct}% budget)`
        : `${bucket.allTaskIds.length} items`;
    return {
      id: `${HEADER_PREFIX}${bucket.config.id}`,
      name: labelText,
      startDate: toISODate(bucket.startDate),
      endDate: toISODate(bucket.endDate),
      progress: bucket.progress,
      // DM-5 (0.183) — warning hue on the header bar when the aggregate
      // is over budget. Matches the OVER_BUDGET_COLOR shipped in
      // packages/app/src/pipeline.ts (kept as a literal here to avoid
      // cross-package coupling — core must not depend on app).
      color: overBudget ? '#f59e0b' : bucket.config.color,
      // v4-compatible group styling — core.js reads these when
      // status === "group-header" to render the row background tint,
      // grid text color, canvas top border line, and label.
      status: 'group-header',
      groupBg: bucket.config.bgTint || undefined,
      groupColor: bucket.config.color,
      groupId: bucket.config.id,
      groupName: bucket.config.label,
      title: bucket.config.label,
      hours: bucket.totalHours,
      hoursLabel: `${bucket.allTaskIds.length} · ${bucket.totalHours}h`,
      assignee: '',
      sortOrder: bucket.config.order,
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

      // 2. Clean view of flatVisibleIds (no synthetic headers)
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

      // 4. Build buckets fresh from clean state
      buildBuckets(state, cleanIds);

      // 5. Inject synthetic header tasks into state.tasks AND set parentId
      //    on each member task → header, so the tree builder creates a
      //    proper parent-child structure. Also sync state.expandedIds with
      //    the plugin's collapsed set so the tree renders collapse
      //    correctly without a custom filter.
      for (const bucket of runtime) {
        if (bucket.allTaskIds.length === 0) continue;
        const headerTask = makeHeaderTask(bucket);
        if (headerTask) {
          state.tasks.set(headerTask.id, headerTask);
          for (const tid of bucket.allTaskIds) {
            const t = state.tasks.get(tid);
            if (t) t.parentId = headerTask.id;
          }
          if (bucket.collapsed) {
            state.expandedIds.delete(headerTask.id);
          } else {
            state.expandedIds.add(headerTask.id);
          }
        }
      }

      // 6. Rebuild tree + flatVisibleIds so the grid sees the injected
      //    parent rows with their members as children. Without this, the
      //    grid still renders from the pre-middleware tree and the
      //    synthetic headers never appear.
      host.rebuildTree();
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
  { id: 'top-priority', label: 'NOW',      color: '#dc2626', bgTint: '#fef2f2', order: 0 },
  { id: 'active',       label: 'NEXT',     color: '#d97706', bgTint: '#fffbeb', order: 1 },
  { id: 'follow-on',    label: 'PLANNED',  color: '#059669', bgTint: '#ecfdf5', order: 2 },
  { id: 'proposed',     label: 'PROPOSED', color: '#2563eb', bgTint: '#eff6ff', order: 3 },
  { id: 'deferred',     label: 'HOLD',     color: '#94a3b8', bgTint: '#f8fafc', order: 4 },
];

/**
 * Returns true if the given task ID is a synthetic bucket header.
 * Use in click handlers to detect and route to bucket-collapse logic.
 */
export function isBucketHeaderId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(HEADER_PREFIX);
}

/**
 * Extracts the bucket id from a synthetic header task id.
 * Returns null if the input isn't a synthetic header id.
 */
export function bucketIdFromHeaderId(id: string): string | null {
  if (!isBucketHeaderId(id)) return null;
  return id.substring(HEADER_PREFIX.length);
}

/**
 * Hours-weighted progress fn — used by both v5 and the eventual DH LWC.
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
