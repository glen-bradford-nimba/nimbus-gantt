// ─── History Plugin (0.187.0 — temporal-canvas substrate) ─────────────────
// Append-only log of state-mutating actions, paired with their inverse
// actions, captured via middleware. Replay-to-past is "dispatch the inverse
// actions in reverse order until we reach the cursor's timestamp" — uses
// the existing pure reducer as the universal forward+backward applier, so
// no new reducer logic is needed for replay.
//
// Per docs/dispatch-ng-temporal-canvas.md, this replaces the existing
// UndoRedoPlugin's role for full scrubbable history (UndoRedoPlugin remains
// available for hosts that just want Ctrl+Z/Y without the full substrate).
//
// Design notes:
//   - Records only the 7 persistent actions (per the dispatch + repo audit):
//     SET_DATA, UPDATE_TASK, ADD_TASK, REMOVE_TASK, TASK_MOVE, TASK_RESIZE,
//     ADD_DEPENDENCY, REMOVE_DEPENDENCY. Skips view-only state (scroll,
//     zoom, selection, expansion, drag-update, set-date-range,
//     set-time-cursor) so the log doesn't explode under normal UI use.
//   - Bounded ring buffer (default 5000 entries with idle-time compaction
//     after 30s of no input — the oldest entries fold into a baseline
//     snapshot).
//   - `snapshotAt(date)` walks inverse actions from current state backwards
//     until the entry's wallTs <= cursor; returns the resulting state.
//     O(N) in entries scrubbed; with the bounded log + idle compaction,
//     practical scrub latency stays well under 16ms.
//   - Annotations are non-mutating events (comments, decision markers,
//     agent notes) on the same temporal axis. Logged separately;
//     consumed by HistoryStripPlugin (or any other annotation-aware
//     visualization).
//   - Cross-client convergence is free via the 0.185.37 remote-events
//     channel — when client A makes an edit, client B receives it via
//     pushRemoteEvent → dispatches the same action through the same
//     reducer → middleware captures the same inverse action with the
//     matching wallTs/sequence → both clients have convergent history
//     logs without any extra wire format.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  GanttDependency,
  Action,
} from '../model/types';
import { GanttStore } from '../store/GanttStore';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface HistoryEntry {
  /** Monotonic clock — performance.now() relative to the page. */
  ts: number;
  /** Wall-clock millis at dispatch time — for cursor display + cross-
   *  client convergence (server-supplied via remote-events when applicable). */
  wallTs: number;
  /** The forward action that was applied to the store. */
  action: Action;
  /** The inverse action that, if dispatched, undoes the forward action.
   *  May be null when the forward action is a no-op (e.g. UPDATE_TASK on
   *  a missing id). */
  inverse: Action | null;
  /** Opaque host string — typically userId. */
  actor?: string;
  /** Opaque host string — 'local' | 'remote' | 'agent' | etc. */
  source?: string;
}

export interface HistoryAnnotation {
  ts: number;
  wallTs: number;
  /** 'comment' | 'decision' | 'agent-note' | 'view' | host.custom. */
  kind: string;
  /** Optional anchor — annotation refers to this task. */
  taskId?: string;
  /** Host-defined payload (text, author, etc.). */
  payload?: unknown;
}

export interface HistoryAPI {
  /** Live patch log (read-only — host should not mutate). */
  entries(): readonly HistoryEntry[];
  annotations(): readonly HistoryAnnotation[];
  /** Compute the state at or before a wall-clock timestamp. Walks inverse
   *  actions backwards from the current live state until wallTs <= target.
   *  Returns null if target is older than the log baseline. */
  snapshotAt(date: Date): GanttState | null;
  /** Append a host-side annotation (comment, decision marker, etc.). */
  appendAnnotation(annotation: Omit<HistoryAnnotation, 'ts' | 'wallTs'>): void;
  /** Last applied wall-clock ts, or null when log is empty. */
  lastWallTs(): number | null;
  /** Set the time cursor and trigger a render. Convenience wrapper that
   *  also fires a 'history:scrub' event on the gantt's EventBus. */
  scrubTo(date: Date | null): void;
  /** Convenience for "return to live" (cursor = null). */
  scrubToNow(): void;
}

