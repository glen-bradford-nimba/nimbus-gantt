// ─── Priority Grouping Plugin ───────────────────────────────────────────────
// Buckets tasks into a fixed, ordered set of priority groups (e.g.
// NOW / NEXT / PLANNED / PROPOSED / HOLD), each with its own color, label,
// and an hours-weighted progress bar on the header row. Designed for the
// Cloud Nimbus pro-forma timeline use case but generic enough for any
// "swimlane with rich headers" layout.
//
// Differs from GroupingPlugin in that it:
//   - Takes an explicit ORDERED list of buckets (not insertion order)
//   - Renders each header with a custom color strip + label + progress
//   - Uses caller-provided bucket assignment fn (the "missing field" seam:
//     pass () => task.metadata.priorityGroup for DH, or
//     () => derivePriorityGroup(task) for cloudnimbusllc.com)
//   - Uses caller-provided bucket-progress fn (default is average of
//     task.progress, but v4 wants hours-weighted)
//
// Built 2026-04-10 for the v4 → Delivery Hub port.

import type {
  NimbusGanttPlugin,
  PluginHost,
  Action,
  GanttState,
  TaskLayout,
  GanttTask,
  TimeScaleAPI,
} from '../model/types';
import { parseDate } from '../layout/LayoutEngine';

// ─── Public config types ────────────────────────────────────────────────────

/**
 * One bucket in the priority list. Order is determined by `order` (lower first).
 * `id` must match what `getBucket(task)` returns for tasks in this bucket.
 */
export interface PriorityBucket {
  id: string;
  label: string;
  color: string;       // Header text color + accent strip
  bgTint?: string;     // Optional faint background fill for the header row
  order: number;       // Lower = appears earlier in the timeline
}

export interface PriorityGroupingConfig {
  /** Ordered list of buckets (will be re-sorted by `order` internally). */
  buckets: PriorityBucket[];

  /**
   * Returns the bucket id for a task, or null if the task is unbucketed.
   * Default: reads `task.groupId`. Pass a custom fn to derive from any
   * combination of task fields — this is the seam between hardcoded data
   * (cloudnimbusllc.com pro forma) and Salesforce data (DH WorkItem__c).
   */
  getBucket?: (task: GanttTask) => string | null;

  /**
   * Returns the progress (0..1) shown on a bucket's header row.
   * Default: arithmetic mean of task.progress over all tasks in the bucket.
   * v4 passes a hours-weighted version: sum(loggedHours) / sum(hoursHigh).
   */
  getBucketProgress?: (tasks: GanttTask[]) => number;

  /** Whether buckets start collapsed. Default: false (all expanded). */
  startCollapsed?: boolean;
}

// ─── Internal state ─────────────────────────────────────────────────────────

interface BucketRuntime {
  config: PriorityBucket;
  /** Visible task IDs (for rendering count/order, post-filter) */
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
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const HEADER_TEXT_COLOR_FALLBACK = '#334155';
const HEADER_BORDER_COLOR = 'rgba(100, 116, 139, 0.25)';
const PROGRESS_TRACK_BG = 'rgba(100, 116, 139, 0.18)';
const PROGRESS_HEIGHT = 6;
const COLOR_STRIP_WIDTH = 4;
const LABEL_LEFT_MARGIN = 16;
const COUNT_BADGE_GAP = 8;
const PROGRESS_BAR_LEFT_MARGIN = 12;
const PROGRESS_BAR_MIN_WIDTH = 80;
const PROGRESS_BAR_MAX_WIDTH = 200;
const CHEVRON_RIGHT_MARGIN = 12;
const CHEVRON_SIZE = 5;

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
  const getBucketProgress = config.getBucketProgress ?? defaultGetBucketProgress;

  const collapsedIds = new Set<string>();
  if (config.startCollapsed) {
    for (const b of sortedBuckets) collapsedIds.add(b.id);
  }

  let host: PluginHost | null = null;
  let runtime: BucketRuntime[] = [];
  // Map row index → bucket runtime, used for click hit-testing
  let headerRowMap = new Map<number, BucketRuntime>();

  let containerEl: HTMLElement | null = null;
  let clickHandler: ((e: MouseEvent) => void) | null = null;
  let unsubRender: (() => void) | null = null;

