// ─── Time Cursor Plugin (0.187.0) ──────────────────────────────────────────
// DAW-style playhead. Renders a vertical cursor line at `state.timeCursorDate`,
// plus a "NOW" bracket marker so users always know where the live edge is.
// Keyboard shortcuts: ArrowLeft/Right = step, Home = baseline, End = now.
//
// Pointer drag-to-scrub lands in 0.187.1 — for now hosts can wire their own
// drag UI and call `gantt.history.scrubTo(date)`. The visible playhead +
// keyboard nav + the substrate's `setTimeCursor` API are enough to demo the
// full scrubbable-history loop.
//
// Requires HistoryPlugin to be installed first (so a replay provider exists).
// If no HistoryPlugin, the cursor still renders + dispatches but the visible
// state stays live (no replayed snapshot to swap in).

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
} from '../model/types';

export interface TimeCursorOptions {
  cursorColor?: string;
  cursorWidth?: number;
  /** Show the colored "NOW" bracket at today even when cursor is set
   *  elsewhere. Default true. */
  showNowBracket?: boolean;
  nowBracketColor?: string;
  /** Listen for keyboard scrub (Home/End/arrows) at document level when
   *  the gantt has focus. Default true. */
  enableKeyboardShortcuts?: boolean;
  /** Step distance (ms) for arrow-key scrub. Default 1 day. */
  stepMs?: number;
}

const DEFAULT_CURSOR_COLOR = '#3b82f6';
const DEFAULT_CURSOR_WIDTH = 2;
const DEFAULT_NOW_BRACKET_COLOR = '#10b981';
const DEFAULT_STEP_MS = 86_400_000; // 1 day

export function TimeCursorPlugin(opts: TimeCursorOptions = {}): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gantt: any = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  const cursorColor = opts.cursorColor ?? DEFAULT_CURSOR_COLOR;
  const cursorWidth = opts.cursorWidth ?? DEFAULT_CURSOR_WIDTH;
  const showNowBracket = opts.showNowBracket !== false;
  const nowBracketColor = opts.nowBracketColor ?? DEFAULT_NOW_BRACKET_COLOR;
  const enableKeyboard = opts.enableKeyboardShortcuts !== false;
  const stepMs = opts.stepMs ?? DEFAULT_STEP_MS;

  function step(deltaMs: number): void {
    if (!gantt) return;
    const current = gantt.getTimeCursor() as Date | null;
    const base = current ?? new Date();
    const next = new Date(base.getTime() + deltaMs);
    gantt.setTimeCursor(next);
  }

  function jumpToBaseline(): void {
    if (!gantt?.history) return;
    const all = gantt.history.entries() as ReadonlyArray<{ wallTs: number }>;
    if (all.length === 0) return;
    gantt.setTimeCursor(new Date(all[0].wallTs));
  }

  function onKey(e: KeyboardEvent): void {
    // Only consume when the gantt area has focus or the user is not
    // typing in an input. Conservative: if any input/textarea/contenteditable
    // is the active element, bail.
    const active = document.activeElement as HTMLElement | null;
    if (active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.isContentEditable
    )) return;

    if (e.key === 'Home') { e.preventDefault(); jumpToBaseline(); return; }
    if (e.key === 'End') { e.preventDefault(); gantt?.setTimeCursor(null); return; }
    if (e.key === 'ArrowLeft' && (e.altKey || e.metaKey)) {
      e.preventDefault();
      step(-stepMs);
      return;
    }
    if (e.key === 'ArrowRight' && (e.altKey || e.metaKey)) {
      e.preventDefault();
      step(stepMs);
      return;
    }
  }

  return {
    name: 'TimeCursorPlugin',

    install(pluginHost: PluginHost): void {
      host = pluginHost;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gantt = (pluginHost as any).__gantt ?? null;

      if (enableKeyboard && typeof document !== 'undefined') {
        keyHandler = onKey;
        document.addEventListener('keydown', keyHandler);
      }
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      _layouts: TaskLayout[],
    ): void {
      if (!host) return;
      const { config, scrollX } = state;
      const headerHeight = config.headerHeight;
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const canvasWidthCss = ctx.canvas.width / dpr;
      const canvasHeightCss = ctx.canvas.height / dpr;
      const bodyTop = headerHeight;
      const bodyHeight = canvasHeightCss - bodyTop;

      let timeScale: { dateToX: (date: Date) => number };
      try {
        timeScale = host.getTimeScale();
      } catch {
        return;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bodyTop, canvasWidthCss, bodyHeight);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      // ── NOW bracket ─────────────────────────────────────────────────────
      if (showNowBracket) {
        const nowX = timeScale.dateToX(new Date());
        ctx.save();
        ctx.strokeStyle = nowBracketColor;
        ctx.lineWidth = 3;
        // Top tick
        ctx.beginPath();
        ctx.moveTo(nowX - 6, bodyTop + 1);
        ctx.lineTo(nowX + 6, bodyTop + 1);
        // Bottom tick
        ctx.moveTo(nowX - 6, bodyTop + bodyHeight - 1);
        ctx.lineTo(nowX + 6, bodyTop + bodyHeight - 1);
        ctx.stroke();
        ctx.restore();
      }

      // ── Cursor line ─────────────────────────────────────────────────────
      const cursor = state.timeCursorDate;
      if (cursor) {
        const cx = timeScale.dateToX(cursor);
        ctx.save();
        ctx.strokeStyle = cursorColor;
        ctx.lineWidth = cursorWidth;
        ctx.beginPath();
        ctx.moveTo(cx, bodyTop);
        ctx.lineTo(cx, bodyTop + bodyHeight);
        ctx.stroke();
        // Cursor head — small triangle at top for grab-targeting visual
        ctx.fillStyle = cursorColor;
        ctx.beginPath();
        ctx.moveTo(cx - 6, bodyTop);
        ctx.lineTo(cx + 6, bodyTop);
        ctx.lineTo(cx, bodyTop + 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    },

    destroy(): void {
      if (keyHandler && typeof document !== 'undefined') {
        document.removeEventListener('keydown', keyHandler);
      }
      keyHandler = null;
      host = null;
      gantt = null;
    },
  };
}
