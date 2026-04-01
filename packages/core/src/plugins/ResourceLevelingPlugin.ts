// ─── Resource Leveling Plugin ───────────────────────────────────────────────
// Resolves resource over-allocation by shifting non-critical tasks within their
// available float. Implements two algorithms:
//
// 1. **Serial** (default): Priority-based heuristic matching MS Project's
//    approach. Iterates conflict days chronologically, delaying lower-priority
//    tasks until no resource is over-allocated.
//
// 2. **Parallel**: Greedy forward-scheduling. Builds the schedule from scratch
//    by placing tasks in priority order at the earliest feasible slot, yielding
//    shorter overall project durations when many resources interact.
//
// Both are heuristics for a problem that is NP-hard in the general case.
// The serial approach is O(I * T * D) where I = iteration count (capped at
// 1000), T = tasks, D = project days. The parallel approach is O(T^2 * D).

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  GanttDependency,
  TaskLayout,
  Action,
} from '../model/types';

import type { TaskCPMAnalysis, CPMResult } from './CriticalPathPlugin';

// ─── Public Data Structures ──────────────────────────────────────────────────

export interface ResourceConfig {
  id: string;
  name: string;
  /** Max concurrent allocation units. Default 1 (one task at a time). 0 = infinite capacity. */
  maxUnits: number;
  /** Non-working day ISO strings specific to this resource. */
  calendar?: string[];
}

export interface ResourceAssignment {
  taskId: string;
  resourceId: string;
  /** How many capacity units this task consumes from the resource. Default 1. */
  units: number;
}

export interface LevelingResult {
  /** Map of taskId to adjusted dates and delay information. */
  adjustedTasks: Map<string, { startDate: string; endDate: string; delayDays: number }>;
  /** Total days added across all tasks. */
  totalDelay: number;
  /** Remaining conflicts (empty if fully resolved). */
  conflicts: ResourceConflict[];
  /** True if all over-allocations were resolved. */
  resolved: boolean;
}

export interface ResourceConflict {
  resourceId: string;
  resourceName: string;
  /** ISO date string of the conflict day. */
  date: string;
  /** How many units over the resource's maxUnits. */
  overAllocation: number;
  /** IDs of tasks competing for this resource on this day. */
  taskIds: string[];
}

export interface ResourceUtilization {
  resourceId: string;
  resourceName: string;
  /** Date (ISO string) to units allocated on that day. */
  dailyLoad: Map<string, number>;
  /** Average utilization as a ratio (0 to 1). */
  overallUtilization: number;
  /** Peak allocation units across all days (may exceed maxUnits before leveling). */
  peakUtilization: number;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface TaskSchedule {
  taskId: string;
  startDate: string;
  endDate: string;
  duration: number; // calendar days
}

interface TaskPriority {
  taskId: string;
  isCritical: boolean;
  priority: number;       // from metadata (lower = higher priority)
  totalFloat: number;     // from CPM
  earlyStart: Date;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const MAX_ITERATIONS = 1000;
const SPARKLINE_HEIGHT = 4;
const SPARKLINE_OPACITY = 0.6;
const SPARKLINE_OVER_COLOR = '#E53E3E';
const SPARKLINE_NORMAL_COLOR = '#48BB78';
const SPARKLINE_BG_COLOR = 'rgba(0,0,0,0.05)';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function addDaysToISO(dateStr: string, days: number): string {
  return toISODate(addDays(parseDate(dateStr), days));
}

/**
 * Generate all ISO date strings for each calendar day a task spans.
 * A task from 2026-01-05 to 2026-01-07 occupies days 05, 06 (not 07 — end is exclusive).
 * If start === end (zero duration / milestone), returns [start].
 */
function getTaskDays(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const days: string[] = [];
  const current = new Date(start);

  if (start.getTime() >= end.getTime()) {
    // Zero-duration or milestone — occupies only its start day
    days.push(toISODate(start));
    return days;
  }

  while (current.getTime() < end.getTime()) {
    days.push(toISODate(current));
    current.setTime(current.getTime() + MS_PER_DAY);
  }

  return days;
}

// ─── Resource Allocation Timeline ────────────────────────────────────────────

class AllocationTimeline {
  // resourceId -> date -> total units
  private grid: Map<string, Map<string, number>> = new Map();
  // resourceId -> date -> set of taskIds
  private taskGrid: Map<string, Map<string, Set<string>>> = new Map();

  clear(): void {
    this.grid.clear();
    this.taskGrid.clear();
  }

