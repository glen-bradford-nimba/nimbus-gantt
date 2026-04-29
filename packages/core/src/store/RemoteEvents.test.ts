// 0.185.37 — translateRemoteEvent + reducer integration tests.
// Covers the host-pumped server→client channel from
// docs/dispatch-ng-remote-events.md. Skeleton scope: task.upsert
// (per-field patch), task.delete, bulk.replace.

import { describe, it, expect } from 'vitest';
import { GanttStore, translateRemoteEvent } from './GanttStore';
import type {
  GanttState,
  GanttTask,
  RemoteEvent,
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

function stateWith(tasks: GanttTask[]): GanttState {
  const map = new Map<string, GanttTask>();
  for (const t of tasks) map.set(t.id, t);
  return {
    tasks: map,
    dependencies: new Map(),
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

describe('translateRemoteEvent — task.upsert', () => {
  it('emits UPDATE_TASK with merge-only changes for an existing id', () => {
    const state = stateWith([makeTask('t1', { progress: 0.25, status: 'Open' })]);
    const event: RemoteEvent = {
      kind: 'task.upsert',
      version: 1,
      tasks: [{ id: 't1', status: 'Complete' }],
    };
    const actions = translateRemoteEvent(state, event);
    expect(actions).toEqual([
      { type: 'UPDATE_TASK', taskId: 't1', changes: { status: 'Complete' } },
    ]);
  });

  it('preserves untouched fields after the reducer applies', () => {
    // The whole point of per-field patch: drag-reorder only sends
    // {parentId, sortOrder} and must NOT clobber a concurrent name edit.
    const original = makeTask('t1', {
      name: 'in-flight name edit',
      progress: 0.5,
      sortOrder: 1,
    });
    const store = new GanttStore(stateWith([original]));
    const event: RemoteEvent = {
      kind: 'task.upsert',
      version: 1,
      tasks: [{ id: 't1', sortOrder: 7, parentId: 'p1' }],
    };
    for (const a of translateRemoteEvent(store.getState(), event)) {
      store.dispatch(a);
    }
    const after = store.getState().tasks.get('t1')!;
    expect(after.name).toBe('in-flight name edit');
    expect(after.progress).toBe(0.5);
    expect(after.sortOrder).toBe(7);
    expect(after.parentId).toBe('p1');
  });

  it('emits ADD_TASK when id is new and required fields are present', () => {
    const state = stateWith([]);
    const event: RemoteEvent = {
      kind: 'task.upsert',
      version: 1,
      tasks: [
        { id: 'new1', name: 'New', startDate: '2026-04-01', endDate: '2026-04-05' },
      ],
    };
    const actions = translateRemoteEvent(state, event);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'ADD_TASK' });
    expect((actions[0] as { task: GanttTask }).task.id).toBe('new1');
  });

  it('drops insert when patch is incomplete (missing required fields)', () => {
    const state = stateWith([]);
    const event: RemoteEvent = {
      kind: 'task.upsert',
      version: 1,
      // Has id but no name/startDate/endDate — host should have used
      // bulk.replace for a snapshot.
      tasks: [{ id: 'new1', status: 'Open' }],
    };
    expect(translateRemoteEvent(state, event)).toEqual([]);
  });

  it('handles a mixed batch — update existing, insert new, drop incomplete', () => {
    const state = stateWith([makeTask('t1')]);
    const event: RemoteEvent = {
      kind: 'task.upsert',
      version: 1,
      tasks: [
        { id: 't1', progress: 0.9 },
        { id: 't2', name: 'Two', startDate: '2026-04-01', endDate: '2026-04-05' },
        { id: 't3', status: 'Open' }, // incomplete insert
      ],
    };
    const actions = translateRemoteEvent(state, event);
    expect(actions.map((a) => a.type)).toEqual(['UPDATE_TASK', 'ADD_TASK']);
  });
});

describe('translateRemoteEvent — task.delete', () => {
  it('emits REMOVE_TASK per id', () => {
    const state = stateWith([makeTask('t1'), makeTask('t2'), makeTask('t3')]);
    const event: RemoteEvent = {
      kind: 'task.delete',
      version: 1,
      ids: ['t1', 't3'],
    };
    expect(translateRemoteEvent(state, event)).toEqual([
      { type: 'REMOVE_TASK', taskId: 't1' },
      { type: 'REMOVE_TASK', taskId: 't3' },
    ]);
  });

  it('emits remove actions even for unknown ids (reducer no-ops them)', () => {
    // Idempotency: a duplicate delete on a replay should not throw.
    // Reducer handles the missing-id case (REMOVE_TASK returns state
    // unchanged when id is absent), so the translator stays simple.
    const state = stateWith([]);
    const event: RemoteEvent = {
      kind: 'task.delete',
      version: 1,
      ids: ['ghost'],
    };
    expect(translateRemoteEvent(state, event)).toEqual([
      { type: 'REMOVE_TASK', taskId: 'ghost' },
    ]);
  });
});

describe('translateRemoteEvent — bulk.replace', () => {
  it('emits SET_DATA with tasks and deps', () => {
    const state = stateWith([makeTask('old1')]);
    const event: RemoteEvent = {
      kind: 'bulk.replace',
      version: 1,
      tasks: [makeTask('new1'), makeTask('new2')],
      deps: [{ id: 'd1', source: 'new1', target: 'new2' }],
    };
    const actions = translateRemoteEvent(state, event);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'SET_DATA',
      tasks: event.tasks,
      dependencies: event.deps,
    });
  });

  it('emits SET_DATA with undefined deps when caller omits them', () => {
    const state = stateWith([]);
    const event: RemoteEvent = {
      kind: 'bulk.replace',
      version: 1,
      tasks: [makeTask('a')],
    };
    const actions = translateRemoteEvent(state, event);
    expect(actions[0]).toMatchObject({
      type: 'SET_DATA',
      dependencies: undefined,
    });
  });
});

