import { describe, it, expect } from 'vitest';
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
import type { GanttTask, GanttDependency } from '../model/types';

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
