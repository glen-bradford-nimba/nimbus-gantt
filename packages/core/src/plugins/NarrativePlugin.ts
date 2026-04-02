// ─── Narrative Plugin ───────────────────────────────────────────────────────
// Generates a human-readable, week-by-week "story" of the project by
// algorithmically analyzing the schedule data. No external AI API is needed —
// headlines, body paragraphs, and insights are produced from template-based
// natural language generation over the task/dependency graph.
//
// Rendering: a "Story" toolbar button opens a 400px slide-out panel from the
// right with scrollable, color-coded weekly chapters and an insights section.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  GanttDependency,
} from '../model/types';

// ─── Public Data Structures ────────────────────────────────────────────────

export interface ProjectNarrative {
  title: string;
  generatedAt: number;
  summary: string;
  chapters: NarrativeChapter[];
  insights: string[];
}

export interface NarrativeChapter {
  weekLabel: string;
  headline: string;
  body: string;
  metrics: { started: number; completed: number; delayed: number; onTrack: number };
  events: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const PANEL_WIDTH = 400;
const STYLE_ID = 'nimbus-gantt-narrative-styles';
const TRANSITION_MS = 300;

// ─── Date Helpers ──────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function formatShortDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatDateISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Return the Monday on or before the given date (UTC) */
function startOfWeek(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  return new Date(d.getTime() - diff * MS_PER_DAY);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

// ─── Narrative Generation ──────────────────────────────────────────────────

function generateNarrative(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
): ProjectNarrative {
  const taskList = Array.from(tasks.values());

  if (taskList.length === 0) {
    return {
      title: 'Project Narrative',
      generatedAt: Date.now(),
      summary: 'No tasks found. Add tasks to generate a project narrative.',
      chapters: [],
      insights: [],
    };
  }

  // ── Compute project date range ────────────────────────────────────────
  let projectStart = Infinity;
  let projectEnd = -Infinity;

  for (const t of taskList) {
    const s = parseDate(t.startDate).getTime();
    const e = parseDate(t.endDate).getTime();
    if (s < projectStart) projectStart = s;
    if (e > projectEnd) projectEnd = e;
  }

  const startDate = new Date(projectStart);
  const endDate = new Date(projectEnd);
  const totalDuration = diffDays(startDate, endDate);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // ── Build dependency lookup (successors per task) ─────────────────────
  const successorMap = new Map<string, string[]>();
  const predecessorMap = new Map<string, string[]>();

  for (const dep of dependencies.values()) {
    if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;
    if (!successorMap.has(dep.source)) successorMap.set(dep.source, []);
    successorMap.get(dep.source)!.push(dep.target);
    if (!predecessorMap.has(dep.target)) predecessorMap.set(dep.target, []);
    predecessorMap.get(dep.target)!.push(dep.source);
  }

  // ── Compute critical path task IDs (simplified: longest chain) ────────
  const criticalIds = computeSimpleCriticalPath(taskList, dependencies);

  // ── Divide into weeks ─────────────────────────────────────────────────
  const weekStart = startOfWeek(startDate);
  const weekEnd = startOfWeek(endDate);
  const weeks: Array<{ start: Date; end: Date }> = [];

  let cursor = weekStart;
  while (cursor.getTime() <= weekEnd.getTime()) {
    weeks.push({ start: new Date(cursor), end: addDays(cursor, 6) });
    cursor = addDays(cursor, 7);
  }

  // ── Build chapters ────────────────────────────────────────────────────
  const chapters: NarrativeChapter[] = [];

  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    const wStart = week.start;
    const wEnd = week.end;

    const started: GanttTask[] = [];
    const completed: GanttTask[] = [];
    const delayed: GanttTask[] = [];
    const onTrack: GanttTask[] = [];
    const active: GanttTask[] = [];
    const milestones: GanttTask[] = [];
    const events: string[] = [];

    for (const t of taskList) {
      const tStart = parseDate(t.startDate);
      const tEnd = parseDate(t.endDate);

      // Task starts this week
      if (tStart >= wStart && tStart <= wEnd) {
        started.push(t);
        if (t.isMilestone) {
          milestones.push(t);
          events.push(`Milestone: ${t.name}`);
        } else {
          events.push(`Started: ${t.name}`);
        }
      }

      // Task ends this week
      if (tEnd >= wStart && tEnd <= wEnd) {
        if (t.isCompleted || (t.progress !== undefined && t.progress >= 1.0)) {
          completed.push(t);
          events.push(`Completed: ${t.name}`);
        }
      }

      // Active during this week
      if (tStart <= wEnd && tEnd >= wStart) {
        active.push(t);

        // Delayed: should have started by now (past start), but has 0 progress
        if (tStart < wStart && !t.isCompleted && (t.progress === undefined || t.progress === 0)) {
          delayed.push(t);
        }

        // On track: has progress > 0 or not yet past start
        if (!t.isCompleted && (t.progress !== undefined && t.progress > 0 && t.progress < 1.0)) {
          onTrack.push(t);
        }
      }
    }

    // Milestones that land this week
    for (const t of taskList) {
      if (t.isMilestone) {
        const tStart = parseDate(t.startDate);
        if (tStart >= wStart && tStart <= wEnd && !milestones.includes(t)) {
          milestones.push(t);
          events.push(`Milestone: ${t.name}`);
        }
      }
    }

    // ── Check for critical path tasks in play ───────────────────────────
    const criticalActive = active.filter(t => criticalIds.has(t.id));

    // ── Generate headline ───────────────────────────────────────────────
    const headline = generateHeadline(started, completed, delayed, active, criticalActive);

    // ── Generate body paragraph ─────────────────────────────────────────
    const body = generateBody(
      started, completed, delayed, onTrack, active, criticalActive,
      milestones, successorMap, tasks,
    );

    // Week label
    const weekLabel = `Week ${i + 1} (${formatShortDate(wStart)}\u2013${formatShortDate(wEnd)})`;

    chapters.push({
      weekLabel,
      headline,
      body,
      metrics: {
        started: started.length,
        completed: completed.length,
        delayed: delayed.length,
        onTrack: onTrack.length,
      },
      events,
    });
  }

  // ── Generate summary ──────────────────────────────────────────────────
  const totalTasks = taskList.length;
  const completedTasks = taskList.filter(t => t.isCompleted || (t.progress !== undefined && t.progress >= 1.0)).length;
  const inProgressTasks = taskList.filter(t => !t.isCompleted && t.progress !== undefined && t.progress > 0 && t.progress < 1.0).length;
  const notStartedTasks = totalTasks - completedTasks - inProgressTasks;
  const completionPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const healthWord = completionPct >= 75 ? 'strong' :
    completionPct >= 50 ? 'moderate' :
      completionPct >= 25 ? 'early-stage' : 'just getting started';

  const summary = `This project spans ${totalDuration} days across ${weeks.length} weeks ` +
    `with ${totalTasks} tasks. Progress is ${healthWord} at ${completionPct}% completion ` +
    `(${completedTasks} done, ${inProgressTasks} in progress, ${notStartedTasks} not started).`;

  // ── Generate insights ─────────────────────────────────────────────────
  const insights = generateInsights(
    taskList, criticalIds, successorMap, predecessorMap,
    startDate, endDate, today,
  );

  return {
    title: 'Project Narrative',
    generatedAt: Date.now(),
    summary,
    chapters,
    insights,
  };
}

// ─── Headline Templates ────────────────────────────────────────────────────

function generateHeadline(
  started: GanttTask[],
  completed: GanttTask[],
  delayed: GanttTask[],
  active: GanttTask[],
  criticalActive: GanttTask[],
): string {
  // Priority: critical > delays > completions > starts > quiet
  if (criticalActive.length > 0 && delayed.length > 0) {
    const names = criticalActive.slice(0, 2).map(t => t.name).join(', ');
    return `Crunch time: critical path tasks ${names} in play`;
  }
  if (delayed.length >= 3) {
    return `Headwinds: ${delayed.length} tasks falling behind schedule`;
  }
  if (delayed.length > 0 && completed.length > 0) {
    return `Mixed signals: ${completed.length} completed but ${delayed.length} delayed`;
  }
  if (completed.length >= 3) {
    return `Momentum builds: ${completed.length} tasks completed`;
  }
  if (completed.length > 0 && started.length > 0) {
    return `Progress: ${completed.length} finished, ${started.length} new tasks launched`;
  }
  if (started.length >= 4) {
    return `Busy launch: ${started.length} new tasks kicked off`;
  }
  if (started.length > 0) {
    return `${started.length} new task${started.length > 1 ? 's' : ''} kicked off this week`;
  }
  if (delayed.length > 0) {
    return `Caution: ${delayed.length} task${delayed.length > 1 ? 's' : ''} with no progress`;
  }
  if (active.length > 0) {
    return `Steady progress across ${active.length} active tasks`;
  }
  return 'Quiet week with no scheduled activity';
}

// ─── Body Paragraph Generation ─────────────────────────────────────────────

function generateBody(
  started: GanttTask[],
  completed: GanttTask[],
  delayed: GanttTask[],
  onTrack: GanttTask[],
  active: GanttTask[],
  criticalActive: GanttTask[],
  milestones: GanttTask[],
  successorMap: Map<string, string[]>,
  tasks: Map<string, GanttTask>,
): string {
  const parts: string[] = [];

  // What happened: starts
  if (started.length > 0) {
    if (started.length <= 3) {
      const names = started.map(t => t.name).join(', ');
      parts.push(`Work began on ${names}.`);
    } else {
      const first = started.slice(0, 2).map(t => t.name).join(', ');
      parts.push(`${started.length} tasks kicked off including ${first} and ${started.length - 2} more.`);
    }
  }

  // Completions
  if (completed.length > 0) {
    if (completed.length <= 3) {
      const names = completed.map(t => t.name).join(', ');
      parts.push(`${names} ${completed.length === 1 ? 'was' : 'were'} completed.`);
    } else {
      parts.push(`${completed.length} tasks reached completion this week.`);
    }
  }

  // On track
  if (onTrack.length > 0) {
    parts.push(`${onTrack.length} task${onTrack.length > 1 ? 's are' : ' is'} progressing on schedule.`);
  }

  // Milestones
  if (milestones.length > 0) {
    const names = milestones.map(t => t.name).join(', ');
    parts.push(`Milestone${milestones.length > 1 ? 's' : ''} reached: ${names}.`);
  }

  // Impact analysis: delayed tasks and downstream effects
  if (delayed.length > 0) {
    if (delayed.length <= 3) {
      const names = delayed.map(t => t.name).join(', ');
      parts.push(`${names} ${delayed.length === 1 ? 'has' : 'have'} not started despite being past the planned start date.`);
    } else {
      parts.push(`${delayed.length} tasks have not started despite being past their planned start dates.`);
    }

    // Check downstream impact
    const impacted: string[] = [];
    for (const d of delayed) {
      const successors = successorMap.get(d.id);
      if (successors) {
        for (const sId of successors) {
          const sTask = tasks.get(sId);
          if (sTask && !impacted.includes(sTask.name)) {
            impacted.push(sTask.name);
          }
        }
      }
    }
    if (impacted.length > 0) {
      const impactNames = impacted.slice(0, 3).join(', ');
      parts.push(`This puts downstream work at risk, including ${impactNames}${impacted.length > 3 ? ` and ${impacted.length - 3} more` : ''}.`);
    }
  }

  // Critical path context
  if (criticalActive.length > 0 && parts.length < 4) {
    const names = criticalActive.slice(0, 2).map(t => t.name).join(' and ');
    parts.push(`Critical path activity: ${names} — any delay here pushes the project finish date.`);
  }

  // Resource observations
  const assigneeLoad = new Map<string, number>();
  for (const t of active) {
    if (t.assignee) {
      assigneeLoad.set(t.assignee, (assigneeLoad.get(t.assignee) || 0) + 1);
    }
  }
  const busiest = Array.from(assigneeLoad.entries()).sort((a, b) => b[1] - a[1]);
  if (busiest.length > 0 && busiest[0][1] >= 3) {
    parts.push(`${busiest[0][0]} is carrying a heavy load with ${busiest[0][1]} concurrent tasks.`);
  }

  if (parts.length === 0) {
    parts.push('No significant activity scheduled for this week.');
  }

  return parts.join(' ');
}

// ─── Insights Generation ───────────────────────────────────────────────────

function generateInsights(
  taskList: GanttTask[],
  criticalIds: Set<string>,
  successorMap: Map<string, string[]>,
  predecessorMap: Map<string, string[]>,
  projectStart: Date,
  projectEnd: Date,
  today: Date,
): string[] {
  const insights: string[] = [];

  // Critical path insight
  if (criticalIds.size > 0) {
    const criticalTasks = taskList.filter(t => criticalIds.has(t.id));
    const names = criticalTasks.slice(0, 4).map(t => t.name).join(', ');
    const suffix = criticalTasks.length > 4 ? ` and ${criticalTasks.length - 4} more` : '';
    insights.push(`The critical path runs through ${names}${suffix} — any delay here pushes the project finish.`);
  }

  // Heaviest loaded assignee
  const assigneeCount = new Map<string, number>();
  for (const t of taskList) {
    if (t.assignee && !t.isCompleted) {
      assigneeCount.set(t.assignee, (assigneeCount.get(t.assignee) || 0) + 1);
    }
  }
  const sorted = Array.from(assigneeCount.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] >= 2) {
    insights.push(`${sorted[0][0]} is carrying the heaviest load with ${sorted[0][1]} concurrent tasks.`);
  }