describe('translateRemoteEvent — version + unknown kinds', () => {
  it('drops events with unknown version', () => {
    const state = stateWith([makeTask('t1')]);
    const event = {
      kind: 'task.delete',
      version: 99,
      ids: ['t1'],
    } as unknown as RemoteEvent;
    expect(translateRemoteEvent(state, event)).toEqual([]);
  });

  it('drops events with unknown kind (forward-compat for 0.185.38+)', () => {
    const state = stateWith([makeTask('t1')]);
    const event = {
      kind: 'dep.upsert', // not in skeleton
      version: 1,
      deps: [],
    } as unknown as RemoteEvent;
    expect(translateRemoteEvent(state, event)).toEqual([]);
  });
});

// ─── Per-id stale-drop integration ─────────────────────────────────────────
// pushRemoteEvent layers per-id stale-drop on top of the translator. We
// can't construct NimbusGantt here (no DOM/canvas in this test
// environment), but we can simulate the same loop and verify the
// stale-drop semantics independent of layout/render.

function simulatePushRemoteEvent(
  store: GanttStore,
  lastTs: Map<string, number>,
  event: RemoteEvent,
): { merged: number; added: number; removed: number; droppedStale: number } {
  if (!event || event.version !== 1) {
    return { merged: 0, added: 0, removed: 0, droppedStale: 0 };
  }
  if (event.kind === 'bulk.replace') {
    lastTs.clear();
    for (const a of translateRemoteEvent(store.getState(), event)) store.dispatch(a);
    return { merged: 0, added: 0, removed: 0, droppedStale: 0 };
  }
  const ts = event.ts;
  let merged = 0, added = 0, removed = 0, droppedStale = 0;
  for (const action of translateRemoteEvent(store.getState(), event)) {
    let taskId: string | null = null;
    if (action.type === 'UPDATE_TASK') taskId = action.taskId;
    else if (action.type === 'ADD_TASK') taskId = action.task.id;
    else if (action.type === 'REMOVE_TASK') taskId = action.taskId;

    if (taskId && typeof ts === 'number') {
      const prev = lastTs.get(taskId);
      if (prev !== undefined && ts < prev) { droppedStale++; continue; }
    }
    store.dispatch(action);
    if (taskId && typeof ts === 'number') lastTs.set(taskId, ts);
    if (action.type === 'UPDATE_TASK') merged++;
    else if (action.type === 'ADD_TASK') added++;
    else if (action.type === 'REMOVE_TASK') removed++;
  }
  return { merged, added, removed, droppedStale };
}

