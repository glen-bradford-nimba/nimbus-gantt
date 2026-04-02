// ─── Risk Analysis Plugin ───────────────────────────────────────────────────
// Analyzes the project schedule and flags risks, bottlenecks, and optimization
// opportunities using deterministic algorithmic heuristics. No external AI API
// is required — each risk factor contributes a specific, explainable amount to
// the overall score.
//
// Algorithm overview:
//   1. Schedule Risk Index — per-task composite of time pressure, progress
//      deviation, dependency chain exposure, duration uncertainty, and resource
//      concentration.
//   2. Project Health Score — aggregate metric combining on-track ratio,
//      critical path slack, resource balance, and completion trajectory.
//   3. Smart Recommendations — actionable suggestions (parallelize, buffer,
//      split, reassign, escalate) generated from schedule analysis.
//   4. Canvas overlay — risk indicator dots on task bars + optional health
//      dashboard panel.

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

export interface RiskAssessment {
  taskId: string;
  taskName: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  riskScore: number;        // 0-100
  factors: RiskFactor[];
  suggestion?: string;
}

export interface RiskFactor {
  type: string;
  description: string;
  impact: number;            // 0-100 contribution to risk score
}

export interface ProjectHealth {
  overallScore: number;      // 0-100 (100 = healthy)
  tasksAtRisk: number;
  criticalPathDelay: number; // days the critical path is behind
  resourceBottlenecks: string[];
  recommendations: Recommendation[];
}

export interface Recommendation {
  type: 'reschedule' | 'reassign' | 'split' | 'add-buffer' | 'parallel' | 'escalate';
  description: string;
  impact: string;            // e.g. "Saves 3 days on critical path"
  taskIds: string[];
  priority: number;          // 1 = highest
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

// Risk level thresholds (on a 0-100 scale)
const CRITICAL_THRESHOLD = 75; // score >= 75 is critical
const HIGH_THRESHOLD = 50;     // score >= 50 is high
const MEDIUM_THRESHOLD = 25;   // score >= 25 is medium
                               // score < 25 is low

// ── Factor weights (must sum to 1.0) ────────────────────────────────────
const WEIGHT_TIME_PRESSURE = 0.30;        // 30% — schedule pressure
const WEIGHT_PROGRESS_DEVIATION = 0.25;   // 25% — behind/ahead of plan
const WEIGHT_DEPENDENCY_CHAIN = 0.20;     // 20% — downstream cascade exposure
const WEIGHT_DURATION = 0.15;             // 15% — size / estimation uncertainty
const WEIGHT_RESOURCE = 0.10;             // 10% — assignee overload

// ── Progress deviation thresholds ───────────────────────────────────────
const DEVIATION_HIGH = 0.30;     // 30% behind expected = high risk
const DEVIATION_CRITICAL = 0.50; // 50% behind expected = critical risk

// ── Duration thresholds (days) ──────────────────────────────────────────
const DURATION_MEDIUM_DAYS = 20; // tasks > 20 days carry medium baseline risk
const DURATION_HIGH_DAYS = 40;   // tasks > 40 days carry high baseline risk

// ── Resource concentration thresholds ───────────────────────────────────
const CONCURRENT_WARN = 3;       // > 3 concurrent tasks = risk factor
const CONCURRENT_HIGH = 5;       // > 5 concurrent tasks = high risk factor

// ── Recommendation thresholds ───────────────────────────────────────────
const SPLIT_TASK_DAYS = 30;          // suggest split for tasks > 30 days
const SPLIT_PROGRESS_MAX = 0.25;     // only suggest split when < 25% done
const REASSIGN_OVERLOAD = 4;         // suggest reassign when assignee has > 4 active tasks
const REASSIGN_UNDERLOAD = 2;        // consider target resources with < 2 tasks
const ESCALATE_OVERDUE_DAYS = 5;     // escalate when > 5 days past due with 0 progress

// ── Canvas rendering ────────────────────────────────────────────────────
const DOT_RADIUS = 5;
const DOT_MARGIN = 4;           // offset from top-right corner of bar
const PULSE_MIN_ALPHA = 0.4;    // minimum opacity during pulse cycle
const PULSE_SPEED = 0.003;      // radians per millisecond for pulsing

// Overlay panel dimensions
const OVERLAY_WIDTH = 260;
const OVERLAY_HEIGHT = 260;
const OVERLAY_MARGIN = 16;
const OVERLAY_PADDING = 14;
const OVERLAY_BG = 'rgba(30, 30, 46, 0.92)';
const OVERLAY_TEXT = '#e0e0e0';
const OVERLAY_RADIUS = 10;

// Gauge rendering
const GAUGE_RADIUS = 32;
const GAUGE_LINE_WIDTH = 6;

// Risk level colors
const COLOR_CRITICAL = '#EF4444'; // red-500
const COLOR_HIGH = '#F97316';     // orange-500
const COLOR_MEDIUM = '#EAB308';   // yellow-500
const COLOR_LOW = '#22C55E';      // green-500

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD to UTC Date, matching LayoutEngine.parseDate */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

/** Difference in calendar days between two UTC dates (b - a) */
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Clamp a number to [min, max] */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Map a risk score (0-100) to a risk level string */
function scoreToLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= CRITICAL_THRESHOLD) return 'critical';
  if (score >= HIGH_THRESHOLD) return 'high';
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

