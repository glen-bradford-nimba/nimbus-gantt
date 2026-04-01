// ─── Work Calendar Plugin ──────────────────────────────────────────────────
// Provides working-day-aware date calculations, skipping weekends and holidays.
// Overrides task move/resize to snap dates to work days, and visually
// distinguishes non-working days on the timeline.

import type {
  NimbusGanttPlugin,
  PluginHost,
  Action,
  GanttState,
  TaskLayout,
} from '../model/types';

// ─── Types ────────────────────────────────────────────────────────────────

interface WorkCalendarOptions {
  /** Working days as day-of-week numbers (0=Sun .. 6=Sat). Default: [1,2,3,4,5] (Mon-Fri). */
  workDays?: number[];
  /** Holiday dates as ISO strings (e.g. ['2026-12-25']). */
  holidays?: string[];
  /** Hours per work day. Default: 8. */
  hoursPerDay?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Monday through Friday

// ─── Non-work day rendering ──────────────────────────────────────────────

const NON_WORK_BG = 'rgba(128, 128, 128, 0.06)';
const NON_WORK_STRIPE_COLOR = 'rgba(128, 128, 128, 0.04)';
const HOLIDAY_MARKER_COLOR = '#f87171';
const HOLIDAY_MARKER_SIZE = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────

function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ─── Plugin Factory ─────────────────────────────────────────────────────

export function WorkCalendarPlugin(options?: WorkCalendarOptions): NimbusGanttPlugin {
  const workDaySet = new Set(options?.workDays ?? DEFAULT_WORK_DAYS);
  const holidaySet = new Set(options?.holidays ?? []);
  const _hoursPerDay = options?.hoursPerDay ?? 8;

  let host: PluginHost | null = null;

  // ── Core calendar functions ────────────────────────────────────────────

  function isWorkDay(dateStr: string): boolean {
    if (holidaySet.has(dateStr)) return false;
    const d = parseDate(dateStr);
    return workDaySet.has(d.getUTCDay());
  }

  function isWorkDayFromDate(date: Date): boolean {
    const iso = toISODate(date);
    if (holidaySet.has(iso)) return false;
    return workDaySet.has(date.getUTCDay());
  }

  function nextWorkDay(dateStr: string): string {
    let d = parseDate(dateStr);
    d = new Date(d.getTime() + MS_PER_DAY);
    while (!isWorkDayFromDate(d)) {
      d = new Date(d.getTime() + MS_PER_DAY);
    }
    return toISODate(d);
  }

  function prevWorkDay(dateStr: string): string {
    let d = parseDate(dateStr);
    d = new Date(d.getTime() - MS_PER_DAY);
    while (!isWorkDayFromDate(d)) {
      d = new Date(d.getTime() - MS_PER_DAY);
    }
    return toISODate(d);
  }

  function addWorkDays(startDate: string, days: number): string {
    if (days === 0) return startDate;

    let d = parseDate(startDate);
    const direction = days > 0 ? 1 : -1;
    let remaining = Math.abs(days);

    // If start is not a work day, move to the next one in the direction
    if (!isWorkDayFromDate(d)) {
      d = new Date(d.getTime() + direction * MS_PER_DAY);
      while (!isWorkDayFromDate(d)) {
        d = new Date(d.getTime() + direction * MS_PER_DAY);
      }
    }

    while (remaining > 0) {
      d = new Date(d.getTime() + direction * MS_PER_DAY);
      if (isWorkDayFromDate(d)) {
        remaining--;
      }
    }

    return toISODate(d);
  }

  function workDaysBetween(start: string, end: string): number {
    const startD = parseDate(start);
    const endD = parseDate(end);

    if (startD.getTime() > endD.getTime()) {
      return -workDaysBetween(end, start);
    }

    let count = 0;
    let current = new Date(startD.getTime());

    while (current.getTime() < endD.getTime()) {
      if (isWorkDayFromDate(current)) {
        count++;
      }
      current = new Date(current.getTime() + MS_PER_DAY);
    }

    return count;
  }

  function snapToWorkDay(dateStr: string, direction: 'forward' | 'backward' = 'forward'): string {
    if (isWorkDay(dateStr)) return dateStr;

    let d = parseDate(dateStr);
    const step = direction === 'forward' ? MS_PER_DAY : -MS_PER_DAY;

    // Safety limit to prevent infinite loops
    for (let i = 0; i < 30; i++) {
      d = new Date(d.getTime() + step);
      if (isWorkDayFromDate(d)) {
        return toISODate(d);
      }
    }

    // Fallback: return the original date
    return dateStr;
  }

  // ── Middleware: snap task move/resize to work days ─────────────────────

  function middleware(action: Action, next: (action: Action) => void): void {
    if (action.type === 'TASK_MOVE') {
      const snappedStart = snapToWorkDay(action.startDate, 'forward');
      const snappedEnd = snapToWorkDay(action.endDate, 'backward');

      // Ensure end is not before start
      const finalEnd = parseDate(snappedEnd).getTime() < parseDate(snappedStart).getTime()
        ? snappedStart
        : snappedEnd;

      next({
        ...action,
        startDate: snappedStart,
        endDate: finalEnd,
      });
      return;
    }

    if (action.type === 'TASK_RESIZE') {
      const snappedStart = snapToWorkDay(action.startDate, 'forward');
      const snappedEnd = snapToWorkDay(action.endDate, 'backward');

      const finalEnd = parseDate(snappedEnd).getTime() < parseDate(snappedStart).getTime()
        ? snappedStart
        : snappedEnd;

      next({
        ...action,
        startDate: snappedStart,
        endDate: finalEnd,
      });
      return;
    }

    next(action);
  }

  // ── Canvas overlay: shade non-working days ────────────────────────────

  function renderCanvas(
    ctx: CanvasRenderingContext2D,
    state: GanttState,
    _layouts: TaskLayout[],
  ): void {
    const { config } = state;
    const headerHeight = config.headerHeight;
    const bodyHeight = state.flatVisibleIds.length * config.rowHeight;
    const timeScale = host?.getTimeScale();
    if (!timeScale || bodyHeight === 0) return;

    const { start, end } = state.dateRange;
    const scrollX = state.scrollX;
    const scrollY = state.scrollY;

    // Save context state
    ctx.save();

    // The context may already be in the post-render state (DPI scaled, no translation).
    // We need to apply the same scroll translation as the main renderer.
    // The renderCanvas hook is called after the main render, with ctx in its default
    // DPI-scaled state. We need to clip to the body and apply scroll.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clip to body region
    ctx.beginPath();
    ctx.rect(0, headerHeight, ctx.canvas.width / dpr, bodyHeight);
    ctx.clip();

    // Apply horizontal scroll
    ctx.translate(-scrollX, 0);

    // Walk each day in the date range
    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);
    const endTime = end.getTime();
    const colWidth = timeScale.getColumnWidth();

    while (current.getTime() <= endTime) {
      const iso = toISODate(current);
      const isHoliday = holidaySet.has(iso);
      const isNonWork = !workDaySet.has(current.getUTCDay());

      if (isHoliday || isNonWork) {
        const x = timeScale.dateToX(current);
        const nextDay = new Date(current.getTime() + MS_PER_DAY);
        const xEnd = timeScale.dateToX(nextDay);
        const width = xEnd - x;

        // Draw non-working day background
        ctx.fillStyle = NON_WORK_BG;
        ctx.fillRect(x, headerHeight - scrollY, width, bodyHeight + scrollY);

        // Draw diagonal stripe pattern for non-work days
        if (isNonWork && !isHoliday) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, headerHeight, width, bodyHeight);
          ctx.clip();

          ctx.strokeStyle = NON_WORK_STRIPE_COLOR;
          ctx.lineWidth = 1;

          const step = 8;
          const totalH = bodyHeight;
          for (let i = -totalH; i < width + totalH; i += step) {
            ctx.beginPath();
            ctx.moveTo(x + i, headerHeight);
            ctx.lineTo(x + i + totalH, headerHeight + totalH);
            ctx.stroke();
          }

          ctx.restore();
        }
      }

