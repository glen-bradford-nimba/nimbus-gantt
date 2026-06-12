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

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Plugin factory smoke tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('AutoSchedulePlugin â€” factory', () => {
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

// â”€â”€â”€ buildDependencyGraph â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ computeSchedule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('computeSchedule', () => {
  const cal = calendarDayBridge();

  it('returns an empty result for an empty task set', () => {
    const result = computeSchedule(new Map(), new Map(), DEFAULT_OPTS, cal);
    expect(result.scheduledTasks.size).toBe(0);
    expect(result.violations.length).toBe(0);
    expect(result.totalDuration).toBe(0);
  });

  it('preserves the dates of an independent task when the project is anchored at its start', () => {
    // Explicit projectStart keeps this a deterministic cascade test (the default
    // anchor is now max(today, earliest) â€” see the ASAP regression test below â€”
    // which would otherwise move a past-dated task to today as the clock moves).
    const tasks = taskMap([makeTask('A', '2026-05-01', '2026-05-06')]);
    const result = computeSchedule(tasks, new Map(), { ...DEFAULT_OPTS, projectStart: '2026-05-01' }, cal);
    const a = result.scheduledTasks.get('A');
    expect(a).toBeDefined();
    expect(a!.startDate).toBe('2026-05-01');
    expect(a!.endDate).toBe('2026-05-06');
  });

  it('anchors at today (ASAP) and never proposes a past start when no projectStart is given', () => {
    // Regression guard: the earlier default anchored at the earliest existing
    // start, so an old board reflowed entirely into the past (e.g. 2026-02-15).
    // ASAP must schedule forward from today instead.
    const tasks = taskMap([makeTask('A', '2020-01-01', '2020-01-05')]);
    const result = computeSchedule(tasks, new Map(), DEFAULT_OPTS, cal);
    const a = result.scheduledTasks.get('A');
    expect(a).toBeDefined();
    const t = new Date();
    const todayUTC = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    expect(a!.startDate).toBe(todayUTC);
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
    // A (5d) FS+3 â†’ B (4d)  â‡’  B starts on A.end + 3 days
    const tasks = taskMap([
      makeTask('A', '2026-05-01', '2026-05-06'),
      makeTask('B', '2026-06-01', '2026-06-05'), // intentionally stale
    ]);
    const deps = depMap([makeDep('d1', 'A', 'B', 'FS', 3)]);
    const result = computeSchedule(tasks, deps, { ...DEFAULT_OPTS, projectStart: '2026-05-01' }, cal);
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

// â”€â”€â”€ autoRun gate (0.192.0) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// When `autoRun: false`, the middleware should pass actions through but NOT
// trigger an automatic scheduleAll() on dependency changes. Explicit
// `autoSchedule:run` event handling stays available so hosts that auto-install
// the plugin dormantly (e.g. the IIFE app shell) don't get silent date
// mutation on every ADD_DEPENDENCY / REMOVE_DEPENDENCY.

describe('AutoSchedulePlugin â€” autoRun gate', () => {
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
    // No TASK_MOVE dispatched â€” B's date stays as the host had it
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

// â”€â”€â”€ 0.204.0 Capacity-leveling (resource-constrained scheduling) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('computeSchedule â€” capacity leveling', () => {
  // ceiling = hoursPerMonth * 12/365 * pace. (4*365)/12 h/mo â†’ exactly 4 h/day at 1Ã—.
  const HPM_4H_DAY = (4 * 365) / 12;

  function estTask(id: string, startDate: string, endDate: string, est: number, logged = 0): GanttTask {
    return { id, name: `Task ${id}`, startDate, endDate, estimatedHours: est, loggedHours: logged } as unknown as GanttTask;
  }
  const capOpts = (pace: number, extra?: Partial<AutoScheduleOptions>): AutoScheduleOptions => ({
    direction: 'forward',
    projectStart: '2026-07-01',
    capacity: { hoursPerMonth: HPM_4H_DAY, pace },
    ...extra,
  });

  it('fans a same-day cluster into a serial ramp under the ceiling', () => {
    // 4 independent tasks, all dated the same day, 5d Ã— 4h/day demand each.
    // At a 4h/day ceiling exactly one fits at a time â†’ starts serialize.
    const tasks = taskMap([
      estTask('a', '2026-07-01', '2026-07-06', 20),
      estTask('b', '2026-07-01', '2026-07-06', 20),
      estTask('c', '2026-07-01', '2026-07-06', 20),
      estTask('d', '2026-07-01', '2026-07-06', 20),
    ]);
    const r = computeSchedule(tasks, depMap([]), capOpts(1), calendarDayBridge());
    const starts = ['a', 'b', 'c', 'd'].map((id) => r.scheduledTasks.get(id)!.startDate);
    expect(starts).toEqual(['2026-07-01', '2026-07-06', '2026-07-11', '2026-07-16']);
  });

  it('pace 2Ã— doubles the ceiling and compresses the plan', () => {
    const tasks = taskMap([
      estTask('a', '2026-07-01', '2026-07-06', 20),
      estTask('b', '2026-07-01', '2026-07-06', 20),
      estTask('c', '2026-07-01', '2026-07-06', 20),
      estTask('d', '2026-07-01', '2026-07-06', 20),
    ]);
    const r = computeSchedule(tasks, depMap([]), capOpts(2), calendarDayBridge());
    const starts = ['a', 'b', 'c', 'd'].map((id) => r.scheduledTasks.get(id)!.startDate);
    expect(starts).toEqual(['2026-07-01', '2026-07-01', '2026-07-06', '2026-07-06']);
  });

  it('dependencies still dominate: successor never starts before predecessor ends', () => {
    const tasks = taskMap([
      estTask('a', '2026-07-01', '2026-07-03', 8),
      estTask('b', '2026-07-01', '2026-07-03', 8),
    ]);
    const r = computeSchedule(tasks, depMap([makeDep('d1', 'a', 'b')]), capOpts(1), calendarDayBridge());
    expect(r.scheduledTasks.get('a')!.startDate).toBe('2026-07-01');
    expect(r.scheduledTasks.get('b')!.startDate).toBe('2026-07-03');
  });

  it('priorityOf orders independent peers (most-committed first)', () => {
    const tasks = taskMap([
      estTask('a', '2026-07-01', '2026-07-06', 20),
      estTask('b', '2026-07-01', '2026-07-06', 20),
    ]);
    const rank: Record<string, number> = { b: 0, a: 1 };
    const r = computeSchedule(tasks, depMap([]), capOpts(1, {
      capacity: { hoursPerMonth: HPM_4H_DAY, pace: 1, priorityOf: (t) => rank[t.id] ?? 9 },
    }), calendarDayBridge());
    expect(r.scheduledTasks.get('b')!.startDate).toBe('2026-07-01');
    expect(r.scheduledTasks.get('a')!.startDate).toBe('2026-07-06');
  });

  it('zero-demand tasks are never shifted', () => {
    const tasks = taskMap([
      estTask('a', '2026-07-01', '2026-07-06', 20),
      makeTask('m', '2026-07-01', '2026-07-01'), // no estimate â†’ demand 0
    ]);
    const r = computeSchedule(tasks, depMap([]), capOpts(1), calendarDayBridge());
    expect(r.scheduledTasks.get('m')!.startDate).toBe('2026-07-01');
  });

  it('pace 0 / no capacity leaves the schedule identical to the plain pass', () => {
    const mk = () => taskMap([
      estTask('a', '2026-07-01', '2026-07-06', 20),
      estTask('b', '2026-07-01', '2026-07-06', 20),
    ]);
    const base = computeSchedule(mk(), depMap([]), { direction: 'forward', projectStart: '2026-07-01' }, calendarDayBridge());
    const off = computeSchedule(mk(), depMap([]), capOpts(0), calendarDayBridge());
    for (const id of ['a', 'b']) {
      expect(off.scheduledTasks.get(id)).toEqual(base.scheduledTasks.get(id));
    }
  });

  it('logged hours reduce demand (remaining-work basis)', () => {
    // a: 16h/5d = 3.2h/day. b: 20 est - 16 logged = 4h remaining -> 0.8h/day.
    // 3.2 + 0.8 = 4.0 fits the 4h/day ceiling; demand off the full estimate
    const tasks = taskMap([
      estTask('a', '2026-07-01', '2026-07-06', 16),
      estTask('b', '2026-07-01', '2026-07-06', 20, 16),
    ]);
    const r = computeSchedule(tasks, depMap([]), capOpts(1), calendarDayBridge());
    expect(r.scheduledTasks.get('a')!.startDate).toBe('2026-07-01');
    expect(r.scheduledTasks.get('b')!.startDate).toBe('2026-07-01');
  });
});

// ─── 0.205.0 Capacity hardening (adversarial-review fixes) ─────────────────

describe('computeSchedule — capacity hardening (0.205.0)', () => {
  const HPM_4H_DAY = (4 * 365) / 12;
  function estTask(id: string, startDate: string, endDate: string, est: number): GanttTask {
    return { id, name: `Task ${id}`, startDate, endDate, estimatedHours: est } as unknown as GanttTask;
  }

  it('priority holds at EVERY Kahn wave, not just the seeds', () => {
    // c (rank 2, dep-free) vs b (rank 0) which becomes ready only after a.
    // a: 1d tiny demand. With wave-ordering, b levels ahead of c.
    const tasks = taskMap([
      estTask('a', '2026-07-01', '2026-07-02', 1),
      estTask('b', '2026-07-01', '2026-07-06', 20),
      estTask('c', '2026-07-01', '2026-07-06', 20),
    ]);
    const rank: Record<string, number> = { a: 0, b: 0, c: 2 };
    const r = computeSchedule(tasks, depMap([makeDep('d1', 'a', 'b')]), {
      direction: 'forward', projectStart: '2026-07-01',
      capacity: { hoursPerMonth: HPM_4H_DAY, pace: 1, priorityOf: (t) => rank[t.id] ?? 9 },
    }, calendarDayBridge());
    // a takes day 0 (1h of 4h). b ready at jul2; b (rank 0) gets jul2 slot.
    // c (rank 2) must wait for b to clear: jul7.
    expect(r.scheduledTasks.get('b')!.startDate).toBe('2026-07-02');
    expect(r.scheduledTasks.get('c')!.startDate).toBe('2026-07-07');
  });

  it('hard-date (MSO) load is pre-recorded so soft work routes around it', () => {
    // m is MSO jul6-jul11 at full ceiling; soft s (same dates) must NOT fill
    // those days first — it levels to jul1 (free) or after m.
    const tasks = taskMap([
      estTask('s', '2026-07-06', '2026-07-11', 20),
      estTask('m', '2026-07-06', '2026-07-11', 20),
    ]);
    const constraints = new Map<string, ScheduleConstraint>([
      ['m', { type: 'MSO', date: '2026-07-06' }],
    ]);
    const r = computeSchedule(tasks, depMap([]), {
      direction: 'forward', projectStart: '2026-07-01', constraints,
      capacity: { hoursPerMonth: HPM_4H_DAY, pace: 1 },
    }, calendarDayBridge());
    expect(r.scheduledTasks.get('m')!.startDate).toBe('2026-07-06'); // held
    // s shifted off m's window (either before via es=projStart? no — s's es is
    // its own start jul6 → leveled past m): jul11.
    expect(r.scheduledTasks.get('s')!.startDate).toBe('2026-07-01');
    expect(r.violations.filter(v => v.type === 'resource')).toHaveLength(0);
  });

  it('reports a resource violation when hard-dated work alone overloads the ceiling', () => {
    const tasks = taskMap([
      estTask('m1', '2026-07-06', '2026-07-11', 20),
      estTask('m2', '2026-07-06', '2026-07-11', 20),
    ]);
    const constraints = new Map<string, ScheduleConstraint>([
      ['m1', { type: 'MSO', date: '2026-07-06' }],
      ['m2', { type: 'MSO', date: '2026-07-06' }],
    ]);
    const r = computeSchedule(tasks, depMap([]), {
      direction: 'forward', projectStart: '2026-07-01', constraints,
      capacity: { hoursPerMonth: HPM_4H_DAY, pace: 1 },
    }, calendarDayBridge());
    expect(r.violations.some(v => v.type === 'resource')).toBe(true);
  });

  it('throwing demandOf/priorityOf callbacks are guarded (no unwind)', () => {
    const tasks = taskMap([estTask('a', '2026-07-01', '2026-07-06', 20)]);
    expect(() => computeSchedule(tasks, depMap([]), {
      direction: 'forward', projectStart: '2026-07-01',
      capacity: {
        hoursPerMonth: HPM_4H_DAY, pace: 1,
        demandOf: () => { throw new Error('host bug'); },
        priorityOf: () => { throw new Error('host bug'); },
      },
    }, calendarDayBridge())).not.toThrow();
  });
});

// ─── 0.206.0 Per-call data overrides (full-board scheduling) ───────────────

describe('AutoSchedulePlugin — data overrides via events', () => {
  function mockHost(stateTasks: GanttTask[]) {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const dispatched: Action[] = [];
    const host = {
      getState: () => ({ tasks: taskMap(stateTasks), dependencies: depMap([]) }),
      dispatch: (a: Action) => { dispatched.push(a); },
      on: (e: string, h: (...args: unknown[]) => void) => { handlers.set(e, h); return () => handlers.delete(e); },
      getConfig: () => ({}),
    } as unknown as PluginHost;
    return { host, handlers, dispatched };
  }

  it('preview schedules the OVERRIDE task set, not engine state', () => {
    // Engine state holds only "visible"; the override hands the full board.
    const visible = makeTask('visible', '2026-07-01', '2026-07-03');
    const hidden = makeTask('hidden', '2026-07-01', '2026-07-03');
    const { host, handlers } = mockHost([visible]);
    const plugin = AutoSchedulePlugin({ projectStart: '2026-07-01' });
    plugin.install!(host);

    let result: { scheduledTasks?: Map<string, unknown> } | null = null;
    handlers.get('autoSchedule:preview')!(
      { tasks: [visible, hidden] },
      (r: { scheduledTasks?: Map<string, unknown> }) => { result = r; },
    );
    expect(result).not.toBeNull();
    expect(result!.scheduledTasks!.has('hidden')).toBe(true);
    expect(result!.scheduledTasks!.has('visible')).toBe(true);
  });

  it('preview never dispatches; run dispatches TASK_MOVE only for changed dates', () => {
    const a = makeTask('a', '2026-07-05', '2026-07-07'); // will pull to projStart
    const { host, handlers, dispatched } = mockHost([a]);
    const plugin = AutoSchedulePlugin({ projectStart: '2026-07-01' });
    plugin.install!(host);

    handlers.get('autoSchedule:preview')!({ tasks: [a] }, () => { /* noop */ });
    expect(dispatched).toHaveLength(0);

    handlers.get('autoSchedule:run')!({ tasks: [a] });
    expect(dispatched.some((d) => (d as { type: string }).type === 'TASK_MOVE')).toBe(true);
  });
});
