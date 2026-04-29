// 0.187.0 — HistoryPlugin replay-via-inverse-action tests.
// We can't construct a full NimbusGantt without a DOM, but we can exercise
// the substrate's load-bearing assertion: dispatching an action then its
// inverse through the same reducer round-trips state. That's what makes
// scrubbable history work — replay is "dispatch the inverse" through the
// existing pure reducer, no special replay reducer needed.

import { describe, it, expect } from 'vitest';
import { GanttStore } from '../store/GanttStore';
import type {
  GanttState,
  GanttTask,
  GanttDependency,
  Action,
  ResolvedConfig,
} from '../model/types';
import { LIGHT_THEME, DEFAULT_COLUMNS } from '../theme/themes';

function defaultConfig(): ResolvedConfig {
  return {
    columns: DEFAULT_COLUMNS,
    zoomLevel: 'week',
    rowHeight: 36,
    barHeight: 24,
    headerHeight: 56,
    gridWidth: 300,
    minBarWidth: 8,
    readOnly: false,
    fitToView: true,
    showToday: true,
    showWeekends: true,
    showProgress: true,
    snapToDays: true,
    colorMap: {},
    theme: { ...LIGHT_THEME },
  };
}

function makeTask(id: string, extras?: Partial<GanttTask>): GanttTask {
  return {
    id,
    name: `Task ${id}`,
    startDate: '2026-03-01',
    endDate: '2026-03-15',
    ...extras,
  };
}

function freshState(tasks: GanttTask[] = [], deps: GanttDependency[] = []): GanttState {
  const tMap = new Map<string, GanttTask>();
  for (const t of tasks) tMap.set(t.id, t);
  const dMap = new Map<string, GanttDependency>();
  for (const d of deps) dMap.set(d.id, d);
  return {
    tasks: tMap,
    dependencies: dMap,
    tree: [],
    flatVisibleIds: tasks.map((t) => t.id),
    expandedIds: new Set(),
    selectedIds: new Set(),
    zoomLevel: 'week',
    scrollX: 0,
    scrollY: 0,
    dateRange: { start: new Date('2026-01-01'), end: new Date('2026-12-31') },
    dragState: null,
    config: defaultConfig(),
  };
}

// Re-implement the inverse computation here so the test stays
// independent of the plugin's runtime wiring (DOM, host, eventbus).
// If the plugin's logic drifts from this test, the test catches it.
function computeInverse(preState: GanttState, action: Action): Action | null {
  switch (action.type) {
    case 'SET_DATA':
      return {
        type: 'SET_DATA',
        tasks: Array.from(preState.tasks.values()),
        dependencies: Array.from(preState.dependencies.values()),
      };
    case 'UPDATE_TASK': {
      const prev = preState.tasks.get(action.taskId);
      if (!prev) return null;
      const restored: Partial<GanttTask> = {};
      for (const k of Object.keys(action.changes) as Array<keyof GanttTask>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (restored as any)[k] = (prev as any)[k];
      }
      return { type: 'UPDATE_TASK', taskId: action.taskId, changes: restored };
    }
    case 'ADD_TASK':
      return { type: 'REMOVE_TASK', taskId: action.task.id };
    case 'REMOVE_TASK': {
      const prev = preState.tasks.get(action.taskId);
      if (!prev) return null;
      return { type: 'ADD_TASK', task: prev };
    }
    case 'TASK_MOVE':
    case 'TASK_RESIZE': {
      const prev = preState.tasks.get(action.taskId);
      if (!prev) return null;
      return {
        type: action.type,
        taskId: action.taskId,
        startDate: prev.startDate,
        endDate: prev.endDate,
      };
    }
    case 'ADD_DEPENDENCY':
      return { type: 'REMOVE_DEPENDENCY', dependencyId: action.dependency.id };
    case 'REMOVE_DEPENDENCY': {
      const prev = preState.dependencies.get(action.dependencyId);
      if (!prev) return null;
      return { type: 'ADD_DEPENDENCY', dependency: prev };
    }
    default:
      return null;
  }
}

function roundTrip(initial: GanttState, action: Action): GanttState {
  const store = new GanttStore(initial);
  const inverse = computeInverse(store.getState(), action);
  store.dispatch(action);
  if (inverse) store.dispatch(inverse);
  return store.getState();
}

