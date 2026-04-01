// ─── Telemetry Plugin ──────────────────────────────────────────────────────
// Optional, opt-in usage analytics. Tracks user interactions with the Gantt
// chart and batches them for reporting to an endpoint or local callback.
// Never tracks anything unless the consumer explicitly installs this plugin.

import type {
  NimbusGanttPlugin,
  PluginHost,
  Action,
  GanttState,
  TaskLayout,
} from '../model/types';

// ─── Types ────────────────────────────────────────────────────────────────

export interface TelemetryEvent {
  type: string;
  timestamp: number;
  sessionId: string;
  userId: string;
  data?: Record<string, unknown>;
}

interface TelemetryOptions {
  /** POST endpoint for analytics events. */
  endpoint?: string;
  /** Anonymous user identifier. Defaults to 'anonymous'. */
  userId?: string;
  /** Milliseconds between batch sends. Default: 30000 (30s). */
  batchInterval?: number;
  /** Local callback invoked for each event (instead of or in addition to endpoint). */
  onEvent?: (event: TelemetryEvent) => void;
}

// ─── UUID v4 Generator (LWS-compatible, no crypto.randomUUID) ────────────

function generateUUID(): string {
  // RFC 4122 v4 UUID using Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Scroll Debounce ─────────────────────────────────────────────────────

function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

// ─── Plugin Factory ─────────────────────────────────────────────────────

export function TelemetryPlugin(options: TelemetryOptions): NimbusGanttPlugin {
  const endpoint = options.endpoint;
  const userId = options.userId ?? 'anonymous';
  const batchInterval = options.batchInterval ?? 30000;
  const onEvent = options.onEvent;

  const sessionId = generateUUID();
  const eventQueue: TelemetryEvent[] = [];
  const sessionStartTime = Date.now();

  let host: PluginHost | null = null;
  let batchTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  // Track registered plugin names (set during install)
  let pluginNames: string[] = [];

  // Unsubscribe handles
  const unsubscribers: (() => void)[] = [];

  // ── Event tracking ─────────────────────────────────────────────────────

  function track(type: string, data?: Record<string, unknown>): void {
    if (destroyed) return;

    const event: TelemetryEvent = {
      type,
      timestamp: Date.now(),
      sessionId,
      userId,
      data,
    };

    eventQueue.push(event);

    // Always call local callback if provided
    if (onEvent) {
      onEvent(event);
    }
  }

  // ── Batch sending ──────────────────────────────────────────────────────

  function flushEvents(): void {
    if (eventQueue.length === 0) return;
    if (!endpoint) {
      // No endpoint — events are only for local callback, clear the queue
      eventQueue.length = 0;
      return;
    }

    const batch = eventQueue.splice(0, eventQueue.length);

    try {
      // Use keepalive for final flush on destroy (e.g. page unload)
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive: true,
      }).catch(() => {
        // Silently swallow network errors — telemetry should never break the app
      });
    } catch {
      // Silently swallow errors
    }
  }

  function startBatchTimer(): void {
    if (batchTimer !== null) return;
    batchTimer = setInterval(() => {
      flushEvents();
    }, batchInterval);
  }

  function stopBatchTimer(): void {
    if (batchTimer !== null) {
      clearInterval(batchTimer);
      batchTimer = null;
    }
  }

  // ── Scroll tracking (debounced to 1s) ─────────────────────────────────

  let lastScrollX = 0;
  let lastScrollY = 0;

  const trackScroll = debounce(() => {
    if (!host) return;
    const state = host.getState();
    track('gantt.scroll', {
      scrollX: state.scrollX,
      scrollY: state.scrollY,
    });
    lastScrollX = state.scrollX;
    lastScrollY = state.scrollY;
  }, 1000);

  // ── Drag timing ────────────────────────────────────────────────────────

  let dragStartTime = 0;

  // ── Middleware ──────────────────────────────────────────────────────────

  function middleware(action: Action, next: (action: Action) => void): void {
    switch (action.type) {
      case 'SET_ZOOM': {
        const oldLevel = host ? host.getState().zoomLevel : 'unknown';
        next(action);
        track('gantt.zoom', {
          oldLevel,
          newLevel: action.level,
        });
        return;
      }

      case 'TASK_MOVE': {
        const dragDuration = dragStartTime > 0 ? Date.now() - dragStartTime : 0;
        next(action);
        track('gantt.task.move', {
          taskId: action.taskId,
          startDate: action.startDate,
          endDate: action.endDate,
          dragDurationMs: dragDuration,
        });
        dragStartTime = 0;
        return;
      }

      case 'TASK_RESIZE': {
        next(action);
        track('gantt.task.resize', {
          taskId: action.taskId,
          startDate: action.startDate,
          endDate: action.endDate,
        });
        return;
      }

      case 'DRAG_START': {
        dragStartTime = Date.now();
        next(action);
        return;
      }

      case 'SELECT_TASK': {
        next(action);
        track('gantt.task.click', {
          taskId: action.taskId,
          multi: action.multi ?? false,
        });
        return;
      }

      case 'SET_SCROLL':
      case 'SET_SCROLL_X':
      case 'SET_SCROLL_Y': {
        next(action);
        trackScroll();
        return;
      }

      case 'TOGGLE_EXPAND': {
        const wasExpanded = host
          ? host.getState().expandedIds.has(action.taskId)
          : false;
        next(action);
        track(wasExpanded ? 'gantt.collapse' : 'gantt.expand', {
          taskId: action.taskId,
        });
        return;
      }

      case 'EXPAND_ALL': {
        next(action);
        track('gantt.expand', { all: true });
        return;
      }

      case 'COLLAPSE_ALL': {
        next(action);
        track('gantt.collapse', { all: true });
        return;
      }

      default:
        next(action);
        return;
    }
  }

  return {
    name: 'TelemetryPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Start batch timer
      startBatchTimer();

      // Track initialization
      const state = gantt.getState();
      track('gantt.init', {
        taskCount: state.tasks.size,
        dependencyCount: state.dependencies.size,
        zoomLevel: state.zoomLevel,
      });

      // Track which plugins are registered (deferred until after all plugins are installed)
      // We use a setTimeout to let other plugins register first
      setTimeout(() => {
        if (destroyed) return;
        track('gantt.feature.used', {
          plugins: pluginNames,
        });
      }, 0);

      // Subscribe to task click events via event bus
      const unsubClick = gantt.on('taskClick', (...args: unknown[]) => {
        const task = args[0] as { id: string } | undefined;
        if (task) {
          track('gantt.task.click', { taskId: task.id });
        }
      });
      unsubscribers.push(unsubClick);
    },

    middleware,

    destroy(): void {
      destroyed = true;

      // Track session duration
      const sessionDuration = Date.now() - sessionStartTime;
      track('gantt.session.duration', {
        durationMs: sessionDuration,
        durationMinutes: Math.round(sessionDuration / 60000 * 10) / 10,
      });

      // Flush remaining events immediately
      flushEvents();

      // Stop batch timer
      stopBatchTimer();

      // Clean up subscriptions
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;

      host = null;
    },
  };
}