  allocate(resourceId: string, taskId: string, days: string[], units: number): void {
    if (!this.grid.has(resourceId)) {
      this.grid.set(resourceId, new Map());
      this.taskGrid.set(resourceId, new Map());
    }
    const resGrid = this.grid.get(resourceId)!;
    const resTaskGrid = this.taskGrid.get(resourceId)!;

    for (const day of days) {
      resGrid.set(day, (resGrid.get(day) ?? 0) + units);
      if (!resTaskGrid.has(day)) {
        resTaskGrid.set(day, new Set());
      }
      resTaskGrid.get(day)!.add(taskId);
    }
  }

  deallocate(resourceId: string, taskId: string, days: string[], units: number): void {
    const resGrid = this.grid.get(resourceId);
    const resTaskGrid = this.taskGrid.get(resourceId);
    if (!resGrid || !resTaskGrid) return;

    for (const day of days) {
      const current = resGrid.get(day) ?? 0;
      const newVal = current - units;
      if (newVal <= 0) {
        resGrid.delete(day);
      } else {
        resGrid.set(day, newVal);
      }
      resTaskGrid.get(day)?.delete(taskId);
      if (resTaskGrid.get(day)?.size === 0) {
        resTaskGrid.delete(day);
      }
    }
  }

  getLoad(resourceId: string, day: string): number {
    return this.grid.get(resourceId)?.get(day) ?? 0;
  }

  getTasksOnDay(resourceId: string, day: string): Set<string> {
    return this.taskGrid.get(resourceId)?.get(day) ?? new Set();
  }

  getAllDays(resourceId: string): Map<string, number> {
    return this.grid.get(resourceId) ?? new Map();
  }

  getResourceIds(): string[] {
    return Array.from(this.grid.keys());
  }