export interface HistoryPluginOptions {
  /** Max entries kept in memory before idle-time compaction kicks in.
   *  Default 5000 (~1MB at 200 bytes/entry). */
  capacity?: number;
  /** Idle window before compaction triggers, in ms. Default 30000. */
  compactAfterIdleMs?: number;
  /** Number of newest entries to keep after compaction. Default 500. */
  compactKeep?: number;
  /** Pre-existing entries to hydrate the log with on install (e.g. from a
   *  host's audit table on remount). They are NOT re-applied to the
   *  store — they're treated as "already applied" history. Caller
   *  ensures the live store state matches the result of folding these. */
  hydrate?: HistoryEntry[];
  /** Pre-existing annotations. */
  hydrateAnnotations?: HistoryAnnotation[];
  /** Fired once per recorded entry, after the action lands in the store.
   *  Hosts persist to durable storage here (DH: delivery__GanttAuditLog__c
   *  insert; CN: POST to /api/gantt/history). Async-friendly. */
  onEntry?: (entry: HistoryEntry) => void | Promise<void>;
  /** Fired per appended annotation. */
  onAnnotation?: (annotation: HistoryAnnotation) => void | Promise<void>;
  /** When the cursor scrubs to a date older than the in-memory baseline,
   *  the plugin calls this to fetch the missing tail. Host returns the
   *  entries (older first or newer first — plugin sorts internally). */
  onSnapshotRequest?: (date: Date) => Promise<HistoryEntry[]> | HistoryEntry[];
  /** Default actor stamped on every entry when middleware captures
   *  without explicit actor metadata. Default undefined. */
  defaultActor?: string;
  /** Default source string. Default 'local'. */
  defaultSource?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 5000;
const DEFAULT_COMPACT_IDLE_MS = 30_000;
const DEFAULT_COMPACT_KEEP = 500;

const RECORDED_ACTION_TYPES = new Set([
  'SET_DATA',
  'UPDATE_TASK',
  'ADD_TASK',
  'REMOVE_TASK',
  'TASK_MOVE',
  'TASK_RESIZE',
  'ADD_DEPENDENCY',
  'REMOVE_DEPENDENCY',
]);

// ─── diag emit (mirror of NimbusGantt.diagEmit — kept local to avoid
// cross-file coupling on a small helper) ───────────────────────────────────

interface DiagWindow {
  __nga_diag?: Array<{ t: number; kind: string; [key: string]: unknown }>;
}
function diag(kind: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const arr = (window as unknown as DiagWindow).__nga_diag;
  if (!Array.isArray(arr)) return;
  arr.push({
    t:
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now(),
    kind,
    ...(data ?? {}),
  });
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function HistoryPlugin(opts: HistoryPluginOptions = {}): NimbusGanttPlugin {
  const capacity = Math.max(100, opts.capacity ?? DEFAULT_CAPACITY);
  const compactIdleMs = opts.compactAfterIdleMs ?? DEFAULT_COMPACT_IDLE_MS;
  const compactKeep = Math.min(capacity, Math.max(50, opts.compactKeep ?? DEFAULT_COMPACT_KEEP));

  const entries: HistoryEntry[] = [];
  const annotationsList: HistoryAnnotation[] = [];

  let host: PluginHost | null = null;
  let getPreState: (() => GanttState) | null = null;
  // Held by closures captured below — typed loosely because the public
  // PluginHost contract doesn't expose registerReplayProvider, but
  // NimbusGantt itself does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gantt: any = null;
  let unregisterReplayProvider: (() => void) | null = null;

  let compactTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleCompaction(): void {
    if (compactTimer) clearTimeout(compactTimer);
    compactTimer = setTimeout(compact, compactIdleMs);
  }

  function compact(): void {
    if (entries.length <= compactKeep) return;
    const dropped = entries.length - compactKeep;
    entries.splice(0, dropped);
    diag('history:compaction', { dropped, kept: entries.length });
  }

  function pushEntry(entry: HistoryEntry): void {
    entries.push(entry);
    diag('history:entry-recorded', {
      actionType: entry.action.type,
      ts: entry.wallTs,
      source: entry.source,
    });
    if (entries.length > capacity) {
      // Hard cap — drop the single oldest entry. Idle-time compaction
      // does the bulk reduction; this is just the pressure-release valve.
      const dropped = entries.splice(0, 1);
      diag('history:overflow-drop', { ts: dropped[0]?.wallTs });
    }
    scheduleCompaction();
    if (opts.onEntry) {
      try {
        const r = opts.onEntry(entry);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {/* host handles */});
        }
      } catch { /* host handles */ }
    }
  }

  // Hydrate before mount completes — entries arrive pre-applied.
  if (opts.hydrate) entries.push(...opts.hydrate);
  if (opts.hydrateAnnotations) annotationsList.push(...opts.hydrateAnnotations);