  // Zero-progress tasks past start date
  const zeroProg = taskList.filter(t => {
    if (t.isCompleted) return false;
    const s = parseDate(t.startDate);
    return s < today && (t.progress === undefined || t.progress === 0);
  });
  if (zeroProg.length > 0) {
    insights.push(`${zeroProg.length} task${zeroProg.length > 1 ? 's have' : ' has'} zero progress despite being past ${zeroProg.length > 1 ? 'their' : 'its'} start date${zeroProg.length > 1 ? 's' : ''}.`);
  }

  // Overall schedule position
  const totalDuration = diffDays(projectStart, projectEnd);
  const elapsed = diffDays(projectStart, today);
  if (elapsed > 0 && totalDuration > 0) {
    const timePct = Math.round((elapsed / totalDuration) * 100);
    const completedTasks = taskList.filter(t => t.isCompleted || (t.progress !== undefined && t.progress >= 1.0)).length;
    const completionPct = Math.round((completedTasks / taskList.length) * 100);
    const diff = completionPct - timePct;
    if (Math.abs(diff) >= 5) {
      if (diff > 0) {
        insights.push(`Project is running ahead: ${completionPct}% of tasks completed with ${timePct}% of time elapsed.`);
      } else {
        insights.push(`Project is running behind: only ${completionPct}% of tasks completed with ${timePct}% of time elapsed.`);
      }
    } else {
      insights.push(`Project is tracking close to schedule: ${completionPct}% complete at ${timePct}% of elapsed time.`);
    }
  }

