import type {
  GanttTask,
  GanttState,
  TaskLayout,
  TimeScaleAPI,
  Action,
  DragState,
} from '../model/types';
import { HitTest } from './HitTest';
import type { HitResult } from './HitTest';

// ─── Helpers ───────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Convert a pixel delta to a whole number of days using the TimeScale. */
function pixelsToDays(pixels: number, timeScale: TimeScaleAPI): number {
  const d1 = timeScale.xToDate(0);
  const d2 = timeScale.xToDate(pixels);
  return Math.round((d2.getTime() - d1.getTime()) / MS_PER_DAY);
}

/** Parse a YYYY-MM-DD string into a UTC Date. */
function parseDate(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  return new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
}

/** Add days to a YYYY-MM-DD string, returning a new YYYY-MM-DD string (UTC). */
function addDays(dateStr: string, days: number): string {
  const date = parseDate(dateStr);
  const result = new Date(date.getTime() + days * MS_PER_DAY);
  const y = result.getUTCFullYear();
  const m = String(result.getUTCMonth() + 1).padStart(2, '0');
  const d = String(result.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Format a Date as YYYY-MM-DD in UTC. */
function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Clamp a number between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Drag threshold ────────────────────────────────────────────────────────

/** Minimum distance in pixels before a pointerdown/up is treated as a drag
 *  rather than a click. */
const CLICK_THRESHOLD = 3;

/** Maximum time between two clicks on the same task to count as a double click. */
const DBLCLICK_INTERVAL = 300;

// ─── DragManager ───────────────────────────────────────────────────────────

export interface DragManagerOptions {
  getLayouts: () => TaskLayout[];
  getState: () => GanttState;
  getTimeScale: () => TimeScaleAPI;
  dispatch: (action: Action) => void;
  onTaskMove?: (task: GanttTask, startDate: string, endDate: string) => void | Promise<void>;
  onTaskResize?: (task: GanttTask, startDate: string, endDate: string) => void | Promise<void>;
  onTaskProgressChange?: (task: GanttTask, progress: number) => void | Promise<void>;
  onTaskClick?: (task: GanttTask) => void;
  onTaskDblClick?: (task: GanttTask) => void;
  onHover?: (task: GanttTask | null, x: number, y: number, color: string) => void;
  readOnly: boolean;
  headerHeight?: number;
  /** 0.185.16 — when set, enables drag-bar-to-reprioritize on canvas.
   *  Vertical-dominant drag of a bar body crosses rows to change the
   *  task's sortOrder (and priorityGroup, if the drop row is in a
   *  different bucket). Called on drop with the target task's id + the
   *  target row index. Host computes the correct newIndex/newGroup
   *  and forwards through onItemReorder. When flag returns false or
   *  option is absent, vertical drag behaves as today (shifts both
   *  dates when a move gesture, dispatches TASK_MOVE). */
  isBarReprioritizeEnabled?: () => boolean;
  /** 0.185.19 — targetBucketId added. Resolved from the preceding
   *  bucket header in the layouts list (taskId prefix `__bucket_header__`)
   *  so cross-bucket drops below the last row in a bucket can
   *  identify the target bucket without needing a target task. */
  onBarReorderDrag?: (
    task: GanttTask,
    targetTaskId: string | null,
    targetRowIndex: number,
    targetBucketId?: string | null,
  ) => void | Promise<void>;
  /** IM-6 (0.183) — optional scroll controller that enables pan-on-deadspace.
   *  When provided, a pointerdown on non-bar canvas area enters pan mode:
   *  subsequent pointermove events update scroll via setScrollPosition, and
   *  pointerup exits. Works regardless of `readOnly` — panning is navigation,
   *  not editing. Absent: deadspace pointerdown is a no-op. */
  scrollManager?: {
    getScrollPosition: () => { x: number; y: number };
    setScrollPosition: (x: number, y: number) => void;
  };
}

/**
 * Handles all drag interactions on the Gantt Canvas.
 *
 * Responsibilities:
 * - Hover cursor updates via HitTest
 * - Drag-to-move, drag-to-resize, drag-to-change-progress
 * - Click / double-click detection
 * - Dispatches actions to the GanttStore
 */
export class DragManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: DragManagerOptions;
  private readonly hitTest: HitTest;

  // Drag state
  private dragging = false;
  private dragHit: HitResult | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragPointerId: number | null = null;
  private dragOriginalStartDate = '';
  private dragOriginalEndDate = '';

  // IM-6 (0.183) — Pan state (separate from drag-to-edit).
  //   `panning` goes true when pointerdown lands on canvas deadspace (no
  //   bar hit) and `scrollManager` is provided. During pan, pointermove
  //   sets scroll to (origScroll - clientDelta) — mouse-follow semantics.
  //   Pointerup exits. Pan never fires onTaskMove/onTaskResize.
  private panning = false;
  private panStartClientX = 0;
  private panStartClientY = 0;
  private panOrigScrollX = 0;
  private panOrigScrollY = 0;

  // Click / double-click tracking
  private lastClickTaskId: string | null = null;
  private lastClickTime = 0;

  // 0.185.20 — gesture label element. Floating div that follows the cursor
  // during a bar drag and previews what the commit will land on. Created
  // lazily on first drag; destroyed with the DragManager.
  private gestureLabelEl: HTMLDivElement | null = null;

  // Bound event handlers (stored for cleanup)
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onClick: (e: MouseEvent) => void;

  constructor(canvas: HTMLCanvasElement, options: DragManagerOptions) {
    this.canvas = canvas;
    this.options = options;
    this.hitTest = new HitTest();

    // Bind handlers
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    this.onClick = this.handleClick_native.bind(this);

    // Attach listeners
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    // Prevent the native click from bubbling to framework-level navigation
    // handlers (e.g. Salesforce Lightning's record navigation).
    this.canvas.addEventListener('click', this.onClick);
  }

  /** Remove all event listeners and clean up. */
  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('click', this.onClick);

    // Release pointer capture if still held
    if (this.dragPointerId !== null) {
      try {
        this.canvas.releasePointerCapture(this.dragPointerId);
      } catch {
        // Pointer may already be released
      }
      this.dragPointerId = null;
    }

    this.dragging = false;
    this.dragHit = null;
    // 0.185.20 — clean up the gesture label if the DragManager is torn
    // down while a label is still in the DOM (e.g., unmount mid-drag).
    this.removeGestureLabel();
  }

  // ── Coordinate Translation ──────────────────────────────────────────────

  /**
   * Convert a pointer event to canvas-space coordinates.
   * Accounts for scroll offsets and header height.
   */
  private toCanvasCoords(e: PointerEvent): { canvasX: number; canvasY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const state = this.options.getState();

    // Pointer position relative to the canvas element
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;

    // Translate to canvas (content) coordinates
    const canvasX = pointerX + state.scrollX;
    const canvasY = pointerY + state.scrollY - state.config.headerHeight;

    return { canvasX, canvasY };
  }

  // ── Native Click Handler ────────────────────────────────────────────────

  /**
   * Prevent the native click event from propagating to parent frameworks
   * (e.g. Salesforce Lightning) which may interpret clicks on canvas elements
   * as navigation actions.  We handle task clicks ourselves via pointer events.
   */
  private handleClick_native(e: MouseEvent): void {
    const { canvasX, canvasY } = this.toCanvasCoordsFromMouse(e);
    const state = this.options.getState();
    const layouts = this.options.getLayouts();
    const hit = this.hitTest.test(canvasX, canvasY, layouts, state.config);

    if (hit && hit.type !== 'none') {
      // A task was clicked — swallow the event so no parent handler navigates
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Translate a MouseEvent (non-pointer) to canvas coordinates. */
  private toCanvasCoordsFromMouse(e: MouseEvent): { canvasX: number; canvasY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const state = this.options.getState();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const canvasX = pointerX + state.scrollX;
    const canvasY = pointerY + state.scrollY - state.config.headerHeight;
    return { canvasX, canvasY };
  }

  // ── Pointer Handlers ────────────────────────────────────────────────────

  private handlePointerMove(e: PointerEvent): void {
    if (this.panning) {
      // IM-6 pan — translate scroll by inverse of pointer delta so the
      // content follows the mouse 1:1 (classic click-and-drag map pan).
      e.preventDefault();
      const dx = e.clientX - this.panStartClientX;
      const dy = e.clientY - this.panStartClientY;
      const sm = this.options.scrollManager;
      if (sm) {
        const nextX = Math.max(0, this.panOrigScrollX - dx);
        const nextY = Math.max(0, this.panOrigScrollY - dy);
        sm.setScrollPosition(nextX, nextY);
      }
      return;
    }
    if (this.dragging) {
      this.handleDragMove(e);
      return;
    }

    // Hover: update cursor and tooltip based on hit test
    const { canvasX, canvasY } = this.toCanvasCoords(e);
    const state = this.options.getState();
    const layouts = this.options.getLayouts();
    const hit = this.hitTest.test(canvasX, canvasY, layouts, state.config);
    this.canvas.style.cursor = this.hitTest.getCursor(hit, this.options.readOnly);

    // Tooltip callback
    if (this.options.onHover) {
      if (hit && hit.type !== 'none') {
        const task = state.tasks.get(hit.taskId);
        if (task) {
          const rect = this.canvas.getBoundingClientRect();
          this.options.onHover(task, e.clientX - rect.left, e.clientY - rect.top, hit.layout.color);
        }
      } else {
        this.options.onHover(null, 0, 0, '');
      }
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    // Only handle primary button
    if (e.button !== 0) return;

    const { canvasX, canvasY } = this.toCanvasCoords(e);
    const state = this.options.getState();
    const layouts = this.options.getLayouts();
    const hit = this.hitTest.test(canvasX, canvasY, layouts, state.config);

    if (!hit || hit.type === 'none') {
      // IM-6 (0.183) — canvas deadspace: enter pan mode when a scrollManager
      // is wired. Pan works in readOnly mode too (it's navigation, not
      // editing). No-op when no scrollManager was provided.
      if (!this.options.scrollManager) return;
      e.preventDefault();
      e.stopPropagation();
      this.panning = true;
      this.panStartClientX = e.clientX;
      this.panStartClientY = e.clientY;
      const pos = this.options.scrollManager.getScrollPosition();
      this.panOrigScrollX = pos.x;
      this.panOrigScrollY = pos.y;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
      this.dragPointerId = e.pointerId;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    // Prevent default browser action (text selection, etc.) and stop the
    // event from reaching framework-level navigation handlers.
    e.preventDefault();
    e.stopPropagation();

    // Store drag start info
    this.dragHit = hit;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;

    // Look up the original task to capture its dates
    const task = state.tasks.get(hit.taskId);
    if (!task) return;

    this.dragOriginalStartDate = task.startDate;
    this.dragOriginalEndDate = task.endDate;

    // Capture the pointer for reliable tracking (both readOnly and interactive).
    // Guarded for LWS (Lightning Web Security) — distorted-window canvas may
    // not expose setPointerCapture as a function. Drag still works without
    // capture as long as the pointer doesn't leave the canvas mid-drag.
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* LWS or browser rejected */ }
    this.dragPointerId = e.pointerId;
    this.dragging = true;

    if (!this.options.readOnly) {
      // Determine drag type from hit type
      const dragType = hitTypeToDragType(hit.type);
      if (dragType) {
        this.options.dispatch({
          type: 'DRAG_START',
          drag: {
            type: dragType,
            taskId: hit.taskId,
            startX: canvasX,
            startY: canvasY,
            currentX: canvasX,
            currentY: canvasY,
            originalStartDate: task.startDate,
            originalEndDate: task.endDate,
          },
        });
      }
    }
  }

  private handleDragMove(e: PointerEvent): void {
    if (!this.dragHit) return;

    // Prevent default to stop text selection and other browser behavior
    // during drag operations.
    e.preventDefault();

    // Only dispatch drag updates in interactive mode
    if (this.options.readOnly) return;

    const { canvasX, canvasY } = this.toCanvasCoords(e);

    this.options.dispatch({
      type: 'DRAG_UPDATE',
      currentX: canvasX,
      currentY: canvasY,
    });

    // 0.185.20 — update the floating gesture label so the user can see
    // what the drag will commit to before releasing. Computes preview
    // dates from the current pointer position and the drag's original
    // task dates.
    this.updateGestureLabel(e);
  }

  // ── Gesture Label ──────────────────────────────────────────────────────

  private updateGestureLabel(e: PointerEvent): void {
    if (!this.dragHit) return;
    const state = this.options.getState();
    const task = state.tasks.get(this.dragHit.taskId);
    if (!task) return;
    const timeScale = this.options.getTimeScale();
    const pixelDeltaX = e.clientX - this.dragStartX;
    const days = pixelsToDays(pixelDeltaX, timeScale);

    let text = '';
    if (this.dragHit.type === 'bar') {
      const newStart = addDays(this.dragOriginalStartDate, days);
      const newEnd = addDays(this.dragOriginalEndDate, days);
      text = `${newStart} → ${newEnd}`;
    } else if (this.dragHit.type === 'bar-left-edge') {
      const newStart = addDays(this.dragOriginalStartDate, days);
      text = `Start → ${newStart}`;
    } else if (this.dragHit.type === 'bar-right-edge') {
      const newEnd = addDays(this.dragOriginalEndDate, days);
      text = `End → ${newEnd}`;
    } else if (this.dragHit.type === 'progress-handle') {
      const layout = this.dragHit.layout;
      const { canvasX } = this.toCanvasCoords(e);
      const relativeX = canvasX - layout.x;
      const pct = Math.round(clamp(relativeX / layout.width, 0, 1) * 100);
      text = `${pct}%`;
    }
    if (!text) return;

    if (!this.gestureLabelEl) {
      const el = document.createElement('div');
      el.setAttribute('data-nga-gesture-label', '1');
      el.style.cssText = [
        'position:fixed',
        'z-index:9999',
        'pointer-events:none',
        'padding:4px 8px',
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
        'font-size:11px',
        'font-weight:600',
        'color:#ffffff',
        'background:rgba(30,41,59,0.92)',
        'border-radius:4px',
        'box-shadow:0 2px 8px rgba(0,0,0,0.18)',
        'white-space:nowrap',
        'transition:opacity 80ms ease',
        'opacity:0',
      ].join(';');
      document.body.appendChild(el);
      this.gestureLabelEl = el;
      // Fade in on next frame so the initial position doesn't flash
      requestAnimationFrame(() => { if (this.gestureLabelEl) this.gestureLabelEl.style.opacity = '1'; });
    }
    this.gestureLabelEl.textContent = text;
    // Position 12px below-right of cursor; clamp to viewport so it doesn't
    // flow off the right edge on edge-of-screen drags.
    const pad = 12;
    const viewportW = window.innerWidth || document.documentElement.clientWidth;
    const rectW = this.gestureLabelEl.offsetWidth;
    const nextX = Math.min(e.clientX + pad, viewportW - rectW - 4);
    const nextY = e.clientY + pad;
    this.gestureLabelEl.style.left = `${nextX}px`;
    this.gestureLabelEl.style.top = `${nextY}px`;
  }

  private removeGestureLabel(): void {
    if (!this.gestureLabelEl) return;
    try { this.gestureLabelEl.remove(); } catch (_e) { /* ok */ }
    this.gestureLabelEl = null;
  }

  private handlePointerUp(e: PointerEvent): void {
    // Release pointer capture
    if (this.dragPointerId !== null) {
      try {
        this.canvas.releasePointerCapture(this.dragPointerId);
      } catch {
        // Already released
      }
      this.dragPointerId = null;
    }

    // IM-6 (0.183) — exit pan mode cleanly before the drag-path early-return.
    if (this.panning) {
      this.panning = false;
      this.canvas.style.cursor = '';
      return;
    }

    if (!this.dragging || !this.dragHit) {
      this.dragging = false;
      this.dragHit = null;
      return;
    }

    const deltaX = Math.abs(e.clientX - this.dragStartX);
    const deltaY = Math.abs(e.clientY - this.dragStartY);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    const hit = this.dragHit;
    const state = this.options.getState();
    const task = state.tasks.get(hit.taskId);

    if (distance < CLICK_THRESHOLD) {
      // Treat as click, not drag
      this.options.dispatch({ type: 'DRAG_END' });

      if (task) {
        this.handleClick(task);
      }
    } else if (!this.options.readOnly) {
      // Complete the drag (only in interactive mode)
      this.completeDrag(e);
    } else {
      // ReadOnly mode: cancel any pending drag state
      this.options.dispatch({ type: 'DRAG_END' });
    }

    this.dragging = false;
    this.dragHit = null;
    // 0.185.20 — remove gesture label on any pointer-up path (click or drag).
    this.removeGestureLabel();
  }

  // ── Click / Double-Click ────────────────────────────────────────────────

  private handleClick(task: GanttTask): void {
    const now = Date.now();

    // Check for double click
    if (
      this.lastClickTaskId === task.id &&
      now - this.lastClickTime < DBLCLICK_INTERVAL
    ) {
      // Double click
      this.lastClickTaskId = null;
      this.lastClickTime = 0;
      this.options.onTaskDblClick?.(task);
      return;
    }

    // Single click
    this.lastClickTaskId = task.id;
    this.lastClickTime = now;

    // Select the task
    this.options.dispatch({ type: 'SELECT_TASK', taskId: task.id });
    this.options.onTaskClick?.(task);
  }

  // ── Drag Completion ─────────────────────────────────────────────────────

  private completeDrag(e: PointerEvent): void {
    if (!this.dragHit) return;

    const state = this.options.getState();
    const task = state.tasks.get(this.dragHit.taskId);
    if (!task) {
      this.options.dispatch({ type: 'DRAG_END' });
      return;
    }

    const timeScale = this.options.getTimeScale();
    const config = state.config;
    const hitType = this.dragHit.type;

    // Calculate pixel delta from drag start
    const pixelDeltaX = e.clientX - this.dragStartX;

    switch (hitType) {
      case 'bar': {
        // 0.185.16 — if canvas bar reprioritize is enabled AND the drag was
        // vertical-dominant, interpret as reorder instead of date move.
        // Axis dominance: compare abs(pixelDeltaY) to abs(pixelDeltaX) plus
        // a small bias so purely-horizontal drags never accidentally
        // register as vertical (the threshold of 2x keeps the default
        // date-drag feel intact).
        const pixelDeltaY = e.clientY - this.dragStartY;
        const absX = Math.abs(pixelDeltaX);
        const absY = Math.abs(pixelDeltaY);
        const reprioritizeEnabled = !!this.options.isBarReprioritizeEnabled
          && this.options.isBarReprioritizeEnabled();
        const verticalDominant = absY > absX * 1.5 && absY > 12;

        if (reprioritizeEnabled && verticalDominant) {
          // Resolve the target row from the pointer's canvas-space Y.
          // canvasY is content-space (already adjusted for scroll/header).
          const layouts = this.options.getLayouts();
          const targetRowIndex = Math.max(0, Math.floor(
            (this.toCanvasCoords(e).canvasY) / config.rowHeight,
          ));
          const targetLayout = layouts.find((l) => l.rowIndex === targetRowIndex);
          const targetTaskId = targetLayout ? targetLayout.taskId : null;
          // 0.185.19 — resolve target bucket by walking layouts backward
          // to find the nearest preceding bucket-header row. This lets
          // the host identify the target bucket for cross-bucket drops
          // below the last task row in a bucket (where targetLayout is
          // null). Bucket headers are synthetic layouts whose taskId
          // starts with `__bucket_header__` per PriorityGroupingPlugin.
          let targetBucketId: string | null = null;
          // Sort by rowIndex ascending once so the scan is linear.
          const sortedLayouts = layouts.slice().sort((a, b) => a.rowIndex - b.rowIndex);
          for (const layout of sortedLayouts) {
            if (layout.rowIndex > targetRowIndex) break;
            const id = layout.taskId;
            if (typeof id === 'string' && id.indexOf('__bucket_header__') === 0) {
              targetBucketId = id.slice('__bucket_header__'.length);
            }
          }
          try { console.log('[NG engine] drag commit bar-reorder', task.id, '→ row=', targetRowIndex, 'target=', targetTaskId, 'bucket=', targetBucketId); } catch (_e) { /* ok */ }
          this.options.onBarReorderDrag?.(task, targetTaskId, targetRowIndex, targetBucketId);
          break;
        }

        // Default behavior — move: shift both start and end by the same offset
        const days = pixelsToDays(pixelDeltaX, timeScale);
        const newStart = addDays(this.dragOriginalStartDate, days);
        const newEnd = addDays(this.dragOriginalEndDate, days);

        this.options.dispatch({
          type: 'TASK_MOVE',
          taskId: task.id,
          startDate: newStart,
          endDate: newEnd,
        });
        // 0.183.3-diag — engine emit point for bar-body drag commit. If this
        // log fires but downstream IIFEApp probes don't, the regression is
        // in the engine→app callback wiring (config.onTaskMove not making
        // it through to options.onTaskMove on this Ctor instance).
        try { console.log('[NG engine] drag commit move', task.id, newStart, newEnd, 'hasCb=', !!this.options.onTaskMove); } catch (_e) { /* ok */ }
        this.options.onTaskMove?.(task, newStart, newEnd);
        break;
      }

      case 'bar-left-edge': {
        // Resize left: adjust start date only
        const days = pixelsToDays(pixelDeltaX, timeScale);
        const newStart = addDays(this.dragOriginalStartDate, days);

        // Don't allow start to go past end
        const endDate = parseDate(this.dragOriginalEndDate);
        const newStartDate = parseDate(newStart);
        const finalStart = newStartDate.getTime() >= endDate.getTime()
          ? addDays(this.dragOriginalEndDate, -1)
          : newStart;

        this.options.dispatch({
          type: 'TASK_RESIZE',
          taskId: task.id,
          startDate: finalStart,
          endDate: this.dragOriginalEndDate,
        });
        try { console.log('[NG engine] drag commit resize-left', task.id, finalStart, this.dragOriginalEndDate, 'hasCb=', !!this.options.onTaskResize); } catch (_e) { /* ok */ }
        this.options.onTaskResize?.(task, finalStart, this.dragOriginalEndDate);
        break;
      }

      case 'bar-right-edge': {
        // Resize right: adjust end date only
        const days = pixelsToDays(pixelDeltaX, timeScale);
        const newEnd = addDays(this.dragOriginalEndDate, days);

        // Don't allow end to go before start
        const startDate = parseDate(this.dragOriginalStartDate);
        const newEndDate = parseDate(newEnd);
        const finalEnd = newEndDate.getTime() <= startDate.getTime()
          ? addDays(this.dragOriginalStartDate, 1)
          : newEnd;

        this.options.dispatch({
          type: 'TASK_RESIZE',
          taskId: task.id,
          startDate: this.dragOriginalStartDate,
          endDate: finalEnd,
        });
        try { console.log('[NG engine] drag commit resize-right', task.id, this.dragOriginalStartDate, finalEnd, 'hasCb=', !!this.options.onTaskResize); } catch (_e) { /* ok */ }
        this.options.onTaskResize?.(task, this.dragOriginalStartDate, finalEnd);
        break;
      }

      case 'progress-handle': {
        // Calculate new progress from horizontal position within bar
        const layout = this.dragHit.layout;
        const { canvasX } = this.toCanvasCoords(e);
        const relativeX = canvasX - layout.x;
        const progress = clamp(relativeX / layout.width, 0, 1);

        // Round to nearest percent
        const roundedProgress = Math.round(progress * 100) / 100;

        this.options.dispatch({
          type: 'UPDATE_TASK',
          taskId: task.id,
          changes: { progress: roundedProgress },
        });
        this.options.onTaskProgressChange?.(task, roundedProgress);
        break;
      }
    }

    this.options.dispatch({ type: 'DRAG_END' });
  }
}

// ─── Mapping helpers ───────────────────────────────────────────────────────

function hitTypeToDragType(
  hitType: string,
): DragState['type'] | null {
  switch (hitType) {
    case 'bar':
      return 'move';
    case 'bar-left-edge':
      return 'resize-left';
    case 'bar-right-edge':
      return 'resize-right';
    case 'progress-handle':
      return 'progress';
    case 'link-point':
      return 'link';
    default:
      return null;
  }
}