  // ── Build buckets from current state ────────────────────────────────────
  function buildBuckets(state: GanttState): void {
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

    // Pass 1: walk flatVisibleIds to capture rendering order for visible tasks
    for (const taskId of state.flatVisibleIds) {
      const task = state.tasks.get(taskId);
      if (!task) continue;
      const bucketId = getBucket(task);
      if (!bucketId) continue;
      const idx = bucketIndexById.get(bucketId);
      if (idx === undefined) continue;
      runtime[idx].taskIds.push(taskId);
    }

    // Pass 2: walk state.tasks (the FULL Map, source of truth) to compute
    // span/progress/hours independently of any visibility filter. This is what
    // makes the bucket span bar render correctly even when the bucket is
    // collapsed (its tasks are absent from flatVisibleIds at that point).
    for (const [taskId, task] of state.tasks) {
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

  function toggleBucket(bucketId: string): void {
    if (collapsedIds.has(bucketId)) collapsedIds.delete(bucketId);
    else collapsedIds.add(bucketId);
    if (host) {
      const state = host.getState();
      host.dispatch({ type: 'SET_SCROLL', x: state.scrollX, y: state.scrollY });
    }
  }

  return {
    name: 'PriorityGroupingPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      unsubRender = gantt.on('render', () => {
        if (containerEl) return;

        const rootEl = document.querySelector('.nimbus-gantt');
        if (!rootEl) return;

        containerEl = rootEl.parentElement ?? (rootEl as HTMLElement);

        clickHandler = (e: MouseEvent) => {
          if (!host) return;
          const state = host.getState();
          const timelinePanel = rootEl.querySelector('.ng-timeline-panel');
          if (!timelinePanel) return;
          const rect = timelinePanel.getBoundingClientRect();
          const clickY = e.clientY - rect.top;
          const headerHeight = state.config.headerHeight;
          if (clickY < headerHeight) return;
          const bodyY = clickY - headerHeight + state.scrollY;
          const rowIndex = Math.floor(bodyY / state.config.rowHeight);
          const bucket = headerRowMap.get(rowIndex);
          if (bucket) {
            e.preventDefault();
            e.stopPropagation();
            toggleBucket(bucket.config.id);
          }
        };

        containerEl.addEventListener('click', clickHandler);
      });
    },

    middleware(action: Action, next: (action: Action) => void): void {
      next(action);
      if (!host) return;

      const state = host.getState();

      // Bail if no tasks have a bucket — nothing to do
      let hasAny = false;
      for (const t of state.tasks.values()) {
        if (getBucket(t) != null) {
          hasAny = true;
          break;
        }
      }
      if (!hasAny) {
        runtime = [];
        headerRowMap = new Map();
        return;
      }

      buildBuckets(state);

      // Filter flatVisibleIds: drop tasks in collapsed buckets
      if (collapsedIds.size > 0) {
        const drop = new Set<string>();
        for (const b of runtime) {
          if (b.collapsed) {
            // Use allTaskIds (source of truth) — taskIds is already
            // visibility-filtered and may be missing entries on subsequent runs
            for (const id of b.allTaskIds) drop.add(id);
          }
        }
        if (drop.size > 0) {
          const filtered = state.flatVisibleIds.filter((id) => !drop.has(id));
          if (filtered.length !== state.flatVisibleIds.length) {
            state.flatVisibleIds.length = 0;
            for (const id of filtered) state.flatVisibleIds.push(id);
          }
        }
      }
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      _layouts: TaskLayout[],
    ): void {
      if (!host || runtime.length === 0) return;

      const { config: cfg, scrollX, scrollY } = state;
      const { theme } = cfg;
      const headerHeight = cfg.headerHeight;
      const rowHeight = cfg.rowHeight;
      const gridWidth = cfg.gridWidth;
      const timeScale = host.getTimeScale();
      const dpr = window.devicePixelRatio || 1;
      const canvasWidth = ctx.canvas.width / dpr;
      const bodyHeight = ctx.canvas.height / dpr - headerHeight;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, headerHeight, canvasWidth, bodyHeight);
      ctx.clip();