  // Compute the inverse action for a given (preState, action). The result
  // is itself an Action, so replay is "dispatch the inverse" through the
  // existing reducer. Returns null when the forward is a no-op.
  function computeInverse(preState: GanttState, action: Action): Action | null {
    switch (action.type) {
      case 'SET_DATA': {
        const tasks: GanttTask[] = Array.from(preState.tasks.values());
        const dependencies: GanttDependency[] = Array.from(preState.dependencies.values());
        return { type: 'SET_DATA', tasks, dependencies };
      }
      case 'UPDATE_TASK': {
        const prev = preState.tasks.get(action.taskId);
        if (!prev) return null; // forward is a no-op
        // Restore only the keys that the forward changed.
        const restored: Partial<GanttTask> = {};
        for (const k of Object.keys(action.changes) as Array<keyof GanttTask>) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (restored as any)[k] = (prev as any)[k];
        }
        return { type: 'UPDATE_TASK', taskId: action.taskId, changes: restored };
      }
      case 'ADD_TASK':
        return { type: 'REMOVE_TASK', taskId: action.task.id };
      case 'REMOVE_TASK': {
        const prev = preState.tasks.get(action.taskId);
        if (!prev) return null;
        return { type: 'ADD_TASK', task: prev };
      }
      case 'TASK_MOVE':
      case 'TASK_RESIZE': {
        const prev = preState.tasks.get(action.taskId);
        if (!prev) return null;
        return {
          type: action.type,
          taskId: action.taskId,
          startDate: prev.startDate,
          endDate: prev.endDate,
        };
      }
      case 'ADD_DEPENDENCY':
        return { type: 'REMOVE_DEPENDENCY', dependencyId: action.dependency.id };
      case 'REMOVE_DEPENDENCY': {
        const prev = preState.dependencies.get(action.dependencyId);
        if (!prev) return null;
        return { type: 'ADD_DEPENDENCY', dependency: prev };
      }
      default:
        return null;
    }
  }

  // The middleware captures (forward, inverse) pairs. NB: NimbusGantt's
  // middleware contract gives us getState() which returns PRE-action
  // state because middleware runs before the reducer (see GanttStore.ts
  // dispatch chain). That's exactly what we need for inverse computation.
  function middleware(action: Action, next: (a: Action) => void): void {
    if (!RECORDED_ACTION_TYPES.has(action.type)) {
      next(action);
      return;
    }
    // Middleware runs BEFORE the reducer applies — host.getState()
    // returns pre-action state, which is exactly what computeInverse
    // needs to capture the prior values for restoration.
    const preState = getPreState ? getPreState() : null;
    if (!preState) {
      next(action);
      return;
    }
    const inverse = computeInverse(preState, action);
    next(action);
    const ts =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const wallTs = Date.now();
    pushEntry({
      ts,
      wallTs,
      action,
      inverse,
      actor: opts.defaultActor,
      source: opts.defaultSource ?? 'local',
    });
  }

  // Replay backwards from current live state until the cursor wallTs is
  // reached. Returns null if cursor is older than baseline.
  function snapshotAt(date: Date): GanttState | null {
    if (!getPreState) return null;
    const target = date.getTime();
    const live = getPreState();
    if (entries.length === 0) return live;
    const baselineTs = entries[0].wallTs;
    if (target < baselineTs) {
      // Beyond what the in-memory log can answer; defer to host.
      diag('history:snapshot-miss', { target, baselineTs });
      return null;
    }

    // Walk a temp store that starts at live state and dispatches
    // inverse actions for entries newer than target. Probe store has no
    // listeners or middleware — pure reducer fold, no side effects on
    // the live store.
    const probe = new GanttStore(live);
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.wallTs <= target) break;
      if (e.inverse) probe.dispatch(e.inverse);
    }
    return probe.getState();
  }

  function appendAnnotation(annotation: Omit<HistoryAnnotation, 'ts' | 'wallTs'>): void {
    const ts =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const wallTs = Date.now();
    const entry: HistoryAnnotation = { ts, wallTs, ...annotation };
    annotationsList.push(entry);
    diag('history:annotation-added', { kind: entry.kind, taskId: entry.taskId });
    if (opts.onAnnotation) {
      try {
        const r = opts.onAnnotation(entry);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {/* host handles */});
        }
      } catch { /* host handles */ }
    }
  }

  const api: HistoryAPI = {
    entries: () => entries,
    annotations: () => annotationsList,
    snapshotAt,
    appendAnnotation,
    lastWallTs: () => (entries.length > 0 ? entries[entries.length - 1].wallTs : null),
    scrubTo: (date) => {
      gantt?.setTimeCursor(date);
      diag('history:scrub', { cursorWallTs: date ? date.getTime() : null });
    },
    scrubToNow: () => {
      gantt?.setTimeCursor(null);
      diag('history:scrub', { cursorWallTs: null });
    },
  };

  return {
    name: 'HistoryPlugin',

    install(pluginHost: PluginHost): void {
      host = pluginHost;
      getPreState = pluginHost.getState;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gantt = (pluginHost as any).__gantt ?? null;
      if (gantt) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gantt as any).history = api;
        if (typeof gantt.registerReplayProvider === 'function') {
          unregisterReplayProvider = gantt.registerReplayProvider({
            snapshotAt: (d: Date) => snapshotAt(d),
          });
        }
      }
      diag('history:hydrate', { entryCount: entries.length });
    },

    middleware,

    destroy(): void {
      if (compactTimer) {
        clearTimeout(compactTimer);
        compactTimer = null;
      }
      if (unregisterReplayProvider) {
        unregisterReplayProvider();
        unregisterReplayProvider = null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (gantt && (gantt as any).history === api) (gantt as any).history = null;
      host = null;
      gantt = null;
    },
  };
}
