// ─── Auto-Schedule Plugin ──────────────────────────────────────────────────
// Constraint-based scheduling engine that automatically calculates task dates
// based on dependencies, constraints, and resource availability.
//
// Implements a full forward/backward pass algorithm supporting all eight
// Microsoft Project constraint types (ASAP, ALAP, SNET, SNLT, FNET, FNLT,
// MSO, MFO) and all four dependency types (FS, SS, FF, SF) with lag.
//
// Algorithm: Kahn's topological sort + forward pass + selective backward pass
// for ALAP-constrained tasks. O(V + E) time.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttTask,
  GanttDependency,
  DependencyType,
  Action,
} from '../model/types';

// ─── Public Data Structures ───────────────────────────────────────────────

export interface ScheduleConstraint {
  type: 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
  // ASAP: As Soon As Possible (default)
  // ALAP: As Late As Possible
  // SNET: Start No Earlier Than (date)
  // SNLT: Start No Later Than (date)
  // FNET: Finish No Earlier Than (date)
  // FNLT: Finish No Later Than (date)
  // MSO: Must Start On (date)
  // MFO: Must Finish On (date)
  date?: string; // Required for SNET, SNLT, FNET, FNLT, MSO, MFO
}

export interface ScheduleResult {
  scheduledTasks: Map<string, { startDate: string; endDate: string }>;
  violations: ScheduleViolation[];
  projectStart: string;
  projectEnd: string;
  totalDuration: number; // working days
}

export interface ScheduleViolation {
  taskId: string;
  type: 'constraint' | 'dependency' | 'circular' | 'resource';
  message: string;
}

export interface AutoScheduleOptions {
  projectStart?: string;           // Project start date (default: earliest task)
  direction?: 'forward' | 'backward';  // Schedule from start or from deadline
  constraints?: Map<string, ScheduleConstraint>;
  respectWorkCalendar?: boolean;   // Skip weekends/holidays if WorkCalendarPlugin installed
}

// ─── Constants ────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

// ─── Date Helpers ─────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD to UTC Date */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date as YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Compute the number of calendar days between two ISO date strings (end - start) */
function daysBetween(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / MS_PER_DAY);
}

/** Add calendar days to an ISO date string, returning a new ISO date string */
function addCalendarDays(date: string, days: number): string {
  return formatDate(new Date(parseDate(date).getTime() + days * MS_PER_DAY));
}

// ─── Work Calendar Bridge ─────────────────────────────────────────────────
// When respectWorkCalendar is enabled, we call into the WorkCalendarPlugin
// via the event system to get working-day-aware date arithmetic.

interface CalendarBridge {
  addDays(start: string, days: number): string;
  daysBetween(start: string, end: string): number;
}

function createCalendarDayBridge(): CalendarBridge {
  return {
    addDays: addCalendarDays,
    daysBetween,
  };
}

/**
 * Try to call the WorkCalendarPlugin via the host's event emitter.
 * The WorkCalendarPlugin registers synchronous handlers via gantt.on()
 * that accept a callback as their last argument. If the host exposes an
 * emit() method (common in event-emitter-based plugin hosts), we can
 * invoke those handlers directly.
 */
function tryEmit(host: PluginHost, event: string, ...args: unknown[]): boolean {
  try {
    const hostAny = host as unknown as Record<string, unknown>;
    if (typeof hostAny['emit'] === 'function') {
      (hostAny['emit'] as (event: string, ...args: unknown[]) => void)(event, ...args);
      return true;
    }
  } catch {
    // emit not available or threw
  }
  return false;
}

// ─── Dependency Graph ─────────────────────────────────────────────────────

interface DependencyEdge {
  source: string;
  target: string;
  type: DependencyType;
  lag: number;
  depId: string;
}

interface DependencyGraph {
  /** source → outgoing edges */
  successors: Map<string, DependencyEdge[]>;
  /** target → incoming edges */
  predecessors: Map<string, DependencyEdge[]>;
  /** task → number of incoming dependency edges */
  inDegree: Map<string, number>;
  /** task IDs involved in cycles */
  circularTaskIds: Set<string>;
  /** Topologically sorted task IDs (excludes circular tasks) */
  topoOrder: string[];
}

/**
 * Build the dependency graph from tasks and dependencies.
 * Detects circular dependencies via DFS cycle detection.
 */
