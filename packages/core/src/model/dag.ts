// ─── DAG helpers ────────────────────────────────────────────────────────────
// Utilities for reading tasks as a DAG (via parentId + additionalParentIds)
// rather than as a strict tree. Used by rollups, schedulers, and dependency
// walkers that need to respect multiple logical parents without the visual
// tree renderer having to understand them.
//
// Rendering still flows through the single parentId — additionalParentIds is
// a LOGICAL overlay: "this work item also counts under these other parents
// for purposes of hour totals, approval gates, and scheduler precedence."

import type { GanttTask } from './types';

/**
 * All parents of a task, combining parentId + additionalParentIds, deduped.
 */
export function getAllParentIds(task: GanttTask): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (task.parentId) {
    out.push(task.parentId);
    seen.add(task.parentId);
  }
  for (const id of task.additionalParentIds ?? []) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * All descendant task IDs of `rootId` walking the DAG (parentId +
 * additionalParentIds in reverse: children = tasks listing rootId as any
 * kind of parent). Deduplicated, excludes rootId itself.
 *
 * Cycles are tolerated via the visited set — the walker returns the unique
 * reachable set regardless of cycles.
 */
export function getDescendantIds(
  rootId: string,
  tasks: Map<string, GanttTask> | GanttTask[],
): Set<string> {
  const taskList = tasks instanceof Map ? Array.from(tasks.values()) : tasks;

  // childrenByParent: parentId -> direct children
  const childrenByParent = new Map<string, string[]>();
  for (const t of taskList) {
    for (const pid of getAllParentIds(t)) {
      let arr = childrenByParent.get(pid);
      if (!arr) {
        arr = [];
        childrenByParent.set(pid, arr);
      }
      arr.push(t.id);
    }
  }

  const visited = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const kids = childrenByParent.get(id);
    if (!kids) continue;
    for (const k of kids) {
      if (!visited.has(k)) {
        visited.add(k);
        stack.push(k);
      }
    }
  }
  return visited;
}

/**
 * Sum of `hours` across all descendants of `rootId`, deduped — a task
 * reachable via multiple parent paths is counted exactly once. Reads the
 * `hours` field on GanttTask. Useful for proposal/framework rollups where
 * a single work item can belong to multiple proposal groupings but should
 * only count once in the overall scope total.
 */
export function rollupHoursDeduped(
  rootId: string,
  tasks: Map<string, GanttTask> | GanttTask[],
): number {
  const descendants = getDescendantIds(rootId, tasks);
  const taskMap =
    tasks instanceof Map
      ? tasks
      : new Map(tasks.map((t) => [t.id, t] as const));
  let total = 0;
  for (const id of descendants) {
    const t = taskMap.get(id);
    if (t && typeof t.hours === 'number') total += t.hours;
  }
  return total;
}
