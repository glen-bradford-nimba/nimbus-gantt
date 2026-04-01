// ─── Keyboard Navigation Plugin ─────────────────────────────────────────────
// Adds keyboard-driven navigation, selection, expand/collapse, zoom, and
// custom events to the Gantt chart. Makes the container focusable and listens
// for keydown events.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  ZoomLevel,
} from '../model/types';

// ─── Zoom levels in order (for +/- cycling) ────────────────────────────────

const ZOOM_ORDER: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSelectedTaskId(state: GanttState): string | null {
  if (state.selectedIds.size === 0) return null;
  // Return the first selected ID
  return state.selectedIds.values().next().value ?? null;
}

function hasChildren(taskId: string, state: GanttState): boolean {
  for (const task of state.tasks.values()) {
    if (task.parentId === taskId) return true;
  }
  return false;
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function KeyboardPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let containerEl: HTMLElement | null = null;
  let unsubRender: (() => void) | null = null;

  function handleKeydown(e: KeyboardEvent): void {
    if (!host) return;

    const state = host.getState();
    const { flatVisibleIds } = state;
    const selectedId = getSelectedTaskId(state);

    switch (e.key) {
      // ── Arrow Up: select previous visible task ────────────────────────
      case 'ArrowUp': {
        e.preventDefault();
        if (flatVisibleIds.length === 0) return;

        if (!selectedId) {
          // Nothing selected — select the first task
          host.dispatch({ type: 'SELECT_TASK', taskId: flatVisibleIds[0] });
        } else {
          const idx = flatVisibleIds.indexOf(selectedId);
          if (idx > 0) {
            host.dispatch({ type: 'SELECT_TASK', taskId: flatVisibleIds[idx - 1] });
          }
        }
        break;
      }

      // ── Arrow Down: select next visible task ──────────────────────────
      case 'ArrowDown': {
        e.preventDefault();
        if (flatVisibleIds.length === 0) return;

        if (!selectedId) {
          host.dispatch({ type: 'SELECT_TASK', taskId: flatVisibleIds[0] });
        } else {
          const idx = flatVisibleIds.indexOf(selectedId);
          if (idx < flatVisibleIds.length - 1) {
            host.dispatch({ type: 'SELECT_TASK', taskId: flatVisibleIds[idx + 1] });
          }
        }
        break;
      }

      // ── Arrow Right: expand selected task, or scroll right ────────────
      case 'ArrowRight': {
        if (!selectedId) {
          // No selection — scroll right
          const scrollStep = host.getTimeScale().getColumnWidth();
          host.dispatch({ type: 'SET_SCROLL_X', x: state.scrollX + scrollStep });
        } else if (hasChildren(selectedId, state)) {
          if (!state.expandedIds.has(selectedId)) {
            e.preventDefault();
            host.dispatch({ type: 'TOGGLE_EXPAND', taskId: selectedId });
          } else {
            // Already expanded — scroll right
            const scrollStep = host.getTimeScale().getColumnWidth();
            host.dispatch({ type: 'SET_SCROLL_X', x: state.scrollX + scrollStep });
          }
        } else {
          const scrollStep = host.getTimeScale().getColumnWidth();
          host.dispatch({ type: 'SET_SCROLL_X', x: state.scrollX + scrollStep });
        }
        break;
      }

      // ── Arrow Left: collapse selected task, or scroll left ────────────
      case 'ArrowLeft': {
        if (!selectedId) {
          const scrollStep = host.getTimeScale().getColumnWidth();
          host.dispatch({ type: 'SET_SCROLL_X', x: Math.max(0, state.scrollX - scrollStep) });
        } else if (hasChildren(selectedId, state)) {
          if (state.expandedIds.has(selectedId)) {
            e.preventDefault();
            host.dispatch({ type: 'TOGGLE_EXPAND', taskId: selectedId });
          } else {
            const scrollStep = host.getTimeScale().getColumnWidth();
            host.dispatch({ type: 'SET_SCROLL_X', x: Math.max(0, state.scrollX - scrollStep) });
          }
        } else {
          const scrollStep = host.getTimeScale().getColumnWidth();
          host.dispatch({ type: 'SET_SCROLL_X', x: Math.max(0, state.scrollX - scrollStep) });
        }
        break;
      }

      // ── Enter: emit taskDblClick on selected task ─────────────────────
      case 'Enter': {
        if (!selectedId) return;
        e.preventDefault();
        const task = state.tasks.get(selectedId);
        if (task && containerEl) {
          // Emit a custom DOM event so consumers can listen for keyboard-driven
          // task activation. The NimbusGantt orchestrator also wires onTaskDblClick
          // via the EventBus, so consumers can listen on either channel.
          const customEvent = new CustomEvent('nimbus-gantt:taskDblClick', {
            detail: task,
            bubbles: true,
          });
          containerEl.dispatchEvent(customEvent);
        }
        break;
      }

      // ── Escape: deselect all ──────────────────────────────────────────
      case 'Escape': {
        e.preventDefault();
        host.dispatch({ type: 'DESELECT_ALL' });
        break;
      }

      // ── Delete / Backspace: emit taskDelete event ─────────────────────
      case 'Delete':
      case 'Backspace': {
        if (!selectedId) return;
        // Don't intercept if the user is typing in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        e.preventDefault();
        const task = state.tasks.get(selectedId);
        if (task && containerEl) {
          const customEvent = new CustomEvent('nimbus-gantt:taskDelete', {
            detail: task,
            bubbles: true,
          });
          containerEl.dispatchEvent(customEvent);
        }
        break;
      }

      // ── Home: scroll to first task ────────────────────────────────────
      case 'Home': {
        e.preventDefault();
        host.dispatch({ type: 'SET_SCROLL', x: 0, y: 0 });
        if (flatVisibleIds.length > 0) {
          host.dispatch({ type: 'SELECT_TASK', taskId: flatVisibleIds[0] });
        }
        break;
      }

      // ── End: scroll to last task ──────────────────────────────────────
      case 'End': {
        e.preventDefault();
        if (flatVisibleIds.length > 0) {
          const lastId = flatVisibleIds[flatVisibleIds.length - 1];
          const lastRowY = (flatVisibleIds.length - 1) * state.config.rowHeight;
          host.dispatch({ type: 'SET_SCROLL_Y', y: Math.max(0, lastRowY - state.config.rowHeight * 2) });
          host.dispatch({ type: 'SELECT_TASK', taskId: lastId });
        }
        break;
      }

      // ── +/= : zoom in (finer granularity) ────────────────────────────
      case '+':
      case '=': {
        e.preventDefault();
        const currentIdx = ZOOM_ORDER.indexOf(state.zoomLevel);
        if (currentIdx > 0) {
          host.dispatch({ type: 'SET_ZOOM', level: ZOOM_ORDER[currentIdx - 1] });
        }
        break;
      }

      // ── - : zoom out (coarser granularity) ────────────────────────────
      case '-': {
        // Don't intercept Ctrl+- (browser zoom)
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const currentIdx = ZOOM_ORDER.indexOf(state.zoomLevel);
        if (currentIdx < ZOOM_ORDER.length - 1) {
          host.dispatch({ type: 'SET_ZOOM', level: ZOOM_ORDER[currentIdx + 1] });
        }
        break;
      }

      // ── Space: toggle expand/collapse of selected task ────────────────
      case ' ': {
        if (!selectedId) return;
        // Don't intercept if the user is in an input
        const tgt = e.target as HTMLElement;
        if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'BUTTON') return;

        if (hasChildren(selectedId, state)) {
          e.preventDefault();
          host.dispatch({ type: 'TOGGLE_EXPAND', taskId: selectedId });
        }
        break;
      }

      default:
        // No-op for unhandled keys
        break;
    }
  }

  return {
    name: 'KeyboardPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Attach keyboard listener after the first render so the DOM exists.
      unsubRender = gantt.on('render', () => {
        if (containerEl) return; // Already attached

        const rootEl = document.querySelector('.nimbus-gantt');
        if (!rootEl) return;

        containerEl = rootEl.parentElement ?? (rootEl as HTMLElement);

        // Make the container focusable
        if (!containerEl.getAttribute('tabindex')) {
          containerEl.setAttribute('tabindex', '0');
        }

        keydownHandler = handleKeydown;
        containerEl.addEventListener('keydown', keydownHandler);
      });
    },

    destroy(): void {
      if (keydownHandler && containerEl) {
        containerEl.removeEventListener('keydown', keydownHandler);
      }
      if (unsubRender) {
        unsubRender();
      }
      host = null;
      containerEl = null;
      keydownHandler = null;
    },
  };
}