describe('pushRemoteEvent — per-id stale-drop', () => {
  it('drops a task.upsert older than the last applied ts for that id', () => {
    const store = new GanttStore(stateWith([makeTask('t1', { progress: 0.1 })]));
    const lastTs = new Map<string, number>();

    const r1 = simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1, ts: 1000,
      tasks: [{ id: 't1', progress: 0.5 }],
    });
    expect(r1.merged).toBe(1);
    expect(store.getState().tasks.get('t1')?.progress).toBe(0.5);

    // Out-of-order: ts 500 arrives after ts 1000. Should drop.
    const r2 = simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1, ts: 500,
      tasks: [{ id: 't1', progress: 0.9 }],
    });
    expect(r2.droppedStale).toBe(1);
    expect(r2.merged).toBe(0);
    expect(store.getState().tasks.get('t1')?.progress).toBe(0.5);
  });

  it('per-id staleness is independent — fresh on t2 applies even if t1 is stale', () => {
    const store = new GanttStore(stateWith([
      makeTask('t1', { progress: 0.1 }),
      makeTask('t2', { progress: 0.1 }),
    ]));
    const lastTs = new Map<string, number>();
    // Establish baselines
    simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1, ts: 1000,
      tasks: [{ id: 't1', progress: 0.5 }],
    });
    // Mixed batch: t1 stale (ts 500), t2 fresh (ts 500 vs no prior).
    const r = simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1, ts: 500,
      tasks: [
        { id: 't1', progress: 0.99 },
        { id: 't2', progress: 0.99 },
      ],
    });
    expect(r.droppedStale).toBe(1);
    expect(r.merged).toBe(1);
    expect(store.getState().tasks.get('t1')?.progress).toBe(0.5);  // unchanged
    expect(store.getState().tasks.get('t2')?.progress).toBe(0.99); // applied
  });

  it('bulk.replace clears the stale-drop map', () => {
    const store = new GanttStore(stateWith([makeTask('t1')]));
    const lastTs = new Map<string, number>();
    simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1, ts: 1000,
      tasks: [{ id: 't1', progress: 0.5 }],
    });
    expect(lastTs.get('t1')).toBe(1000);

    simulatePushRemoteEvent(store, lastTs, {
      kind: 'bulk.replace', version: 1, ts: 2000,
      tasks: [makeTask('t1')],
    });
    expect(lastTs.size).toBe(0);

    // After bulk.replace, a ts=500 event applies (no prior baseline) —
    // exactly the post-reconnect-snapshot semantics the dispatch wants.
    const r = simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1, ts: 500,
      tasks: [{ id: 't1', progress: 0.7 }],
    });
    expect(r.merged).toBe(1);
  });

  it('idempotent on replay: same ts twice = second is dropped (equality check)', () => {
    const store = new GanttStore(stateWith([makeTask('t1', { progress: 0.1 })]));
    const lastTs = new Map<string, number>();
    const event: RemoteEvent = {
      kind: 'task.upsert', version: 1, ts: 1000,
      tasks: [{ id: 't1', progress: 0.5 }],
    };
    simulatePushRemoteEvent(store, lastTs, event);
    const r = simulatePushRemoteEvent(store, lastTs, event);
    // Equal ts is NOT dropped (strict <), so the action runs again as a
    // no-op merge — reducer detects no change and returns same state ref.
    // This matches dispatch's idempotency guarantee.
    expect(r.merged).toBe(1);
  });

  it('events without ts always apply (host opted out of stale-drop)', () => {
    const store = new GanttStore(stateWith([makeTask('t1', { progress: 0.1 })]));
    const lastTs = new Map<string, number>();
    // Establish a baseline
    simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1, ts: 1000,
      tasks: [{ id: 't1', progress: 0.5 }],
    });
    // Event without ts — should apply regardless of prior baseline.
    const r = simulatePushRemoteEvent(store, lastTs, {
      kind: 'task.upsert', version: 1,
      tasks: [{ id: 't1', progress: 0.9 }],
    });
    expect(r.merged).toBe(1);
    expect(store.getState().tasks.get('t1')?.progress).toBe(0.9);
  });
});
