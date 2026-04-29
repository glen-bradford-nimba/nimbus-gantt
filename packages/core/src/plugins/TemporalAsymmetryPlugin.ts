// ─── Temporal Asymmetry Plugin (0.186.0) ───────────────────────────────────
// Past concrete, future ghosty. Bars rendered as solid/full-opacity when
// they end before today; faded with dashed border when they start after
// today; and split-rendered (concrete left, ghosty right) when they span
// the today line.
//
// Conceptual ancestor: Bret Victor's "Inventing on Principle" (2012,
// vimeo 36579366) — direct manipulation of past/future as visually
// distinct states. See docs/dispatch-ng-temporal-canvas.md for the full
// architectural plan; this plugin is the substrate-free first cut
// (0.186.0) — pure renderCanvas overlay, no event log, no time cursor.
//
// Renders as a translucent overlay AFTER the main bar pass — additively,
// without modifying CanvasRenderer.ts. The overlay paints:
//
//   - On bars entirely in the future: a translucent backgroundFill
//     overlay across the whole bar (visually fades the engine's bar
//     color toward the theme background) + a dashed outline.
//   - On bars spanning today: same overlay applied only to the right of
//     the today-X. The left side stays untouched (concrete past).
//   - On past completed bars (progress === 1): an optional ✓ checkmark
//     badge at the start of the bar.
//
// Bails on milestones (diamond markers stay full-strength) and on
// group-header rows (PriorityGroupingPlugin owns those visuals).
//
// Zero cost when not installed; opt-in via gantt.use(TemporalAsymmetryPlugin()).

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
} from '../model/types';

// ─── Public Options ────────────────────────────────────────────────────────

export interface TemporalAsymmetryOptions {
  /** Strength of the future-bar fade. 0 = no fade, 1 = fully washed out
   *  to background. Default 0.55 (visibly ghosty without losing color). */
  futureFadeStrength?: number;

  /** Color of the wash applied to future bars. Defaults to the theme's
   *  timeline background, which produces "fade toward backdrop" look.
   *  Override (e.g. '#ffffff') for explicit white-out. */
  futureFadeColor?: string;

  /** Whether to draw a dashed outline around the future portion of bars.
   *  Default true. Reads as "uncertain / forecast" visually. */
  futureDashedBorder?: boolean;

  /** Dash pattern for the future-portion border. Default [4, 3]. */
  futureDashPattern?: [number, number];

  /** Width of the dashed border. Default 1. */
  futureDashWidth?: number;

  /** Color of the dashed border. Defaults to a desaturated form of the
   *  bar's own color. Override for an explicit outline color. */
  futureDashColor?: string;

  /** Render a ✓ checkmark on past bars whose progress is >= 1.
   *  Default true. */
  pastShowCheckmark?: boolean;

  /** Checkmark color. Default white when bar is dark, dark grey otherwise
   *  — auto-contrasts. */
  pastCheckmarkColor?: string;

