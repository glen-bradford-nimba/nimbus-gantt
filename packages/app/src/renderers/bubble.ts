/**
 * renderers/bubble.ts — Bubble chart renderer (time × group, size by hours).
 * Ported from cloudnimbusllc.com/src/components/gantt-demo/renderers/BubbleRenderer.ts.
 * DemoTask references replaced with NormalizedTask.
 */

import type { NormalizedTask } from '../types';

export interface BubbleRenderOptions {
  colorMap: Record<string, string>;
  hoveredId?: string | null;
  theme: {
    bg: string;
    text: string;
    altRowBg: string;
    textMuted: string;
    gridLine: string;
    todayLine: string;
    font: string;
  };
}

function parseDate(s: string): number { return new Date(s).getTime(); }

/**
 * Render a bubble chart onto the given canvas context.
 * X-axis = time (task midpoint), Y-axis = priority group row,
 * bubble radius = sqrt(estimatedHours).
 */
export function renderBubble(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tasks: NormalizedTask[],
  opts: BubbleRenderOptions,
): void {
  const { theme, colorMap, hoveredId } = opts;
  const pad     = 16;
  const titleH  = 40;
  const labelW  = 120;
  const bottomH = 36;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = theme.text;
  ctx.font = `bold 16px ${theme.font}`;
  ctx.textAlign = 'center';
  ctx.fillText('Bubble Chart — Size by Hours', w / 2, titleH / 2 + 6);

  /* Filter tasks that have start and end dates */
  const valid = tasks.filter(t => t.startDate && t.endDate && (t.estimatedHours || 0) > 0);
  if (valid.length === 0) return;

  const chartX = labelW + pad;
  const chartY = titleH + pad;
  const chartW = w - chartX - pad;
  const chartH = h - chartY - bottomH - pad;

  /* Group rows */
  const groupNames = Array.from(new Set(valid.map(t => t.priorityGroup || t.stage || 'Other')));
  const allDates   = valid.flatMap(t => [parseDate(t.startDate!), parseDate(t.endDate!)]);
  const minDate    = Math.min(...allDates);
  const maxDate    = Math.max(...allDates);
  const dateRange  = maxDate - minDate || 1;

  const rowH       = chartH / groupNames.length;
  const maxHours   = Math.max(...valid.map(t => Number(t.estimatedHours) || 0), 1);
  const scaleFactor = Math.min(rowH * 0.35, 28) / Math.sqrt(maxHours);

  /* Grid rows */
  for (let i = 0; i < groupNames.length; i++) {
    const rowY = chartY + i * rowH;
    if (i % 2 === 1) {
      ctx.fillStyle = theme.altRowBg;
      ctx.fillRect(chartX, rowY, chartW, rowH);
    }
    ctx.strokeStyle = theme.gridLine;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(chartX, rowY + rowH);
    ctx.lineTo(chartX + chartW, rowY + rowH);
    ctx.stroke();

    ctx.fillStyle = theme.text;
    ctx.font = `12px ${theme.font}`;
    ctx.textAlign = 'right';
    ctx.fillText(groupNames[i], chartX - 10, rowY + rowH / 2 + 4);
  }

  /* Today line */
  const today = Date.now();
  if (today >= minDate && today <= maxDate) {
    const tx = chartX + ((today - minDate) / dateRange) * chartW;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = theme.todayLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, chartY);
    ctx.lineTo(tx, chartY + chartH);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = theme.todayLine;
    ctx.font = `bold 10px ${theme.font}`;
    ctx.textAlign = 'center';
    ctx.fillText('Today', tx, chartY - 4);
  }

  /* Month labels */
  ctx.fillStyle = theme.textMuted;
  ctx.font = `10px ${theme.font}`;
  ctx.textAlign = 'center';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const startD = new Date(minDate);
  const endD   = new Date(maxDate);
  const cur    = new Date(startD.getFullYear(), startD.getMonth(), 1);
  while (cur <= endD) {
    const t = cur.getTime();
    if (t >= minDate) {
      const mx = chartX + ((t - minDate) / dateRange) * chartW;
      ctx.fillText(months[cur.getMonth()] + ' ' + cur.getFullYear().toString().slice(2), mx, chartY + chartH + 16);
    }
    cur.setMonth(cur.getMonth() + 1);
  }

  /* Bubbles */
  for (const task of valid) {
    const midTime = (parseDate(task.startDate!) + parseDate(task.endDate!)) / 2;
    const grpKey  = task.priorityGroup || task.stage || 'Other';
    const gIdx    = groupNames.indexOf(grpKey);
    const bx      = chartX + ((midTime - minDate) / dateRange) * chartW;
    const by      = chartY + gIdx * rowH + rowH / 2;
    const r       = Math.max(Math.sqrt(Number(task.estimatedHours) || 0) * scaleFactor, 4);
    const color   = colorMap[task.stage || ''] || '#6b7280';

    /* Shadow */
    ctx.beginPath();
    ctx.arc(bx + 1, by + 1, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fill();

    /* Circle */
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;

    /* Hover ring */
    if (hoveredId === task.id) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    /* Label inside if big enough */
    if (r > 18) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold 9px ${theme.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const name     = task.title || task.name || task.id;
      const maxChars = Math.floor((r * 2) / 6);
      const label    = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
      ctx.fillText(label, bx, by);
      ctx.textBaseline = 'alphabetic';
    }
  }

  ctx.textBaseline = 'alphabetic';
}
