// ─── Critical Path Method (CPM) Plugin ──────────────────────────────────────
// Implements the forward/backward pass algorithm on the dependency DAG to
// identify the critical path — the longest sequence of dependent tasks that
// determines the minimum project duration. Tasks on the critical path have
// zero total float; any delay to them delays the entire project.
//
// Algorithm: Kahn's topological sort for both passes, O(V + E) time.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  GanttDependency,
  TaskLayout,
  Action,
} from '../model/types';

// ─── Public Data Structures ────────────────────────────────────────────────

export interface TaskCPMAnalysis {
  earlyStart: Date;
  earlyFinish: Date;
  lateStart: Date;
  lateFinish: Date;
  totalFloat: number; // in days
  isCritical: boolean;
}

export interface CPMResult {
  criticalTaskIds: Set<string>;
  criticalDependencyIds: Set<string>;
  taskAnalysis: Map<string, TaskCPMAnalysis>;
  projectDuration: number; // days
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const CRITICAL_GLOW_BLUR = 6;
const CRITICAL_GLOW_PASSES = 2;
const CRITICAL_BORDER_WIDTH = 2;
const FLOAT_BAR_OPACITY = 0.18;
const FLOAT_BAR_HEIGHT_RATIO = 0.4;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD to UTC Date, matching LayoutEngine.parseDate */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

/** Difference in days between two UTC dates (end - start) */
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Add days to a UTC date, returning a new Date */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// ─── CPM Computation ───────────────────────────────────────────────────────

function computeCPM(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
): CPMResult {
  const taskIds = Array.from(tasks.keys());

  if (taskIds.length === 0) {
    return {
      criticalTaskIds: new Set(),
      criticalDependencyIds: new Set(),
      taskAnalysis: new Map(),
      projectDuration: 0,
    };
  }

  // ── Build adjacency lists ─────────────────────────────────────────────
  // successors: source → [{target, lag, depId}]
  // predecessors: target → [{source, lag, depId}]
  const successors = new Map<string, Array<{ target: string; lag: number; depId: string }>>();
  const predecessors = new Map<string, Array<{ source: string; lag: number; depId: string }>>();
  const inDegree = new Map<string, number>();

  for (const id of taskIds) {
    successors.set(id, []);
    predecessors.set(id, []);
    inDegree.set(id, 0);
  }

  // Only process Finish-to-Start dependencies for CPM.
  // FS is the standard CPM relationship: successor cannot start
  // until predecessor finishes (+ lag).
  for (const dep of dependencies.values()) {
    const type = dep.type || 'FS';
    if (type !== 'FS') continue;

    // Skip dependencies that reference tasks not in our set
    if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;

    const lag = dep.lag || 0;
    successors.get(dep.source)!.push({ target: dep.target, lag, depId: dep.id });
    predecessors.get(dep.target)!.push({ source: dep.source, lag, depId: dep.id });
    inDegree.set(dep.target, (inDegree.get(dep.target) || 0) + 1);
  }

  // ── Compute durations ─────────────────────────────────────────────────
  const duration = new Map<string, number>();
  const taskStart = new Map<string, Date>();
  const taskEnd = new Map<string, Date>();

  for (const [id, task] of tasks) {
    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    taskStart.set(id, start);
    taskEnd.set(id, end);
    duration.set(id, Math.max(diffDays(start, end), 0));
  }

  // ── Forward Pass (Kahn's algorithm) ───────────────────────────────────
  // Compute Earliest Start (ES) and Earliest Finish (EF) for each task.
  const earlyStart = new Map<string, Date>();
  const earlyFinish = new Map<string, Date>();
  const topoOrder: string[] = [];

  // Initialize queue with root tasks (in-degree 0)
  const queue: string[] = [];
  const workingInDegree = new Map(inDegree);

  for (const id of taskIds) {
    if (workingInDegree.get(id) === 0) {
      queue.push(id);
      // Root tasks: ES = their actual start date
      earlyStart.set(id, taskStart.get(id)!);
      earlyFinish.set(id, taskEnd.get(id)!);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);

    const es = earlyStart.get(current)!;
    const ef = earlyFinish.get(current)!;

    for (const edge of successors.get(current)!) {
      const { target, lag } = edge;

      // Successor's ES = max(current ES, max of all predecessor EF + lag)
      const candidateES = addDays(ef, lag);
      const existingES = earlyStart.get(target);

      if (!existingES || candidateES.getTime() > existingES.getTime()) {
        earlyStart.set(target, candidateES);
        // EF = ES + duration
        earlyFinish.set(target, addDays(candidateES, duration.get(target)!));
      }

      const newDeg = workingInDegree.get(target)! - 1;
      workingInDegree.set(target, newDeg);
      if (newDeg === 0) {
        queue.push(target);
      }
    }
  }

  // Handle tasks that weren't reached by the topological sort (cycles or
  // disconnected without dependencies). Give them their actual dates.
  for (const id of taskIds) {
    if (!earlyStart.has(id)) {
      earlyStart.set(id, taskStart.get(id)!);
      earlyFinish.set(id, taskEnd.get(id)!);
      topoOrder.push(id);
    }
  }

  // ── Project finish = max of all EF values ─────────────────────────────
  let projectFinishTime = -Infinity;
  for (const ef of earlyFinish.values()) {
    if (ef.getTime() > projectFinishTime) {
      projectFinishTime = ef.getTime();
    }
  }
  const projectFinish = new Date(projectFinishTime);

  // Find earliest start across all tasks for project duration calculation
  let projectStartTime = Infinity;
  for (const es of earlyStart.values()) {
    if (es.getTime() < projectStartTime) {
      projectStartTime = es.getTime();
    }
  }
  const projectStart = new Date(projectStartTime);
  const projectDuration = diffDays(projectStart, projectFinish);

  // ── Backward Pass ─────────────────────────────────────────────────────
  // Compute Latest Finish (LF) and Latest Start (LS) for each task.
  const lateStart = new Map<string, Date>();
  const lateFinish = new Map<string, Date>();

  // Initialize: tasks with no successors get LF = projectFinish
  for (const id of taskIds) {
    const succs = successors.get(id)!;
    if (succs.length === 0) {
      lateFinish.set(id, projectFinish);
      lateStart.set(id, addDays(projectFinish, -duration.get(id)!));
    }
  }

  // Process in reverse topological order
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const current = topoOrder[i];

    // If LF not yet set (has successors), compute from successors
    if (!lateFinish.has(current)) {
      let minSuccessorLS = Infinity;
      for (const edge of successors.get(current)!) {
        const successorLS = lateStart.get(edge.target);
        if (successorLS) {
          const candidateLF = addDays(successorLS, -edge.lag);
          if (candidateLF.getTime() < minSuccessorLS) {
            minSuccessorLS = candidateLF.getTime();
          }
        }
      }

      if (minSuccessorLS === Infinity) {
        // No successors had LS yet (shouldn't happen in valid topo order)
        lateFinish.set(current, projectFinish);
      } else {
        lateFinish.set(current, new Date(minSuccessorLS));
      }
      lateStart.set(current, addDays(lateFinish.get(current)!, -duration.get(current)!));
    }
  }

