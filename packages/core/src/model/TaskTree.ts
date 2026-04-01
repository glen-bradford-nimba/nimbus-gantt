// ─── Task Tree Builder ──────────────────────────────────────────────────────
// Pure functions for building the hierarchical task tree and computing the
// flattened visible-row list used by layout and rendering.

import type { GanttTask, TaskTreeNode } from './types';

// ─── buildTree ──────────────────────────────────────────────────────────────

export interface BuildTreeResult {
  tree: TaskTreeNode[];
  flatIds: string[];
}

/**
 * Build a hierarchical tree of TaskTreeNodes from a flat task Map.
 *
 * - Groups tasks by parentId.
 * - Root tasks are those with no parentId or whose parentId is not in the Map.
 * - Children are sorted by sortOrder (ascending), then by name (alphabetical).
 * - `flatIds` contains only tasks whose ancestors are all expanded.
 */
export function buildTree(
  tasks: Map<string, GanttTask>,
  expandedIds: Set<string>,
): BuildTreeResult {
  // Group tasks by their parentId
  const childrenByParent = new Map<string | undefined, GanttTask[]>();

  for (const task of tasks.values()) {
    // Treat a task as a root if parentId is absent or points to a missing task
    const effectiveParent =
      task.parentId && tasks.has(task.parentId) ? task.parentId : undefined;

    let siblings = childrenByParent.get(effectiveParent);
    if (!siblings) {
      siblings = [];
      childrenByParent.set(effectiveParent, siblings);
    }
    siblings.push(task);
  }

  const flatIds: string[] = [];

  function sortTasks(a: GanttTask, b: GanttTask): number {
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  }

  function buildNodes(
    parentId: string | undefined,
    depth: number,
    parentVisible: boolean,
  ): TaskTreeNode[] {
    const tasks = childrenByParent.get(parentId);
    if (!tasks) return [];

    tasks.sort(sortTasks);

    return tasks.map((task) => {
      const hasChildren = childrenByParent.has(task.id);
      const expanded = hasChildren && expandedIds.has(task.id);
      const visible = parentVisible;

      const node: TaskTreeNode = {
        task,
        children: [],
        depth,
        expanded,
        visible,
        rowIndex: -1, // assigned below for visible nodes
      };

      if (visible) {
        node.rowIndex = flatIds.length;
        flatIds.push(task.id);
      }

      // Recurse into children — they are visible only if this node is expanded
      // AND this node itself is visible
      node.children = buildNodes(task.id, depth + 1, visible && expanded);

      return node;
    });
  }

  const tree = buildNodes(undefined, 0, true);

  return { tree, flatIds };
}

// ─── computeDateRange ───────────────────────────────────────────────────────

/**
 * Compute the overall date range spanning all tasks, with optional padding.
 *
 * - Finds the earliest startDate and latest endDate across all tasks.
 * - Adds `padding` days on each side (default 7).
 * - If there are no tasks, returns today +/- 30 days.
 */
export function computeDateRange(
  tasks: Map<string, GanttTask>,
  padding = 7,
): { start: Date; end: Date } {
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const task of tasks.values()) {
    if (task.startDate) {
      const t = new Date(task.startDate).getTime();
      if (t < minTime) minTime = t;
    }
    if (task.endDate) {
      const t = new Date(task.endDate).getTime();
      if (t > maxTime) maxTime = t;
    }
  }

  const msPerDay = 86_400_000;

  if (minTime === Infinity || maxTime === -Infinity) {
    // No tasks — fall back to today +/- 30 days
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return {
      start: new Date(now.getTime() - 30 * msPerDay),
      end: new Date(now.getTime() + 30 * msPerDay),
    };
  }

  return {
    start: new Date(minTime - padding * msPerDay),
    end: new Date(maxTime + padding * msPerDay),
  };
}
