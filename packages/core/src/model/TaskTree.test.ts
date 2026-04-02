import { describe, it, expect } from 'vitest';
import { buildTree, computeDateRange } from './TaskTree';
import type { GanttTask } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<GanttTask> & { id: string; name: string }): GanttTask {
  return {
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    ...overrides,
  };
}

function taskMap(tasks: GanttTask[]): Map<string, GanttTask> {
  const map = new Map<string, GanttTask>();
  for (const t of tasks) map.set(t.id, t);
  return map;
}

// ─── buildTree ────────────────────────────────────────────────────────────

describe('buildTree', () => {
  it('returns empty tree and flatIds for empty task map', () => {
    const result = buildTree(new Map(), new Set());
    expect(result.tree).toEqual([]);
    expect(result.flatIds).toEqual([]);
  });

  it('returns one root node for a single task with no parent', () => {
    const tasks = taskMap([makeTask({ id: 'a', name: 'Alpha' })]);
    const result = buildTree(tasks, new Set());

    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].task.id).toBe('a');
    expect(result.tree[0].depth).toBe(0);
    expect(result.tree[0].children).toEqual([]);
    expect(result.flatIds).toEqual(['a']);
  });

  it('builds parent-child hierarchy with correct depth', () => {
    const tasks = taskMap([
      makeTask({ id: 'p', name: 'Parent' }),
      makeTask({ id: 'c1', name: 'Child 1', parentId: 'p' }),
      makeTask({ id: 'c2', name: 'Child 2', parentId: 'p' }),
    ]);

    // Expand parent so children are visible
    const result = buildTree(tasks, new Set(['p']));

    expect(result.tree).toHaveLength(1);
    const parent = result.tree[0];
    expect(parent.depth).toBe(0);
    expect(parent.children).toHaveLength(2);
    expect(parent.children[0].depth).toBe(1);
    expect(parent.children[1].depth).toBe(1);
  });

  it('collapsed parent hides children from flatIds', () => {
    const tasks = taskMap([
      makeTask({ id: 'p', name: 'Parent' }),
      makeTask({ id: 'c1', name: 'Child', parentId: 'p' }),
    ]);

    // Parent not expanded
    const result = buildTree(tasks, new Set());

    expect(result.flatIds).toEqual(['p']);
    expect(result.tree[0].expanded).toBe(false);
  });

  it('expanded parent shows children in flatIds', () => {
    const tasks = taskMap([
      makeTask({ id: 'p', name: 'Parent' }),
      makeTask({ id: 'c1', name: 'Alpha Child', parentId: 'p' }),
      makeTask({ id: 'c2', name: 'Beta Child', parentId: 'p' }),
    ]);

    const result = buildTree(tasks, new Set(['p']));

    expect(result.flatIds).toEqual(['p', 'c1', 'c2']);
    expect(result.tree[0].expanded).toBe(true);
  });

  it('sorts by sortOrder then by name', () => {
    const tasks = taskMap([
      makeTask({ id: 'b', name: 'Bravo', sortOrder: 2 }),
      makeTask({ id: 'a', name: 'Alpha', sortOrder: 1 }),
      makeTask({ id: 'd', name: 'Delta' }),  // no sortOrder
      makeTask({ id: 'c', name: 'Charlie' }), // no sortOrder
    ]);

    const result = buildTree(tasks, new Set());

    // sortOrder 1, sortOrder 2, then alphabetically: Charlie, Delta
    expect(result.flatIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('treats parentId pointing to missing task as root', () => {
    const tasks = taskMap([
      makeTask({ id: 'orphan', name: 'Orphan', parentId: 'nonexistent' }),
    ]);

    const result = buildTree(tasks, new Set());

    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].task.id).toBe('orphan');
    expect(result.flatIds).toEqual(['orphan']);
  });

  it('deeply nested tree respects expand state', () => {
    const tasks = taskMap([
      makeTask({ id: 'root', name: 'Root' }),
      makeTask({ id: 'mid', name: 'Mid', parentId: 'root' }),
      makeTask({ id: 'leaf', name: 'Leaf', parentId: 'mid' }),
    ]);

    // Only root expanded, mid collapsed
    const result = buildTree(tasks, new Set(['root']));

    expect(result.flatIds).toEqual(['root', 'mid']);
    // leaf is hidden because mid is not expanded
  });

  it('deeply nested tree fully expanded shows all', () => {
    const tasks = taskMap([
      makeTask({ id: 'root', name: 'Root' }),
      makeTask({ id: 'mid', name: 'Mid', parentId: 'root' }),
      makeTask({ id: 'leaf', name: 'Leaf', parentId: 'mid' }),
    ]);

    const result = buildTree(tasks, new Set(['root', 'mid']));

    expect(result.flatIds).toEqual(['root', 'mid', 'leaf']);
  });
});

// ─── computeDateRange ─────────────────────────────────────────────────────

describe('computeDateRange', () => {
  it('returns min/max with default padding of 7 days', () => {
    const tasks = taskMap([
      makeTask({ id: 'a', name: 'A', startDate: '2026-03-10', endDate: '2026-03-20' }),
      makeTask({ id: 'b', name: 'B', startDate: '2026-03-05', endDate: '2026-03-25' }),
    ]);

    const range = computeDateRange(tasks);

    // min startDate = March 5, minus 7 = Feb 26
    // max endDate = March 25, plus 7 = April 1
    const expectedStart = new Date(Date.UTC(2026, 2, 5) - 7 * 86_400_000);
    const expectedEnd = new Date(Date.UTC(2026, 2, 25) + 7 * 86_400_000);

    expect(range.start.getTime()).toBe(expectedStart.getTime());
    expect(range.end.getTime()).toBe(expectedEnd.getTime());
  });

  it('applies custom padding', () => {
    const tasks = taskMap([
      makeTask({ id: 'a', name: 'A', startDate: '2026-04-01', endDate: '2026-04-15' }),
    ]);

    const range = computeDateRange(tasks, 14);

    const expectedStart = new Date(Date.UTC(2026, 3, 1) - 14 * 86_400_000);
    const expectedEnd = new Date(Date.UTC(2026, 3, 15) + 14 * 86_400_000);

    expect(range.start.getTime()).toBe(expectedStart.getTime());
    expect(range.end.getTime()).toBe(expectedEnd.getTime());
  });

  it('returns today +/- 30 days when no tasks exist', () => {
    const range = computeDateRange(new Map());

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expectedStart = new Date(now.getTime() - 30 * 86_400_000);
    const expectedEnd = new Date(now.getTime() + 30 * 86_400_000);

    expect(range.start.getTime()).toBe(expectedStart.getTime());
    expect(range.end.getTime()).toBe(expectedEnd.getTime());
  });
});