  // Handle any tasks not yet processed (disconnected graph)
  for (const id of taskIds) {
    if (!lateFinish.has(id)) {
      lateFinish.set(id, projectFinish);
      lateStart.set(id, addDays(projectFinish, -duration.get(id)!));
    }
  }

  // ── Compute Float & Identify Critical Path ────────────────────────────
  const FLOAT_EPSILON = 0.5; // Half-day tolerance for floating point
  const criticalTaskIds = new Set<string>();
  const taskAnalysis = new Map<string, TaskCPMAnalysis>();

  for (const id of taskIds) {
    const es = earlyStart.get(id)!;
    const ef = earlyFinish.get(id)!;
    const ls = lateStart.get(id)!;
    const lf = lateFinish.get(id)!;

    const totalFloat = diffDays(es, ls); // LS - ES in days
    const isCritical = Math.abs(totalFloat) < FLOAT_EPSILON;

    if (isCritical) {
      criticalTaskIds.add(id);
    }

    taskAnalysis.set(id, {
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat,
      isCritical,
    });
  }

  // ── Identify Critical Dependencies ────────────────────────────────────
  // A dependency is critical if both its source and target are on the
  // critical path.
  const criticalDependencyIds = new Set<string>();
  for (const dep of dependencies.values()) {
    const type = dep.type || 'FS';
    if (type !== 'FS') continue;
    if (criticalTaskIds.has(dep.source) && criticalTaskIds.has(dep.target)) {
      criticalDependencyIds.add(dep.id);
    }
  }