function buildDependencyGraph(
  taskIds: Set<string>,
  dependencies: Map<string, GanttDependency>,
): DependencyGraph {
  const successors = new Map<string, DependencyEdge[]>();
  const predecessors = new Map<string, DependencyEdge[]>();
  const inDegree = new Map<string, number>();

  for (const id of taskIds) {
    successors.set(id, []);
    predecessors.set(id, []);
    inDegree.set(id, 0);
  }

  // Build adjacency lists — include all dependency types
  for (const dep of dependencies.values()) {
    // Skip dependencies referencing tasks not in our set
    if (!taskIds.has(dep.source) || !taskIds.has(dep.target)) continue;

    const edge: DependencyEdge = {
      source: dep.source,
      target: dep.target,
      type: dep.type || 'FS',
      lag: dep.lag || 0,
      depId: dep.id,
    };

    successors.get(dep.source)!.push(edge);
    predecessors.get(dep.target)!.push(edge);
    inDegree.set(dep.target, (inDegree.get(dep.target) || 0) + 1);
  }

  // ── Circular dependency detection via DFS ──────────────────────────────
  // We use Kahn's algorithm — any tasks remaining after processing have
  // in-degree > 0, which means they're part of a cycle.

  const workingInDegree = new Map(inDegree);
  const queue: string[] = [];
  const topoOrder: string[] = [];

  for (const id of taskIds) {
    if (workingInDegree.get(id) === 0) {
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    topoOrder.push(current);

    for (const edge of successors.get(current)!) {
      const newDeg = workingInDegree.get(edge.target)! - 1;
      workingInDegree.set(edge.target, newDeg);
      if (newDeg === 0) {
        queue.push(edge.target);
      }
    }
  }

  // Tasks not in topoOrder are part of cycles
  const circularTaskIds = new Set<string>();
  for (const id of taskIds) {
    if (!topoOrder.includes(id)) {
      circularTaskIds.add(id);
    }
  }

  return { successors, predecessors, inDegree, circularTaskIds, topoOrder };
}

// ─── Schedule Computation ────────────────────────────────────────────────

function computeSchedule(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
  options: AutoScheduleOptions,
  calendar: CalendarBridge,
): ScheduleResult {
  const taskIds = new Set(tasks.keys());
  const violations: ScheduleViolation[] = [];
  const scheduledTasks = new Map<string, { startDate: string; endDate: string }>();

  if (taskIds.size === 0) {
    return {
      scheduledTasks,
      violations,
      projectStart: options.projectStart || formatDate(new Date()),
      projectEnd: options.projectStart || formatDate(new Date()),
      totalDuration: 0,
    };
  }

  const constraints = options.constraints || new Map<string, ScheduleConstraint>();

  // ── Phase 1: Build the dependency graph ──────────────────────────────
  const graph = buildDependencyGraph(taskIds, dependencies);

  // Report circular dependencies as violations
  for (const taskId of graph.circularTaskIds) {
    const task = tasks.get(taskId);
    violations.push({
      taskId,
      type: 'circular',
      message: `Task "${task?.name || taskId}" is part of a circular dependency chain`,
    });
  }

  // ── Compute task durations ──────────────────────────────────────────
  const duration = new Map<string, number>();
  for (const [id, task] of tasks) {
    const d = calendar.daysBetween(task.startDate, task.endDate);
    duration.set(id, Math.max(d, 0));
  }

  // ── Determine project start date ───────────────────────────────────
  let projStart: string;
  if (options.projectStart) {
    projStart = options.projectStart;
  } else {
    // Use earliest task start date
    let earliest = Infinity;
    for (const task of tasks.values()) {
      const t = parseDate(task.startDate).getTime();
      if (t < earliest) earliest = t;
    }
    projStart = formatDate(new Date(earliest));
  }

  // ── Phase 2 & 3: Forward pass with constraints ─────────────────────
  // Process tasks in topological order. Tasks in cycles keep their original dates.
  const earlyStart = new Map<string, string>();
  const earlyFinish = new Map<string, string>();
  const isALAP = new Set<string>();

  // Initialize all tasks with their existing dates (fallback for circular tasks)
  for (const [id, task] of tasks) {
    earlyStart.set(id, task.startDate);
    earlyFinish.set(id, task.endDate);
  }

  // Process tasks in topological order
  for (const taskId of graph.topoOrder) {
    const task = tasks.get(taskId)!;
    const dur = duration.get(taskId)!;
    const constraint = constraints.get(taskId);
    const preds = graph.predecessors.get(taskId)!;

    // ── Step 1: Compute earliest start from dependencies ──────────
    let es: string;

    if (preds.length === 0) {
      // No predecessors: start at project start
      es = projStart;
    } else {
      // Compute ES from each predecessor based on dependency type
      let maxES = projStart;

      for (const edge of preds) {
        // Skip predecessors that are in cycles (use their original dates)
        const predES = earlyStart.get(edge.source)!;
        const predEF = earlyFinish.get(edge.source)!;
        let candidateES: string;

        switch (edge.type) {
          case 'FS':
            // Finish-to-Start: successor starts after predecessor finishes + lag
            candidateES = calendar.addDays(predEF, edge.lag);
            break;

          case 'SS':
            // Start-to-Start: successor starts after predecessor starts + lag
            candidateES = calendar.addDays(predES, edge.lag);
            break;

          case 'FF': {
            // Finish-to-Finish: successor finishes after predecessor finishes + lag
            // So: successor.start = predecessor.finish + lag - successor.duration
            const requiredFinish = calendar.addDays(predEF, edge.lag);
            candidateES = calendar.addDays(requiredFinish, -dur);
            break;
          }

          case 'SF': {
            // Start-to-Finish: successor finishes after predecessor starts + lag
            // So: successor.start = predecessor.start + lag - successor.duration
            const requiredFinish = calendar.addDays(predES, edge.lag);
            candidateES = calendar.addDays(requiredFinish, -dur);
            break;
          }

          default:
            candidateES = calendar.addDays(predEF, edge.lag);
        }

        if (parseDate(candidateES).getTime() > parseDate(maxES).getTime()) {
          maxES = candidateES;
        }
      }

      es = maxES;
    }

    // ── Step 2: Apply constraint ──────────────────────────────────
    if (constraint) {
      switch (constraint.type) {
        case 'ASAP':
          // Use computed ES — no adjustment needed
          break;

        case 'ALAP':
          // Mark for backward pass processing
          isALAP.add(taskId);
          break;

        case 'SNET':
          // Start No Earlier Than: ES = max(ES, constraint.date)
          if (constraint.date && parseDate(es).getTime() < parseDate(constraint.date).getTime()) {
            es = constraint.date;
          }
          break;

        case 'SNLT':
          // Start No Later Than: violation if ES > constraint.date
          if (constraint.date && parseDate(es).getTime() > parseDate(constraint.date).getTime()) {
            violations.push({
              taskId,
              type: 'constraint',
              message: `Task "${task.name}" cannot start by ${constraint.date} (earliest possible: ${es}). ` +
                `SNLT constraint violated.`,
            });
          }
          break;

        case 'MSO':
          // Must Start On: override start date (may conflict with deps)
          if (constraint.date) {
            if (parseDate(es).getTime() > parseDate(constraint.date).getTime()) {
              violations.push({
                taskId,
                type: 'constraint',
                message: `Task "${task.name}" has MSO constraint ${constraint.date} but dependencies ` +
                  `require start no earlier than ${es}.`,
              });
            }
            es = constraint.date;
          }
          break;

        case 'FNET': {
          // Finish No Earlier Than: ES = max(ES, constraint.date - duration)
          if (constraint.date) {
            const minStart = calendar.addDays(constraint.date, -dur);
            if (parseDate(es).getTime() < parseDate(minStart).getTime()) {
              es = minStart;
            }
          }
          break;
        }

        case 'FNLT': {
          // Finish No Later Than: violation if EF > constraint.date
          if (constraint.date) {
            const ef = calendar.addDays(es, dur);
            if (parseDate(ef).getTime() > parseDate(constraint.date).getTime()) {
              violations.push({
                taskId,
                type: 'constraint',
                message: `Task "${task.name}" cannot finish by ${constraint.date} (earliest finish: ${ef}). ` +
                  `FNLT constraint violated.`,
              });
            }
          }
          break;
        }

        case 'MFO':
          // Must Finish On: ES = constraint.date - duration
          if (constraint.date) {
            const requiredStart = calendar.addDays(constraint.date, -dur);
            if (parseDate(es).getTime() > parseDate(requiredStart).getTime()) {
              violations.push({
                taskId,
                type: 'constraint',
                message: `Task "${task.name}" has MFO constraint ${constraint.date} but dependencies ` +
                  `require start no earlier than ${es} (finish would be ${calendar.addDays(es, dur)}).`,
              });
            }
            es = requiredStart;
          }
          break;
      }
    }

    // ── Step 3: Compute end date ──────────────────────────────────
    const ef = calendar.addDays(es, dur);

    earlyStart.set(taskId, es);
    earlyFinish.set(taskId, ef);
  }

  // ── Phase 4: Backward pass for ALAP tasks ──────────────────────────
  // ALAP tasks should be scheduled as late as possible without delaying
  // their successors.
  if (isALAP.size > 0) {
    // Determine project end (max of all early finishes)
    let maxFinishTime = -Infinity;
    for (const ef of earlyFinish.values()) {
      const t = parseDate(ef).getTime();
      if (t > maxFinishTime) maxFinishTime = t;
    }
    const projectEnd = formatDate(new Date(maxFinishTime));

    // Process ALAP tasks in reverse topological order
    for (let i = graph.topoOrder.length - 1; i >= 0; i--) {
      const taskId = graph.topoOrder[i];
      if (!isALAP.has(taskId)) continue;

      const dur = duration.get(taskId)!;
      const succs = graph.successors.get(taskId)!;

      let latestStart: string;

      if (succs.length === 0) {
        // No successors: push to project end
        latestStart = calendar.addDays(projectEnd, -dur);
      } else {
        // Find the latest start that doesn't delay any successor
        let minSuccTime = Infinity;

        for (const edge of succs) {
          const succES = earlyStart.get(edge.target)!;
          let candidateFinish: string;

          switch (edge.type) {
            case 'FS':
              // This task must finish before successor starts - lag
              candidateFinish = calendar.addDays(succES, -edge.lag);
              break;

            case 'SS':
              // This task must start before successor starts - lag
              // So latest finish = successor.start - lag + duration
              candidateFinish = calendar.addDays(
                calendar.addDays(succES, -edge.lag),
                dur,
              );
              break;

            case 'FF':
              // This task must finish before successor finishes - lag
              candidateFinish = calendar.addDays(
                earlyFinish.get(edge.target)!,
                -edge.lag,
              );
              break;

            case 'SF':
              // This task must start before successor finishes - lag
              // So latest finish = successor.finish - lag + duration
              candidateFinish = calendar.addDays(
                calendar.addDays(earlyFinish.get(edge.target)!, -edge.lag),
                dur,
              );
              break;

            default:
              candidateFinish = calendar.addDays(succES, -edge.lag);
          }

          const candidateStart = calendar.addDays(candidateFinish, -dur);
          const t = parseDate(candidateStart).getTime();
          if (t < minSuccTime) minSuccTime = t;
        }

        latestStart = formatDate(new Date(minSuccTime));
      }

      // Don't schedule earlier than the forward-pass ES (respect dependency constraints)
      const forwardES = earlyStart.get(taskId)!;
      if (parseDate(latestStart).getTime() < parseDate(forwardES).getTime()) {
        latestStart = forwardES;
      }

      earlyStart.set(taskId, latestStart);
      earlyFinish.set(taskId, calendar.addDays(latestStart, dur));
    }
  }

  // ── Build the result ───────────────────────────────────────────────
  for (const taskId of taskIds) {
    scheduledTasks.set(taskId, {
      startDate: earlyStart.get(taskId)!,
      endDate: earlyFinish.get(taskId)!,
    });
  }

  // Compute project bounds
  let projectStartTime = Infinity;
  let projectEndTime = -Infinity;

  for (const { startDate, endDate } of scheduledTasks.values()) {
    const st = parseDate(startDate).getTime();
    const et = parseDate(endDate).getTime();
    if (st < projectStartTime) projectStartTime = st;
    if (et > projectEndTime) projectEndTime = et;
  }

  const finalProjectStart = formatDate(new Date(projectStartTime));
  const finalProjectEnd = formatDate(new Date(projectEndTime));
  const totalDuration = calendar.daysBetween(finalProjectStart, finalProjectEnd);

  return {
    scheduledTasks,
    violations,
    projectStart: finalProjectStart,
    projectEnd: finalProjectEnd,
    totalDuration,
  };
}

// ─── Plugin Factory ──────────────────────────────────────────────────────

export function AutoSchedulePlugin(options?: AutoScheduleOptions): NimbusGanttPlugin {
  const opts: AutoScheduleOptions = {
    direction: 'forward',
    respectWorkCalendar: false,
    ...options,
  };

  let host: PluginHost;
  let calendar: CalendarBridge;
  let lastResult: ScheduleResult | null = null;
  let unsubscribers: Array<() => void> = [];

  // ── Calendar bridge initialization ─────────────────────────────────
  // If respectWorkCalendar is true, we try to use the WorkCalendarPlugin's
  // functions via the event system. We probe by registering a test call —
  // if the callback fires synchronously, the WorkCalendarPlugin is installed.

  function initCalendarBridge(): void {
    if (!opts.respectWorkCalendar) {
      calendar = createCalendarDayBridge();
      return;
    }

    // Probe for WorkCalendarPlugin by emitting a test call.
    // The WorkCalendarPlugin registers synchronous handlers via host.on() that
    // invoke a callback with the result. If the host exposes emit(), we can
    // call those handlers and capture the result in the closure.
    let probeResult: string | null = null;
    tryEmit(
      host,
      'calendar:addWorkDays',
      '2026-01-05', // probe date (a Monday)
      1,
      (result: string) => { probeResult = result; },
    );

    if (probeResult !== null) {
      // WorkCalendarPlugin is installed and responsive — build a live bridge
      calendar = {
        addDays(start: string, days: number): string {
          let result = addCalendarDays(start, days); // fallback
          tryEmit(host, 'calendar:addWorkDays', start, days, (r: string) => { result = r; });
          return result;
        },
        daysBetween(start: string, end: string): number {
          let result = daysBetween(start, end); // fallback
          tryEmit(host, 'calendar:workDaysBetween', start, end, (r: number) => { result = r; });
          return result;
        },
      };
    } else {
      // WorkCalendarPlugin not available — use calendar days
      calendar = createCalendarDayBridge();
    }
  }

  // ── Schedule execution ────────────────────────────────────────────

  function scheduleAll(): ScheduleResult {
    const state = host.getState();
    const result = computeSchedule(
      state.tasks,
      state.dependencies,
      opts,
      calendar,
    );

    lastResult = result;

    // Apply results — dispatch TASK_MOVE for each task whose dates changed
    for (const [taskId, scheduled] of result.scheduledTasks) {
      const task = state.tasks.get(taskId);
      if (!task) continue;

      // Only dispatch if dates actually changed
      if (task.startDate !== scheduled.startDate || task.endDate !== scheduled.endDate) {
        host.dispatch({
          type: 'TASK_MOVE',
          taskId,
          startDate: scheduled.startDate,
          endDate: scheduled.endDate,
        });
      }
    }

    return result;
  }

  // ── Middleware: auto-reschedule on dependency changes ──────────────

  function middleware(action: Action, next: (action: Action) => void): void {
    // Pass action through first
    next(action);

    // Auto-reschedule when dependencies change
    if (action.type === 'ADD_DEPENDENCY' || action.type === 'REMOVE_DEPENDENCY') {
      scheduleAll();
    }
  }

  return {
    name: 'AutoSchedulePlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Initialize the calendar bridge
      initCalendarBridge();

      // Listen for schedule requests via the event system
      unsubscribers.push(
        host.on('autoSchedule:run', (...args: unknown[]) => {
          const callback = args[0] as ((result: ScheduleResult) => void) | undefined;
          const result = scheduleAll();
          if (callback) callback(result);
        }),
      );

      // Listen for result requests
      unsubscribers.push(
        host.on('autoSchedule:result', (...args: unknown[]) => {
          const callback = args[0] as ((result: ScheduleResult | null) => void) | undefined;
          if (callback) callback(lastResult);
        }),
      );

      // Listen for constraint updates
      unsubscribers.push(
        host.on('autoSchedule:setConstraint', (...args: unknown[]) => {
          const taskId = args[0] as string;
          const constraint = args[1] as ScheduleConstraint | null;
          if (!opts.constraints) {
            opts.constraints = new Map();
          }
          if (constraint) {
            opts.constraints.set(taskId, constraint);
          } else {
            opts.constraints.delete(taskId);
          }
        }),
      );

      // Listen for bulk constraint updates
      unsubscribers.push(
        host.on('autoSchedule:setConstraints', (...args: unknown[]) => {
          const constraintMap = args[0] as Map<string, ScheduleConstraint>;
          opts.constraints = constraintMap;
        }),
      );
    },

    middleware,

    destroy(): void {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers = [];
      lastResult = null;
    },
  };
}

// ─── Export computation for testing / external use ─────────────────────────

export { computeSchedule, buildDependencyGraph };
export type { CalendarBridge, DependencyEdge, DependencyGraph };
