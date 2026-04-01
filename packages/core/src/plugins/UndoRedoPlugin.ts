// ─── Undo/Redo Plugin ───────────────────────────────────────────────────────
// Provides undo/redo capability with a configurable history depth.
// Captures task and dependency state snapshots on mutating actions and
// restores them via Ctrl+Z (undo) and Ctrl+Shift+Z (redo).

import type {
  NimbusGanttPlugin,
  PluginHost,
  Action,
  GanttTask,
  GanttDependency,
  GanttState,
} from '../model/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface UndoRedoOptions {
  /** Maximum number of undo steps to retain. Defaults to 20. */
  depth?: number;
}

interface StateSnapshot {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
}

// ─── Tracked action types ───────────────────────────────────────────────────

const TRACKED_ACTIONS = new Set<string>([
  'TASK_MOVE',
  'TASK_RESIZE',
  'ADD_TASK',
  'REMOVE_TASK',
  'UPDATE_TASK',
  'ADD_DEPENDENCY',
  'REMOVE_DEPENDENCY',
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function snapshotState(state: GanttState): StateSnapshot {
  return {
    tasks: Array.from(state.tasks.values()).map((t) => ({ ...t })),
    dependencies: Array.from(state.dependencies.values()).map((d) => ({ ...d })),
  };
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function UndoRedoPlugin(options?: UndoRedoOptions): NimbusGanttPlugin {
  const maxDepth = options?.depth ?? 20;

  let host: PluginHost | null = null;
  let undoStack: StateSnapshot[] = [];
  let redoStack: StateSnapshot[] = [];
  let isRestoring = false;

  // Keyboard handler reference for cleanup
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let containerEl: HTMLElement | null = null;
  let unsubStateChange: (() => void) | null = null;

  function pushUndo(snapshot: StateSnapshot): void {
    undoStack.push(snapshot);
    if (undoStack.length > maxDepth) {
      undoStack.shift();
    }
  }

  function performUndo(): void {
    if (!host || undoStack.length === 0) return;

    const current = snapshotState(host.getState());
    const previous = undoStack.pop()!;

    redoStack.push(current);

    isRestoring = true;
    host.dispatch({
      type: 'SET_DATA',
      tasks: previous.tasks,
      dependencies: previous.dependencies,
    });
    isRestoring = false;
  }

  function performRedo(): void {
    if (!host || redoStack.length === 0) return;

    const current = snapshotState(host.getState());
    const next = redoStack.pop()!;

    undoStack.push(current);

    isRestoring = true;
    host.dispatch({
      type: 'SET_DATA',
      tasks: next.tasks,
      dependencies: next.dependencies,
    });
    isRestoring = false;
  }

  function handleKeydown(e: KeyboardEvent): void {
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (!isCtrlOrMeta) return;

    if (e.key === 'z' || e.key === 'Z') {
      if (e.shiftKey) {
        // Ctrl+Shift+Z = Redo
        e.preventDefault();
        performRedo();
      } else {
        // Ctrl+Z = Undo
        e.preventDefault();
        performUndo();
      }
    }
  }

  return {
    name: 'UndoRedoPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Attach keyboard listener to the gantt container.
      // The container is the parent of the .nimbus-gantt root element.
      // We find it by looking at the DOM via a stateChange event after first render.
      unsubStateChange = gantt.on('render', () => {
        // Only attach once
        if (containerEl) return;

        // Find the .nimbus-gantt element in the document
        const rootEl = document.querySelector('.nimbus-gantt');
        if (!rootEl) return;

        containerEl = rootEl.parentElement ?? (rootEl as HTMLElement);

        // Make container focusable if it isn't already
        if (!containerEl.getAttribute('tabindex')) {
          containerEl.setAttribute('tabindex', '-1');
        }

        keydownHandler = handleKeydown;
        containerEl.addEventListener('keydown', keydownHandler);
      });
    },

    middleware(action: Action, next: (action: Action) => void): void {
      // If we're restoring from undo/redo, let SET_DATA pass through without
      // recording it as a new undoable action.
      if (isRestoring) {
        next(action);
        return;
      }

      // For tracked mutating actions, snapshot the current state before applying.
      if (TRACKED_ACTIONS.has(action.type) && host) {
        const snapshot = snapshotState(host.getState());
        pushUndo(snapshot);
        redoStack = [];
      }

      next(action);
    },

    destroy(): void {
      if (keydownHandler && containerEl) {
        containerEl.removeEventListener('keydown', keydownHandler);
      }
      if (unsubStateChange) {
        unsubStateChange();
      }
      host = null;
      containerEl = null;
      keydownHandler = null;
      undoStack = [];
      redoStack = [];
    },
  };
}