  // Unblocked tasks (no predecessors, not started)
  const unblocked = taskList.filter(t => {
    if (t.isCompleted || (t.progress !== undefined && t.progress > 0)) return false;
    const preds = predecessorMap.get(t.id);
    return !preds || preds.length === 0;
  });
  if (unblocked.length > 0 && unblocked.length <= taskList.length * 0.5) {
    insights.push(`${unblocked.length} task${unblocked.length > 1 ? 's are' : ' is'} unblocked and ready to start.`);
  }

  // Bottleneck: task with most dependents
  let maxDeps = 0;
  let bottleneck = '';
  for (const t of taskList) {
    const succs = successorMap.get(t.id);
    if (succs && succs.length > maxDeps) {
      maxDeps = succs.length;
      bottleneck = t.name;
    }
  }
  if (maxDeps >= 3) {
    insights.push(`"${bottleneck}" is a bottleneck with ${maxDeps} downstream tasks depending on it.`);
  }

  return insights;
}

// ─── Simplified Critical Path (longest FS chain) ───────────────────────────

function computeSimpleCriticalPath(
  taskList: GanttTask[],
  dependencies: Map<string, GanttDependency>,
): Set<string> {
  const taskMap = new Map<string, GanttTask>();
  for (const t of taskList) taskMap.set(t.id, t);

  // Build FS adjacency
  const succ = new Map<string, Array<{ target: string; lag: number }>>();
  const inDegree = new Map<string, number>();

  for (const t of taskList) {
    succ.set(t.id, []);
    inDegree.set(t.id, 0);
  }

  for (const dep of dependencies.values()) {
    if ((dep.type || 'FS') !== 'FS') continue;
    if (!taskMap.has(dep.source) || !taskMap.has(dep.target)) continue;
    succ.get(dep.source)!.push({ target: dep.target, lag: dep.lag || 0 });
    inDegree.set(dep.target, (inDegree.get(dep.target) || 0) + 1);
  }

  // Forward pass: compute earliest finish
  const ef = new Map<string, number>();
  const queue: string[] = [];

  for (const t of taskList) {
    if (inDegree.get(t.id) === 0) queue.push(t.id);
  }

  for (const t of taskList) {
    const end = parseDate(t.endDate).getTime();
    ef.set(t.id, end);
  }

  // Topological BFS
  const topo: string[] = [];
  const workDeg = new Map(inDegree);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    topo.push(cur);
    const curEF = ef.get(cur)!;
    for (const edge of succ.get(cur)!) {
      const task = taskMap.get(edge.target)!;
      const duration = parseDate(task.endDate).getTime() - parseDate(task.startDate).getTime();
      const candidateEF = curEF + edge.lag * MS_PER_DAY + duration;
      if (candidateEF > ef.get(edge.target)!) {
        ef.set(edge.target, candidateEF);
      }
      const nd = workDeg.get(edge.target)! - 1;
      workDeg.set(edge.target, nd);
      if (nd === 0) queue.push(edge.target);
    }
  }

  // Find project end (max EF) and trace back
  let maxEF = -Infinity;
  let endId = '';
  for (const [id, val] of ef) {
    if (val > maxEF) { maxEF = val; endId = id; }
  }

  if (!endId) return new Set();

  // Backward trace: from end, follow the predecessor that produces the latest EF
  const critical = new Set<string>();
  const pred = new Map<string, Array<{ source: string; lag: number }>>();
  for (const t of taskList) pred.set(t.id, []);
  for (const dep of dependencies.values()) {
    if ((dep.type || 'FS') !== 'FS') continue;
    if (!taskMap.has(dep.source) || !taskMap.has(dep.target)) continue;
    pred.get(dep.target)!.push({ source: dep.source, lag: dep.lag || 0 });
  }

  let cur = endId;
  while (cur) {
    critical.add(cur);
    const preds = pred.get(cur);
    if (!preds || preds.length === 0) break;
    // Pick predecessor with highest EF
    let bestPred = '';
    let bestEF = -Infinity;
    for (const p of preds) {
      const pEF = ef.get(p.source) || 0;
      if (pEF > bestEF) { bestEF = pEF; bestPred = p.source; }
    }
    if (!bestPred || critical.has(bestPred)) break;
    cur = bestPred;
  }

  return critical;
}

