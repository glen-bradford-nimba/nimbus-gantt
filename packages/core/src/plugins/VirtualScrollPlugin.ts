// ─── Virtual Scroll Plugin ──────────────────────────────────────────────────
// Enables rendering of 1000+ tasks at 60fps by computing the visible row
// range and exposing it for both Canvas and DOM renderers. Only tasks within
// the viewport (plus a configurable buffer) are laid out and rendered.
//
// Key insight: the plugin does NOT intercept rendering directly. Instead, it
// provides a utility that the orchestrator and renderers can query to
// determine which task IDs and layouts should actually be processed.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
  Action,
} from '../model/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface VisibleRange {
  /** First visible row index (inclusive, after buffer) */
  startRow: number;
  /** Last visible row index (exclusive, after buffer) */
  endRow: number;
  /** Total number of rows in the dataset */
  totalRows: number;
  /** Set of task IDs that should be rendered */
  visibleTaskIds: Set<string>;
}

export interface VirtualScrollAPI {
  /**
   * Get the current visible range based on scroll position and viewport.
   * Call this from the render loop to determine which tasks to process.
   */
  getVisibleRange(): VisibleRange;

  /**
   * Filter a full layouts array down to only the visible layouts.
   * This is the primary optimization entry point.
   */
  filterLayouts(layouts: TaskLayout[]): TaskLayout[];

  /**
   * Check if a specific task ID is in the visible range.
   */
  isVisible(taskId: string): boolean;