/** Map a risk level to its display color */
function levelToColor(level: 'critical' | 'high' | 'medium' | 'low'): string {
  switch (level) {
    case 'critical': return COLOR_CRITICAL;
    case 'high':     return COLOR_HIGH;
    case 'medium':   return COLOR_MEDIUM;
    case 'low':      return COLOR_LOW;
  }
}

/** Get today's date as a UTC midnight Date */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

// ─── Dependency Graph Utilities ────────────────────────────────────────────

interface DepGraph {
  /** taskId -> list of task IDs that directly depend on it (successors) */
  successors: Map<string, string[]>;
  /** taskId -> list of task IDs it depends on (predecessors) */
  predecessors: Map<string, string[]>;
  /** taskId -> total count of transitive downstream dependents */
  downstreamCount: Map<string, number>;
  /** Set of task IDs that lie on the critical path (zero-float chain) */
  criticalPathIds: Set<string>;
}

/**
 * Build a directed dependency graph and compute downstream-dependent counts
 * via reverse topological order. Also identifies the critical path as the
 * longest chain through the graph.
 */
function buildDepGraph(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
): DepGraph {
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();

  for (const id of tasks.keys()) {
    successors.set(id, []);
    predecessors.set(id, []);
  }

  for (const dep of dependencies.values()) {
    if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;
    successors.get(dep.source)!.push(dep.target);
    predecessors.get(dep.target)!.push(dep.source);
  }

  // Compute transitive downstream count via DFS + memoization
  const downstreamCount = new Map<string, number>();
  const visited = new Set<string>();

  function countDownstream(taskId: string): number {
    if (downstreamCount.has(taskId)) return downstreamCount.get(taskId)!;
    if (visited.has(taskId)) return 0; // cycle guard
    visited.add(taskId);

    let count = 0;
    for (const succ of successors.get(taskId) || []) {
      count += 1 + countDownstream(succ);
    }

    downstreamCount.set(taskId, count);
    return count;
  }

  for (const id of tasks.keys()) {
    countDownstream(id);
  }

  // Identify critical path using a forward-pass longest-path algorithm.
  // For each task, compute "longest path from any root to this task" using
  // its actual duration. The chain producing the maximum total is critical.
  const taskDuration = new Map<string, number>();
  for (const [id, task] of tasks) {
    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    taskDuration.set(id, Math.max(diffDays(start, end), 0));
  }

  // Forward pass: longest path to each task
  const longestPath = new Map<string, number>();
  const pathPredecessor = new Map<string, string | null>();
  const inDegree = new Map<string, number>();

  for (const id of tasks.keys()) {
    inDegree.set(id, (predecessors.get(id) || []).length);
    longestPath.set(id, taskDuration.get(id) || 0);
    pathPredecessor.set(id, null);
  }

  // Kahn's algorithm for topological order
  const queue: string[] = [];
  const workingInDegree = new Map(inDegree);
  for (const [id, deg] of workingInDegree) {
    if (deg === 0) queue.push(id);
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    topoOrder.push(curr);

    for (const succ of successors.get(curr) || []) {
      const candidatePath = longestPath.get(curr)! + (taskDuration.get(succ) || 0);
      if (candidatePath > longestPath.get(succ)!) {
        longestPath.set(succ, candidatePath);
        pathPredecessor.set(succ, curr);
      }

      const newDeg = workingInDegree.get(succ)! - 1;
      workingInDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  // Trace back from the task with the longest path to build the critical set
  const criticalPathIds = new Set<string>();
  let maxLen = 0;
  let endTask: string | null = null;

  for (const [id, len] of longestPath) {
    if (len > maxLen) {
      maxLen = len;
      endTask = id;
    }
  }

  let current = endTask;
  while (current !== null) {
    criticalPathIds.add(current);
    current = pathPredecessor.get(current) ?? null;
  }

  return { successors, predecessors, downstreamCount, criticalPathIds };
}

// ─── Resource Analysis ─────────────────────────────────────────────────────

interface ResourceLoad {
  /** assignee name -> list of concurrently active task IDs */
  activeTasks: Map<string, string[]>;
}

/**
 * For each assignee, count how many tasks overlap with the current date.
 * A task is "active" if today falls within [startDate, endDate] and the
 * task is not completed.
 */
function computeResourceLoad(tasks: Map<string, GanttTask>): ResourceLoad {
  const now = today();
  const activeTasks = new Map<string, string[]>();

  for (const [id, task] of tasks) {
    if (!task.assignee) continue;
    if (task.isCompleted) continue;

    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);

    // Task is active if today is within its date range (inclusive)
    if (now.getTime() >= start.getTime() && now.getTime() <= end.getTime()) {
      if (!activeTasks.has(task.assignee)) {
        activeTasks.set(task.assignee, []);
      }
      activeTasks.get(task.assignee)!.push(id);
    }
  }

  return { activeTasks };
}

// ─── Risk Scoring ──────────────────────────────────────────────────────────

/**
 * Compute the Schedule Risk Index for a single task. Returns a RiskAssessment
 * with the composite score and individual factor breakdowns.
 */
function assessTask(
  task: GanttTask,
  graph: DepGraph,
  resourceLoad: ResourceLoad,
): RiskAssessment {
  const factors: RiskFactor[] = [];
  const now = today();
  const start = parseDate(task.startDate);
  const end = parseDate(task.endDate);
  const totalDuration = Math.max(diffDays(start, end), 1); // avoid division by zero
  const elapsed = Math.max(diffDays(start, now), 0);
  const daysRemaining = Math.max(diffDays(now, end), 0);
  const progress = task.progress ?? 0;

  // Skip completed tasks — they carry no schedule risk
  if (task.isCompleted || progress >= 1.0) {
    return {
      taskId: task.id,
      taskName: task.name,
      riskLevel: 'low',
      riskScore: 0,
      factors: [],
      suggestion: undefined,
    };
  }

  // ── Factor 1: Time Pressure (30%) ────────────────────────────────────
  let timePressureRaw = 0;

  const pastDue = now.getTime() > end.getTime();
  if (pastDue) {
    // Task is past its end date — automatic critical-level time pressure
    const daysOverdue = diffDays(end, now);
    // Score scales from 80 (1 day overdue) to 100 (10+ days overdue)
    timePressureRaw = clamp(80 + daysOverdue * 2, 80, 100);
    factors.push({
      type: 'time-pressure',
      description: `Task is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} past its end date`,
      impact: Math.round(timePressureRaw * WEIGHT_TIME_PRESSURE),
    });
  } else {
    // Ratio of remaining time — lower = more pressure
    const remainingRatio = daysRemaining / totalDuration;
    // Check the "< 20% time remaining but < 50% progress" special case
    if (remainingRatio < 0.20 && progress < 0.50) {
      timePressureRaw = 85; // high pressure: running out of time with much work remaining
      factors.push({
        type: 'time-pressure',
        description: `Only ${Math.round(remainingRatio * 100)}% time remaining but only ${Math.round(progress * 100)}% complete`,
        impact: Math.round(timePressureRaw * WEIGHT_TIME_PRESSURE),
      });
    } else {
      // General time pressure: inverse of remaining ratio, scaled 0-70
      // remainingRatio 1.0 (all time left) -> 0 pressure
      // remainingRatio 0.0 (no time left)  -> 70 pressure
      timePressureRaw = clamp(Math.round((1 - remainingRatio) * 70), 0, 70);
      if (timePressureRaw > 0) {
        factors.push({
          type: 'time-pressure',
          description: `${Math.round(remainingRatio * 100)}% of scheduled time remaining`,
          impact: Math.round(timePressureRaw * WEIGHT_TIME_PRESSURE),
        });
      }
    }
  }

  // ── Factor 2: Progress Deviation (25%) ───────────────────────────────
  let progressDeviationRaw = 0;

  // Expected progress based on elapsed time vs total duration
  const expectedProgress = clamp(elapsed / totalDuration, 0, 1);
  const deviation = expectedProgress - progress; // positive = behind schedule

  if (deviation > DEVIATION_CRITICAL) {
    // More than 50% behind where we should be — critical deviation
    progressDeviationRaw = clamp(Math.round(deviation * 150), 75, 100);
    factors.push({
      type: 'progress-deviation',
      description: `${Math.round(deviation * 100)}% behind expected progress (expected ${Math.round(expectedProgress * 100)}%, actual ${Math.round(progress * 100)}%)`,
      impact: Math.round(progressDeviationRaw * WEIGHT_PROGRESS_DEVIATION),
    });
  } else if (deviation > DEVIATION_HIGH) {
    // More than 30% behind — high deviation
    progressDeviationRaw = clamp(Math.round(deviation * 130), 40, 74);
    factors.push({
      type: 'progress-deviation',
      description: `${Math.round(deviation * 100)}% behind expected progress (expected ${Math.round(expectedProgress * 100)}%, actual ${Math.round(progress * 100)}%)`,
      impact: Math.round(progressDeviationRaw * WEIGHT_PROGRESS_DEVIATION),
    });
  } else if (deviation > 0.1) {
    // Slightly behind (> 10%) — minor deviation
    progressDeviationRaw = clamp(Math.round(deviation * 100), 10, 39);
    factors.push({
      type: 'progress-deviation',
      description: `Slightly behind: expected ${Math.round(expectedProgress * 100)}% done, actual ${Math.round(progress * 100)}%`,
      impact: Math.round(progressDeviationRaw * WEIGHT_PROGRESS_DEVIATION),
    });
  }
  // If deviation <= 0.1 (on track or ahead), no risk factor is added.

  // ── Factor 3: Dependency Chain Risk (20%) ────────────────────────────
  let dependencyRaw = 0;

  const downstreamCount = graph.downstreamCount.get(task.id) || 0;
  const onCriticalPath = graph.criticalPathIds.has(task.id);

  if (downstreamCount > 0) {
    // Each downstream dependent adds risk because a delay here cascades.
    // Scale: 1 dependent = 10, 5 = 40, 10+ = 70 (logarithmic growth)
    dependencyRaw = clamp(Math.round(Math.log2(downstreamCount + 1) * 20), 0, 70);

    // Critical path multiplier: tasks on the critical path have 1.5x chain risk
    // because there is zero float — any delay directly extends the project.
    if (onCriticalPath) {
      dependencyRaw = clamp(Math.round(dependencyRaw * 1.5), 0, 100);
    }

    const cpLabel = onCriticalPath ? ' (on critical path)' : '';
    factors.push({
      type: 'dependency-chain',
      description: `${downstreamCount} downstream dependent${downstreamCount === 1 ? '' : 's'}${cpLabel}`,
      impact: Math.round(dependencyRaw * WEIGHT_DEPENDENCY_CHAIN),
    });
  }

  // ── Factor 4: Duration Risk (15%) ────────────────────────────────────
  let durationRaw = 0;

  if (totalDuration > DURATION_HIGH_DAYS) {
    // Tasks longer than 40 days have high inherent uncertainty — they should
    // be decomposed into smaller units for better estimation accuracy.
    durationRaw = 60;
    factors.push({
      type: 'duration',
      description: `Long task (${totalDuration} days) — consider breaking into smaller deliverables`,
      impact: Math.round(durationRaw * WEIGHT_DURATION),
    });
  } else if (totalDuration > DURATION_MEDIUM_DAYS) {
    // Tasks between 20-40 days have moderate uncertainty
    durationRaw = 35;
    factors.push({
      type: 'duration',
      description: `Medium-length task (${totalDuration} days) — monitor closely`,
      impact: Math.round(durationRaw * WEIGHT_DURATION),
    });
  }

  // ── Factor 5: Resource Concentration (10%) ───────────────────────────
  let resourceRaw = 0;

  if (!task.assignee) {
    // No assignee — who is going to do this work?
    resourceRaw = 50;
    factors.push({
      type: 'resource',
      description: 'Task has no assignee',
      impact: Math.round(resourceRaw * WEIGHT_RESOURCE),
    });
  } else {
    const assigneeTasks = resourceLoad.activeTasks.get(task.assignee) || [];
    if (assigneeTasks.length > CONCURRENT_HIGH) {
      // Severely overloaded: > 5 concurrent tasks
      resourceRaw = 80;
      factors.push({
        type: 'resource',
        description: `Assignee "${task.assignee}" has ${assigneeTasks.length} concurrent active tasks`,
        impact: Math.round(resourceRaw * WEIGHT_RESOURCE),
      });
    } else if (assigneeTasks.length > CONCURRENT_WARN) {
      // Moderately overloaded: 4-5 concurrent tasks
      resourceRaw = 45;
      factors.push({
        type: 'resource',
        description: `Assignee "${task.assignee}" has ${assigneeTasks.length} concurrent active tasks`,
        impact: Math.round(resourceRaw * WEIGHT_RESOURCE),
      });
    }
  }

  // ── Composite Score ──────────────────────────────────────────────────
  const score = clamp(
    Math.round(
      timePressureRaw * WEIGHT_TIME_PRESSURE +
      progressDeviationRaw * WEIGHT_PROGRESS_DEVIATION +
      dependencyRaw * WEIGHT_DEPENDENCY_CHAIN +
      durationRaw * WEIGHT_DURATION +
      resourceRaw * WEIGHT_RESOURCE,
    ),
    0,
    100,
  );

  const riskLevel = scoreToLevel(score);

  // ── Summary suggestion ───────────────────────────────────────────────
  let suggestion: string | undefined;
  if (pastDue && progress === 0) {
    suggestion = 'Task is overdue with no progress — escalate immediately';
  } else if (pastDue) {
    suggestion = 'Task is past its deadline — review scope or extend timeline';
  } else if (deviation > DEVIATION_CRITICAL) {
    suggestion = 'Task is significantly behind schedule — investigate blockers';
  } else if (totalDuration > DURATION_HIGH_DAYS && progress < SPLIT_PROGRESS_MAX) {
    suggestion = 'Large task with little progress — consider splitting into smaller work items';
  } else if (riskLevel === 'high' || riskLevel === 'critical') {
    suggestion = 'Multiple risk factors present — review with team lead';
  }

  return {
    taskId: task.id,
    taskName: task.name,
    riskLevel,
    riskScore: score,
    factors,
    suggestion,
  };
}

// ─── Project Health Computation ────────────────────────────────────────────

function computeProjectHealth(
  tasks: Map<string, GanttTask>,
  assessments: Map<string, RiskAssessment>,
  graph: DepGraph,
  resourceLoad: ResourceLoad,
  recommendations: Recommendation[],
): ProjectHealth {
  const now = today();
  let onTrackCount = 0;
  let totalActive = 0;
  let tasksAtRisk = 0;

  // ── On-track ratio ───────────────────────────────────────────────────
  for (const [id, task] of tasks) {
    if (task.isCompleted || (task.progress ?? 0) >= 1.0) continue;
    totalActive++;

    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    const totalDuration = Math.max(diffDays(start, end), 1);
    const elapsed = Math.max(diffDays(start, now), 0);
    const expectedProgress = clamp(elapsed / totalDuration, 0, 1);
    const actualProgress = task.progress ?? 0;

    // On-track if actual progress is within 10% of expected
    if (actualProgress >= expectedProgress - 0.10) {
      onTrackCount++;
    }

    const assessment = assessments.get(id);
    if (assessment && (assessment.riskLevel === 'high' || assessment.riskLevel === 'critical')) {
      tasksAtRisk++;
    }
  }

  const onTrackRatio = totalActive > 0 ? onTrackCount / totalActive : 1;

  // ── Critical path delay ──────────────────────────────────────────────
  // Sum the overdue days for critical path tasks that are past their end date
  let criticalPathDelay = 0;
  for (const cpTaskId of graph.criticalPathIds) {
    const task = tasks.get(cpTaskId);
    if (!task || task.isCompleted) continue;

    const end = parseDate(task.endDate);
    if (now.getTime() > end.getTime()) {
      criticalPathDelay += diffDays(end, now);
    }
  }

  // ── Resource balance ─────────────────────────────────────────────────
  // Compute coefficient of variation of assignee task counts.
  // A perfectly balanced team has CV = 0; highly skewed has CV > 1.
  const loadCounts: number[] = [];
  const bottlenecks: string[] = [];

  for (const [assignee, taskList] of resourceLoad.activeTasks) {
    loadCounts.push(taskList.length);
    if (taskList.length > REASSIGN_OVERLOAD) {
      bottlenecks.push(assignee);
    }
  }

  let resourceBalanceScore = 100; // default: no resource data = no penalty
  if (loadCounts.length > 1) {
    const mean = loadCounts.reduce((a, b) => a + b, 0) / loadCounts.length;
    if (mean > 0) {
      const variance = loadCounts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / loadCounts.length;
      const cv = Math.sqrt(variance) / mean; // coefficient of variation
      // CV of 0 -> score 100 (perfectly balanced)
      // CV of 1 -> score 50 (moderately imbalanced)
      // CV of 2+ -> score 0 (highly imbalanced)
      resourceBalanceScore = clamp(Math.round(100 - cv * 50), 0, 100);
    }
  }

  // ── Completion trajectory ────────────────────────────────────────────
  // Extrapolate: if we continue at the current overall velocity, will we
  // finish on time? Compare the projected end date vs the latest task end.
  let trajectoryScore = 100;
  if (totalActive > 0) {
    let totalProgress = 0;
    let totalElapsedRatio = 0;
    let count = 0;

    for (const task of tasks.values()) {
      if (task.isCompleted) continue;

      const start = parseDate(task.startDate);
      const end = parseDate(task.endDate);
      const totalDuration = Math.max(diffDays(start, end), 1);
      const elapsed = Math.max(diffDays(start, now), 0);
      const elapsedRatio = clamp(elapsed / totalDuration, 0, 2); // can exceed 1 if overdue

      totalProgress += task.progress ?? 0;
      totalElapsedRatio += elapsedRatio;
      count++;
    }

    if (count > 0) {
      const avgProgress = totalProgress / count;
      const avgElapsed = totalElapsedRatio / count;

      // If avgProgress < avgElapsed, we're collectively behind schedule
      if (avgElapsed > 0) {
        const velocityRatio = avgProgress / avgElapsed; // < 1 means behind
        // velocityRatio 1.0 -> score 100 (on pace)
        // velocityRatio 0.5 -> score 50 (half pace)
        // velocityRatio 0.0 -> score 0 (no progress)
        trajectoryScore = clamp(Math.round(velocityRatio * 100), 0, 100);
      }
    }
  }

  // ── Overall health score (weighted average) ──────────────────────────
  // Each component contributes equally (25%) to the overall score.
  const onTrackComponent = onTrackRatio * 100;
  const slackComponent = clamp(100 - criticalPathDelay * 10, 0, 100); // -10 per day of delay

  const overallScore = clamp(
    Math.round(
      onTrackComponent * 0.25 +
      slackComponent * 0.25 +
      resourceBalanceScore * 0.25 +
      trajectoryScore * 0.25,
    ),
    0,
    100,
  );

  return {
    overallScore,
    tasksAtRisk,
    criticalPathDelay,
    resourceBottlenecks: bottlenecks,
    recommendations,
  };
}

// ─── Smart Recommendations Engine ──────────────────────────────────────────

function generateRecommendations(
  tasks: Map<string, GanttTask>,
  graph: DepGraph,
  resourceLoad: ResourceLoad,
  assessments: Map<string, RiskAssessment>,
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const now = today();
  let priorityCounter = 1;

  // ── Escalate: tasks > 5 days past due with 0 progress ───────────────
  for (const [id, task] of tasks) {
    if (task.isCompleted) continue;
    const end = parseDate(task.endDate);
    const daysOverdue = diffDays(end, now);
    const progress = task.progress ?? 0;

    if (daysOverdue > ESCALATE_OVERDUE_DAYS && progress === 0) {
      recommendations.push({
        type: 'escalate',
        description: `"${task.name}" is ${daysOverdue} days overdue with zero progress — flag for management`,
        impact: `Prevents further ${daysOverdue}-day cascade to dependents`,
        taskIds: [id],
        priority: priorityCounter++,
      });
    }
  }

  // ── Split large tasks: > 30 days with < 25% progress ────────────────
  for (const [id, task] of tasks) {
    if (task.isCompleted) continue;
    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    const duration = diffDays(start, end);
    const progress = task.progress ?? 0;

    if (duration > SPLIT_TASK_DAYS && progress < SPLIT_PROGRESS_MAX) {
      const suggestedParts = Math.ceil(duration / 15); // aim for ~15-day chunks
      recommendations.push({
        type: 'split',
        description: `"${task.name}" spans ${duration} days — split into ${suggestedParts} smaller work items`,
        impact: `Improves estimation accuracy and enables earlier risk detection`,
        taskIds: [id],
        priority: priorityCounter++,
      });
    }
  }

  // ── Reassign: overloaded assignees while others are underloaded ──────
  // First, identify overloaded and underloaded resources
  const overloaded: Array<{ assignee: string; taskIds: string[] }> = [];
  const underloaded: string[] = [];

  for (const [assignee, taskList] of resourceLoad.activeTasks) {
    if (taskList.length > REASSIGN_OVERLOAD) {
      overloaded.push({ assignee, taskIds: taskList });
    } else if (taskList.length < REASSIGN_UNDERLOAD) {
      underloaded.push(assignee);
    }
  }

  if (overloaded.length > 0 && underloaded.length > 0) {
    for (const { assignee, taskIds } of overloaded) {
      // Identify non-critical tasks that could be moved
      const movableTasks = taskIds.filter(id => !graph.criticalPathIds.has(id));
      if (movableTasks.length > 0) {
        recommendations.push({
          type: 'reassign',
          description: `"${assignee}" has ${taskIds.length} active tasks — move non-critical work to ${underloaded.join(', ')}`,
          impact: `Reduces ${assignee}'s load and unblocks parallel progress`,
          taskIds: movableTasks,
          priority: priorityCounter++,
        });
      }
    }
  }

  // ── Add buffer: critical path tasks with 0 float near deadline ───────
  for (const cpTaskId of graph.criticalPathIds) {
    const task = tasks.get(cpTaskId);
    if (!task || task.isCompleted) continue;

    const end = parseDate(task.endDate);
    const daysUntilEnd = diffDays(now, end);

    // Near deadline (within 5 days) and on critical path — zero float by definition
    if (daysUntilEnd >= 0 && daysUntilEnd <= 5) {
      const assessment = assessments.get(cpTaskId);
      if (assessment && assessment.riskScore >= MEDIUM_THRESHOLD) {
        recommendations.push({
          type: 'add-buffer',
          description: `"${task.name}" is on the critical path with only ${daysUntilEnd} day${daysUntilEnd === 1 ? '' : 's'} remaining — add schedule buffer`,
          impact: `Protects project end date from a ${daysUntilEnd}-day slip`,
          taskIds: [cpTaskId],
          priority: priorityCounter++,
        });
      }
    }
  }

  // ── Parallelize: sequential critical path tasks with no dependency ───
  // Look for pairs of critical path tasks that are arranged sequentially
  // (one ends before the other starts) but have no dependency between them.
  const criticalTasksSorted = Array.from(graph.criticalPathIds)
    .map(id => tasks.get(id)!)
    .filter(t => t && !t.isCompleted)
    .sort((a, b) => parseDate(a.startDate).getTime() - parseDate(b.startDate).getTime());

  const dependencyPairs = new Set<string>();
  for (const [, succs] of graph.successors) {
    for (const succ of succs) {
      // We don't have the source in this iteration, so build the set from
      // the predecessors map instead.
    }
  }
  // Build a set of "source->target" strings for quick dependency lookup
  for (const [target, preds] of graph.predecessors) {
    for (const pred of preds) {
      dependencyPairs.add(`${pred}->${target}`);
    }
  }

  for (let i = 0; i < criticalTasksSorted.length; i++) {
    for (let j = i + 1; j < criticalTasksSorted.length; j++) {
      const a = criticalTasksSorted[i];
      const b = criticalTasksSorted[j];

      const aEnd = parseDate(a.endDate);
      const bStart = parseDate(b.startDate);

      // They are sequential if A ends before B starts
      if (aEnd.getTime() <= bStart.getTime()) {
        // Check if there's no dependency between them (in either direction)
        const hasDep =
          dependencyPairs.has(`${a.id}->${b.id}`) ||
          dependencyPairs.has(`${b.id}->${a.id}`);

        if (!hasDep) {
          const overlapSavings = diffDays(aEnd, bStart);
          if (overlapSavings > 0) {
            recommendations.push({
              type: 'parallel',
              description: `"${a.name}" and "${b.name}" are sequential but independent — run them in parallel`,
              impact: `Could save up to ${overlapSavings} days on the critical path`,
              taskIds: [a.id, b.id],
              priority: priorityCounter++,
            });
          }
          break; // only report the first parallelizable pair per task
        }
      }
    }
  }

  // Sort by priority (already assigned in order of severity)
  recommendations.sort((a, b) => a.priority - b.priority);

  return recommendations;
}

// ─── Canvas Rendering Helpers ──────────────────────────────────────────────

/**
 * Draw a filled circle at (cx, cy) with the given radius and color.
 * If `pulse` is true, the alpha oscillates over time for a pulsing effect.
 */
function drawDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  pulse: boolean,
  time: number,
): void {
  ctx.save();

  if (pulse) {
    // Sinusoidal pulse: oscillate alpha between PULSE_MIN_ALPHA and 1.0
    const alpha = PULSE_MIN_ALPHA + (1 - PULSE_MIN_ALPHA) * (0.5 + 0.5 * Math.sin(time * PULSE_SPEED));
    ctx.globalAlpha = alpha;
  }

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a circular gauge (arc) representing a 0-100 score.
 * Green at 100, transitioning through yellow/orange to red at 0.
 */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  lineWidth: number,
  score: number,
): void {
  const startAngle = Math.PI * 0.75;   // 7 o'clock position
  const endAngle = Math.PI * 2.25;     // 5 o'clock position
  const totalArc = endAngle - startAngle;
  const scoreAngle = startAngle + totalArc * (score / 100);

  // Background arc (dark gray)
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Score arc (colored by health)
  const color = score >= 75 ? COLOR_LOW :    // green = healthy
                score >= 50 ? COLOR_MEDIUM :  // yellow = warning
                score >= 25 ? COLOR_HIGH :    // orange = poor
                              COLOR_CRITICAL; // red = critical

  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, scoreAngle);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Score text in center
  ctx.fillStyle = OVERLAY_TEXT;
  ctx.font = `bold 18px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${score}`, cx, cy);

  // Label below the score
  ctx.font = '10px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Health', cx, cy + 16);
}