// ─── CSS ───────────────────────────────────────────────────────────────────

const NARRATIVE_CSS = `
  .ng-narrative-btn {
    position: absolute;
    bottom: 16px;
    right: 64px;
    height: 36px;
    padding: 0 14px;
    border-radius: 18px;
    background: rgba(99, 102, 241, 0.9);
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    z-index: 1000;
    transition: background 200ms ease, transform 200ms ease;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;
    line-height: 1;
  }
  .ng-narrative-btn:hover {
    background: rgba(99, 102, 241, 1);
    transform: scale(1.04);
  }
  .ng-narrative-btn-icon {
    font-size: 16px;
  }

  .ng-narrative-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1001;
    opacity: 0;
    pointer-events: none;
    transition: opacity ${TRANSITION_MS}ms ease;
  }
  .ng-narrative-overlay.ng-visible {
    opacity: 1;
    pointer-events: auto;
  }

  .ng-narrative-panel {
    position: absolute;
    top: 0;
    right: -${PANEL_WIDTH}px;
    width: ${PANEL_WIDTH}px;
    height: 100%;
    background: #1e1e2e;
    color: #e0e0e0;
    z-index: 1002;
    overflow-y: auto;
    overflow-x: hidden;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
    transition: right ${TRANSITION_MS}ms ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
  }
  .ng-narrative-panel.ng-open {
    right: 0;
  }

  .ng-narrative-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #333;
    font-size: 15px;
    font-weight: 600;
    position: sticky;
    top: 0;
    background: #1e1e2e;
    z-index: 1;
  }
  .ng-narrative-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ng-narrative-close {
    background: none;
    border: none;
    color: #999;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .ng-narrative-close:hover {
    color: #fff;
  }

  .ng-narrative-refresh {
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 150ms, background 150ms;
  }
  .ng-narrative-refresh:hover {
    color: #fff;
    background: rgba(255,255,255,0.08);
  }

  .ng-narrative-summary {
    padding: 16px;
    border-bottom: 1px solid #2a2a3a;
    font-size: 13px;
    line-height: 1.6;
    color: #cbd5e1;
  }

  .ng-narrative-chapter {
    border-bottom: 1px solid #2a2a3a;
  }

  .ng-narrative-chapter-header {
    padding: 12px 16px;
    font-weight: 600;
    font-size: 13px;
    border-left: 4px solid;
  }
  .ng-narrative-chapter-header.ng-good {
    border-left-color: #22c55e;
    background: rgba(34, 197, 94, 0.06);
  }
  .ng-narrative-chapter-header.ng-mixed {
    border-left-color: #f59e0b;
    background: rgba(245, 158, 11, 0.06);
  }
  .ng-narrative-chapter-header.ng-troubled {
    border-left-color: #ef4444;
    background: rgba(239, 68, 68, 0.06);
  }
  .ng-narrative-chapter-header.ng-quiet {
    border-left-color: #64748b;
    background: rgba(100, 116, 139, 0.06);
  }

  .ng-narrative-week-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #888;
    margin-bottom: 4px;
  }

  .ng-narrative-headline {
    font-size: 13px;
    color: #e2e8f0;
  }

  .ng-narrative-metrics {
    display: flex;
    gap: 6px;
    padding: 8px 16px;
    flex-wrap: wrap;
  }

  .ng-narrative-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .ng-narrative-badge.ng-started {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }
  .ng-narrative-badge.ng-completed {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }
  .ng-narrative-badge.ng-delayed {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }
  .ng-narrative-badge.ng-ontrack {
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
  }

  .ng-narrative-body {
    padding: 8px 16px 16px;
    font-size: 12.5px;
    line-height: 1.65;
    color: #94a3b8;
  }

  .ng-narrative-insights {
    padding: 16px;
  }
  .ng-narrative-insights-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
    color: #e2e8f0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ng-narrative-insight {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 12.5px;
    line-height: 1.55;
    color: #94a3b8;
  }
  .ng-narrative-insight-icon {
    flex-shrink: 0;
    font-size: 14px;
    margin-top: 1px;
  }

  .ng-narrative-empty {
    padding: 40px 16px;
    text-align: center;
    color: #64748b;
    font-size: 13px;
  }

  .ng-narrative-timestamp {
    padding: 12px 16px;
    font-size: 10px;
    color: #475569;
    text-align: center;
    border-top: 1px solid #2a2a3a;
  }
`;