      // Compute row positions: ungrouped tasks first, then bucket-by-bucket
      let rowIndex = 0;

      // Ungrouped tasks (those not in any bucket) come first
      const ungroupedCount = countUngrouped(state);
      rowIndex = ungroupedCount;

      headerRowMap = new Map();

      for (const bucket of runtime) {
        if (bucket.allTaskIds.length === 0) continue; // skip empty buckets
        const headerRow = rowIndex;
        const y = headerHeight + headerRow * rowHeight - scrollY;

        // Track for click hit-testing regardless of visibility
        headerRowMap.set(headerRow, bucket);

        // Only paint if visible
        if (y + rowHeight >= headerHeight && y < headerHeight + bodyHeight) {
          drawBucketHeader(
            ctx,
            bucket,
            y,
            rowHeight,
            canvasWidth,
            gridWidth,
            scrollX,
            timeScale,
            theme,
          );
        }

        rowIndex += 1;
        if (!bucket.collapsed) rowIndex += bucket.taskIds.length;
      }

      ctx.restore();
    },

    destroy(): void {
      if (clickHandler && containerEl) {
        containerEl.removeEventListener('click', clickHandler);
      }
      if (unsubRender) unsubRender();
      host = null;
      containerEl = null;
      clickHandler = null;
      runtime = [];
      headerRowMap = new Map();
      collapsedIds.clear();
    },
  };

  // ── Local helpers ─────────────────────────────────────────────────────
  function countUngrouped(state: GanttState): number {
    let n = 0;
    for (const id of state.flatVisibleIds) {
      const t = state.tasks.get(id);
      if (!t) continue;
      const b = getBucket(t);
      if (!b || !bucketIndexById.has(b)) n++;
    }
    return n;
  }

  function drawBucketHeader(
    ctx: CanvasRenderingContext2D,
    bucket: BucketRuntime,
    y: number,
    rowHeight: number,
    canvasWidth: number,
    gridWidth: number,
    scrollX: number,
    timeScale: TimeScaleAPI,
    theme: { fontFamily: string; fontSize: number },
  ): void {
    const { config: bcfg, taskIds, progress, collapsed, totalHours } = bucket;

    // ── Row background tint (full width) ──────────────────────────────
    if (bcfg.bgTint) {
      ctx.fillStyle = bcfg.bgTint;
      ctx.fillRect(0, y, canvasWidth, rowHeight);
    }

    // Bottom border for separation
    ctx.beginPath();
    ctx.strokeStyle = HEADER_BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.moveTo(0, Math.round(y + rowHeight) + 0.5);
    ctx.lineTo(canvasWidth, Math.round(y + rowHeight) + 0.5);
    ctx.stroke();

    // Left color strip — the bucket's accent color
    ctx.fillStyle = bcfg.color;
    ctx.fillRect(0, y, COLOR_STRIP_WIDTH, rowHeight);

    // ── GRID AREA: label + count + chevron (clipped to gridWidth) ─────
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, gridWidth, rowHeight);
    ctx.clip();

    const labelY = y + rowHeight / 2;

    // Label "NOW" / "NEXT" / etc
    ctx.font = `700 ${theme.fontSize}px ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = bcfg.color;
    ctx.fillText(bcfg.label, LABEL_LEFT_MARGIN, labelY);
    const labelWidth = ctx.measureText(bcfg.label).width;

    // Count "5"
    ctx.font = `${theme.fontSize - 1}px ${theme.fontFamily}`;
    ctx.fillStyle = HEADER_TEXT_COLOR_FALLBACK;
    const countText = `${taskIds.length}`;
    const countX = LABEL_LEFT_MARGIN + labelWidth + COUNT_BADGE_GAP;
    ctx.fillText(countText, countX, labelY);

    // Chevron at the right edge of the grid area
    const chevronX = gridWidth - CHEVRON_RIGHT_MARGIN;
    ctx.beginPath();
    ctx.fillStyle = bcfg.color;
    if (collapsed) {
      ctx.moveTo(chevronX - CHEVRON_SIZE, labelY - CHEVRON_SIZE);
      ctx.lineTo(chevronX, labelY);
      ctx.lineTo(chevronX - CHEVRON_SIZE, labelY + CHEVRON_SIZE);
    } else {
      ctx.moveTo(chevronX - CHEVRON_SIZE, labelY - CHEVRON_SIZE / 2);
      ctx.lineTo(chevronX, labelY - CHEVRON_SIZE / 2);
      ctx.lineTo(chevronX - CHEVRON_SIZE / 2, labelY + CHEVRON_SIZE);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // ── TIMELINE AREA: span bar from min start to max end ─────────────
    if (bucket.startDate && bucket.endDate) {
      ctx.save();
      // Clip to the timeline portion of the row
      ctx.beginPath();
      ctx.rect(gridWidth, y, canvasWidth - gridWidth, rowHeight);
      ctx.clip();

      // Convert dates → canvas x. dateToX returns timeline-local pixels
      // (relative to the timeline start), so we add gridWidth and subtract scroll.
      const startTlX = timeScale.dateToX(bucket.startDate);
      const endTlX = timeScale.dateToX(bucket.endDate);
      const canvasStartX = gridWidth + startTlX - scrollX;
      const canvasEndX = gridWidth + endTlX - scrollX;
      const spanW = Math.max(2, canvasEndX - canvasStartX);

      // Span bar dimensions — slightly slimmer than the row so the
      // tinted background still shows above/below
      const barHeight = Math.min(rowHeight - 8, 18);
      const barY = y + (rowHeight - barHeight) / 2;
      const radius = Math.min(barHeight / 2, 5);

      // Track (lighter version of bucket color)
      ctx.fillStyle = bcfg.color;
      ctx.globalAlpha = 0.35;
      drawRoundedRect(ctx, canvasStartX, barY, spanW, barHeight, radius);
      ctx.fill();

      // Progress fill (full opacity, clipped to progress fraction)
      ctx.globalAlpha = 1;
      ctx.fillStyle = bcfg.color;
      const progressW = spanW * progress;
      if (progressW > 1) {
        ctx.save();
        // Clip to progress portion to keep rounded edges crisp
        ctx.beginPath();
        ctx.rect(canvasStartX, barY, progressW, barHeight);
        ctx.clip();
        drawRoundedRect(ctx, canvasStartX, barY, spanW, barHeight, radius);
        ctx.fill();
        ctx.restore();
      }

      // Inline label inside the bar: "120h (45%)" — only if it fits
      const labelText =
        totalHours > 0
          ? `${totalHours}h (${Math.round(progress * 100)}%)`
          : `${Math.round(progress * 100)}%`;
      ctx.font = `700 ${theme.fontSize - 1}px ${theme.fontFamily}`;
      const labelTextWidth = ctx.measureText(labelText).width;
      if (labelTextWidth + 12 < spanW) {
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(labelText, canvasStartX + 8, y + rowHeight / 2);
      }

      ctx.restore();
    }
  }

  function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }
}

// ─── Pre-built bucket palette for the cloud-nimbus pro-forma use case ───────
//
// These match the v4 page's GROUP_COLORS / GROUP_LABELS / GROUP_BG so the
// LWC version is visually identical to the cloudnimbusllc.com version.
// Consumers can pass their own buckets — these are just a convenient default.

export const CLOUD_NIMBUS_PRIORITY_BUCKETS: PriorityBucket[] = [
  { id: 'top-priority', label: 'NOW',      color: '#dc2626', bgTint: '#fef2f2', order: 0 },
  { id: 'active',       label: 'NEXT',     color: '#d97706', bgTint: '#fffbeb', order: 1 },
  { id: 'follow-on',    label: 'PLANNED',  color: '#059669', bgTint: '#ecfdf5', order: 2 },
  { id: 'proposed',     label: 'PROPOSED', color: '#2563eb', bgTint: '#eff6ff', order: 3 },
  { id: 'deferred',     label: 'HOLD',     color: '#94a3b8', bgTint: '#f8fafc', order: 4 },
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
    // No hours metadata — fall back to arithmetic mean of progress
    if (tasks.length === 0) return 0;
    let sum = 0;
    for (const t of tasks) sum += t.progress ?? 0;
    return sum / tasks.length;
  }
  return totalHigh > 0 ? Math.min(totalLogged / totalHigh, 1) : 0;
}