  /** Optionally pass an explicit "today" Date. Defaults to `new Date()`
   *  resolved at every render. Useful for tests / replay scenarios where
   *  callers want to fix the seam to a specific date. */
  todayProvider?: () => Date;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_FADE_STRENGTH = 0.55;
const DEFAULT_DASH: [number, number] = [4, 3];
const DEFAULT_DASH_WIDTH = 1;
const DEFAULT_CHECKMARK_GAP = 4;
const DEFAULT_CHECKMARK_FONT = 600;

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function TemporalAsymmetryPlugin(
  opts: TemporalAsymmetryOptions = {},
): NimbusGanttPlugin {
  let host: PluginHost | null = null;

  const fadeStrength = clamp(opts.futureFadeStrength ?? DEFAULT_FADE_STRENGTH, 0, 1);
  const futureDashed = opts.futureDashedBorder !== false;
  const dashPattern = opts.futureDashPattern ?? DEFAULT_DASH;
  const dashWidth = opts.futureDashWidth ?? DEFAULT_DASH_WIDTH;
  const showCheckmark = opts.pastShowCheckmark !== false;
  const todayProvider = opts.todayProvider ?? (() => new Date());

  return {
    name: 'TemporalAsymmetryPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!host) return;
      if (layouts.length === 0) return;

      const { config, scrollX, scrollY, tasks } = state;
      const { theme } = config;
      const headerHeight = config.headerHeight;
      const radius = theme.barBorderRadius;

      // Resolve today X via the live TimeScale. host.getTimeScale() is
      // the safe accessor — see PluginHost contract in model/types.ts.
      const today = todayProvider();
      let todayX: number;
      try {
        todayX = host.getTimeScale().dateToX(today);
      } catch {
        // TimeScale not ready (pre-mount) — bail this frame.
        return;
      }

      const fadeColor =
        opts.futureFadeColor ?? theme.timelineBg ?? '#ffffff';
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const canvasWidthCss = ctx.canvas.width / dpr;
      const canvasHeightCss = ctx.canvas.height / dpr;

      ctx.save();

      // Match the body clip + scroll translation the main renderer uses,
      // mirroring MilestonePlugin's setup.
      const bodyTop = headerHeight;
      const bodyHeight = canvasHeightCss - bodyTop;

      ctx.beginPath();
      ctx.rect(0, bodyTop, canvasWidthCss, bodyHeight);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      for (const layout of layouts) {
        // Skip milestones (diamonds stay crisp) and group headers
        // (PriorityGroupingPlugin owns those visuals).
        if (layout.isMilestone) continue;
        const task = tasks.get(layout.taskId);
        if (!task) continue;
        if (task.status === 'group-header') continue;

        const barX = layout.x;
        const barY = layout.barY - scrollY;
        const barW = layout.width;
        const barH = layout.barHeight;

        // Cull bars fully outside vertical viewport.
        if (barY + barH < 0 || barY > bodyHeight) continue;

        const barRight = barX + barW;
        const isEntirelyFuture = barX >= todayX;
        const isEntirelyPast = barRight <= todayX;
        const spansToday = !isEntirelyFuture && !isEntirelyPast;

        // ── Future overlay ──────────────────────────────────────────
        if (isEntirelyFuture || spansToday) {
          const overlayX = isEntirelyFuture ? barX : todayX;
          const overlayW = isEntirelyFuture ? barW : barRight - todayX;
          if (overlayW > 0.5) {
            ctx.save();
            ctx.beginPath();
            roundedRectClipPath(ctx, barX, barY, barW, barH, radius);
            ctx.clip();
            ctx.globalAlpha = fadeStrength;
            ctx.fillStyle = fadeColor;
            ctx.fillRect(overlayX, barY, overlayW, barH);
            ctx.restore();
          }
        }

        // ── Future dashed border ─────────────────────────────────────
        if (futureDashed && (isEntirelyFuture || spansToday)) {
          const dashColor =
            opts.futureDashColor ?? desaturate(layout.color, 0.4);
          ctx.save();
          ctx.lineWidth = dashWidth;
          ctx.strokeStyle = dashColor;
          ctx.setLineDash(dashPattern);
          if (isEntirelyFuture) {
            // Outline the whole bar
            strokeRoundedRect(ctx, barX, barY, barW, barH, radius);
          } else {
            // Dashed line just along the future portion's top + bottom.
            // We avoid restroking the rounded corners of the bar; instead
            // a single dashed seam at todayX + horizontal dashes for the
            // future-half top/bottom edges signals the asymmetry without
            // double-painting the engine's existing border.
            const seamTop = barY + 0.5;
            const seamBot = barY + barH - 0.5;
            ctx.beginPath();
            // Top edge of future half
            ctx.moveTo(todayX, seamTop);
            ctx.lineTo(barRight - radius, seamTop);
            // Bottom edge of future half
            ctx.moveTo(todayX, seamBot);
            ctx.lineTo(barRight - radius, seamBot);
            // Vertical seam at todayX
            ctx.moveTo(todayX, barY);
            ctx.lineTo(todayX, barY + barH);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.restore();
        }

        // ── Past completion checkmark ────────────────────────────────
        if (
          showCheckmark &&
          isEntirelyPast &&
          (task.progress ?? 0) >= 1
        ) {
          const cx = barX + DEFAULT_CHECKMARK_GAP + 5;
          const cy = barY + barH / 2;
          const checkColor =
            opts.pastCheckmarkColor ?? autoContrastColor(layout.color);
          ctx.save();
          ctx.font = `${DEFAULT_CHECKMARK_FONT} ${Math.max(10, theme.fontSize - 1)}px ${theme.fontFamily}`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = checkColor;
          ctx.fillText('✓', cx - 5, cy);
          ctx.restore();
        }
      }

      ctx.restore();
    },

    destroy(): void {
      host = null;
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function roundedRectClipPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

function strokeRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  roundedRectClipPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

function desaturate(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  // Convert to grey by averaging, then mix back per amount.
  const grey = Math.round((rgb.r + rgb.g + rgb.b) / 3);
  const mix = (c: number) => Math.round(c * (1 - amount) + grey * amount);
  return rgbToHex(mix(rgb.r), mix(rgb.g), mix(rgb.b));
}

function autoContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#1f2937';
  // Standard luminance formula
  const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  return lum > 140 ? '#1f2937' : '#ffffff';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    return {
      r: parseInt(cleaned[0] + cleaned[0], 16),
      g: parseInt(cleaned[1] + cleaned[1], 16),
      b: parseInt(cleaned[2] + cleaned[2], 16),
    };
  }
  if (cleaned.length === 6) {
    return {
      r: parseInt(cleaned.substring(0, 2), 16),
      g: parseInt(cleaned.substring(2, 4), 16),
      b: parseInt(cleaned.substring(4, 6), 16),
    };
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(n, 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
