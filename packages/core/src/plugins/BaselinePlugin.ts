// ─── Baseline Comparison Plugin ─────────────────────────────────────────────
// Renders translucent "ghost bars" beneath each task bar showing the original
// planned schedule (baseline). Visually highlights schedule variance:
//   - Green tint: task is ahead of baseline
//   - Red tint: task is behind baseline
//   - Deviation label: shows days ahead/behind

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
} from '../model/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BaselineEntry {
  id: string;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string;   // ISO YYYY-MM-DD
}

export interface BaselinePluginOptions {
  baselineTasks: BaselineEntry[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const GHOST_HEIGHT_RATIO = 0.6;   // 60% of bar height
const GHOST_OPACITY = 0.25;
const AHEAD_COLOR = '#38A169';     // Green
const BEHIND_COLOR = '#E53E3E';    // Red
const ON_TRACK_COLOR = '#A0AEC0';  // Gray
const DEVIATION_FONT_SIZE = 10;
const DEVIATION_PADDING_X = 4;
const DEVIATION_BADGE_HEIGHT = 16;
const DEVIATION_BADGE_RADIUS = 3;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD to UTC Date */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

/** Difference in days between two dates (b - a) */
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function BaselinePlugin(options: BaselinePluginOptions): NimbusGanttPlugin {
  // Build a lookup map from task ID to baseline dates
  const baselineMap = new Map<string, { start: Date; end: Date }>();
  for (const entry of options.baselineTasks) {
    baselineMap.set(entry.id, {
      start: parseDate(entry.startDate),
      end: parseDate(entry.endDate),
    });
  }

  let host: PluginHost;

  return {
    name: 'BaselinePlugin',

    install(gantt: PluginHost): void {
      host = gantt;
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (baselineMap.size === 0) return;

      const { theme, headerHeight, barHeight } = state.config;
      const scrollX = state.scrollX;
      const scrollY = state.scrollY;
      const bodyTop = headerHeight;
      const timeScale = host.getTimeScale();
      const radius = theme.barBorderRadius;

      ctx.save();

      // Set up body clip and scroll translation
      ctx.beginPath();
      ctx.rect(0, bodyTop, ctx.canvas.width, ctx.canvas.height - bodyTop);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      const ghostH = barHeight * GHOST_HEIGHT_RATIO;

      for (const layout of layouts) {
        if (layout.isMilestone) continue;

        const baseline = baselineMap.get(layout.taskId);
        if (!baseline) continue;

        const barY = layout.barY - scrollY;

        // Skip bars outside visible area
        if (barY + barHeight + ghostH < bodyTop || barY > ctx.canvas.height) continue;

        // ── Compute ghost bar position from baseline dates ──────────
        const ghostX = timeScale.dateToX(baseline.start);
        const ghostEndX = timeScale.dateToX(baseline.end);
        const ghostW = Math.max(ghostEndX - ghostX, 2);

        // Position the ghost bar directly below the actual bar
        const ghostY = barY + barHeight + 1;

        // ── Determine variance ──────────────────────────────────────
        const actualStart = parseDate(
          state.tasks.get(layout.taskId)?.startDate || '',
        );
        const actualEnd = parseDate(
          state.tasks.get(layout.taskId)?.endDate || '',
        );

        // Positive = behind schedule (actual end is later than baseline end)
        // Negative = ahead of schedule
        const endDeviation = diffDays(baseline.end, actualEnd);

        let tintColor: string;
        if (endDeviation < 0) {
          tintColor = AHEAD_COLOR;
        } else if (endDeviation > 0) {
          tintColor = BEHIND_COLOR;
        } else {
          tintColor = ON_TRACK_COLOR;
        }

        // ── Draw ghost bar ──────────────────────────────────────────
        ctx.save();
        ctx.globalAlpha = GHOST_OPACITY;
        ctx.fillStyle = tintColor;

        // Rounded rectangle for ghost bar
        const gr = Math.min(radius, ghostW / 2, ghostH / 2);
        ctx.beginPath();
        ctx.moveTo(ghostX + gr, ghostY);
        ctx.lineTo(ghostX + ghostW - gr, ghostY);
        ctx.arcTo(ghostX + ghostW, ghostY, ghostX + ghostW, ghostY + gr, gr);
        ctx.lineTo(ghostX + ghostW, ghostY + ghostH - gr);
        ctx.arcTo(ghostX + ghostW, ghostY + ghostH, ghostX + ghostW - gr, ghostY + ghostH, gr);
        ctx.lineTo(ghostX + gr, ghostY + ghostH);
        ctx.arcTo(ghostX, ghostY + ghostH, ghostX, ghostY + ghostH - gr, gr);
        ctx.lineTo(ghostX, ghostY + gr);
        ctx.arcTo(ghostX, ghostY, ghostX + gr, ghostY, gr);
        ctx.closePath();
        ctx.fill();

        // Draw a border on the ghost bar at slightly higher opacity
        ctx.globalAlpha = GHOST_OPACITY * 2;
        ctx.strokeStyle = tintColor;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();

        // ── Draw deviation indicator ────────────────────────────────
        if (endDeviation !== 0) {
          const deviationText = endDeviation > 0
            ? `+${endDeviation}d`
            : `${endDeviation}d`;

          ctx.save();
          ctx.font = `600 ${DEVIATION_FONT_SIZE}px ${theme.fontFamily}`;

          const textMetrics = ctx.measureText(deviationText);
          const textWidth = textMetrics.width;
          const badgeW = textWidth + DEVIATION_PADDING_X * 2;

          // Position the badge to the right of the actual bar
          const badgeX = layout.x + layout.width + 4;
          const badgeY = ghostY + (ghostH - DEVIATION_BADGE_HEIGHT) / 2;

          // Badge background
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = tintColor;

          const br = DEVIATION_BADGE_RADIUS;
          ctx.beginPath();
          ctx.moveTo(badgeX + br, badgeY);
          ctx.lineTo(badgeX + badgeW - br, badgeY);
          ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + br, br);
          ctx.lineTo(badgeX + badgeW, badgeY + DEVIATION_BADGE_HEIGHT - br);
          ctx.arcTo(badgeX + badgeW, badgeY + DEVIATION_BADGE_HEIGHT, badgeX + badgeW - br, badgeY + DEVIATION_BADGE_HEIGHT, br);
          ctx.lineTo(badgeX + br, badgeY + DEVIATION_BADGE_HEIGHT);
          ctx.arcTo(badgeX, badgeY + DEVIATION_BADGE_HEIGHT, badgeX, badgeY + DEVIATION_BADGE_HEIGHT - br, br);
          ctx.lineTo(badgeX, badgeY + br);
          ctx.arcTo(badgeX, badgeY, badgeX + br, badgeY, br);
          ctx.closePath();
          ctx.fill();

          // Badge text
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            deviationText,
            badgeX + badgeW / 2,
            badgeY + DEVIATION_BADGE_HEIGHT / 2,
          );

          ctx.restore();
        }
      }

      ctx.restore();
    },

    destroy(): void {
      // No subscriptions to clean up
    },
  };
}