  /**
   * Check whether placing a task on the given days would exceed maxUnits,
   * excluding the task itself (for re-scheduling scenarios).
   */
  canFit(
    resourceId: string,
    taskId: string,
    days: string[],
    units: number,
    maxUnits: number,
  ): boolean {
    if (maxUnits === 0) return true; // infinite capacity

    const resGrid = this.grid.get(resourceId);
    const resTaskGrid = this.taskGrid.get(resourceId);

    for (const day of days) {
      let load = resGrid?.get(day) ?? 0;

      // Subtract this task's own current allocation if it's already placed
      if (resTaskGrid?.get(day)?.has(taskId)) {
        load -= units;
      }

      if (load + units > maxUnits) return false;
    }

    return true;
  }
}

// ─── Conflict Detection ──────────────────────────────────────────────────────

function detectConflicts(
  timeline: AllocationTimeline,
  resources: Map<string, ResourceConfig>,
): ResourceConflict[] {
  const conflicts: ResourceConflict[] = [];

  for (const [resourceId, resource] of resources) {
    if (resource.maxUnits === 0) continue; // infinite capacity — no conflicts possible

    const dailyLoads = timeline.getAllDays(resourceId);
    for (const [day, load] of dailyLoads) {
      if (load > resource.maxUnits) {
        const taskIds = Array.from(timeline.getTasksOnDay(resourceId, day));
        conflicts.push({
          resourceId,
          resourceName: resource.name,
          date: day,
          overAllocation: load - resource.maxUnits,
          taskIds,
        });
      }
    }
  }

  // Sort chronologically for deterministic processing
  conflicts.sort((a, b) => a.date.localeCompare(b.date));
  return conflicts;
}

// ─── Priority Computation ────────────────────────────────────────────────────

function computeTaskPriorities(
  tasks: Map<string, GanttTask>,
  cpmData: Map<string, TaskCPMAnalysis> | null,
  priorityField: string,
): Map<string, TaskPriority> {
  const priorities = new Map<string, TaskPriority>();

  for (const [taskId, task] of tasks) {
    const cpm = cpmData?.get(taskId);
    const metaPriority = task.metadata?.[priorityField];

    let priorityNum = Infinity;
    if (typeof metaPriority === 'number') {
      priorityNum = metaPriority;
    } else if (typeof metaPriority === 'string') {
      const parsed = parseInt(metaPriority, 10);
      if (!isNaN(parsed)) priorityNum = parsed;
    }

    priorities.set(taskId, {
      taskId,
      isCritical: cpm?.isCritical ?? false,
      priority: priorityNum,
      totalFloat: cpm?.totalFloat ?? Infinity,
      earlyStart: cpm?.earlyStart ?? parseDate(task.startDate),
    });
  }

  return priorities;
}

/**
 * Compare two tasks for scheduling priority.
 * Order: critical path first, then lower priority number, then earlier start, then lower float.
 * Returns negative if `a` should be scheduled before `b`.
 */
function comparePriority(a: TaskPriority, b: TaskPriority): number {
  // Critical tasks first
  if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;

  // Lower priority number = higher priority
  if (a.priority !== b.priority) return a.priority - b.priority;

  // Earlier start first
  const startDiff = a.earlyStart.getTime() - b.earlyStart.getTime();
  if (startDiff !== 0) return startDiff;

  // Lower float = less flexibility = schedule first
  return a.totalFloat - b.totalFloat;
}

// ─── Algorithm 1: Serial Resource Leveling ───────────────────────────────────

function serialLevel(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
  resources: Map<string, ResourceConfig>,
  assignments: ResourceAssignment[],
  priorities: Map<string, TaskPriority>,
): LevelingResult {
  // Build assignment index: taskId -> [{resourceId, units}]
  const taskAssignments = new Map<string, Array<{ resourceId: string; units: number }>>();
  for (const a of assignments) {
    if (!tasks.has(a.taskId)) continue;
    if (!resources.has(a.resourceId)) continue;
    if (!taskAssignments.has(a.taskId)) {
      taskAssignments.set(a.taskId, []);
    }
    taskAssignments.get(a.taskId)!.push({ resourceId: a.resourceId, units: a.units || 1 });
  }

  // Build successor/predecessor maps (FS only for simplicity)
  const successors = new Map<string, Array<{ target: string; lag: number }>>();
  const predecessors = new Map<string, Array<{ source: string; lag: number }>>();

  for (const id of tasks.keys()) {
    successors.set(id, []);
    predecessors.set(id, []);
  }

  for (const dep of dependencies.values()) {
    const type = dep.type || 'FS';
    if (type !== 'FS') continue;
    if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;

    const lag = dep.lag || 0;
    successors.get(dep.source)!.push({ target: dep.target, lag });
    predecessors.get(dep.target)!.push({ source: dep.source, lag });
  }

  // Working schedule: current positions of all tasks
  const schedule = new Map<string, TaskSchedule>();
  for (const [id, task] of tasks) {
    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    schedule.set(id, {
      taskId: id,
      startDate: task.startDate,
      endDate: task.endDate,
      duration: Math.max(diffDays(start, end), 0),
    });
  }

  // Build initial allocation timeline
  const timeline = new AllocationTimeline();

  function rebuildTimeline(): void {
    timeline.clear();
    for (const [taskId, sched] of schedule) {
      const taskAssigns = taskAssignments.get(taskId);
      if (!taskAssigns) continue;

      const days = getTaskDays(sched.startDate, sched.endDate);
      for (const ta of taskAssigns) {
        timeline.allocate(ta.resourceId, taskId, days, ta.units);
      }
    }
  }

  /**
   * Delay a task to a new start date, preserving duration.
   * Returns the set of taskIds whose schedules changed (for cascade checking).
   */
  function delayTask(taskId: string, newStartDate: string): Set<string> {
    const sched = schedule.get(taskId);
    if (!sched) return new Set();

    const changed = new Set<string>();
    const oldStart = sched.startDate;

    if (newStartDate === oldStart) return changed;

    // Only delay forward — never pull a task earlier in serial leveling
    if (parseDate(newStartDate).getTime() < parseDate(oldStart).getTime()) {
      return changed;
    }

    // Remove old allocation
    const taskAssigns = taskAssignments.get(taskId);
    if (taskAssigns) {
      const oldDays = getTaskDays(sched.startDate, sched.endDate);
      for (const ta of taskAssigns) {
        timeline.deallocate(ta.resourceId, taskId, oldDays, ta.units);
      }
    }

    // Update schedule
    sched.startDate = newStartDate;
    sched.endDate = addDaysToISO(newStartDate, sched.duration);
    changed.add(taskId);

    // Re-allocate
    if (taskAssigns) {
      const newDays = getTaskDays(sched.startDate, sched.endDate);
      for (const ta of taskAssigns) {
        timeline.allocate(ta.resourceId, taskId, newDays, ta.units);
      }
    }

    return changed;
  }

  /**
   * Cascade dependency constraints after delaying a task.
   * If a successor's start is now before its predecessor's end + lag, push it forward.
   */
  function cascadeSuccessors(taskId: string): Set<string> {
    const changed = new Set<string>();
    const sched = schedule.get(taskId);
    if (!sched) return changed;

    const succs = successors.get(taskId) ?? [];
    for (const { target, lag } of succs) {
      const succSched = schedule.get(target);
      if (!succSched) continue;

      // FS: successor cannot start before predecessor ends + lag
      const earliestStart = addDaysToISO(sched.endDate, lag);
      if (parseDate(succSched.startDate).getTime() < parseDate(earliestStart).getTime()) {
        const delayedIds = delayTask(target, earliestStart);
        for (const id of delayedIds) {
          changed.add(id);
          // Recursive cascade
          const subChanged = cascadeSuccessors(id);
          for (const sid of subChanged) changed.add(sid);
        }
      }
    }

    return changed;
  }

  /**
   * Compute the earliest start for a task based on its predecessor constraints.
   */
  function getEarliestStart(taskId: string): string {
    const preds = predecessors.get(taskId) ?? [];
    let earliest = schedule.get(taskId)!.startDate;

    // Use the original task start as a minimum — don't schedule before original
    const originalTask = tasks.get(taskId)!;
    earliest = originalTask.startDate;

    for (const { source, lag } of preds) {
      const predSched = schedule.get(source);
      if (!predSched) continue;

      const predEnd = addDaysToISO(predSched.endDate, lag);
      if (parseDate(predEnd).getTime() > parseDate(earliest).getTime()) {
        earliest = predEnd;
      }
    }

    return earliest;
  }

  // ── Main iteration loop ────────────────────────────────────────────────────

  rebuildTimeline();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const conflicts = detectConflicts(timeline, resources);
    if (conflicts.length === 0) break;

    let madeProgress = false;

    // Process the first conflict
    const conflict = conflicts[0];
    const conflictTasks = conflict.taskIds
      .map((id) => priorities.get(id))
      .filter((p): p is TaskPriority => p !== undefined)
      .sort(comparePriority);

    if (conflictTasks.length < 2) continue;

    // Keep the highest-priority task; delay others one at a time
    for (let i = 1; i < conflictTasks.length; i++) {
      const taskToDelay = conflictTasks[i];
      const delaySched = schedule.get(taskToDelay.taskId);
      if (!delaySched) continue;

      // Find the task that's keeping it from being scheduled here
      // Delay this task to start after the highest-priority conflicting task ends on this resource
      const keepSched = schedule.get(conflictTasks[0].taskId);
      if (!keepSched) continue;

      // The task needs to start after the kept task finishes (for this resource conflict)
      const newStart = keepSched.endDate;

      // Respect predecessor constraints
      const earliestFromPreds = getEarliestStart(taskToDelay.taskId);
      const effectiveStart = parseDate(newStart).getTime() > parseDate(earliestFromPreds).getTime()
        ? newStart
        : earliestFromPreds;

      if (parseDate(effectiveStart).getTime() > parseDate(delaySched.startDate).getTime()) {
        delayTask(taskToDelay.taskId, effectiveStart);
        cascadeSuccessors(taskToDelay.taskId);
        madeProgress = true;
      }

      // Recheck this resource on this day after the delay
      const currentLoad = timeline.getLoad(conflict.resourceId, conflict.date);
      const maxUnits = resources.get(conflict.resourceId)!.maxUnits;
      if (currentLoad <= maxUnits) break;
    }

    if (!madeProgress) {
      // If we couldn't resolve this conflict, try the next one to avoid infinite loops
      // This can happen when all conflicting tasks have predecessor constraints
      // preventing them from being moved.
      continue;
    }
  }