/**
 * Draw a tiny pie chart showing risk distribution.
 */
function drawRiskPie(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  counts: { critical: number; high: number; medium: number; low: number },
): void {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  if (total === 0) return;

  const segments: Array<{ count: number; color: string; label: string }> = [
    { count: counts.critical, color: COLOR_CRITICAL, label: 'Critical' },
    { count: counts.high, color: COLOR_HIGH, label: 'High' },
    { count: counts.medium, color: COLOR_MEDIUM, label: 'Medium' },
    { count: counts.low, color: COLOR_LOW, label: 'Low' },
  ];

  let currentAngle = -Math.PI / 2; // start at top

  for (const seg of segments) {
    if (seg.count === 0) continue;
    const sliceAngle = (seg.count / total) * Math.PI * 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, currentAngle, currentAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();

    currentAngle += sliceAngle;
  }
}

/**
 * Draw the full health dashboard overlay panel.
 */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  headerHeight: number,
  health: ProjectHealth,
  riskCounts: { critical: number; high: number; medium: number; low: number },
): void {
  const x = canvasWidth - OVERLAY_WIDTH - OVERLAY_MARGIN;
  const y = headerHeight + OVERLAY_MARGIN;

  ctx.save();

  // Panel background with rounded corners
  ctx.beginPath();
  const r = OVERLAY_RADIUS;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + OVERLAY_WIDTH - r, y);
  ctx.arcTo(x + OVERLAY_WIDTH, y, x + OVERLAY_WIDTH, y + r, r);
  ctx.lineTo(x + OVERLAY_WIDTH, y + OVERLAY_HEIGHT - r);
  ctx.arcTo(x + OVERLAY_WIDTH, y + OVERLAY_HEIGHT, x + OVERLAY_WIDTH - r, y + OVERLAY_HEIGHT, r);
  ctx.lineTo(x + r, y + OVERLAY_HEIGHT);
  ctx.arcTo(x, y + OVERLAY_HEIGHT, x, y + OVERLAY_HEIGHT - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fillStyle = OVERLAY_BG;
  ctx.fill();

  // ── Title ────────────────────────────────────────────────────────────
  ctx.fillStyle = OVERLAY_TEXT;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Project Health', x + OVERLAY_PADDING, y + OVERLAY_PADDING);

  // ── Gauge (centered in left half of the panel) ───────────────────────
  const gaugeX = x + OVERLAY_PADDING + GAUGE_RADIUS + 4;
  const gaugeY = y + OVERLAY_PADDING + 20 + GAUGE_RADIUS + 8;
  drawGauge(ctx, gaugeX, gaugeY, GAUGE_RADIUS, GAUGE_LINE_WIDTH, health.overallScore);

  // ── Risk pie (right of gauge) ────────────────────────────────────────
  const pieRadius = 24;
  const pieX = x + OVERLAY_WIDTH - OVERLAY_PADDING - pieRadius - 4;
  const pieY = gaugeY;
  drawRiskPie(ctx, pieX, pieY, pieRadius, riskCounts);

  // Risk count labels below pie
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  const labelY = pieY + pieRadius + 8;
  const labels = [
    { count: riskCounts.critical, color: COLOR_CRITICAL, label: 'C' },
    { count: riskCounts.high, color: COLOR_HIGH, label: 'H' },
    { count: riskCounts.medium, color: COLOR_MEDIUM, label: 'M' },
    { count: riskCounts.low, color: COLOR_LOW, label: 'L' },
  ];
  const labelSpacing = 28;
  const labelsStartX = pieX - (labels.length * labelSpacing) / 2 + labelSpacing / 2;
  for (let i = 0; i < labels.length; i++) {
    const lbl = labels[i];
    const lx = labelsStartX + i * labelSpacing;
    ctx.fillStyle = lbl.color;
    ctx.fillText(`${lbl.label}:${lbl.count}`, lx, labelY);
  }

  // ── Stats line ───────────────────────────────────────────────────────
  const statsY = gaugeY + GAUGE_RADIUS + 28;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(
    `At risk: ${health.tasksAtRisk}  |  CP delay: ${health.criticalPathDelay}d`,
    x + OVERLAY_PADDING,
    statsY,
  );

  // ── Top 3 recommendations ────────────────────────────────────────────
  const recsStartY = statsY + 18;
  ctx.font = '10px sans-serif';
  ctx.fillStyle = OVERLAY_TEXT;
  ctx.fillText('Recommendations:', x + OVERLAY_PADDING, recsStartY);

  const topRecs = health.recommendations.slice(0, 3);
  for (let i = 0; i < topRecs.length; i++) {
    const rec = topRecs[i];
    const recY = recsStartY + 14 + i * 16;
    const typeIcon =
      rec.type === 'escalate'  ? '\u26A0' :  // warning sign
      rec.type === 'split'     ? '\u2702' :  // scissors
      rec.type === 'reassign'  ? '\u21C4' :  // right/left arrows
      rec.type === 'parallel'  ? '\u21C9' :  // parallel arrows
      rec.type === 'add-buffer'? '\u23F1' :  // stopwatch
                                 '\u2139';   // info circle

    // Truncate long descriptions to fit the overlay width
    const maxChars = 34;
    const desc = rec.description.length > maxChars
      ? rec.description.substring(0, maxChars - 1) + '\u2026'
      : rec.description;

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${typeIcon} ${desc}`, x + OVERLAY_PADDING, recY);
  }

  if (topRecs.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('No action items \u2014 looking good!', x + OVERLAY_PADDING, recsStartY + 14);
  }

  ctx.restore();
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function RiskAnalysisPlugin(): NimbusGanttPlugin {
  let host: PluginHost;
  let unsubscribers: Array<() => void> = [];

  // Analysis state
  let assessments = new Map<string, RiskAssessment>();
  let health: ProjectHealth = {
    overallScore: 100,
    tasksAtRisk: 0,
    criticalPathDelay: 0,
    resourceBottlenecks: [],
    recommendations: [],
  };
  let recommendations: Recommendation[] = [];
  let showOverlay = false;
  let animationStart = Date.now();

  /** Run the full analysis pipeline on current state */
  function recalculate(): void {
    const state = host.getState();
    const { tasks, dependencies } = state;

    if (tasks.size === 0) {
      assessments = new Map();
      recommendations = [];
      health = {
        overallScore: 100,
        tasksAtRisk: 0,
        criticalPathDelay: 0,
        resourceBottlenecks: [],
        recommendations: [],
      };
      return;
    }

    // Step 1: Build dependency graph and resource load
    const graph = buildDepGraph(tasks, dependencies);
    const resourceLoad = computeResourceLoad(tasks);

    // Step 2: Assess each task individually
    const newAssessments = new Map<string, RiskAssessment>();
    for (const [id, task] of tasks) {
      newAssessments.set(id, assessTask(task, graph, resourceLoad));
    }
    assessments = newAssessments;

    // Step 3: Generate recommendations
    recommendations = generateRecommendations(tasks, graph, resourceLoad, assessments);

    // Step 4: Compute project health
    health = computeProjectHealth(tasks, assessments, graph, resourceLoad, recommendations);
  }

  return {
    name: 'RiskAnalysisPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      animationStart = Date.now();

      // Initial analysis
      recalculate();

      // Register event handlers for queries
      unsubscribers.push(
        host.on('risk:analysis', (callback: unknown) => {
          if (typeof callback === 'function') {
            (callback as (data: Map<string, RiskAssessment>) => void)(assessments);
          }
        }),
      );

      unsubscribers.push(
        host.on('risk:health', (callback: unknown) => {
          if (typeof callback === 'function') {
            (callback as (data: ProjectHealth) => void)(health);
          }
        }),
      );

      unsubscribers.push(
        host.on('risk:recommendations', (callback: unknown) => {
          if (typeof callback === 'function') {
            (callback as (data: Recommendation[]) => void)(recommendations);
          }
        }),
      );

      unsubscribers.push(
        host.on('risk:toggle-overlay', () => {
          showOverlay = !showOverlay;
        }),
      );
    },

    middleware(action: Action, next: (action: Action) => void): void {
      // Let the action propagate first so state is updated
      next(action);

      // Recalculate after data-changing actions
      const triggers: Action['type'][] = [
        'SET_DATA',
        'TASK_MOVE',
        'TASK_RESIZE',
        'UPDATE_TASK',
        'ADD_TASK',
        'REMOVE_TASK',
        'ADD_DEPENDENCY',
        'REMOVE_DEPENDENCY',
      ];

      if (triggers.includes(action.type)) {
        recalculate();
      }
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (assessments.size === 0) return;

      const { headerHeight } = state.config;
      const scrollX = state.scrollX;
      const scrollY = state.scrollY;
      const bodyTop = headerHeight;
      const elapsed = Date.now() - animationStart;

      ctx.save();

      // Clip to the timeline body area (below headers)
      ctx.beginPath();
      ctx.rect(0, bodyTop, ctx.canvas.width, ctx.canvas.height - bodyTop);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      // ── Draw risk indicator dots on each task bar ────────────────────
      for (const layout of layouts) {
        const assessment = assessments.get(layout.taskId);
        if (!assessment || assessment.riskLevel === 'low') continue;

        const barX = layout.x;
        const barY = layout.barY - scrollY;
        const barW = layout.width;
        const barH = layout.barHeight;

        // Skip bars outside the visible area
        if (barY + barH < bodyTop || barY > ctx.canvas.height) continue;
        if (barX + barW < 0) continue;

        // Position the dot at the top-right corner of the bar
        const dotCx = barX + barW - DOT_RADIUS - DOT_MARGIN;
        const dotCy = barY + DOT_RADIUS + DOT_MARGIN;
        const color = levelToColor(assessment.riskLevel);
        const pulse = assessment.riskLevel === 'critical'; // only critical dots pulse

        drawDot(ctx, dotCx, dotCy, DOT_RADIUS, color, pulse, elapsed);
      }

      ctx.restore();

      // ── Health dashboard overlay (drawn in screen coordinates) ───────
      if (showOverlay) {
        const riskCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const assessment of assessments.values()) {
          riskCounts[assessment.riskLevel]++;
        }

        ctx.save();
        drawOverlay(
          ctx,
          ctx.canvas.width,
          headerHeight,
          health,
          riskCounts,
        );
        ctx.restore();
      }
    },

    destroy(): void {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers = [];
      assessments = new Map();
      recommendations = [];
    },
  };
}
