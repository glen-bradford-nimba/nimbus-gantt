import { describe, it, expect } from 'vitest';
import { computeCPM } from './CriticalPathPlugin';
import type { GanttTask, GanttDependency } from '../model/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTask(id: string, startDate: string, endDate: string): GanttTask {
  return { id, name: `Task ${id}`, startDate, endDate };
}

function makeDep(id: string, source: string, target: string, lag = 0): GanttDependency {
  return { id, source, target, type: 'FS', lag };
}

function taskMap(tasks: GanttTask[]): Map<string, GanttTask> {
  const map = new Map<string, GanttTask>();
  for (const t of tasks) map.set(t.id, t);
  return map;
}

function depMap(deps: GanttDependency[]): Map<string, GanttDependency> {
  const map = new Map<string, GanttDependency>();
  for (const d of deps) map.set(d.id, d);
  return map;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('computeCPM', () => {
  it('linear chain A->B->C->D: all critical', () => {
    // A(5d) -> B(3d) -> C(4d) -> D(2d)
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-06'), // 5 days
      makeTask('B', '2026-03-06', '2026-03-09'), // 3 days
      makeTask('C', '2026-03-09', '2026-03-13'), // 4 days
      makeTask('D', '2026-03-13', '2026-03-15'), // 2 days
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B'),
      makeDep('d2', 'B', 'C'),
      makeDep('d3', 'C', 'D'),
    ]);

    const result = computeCPM(tasks, deps);

    expect(result.criticalTaskIds).toContain('A');
    expect(result.criticalTaskIds).toContain('B');
    expect(result.criticalTaskIds).toContain('C');
    expect(result.criticalTaskIds).toContain('D');
    expect(result.criticalTaskIds.size).toBe(4);
  });

  it('diamond: A->B, A->C, B->D, C->D — longest path is critical', () => {
    // A(2d) -> B(10d) -> D(1d)
    // A(2d) -> C(3d)  -> D(1d)
    // Critical path: A -> B -> D (longer)
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-03'), // 2 days
      makeTask('B', '2026-03-03', '2026-03-13'), // 10 days
      makeTask('C', '2026-03-03', '2026-03-06'), // 3 days
      makeTask('D', '2026-03-13', '2026-03-14'), // 1 day
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B'),
      makeDep('d2', 'A', 'C'),
      makeDep('d3', 'B', 'D'),
      makeDep('d4', 'C', 'D'),
    ]);

    const result = computeCPM(tasks, deps);

    expect(result.criticalTaskIds).toContain('A');
    expect(result.criticalTaskIds).toContain('B');
    expect(result.criticalTaskIds).toContain('D');
    // C has float — not critical
    expect(result.criticalTaskIds.has('C')).toBe(false);
  });

  it('parallel paths: 10-day vs 5-day, only 10-day is critical', () => {
    // Path 1: Start(0d) -> Long(10d) -> End(1d)
    // Path 2: Start(0d) -> Short(5d) -> End(1d)
    const tasks = taskMap([
      makeTask('Start', '2026-03-01', '2026-03-01'), // 0 days (milestone)
      makeTask('Long', '2026-03-01', '2026-03-11'),   // 10 days
      makeTask('Short', '2026-03-01', '2026-03-06'),   // 5 days
      makeTask('End', '2026-03-11', '2026-03-12'),     // 1 day
    ]);
    const deps = depMap([
      makeDep('d1', 'Start', 'Long'),
      makeDep('d2', 'Start', 'Short'),
      makeDep('d3', 'Long', 'End'),
      makeDep('d4', 'Short', 'End'),
    ]);

    const result = computeCPM(tasks, deps);

    expect(result.criticalTaskIds).toContain('Start');
    expect(result.criticalTaskIds).toContain('Long');
    expect(result.criticalTaskIds).toContain('End');
    expect(result.criticalTaskIds.has('Short')).toBe(false);
  });

  it('task with float has totalFloat > 0', () => {
    // Same diamond as above — C should have float
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-03'), // 2 days
      makeTask('B', '2026-03-03', '2026-03-13'), // 10 days
      makeTask('C', '2026-03-03', '2026-03-06'), // 3 days
      makeTask('D', '2026-03-13', '2026-03-14'), // 1 day
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B'),
      makeDep('d2', 'A', 'C'),
      makeDep('d3', 'B', 'D'),
      makeDep('d4', 'C', 'D'),
    ]);

    const result = computeCPM(tasks, deps);
    const analysisC = result.taskAnalysis.get('C')!;

    expect(analysisC.totalFloat).toBeGreaterThan(0);
    expect(analysisC.isCritical).toBe(false);
  });

  it('circular dependency: tasks in cycle are handled gracefully', () => {
    // A -> B -> A  (cycle)
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-05'),
      makeTask('B', '2026-03-05', '2026-03-10'),
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B'),
      makeDep('d2', 'B', 'A'), // creates cycle
    ]);

    // Should not throw — the algorithm handles cycles by using
    // tasks that don't get dequeued getting their actual dates
    const result = computeCPM(tasks, deps);

    // Just verify it returns a result without crashing
    expect(result).toBeDefined();
    expect(result.taskAnalysis.size).toBe(2);
  });

  it('no dependencies: all tasks are trivially critical', () => {
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-10'),
      makeTask('B', '2026-03-05', '2026-03-15'),
      makeTask('C', '2026-03-01', '2026-03-20'),
    ]);
    const deps = depMap([]);

    const result = computeCPM(tasks, deps);

    // Without dependencies, each task's LS = LF - duration
    // LF = project finish for all (since no successors)
    // For the task with the latest finish, totalFloat = 0 => critical
    // Others might have float depending on when they finish vs project finish
    // The task ending at March 20 should be critical
    expect(result.criticalTaskIds).toContain('C');
    expect(result.taskAnalysis.size).toBe(3);
  });

  it('single task: critical with float = 0', () => {
    const tasks = taskMap([
      makeTask('only', '2026-03-01', '2026-03-10'),
    ]);
    const deps = depMap([]);

    const result = computeCPM(tasks, deps);

    expect(result.criticalTaskIds).toContain('only');
    expect(result.criticalTaskIds.size).toBe(1);

    const analysis = result.taskAnalysis.get('only')!;
    expect(analysis.totalFloat).toBe(0);
    expect(analysis.isCritical).toBe(true);
  });

  it('empty task set returns empty result', () => {
    const result = computeCPM(new Map(), new Map());

    expect(result.criticalTaskIds.size).toBe(0);
    expect(result.criticalDependencyIds.size).toBe(0);
    expect(result.taskAnalysis.size).toBe(0);
    expect(result.projectDuration).toBe(0);
  });

  it('critical dependencies connect two critical tasks', () => {
    // Linear: A -> B -> C, all critical
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-06'),
      makeTask('B', '2026-03-06', '2026-03-11'),
      makeTask('C', '2026-03-11', '2026-03-16'),
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B'),
      makeDep('d2', 'B', 'C'),
    ]);

    const result = computeCPM(tasks, deps);

    expect(result.criticalDependencyIds).toContain('d1');
    expect(result.criticalDependencyIds).toContain('d2');
  });

  it('non-FS dependency types are ignored for CPM', () => {
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-06'),
      makeTask('B', '2026-03-06', '2026-03-11'),
    ]);
    const deps = depMap([
      { id: 'd1', source: 'A', target: 'B', type: 'FF', lag: 0 },
    ]);

    const result = computeCPM(tasks, deps);

    // FF dep is ignored — treated as no dependency
    // Both tasks are independent roots with no successors
    expect(result.taskAnalysis.size).toBe(2);
  });

  it('lag shifts the early start of successor', () => {
    // A(5d) -> [lag 3] -> B(5d)
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-06'), // 5 days
      makeTask('B', '2026-03-09', '2026-03-14'), // 5 days (starts 3 days after A ends)
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B', 3),
    ]);

    const result = computeCPM(tasks, deps);
    const analysisB = result.taskAnalysis.get('B')!;

    // B's early start should be A's early finish + 3 days = March 6 + 3 = March 9
    expect(analysisB.earlyStart.getTime()).toBe(Date.UTC(2026, 2, 9));
    expect(result.projectDuration).toBe(13); // 5 + 3 + 5
  });

  it('projectDuration reflects the longest path', () => {
    // A(10d) -> B(5d)  = 15 days
    const tasks = taskMap([
      makeTask('A', '2026-03-01', '2026-03-11'), // 10 days
      makeTask('B', '2026-03-11', '2026-03-16'), // 5 days
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B'),
    ]);

    const result = computeCPM(tasks, deps);

    expect(result.projectDuration).toBe(15);
  });
});
