import { describe, it, expect, vi } from 'vitest';
import { GanttStore } from './GanttStore';
import type { Middleware } from './GanttStore';
import type { GanttState, GanttTask, GanttDependency, Action, ResolvedConfig } from '../model/types';
import { LIGHT_THEME, DEFAULT_COLUMNS } from '../theme/themes';

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function emptyState(): GanttState {
  return {
    tasks: new Map(),
    dependencies: new Map(),
    tree: [],
    flatVisibleIds: [],
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

function makeTask(id: string, name: string, extras?: Partial<GanttTask>): GanttTask {
  return {
    id,
    name,
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    ...extras,
  };
}

// ─── SET_DATA ─────────────────────────────────────────────────────────────

describe('GanttStore SET_DATA', () => {
  it('populates tasks and dependencies maps', () => {
    const store = new GanttStore(emptyState());

    store.dispatch({
      type: 'SET_DATA',
      tasks: [
        makeTask('t1', 'Task 1'),
        makeTask('t2', 'Task 2'),
      ],
      dependencies: [
        { id: 'd1', source: 't1', target: 't2', type: 'FS' },
      ],
    });

    const state = store.getState();
    expect(state.tasks.size).toBe(2);
    expect(state.tasks.get('t1')!.name).toBe('Task 1');
    expect(state.dependencies.size).toBe(1);
    expect(state.dependencies.get('d1')!.source).toBe('t1');
  });

  it('rebuilds tree and flatVisibleIds', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [makeTask('a', 'Alpha'), makeTask('b', 'Bravo')],
    });

    const state = store.getState();
    expect(state.flatVisibleIds).toHaveLength(2);
    expect(state.tree).toHaveLength(2);
  });
});

// ─── UPDATE_TASK ──────────────────────────────────────────────────────────

describe('GanttStore UPDATE_TASK', () => {
  it('modifies a single task', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_DATA', tasks: [makeTask('t1', 'Original')] });

    store.dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { name: 'Updated' } });

    expect(store.getState().tasks.get('t1')!.name).toBe('Updated');
  });

  it('returns same state if taskId does not exist', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_DATA', tasks: [makeTask('t1', 'Task')] });
    const before = store.getState();

    store.dispatch({ type: 'UPDATE_TASK', taskId: 'nonexistent', changes: { name: 'X' } });

    expect(store.getState()).toBe(before);
  });
});

// ─── ADD_TASK ─────────────────────────────────────────────────────────────

describe('GanttStore ADD_TASK', () => {
  it('adds to the map', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_DATA', tasks: [makeTask('t1', 'First')] });

    store.dispatch({ type: 'ADD_TASK', task: makeTask('t2', 'Second') });

    const state = store.getState();
    expect(state.tasks.size).toBe(2);
    expect(state.tasks.has('t2')).toBe(true);
    expect(state.flatVisibleIds).toContain('t2');
  });
});

// ─── REMOVE_TASK ──────────────────────────────────────────────────────────

describe('GanttStore REMOVE_TASK', () => {
  it('removes from the map', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [makeTask('t1', 'Keep'), makeTask('t2', 'Remove')],
    });

    store.dispatch({ type: 'REMOVE_TASK', taskId: 't2' });

    const state = store.getState();
    expect(state.tasks.size).toBe(1);
    expect(state.tasks.has('t2')).toBe(false);
    expect(state.flatVisibleIds).not.toContain('t2');
  });

  it('cleans selectedIds on remove', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_DATA', tasks: [makeTask('t1', 'Task')] });
    store.dispatch({ type: 'SELECT_TASK', taskId: 't1' });
    expect(store.getState().selectedIds.has('t1')).toBe(true);

    store.dispatch({ type: 'REMOVE_TASK', taskId: 't1' });
    expect(store.getState().selectedIds.has('t1')).toBe(false);
  });

  it('returns same state if taskId does not exist', () => {
    const store = new GanttStore(emptyState());
    const before = store.getState();
    store.dispatch({ type: 'REMOVE_TASK', taskId: 'nope' });
    expect(store.getState()).toBe(before);
  });
});

// ─── TOGGLE_EXPAND ────────────────────────────────────────────────────────

describe('GanttStore TOGGLE_EXPAND', () => {
  it('toggles expandedIds and updates flatVisibleIds', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [
        makeTask('p', 'Parent'),
        makeTask('c', 'Child', { parentId: 'p' }),
      ],
    });

    // Initially not expanded
    expect(store.getState().flatVisibleIds).toEqual(['p']);

    // Expand
    store.dispatch({ type: 'TOGGLE_EXPAND', taskId: 'p' });
    expect(store.getState().expandedIds.has('p')).toBe(true);
    expect(store.getState().flatVisibleIds).toEqual(['p', 'c']);

    // Collapse
    store.dispatch({ type: 'TOGGLE_EXPAND', taskId: 'p' });
    expect(store.getState().expandedIds.has('p')).toBe(false);
    expect(store.getState().flatVisibleIds).toEqual(['p']);
  });
});

// ─── EXPAND_ALL / COLLAPSE_ALL ────────────────────────────────────────────