  return {
    criticalTaskIds,
    criticalDependencyIds,
    taskAnalysis,
    projectDuration,
  };
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function CriticalPathPlugin(): NimbusGanttPlugin {
  let host: PluginHost;
  let cpmResult: CPMResult | null = null;
  let unsubscribers: Array<() => void> = [];

  /** Recompute the critical path from current state */
  function recalculate(): void {
    const state = host.getState();
    cpmResult = computeCPM(state.tasks, state.dependencies);
  }

  return {
    name: 'CriticalPathPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Initial calculation
      recalculate();

      // Recalculate when relevant actions occur
      unsubscribers.push(
        host.on('stateChange', () => {
          // We recalculate on every state change for simplicity.
          // The CPM algorithm is O(V+E), fast enough for typical datasets.
          recalculate();
        }),
      );
    },

    middleware(action: Action, next: (action: Action) => void): void {
      // Pass action through, then recalculate after state updates
      next(action);

      const relevantActions: Action['type'][] = [
        'SET_DATA',
        'TASK_MOVE',
        'TASK_RESIZE',
        'ADD_DEPENDENCY',
        'REMOVE_DEPENDENCY',
        'ADD_TASK',
        'REMOVE_TASK',
        'UPDATE_TASK',
      ];

      if (relevantActions.includes(action.type)) {
        recalculate();
      }
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!cpmResult || cpmResult.criticalTaskIds.size === 0) return;

      const { theme, headerHeight, rowHeight, barHeight } = state.config;
      const criticalColor = theme.criticalPathColor || '#E53E3E';
      const scrollX = state.scrollX;
      const scrollY = state.scrollY;
      const bodyTop = headerHeight;
      const timeScale = host.getTimeScale();

      // Build layout map for dependency rendering
      const layoutMap = new Map<string, TaskLayout>();
      for (const layout of layouts) {
        layoutMap.set(layout.taskId, layout);
      }

      ctx.save();

      // ── Apply the same transform as the main renderer ─────────────
      // The ctx at this point has DPI scaling and body clip already applied
      // by the orchestrator, but we're called AFTER the main render, so the
      // ctx transform may have been restored. We need to match the body
      // coordinate system: translated by -scrollX horizontally.
      // Note: the orchestrator calls plugin.renderCanvas with the raw ctx
      // after restoring from body clip, so we must set up our own clip+translate.

      ctx.beginPath();
      ctx.rect(0, bodyTop, ctx.canvas.width, ctx.canvas.height - bodyTop);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      // ── Render float indicators ───────────────────────────────────
      for (const layout of layouts) {
        const analysis = cpmResult.taskAnalysis.get(layout.taskId);
        if (!analysis || analysis.isCritical || analysis.totalFloat <= 0) continue;

        const barY = layout.barY - scrollY;
        const floatBarH = barHeight * FLOAT_BAR_HEIGHT_RATIO;

        // Float indicator: a lighter extension from EF to LF
        const efX = layout.x + layout.width;
        const lfX = timeScale.dateToX(analysis.lateFinish);
        const floatWidth = lfX - efX;

        if (floatWidth > 1) {
          ctx.fillStyle = layout.color;
          ctx.globalAlpha = FLOAT_BAR_OPACITY;
          ctx.fillRect(
            efX,
            barY + barHeight - floatBarH,
            floatWidth,
            floatBarH,
          );
          ctx.globalAlpha = 1.0;
        }
      }

      // ── Render critical path task highlights ──────────────────────
      for (const layout of layouts) {
        if (!cpmResult.criticalTaskIds.has(layout.taskId)) continue;

        const barX = layout.x;
        const barY = layout.barY - scrollY;
        const barW = layout.width;
        const barH = layout.barHeight;

        // Skip bars outside visible area
        if (barY + barH < bodyTop || barY > ctx.canvas.height) continue;

        // Glow effect
        ctx.save();
        ctx.shadowColor = criticalColor;
        ctx.shadowBlur = CRITICAL_GLOW_BLUR;

        for (let pass = 0; pass < CRITICAL_GLOW_PASSES; pass++) {
          ctx.strokeStyle = criticalColor;
          ctx.lineWidth = CRITICAL_BORDER_WIDTH;
          ctx.beginPath();
          const r = theme.barBorderRadius;
          const radius = Math.min(r, barW / 2, barH / 2);
          ctx.moveTo(barX + radius, barY);
          ctx.lineTo(barX + barW - radius, barY);
          ctx.arcTo(barX + barW, barY, barX + barW, barY + radius, radius);
          ctx.lineTo(barX + barW, barY + barH - radius);
          ctx.arcTo(barX + barW, barY + barH, barX + barW - radius, barY + barH, radius);
          ctx.lineTo(barX + radius, barY + barH);
          ctx.arcTo(barX, barY + barH, barX, barY + barH - radius, radius);
          ctx.lineTo(barX, barY + radius);
          ctx.arcTo(barX, barY, barX + radius, barY, radius);
          ctx.closePath();
          ctx.stroke();
        }

        ctx.restore();
      }

      // ── Render critical dependency arrows ─────────────────────────
      const ARROW_SIZE = 6;
      const ARROW_HALF = 4;
      const GAP = 12;

      for (const dep of state.dependencies.values()) {
        if (!cpmResult.criticalDependencyIds.has(dep.id)) continue;

        const sourceLayout = layoutMap.get(dep.source);
        const targetLayout = layoutMap.get(dep.target);
        if (!sourceLayout || !targetLayout) continue;

        const sourceX = sourceLayout.x + sourceLayout.width;
        const sourceY = sourceLayout.barY + sourceLayout.barHeight / 2 - scrollY;
        const targetX = targetLayout.x;
        const targetY = targetLayout.barY + targetLayout.barHeight / 2 - scrollY;

        // Draw the red critical-path arrow over the default one
        ctx.beginPath();
        ctx.strokeStyle = criticalColor;
        ctx.lineWidth = theme.dependencyWidth + 1;

        const midX = sourceX + GAP;
        const approachX = targetX - GAP;

        ctx.moveTo(sourceX, sourceY);

        if (approachX >= midX) {
          // L-shape
          ctx.lineTo(midX, sourceY);
          ctx.lineTo(midX, targetY);
          ctx.lineTo(targetX, targetY);
        } else {
          // S-shape
          const midY = (sourceY + targetY) / 2;
          ctx.lineTo(midX, sourceY);
          ctx.lineTo(midX, midY);
          ctx.lineTo(approachX, midY);
          ctx.lineTo(approachX, targetY);
          ctx.lineTo(targetX, targetY);
        }

        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(targetX, targetY);
        ctx.lineTo(targetX - ARROW_SIZE, targetY - ARROW_HALF);
        ctx.lineTo(targetX - ARROW_SIZE, targetY + ARROW_HALF);
        ctx.closePath();
        ctx.fillStyle = criticalColor;
        ctx.fill();
      }

      ctx.restore();
    },

    destroy(): void {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers = [];
      cpmResult = null;
    },
  };
}

// ─── Export the computation for testing / external use ──────────────────────

export { computeCPM };
