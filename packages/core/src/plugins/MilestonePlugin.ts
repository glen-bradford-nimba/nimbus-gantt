// ─── Milestone Plugin ───────────────────────────────────────────────────────
// Enhanced milestone rendering with diamond markers, flag icons, labels,
// and vertical date reference lines.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
} from '../model/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const MILESTONE_COLOR = '#D4A017';  // Gold/amber
const MILESTONE_LINE_COLOR = 'rgba(212, 160, 23, 0.25)';
const MILESTONE_LINE_DASH = [6, 4];
const MILESTONE_LINE_WIDTH = 1;
const DIAMOND_INSET = 2;
const FLAG_GAP = 4;
const FLAG_WIDTH = 8;
const FLAG_HEIGHT = 10;
const FLAG_POLE_HEIGHT = 16;
const LABEL_GAP = 6;

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function MilestonePlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;

  return {
    name: 'MilestonePlugin',

    install(gantt: PluginHost): void {
      host = gantt;
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!host) return;

      const { config, scrollX, scrollY } = state;
      const { theme } = config;
      const headerHeight = config.headerHeight;

      // Filter to milestone layouts only
      const milestoneLayouts = layouts.filter((l) => l.isMilestone);
      if (milestoneLayouts.length === 0) return;

      // The canvas context at this point has DPI scaling applied and is in the
      // body coordinate space (after the main renderer). We need to draw in the
      // same coordinate system as the main renderer's body content.

      ctx.save();

      // Clip to body area (below header)
      const bodyTop = headerHeight;
      const bodyHeight = ctx.canvas.height / (window.devicePixelRatio || 1) - bodyTop;

      ctx.beginPath();
      ctx.rect(0, bodyTop, ctx.canvas.width / (window.devicePixelRatio || 1), bodyHeight);
      ctx.clip();

      // Apply scroll translation to match the main renderer's body coordinate system
      ctx.translate(-scrollX, 0);

      for (const layout of milestoneLayouts) {
        const cx = layout.x;
        const barY = layout.barY - scrollY;
        const barH = layout.barHeight;
        const cy = barY + barH / 2;
        const color = layout.color === theme.barDefaultColor
          ? MILESTONE_COLOR
          : (layout.color || MILESTONE_COLOR);

        // ── 1. Vertical dashed reference line ───────────────────────────
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = MILESTONE_LINE_COLOR;
        ctx.lineWidth = MILESTONE_LINE_WIDTH;
        ctx.setLineDash(MILESTONE_LINE_DASH);
        ctx.moveTo(cx, bodyTop);
        ctx.lineTo(cx, bodyTop + bodyHeight);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // ── 2. Diamond shape ────────────────────────────────────────────
        const size = (barH - DIAMOND_INSET * 2) / 2;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy - size);       // top
        ctx.lineTo(cx + size, cy);       // right
        ctx.lineTo(cx, cy + size);       // bottom
        ctx.lineTo(cx - size, cy);       // left
        ctx.closePath();

        ctx.fillStyle = color;
        ctx.fill();

        // Add a subtle border for definition
        ctx.strokeStyle = darkenColor(color, 0.25);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // ── 3. Flag/pennant icon to the right of the diamond ────────────
        const flagX = cx + size + FLAG_GAP;
        const flagTopY = cy - FLAG_POLE_HEIGHT / 2;

        ctx.save();

        // Flag pole (thin vertical line)
        ctx.beginPath();
        ctx.strokeStyle = darkenColor(color, 0.15);
        ctx.lineWidth = 1.5;
        ctx.moveTo(flagX, flagTopY);
        ctx.lineTo(flagX, flagTopY + FLAG_POLE_HEIGHT);
        ctx.stroke();

        // Pennant triangle
        ctx.beginPath();
        ctx.moveTo(flagX, flagTopY);
        ctx.lineTo(flagX + FLAG_WIDTH, flagTopY + FLAG_HEIGHT / 2);
        ctx.lineTo(flagX, flagTopY + FLAG_HEIGHT);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        ctx.restore();

        // ── 4. Task name label ──────────────────────────────────────────
        if (layout.label) {
          const labelX = flagX + FLAG_WIDTH + LABEL_GAP;
          const labelY = cy;

          ctx.save();
          ctx.font = `600 ${theme.fontSize}px ${theme.fontFamily}`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = theme.gridTextColor;
          ctx.fillText(layout.label, labelX, labelY);
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

// ─── Color Utility ──────────────────────────────────────────────────────────

function darkenColor(hex: string, amount: number): string {
  const cleaned = hex.replace('#', '');
  let r: number;
  let g: number;
  let b: number;

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
