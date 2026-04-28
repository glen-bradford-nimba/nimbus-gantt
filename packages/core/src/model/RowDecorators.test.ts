import { describe, it, expect } from 'vitest';
import { GanttStore } from '../store/GanttStore';
import type {
  GanttState,
  GanttTask,
  GanttRowDecorators,
  ResolvedConfig,
} from './types';
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

const decorated: GanttRowDecorators = {
  borderStyle: 'dashed',
  borderWidth: 2,
  fillStyle: 'muted',
  badge: { text: '✓', placement: 'end' },
};

function task(id: string, extras?: Partial<GanttTask>): GanttTask {
  return {
    id,
    name: id,
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    ...extras,
  };
}

describe('GanttRowDecorators — task.style passthrough', () => {
  it('SET_DATA preserves the style block on the task', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [task('t1', { style: decorated })],
    });

    const t = store.getState().tasks.get('t1');
    expect(t).toBeDefined();
    expect(t!.style).toEqual(decorated);
  });

  it('UPDATE_TASK can replace the style block independently', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [task('t1', { style: decorated })],
    });

    const next: GanttRowDecorators = {
      borderStyle: 'solid',
      borderColor: '#dc2626',
      badge: { text: 'RISK', placement: 'start', color: '#dc2626' },
    };
    store.dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { style: next } });

    expect(store.getState().tasks.get('t1')!.style).toEqual(next);
  });

  it('UPDATE_TASK can clear the style block', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [task('t1', { style: decorated })],
    });

    store.dispatch({ type: 'UPDATE_TASK', taskId: 't1', changes: { style: undefined } });

    expect(store.getState().tasks.get('t1')!.style).toBeUndefined();
  });

  it('tasks without style render normally (style remains undefined)', () => {
    const store = new GanttStore(emptyState());
    store.dispatch({ type: 'SET_DATA', tasks: [task('t1')] });

    expect(store.getState().tasks.get('t1')!.style).toBeUndefined();
  });

  it('group-header tasks with status="group-header" can carry style but renderer is responsible for ignoring it', () => {
    // The store layer is style-agnostic — it just stores whatever the host
    // hands it. The renderer is the layer that bails on group-header rows.
    // This test pins the contract that the data shape allows both fields
    // to coexist on the same task without the store discarding either.
    const store = new GanttStore(emptyState());
    store.dispatch({
      type: 'SET_DATA',
      tasks: [
        task('group', {
          status: 'group-header',
          groupBg: '#f3f4f6',
          groupColor: '#374151',
          style: decorated,
        }),
      ],
    });

    const t = store.getState().tasks.get('group')!;
    expect(t.status).toBe('group-header');
    expect(t.groupBg).toBe('#f3f4f6');
    expect(t.style).toEqual(decorated);
  });
});
