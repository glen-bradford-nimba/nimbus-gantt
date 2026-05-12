import { describe, it, expect, vi } from 'vitest';
import {
  AutoSchedulePlugin,
  computeSchedule,
  buildDependencyGraph,
} from './AutoSchedulePlugin';
import type {
  AutoScheduleOptions,
  ScheduleConstraint,
  CalendarBridge,
} from './AutoSchedulePlugin';
import type { GanttTask, GanttDependency, PluginHost, Action } from '../model/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTask(id: string, startDate: string, endDate: string): GanttTask {
  return { id, name: `Task ${id}`, startDate, endDate };
}

function makeDep(
  id: string,
  source: string,
  target: string,
  type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS',
  lag = 0,
): GanttDependency {
  return { id, source, target, type, lag };
}

function taskMap(tasks: GanttTask[]): Map<string, GanttTask> {
  const m = new Map<string, GanttTask>();
  for (const t of tasks) m.set(t.id, t);
  return m;
}

function depMap(deps: GanttDependency[]): Map<string, GanttDependency> {
  const m = new Map<string, GanttDependency>();
  for (const d of deps) m.set(d.id, d);
  return m;
}

const MS_PER_DAY = 86_400_000;

function calendarDayBridge(): CalendarBridge {
  return {
    addDays(start, days) {
      const [y, mo, d] = start.split('-').map(Number);
      const date = new Date(Date.UTC(y, mo - 1, d) + days * MS_PER_DAY);
      const yy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    },
    daysBetween(start, end) {
      const [sy, sm, sd] = start.split('-').map(Number);
      const [ey, em, ed] = end.split('-').map(Number);
      return Math.round(
        (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / MS_PER_DAY,
      );
    },
  };
}

const DEFAULT_OPTS: AutoScheduleOptions = { direction: 'forward' };

// ─── Plugin factory smoke tests ──────────────────────────────────────────

describe('AutoSchedulePlugin — factory', () => {
  it('exports a plugin with name + install + destroy + middleware', () => {
    const plugin = AutoSchedulePlugin();
    expect(plugin.name).toBe('AutoSchedulePlugin');
    expect(typeof plugin.install).toBe('function');
    expect(typeof plugin.destroy).toBe('function');
    expect(typeof plugin.middleware).toBe('function');
  });

  it('accepts AutoScheduleOptions without throwing', () => {
    expect(() =>
      AutoSchedulePlugin({
        projectStart: '2026-05-01',
        direction: 'forward',
        respectWorkCalendar: false,
      }),
    ).not.toThrow();
  });
});

// ─── buildDependencyGraph ─────────────────────────────────────────────────

describe('buildDependencyGraph', () => {
  it('returns empty graph for empty task set', () => {
    const g = buildDependencyGraph(new Set(), new Map());
    expect(g.circularTaskIds.size).toBe(0);
    expect(g.topoOrder.length).toBe(0);
  });

  it('produces a topological order for a linear chain', () => {
    const ids = new Set(['A', 'B', 'C']);
    const deps = depMap([makeDep('d1', 'A', 'B'), makeDep('d2', 'B', 'C')]);
    const g = buildDependencyGraph(ids, deps);
    expect(g.circularTaskIds.size).toBe(0);
    expect(g.topoOrder.indexOf('A')).toBeLessThan(
      g.topoOrder.indexOf('B'),
    );
    expect(g.topoOrder.indexOf('B')).toBeLessThan(
      g.topoOrder.indexOf('C'),
    );
  });

  it('flags circular dependencies', () => {
    const ids = new Set(['A', 'B']);
    const deps = depMap([makeDep('d1', 'A', 'B'), makeDep('d2', 'B', 'A')]);
    const g = buildDependencyGraph(ids, deps);
    expect(g.circularTaskIds.size).toBeGreaterThan(0);
  });
});

// ─── computeSchedule ──────────────────────────────────────────────────────

describe('computeSchedule', () => {
  const cal = calendarDayBridge();

  it('returns an empty result for an empty task set', () => {
    const result = computeSchedule(new Map(), new Map(), DEFAULT_OPTS, cal);
    expect(result.scheduledTasks.size).toBe(0);
    expect(result.violations.length).toBe(0);
    expect(result.totalDuration).toBe(0);
  });

  it('preserves the dates of an independent single task', () => {
    const tasks = taskMap([makeTask('A', '2026-05-01', '2026-05-06')]);
    const result = computeSchedule(tasks, new Map(), DEFAULT_OPTS, cal);
    const a = result.scheduledTasks.get('A');
    expect(a).toBeDefined();
    expect(a!.startDate).toBe('2026-05-01');
    expect(a!.endDate).toBe('2026-05-06');
  });

  it('reports a violation for a circular FS chain', () => {
    const tasks = taskMap([
      makeTask('A', '2026-05-01', '2026-05-03'),
      makeTask('B', '2026-05-03', '2026-05-05'),
    ]);
    const deps = depMap([
      makeDep('d1', 'A', 'B'),
      makeDep('d2', 'B', 'A'),
    ]);
    const result = computeSchedule(tasks, deps, DEFAULT_OPTS, cal);
    expect(result.violations.some((v) => v.type === 'circular')).toBe(true);
  });

  it('cascades dates forward on FS chains with lag', () => {
    // A (5d) FS+3 → B (4d)  ⇒  B starts on A.end + 3 days
    const tasks = taskMap([
      makeTask('A', '2026-05-01', '2026-05-06'),
      makeTask('B', '2026-06-01', '2026-06-05'), // intentionally stale
    ]);
    const deps = depMap([makeDep('d1', 'A', 'B', 'FS', 3)]);
    const result = computeSchedule(tasks, deps, DEFAULT_OPTS, cal);
    const b = result.scheduledTasks.get('B');
    expect(b).toBeDefined();
    // A.endDate = 2026-05-06; B.start should be 2026-05-09
    expect(b!.startDate).toBe('2026-05-09');
    // Duration preserved (4 days)
    expect(b!.endDate).toBe('2026-05-13');
  });

  it('honors MSO (Must Start On) constraint by overriding dependency cascade', () => {
    const tasks = taskMap([
      makeTask('A', '2026-05-01', '2026-05-03'),
      makeTask('B', '2026-05-03', '2026-05-05'),
    ]);
    const deps = depMap([makeDep('d1', 'A', 'B')]);
    const constraints = new Map<string, ScheduleConstraint>([
      ['B', { type: 'MSO', date: '2026-06-10' }],
    ]);
    const result = computeSchedule(
      tasks,
      deps,
      { ...DEFAULT_OPTS, constraints },
      cal,
    );
    const b = result.scheduledTasks.get('B');
    expect(b).toBeDefined();
    expect(b!.startDate).toBe('2026-06-10');
  });
});

// ─── autoRun gate (0.192.0) ───────────────────────────────────────────────
// When `autoRun: false`, the middleware should pass actions through but NOT
// trigger an automatic scheduleAll() on dependency changes. Explicit
// `autoSchedule:run` event handling stays available so hosts that auto-install
// the plugin dormantly (e.g. the IIFE app shell) don't get silent date
// mutation on every ADD_DEPENDENCY / REMOVE_DEPENDENCY.

describe('AutoSchedulePlugin — autoRun gate', () => {
  function makeFakeHost(
    tasks: GanttTask[],
    deps: GanttDependency[],
  ): { host: PluginHost; dispatched: Action[] } {
    const dispatched: Action[] = [];
    const host = {
      getState: () => ({
        tasks: taskMap(tasks),
        dependencies: depMap(deps),
      }),
      dispatch: (action: Action) => { dispatched.push(action); },
      on: () => () => { /* no-op unsub */ },
      getLayouts: () => [],
      getTimeScale: () => ({} as never),
      rebuildTree: () => { /* no-op */ },
    } as unknown as PluginHost;
    return { host, dispatched };
  }

  it('skips auto-reschedule on ADD_DEPENDENCY when autoRun is false', () => {
    const tasks: GanttTask[] = [
      makeTask('A', '2026-05-01', '2026-05-05'),
      makeTask('B', '2026-06-01', '2026-06-05'), // intentionally late
    ];
    const plugin = AutoSchedulePlugin({ autoRun: false });
    const { host, dispatched } = makeFakeHost(tasks, []);
    plugin.install!(host);
    const addDep: Action = {
      type: 'ADD_DEPENDENCY',
      dependency: { id: 'd1', source: 'A', target: 'B', type: 'FS', lag: 0 },
    } as Action;
    const next = vi.fn();
    plugin.middleware!(addDep, next);
    expect(next).toHaveBeenCalledOnce();
    // No TASK_MOVE dispatched — B's date stays as the host had it
    expect(dispatched.find(a => a.type === 'TASK_MOVE')).toBeUndefined();
  });

  it('does auto-reschedule on ADD_DEPENDENCY when autoRun defaults to true', () => {
    const tasks: GanttTask[] = [
      makeTask('A', '2026-05-01', '2026-05-05'),
      makeTask('B', '2026-06-01', '2026-06-05'),
    ];
    const plugin = AutoSchedulePlugin(); // default autoRun: true
    // Pre-populate dependencies so the cascade has somewhere to land.
    const { host, dispatched } = makeFakeHost(tasks, [
      { id: 'd1', source: 'A', target: 'B', type: 'FS', lag: 0 },
    ]);
    plugin.install!(host);
    const addDep: Action = {
      type: 'ADD_DEPENDENCY',
      dependency: { id: 'd1', source: 'A', target: 'B', type: 'FS', lag: 0 },
    } as Action;
    const next = vi.fn();
    plugin.middleware!(addDep, next);
    expect(next).toHaveBeenCalledOnce();
    // A move was dispatched for B (cascaded forward to start after A.end)
    const move = dispatched.find(a => a.type === 'TASK_MOVE');
    expect(move).toBeDefined();
  });
});