  // ── Build result ──────────────────────────────────────────────────────────

  const adjustedTasks = new Map<string, { startDate: string; endDate: string; delayDays: number }>();
  let totalDelay = 0;

  for (const [taskId, sched] of schedule) {
    const original = tasks.get(taskId)!;
    const delayDays = diffDays(parseDate(original.startDate), parseDate(sched.startDate));

    if (delayDays !== 0) {
      adjustedTasks.set(taskId, {
        startDate: sched.startDate,
        endDate: sched.endDate,
        delayDays,
      });
      totalDelay += delayDays;
    }
  }

  const remainingConflicts = detectConflicts(timeline, resources);

  return {
    adjustedTasks,
    totalDelay,
    conflicts: remainingConflicts,
    resolved: remainingConflicts.length === 0,
  };
}

// ─── Algorithm 2: Parallel Resource Leveling (Greedy Forward Scheduling) ─────

function parallelLevel(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
  resources: Map<string, ResourceConfig>,
  assignments: ResourceAssignment[],
  priorities: Map<string, TaskPriority>,
): LevelingResult {
  // Build assignment index
  const taskAssignments = new Map<string, Array<{ resourceId: string; units: number }>>();
  for (const a of assignments) {
    if (!tasks.has(a.taskId)) continue;
    if (!resources.has(a.resourceId)) continue;
    if (!taskAssignments.has(a.taskId)) {
      taskAssignments.set(a.taskId, []);
    }
    taskAssignments.get(a.taskId)!.push({ resourceId: a.resourceId, units: a.units || 1 });
  }

  // Build predecessor map
  const predecessors = new Map<string, Array<{ source: string; lag: number }>>();
  for (const id of tasks.keys()) {
    predecessors.set(id, []);
  }
  for (const dep of dependencies.values()) {
    const type = dep.type || 'FS';
    if (type !== 'FS') continue;
    if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;
    predecessors.get(dep.target)!.push({ source: dep.source, lag: dep.lag || 0 });
  }

  // Sort all tasks by priority
  const sortedTasks = Array.from(tasks.keys())
    .map((id) => priorities.get(id))
    .filter((p): p is TaskPriority => p !== undefined)
    .sort(comparePriority);

  // Schedule tracks
  const schedule = new Map<string, TaskSchedule>();
  const timeline = new AllocationTimeline();
  const scheduled = new Set<string>();

  // Compute task durations
  const durations = new Map<string, number>();
  for (const [id, task] of tasks) {
    durations.set(id, Math.max(diffDays(parseDate(task.startDate), parseDate(task.endDate)), 0));
  }

  /**
   * Get the earliest possible start for a task based on:
   * 1. Its original start date (floor)
   * 2. All predecessor finish dates + lag
   */
  function getEarliestPossibleStart(taskId: string): string {
    const task = tasks.get(taskId)!;
    let earliest = task.startDate;

    const preds = predecessors.get(taskId) ?? [];
    for (const { source, lag } of preds) {
      const predSched = schedule.get(source);
      if (!predSched) continue;

      const predEnd = addDaysToISO(predSched.endDate, lag);
      if (parseDate(predEnd).getTime() > parseDate(earliest).getTime()) {
        earliest = predEnd;
      }
    }

    return earliest;
  }

  /**
   * Find the earliest slot starting from a given date where all assigned
   * resources have available capacity for the task's full duration.
   */
  function findEarliestSlot(
    taskId: string,
    startFrom: string,
    duration: number,
  ): string {
    const taskAssigns = taskAssignments.get(taskId);

    // Unassigned tasks can start immediately
    if (!taskAssigns || taskAssigns.length === 0) {
      return startFrom;
    }

    // Slide the task day by day until all resources can accommodate it
    let candidateStart = startFrom;
    const maxSearchDays = 365 * 5; // safety limit: 5 years

    for (let offset = 0; offset < maxSearchDays; offset++) {
      const candidateEnd = addDaysToISO(candidateStart, duration);
      const days = getTaskDays(candidateStart, candidateEnd);

      let fits = true;
      for (const ta of taskAssigns) {
        const resource = resources.get(ta.resourceId);
        if (!resource || resource.maxUnits === 0) continue; // infinite capacity

        // Check if resource is on its personal calendar (non-working day)
        const calendarSet = resource.calendar ? new Set(resource.calendar) : null;
        if (calendarSet) {
          const hasNonWorkDay = days.some((d) => calendarSet.has(d));
          if (hasNonWorkDay) {
            fits = false;
            break;
          }
        }

        if (!timeline.canFit(ta.resourceId, taskId, days, ta.units, resource.maxUnits)) {
          fits = false;
          break;
        }
      }

      if (fits) return candidateStart;

      candidateStart = addDaysToISO(candidateStart, 1);
    }

    // Fallback: use the startFrom date if we exhausted search
    return startFrom;
  }

  // ── Schedule tasks in priority order ───────────────────────────────────────

  // We need to handle dependency ordering: a task cannot be scheduled until
  // all its predecessors have been scheduled. Use a topological-aware approach.
  const remaining = new Set(sortedTasks.map((p) => p.taskId));

  // Multiple passes to handle dependency chains
  for (let pass = 0; pass < MAX_ITERATIONS && remaining.size > 0; pass++) {
    let placedAny = false;

    for (const tp of sortedTasks) {
      if (!remaining.has(tp.taskId)) continue;

      // Check that all predecessors are scheduled
      const preds = predecessors.get(tp.taskId) ?? [];
      const allPredsScheduled = preds.every((p) => scheduled.has(p.source));
      if (!allPredsScheduled) continue;

      const taskId = tp.taskId;
      const duration = durations.get(taskId) ?? 0;

      // Find earliest start respecting predecessors
      const earliestStart = getEarliestPossibleStart(taskId);

      // Find earliest slot respecting resource capacity
      const slotStart = findEarliestSlot(taskId, earliestStart, duration);
      const slotEnd = addDaysToISO(slotStart, duration);

      // Place the task
      schedule.set(taskId, {
        taskId,
        startDate: slotStart,
        endDate: slotEnd,
        duration,
      });

      // Allocate on timeline
      const taskAssigns = taskAssignments.get(taskId);
      if (taskAssigns) {
        const days = getTaskDays(slotStart, slotEnd);
        for (const ta of taskAssigns) {
          timeline.allocate(ta.resourceId, taskId, days, ta.units);
        }
      }

      scheduled.add(taskId);
      remaining.delete(taskId);
      placedAny = true;
    }

    if (!placedAny) {
      // Deadlock: remaining tasks have circular dependencies or unresolvable predecessors
      // Place them at their original dates
      for (const taskId of remaining) {
        const task = tasks.get(taskId)!;
        const duration = durations.get(taskId) ?? 0;
        schedule.set(taskId, {
          taskId,
          startDate: task.startDate,
          endDate: task.endDate,
          duration,
        });

        const taskAssigns = taskAssignments.get(taskId);
        if (taskAssigns) {
          const days = getTaskDays(task.startDate, task.endDate);
          for (const ta of taskAssigns) {
            timeline.allocate(ta.resourceId, taskId, days, ta.units);
          }
        }

        scheduled.add(taskId);
      }
      remaining.clear();
    }
  }

  // ── Build result ──────────────────────────────────────────────────────────

  const adjustedTasks = new Map<string, { startDate: string; endDate: string; delayDays: number }>();
  let totalDelay = 0;

  for (const [taskId, sched] of schedule) {
    const original = tasks.get(taskId)!;
    const delayDays = diffDays(parseDate(original.startDate), parseDate(sched.startDate));

    if (delayDays !== 0) {
      adjustedTasks.set(taskId, {
        startDate: sched.startDate,
        endDate: sched.endDate,
        delayDays,
      });
      totalDelay += delayDays;
    }
  }

  const remainingConflicts = detectConflicts(timeline, resources);

  return {
    adjustedTasks,
    totalDelay,
    conflicts: remainingConflicts,
    resolved: remainingConflicts.length === 0,
  };
}

// ─── Utilization Computation ─────────────────────────────────────────────────

function computeUtilization(
  timeline: AllocationTimeline,
  resources: Map<string, ResourceConfig>,
  projectStart: string,
  projectEnd: string,
): ResourceUtilization[] {
  const utilizations: ResourceUtilization[] = [];
  const projectDays = getTaskDays(projectStart, addDaysToISO(projectEnd, 1));
  const totalDays = projectDays.length;

  for (const [resourceId, resource] of resources) {
    const dailyLoad = new Map<string, number>();
    let totalLoad = 0;
    let peak = 0;

    for (const day of projectDays) {
      const load = timeline.getLoad(resourceId, day);
      dailyLoad.set(day, load);
      totalLoad += load;
      if (load > peak) peak = load;
    }

    const maxCapacity = resource.maxUnits === 0 ? 1 : resource.maxUnits;
    const overallUtilization = totalDays > 0
      ? totalLoad / (totalDays * maxCapacity)
      : 0;

    utilizations.push({
      resourceId,
      resourceName: resource.name,
      dailyLoad,
      overallUtilization: Math.min(overallUtilization, 1),
      peakUtilization: peak,
    });
  }

  return utilizations;
}

// ─── Build Allocation Timeline from Current State ────────────────────────────

function buildTimelineFromState(
  tasks: Map<string, GanttTask>,
  resources: Map<string, ResourceConfig>,
  assignments: ResourceAssignment[],
  adjustedTasks: Map<string, { startDate: string; endDate: string; delayDays: number }>,
): AllocationTimeline {
  const timeline = new AllocationTimeline();

  // Build assignment index
  const taskAssignments = new Map<string, Array<{ resourceId: string; units: number }>>();
  for (const a of assignments) {
    if (!tasks.has(a.taskId)) continue;
    if (!resources.has(a.resourceId)) continue;
    if (!taskAssignments.has(a.taskId)) {
      taskAssignments.set(a.taskId, []);
    }
    taskAssignments.get(a.taskId)!.push({ resourceId: a.resourceId, units: a.units || 1 });
  }

  for (const [taskId, task] of tasks) {
    const assigns = taskAssignments.get(taskId);
    if (!assigns) continue;

    const adjusted = adjustedTasks.get(taskId);
    const startDate = adjusted?.startDate ?? task.startDate;
    const endDate = adjusted?.endDate ?? task.endDate;
    const days = getTaskDays(startDate, endDate);

    for (const a of assigns) {
      timeline.allocate(a.resourceId, taskId, days, a.units);
    }
  }

  return timeline;
}

// ─── Plugin Factory ──────────────────────────────────────────────────────────

export function ResourceLevelingPlugin(options: {
  resources: ResourceConfig[];
  assignments: ResourceAssignment[];
  priorityField?: string;
  algorithm?: 'serial' | 'parallel';
}): NimbusGanttPlugin {
  const resourceMap = new Map<string, ResourceConfig>();
  for (const r of options.resources) {
    resourceMap.set(r.id, r);
  }

  const priorityField = options.priorityField ?? 'priority';
  const algorithm = options.algorithm ?? 'serial';

  let host: PluginHost | null = null;
  let levelingResult: LevelingResult | null = null;
  let utilizations: ResourceUtilization[] = [];
  const unsubscribers: Array<() => void> = [];

  // ── Try to get CPM data from CriticalPathPlugin via stateChange ─────────

  function getCPMData(): Map<string, TaskCPMAnalysis> | null {
    // The CPM plugin stores its results internally; we approximate by
    // listening for CPM events. For now, we compute priorities without CPM
    // data if it's not available, using task float = Infinity.
    // In a full integration, the plugin host would provide a registry.
    return null;
  }

  /** Run the leveling algorithm and store results. */
  function level(): LevelingResult {
    if (!host) {
      return {
        adjustedTasks: new Map(),
        totalDelay: 0,
        conflicts: [],
        resolved: true,
      };
    }

    const state = host.getState();
    const { tasks, dependencies } = state;

    if (tasks.size === 0) {
      levelingResult = {
        adjustedTasks: new Map(),
        totalDelay: 0,
        conflicts: [],
        resolved: true,
      };
      utilizations = [];
      return levelingResult;
    }

    const cpmData = getCPMData();
    const priorities = computeTaskPriorities(tasks, cpmData, priorityField);

    if (algorithm === 'parallel') {
      levelingResult = parallelLevel(tasks, dependencies, resourceMap, options.assignments, priorities);
    } else {
      levelingResult = serialLevel(tasks, dependencies, resourceMap, options.assignments, priorities);
    }

    // Compute utilization based on leveled schedule
    const projectDates = getProjectDateRange(tasks, levelingResult.adjustedTasks);
    const timeline = buildTimelineFromState(
      tasks,
      resourceMap,
      options.assignments,
      levelingResult.adjustedTasks,
    );
    utilizations = computeUtilization(timeline, resourceMap, projectDates.start, projectDates.end);

    return levelingResult;
  }

  /** Get the project date range accounting for adjusted tasks. */
  function getProjectDateRange(
    tasks: Map<string, GanttTask>,
    adjustedTasks: Map<string, { startDate: string; endDate: string; delayDays: number }>,
  ): { start: string; end: string } {
    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const [taskId, task] of tasks) {
      const adjusted = adjustedTasks.get(taskId);
      const start = parseDate(adjusted?.startDate ?? task.startDate).getTime();
      const end = parseDate(adjusted?.endDate ?? task.endDate).getTime();

      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }

    if (minStart === Infinity) {
      const today = toISODate(new Date());
      return { start: today, end: today };
    }

    return {
      start: toISODate(new Date(minStart)),
      end: toISODate(new Date(maxEnd)),
    };
  }