describe('GanttStore EXPAND_ALL / COLLAPSE_ALL', () => {
  it('EXPAND_ALL expands all parent tasks', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [
        makeTask('p', 'Parent'),
        makeTask('c', 'Child', { parentId: 'p' }),
        makeTask('gc', 'GrandChild', { parentId: 'c' }),
      ],
    });

    store.dispatch({ type: 'EXPAND_ALL' });

    const state = store.getState();
    expect(state.expandedIds.has('p')).toBe(true);
    expect(state.expandedIds.has('c')).toBe(true);
    expect(state.flatVisibleIds).toEqual(['p', 'c', 'gc']);
  });

  it('COLLAPSE_ALL collapses all tasks', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [
        makeTask('p', 'Parent'),
        makeTask('c', 'Child', { parentId: 'p' }),
      ],
    });
    store.dispatch({ type: 'EXPAND_ALL' });
    store.dispatch({ type: 'COLLAPSE_ALL' });

    const state = store.getState();
    expect(state.expandedIds.size).toBe(0);
    expect(state.flatVisibleIds).toEqual(['p']);
  });
});

// ─── SET_ZOOM ─────────────────────────────────────────────────────────────

describe('GanttStore SET_ZOOM', () => {
  it('updates zoomLevel', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_ZOOM', level: 'day' });
    expect(store.getState().zoomLevel).toBe('day');

    store.dispatch({ type: 'SET_ZOOM', level: 'quarter' });
    expect(store.getState().zoomLevel).toBe('quarter');
  });
});

// ─── SELECT_TASK ──────────────────────────────────────────────────────────

describe('GanttStore SELECT_TASK', () => {
  it('single select replaces selection', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [makeTask('t1', 'A'), makeTask('t2', 'B')],
    });

    store.dispatch({ type: 'SELECT_TASK', taskId: 't1' });
    expect(store.getState().selectedIds).toEqual(new Set(['t1']));

    store.dispatch({ type: 'SELECT_TASK', taskId: 't2' });
    expect(store.getState().selectedIds).toEqual(new Set(['t2']));
  });

  it('multi select adds to selection', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [makeTask('t1', 'A'), makeTask('t2', 'B')],
    });

    store.dispatch({ type: 'SELECT_TASK', taskId: 't1' });
    store.dispatch({ type: 'SELECT_TASK', taskId: 't2', multi: true });

    expect(store.getState().selectedIds).toEqual(new Set(['t1', 't2']));
  });

  it('multi select toggles off if already selected', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_DATA', tasks: [makeTask('t1', 'A')] });

    store.dispatch({ type: 'SELECT_TASK', taskId: 't1' });
    store.dispatch({ type: 'SELECT_TASK', taskId: 't1', multi: true });

    expect(store.getState().selectedIds.has('t1')).toBe(false);
  });
});

// ─── TASK_MOVE ────────────────────────────────────────────────────────────

describe('GanttStore TASK_MOVE', () => {
  it('updates task dates', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_DATA', tasks: [makeTask('t1', 'Task')] });

    store.dispatch({
      type: 'TASK_MOVE',
      taskId: 't1',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
    });

    const task = store.getState().tasks.get('t1')!;
    expect(task.startDate).toBe('2026-04-01');
    expect(task.endDate).toBe('2026-04-10');
  });
});

// ─── Middleware ────────────────────────────────────────────────────────────

describe('GanttStore middleware', () => {
  it('intercepts actions', () => {
    const intercepted: Action[] = [];
    const middleware: Middleware = (action, _getState, next) => {
      intercepted.push(action);
      next(action);
    };

    const store = new GanttStore(emptyState(), [middleware]);
    store.dispatch({ type: 'SET_ZOOM', level: 'day' });

    expect(intercepted).toHaveLength(1);
    expect(intercepted[0].type).toBe('SET_ZOOM');
    expect(store.getState().zoomLevel).toBe('day');
  });

  it('can block actions', () => {
    const blockingMiddleware: Middleware = (_action, _getState, _next) => {
      // Don't call next — action is blocked
    };

    const store = new GanttStore(emptyState(), [blockingMiddleware]);
    store.dispatch({ type: 'SET_ZOOM', level: 'day' });

    // Zoom should remain 'week' (the default)
    expect(store.getState().zoomLevel).toBe('week');
  });

  it('can modify actions before passing through', () => {
    const modifyingMiddleware: Middleware = (action, _getState, next) => {
      if (action.type === 'SET_ZOOM') {
        // Force month zoom regardless of what was requested
        next({ type: 'SET_ZOOM', level: 'month' });
      } else {
        next(action);
      }
    };

    const store = new GanttStore(emptyState(), [modifyingMiddleware]);
    store.dispatch({ type: 'SET_ZOOM', level: 'day' });

    expect(store.getState().zoomLevel).toBe('month');
  });
});

// ─── Subscribe / Unsubscribe ──────────────────────────────────────────────

describe('GanttStore subscribe', () => {
  it('notifies listeners on state change', () => {
    const store = new GanttStore(emptyState());
    const listener = vi.fn();

    store.subscribe(listener);
    store.dispatch({ type: 'SET_ZOOM', level: 'day' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', () => {
    const store = new GanttStore(emptyState());
    const listener = vi.fn();

    const unsub = store.subscribe(listener);
    store.dispatch({ type: 'SET_ZOOM', level: 'day' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.dispatch({ type: 'SET_ZOOM', level: 'month' });
    expect(listener).toHaveBeenCalledTimes(1); // no additional call
  });

  it('does not notify when state is unchanged', () => {
    const store = new GanttStore(emptyState());
    const listener = vi.fn();

    store.subscribe(listener);
    // Dispatch REMOVE_TASK for non-existent ID — state remains the same reference
    store.dispatch({ type: 'REMOVE_TASK', taskId: 'nonexistent' });

    expect(listener).not.toHaveBeenCalled();
  });
});
