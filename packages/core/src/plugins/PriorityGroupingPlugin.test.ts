import { describe, it, expect } from 'vitest';
import { PriorityGroupingPlugin, type PriorityBucket } from './PriorityGroupingPlugin';
import type { GanttTask, GanttState, PluginHost, Action } from '../model/types';

// Mirror of the plugin's private constant — the synthetic header id prefix.
const HEADER = (id: string) => `__bucket_header__${id}`;

const BUCKETS: PriorityBucket[] = [
  { id: 'top-priority', label: 'NOW', color: '#dc2626', order: 0 },
  { id: 'deferred', label: 'HOLD', color: '#94a3b8', order: 1 },
];

function makeTask(id: string, groupId: string): GanttTask {
  return { id, name: id, startDate: '2026-06-01', endDate: '2026-06-02', groupId };
}

// Minimal host: the plugin's middleware only reads tasks / flatVisibleIds /
// expandedIds and calls rebuildTree(). Cast a partial state to the full shape.
function makeHost(tasks: GanttTask[]): { host: PluginHost; state: GanttState } {
  const state = {
    tasks: new Map(tasks.map((t) => [t.id, t])),
    flatVisibleIds: tasks.map((t) => t.id),
    expandedIds: new Set<string>(),
    scrollX: 0,
    scrollY: 0,
  } as unknown as GanttState;
  const host = {
    getState: () => state,
    dispatch: () => {},
    on: () => () => {},
    rebuildTree: () => {},
  } as unknown as PluginHost;
  return { host, state };
}

function run(startCollapsed?: boolean | string[]): GanttState {
  const tasks = [makeTask('A', 'top-priority'), makeTask('B', 'deferred')];
  const { host, state } = makeHost(tasks);
  const plugin = PriorityGroupingPlugin({ buckets: BUCKETS, startCollapsed });
  plugin.install(host);
  plugin.middleware!({ type: 'SET_SCROLL', x: 0, y: 0 } as unknown as Action, () => {});
  return state;
}

describe('PriorityGroupingPlugin startCollapsed', () => {
  it('expands every bucket when omitted', () => {
    const state = run();
    expect(state.expandedIds.has(HEADER('top-priority'))).toBe(true);
    expect(state.expandedIds.has(HEADER('deferred'))).toBe(true);
  });

  it('collapses every bucket when true', () => {
    const state = run(true);
    expect(state.expandedIds.has(HEADER('top-priority'))).toBe(false);
    expect(state.expandedIds.has(HEADER('deferred'))).toBe(false);
  });

  it('collapses only the listed bucket ids when given an array', () => {
    const state = run(['deferred']);
    expect(state.expandedIds.has(HEADER('top-priority'))).toBe(true);
    expect(state.expandedIds.has(HEADER('deferred'))).toBe(false);
  });

  it('ignores unknown bucket ids in the array', () => {
    const state = run(['nope', 'deferred']);
    expect(state.expandedIds.has(HEADER('top-priority'))).toBe(true);
    expect(state.expandedIds.has(HEADER('deferred'))).toBe(false);
  });
});