  // ── Task-to-resource lookup for sparkline rendering ────────────────────────

  function getTaskResourceIds(taskId: string): string[] {
    const ids: string[] = [];
    for (const a of options.assignments) {
      if (a.taskId === taskId) {
        ids.push(a.resourceId);
      }
    }
    return ids;
  }

  return {
    name: 'ResourceLevelingPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Initial calculation
      level();

      // Expose leveling run via event
      unsubscribers.push(
        gantt.on('resourceLeveling:run', (...args: unknown[]) => {
          const callback = args[0] as ((result: LevelingResult) => void) | undefined;
          const result = level();
          if (callback) callback(result);
        }),
      );

      // Expose result via event
      unsubscribers.push(
        gantt.on('resourceLeveling:result', (...args: unknown[]) => {
          const callback = args[0] as ((result: LevelingResult | null) => void) | undefined;
          if (callback) callback(levelingResult);
        }),
      );

      // Expose utilization data via event
      unsubscribers.push(
        gantt.on('resourceLeveling:utilization', (...args: unknown[]) => {
          const callback = args[0] as ((data: ResourceUtilization[]) => void) | undefined;
          if (callback) callback(utilizations);
        }),
      );

      // Expose conflict detection (pre-leveling) via event
      unsubscribers.push(
        gantt.on('resourceLeveling:conflicts', (...args: unknown[]) => {
          const callback = args[0] as ((conflicts: ResourceConflict[]) => void) | undefined;
          if (!callback) return;

          const state = gantt.getState();
          const timeline = buildTimelineFromState(
            state.tasks,
            resourceMap,
            options.assignments,
            new Map(), // no adjustments — show raw conflicts
          );
          callback(detectConflicts(timeline, resourceMap));
        }),
      );
    },

