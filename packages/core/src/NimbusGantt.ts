// ─── NimbusGantt Orchestrator ────────────────────────────────────────────────
// The public API and main entry point for the Nimbus Gantt chart library.
// Wires together the store, layout engine, renderers, scroll manager, event
// bus, and plugin system into a single cohesive class.

import type {
  GanttConfig,
  GanttState,
  GanttTask,
  GanttDependency,
  ZoomLevel,
  TaskLayout,
  ResolvedConfig,
  NimbusGanttPlugin,
  PluginHost,
  Action,
  RemoteEvent,
} from './model/types';
import { buildTree, computeDateRange } from './model/TaskTree';
import { GanttStore, translateRemoteEvent, type Middleware } from './store/GanttStore';
import { EventBus } from './events/EventBus';
import { TimeScale } from './layout/TimeScale';
import { LayoutEngine } from './layout/LayoutEngine';
import { CanvasRenderer } from './render/CanvasRenderer';
import { DomTreeGrid } from './render/DomTreeGrid';
import { ScrollManager } from './interaction/ScrollManager';
import { DragManager } from './interaction/DragManager';
import { DependencyRenderer } from './render/DependencyRenderer';
import { TooltipManager } from './render/TooltipManager';
import { resolveConfig } from './theme/themes';

// ─── Diagnostic emitter (0.185.37 — remote-events) ──────────────────────────
// Lightweight side-channel emitter for Cowork verification. Writes to
// `window.__nga_diag` array when the app-layer diag system has initialized
// it (controlled by `localStorage.NGA_DIAG === '1'`, `window.NGA_DIAG === true`,
// or `?nga_diag=1` query — see packages/app/src/diag.ts). Core does NOT
// import from app, so this is a structural side-channel: when diag is off,
// `__nga_diag` is undefined and we early-return at zero cost.

interface DiagWindow {
  __nga_diag?: Array<{ t: number; kind: string; [key: string]: unknown }>;
  NGA_DIAG_VERBOSE?: boolean;
}

function diagEmit(kind: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as DiagWindow;
  const arr = w.__nga_diag;
  if (!Array.isArray(arr)) return;
  const t =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const evt = { t, kind, ...(data ?? {}) };
  arr.push(evt);
  if (w.NGA_DIAG_VERBOSE === true) {
    try {
      // eslint-disable-next-line no-console
      console.log('[nga-diag]', kind, data ?? {});
    } catch { /* console may throw under exotic sandboxes */ }
  }
}

// ─── CSS Injection ────────────────────────────────────────────────────────

const STYLE_ID = 'nimbus-gantt-root-styles';

function injectRootStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .nimbus-gantt {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      position: relative;
      font-family: var(--ng-font-family);
    }
    .ng-grid-panel {
      flex-shrink: 0;
      overflow: hidden;
      border-right: 1px solid var(--ng-border-color);
    }
    .ng-timeline-panel {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
  `;
  document.head.appendChild(style);
}

// ─── NimbusGantt ──────────────────────────────────────────────────────────

export class NimbusGantt {
  private container: HTMLElement;
  private config: ResolvedConfig;
  private rootEl: HTMLElement;
  private gridPanel: HTMLElement;
  private timelinePanel: HTMLElement;

  private store: GanttStore;
  private eventBus: EventBus;
  private layoutEngine: LayoutEngine;
  private timeScale!: TimeScale;
  private canvasRenderer: CanvasRenderer;
  private treeGrid: DomTreeGrid;
  private scrollManager: ScrollManager;
  private dragManager: DragManager | null = null;
  private dependencyRenderer: DependencyRenderer;
  private tooltipManager: TooltipManager;

  private plugins: NimbusGanttPlugin[] = [];
  private pluginMiddlewares: Middleware[] = [];
  private layouts: TaskLayout[] = [];

  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeStore: () => void;

  private renderScheduled = false;
  private destroyed = false;

  // 0.185.37 — remote-events channel. Per-task last-applied wall-clock ts
  // for stale-drop on out-of-order delivery. Per-id (rather than per-channel)
  // is smarter: different tasks have independent edit timelines, so a stale
  // event on task X shouldn't depend on the freshest event for task Y.
  // bulk.replace clears the entire map (host signaled snapshot reload).
  // 0.185.38 layers per-channel sequence checkpoints on top of this for
  // reconnect cursors.
  private lastAppliedTs = new Map<string, number>();

  constructor(container: HTMLElement, config: GanttConfig) {
    this.container = container;

    // 1. Resolve config
    this.config = resolveConfig(config);

    // 2. Inject root CSS
    injectRootStyles();

    // 3. Build root DOM structure
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'nimbus-gantt';
    this.rootEl.style.setProperty('--ng-font-family', this.config.theme.fontFamily);
    this.rootEl.style.setProperty('--ng-border-color', this.config.theme.gridBorderColor);

    this.gridPanel = document.createElement('div');
    this.gridPanel.className = 'ng-grid-panel';
    this.gridPanel.style.width =
      this.config.gridWidth > 0 ? `${this.config.gridWidth}px` : '0px';
    if (this.config.gridWidth === 0) {
      this.gridPanel.style.display = 'none';
    }

    this.timelinePanel = document.createElement('div');
    this.timelinePanel.className = 'ng-timeline-panel';

    this.rootEl.appendChild(this.gridPanel);
    this.rootEl.appendChild(this.timelinePanel);
    this.container.appendChild(this.rootEl);

    // 4. Build initial state
    const tasks = new Map<string, GanttTask>();
    for (const t of config.tasks) {
      tasks.set(t.id, t);
    }
    const dependencies = new Map<string, GanttDependency>();
    if (config.dependencies) {
      for (const d of config.dependencies) {
        dependencies.set(d.id, d);
      }
    }
    const expandedIds = new Set<string>();
    const { tree, flatIds } = buildTree(tasks, expandedIds);
    const dateRange = computeDateRange(tasks);

    const initialState: GanttState = {
      tasks,
      dependencies,
      tree,
      flatVisibleIds: flatIds,
      expandedIds,
      selectedIds: new Set<string>(),
      zoomLevel: this.config.zoomLevel,
      scrollX: 0,
      scrollY: 0,
      dateRange,
      dragState: null,
      config: this.config,
    };

    // 5. Create event bus
    this.eventBus = new EventBus();

    // 6. Create store
    this.store = new GanttStore(initialState);

    // 7. Create layout engine
    this.layoutEngine = new LayoutEngine();

    // 8. Create TimeScale
    this.timeScale = this.createTimeScale(initialState);

    // 9. Create CanvasRenderer
    this.canvasRenderer = new CanvasRenderer(this.timelinePanel);

    // 10. Create DomTreeGrid
    this.treeGrid = new DomTreeGrid(this.gridPanel);

    // 11. Create ScrollManager
    this.scrollManager = new ScrollManager(
      this.timelinePanel,
      (scrollX: number, scrollY: number) => {
        this.store.dispatch({ type: 'SET_SCROLL', x: scrollX, y: scrollY });
      },
    );

    // 12. Create DependencyRenderer
    this.dependencyRenderer = new DependencyRenderer();

    // 13. Create TooltipManager
    this.tooltipManager = new TooltipManager(this.timelinePanel, config.tooltipRenderer);

    // 14. Create DragManager (if not read-only)
    if (!this.config.readOnly) {
      const canvas = this.timelinePanel.querySelector('canvas');
      if (canvas) {
        this.dragManager = new DragManager(canvas, {
          getLayouts: () => this.layouts,
          getState: () => this.store.getState(),
          getTimeScale: () => ({
            dateToX: (date: Date) => this.timeScale.dateToX(date),
            xToDate: (x: number) => this.timeScale.xToDate(x),
            getColumnWidth: () => this.timeScale.getColumnWidth(),
          }),
          dispatch: (action: Action) => this.store.dispatch(action),
          onTaskMove: config.onTaskMove,
          onTaskResize: config.onTaskResize,
          onTaskProgressChange: config.onTaskProgressChange,
          // 0.185.16 — canvas bar vertical-drag reprioritize. Both are
          // optional; DragManager only activates the gesture when the
          // getter returns true AND the onBarReorderDrag callback is
          // wired. Host (NG app) decides how to resolve target row to
          // newIndex/newGroup and forward to onItemReorder.
          isBarReprioritizeEnabled: config.isBarReprioritizeEnabled,
          onBarReorderDrag: config.onBarReorderDrag,
          onTaskClick: (task: GanttTask) => {
            this.eventBus.emit('taskClick', task);
          },
          onTaskDblClick: (task: GanttTask) => {
            this.eventBus.emit('taskDblClick', task);
          },
          onHover: (task: GanttTask | null, x: number, y: number, color: string) => {
            if (task) {
              this.tooltipManager.show(task, x, y, color);
            } else {
              this.tooltipManager.hide();
            }
            // Forward to consumer-provided onHover so hosts (cloudnimbusllc.com,
            // SF LWC) can render their own hover UX alongside / instead of the
            // built-in tooltipManager. Consumer callback runs AFTER the built-in
            // so it can read / override tooltip DOM state if needed.
            try { config.onHover?.(task, x, y, color); } catch { /* swallow */ }
          },
          readOnly: this.config.readOnly,
          headerHeight: this.config.headerHeight,
          // IM-6 (0.183) — wire pan-on-deadspace through ScrollManager.
          // DragManager only exists in non-readOnly mode today (gated at
          // line ~187); readOnly pan is a follow-up if consumers ask.
          scrollManager: {
            getScrollPosition: () => this.scrollManager.getScrollPosition(),
            setScrollPosition: (x: number, y: number) => this.scrollManager.setScrollPosition(x, y),
          },
        });
      }
    }

    // 15. Subscribe to store changes
    this.unsubscribeStore = this.store.subscribe(() => {
      this.scheduleRender();
    });

    // 13. Wire DomTreeGrid events
    this.treeGrid.onRowClick((taskId: string, event: MouseEvent) => {
      this.store.dispatch({
        type: 'SELECT_TASK',
        taskId,
        multi: event.ctrlKey || event.metaKey,
      });
      this.eventBus.emit('taskClick', this.store.getState().tasks.get(taskId));
    });

    this.treeGrid.onRowDblClick((taskId: string) => {
      this.eventBus.emit('taskDblClick', this.store.getState().tasks.get(taskId));
    });

    this.treeGrid.onExpandToggle((taskId: string) => {
      this.store.dispatch({ type: 'TOGGLE_EXPAND', taskId });
    });

    // 14. Wire user callbacks via event bus
    this.wireCallbacks(config);

    // 15. Set up ResizeObserver — guarded for Salesforce Locker/LWS, which
    // blocks the global constructor. When unavailable, fall back to a
    // window-level resize listener (less precise, but keeps the gantt alive).
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.destroyed) {
          this.resize();
        }
      });
      this.resizeObserver.observe(this.container);
    } else {
      const onWindowResize = () => {
        if (!this.destroyed) {
          this.resize();
        }
      };
      window.addEventListener('resize', onWindowResize);
      // Stash on the instance so destroy() can clean it up.
      (this as unknown as { _fallbackResizeHandler?: () => void })._fallbackResizeHandler = onWindowResize;
    }

    // 16. Initial render
    this.resize();
    this.render();
  }

  // ─── Data API ───────────────────────────────────────────────────────────

  setData(tasks: GanttTask[], dependencies?: GanttDependency[]): void {
    this.store.dispatch({ type: 'SET_DATA', tasks, dependencies });
  }

  /**
   * 0.185.37 — host-pumped server→client event channel.
   *
   * Hosts subscribe to their platform-native push transport (Salesforce
   * Platform Events via `lightning/empApi`, CN SSE/websocket, etc.),
   * translate each incoming message to a `RemoteEvent`, and call this
   * method. NG applies per-row merge semantics through the existing
   * reducer — no full re-layout, scroll/selection/expansion preserved.
   *
   * Skeleton scope (0.185.37):
   *  - `task.upsert` — `Partial<GanttTask> & {id}` per patch. If id exists,
   *    merges only the present keys (won't clobber concurrent inline edits
   *    on other clients). If id missing, treats as insert when the patch
   *    has the minimum required fields (id + name + startDate + endDate);
   *    drops silently otherwise.
   *  - `task.delete` — removes by id, clears selection if needed.
   *  - `bulk.replace` — equivalent to `setData(tasks, deps)`. Resets the
   *    channel's stale-drop ts.
   *
   * Stale-drop is `ts`-only this version — events with `ts < lastAppliedTs`
   * for the channel are dropped. Per-channel keying defaults to `'default'`.
   * Sequence-based stale-drop, dep events, `onRemoteEvent` middleware, and
   * `host.custom` arrive in 0.185.38–39.
   *
   * See docs/dispatch-ng-remote-events.md for the full design.
   */
  pushRemoteEvent(event: RemoteEvent): void {
    if (this.destroyed) return;
    if (!event || typeof event !== 'object') {
      diagEmit('remote:dropped-malformed', { reason: 'not-object' });
      return;
    }
    if (event.version !== 1) {
      diagEmit('remote:dropped-malformed', {
        reason: 'bad-version',
        version: (event as { version?: unknown }).version,
      });
      return;
    }

    diagEmit('remote:received', {
      kind: event.kind,
      source: event.source,
      ts: event.ts,
    });

    // bulk.replace clears the stale-drop map — host signaled a snapshot
    // reload, prior per-id ts comparisons are no longer authoritative.
    if (event.kind === 'bulk.replace') {
      this.lastAppliedTs.clear();
      const actions = translateRemoteEvent(this.store.getState(), event);
      for (const action of actions) this.store.dispatch(action);
      diagEmit('remote:applied', {
        kind: 'bulk.replace',
        taskCount: event.tasks.length,
      });
      return;
    }

    // task.upsert / task.delete: per-id stale-drop layered on top of the
    // pure translator. Translator handles action-shape mapping and the
    // existing/insert/incomplete distinction; this loop applies stale-drop
    // and updates the per-id ts map.
    const actions = translateRemoteEvent(this.store.getState(), event);
    const ts = event.ts;
    let merged = 0;
    let added = 0;
    let removed = 0;
    let droppedStale = 0;

    for (const action of actions) {
      let taskId: string | null = null;
      if (action.type === 'UPDATE_TASK') taskId = action.taskId;
      else if (action.type === 'ADD_TASK') taskId = action.task.id;
      else if (action.type === 'REMOVE_TASK') taskId = action.taskId;

      if (taskId && typeof ts === 'number') {
        const prev = this.lastAppliedTs.get(taskId);
        if (prev !== undefined && ts < prev) {
          droppedStale++;
          continue;
        }
      }

      this.store.dispatch(action);

      if (taskId && typeof ts === 'number') {
        this.lastAppliedTs.set(taskId, ts);
      }

      if (action.type === 'UPDATE_TASK') merged++;
      else if (action.type === 'ADD_TASK') added++;
      else if (action.type === 'REMOVE_TASK') removed++;
    }

    if (droppedStale > 0) {
      diagEmit('remote:dropped-stale', { kind: event.kind, count: droppedStale });
    }
    if (merged + added + removed > 0) {
      diagEmit('remote:applied', {
        kind: event.kind,
        ...(merged > 0 ? { merged } : {}),
        ...(added > 0 ? { added } : {}),
        ...(removed > 0 ? { removed } : {}),
      });
    }
  }

  /**
   * 0.185.37 — last applied wall-clock `ts` across all tasks. Hosts
   * checkpoint this before disconnect so they can replay-from-cursor on
   * reconnect (see three-mode reconnect contract in dispatch).
   *
   * The `channel` parameter is reserved for forward-compat — sequence-
   * based per-channel checkpoints land in 0.185.38 alongside dep events.
   * In 0.185.37, returns the maximum ts seen across any task on this
   * mount, or null if no events with ts have been applied yet.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getLastAppliedTs(_channel: string = 'default'): number | null {
    if (this.lastAppliedTs.size === 0) return null;
    let max = -Infinity;
    for (const v of this.lastAppliedTs.values()) {
      if (v > max) max = v;
    }
    return Number.isFinite(max) ? max : null;
  }

  updateTask(taskId: string, changes: Partial<GanttTask>): void {
    this.store.dispatch({ type: 'UPDATE_TASK', taskId, changes });
  }

  addTask(task: GanttTask): void {
    this.store.dispatch({ type: 'ADD_TASK', task });
  }

  removeTask(taskId: string): void {
    this.store.dispatch({ type: 'REMOVE_TASK', taskId });
  }

  // ─── View API ───────────────────────────────────────────────────────────

  setZoom(level: ZoomLevel): void {
    this.store.dispatch({ type: 'SET_ZOOM', level });
    this.eventBus.emit('viewChange', level);
  }

  scrollToDate(date: string | Date): void {
    const d = typeof date === 'string' ? new Date(date) : date;
    const x = this.timeScale.dateToX(d);

    // Center the viewport horizontally on the target date
    const viewportWidth = this.timelinePanel.clientWidth;
    const targetX = Math.max(0, x - viewportWidth / 2);

    this.scrollManager.scrollToX(targetX);
  }

  scrollToTask(taskId: string): void {
    const state = this.store.getState();
    const rowIndex = state.flatVisibleIds.indexOf(taskId);
    if (rowIndex === -1) return;

    const { rowHeight, headerHeight } = state.config;
    const viewportHeight = this.timelinePanel.clientHeight - headerHeight;

    // Center vertically on the task row
    const targetY = Math.max(0, rowIndex * rowHeight - viewportHeight / 2 + rowHeight / 2);
    this.scrollManager.scrollToY(targetY);

    // Also scroll horizontally to the task's start date
    const task = state.tasks.get(taskId);
    if (task) {
      this.scrollToDate(task.startDate);
    }
  }

  expandAll(): void {
    this.store.dispatch({ type: 'EXPAND_ALL' });
  }

  collapseAll(): void {
    this.store.dispatch({ type: 'COLLAPSE_ALL' });
  }

  expandTask(taskId: string): void {
    const state = this.store.getState();
    if (!state.expandedIds.has(taskId)) {
      this.store.dispatch({ type: 'TOGGLE_EXPAND', taskId });
    }
  }

  collapseTask(taskId: string): void {
    const state = this.store.getState();
    if (state.expandedIds.has(taskId)) {
      this.store.dispatch({ type: 'TOGGLE_EXPAND', taskId });
    }
  }

  getVisibleDateRange(): { start: string; end: string } {
    const state = this.store.getState();
    return {
      start: state.dateRange.start.toISOString().split('T')[0],
      end: state.dateRange.end.toISOString().split('T')[0],
    };
  }

  // ─── Plugin API ─────────────────────────────────────────────────────────

  use(plugin: NimbusGanttPlugin): void {
    const pluginHost = this.createPluginHost();
    plugin.install(pluginHost);

    // Register middleware if provided
    if (plugin.middleware) {
      const mw: Middleware = (action, getState, next) => {
        plugin.middleware!(action, next);
      };
      this.pluginMiddlewares.push(mw);
      this.rebuildStoreWithMiddleware();
    }

    this.plugins.push(plugin);
  }

  // ─── Lifecycle API ──────────────────────────────────────────────────────

  render(): void {
    if (this.destroyed) return;
    this.renderScheduled = false;

    const state = this.store.getState();

    // Recreate TimeScale from current state
    const viewportWidth = this.timelinePanel.clientWidth;
    this.timeScale = this.createTimeScale(state, viewportWidth);

    // Compute layouts
    this.layouts = this.layoutEngine.computeLayouts(
      state.flatVisibleIds,
      state.tasks,
      this.timeScale,
      state.config,
    );

    // Update ScrollManager content size
    const totalWidth = this.timeScale.getTotalWidth();
    const totalHeight =
      state.config.headerHeight +
      state.flatVisibleIds.length * state.config.rowHeight;
    this.scrollManager.setContentSize(totalWidth, totalHeight);

    // Resize canvas to fill the timeline panel
    const panelWidth = this.timelinePanel.clientWidth;
    const panelHeight = this.timelinePanel.clientHeight;
    this.canvasRenderer.resize(panelWidth, panelHeight);

    // Render canvas
    this.canvasRenderer.render(state, this.layouts, this.timeScale);

    // Render dependency arrows on top of bars
    if (state.dependencies.size > 0) {
      const canvas = this.timelinePanel.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          this.dependencyRenderer.render(
            ctx, state, this.layouts, state.config.theme,
            state.scrollX, state.scrollY, state.config.headerHeight,
          );
        }
      }
    }

    // Render tree grid
    this.treeGrid.render(state, state.tree);
    this.treeGrid.setScrollY(state.scrollY);

    // Sync selection highlights
    this.treeGrid.clearHighlight();
    for (const id of state.selectedIds) {
      this.treeGrid.highlight(id);
    }

    // Call plugin render hooks
    for (const plugin of this.plugins) {
      if (plugin.renderCanvas) {
        const canvas = this.timelinePanel.querySelector('canvas');
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            plugin.renderCanvas(ctx, state, this.layouts);
          }
        }
      }
      if (plugin.renderDOM) {
        plugin.renderDOM(this.rootEl, state);
      }
    }

    this.eventBus.emit('render');
  }

  resize(): void {
    if (this.destroyed) return;
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // 1. Disconnect ResizeObserver (or fallback window listener)
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    } else {
      const fallback = (this as unknown as { _fallbackResizeHandler?: () => void })._fallbackResizeHandler;
      if (fallback) window.removeEventListener('resize', fallback);
    }

    // 2. Destroy ScrollManager
    this.scrollManager.destroy();

    // 3. Destroy DragManager
    if (this.dragManager) {
      this.dragManager.destroy();
    }

    // 4. Destroy TooltipManager
    this.tooltipManager.destroy();

    // 5. Destroy CanvasRenderer
    this.canvasRenderer.destroy();

    // 6. Destroy DomTreeGrid
    this.treeGrid.destroy();

    // 5. Destroy plugins
    for (const plugin of this.plugins) {
      if (plugin.destroy) {
        plugin.destroy();
      }
    }
    this.plugins = [];

    // 6. Unsubscribe from store
    this.unsubscribeStore();

    // 7. Remove root DOM element
    if (this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  private createTimeScale(state: GanttState, viewportWidth?: number): TimeScale {
    const width = viewportWidth ?? (this.timelinePanel.clientWidth || 800);
    return new TimeScale(state.zoomLevel, state.dateRange, width);
  }

  private scheduleRender(): void {
    if (this.renderScheduled || this.destroyed) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.render();
    });
  }

  private wireCallbacks(config: GanttConfig): void {
    if (config.onTaskClick) {
      this.eventBus.on('taskClick', (...args) => {
        const task = args[0] as GanttTask | undefined;
        if (task) config.onTaskClick!(task);
      });
    }

    if (config.onTaskDblClick) {
      this.eventBus.on('taskDblClick', (...args) => {
        const task = args[0] as GanttTask | undefined;
        if (task) config.onTaskDblClick!(task);
      });
    }

    if (config.onTaskMove) {
      this.eventBus.on('taskMove', (...args) => {
        config.onTaskMove!(
          args[0] as GanttTask,
          args[1] as string,
          args[2] as string,
        );
      });
    }

    if (config.onTaskResize) {
      this.eventBus.on('taskResize', (...args) => {
        config.onTaskResize!(
          args[0] as GanttTask,
          args[1] as string,
          args[2] as string,
        );
      });
    }

    if (config.onTaskProgressChange) {
      this.eventBus.on('taskProgressChange', (...args) => {
        config.onTaskProgressChange!(args[0] as GanttTask, args[1] as number);
      });
    }

    if (config.onDependencyCreate) {
      this.eventBus.on('dependencyCreate', (...args) => {
        config.onDependencyCreate!(
          args[0] as string,
          args[1] as string,
          args[2] as 'FS' | 'FF' | 'SS' | 'SF',
        );
      });
    }

    if (config.onDependencyClick) {
      this.eventBus.on('dependencyClick', (...args) => {
        config.onDependencyClick!(args[0] as GanttDependency);
      });
    }

    if (config.onViewChange) {
      this.eventBus.on('viewChange', (...args) => {
        const state = this.store.getState();
        config.onViewChange!(
          args[0] as ZoomLevel,
          state.dateRange.start.toISOString().split('T')[0],
          state.dateRange.end.toISOString().split('T')[0],
        );
      });
    }

    if (config.onTaskSelect) {
      // Subscribe to store to detect selection changes
      this.store.subscribe(() => {
        const state = this.store.getState();
        config.onTaskSelect!(Array.from(state.selectedIds));
      });
    }
  }

  private createPluginHost(): PluginHost {
    return {
      getState: () => this.store.getState(),
      dispatch: (action: Action) => this.store.dispatch(action),
      on: (event: string, handler: (...args: unknown[]) => void) =>
        this.eventBus.on(event, handler),
      getLayouts: () => this.layouts,
      getTimeScale: () => ({
        dateToX: (date: Date) => this.timeScale.dateToX(date),
        xToDate: (x: number) => this.timeScale.xToDate(x),
        getColumnWidth: () => this.timeScale.getColumnWidth(),
      }),
      /**
       * Rebuild state.tree + state.flatVisibleIds from current state.tasks
       * and state.expandedIds. Required by plugins that inject synthetic
       * tasks (e.g. PriorityGroupingPlugin) so the grid sees them.
       *
       * Mutates state in place. Safe to call from middleware — the store's
       * state object is exposed by reference and the in-place mutation is
       * picked up by the subsequent render.
       */
      rebuildTree: () => {
        const st = this.store.getState();
        const { tree, flatIds } = buildTree(st.tasks, st.expandedIds);
        st.tree = tree;
        st.flatVisibleIds.length = 0;
        for (const id of flatIds) st.flatVisibleIds.push(id);
      },
    };
  }

  /**
   * Rebuild the store with the current set of plugin middlewares.
   * We do this by creating a new store with the same state but updated
   * middleware chain, then transferring the subscription.
   */
  private rebuildStoreWithMiddleware(): void {
    const currentState = this.store.getState();
    this.unsubscribeStore();

    this.store = new GanttStore(currentState, [...this.pluginMiddlewares]);

    this.unsubscribeStore = this.store.subscribe(() => {
      this.scheduleRender();
    });
  }
}