  /**
   * Get the total scrollable content height in pixels.
   */
  getContentHeight(): number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_BUFFER = 5;                // Rows above/below viewport
const VELOCITY_SAMPLE_COUNT = 5;         // Number of scroll samples for velocity
const VELOCITY_PREDICTION_FACTOR = 0.3;  // How far ahead to predict (in seconds)
const VELOCITY_BUFFER_MAX = 15;          // Max extra rows from velocity prediction

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function VirtualScrollPlugin(): NimbusGanttPlugin {
  let host: PluginHost;
  let cachedRange: VisibleRange | null = null;
  let lastScrollY = 0;
  let scrollVelocity = 0;
  const scrollSamples: Array<{ y: number; time: number }> = [];

  /** Compute visible range from current state */
  function computeVisibleRange(state: GanttState): VisibleRange {
    const { rowHeight, headerHeight } = state.config;
    const scrollY = state.scrollY;
    const totalRows = state.flatVisibleIds.length;

    // Estimate viewport height from the canvas element
    // Since we don't have direct access, use a reasonable calculation:
    // The orchestrator sets the timeline panel to fill available space.
    // We can estimate from the scroll + total content relationship,
    // but for robustness, we use a cached viewport height or fallback.
    const viewportHeight = getViewportHeight(state);

    // Core calculation: which rows are visible?
    const rawStartRow = Math.floor(scrollY / rowHeight);
    const rawEndRow = Math.ceil((scrollY + viewportHeight) / rowHeight);

    // Apply static buffer
    let startRow = Math.max(0, rawStartRow - DEFAULT_BUFFER);
    let endRow = Math.min(totalRows, rawEndRow + DEFAULT_BUFFER);

    // Apply velocity-based predictive buffer
    if (Math.abs(scrollVelocity) > 0) {
      const predictedRows = Math.min(
        VELOCITY_BUFFER_MAX,
        Math.ceil(Math.abs(scrollVelocity * VELOCITY_PREDICTION_FACTOR) / rowHeight),
      );

      if (scrollVelocity > 0) {
        // Scrolling down: extend end buffer
        endRow = Math.min(totalRows, endRow + predictedRows);
      } else {
        // Scrolling up: extend start buffer
        startRow = Math.max(0, startRow - predictedRows);
      }
    }

    // Build the set of visible task IDs
    const visibleTaskIds = new Set<string>();
    for (let i = startRow; i < endRow && i < state.flatVisibleIds.length; i++) {
      visibleTaskIds.add(state.flatVisibleIds[i]);
    }

    return {
      startRow,
      endRow,
      totalRows,
      visibleTaskIds,
    };
  }

  /** Estimate viewport height from state */
  function getViewportHeight(state: GanttState): number {
    // The viewport height is typically available through the DOM,
    // but since we're a pure-logic plugin, we estimate it.
    // A common heuristic: total content height minus the portion scrolled
    // gives us the remaining, but we need the actual viewport.
    // We'll track this from the host if available, otherwise use a
    // generous default that covers most screens.
    const totalContentHeight = state.flatVisibleIds.length * state.config.rowHeight;
    const maxViewport = totalContentHeight - state.scrollY;

    // Reasonable viewport estimate: 800px or remaining content, whichever is smaller.
    // In practice, the orchestrator should provide this, but the plugin
    // works well enough with an estimate since the buffer handles edge cases.
    return Math.min(800, Math.max(maxViewport, 200));
  }

  /** Update scroll velocity tracking */
  function updateScrollVelocity(scrollY: number): void {
    const now = performance.now();
    scrollSamples.push({ y: scrollY, time: now });

    // Keep only recent samples
    while (scrollSamples.length > VELOCITY_SAMPLE_COUNT) {
      scrollSamples.shift();
    }

    // Compute velocity from samples (pixels per second)
    if (scrollSamples.length >= 2) {
      const oldest = scrollSamples[0];
      const newest = scrollSamples[scrollSamples.length - 1];
      const dt = (newest.time - oldest.time) / 1000; // seconds

      if (dt > 0) {
        scrollVelocity = (newest.y - oldest.y) / dt;
      }
    }

    lastScrollY = scrollY;
  }

  // ── Public API that the orchestrator can access ────────────────────────

  const api: VirtualScrollAPI = {
    getVisibleRange(): VisibleRange {
      if (!host) {
        return { startRow: 0, endRow: 0, totalRows: 0, visibleTaskIds: new Set() };
      }

      const state = host.getState();
      // Cache invalidation: recompute if scroll changed
      if (!cachedRange || state.scrollY !== lastScrollY) {
        updateScrollVelocity(state.scrollY);
        cachedRange = computeVisibleRange(state);
      }

      return cachedRange;
    },

    filterLayouts(layouts: TaskLayout[]): TaskLayout[] {
      const range = api.getVisibleRange();
      if (range.totalRows === 0) return [];

      return layouts.filter(layout => range.visibleTaskIds.has(layout.taskId));
    },

    isVisible(taskId: string): boolean {
      const range = api.getVisibleRange();
      return range.visibleTaskIds.has(taskId);
    },

    getContentHeight(): number {
      if (!host) return 0;
      const state = host.getState();
      return state.flatVisibleIds.length * state.config.rowHeight + state.config.headerHeight;
    },
  };

  return {
    name: 'VirtualScrollPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
    },

    middleware(action: Action, next: (action: Action) => void): void {
      next(action);

      // Invalidate cache on any action that changes row count or scroll position
      const invalidatingActions: Action['type'][] = [
        'SET_DATA',
        'SET_SCROLL',
        'SET_SCROLL_Y',
        'ADD_TASK',
        'REMOVE_TASK',
        'TOGGLE_EXPAND',
        'EXPAND_ALL',
        'COLLAPSE_ALL',
      ];

      if (invalidatingActions.includes(action.type)) {
        cachedRange = null;

        if (action.type === 'SET_SCROLL' || action.type === 'SET_SCROLL_Y') {
          const state = host.getState();
          updateScrollVelocity(state.scrollY);
        }
      }
    },

    destroy(): void {
      cachedRange = null;
      scrollSamples.length = 0;
      scrollVelocity = 0;
    },

    // ── Expose the API on the plugin instance ────────────────────────
    // Consumers access it via: const plugin = VirtualScrollPlugin();
    // gantt.use(plugin); then plugin.api.filterLayouts(...)
    ...({ api } as { api: VirtualScrollAPI }),
  } as NimbusGanttPlugin & { api: VirtualScrollAPI };
}

// ─── Re-export types for consumers ─────────────────────────────────────────

export type { VirtualScrollAPI as VirtualScrollPluginAPI };