    middleware(action: Action, next: (action: Action) => void): void {
      next(action);

      // Recalculate when tasks or dependencies change
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
        level();
      }
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!levelingResult || utilizations.length === 0) return;

      const { config } = state;
      const { headerHeight, rowHeight } = config;
      const scrollX = state.scrollX;
      const scrollY = state.scrollY;
      const timeScale = host?.getTimeScale();
      if (!timeScale) return;

      ctx.save();

      // Clip to body area
      ctx.beginPath();
      ctx.rect(0, headerHeight, ctx.canvas.width, ctx.canvas.height - headerHeight);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      // Build utilization lookup by resourceId
      const utilMap = new Map<string, ResourceUtilization>();
      for (const u of utilizations) {
        utilMap.set(u.resourceId, u);
      }

      // Draw thin sparklines below each task bar showing the assigned resource's load
      for (const layout of layouts) {
        const resourceIds = getTaskResourceIds(layout.taskId);
        if (resourceIds.length === 0) continue;

        // Use the first assigned resource for the sparkline
        const util = utilMap.get(resourceIds[0]);
        if (!util) continue;

        const resource = resourceMap.get(resourceIds[0]);
        if (!resource) continue;

        const maxUnits = resource.maxUnits === 0 ? 1 : resource.maxUnits;
        const barBottom = layout.barY + layout.barHeight - scrollY;
        const sparkY = barBottom + 1;

        // Skip if outside visible area
        if (sparkY + SPARKLINE_HEIGHT < headerHeight || sparkY > ctx.canvas.height) continue;

        // Get the task's date range (adjusted if leveled)
        const task = state.tasks.get(layout.taskId);
        if (!task) continue;

        const adjusted = levelingResult.adjustedTasks.get(layout.taskId);
        const taskStart = adjusted?.startDate ?? task.startDate;
        const taskEnd = adjusted?.endDate ?? task.endDate;

        // Draw sparkline background
        const startX = timeScale.dateToX(parseDate(taskStart));
        const endX = timeScale.dateToX(parseDate(taskEnd));
        const sparkWidth = endX - startX;

        if (sparkWidth < 2) continue;

        ctx.fillStyle = SPARKLINE_BG_COLOR;
        ctx.fillRect(startX, sparkY, sparkWidth, SPARKLINE_HEIGHT);

        // Draw load bars for each day
        const days = getTaskDays(taskStart, taskEnd);
        for (const day of days) {
          const load = util.dailyLoad.get(day) ?? 0;
          if (load === 0) continue;

          const dayX = timeScale.dateToX(parseDate(day));
          const nextDayX = timeScale.dateToX(addDays(parseDate(day), 1));
          const dayWidth = nextDayX - dayX;

          const ratio = Math.min(load / maxUnits, 2); // cap visual at 2x
          const barH = (ratio / 2) * SPARKLINE_HEIGHT;
          const isOver = load > maxUnits;

          ctx.globalAlpha = SPARKLINE_OPACITY;
          ctx.fillStyle = isOver ? SPARKLINE_OVER_COLOR : SPARKLINE_NORMAL_COLOR;
          ctx.fillRect(dayX, sparkY + SPARKLINE_HEIGHT - barH, dayWidth, barH);
          ctx.globalAlpha = 1.0;
        }
      }

      ctx.restore();
    },

    destroy(): void {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;
      host = null;
      levelingResult = null;
      utilizations = [];
    },
  };
}

// ─── Export internals for testing / external use ────────────────────────────

export {
  serialLevel,
  parallelLevel,
  detectConflicts,
  computeUtilization,
  computeTaskPriorities,
  AllocationTimeline,
};