// ─── CSS Injection ─────────────────────────────────────────────────────────

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = NARRATIVE_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── Chapter Color Classification ──────────────────────────────────────────

function chapterMood(ch: NarrativeChapter): 'good' | 'mixed' | 'troubled' | 'quiet' {
  const { started, completed, delayed } = ch.metrics;
  if (delayed >= 3) return 'troubled';
  if (delayed > 0 && (completed > 0 || started > 0)) return 'mixed';
  if (completed > 0 || started > 0) return 'good';
  if (delayed > 0) return 'troubled';
  return 'quiet';
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function NarrativePlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  let narrative: ProjectNarrative | null = null;
  let isOpen = false;
  let unsubs: Array<() => void> = [];

  // DOM references
  let storyBtn: HTMLButtonElement | null = null;
  let overlay: HTMLDivElement | null = null;
  let panel: HTMLDivElement | null = null;

  function regenerate(): void {
    if (!host) return;
    const state = host.getState();
    narrative = generateNarrative(state.tasks, state.dependencies);
  }

  function openPanel(): void {
    isOpen = true;
    regenerate();
    if (overlay) overlay.classList.add('ng-visible');
    if (panel) panel.classList.add('ng-open');
    renderContent();
  }

  function closePanel(): void {
    isOpen = false;
    if (overlay) overlay.classList.remove('ng-visible');
    if (panel) panel.classList.remove('ng-open');
  }

  function renderContent(): void {
    if (!panel || !narrative) return;
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'ng-narrative-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'ng-narrative-header-left';

    const titleIcon = document.createElement('span');
    titleIcon.textContent = '\uD83D\uDCD6'; // book emoji
    headerLeft.appendChild(titleIcon);

    const titleText = document.createElement('span');
    titleText.textContent = 'Project Story';
    headerLeft.appendChild(titleText);

    header.appendChild(headerLeft);

    const headerRight = document.createElement('div');
    headerRight.style.display = 'flex';
    headerRight.style.alignItems = 'center';
    headerRight.style.gap = '4px';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'ng-narrative-refresh';
    refreshBtn.innerHTML = '\u21BB'; // refresh arrow
    refreshBtn.title = 'Regenerate';
    refreshBtn.addEventListener('click', () => {
      regenerate();
      renderContent();
    });
    headerRight.appendChild(refreshBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ng-narrative-close';
    closeBtn.innerHTML = '\u00D7';
    closeBtn.addEventListener('click', closePanel);
    headerRight.appendChild(closeBtn);

    header.appendChild(headerRight);
    panel.appendChild(header);

    // Summary
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'ng-narrative-summary';
    summaryDiv.textContent = narrative.summary;
    panel.appendChild(summaryDiv);

    // Chapters
    if (narrative.chapters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ng-narrative-empty';
      empty.textContent = 'No weekly chapters to display.';
      panel.appendChild(empty);
    } else {
      for (const ch of narrative.chapters) {
        const chapterDiv = document.createElement('div');
        chapterDiv.className = 'ng-narrative-chapter';

        // Chapter header with color
        const mood = chapterMood(ch);
        const chHeader = document.createElement('div');
        chHeader.className = `ng-narrative-chapter-header ng-${mood}`;

        const weekLabel = document.createElement('div');
        weekLabel.className = 'ng-narrative-week-label';
        weekLabel.textContent = ch.weekLabel;
        chHeader.appendChild(weekLabel);

        const headline = document.createElement('div');
        headline.className = 'ng-narrative-headline';
        headline.textContent = ch.headline;
        chHeader.appendChild(headline);

        chapterDiv.appendChild(chHeader);

        // Metrics badges
        const metricsDiv = document.createElement('div');
        metricsDiv.className = 'ng-narrative-metrics';

        if (ch.metrics.started > 0) {
          metricsDiv.appendChild(createBadge('started', `${ch.metrics.started} started`));
        }
        if (ch.metrics.completed > 0) {
          metricsDiv.appendChild(createBadge('completed', `${ch.metrics.completed} done`));
        }
        if (ch.metrics.delayed > 0) {
          metricsDiv.appendChild(createBadge('delayed', `${ch.metrics.delayed} delayed`));
        }
        if (ch.metrics.onTrack > 0) {
          metricsDiv.appendChild(createBadge('ontrack', `${ch.metrics.onTrack} on track`));
        }

        if (metricsDiv.children.length > 0) {
          chapterDiv.appendChild(metricsDiv);
        }

        // Body
        if (ch.body) {
          const bodyDiv = document.createElement('div');
          bodyDiv.className = 'ng-narrative-body';
          bodyDiv.textContent = ch.body;
          chapterDiv.appendChild(bodyDiv);
        }

        panel.appendChild(chapterDiv);
      }
    }

    // Insights
    if (narrative.insights.length > 0) {
      const insightsDiv = document.createElement('div');
      insightsDiv.className = 'ng-narrative-insights';

      const insightsTitle = document.createElement('div');
      insightsTitle.className = 'ng-narrative-insights-title';
      insightsTitle.innerHTML = '<span>\uD83D\uDCA1</span> Key Insights';
      insightsDiv.appendChild(insightsTitle);

      for (const insight of narrative.insights) {
        const row = document.createElement('div');
        row.className = 'ng-narrative-insight';

        const icon = document.createElement('span');
        icon.className = 'ng-narrative-insight-icon';
        icon.textContent = '\u2022'; // bullet
        row.appendChild(icon);

        const text = document.createElement('span');
        text.textContent = insight;
        row.appendChild(text);

        insightsDiv.appendChild(row);
      }

      panel.appendChild(insightsDiv);
    }

    // Timestamp
    const timestamp = document.createElement('div');
    timestamp.className = 'ng-narrative-timestamp';
    const genDate = new Date(narrative.generatedAt);
    timestamp.textContent = `Generated ${genDate.toLocaleString()}`;
    panel.appendChild(timestamp);
  }

  function createBadge(type: string, label: string): HTMLSpanElement {
    const badge = document.createElement('span');
    badge.className = `ng-narrative-badge ng-${type}`;
    badge.textContent = label;
    return badge;
  }

  return {
    name: 'NarrativePlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      injectStyles();

      // Generate initial narrative
      regenerate();

      // Listen for events
      unsubs.push(
        gantt.on('narrative:generate', () => {
          regenerate();
          if (isOpen) renderContent();
        }),
        gantt.on('narrative:show', () => openPanel()),
        gantt.on('narrative:hide', () => closePanel()),
        gantt.on('narrative:get', () => {
          // Return current narrative via the event system — callers
          // can access it through the last generated value.
          if (!narrative) regenerate();
        }),
      );
    },

    renderDOM(container: HTMLElement, _state: GanttState): void {
      // ── Story button ──────────────────────────────────────────────
      if (!storyBtn) {
        storyBtn = document.createElement('button');
        storyBtn.className = 'ng-narrative-btn';
        storyBtn.innerHTML = '<span class="ng-narrative-btn-icon">\uD83D\uDCD6</span> Story';
        storyBtn.title = 'View project narrative';
        storyBtn.addEventListener('click', () => {
          if (isOpen) closePanel();
          else openPanel();
        });
        container.appendChild(storyBtn);
      }

      // ── Overlay ───────────────────────────────────────────────────
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'ng-narrative-overlay';
        overlay.addEventListener('click', closePanel);
        container.appendChild(overlay);
      }

      // ── Panel ─────────────────────────────────────────────────────
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'ng-narrative-panel';
        container.appendChild(panel);
      }

      // If open, re-render content with latest state
      if (isOpen) {
        regenerate();
        renderContent();
      }
    },

    destroy(): void {
      for (const fn of unsubs) fn();
      unsubs = [];
      if (storyBtn) { storyBtn.remove(); storyBtn = null; }
      if (overlay) { overlay.remove(); overlay = null; }
      if (panel) { panel.remove(); panel = null; }
      removeStyles();
      host = null;
      narrative = null;
      isOpen = false;
    },
  };
}
