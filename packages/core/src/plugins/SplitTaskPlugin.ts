// ─── Split Task Plugin ──────────────────────────────────────────────────────
// Renders split/interrupted tasks as multiple bar segments with gaps.
// Each segment is a separate rounded rectangle, connected by dashed lines.
// Progress fill spans proportionally across all segments.
// Drag behavior moves all segments together; resize affects only edges.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
  Action,
} from '../model/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaskSplit {
  taskId: string;
  segments: Array<{
    startDate: string; // ISO YYYY-MM-DD
    endDate: string;   // ISO YYYY-MM-DD
  }>;
}

export interface SplitTaskPluginOptions {
  splits: TaskSplit[];
}

interface ComputedSegment {
  startX: number;
  endX: number;
  width: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DASH_PATTERN = [4, 3];
const DASH_LINE_WIDTH = 1.5;
const CONNECTOR_OPACITY = 0.5;
const GAP_STRIPE_OPACITY = 0.06;
const GAP_STRIPE_WIDTH = 4;
const GAP_STRIPE_SPACING = 8;
const PROGRESS_OPACITY = 0.35;
const SEGMENT_BORDER_WIDTH = 1;
const SEGMENT_BORDER_DARKEN = 0.2;
const LABEL_PADDING_X = 6;
const MS_PER_DAY = 86_400_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD to UTC Date */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format Date as YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Darken a hex color by a factor (0-1) */
function darkenColor(hex: string, amount: number): string {
  const cleaned = hex.replace('#', '');
  let r: number, g: number, b: number;
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else {
    r = parseInt(cleaned.substring(0, 2), 16);
    g = parseInt(cleaned.substring(2, 4), 16);
    b = parseInt(cleaned.substring(4, 6), 16);
  }
  r = Math.round(r * (1 - amount));
  g = Math.round(g * (1 - amount));
  b = Math.round(b * (1 - amount));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Draw a rounded rectangle path (does not fill or stroke) */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** Compute total duration in ms across all segments */
function totalSegmentDuration(segments: Array<{ startDate: string; endDate: string }>): number {
  let total = 0;
  for (const seg of segments) {
    const start = parseDate(seg.startDate).getTime();
    const end = parseDate(seg.endDate).getTime();
    total += Math.max(end - start, MS_PER_DAY); // At least 1 day
  }
  return total;
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function SplitTaskPlugin(options: SplitTaskPluginOptions): NimbusGanttPlugin {
  // Build a lookup map from task ID to split definition
  const splitMap = new Map<string, TaskSplit>();
  for (const split of options.splits) {
    splitMap.set(split.taskId, split);
  }

  let host: PluginHost | null = null;

  return {
    name: 'SplitTaskPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
    },

    // ── Middleware: adjust drag behavior for split tasks ──────────────────
    middleware(action: Action, next: (action: Action) => void): void {
      if (action.type === 'TASK_MOVE') {
        const split = splitMap.get(action.taskId);
        if (split && host) {
          // Compute the offset from the original task dates
          const state = host.getState();
          const task = state.tasks.get(action.taskId);
          if (task) {
            const originalStart = parseDate(task.startDate).getTime();
            const newStart = parseDate(action.startDate).getTime();
            const offsetMs = newStart - originalStart;

            // Shift all segments by the same offset
            const newSegments = split.segments.map((seg) => {
              const segStart = new Date(parseDate(seg.startDate).getTime() + offsetMs);
              const segEnd = new Date(parseDate(seg.endDate).getTime() + offsetMs);
              return {
                startDate: formatDate(segStart),
                endDate: formatDate(segEnd),
              };
            });

            // Update the split definition in place
            split.segments = newSegments;
          }
        }
      } else if (action.type === 'TASK_RESIZE') {
        const split = splitMap.get(action.taskId);
        if (split && host && split.segments.length > 0) {
          const state = host.getState();
          const task = state.tasks.get(action.taskId);
          if (task) {
            const originalStart = task.startDate;
            const originalEnd = task.endDate;

            // Determine which edge changed
            if (action.startDate !== originalStart) {
              // Left edge resize — adjust first segment's start
              split.segments[0] = {
                ...split.segments[0],
                startDate: action.startDate,
              };
            }
            if (action.endDate !== originalEnd) {
              // Right edge resize — adjust last segment's end
              const lastIdx = split.segments.length - 1;
              split.segments[lastIdx] = {
                ...split.segments[lastIdx],
                endDate: action.endDate,
              };
            }
          }
        }
      }

      next(action);
    },

    // ── Canvas Rendering ─────────────────────────────────────────────────
    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!host || splitMap.size === 0) return;

      const { config, scrollX, scrollY } = state;
      const { theme, headerHeight, barHeight } = config;
      const timeScale = host.getTimeScale();
      const radius = theme.barBorderRadius;
      const bodyTop = headerHeight;

      ctx.save();

      // Clip to body area (below header)
      ctx.beginPath();
      ctx.rect(0, bodyTop, ctx.canvas.width, ctx.canvas.height - bodyTop);
      ctx.clip();

      // Apply scroll translation
      ctx.translate(-scrollX, 0);

      for (const layout of layouts) {
        if (layout.isMilestone) continue;

        const split = splitMap.get(layout.taskId);
        if (!split || split.segments.length === 0) continue;

        const barY = layout.barY - scrollY;
        const barH = layout.barHeight;
        const centerY = barY + barH / 2;

        // Skip rows outside visible area
        if (barY + barH < bodyTop || barY > ctx.canvas.height) continue;

        // ── Compute segment X positions ────────────────────────────────
        const computedSegments: ComputedSegment[] = [];
        for (const seg of split.segments) {
          const startX = timeScale.dateToX(parseDate(seg.startDate));
          const endX = timeScale.dateToX(parseDate(seg.endDate));
          const width = Math.max(endX - startX, 4);
          computedSegments.push({ startX, endX: startX + width, width });
        }

        // ── 1. Clear the original bar area ─────────────────────────────
        // Draw over the original continuous bar with the timeline background
        // to "erase" it, then render segments instead
        ctx.save();
        ctx.fillStyle = theme.timelineBg;
        ctx.fillRect(layout.x - 1, barY - 1, layout.width + 2, barH + 2);

        // Also clear the original progress fill
        ctx.restore();

        // ── 2. Draw diagonal stripe pattern in gap areas ───────────────
        for (let i = 0; i < computedSegments.length - 1; i++) {
          const gapStartX = computedSegments[i].endX;
          const gapEndX = computedSegments[i + 1].startX;
          const gapWidth = gapEndX - gapStartX;

          if (gapWidth <= 0) continue;

          ctx.save();
          ctx.globalAlpha = GAP_STRIPE_OPACITY;
          ctx.strokeStyle = layout.color;
          ctx.lineWidth = GAP_STRIPE_WIDTH;

          // Clip to gap area
          ctx.beginPath();
          ctx.rect(gapStartX, barY, gapWidth, barH);
          ctx.clip();

          // Draw diagonal stripes
          for (let sx = gapStartX - barH; sx < gapEndX + barH; sx += GAP_STRIPE_SPACING) {
            ctx.beginPath();
            ctx.moveTo(sx, barY + barH);
            ctx.lineTo(sx + barH, barY);
            ctx.stroke();
          }

          ctx.restore();
        }

        // ── 3. Draw dashed connecting lines between segments ───────────
        for (let i = 0; i < computedSegments.length - 1; i++) {
          const fromX = computedSegments[i].endX;
          const toX = computedSegments[i + 1].startX;

          ctx.save();
          ctx.globalAlpha = CONNECTOR_OPACITY;
          ctx.strokeStyle = darkenColor(layout.color, SEGMENT_BORDER_DARKEN);
          ctx.lineWidth = DASH_LINE_WIDTH;
          ctx.setLineDash(DASH_PATTERN);

          ctx.beginPath();
          ctx.moveTo(fromX, centerY);
          ctx.lineTo(toX, centerY);
          ctx.stroke();

          ctx.setLineDash([]);
          ctx.restore();
        }

        // ── 4. Compute progress fill distribution ──────────────────────
        const task = state.tasks.get(layout.taskId);
        const progress = task?.progress ?? 0;
        const totalDuration = totalSegmentDuration(split.segments);
        const progressDuration = progress * totalDuration;

        let remainingProgress = progressDuration;

        // ── 5. Draw each segment ───────────────────────────────────────
        for (let i = 0; i < computedSegments.length; i++) {
          const seg = computedSegments[i];
          const segDuration = Math.max(
            parseDate(split.segments[i].endDate).getTime() -
            parseDate(split.segments[i].startDate).getTime(),
            MS_PER_DAY,
          );

          // ── Background fill ──────────────────────────────────────────
          ctx.save();
          roundedRectPath(ctx, seg.startX, barY, seg.width, barH, radius);
          ctx.fillStyle = layout.color;
          ctx.fill();

          // Border
          ctx.strokeStyle = darkenColor(layout.color, SEGMENT_BORDER_DARKEN);
          ctx.lineWidth = SEGMENT_BORDER_WIDTH;
          ctx.stroke();
          ctx.restore();

          // ── Progress fill ────────────────────────────────────────────
          if (remainingProgress > 0 && config.showProgress) {
            const segProgressDuration = Math.min(remainingProgress, segDuration);
            const segProgressRatio = segProgressDuration / segDuration;
            const progressW = seg.width * segProgressRatio;

            ctx.save();
            // Clip to segment shape
            roundedRectPath(ctx, seg.startX, barY, seg.width, barH, radius);
            ctx.clip();

            ctx.globalAlpha = PROGRESS_OPACITY;
            ctx.fillStyle = darkenColor(layout.color, 0.3);
            ctx.fillRect(seg.startX, barY, progressW, barH);
            ctx.restore();

            remainingProgress -= segProgressDuration;
          }
        }

        // ── 6. Draw task label ─────────────────────────────────────────
        if (layout.label) {
          const firstSeg = computedSegments[0];
          const lastSeg = computedSegments[computedSegments.length - 1];
          const totalSpan = lastSeg.endX - firstSeg.startX;

          ctx.save();
          ctx.font = `${theme.fontSize}px ${theme.fontFamily}`;
          const textMetrics = ctx.measureText(layout.label);
          const textWidth = textMetrics.width;

          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          if (textWidth + LABEL_PADDING_X * 2 <= firstSeg.width) {
            // Text fits in first segment
            ctx.fillStyle = layout.textColor;

            // Clip to first segment
            roundedRectPath(ctx, firstSeg.startX, barY, firstSeg.width, barH, radius);
            ctx.clip();
            ctx.fillText(layout.label, firstSeg.startX + LABEL_PADDING_X, centerY);
          } else if (textWidth + LABEL_PADDING_X <= totalSpan) {
            // Text spans across segments — draw over gaps too
            ctx.fillStyle = layout.textColor;
            ctx.fillText(layout.label, firstSeg.startX + LABEL_PADDING_X, centerY);
          } else {
            // Text doesn't fit — draw it after the last segment
            ctx.fillStyle = theme.gridTextColor;
            ctx.fillText(layout.label, lastSeg.endX + LABEL_PADDING_X, centerY);
          }

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