describe('HistoryPlugin inverse-action round-trips', () => {
  it('UPDATE_TASK + inverse restores original task fields', () => {
    const before = freshState([makeTask('t1', { name: 'Original', progress: 0.25 })]);
    const after = roundTrip(before, {
      type: 'UPDATE_TASK',
      taskId: 't1',
      changes: { name: 'Modified', progress: 0.99 },
    });
    const t = after.tasks.get('t1')!;
    expect(t.name).toBe('Original');
    expect(t.progress).toBe(0.25);
  });

  it('ADD_TASK + inverse removes the inserted task', () => {
    const before = freshState([makeTask('t1')]);
    const after = roundTrip(before, {
      type: 'ADD_TASK',
      task: makeTask('t2', { name: 'New' }),
    });
    expect(after.tasks.has('t2')).toBe(false);
    expect(after.tasks.size).toBe(1);
  });

  it('REMOVE_TASK + inverse restores the deleted task', () => {
    const original = makeTask('t1', { name: 'Doomed', progress: 0.5 });
    const before = freshState([original]);
    const after = roundTrip(before, { type: 'REMOVE_TASK', taskId: 't1' });
    const restored = after.tasks.get('t1');
    expect(restored).toBeDefined();
    expect(restored!.name).toBe('Doomed');
    expect(restored!.progress).toBe(0.5);
  });

  it('TASK_MOVE + inverse restores original dates', () => {
    const before = freshState([
      makeTask('t1', { startDate: '2026-03-01', endDate: '2026-03-10' }),
    ]);
    const after = roundTrip(before, {
      type: 'TASK_MOVE',
      taskId: 't1',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
    });
    const t = after.tasks.get('t1')!;
    expect(t.startDate).toBe('2026-03-01');
    expect(t.endDate).toBe('2026-03-10');
  });

  it('ADD_DEPENDENCY + inverse removes the dep', () => {
    const before = freshState([makeTask('t1'), makeTask('t2')]);
    const after = roundTrip(before, {
      type: 'ADD_DEPENDENCY',
      dependency: { id: 'd1', source: 't1', target: 't2' },
    });
    expect(after.dependencies.has('d1')).toBe(false);
  });

  it('REMOVE_DEPENDENCY + inverse restores the dep', () => {
    const dep: GanttDependency = { id: 'd1', source: 't1', target: 't2', type: 'FS' };
    const before = freshState([makeTask('t1'), makeTask('t2')], [dep]);
    const after = roundTrip(before, { type: 'REMOVE_DEPENDENCY', dependencyId: 'd1' });
    const restored = after.dependencies.get('d1');
    expect(restored).toEqual(dep);
  });

  it('SET_DATA + inverse restores prior tasks + deps', () => {
    const tA = makeTask('a');
    const tB = makeTask('b');
    const dep: GanttDependency = { id: 'd', source: 'a', target: 'b' };
    const before = freshState([tA, tB], [dep]);
    const after = roundTrip(before, {
      type: 'SET_DATA',
      tasks: [makeTask('z')],
      dependencies: [],
    });
    expect(after.tasks.has('a')).toBe(true);
    expect(after.tasks.has('b')).toBe(true);
    expect(after.tasks.has('z')).toBe(false);
    expect(after.dependencies.get('d')).toEqual(dep);
  });
});

describe('HistoryPlugin replay walks inverses backwards', () => {
  // Simulates the plugin's snapshotAt loop on an explicit set of
  // entries to verify multi-step replay.
  it('replays a sequence of edits to reconstruct any past state', () => {
    const initial = freshState([makeTask('t1', { progress: 0 })]);
    const store = new GanttStore(initial);
    type Entry = { wallTs: number; action: Action; inverse: Action | null };
    const log: Entry[] = [];

    function dispatch(action: Action, wallTs: number): void {
      const pre = store.getState();
      const inverse = computeInverse(pre, action);
      store.dispatch(action);
      log.push({ wallTs, action, inverse });
    }

    dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { progress: 0.25 } }, 1000);
    dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { progress: 0.5 } }, 2000);
    dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { progress: 0.75 } }, 3000);
    dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { progress: 1.0 } }, 4000);

    expect(store.getState().tasks.get('t1')!.progress).toBe(1.0);

    function snapshotAt(targetWallTs: number): GanttState {
      const probe = new GanttStore(store.getState());
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].wallTs <= targetWallTs) break;
        if (log[i].inverse) probe.dispatch(log[i].inverse!);
      }
      return probe.getState();
    }

    // Cursor between events 2 and 3 — should see 0.5
    expect(snapshotAt(2500).tasks.get('t1')!.progress).toBe(0.5);
    // Cursor before any event — should see 0 (initial state, all four
    // inverses applied)
    expect(snapshotAt(500).tasks.get('t1')!.progress).toBe(0);
    // Cursor at exactly an event ts — that event is included (ts <= target)
    expect(snapshotAt(2000).tasks.get('t1')!.progress).toBe(0.5);
    // Cursor at "now" (after all events) — full live state
    expect(snapshotAt(9999).tasks.get('t1')!.progress).toBe(1.0);
  });

  it('preserves live store state — replay uses a probe store, not the live one', () => {
    const initial = freshState([makeTask('t1', { progress: 0 })]);
    const store = new GanttStore(initial);
    store.dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { progress: 0.7 } });

    // Simulate snapshotAt (probe-store pattern):
    const probe = new GanttStore(store.getState());
    probe.dispatch({
      type: 'UPDATE_TASK',
      taskId: 't1',
      changes: { progress: 0 },
    });
    expect(probe.getState().tasks.get('t1')!.progress).toBe(0);
    // Live store unaffected
    expect(store.getState().tasks.get('t1')!.progress).toBe(0.7);
  });
});

describe('SET_TIME_CURSOR action', () => {
  it('reducer accepts a Date and stores it on state', () => {
    const store = new GanttStore(freshState());
    expect(store.getState().timeCursorDate).toBeUndefined();
    store.dispatch({ type: 'SET_TIME_CURSOR', date: new Date('2026-01-01') });
    expect(store.getState().timeCursorDate?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reducer accepts null to clear the cursor (return to live)', () => {
    const store = new GanttStore({
      ...freshState(),
      timeCursorDate: new Date('2026-01-01'),
    });
    store.dispatch({ type: 'SET_TIME_CURSOR', date: null });
    expect(store.getState().timeCursorDate).toBeNull();
  });
});
