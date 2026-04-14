/**
 * renderers/treemap.ts — Squarified treemap renderer.
 * Ported from cloudnimbusllc.com/src/components/gantt-demo/renderers/TreemapRenderer.ts.
 * DemoTask references replaced with NormalizedTask.
 */

import type { NormalizedTask } from '../types';

interface Rect { x: number; y: number; w: number; h: number; task?: NormalizedTask; label?: string; }

export interface TreemapRenderOptions {
  colorMap: Record<string, string>;
  hoveredId?: string | null;
  theme: {
    bg: string;
    text: string;
    altRowBg: string;
    textMuted: string;
    font: string;
  };
}

function squarify(
  items: Array<{ area: number; task?: NormalizedTask; label?: string }>,
  rect: Rect,
): Rect[] {
  items = items.filter(i => i.area > 0);
  if (items.length === 0) return [];
  const total = items.reduce((s, i) => s + i.area, 0);
  if (total <= 0) return [];
  const rects: Rect[] = [];
  let { x, y, w, h } = rect;
  for (const item of items) {
    const ratio = item.area / total;
    if (w >= h) {
      const iw = w * ratio;
      rects.push({ x, y, w: iw, h, task: item.task, label: item.label });
      x += iw; w -= iw;
    } else {
      const ih = h * ratio;
      rects.push({ x, y, w, h: ih, task: item.task, label: item.label });
      y += ih; h -= ih;
    }
  }
  return rects;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  if (w <= 0 || h <= 0) return;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Render a squarified treemap onto the given canvas context.
 * Area is proportional to estimatedHours; colour is driven by stage via colorMap.
 */
export function renderTreemap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tasks: NormalizedTask[],
  opts: TreemapRenderOptions,
): void {
  const { theme, colorMap, hoveredId } = opts;
  const pad    = 16;
  const titleH = 40;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = theme.text;
  ctx.font = `bold 16px ${theme.font}`;
  ctx.textAlign = 'center';
  ctx.fillText('Task Treemap — Area by Hours', w / 2, titleH / 2 + 6);

  const areaX = pad, areaY = titleH + pad / 2;
  const areaW = w - pad * 2, areaH = h - titleH - pad;

  /* Filter: must have hours, must have dates */
  const validTasks = tasks.filter(
    t => !t.isInactive && (t.estimatedHours || 0) > 0 && t.startDate && t.endDate,
  );
  if (validTasks.length === 0) return;

  /* Group by priorityGroup (or stage as fallback) */
  const groups = new Map<string, NormalizedTask[]>();
  for (const t of validTasks) {
    const key = t.priorityGroup || t.stage || 'Other';
    const arr = groups.get(key) || [];
    arr.push(t);
    groups.set(key, arr);
  }

  const groupItems = Array.from(groups.entries()).map(([name, ts]) => ({
    area: ts.reduce((s, t) => s + (Number(t.estimatedHours) || 0), 0),
    label: name,
    tasks: ts,
  }));
  groupItems.sort((a, b) => b.area - a.area);

  const groupRects = squarify(
    groupItems.map(g => ({ area: g.area, label: g.label })),
    { x: areaX, y: areaY, w: areaW, h: areaH },
  );

  for (let gi = 0; gi < groupRects.length; gi++) {
    const gr    = groupRects[gi];
    const gData = groupItems[gi];
    const inset = 3;

    ctx.fillStyle = theme.altRowBg;
    roundRect(ctx, gr.x + inset, gr.y + inset, gr.w - inset * 2, gr.h - inset * 2, 8);
    ctx.fill();

    const labelH = gr.h > 50 ? 22 : 0;
    if (labelH > 0) {
      ctx.fillStyle = theme.textMuted;
      ctx.font = `bold 11px ${theme.font}`;
      ctx.textAlign = 'left';
      ctx.fillText(gData.label, gr.x + inset + 8, gr.y + inset + 15);
    }

    const taskItems = gData.tasks
      .map(t => ({ area: Number(t.estimatedHours) || 0, task: t }))
      .sort((a, b) => b.area - a.area);

    const innerPad  = 4;
    const taskRects = squarify(taskItems, {
      x: gr.x + inset + innerPad,
      y: gr.y + inset + labelH + innerPad,
      w: gr.w - inset * 2 - innerPad * 2,
      h: gr.h - inset * 2 - labelH - innerPad * 2,
    });

    for (const tr of taskRects) {
      if (tr.w < 2 || tr.h < 2) continue;
      const color = (tr.task && colorMap[tr.task.stage || '']) || '#6b7280';

      ctx.fillStyle = color;
      roundRect(ctx, tr.x + 1, tr.y + 1, tr.w - 2, tr.h - 2, 5);
      ctx.fill();

      if (hoveredId && tr.task && tr.task.id === hoveredId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        roundRect(ctx, tr.x + 1, tr.y + 1, tr.w - 2, tr.h - 2, 5);
        ctx.stroke();
      }

      if (tr.w > 50 && tr.h > 28 && tr.task) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold 10px ${theme.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cx = tr.x + tr.w / 2, cy = tr.y + tr.h / 2;
        const maxChars = Math.floor(tr.w / 7);
        const name = tr.task.title || tr.task.name || tr.task.id;
        const label = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
        ctx.fillText(label, cx, cy - 7);
        ctx.font = `10px ${theme.font}`;
        ctx.fillText((Number(tr.task.estimatedHours) || 0) + 'h', cx, cy + 7);
      }
    }
  }

  ctx.textBaseline = 'alphabetic';
}