      // Draw holiday marker in the header area
      if (isHoliday) {
        const x = timeScale.dateToX(current);
        const nextDay = new Date(current.getTime() + MS_PER_DAY);
        const xEnd = timeScale.dateToX(nextDay);
        const centerX = (x + xEnd) / 2;

        // Save, unclip for header, draw marker
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(-scrollX, 0);

        // Small diamond marker at the bottom of the header
        const markerY = headerHeight - HOLIDAY_MARKER_SIZE - 3;
        ctx.beginPath();
        ctx.moveTo(centerX, markerY - HOLIDAY_MARKER_SIZE);
        ctx.lineTo(centerX + HOLIDAY_MARKER_SIZE, markerY);
        ctx.lineTo(centerX, markerY + HOLIDAY_MARKER_SIZE);
        ctx.lineTo(centerX - HOLIDAY_MARKER_SIZE, markerY);
        ctx.closePath();
        ctx.fillStyle = HOLIDAY_MARKER_COLOR;
        ctx.fill();

        ctx.restore();
      }

      current.setTime(current.getTime() + MS_PER_DAY);
    }

    ctx.restore();
  }

  return {
    name: 'WorkCalendarPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Expose utility functions via event system
      gantt.on('calendar:addWorkDays', (...args: unknown[]) => {
        const startDate = args[0] as string;
        const days = args[1] as number;
        const callback = args[2] as ((result: string) => void) | undefined;
        const result = addWorkDays(startDate, days);
        if (callback) callback(result);
      });

      gantt.on('calendar:workDaysBetween', (...args: unknown[]) => {
        const start = args[0] as string;
        const end = args[1] as string;
        const callback = args[2] as ((result: number) => void) | undefined;
        const result = workDaysBetween(start, end);
        if (callback) callback(result);
      });

      gantt.on('calendar:isWorkDay', (...args: unknown[]) => {
        const date = args[0] as string;
        const callback = args[1] as ((result: boolean) => void) | undefined;
        const result = isWorkDay(date);
        if (callback) callback(result);
      });

      gantt.on('calendar:nextWorkDay', (...args: unknown[]) => {
        const date = args[0] as string;
        const callback = args[1] as ((result: string) => void) | undefined;
        const result = nextWorkDay(date);
        if (callback) callback(result);
      });
    },

    middleware,

    renderCanvas,

    destroy(): void {
      host = null;
    },
  };
}
