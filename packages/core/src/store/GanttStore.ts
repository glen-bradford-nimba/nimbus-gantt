// ─── Immutable State Store with Middleware ──────────────────────────────────
// Redux-style store purpose-built for NimbusGantt. Supports a middleware
// pipeline (for plugins, undo/redo, persistence, etc.) and notifies
// subscribers on every state change.

import type {
  GanttState,
  GanttTask,
  GanttDependency,
  Action,
  DragState,
  RemoteEvent,
} from '../model/types';
import { buildTree, computeDateRange } from '../model/TaskTree';

// ─── Middleware type ────────────────────────────────────────────────────────

export type Middleware = (
  action: Action,
  getState: () => GanttState,
  next: (action: Action) => void,
) => void;

// ─── Store ──────────────────────────────────────────────────────────────────

export class GanttStore {
  private state: GanttState;
  private listeners: Set<() => void> = new Set();
  private middlewares: Middleware[];

  constructor(initialState: GanttState, middlewares: Middleware[] = []) {
    this.state = initialState;
    this.middlewares = middlewares;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  getState(): GanttState {
    return this.state;
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Dispatch an action through the middleware pipeline, then apply the reducer.
   */
  dispatch(action: Action): void {
    if (this.middlewares.length === 0) {
      this.applyAction(action);
      return;
    }

    // Build the middleware chain from right to left
    const chain = this.middlewares.reduceRight<(a: Action) => void>(
      (next, mw) => (a: Action) => mw(a, () => this.state, next),
      (a: Action) => this.applyAction(a),
    );

    chain(action);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private applyAction(action: Action): void {
    const next = reduce(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.notify();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ─── Reducer ────────────────────────────────────────────────────────────────

function reduce(state: GanttState, action: Action): GanttState {
  switch (action.type) {
    // ── Data Loading ──────────────────────────────────────────────────────

    case 'SET_DATA': {
      const tasks = new Map<string, GanttTask>();
      for (const t of action.tasks) {
        tasks.set(t.id, t);
      }
      const dependencies = new Map<string, GanttDependency>();
      if (action.dependencies) {
        for (const d of action.dependencies) {
          dependencies.set(d.id, d);
        }
      }
      const { tree, flatIds } = buildTree(tasks, state.expandedIds);
      const dateRange = computeDateRange(tasks);
      return {
        ...state,
        tasks,
        dependencies,
        tree,
        flatVisibleIds: flatIds,
        dateRange,
      };
    }

    // ── Task CRUD ─────────────────────────────────────────────────────────

    case 'UPDATE_TASK': {
      const existing = state.tasks.get(action.taskId);
      if (!existing) return state;

      const updated: GanttTask = { ...existing, ...action.changes };
      const tasks = new Map(state.tasks);
      tasks.set(action.taskId, updated);

      const parentChanged = action.changes.parentId !== undefined &&
        action.changes.parentId !== existing.parentId;

      if (parentChanged) {
        const { tree, flatIds } = buildTree(tasks, state.expandedIds);
        return {
          ...state,
          tasks,
          tree,
          flatVisibleIds: flatIds,
        };
      }

      return { ...state, tasks };
    }

    case 'ADD_TASK': {
      const tasks = new Map(state.tasks);
      tasks.set(action.task.id, action.task);
      const { tree, flatIds } = buildTree(tasks, state.expandedIds);
      const dateRange = computeDateRange(tasks);
      return {
        ...state,
        tasks,
        tree,
        flatVisibleIds: flatIds,
        dateRange,
      };
    }

    case 'REMOVE_TASK': {
      if (!state.tasks.has(action.taskId)) return state;
      const tasks = new Map(state.tasks);
      tasks.delete(action.taskId);
      const { tree, flatIds } = buildTree(tasks, state.expandedIds);
      const dateRange = computeDateRange(tasks);

      // Also clean selectedIds
      const selectedIds = new Set(state.selectedIds);
      selectedIds.delete(action.taskId);

      return {
        ...state,
        tasks,
        tree,
        flatVisibleIds: flatIds,
        dateRange,
        selectedIds,
      };
    }

    // ── Expand / Collapse ─────────────────────────────────────────────────

    case 'TOGGLE_EXPAND': {
      const expandedIds = new Set(state.expandedIds);
      if (expandedIds.has(action.taskId)) {
        expandedIds.delete(action.taskId);
      } else {
        expandedIds.add(action.taskId);
      }
      const { tree, flatIds } = buildTree(state.tasks, expandedIds);
      return {
        ...state,
        expandedIds,
        tree,
        flatVisibleIds: flatIds,
      };
    }

    case 'EXPAND_ALL': {
      const expandedIds = new Set<string>();
      // Add every task that has at least one child
      const parentIds = new Set<string>();
      for (const task of state.tasks.values()) {
        if (task.parentId && state.tasks.has(task.parentId)) {
          parentIds.add(task.parentId);
        }
      }
      for (const id of parentIds) {
        expandedIds.add(id);
      }
      const { tree, flatIds } = buildTree(state.tasks, expandedIds);
      return {
        ...state,
        expandedIds,
        tree,
        flatVisibleIds: flatIds,
      };
    }

    case 'COLLAPSE_ALL': {
      const expandedIds = new Set<string>();
      const { tree, flatIds } = buildTree(state.tasks, expandedIds);
      return {
        ...state,
        expandedIds,
        tree,
        flatVisibleIds: flatIds,
      };
    }

    // ── Zoom ──────────────────────────────────────────────────────────────

    case 'SET_ZOOM':
      return { ...state, zoomLevel: action.level };

    // ── Scroll ────────────────────────────────────────────────────────────

    case 'SET_SCROLL':
      return { ...state, scrollX: action.x, scrollY: action.y };

    case 'SET_SCROLL_X':
      return { ...state, scrollX: action.x };

    case 'SET_SCROLL_Y':
      return { ...state, scrollY: action.y };

    // ── Selection ─────────────────────────────────────────────────────────

    case 'SELECT_TASK': {
      const selectedIds = action.multi
        ? new Set(state.selectedIds)
        : new Set<string>();

      if (action.multi && selectedIds.has(action.taskId)) {
        selectedIds.delete(action.taskId);
      } else {
        selectedIds.add(action.taskId);
      }
      return { ...state, selectedIds };
    }

    case 'DESELECT_ALL':
      return { ...state, selectedIds: new Set<string>() };

    // ── Drag & Drop ───────────────────────────────────────────────────────

    case 'DRAG_START':
      return { ...state, dragState: action.drag };

    case 'DRAG_UPDATE': {
      if (!state.dragState) return state;
      const dragState: DragState = {
        ...state.dragState,
        currentX: action.currentX,
        currentY: action.currentY,
      };
      return { ...state, dragState };
    }

    case 'DRAG_END':
      return { ...state, dragState: null };

    case 'DRAG_CANCEL':
      return { ...state, dragState: null };

    // ── Task Move / Resize ────────────────────────────────────────────────

    case 'TASK_MOVE':
    case 'TASK_RESIZE': {
      const existing = state.tasks.get(action.taskId);
      if (!existing) return state;
      const tasks = new Map(state.tasks);
      tasks.set(action.taskId, {
        ...existing,
        startDate: action.startDate,
        endDate: action.endDate,
      });
      const dateRange = computeDateRange(tasks);
      return { ...state, tasks, dateRange };
    }

    // ── Dependencies ──────────────────────────────────────────────────────

    case 'ADD_DEPENDENCY': {
      const dependencies = new Map(state.dependencies);
      dependencies.set(action.dependency.id, action.dependency);
      return { ...state, dependencies };
    }

    case 'REMOVE_DEPENDENCY': {
      if (!state.dependencies.has(action.dependencyId)) return state;
      const dependencies = new Map(state.dependencies);
      dependencies.delete(action.dependencyId);
      return { ...state, dependencies };
    }

    // ── Date Range ────────────────────────────────────────────────────────

    case 'SET_DATE_RANGE':
      return {
        ...state,
        dateRange: { start: action.start, end: action.end },
      };

    default:
      return state;
  }
}

// ─── Remote-Event Translator (0.185.37) ─────────────────────────────────────
// Pure helper — translates a `RemoteEvent` into the list of `Action`s that
// the reducer should dispatch. Stateless; given the same (state, event) it
// always returns the same actions. Stale-drop and ts bookkeeping live in
// the caller (NimbusGantt.pushRemoteEvent), not here, so the translator
// stays trivially testable.

export function translateRemoteEvent(
  state: GanttState,
  event: RemoteEvent,
): Action[] {
  if (!event || event.version !== 1) return [];

  switch (event.kind) {
    case 'task.upsert': {
      const out: Action[] = [];
      for (const patch of event.tasks) {
        if (!patch || typeof patch.id !== 'string') continue;
        if (state.tasks.has(patch.id)) {
          // Merge present keys only — preserves fields the host didn't
          // include in this patch (drag-reorder hot path safety).
          const { id, ...changes } = patch;
          out.push({ type: 'UPDATE_TASK', taskId: id, changes });
        } else if (patch.name && patch.startDate && patch.endDate) {
          // Insert: full row required (id + name + startDate + endDate).
          out.push({ type: 'ADD_TASK', task: patch as GanttTask });
        }
        // else: id missing AND incomplete patch — drop. Host should send
        // `bulk.replace` for snapshot-style backfills.
      }
      return out;
    }

    case 'task.delete': {
      const out: Action[] = [];
      for (const id of event.ids) {
        if (typeof id === 'string') {
          out.push({ type: 'REMOVE_TASK', taskId: id });
        }
      }
      return out;
    }

    case 'bulk.replace': {
      return [
        { type: 'SET_DATA', tasks: event.tasks, dependencies: event.deps },
      ];
    }

    // Unknown / future kinds (dep.upsert, dep.delete, host.custom) drop
    // silently in the skeleton. 0.185.38+.
    default:
      return [];
  }
}
