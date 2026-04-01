// ─── Export Plugin ──────────────────────────────────────────────────────────
// Exports the Gantt chart as PNG or SVG. Renders the full content (not just
// the visible viewport) into an offscreen canvas or SVG document, then
// triggers a browser download.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
  ResolvedTheme,
  ResolvedConfig,
  HeaderCell,
  TimeScaleAPI,
  GanttTask,
} from '../model/types';

// ─── Constants ────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const HEADER_SEPARATOR_WIDTH = 1;
const TODAY_LINE_WIDTH = 2;
const GRID_LINE_WIDTH = 0.5;
const MILESTONE_INSET = 2;
const BAR_TEXT_PADDING_X = 8;
const BAR_TEXT_PADDING_OUTSIDE = 6;
const SELECTION_BORDER_WIDTH = 2;

/** Maximum single-canvas dimension before we tile. */
const MAX_CANVAS_DIM = 10000;

// ─── Helpers ──────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

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

function snapToPixel(x: number): number {
  return Math.round(x) + 0.5;
}

// ─── Grid Rendering for Export ────────────────────────────────────────────

function getCellValue(task: GanttTask, field: string): string {
  const raw =
    (task as unknown as Record<string, unknown>)[field] ??
    task.metadata?.[field] ??
    '';
  if (raw === null || raw === undefined) return '';
  return String(raw);
}

function renderGridToCanvas(
  ctx: CanvasRenderingContext2D,
  state: GanttState,
  gridWidth: number,
  totalHeight: number,
): void {
  const { config } = state;
  const theme = config.theme;
  const columns = config.columns;
  const rowHeight = config.rowHeight;
  const headerHeight = config.headerHeight;

  // Grid background
  ctx.fillStyle = theme.gridBg;
  ctx.fillRect(0, 0, gridWidth, totalHeight);

  // Grid header background
  ctx.fillStyle = theme.gridHeaderBg;
  ctx.fillRect(0, 0, gridWidth, headerHeight);

  // Header text
  ctx.font = `600 ${theme.fontSize}px ${theme.fontFamily}`;
  ctx.fillStyle = theme.gridHeaderText;
  ctx.textBaseline = 'middle';

  let colX = 0;
  for (const col of columns) {
    const colW = col.width ?? 120;
    ctx.save();
    ctx.beginPath();
    ctx.rect(colX, 0, colW, headerHeight);
    ctx.clip();
    ctx.textAlign = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left';
    const textX = col.align === 'right' ? colX + colW - 8
      : col.align === 'center' ? colX + colW / 2
      : colX + 8;
    ctx.fillText(col.header, textX, headerHeight / 2);
    ctx.restore();

    // Column separator
    ctx.beginPath();
    ctx.strokeStyle = theme.gridBorderColor;
    ctx.lineWidth = 1;
    ctx.moveTo(colX + colW, 0);
    ctx.lineTo(colX + colW, totalHeight);
    ctx.stroke();

    colX += colW;
  }

  // Header bottom border
  ctx.beginPath();
  ctx.strokeStyle = theme.gridBorderColor;
  ctx.lineWidth = 1;
  ctx.moveTo(0, headerHeight);
  ctx.lineTo(gridWidth, headerHeight);
  ctx.stroke();

  // Rows
  ctx.font = `${theme.fontSize}px ${theme.fontFamily}`;
  ctx.fillStyle = theme.gridTextColor;

  const visibleIds = state.flatVisibleIds;
  for (let i = 0; i < visibleIds.length; i++) {
    const task = state.tasks.get(visibleIds[i]);
    if (!task) continue;

    const rowY = headerHeight + i * rowHeight;

    // Alternating row background
    if (i % 2 === 1) {
      ctx.fillStyle = theme.gridAltRowBg;
      ctx.fillRect(0, rowY, gridWidth, rowHeight);
    }

    // Row bottom border
    ctx.beginPath();
    ctx.strokeStyle = theme.gridBorderColor;
    ctx.lineWidth = 0.5;
    ctx.moveTo(0, rowY + rowHeight);
    ctx.lineTo(gridWidth, rowY + rowHeight);
    ctx.stroke();

    // Cell values
    let cellX = 0;
    ctx.fillStyle = theme.gridTextColor;
    for (const col of columns) {
      const colW = col.width ?? 120;
      const value = getCellValue(task, col.field);

      ctx.save();
      ctx.beginPath();
      ctx.rect(cellX, rowY, colW, rowHeight);
      ctx.clip();

      ctx.textBaseline = 'middle';
      const indent = col.tree ? 8 : 0;
      ctx.textAlign = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left';
      const tx = col.align === 'right' ? cellX + colW - 8
        : col.align === 'center' ? cellX + colW / 2
        : cellX + 8 + indent;
      ctx.fillText(value, tx, rowY + rowHeight / 2);

      ctx.restore();

      cellX += colW;
    }
  }

  // Right border of grid
  ctx.beginPath();
  ctx.strokeStyle = theme.gridBorderColor;
  ctx.lineWidth = 1;
  ctx.moveTo(gridWidth - 0.5, 0);
  ctx.lineTo(gridWidth - 0.5, totalHeight);
  ctx.stroke();
}

// ─── Timeline Rendering for Export ────────────────────────────────────────

interface ExportTimeScale {
  dateToX(date: Date): number;
  getColumnWidth(): number;
  getTotalWidth(): number;
  getHeaderRows(): HeaderCell[][];
  getGridLines(): number[];
}

function renderTimelineToCanvas(
  ctx: CanvasRenderingContext2D,
  state: GanttState,
  layouts: TaskLayout[],
  timeScale: ExportTimeScale,
  offsetX: number,
): void {
  const { config } = state;
  const theme = config.theme;
  const headerHeight = config.headerHeight;
  const rowHeight = config.rowHeight;
  const totalTimelineWidth = timeScale.getTotalWidth();
  const bodyHeight = state.flatVisibleIds.length * rowHeight;
  const totalHeight = headerHeight + bodyHeight;

  // Timeline background
  ctx.fillStyle = theme.timelineBg;
  ctx.fillRect(offsetX, 0, totalTimelineWidth, totalHeight);

  // Weekend shading
  if (config.showWeekends) {
    const { start, end } = state.dateRange;
    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);
    const endTime = end.getTime();

    while (current.getTime() <= endTime) {
      const dayOfWeek = current.getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const x = offsetX + timeScale.dateToX(current);
        const nextDay = new Date(current.getTime() + MS_PER_DAY);
        const xEnd = offsetX + timeScale.dateToX(nextDay);
        ctx.fillStyle = theme.timelineWeekendBg;
        ctx.fillRect(x, headerHeight, xEnd - x, bodyHeight);
      }
      current.setTime(current.getTime() + MS_PER_DAY);
    }
  }

  // Grid lines
  const gridLines = timeScale.getGridLines();
  ctx.beginPath();
  ctx.strokeStyle = theme.timelineGridColor;
  ctx.lineWidth = GRID_LINE_WIDTH;
  for (const lineX of gridLines) {
    const px = snapToPixel(offsetX + lineX);
    ctx.moveTo(px, headerHeight);
    ctx.lineTo(px, totalHeight);
  }
  ctx.stroke();

  // Alternating row stripes
  for (let i = 0; i < state.flatVisibleIds.length; i++) {
    if (i % 2 === 1) {
      ctx.fillStyle = theme.gridAltRowBg;
      ctx.fillRect(offsetX, headerHeight + i * rowHeight, totalTimelineWidth, rowHeight);
    }
  }

  // Today marker
  if (config.showToday) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const { start, end } = state.dateRange;
    if (now.getTime() >= start.getTime() && now.getTime() <= end.getTime()) {
      const todayX = offsetX + timeScale.dateToX(now);
      const colWidth = timeScale.getColumnWidth();

      // Today background
      ctx.fillStyle = theme.todayBg;
      ctx.fillRect(todayX, headerHeight, colWidth, bodyHeight);

      // Today line
      ctx.beginPath();
      ctx.strokeStyle = theme.todayLineColor;
      ctx.lineWidth = TODAY_LINE_WIDTH;
      ctx.moveTo(snapToPixel(todayX), headerHeight);
      ctx.lineTo(snapToPixel(todayX), totalHeight);
      ctx.stroke();
    }
  }

  // Task bars
  const radius = theme.barBorderRadius;
  for (const layout of layouts) {
    const barX = offsetX + layout.x;
    const barY = layout.barY;
    const barW = layout.width;
    const barH = layout.barHeight;

    if (layout.isMilestone) {
      // Diamond
      const size = (barH - MILESTONE_INSET * 2) / 2;
      const cy = barY + barH / 2;
      ctx.beginPath();
      ctx.moveTo(barX, cy - size);
      ctx.lineTo(barX + size, cy);
      ctx.lineTo(barX, cy + size);
      ctx.lineTo(barX - size, cy);
      ctx.closePath();
      ctx.fillStyle = layout.color;
      ctx.fill();
      continue;
    }

    // Main bar
    roundedRect(ctx, barX, barY, barW, barH, radius);
    ctx.fillStyle = layout.color;
    ctx.fill();

    // Progress fill
    if (config.showProgress && layout.progressWidth > 0) {
      const progressColor = darkenColor(layout.color, 0.2);
      ctx.save();
      ctx.beginPath();
      roundedRect(ctx, barX, barY, barW, barH, radius);
      ctx.clip();
      ctx.fillStyle = progressColor;
      ctx.fillRect(barX, barY, layout.progressWidth, barH);
      ctx.restore();
    }

    // Selection border
    if (state.selectedIds.has(layout.taskId)) {
      ctx.beginPath();
      roundedRect(ctx, barX, barY, barW, barH, radius);
      ctx.strokeStyle = theme.barSelectedBorder;
      ctx.lineWidth = SELECTION_BORDER_WIDTH;
      ctx.stroke();
    }

    // Label
    if (layout.label) {
      ctx.save();
      ctx.font = `${theme.fontSize}px ${theme.fontFamily}`;
      ctx.textBaseline = 'middle';
      const textWidth = ctx.measureText(layout.label).width;
      const textY = barY + barH / 2;
      const fitsInside = textWidth + BAR_TEXT_PADDING_X * 2 <= barW;

      if (fitsInside) {
        ctx.beginPath();
        ctx.rect(barX, barY, barW, barH);
        ctx.clip();
        ctx.fillStyle = layout.textColor;
        ctx.textAlign = 'left';
        ctx.fillText(layout.label, barX + BAR_TEXT_PADDING_X, textY);
      } else {
        ctx.fillStyle = theme.gridTextColor;
        ctx.textAlign = 'left';
        ctx.fillText(layout.label, barX + barW + BAR_TEXT_PADDING_OUTSIDE, textY);
      }
      ctx.restore();
    }
  }

  // Dependency arrows
  renderDependencies(ctx, state, layouts, theme, offsetX);

  // Header
  renderExportHeader(ctx, timeScale, config, theme, offsetX);
}

function renderDependencies(
  ctx: CanvasRenderingContext2D,
  state: GanttState,
  layouts: TaskLayout[],
  theme: ResolvedTheme,
  offsetX: number,
): void {
  if (state.dependencies.size === 0) return;

  const layoutMap = new Map<string, TaskLayout>();
  for (const layout of layouts) {
    layoutMap.set(layout.taskId, layout);
  }

  const HORIZONTAL_GAP = 12;
  const ARROW_SIZE = 6;
  const ARROW_HALF_HEIGHT = 4;

  ctx.save();

  for (const dep of state.dependencies.values()) {
    const source = layoutMap.get(dep.source);
    const target = layoutMap.get(dep.target);
    if (!source || !target) continue;

    const type = dep.type || 'FS';
    const sCY = source.barY + source.barHeight / 2;
    const tCY = target.barY + target.barHeight / 2;

    let sourceX: number, targetX: number;
    const sourceExitsRight = type === 'FS' || type === 'FF';
    const targetEntersLeft = type === 'FS' || type === 'SS';

    switch (type) {
      case 'FS':
        sourceX = offsetX + source.x + source.width;
        targetX = offsetX + target.x;
        break;
      case 'SS':
        sourceX = offsetX + source.x;
        targetX = offsetX + target.x;
        break;
      case 'FF':
        sourceX = offsetX + source.x + source.width;
        targetX = offsetX + target.x + target.width;
        break;
      case 'SF':
        sourceX = offsetX + source.x;
        targetX = offsetX + target.x + target.width;
        break;
    }

    const midX = sourceExitsRight ? sourceX + HORIZONTAL_GAP : sourceX - HORIZONTAL_GAP;
    const approachX = targetEntersLeft ? targetX - HORIZONTAL_GAP : targetX + HORIZONTAL_GAP;
    const canSimple = sourceExitsRight
      ? (targetEntersLeft ? approachX >= midX : targetX + HORIZONTAL_GAP >= midX)
      : (targetEntersLeft ? targetX - HORIZONTAL_GAP <= midX : approachX <= midX);

    ctx.beginPath();
    ctx.strokeStyle = theme.dependencyColor;
    ctx.lineWidth = theme.dependencyWidth;
    ctx.moveTo(sourceX, sCY);

    if (canSimple) {
      ctx.lineTo(midX, sCY);
      ctx.lineTo(midX, tCY);
      ctx.lineTo(targetX, tCY);
    } else {
      const midY = (sCY + tCY) / 2;
      ctx.lineTo(midX, sCY);
      ctx.lineTo(midX, midY);
      ctx.lineTo(approachX, midY);
      ctx.lineTo(approachX, tCY);
      ctx.lineTo(targetX, tCY);
    }
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    if (targetEntersLeft) {
      ctx.moveTo(targetX, tCY);
      ctx.lineTo(targetX - ARROW_SIZE, tCY - ARROW_HALF_HEIGHT);
      ctx.lineTo(targetX - ARROW_SIZE, tCY + ARROW_HALF_HEIGHT);
    } else {
      ctx.moveTo(targetX, tCY);
      ctx.lineTo(targetX + ARROW_SIZE, tCY - ARROW_HALF_HEIGHT);
      ctx.lineTo(targetX + ARROW_SIZE, tCY + ARROW_HALF_HEIGHT);
    }
    ctx.closePath();
    ctx.fillStyle = theme.dependencyColor;
    ctx.fill();
  }

  ctx.restore();
}

function renderExportHeader(
  ctx: CanvasRenderingContext2D,
  timeScale: ExportTimeScale,
  config: ResolvedConfig,
  theme: ResolvedTheme,
  offsetX: number,
): void {
  const headerHeight = config.headerHeight;
  const headerRows = timeScale.getHeaderRows();

  // Header background
  ctx.fillStyle = theme.timelineHeaderBg;
  ctx.fillRect(offsetX, 0, timeScale.getTotalWidth(), headerHeight);

  const rowCount = headerRows.length || 2;
  const rowHeightPerHeader = headerHeight / rowCount;

  ctx.textBaseline = 'middle';

  for (let rowIdx = 0; rowIdx < headerRows.length; rowIdx++) {
    const cells = headerRows[rowIdx];
    const rowTop = rowIdx * rowHeightPerHeader;

    for (const cell of cells) {
      const cellX = offsetX + cell.x;
      const cellW = cell.width;

      // Separator
      ctx.beginPath();
      ctx.strokeStyle = theme.timelineGridColor;
      ctx.lineWidth = HEADER_SEPARATOR_WIDTH;
      ctx.moveTo(snapToPixel(cellX + cellW), rowTop);
      ctx.lineTo(snapToPixel(cellX + cellW), rowTop + rowHeightPerHeader);
      ctx.stroke();

      // Label
      ctx.save();
      ctx.beginPath();
      ctx.rect(cellX, rowTop, cellW, rowHeightPerHeader);
      ctx.clip();
      ctx.fillStyle = theme.timelineHeaderText;
      ctx.font = rowIdx === 0
        ? `600 ${theme.fontSize}px ${theme.fontFamily}`
        : `${theme.fontSize}px ${theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillText(cell.label, cellX + cellW / 2, rowTop + rowHeightPerHeader / 2);
      ctx.restore();
    }
  }

  // Header bottom separator
  ctx.beginPath();
  ctx.strokeStyle = theme.gridBorderColor;
  ctx.lineWidth = HEADER_SEPARATOR_WIDTH;
  ctx.moveTo(offsetX, snapToPixel(headerHeight));
  ctx.lineTo(offsetX + timeScale.getTotalWidth(), snapToPixel(headerHeight));
  ctx.stroke();
}

function roundedRect(
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

// ─── SVG Generation ───────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSVG(
  state: GanttState,
  layouts: TaskLayout[],
  timeScale: ExportTimeScale,
  gridWidth: number,
): string {
  const { config } = state;
  const theme = config.theme;
  const headerHeight = config.headerHeight;
  const rowHeight = config.rowHeight;
  const totalTimelineWidth = timeScale.getTotalWidth();
  const totalWidth = gridWidth + totalTimelineWidth;
  const bodyHeight = state.flatVisibleIds.length * rowHeight;
  const totalHeight = headerHeight + bodyHeight;
  const radius = theme.barBorderRadius;

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);
  lines.push(`<style>text { font-family: ${escapeXml(theme.fontFamily)}; font-size: ${theme.fontSize}px; }</style>`);

  // Grid background
  lines.push(`<rect x="0" y="0" width="${gridWidth}" height="${totalHeight}" fill="${theme.gridBg}" />`);
  lines.push(`<rect x="0" y="0" width="${gridWidth}" height="${headerHeight}" fill="${theme.gridHeaderBg}" />`);

  // Grid header text
  let colX = 0;
  for (const col of config.columns) {
    const colW = col.width ?? 120;
    lines.push(`<text x="${colX + 8}" y="${headerHeight / 2}" dominant-baseline="central" font-weight="600" fill="${theme.gridHeaderText}">${escapeXml(col.header)}</text>`);
    lines.push(`<line x1="${colX + colW}" y1="0" x2="${colX + colW}" y2="${totalHeight}" stroke="${theme.gridBorderColor}" stroke-width="1" />`);
    colX += colW;
  }

  // Grid rows
  for (let i = 0; i < state.flatVisibleIds.length; i++) {
    const task = state.tasks.get(state.flatVisibleIds[i]);
    if (!task) continue;
    const rowY = headerHeight + i * rowHeight;

    if (i % 2 === 1) {
      lines.push(`<rect x="0" y="${rowY}" width="${gridWidth}" height="${rowHeight}" fill="${theme.gridAltRowBg}" />`);
    }

    let cellX = 0;
    for (const col of config.columns) {
      const colW = col.width ?? 120;
      const value = getCellValue(task, col.field);
      const indent = col.tree ? 8 : 0;
      lines.push(`<text x="${cellX + 8 + indent}" y="${rowY + rowHeight / 2}" dominant-baseline="central" fill="${theme.gridTextColor}"><![CDATA[${value}]]></text>`);
      cellX += colW;
    }

    lines.push(`<line x1="0" y1="${rowY + rowHeight}" x2="${gridWidth}" y2="${rowY + rowHeight}" stroke="${theme.gridBorderColor}" stroke-width="0.5" />`);
  }

  // Grid right border
  lines.push(`<line x1="${gridWidth}" y1="0" x2="${gridWidth}" y2="${totalHeight}" stroke="${theme.gridBorderColor}" stroke-width="1" />`);

  // Header bottom border
  lines.push(`<line x1="0" y1="${headerHeight}" x2="${totalWidth}" y2="${headerHeight}" stroke="${theme.gridBorderColor}" stroke-width="1" />`);

  // Timeline background
  lines.push(`<rect x="${gridWidth}" y="0" width="${totalTimelineWidth}" height="${totalHeight}" fill="${theme.timelineBg}" />`);

  // Timeline header
  lines.push(`<rect x="${gridWidth}" y="0" width="${totalTimelineWidth}" height="${headerHeight}" fill="${theme.timelineHeaderBg}" />`);

  // Header cells
  const headerRows = timeScale.getHeaderRows();
  const rowCount = headerRows.length || 2;
  const headerRowHeight = headerHeight / rowCount;
  for (let rowIdx = 0; rowIdx < headerRows.length; rowIdx++) {
    const cells = headerRows[rowIdx];
    const rowTop = rowIdx * headerRowHeight;
    for (const cell of cells) {
      const cx = gridWidth + cell.x + cell.width / 2;
      const cy = rowTop + headerRowHeight / 2;
      const fw = rowIdx === 0 ? ' font-weight="600"' : '';
      lines.push(`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"${fw} fill="${theme.timelineHeaderText}">${escapeXml(cell.label)}</text>`);
      lines.push(`<line x1="${gridWidth + cell.x + cell.width}" y1="${rowTop}" x2="${gridWidth + cell.x + cell.width}" y2="${rowTop + headerRowHeight}" stroke="${theme.timelineGridColor}" stroke-width="${HEADER_SEPARATOR_WIDTH}" />`);
    }
  }

  // Grid lines
  const gridLines = timeScale.getGridLines();
  for (const lineX of gridLines) {
    lines.push(`<line x1="${gridWidth + lineX}" y1="${headerHeight}" x2="${gridWidth + lineX}" y2="${totalHeight}" stroke="${theme.timelineGridColor}" stroke-width="${GRID_LINE_WIDTH}" />`);
  }

  // Alternating rows on timeline
  for (let i = 0; i < state.flatVisibleIds.length; i++) {
    if (i % 2 === 1) {
      lines.push(`<rect x="${gridWidth}" y="${headerHeight + i * rowHeight}" width="${totalTimelineWidth}" height="${rowHeight}" fill="${theme.gridAltRowBg}" />`);
    }
  }

  // Weekend shading
  if (config.showWeekends) {
    const { start, end } = state.dateRange;
    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);
    while (current.getTime() <= end.getTime()) {
      if (current.getUTCDay() === 0 || current.getUTCDay() === 6) {
        const x = gridWidth + timeScale.dateToX(current);
        const nextDay = new Date(current.getTime() + MS_PER_DAY);
        const xEnd = gridWidth + timeScale.dateToX(nextDay);
        lines.push(`<rect x="${x}" y="${headerHeight}" width="${xEnd - x}" height="${bodyHeight}" fill="${theme.timelineWeekendBg}" />`);
      }
      current.setTime(current.getTime() + MS_PER_DAY);
    }
  }

  // Today marker
  if (config.showToday) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const { start, end } = state.dateRange;
    if (now.getTime() >= start.getTime() && now.getTime() <= end.getTime()) {
      const todayX = gridWidth + timeScale.dateToX(now);
      const colWidth = timeScale.getColumnWidth();
      lines.push(`<rect x="${todayX}" y="${headerHeight}" width="${colWidth}" height="${bodyHeight}" fill="${theme.todayBg}" />`);
      lines.push(`<line x1="${todayX}" y1="${headerHeight}" x2="${todayX}" y2="${totalHeight}" stroke="${theme.todayLineColor}" stroke-width="${TODAY_LINE_WIDTH}" />`);
    }
  }

  // Task bars
  for (const layout of layouts) {
    const barX = gridWidth + layout.x;
    const barY = layout.barY;
    const barW = layout.width;
    const barH = layout.barHeight;

    if (layout.isMilestone) {
      const size = (barH - MILESTONE_INSET * 2) / 2;
      const cy = barY + barH / 2;
      lines.push(`<polygon points="${barX},${cy - size} ${barX + size},${cy} ${barX},${cy + size} ${barX - size},${cy}" fill="${layout.color}" />`);
      continue;
    }

    // Bar
    lines.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${radius}" ry="${radius}" fill="${layout.color}" />`);

    // Progress
    if (config.showProgress && layout.progressWidth > 0) {
      const progressColor = darkenColor(layout.color, 0.2);
      lines.push(`<clipPath id="clip-${layout.taskId}"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${radius}" ry="${radius}" /></clipPath>`);
      lines.push(`<rect x="${barX}" y="${barY}" width="${layout.progressWidth}" height="${barH}" fill="${progressColor}" clip-path="url(#clip-${layout.taskId})" />`);
    }

    // Selection border
    if (state.selectedIds.has(layout.taskId)) {
      lines.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${radius}" ry="${radius}" fill="none" stroke="${theme.barSelectedBorder}" stroke-width="${SELECTION_BORDER_WIDTH}" />`);
    }

    // Label
    if (layout.label) {
      const textY = barY + barH / 2;
      // Approximate text width: fontSize * 0.6 * character count
      const approxTextWidth = theme.fontSize * 0.6 * layout.label.length;
      const fitsInside = approxTextWidth + BAR_TEXT_PADDING_X * 2 <= barW;

      if (fitsInside) {
        lines.push(`<text x="${barX + BAR_TEXT_PADDING_X}" y="${textY}" dominant-baseline="central" fill="${layout.textColor}">${escapeXml(layout.label)}</text>`);
      } else {
        lines.push(`<text x="${barX + barW + BAR_TEXT_PADDING_OUTSIDE}" y="${textY}" dominant-baseline="central" fill="${theme.gridTextColor}">${escapeXml(layout.label)}</text>`);
      }
    }
  }

  // Dependency arrows
  const layoutMap = new Map<string, TaskLayout>();
  for (const layout of layouts) {
    layoutMap.set(layout.taskId, layout);
  }

  for (const dep of state.dependencies.values()) {
    const source = layoutMap.get(dep.source);
    const target = layoutMap.get(dep.target);
    if (!source || !target) continue;

    const type = dep.type || 'FS';
    const sCY = source.barY + source.barHeight / 2;
    const tCY = target.barY + target.barHeight / 2;

    let sourceX: number, targetX: number;
    const sourceExitsRight = type === 'FS' || type === 'FF';
    const targetEntersLeft = type === 'FS' || type === 'SS';

    switch (type) {
      case 'FS':
        sourceX = gridWidth + source.x + source.width;
        targetX = gridWidth + target.x;
        break;
      case 'SS':
        sourceX = gridWidth + source.x;
        targetX = gridWidth + target.x;
        break;
      case 'FF':
        sourceX = gridWidth + source.x + source.width;
        targetX = gridWidth + target.x + target.width;
        break;
      case 'SF':
        sourceX = gridWidth + source.x;
        targetX = gridWidth + target.x + target.width;
        break;
    }

    const HORIZONTAL_GAP = 12;
    const ARROW_SIZE = 6;
    const ARROW_HALF_HEIGHT = 4;
    const midX = sourceExitsRight ? sourceX! + HORIZONTAL_GAP : sourceX! - HORIZONTAL_GAP;
    const approachX = targetEntersLeft ? targetX! - HORIZONTAL_GAP : targetX! + HORIZONTAL_GAP;
    const canSimple = sourceExitsRight
      ? (targetEntersLeft ? approachX >= midX : targetX! + HORIZONTAL_GAP >= midX)
      : (targetEntersLeft ? targetX! - HORIZONTAL_GAP <= midX : approachX <= midX);

    let pathD: string;
    if (canSimple) {
      pathD = `M${sourceX!},${sCY} L${midX},${sCY} L${midX},${tCY} L${targetX!},${tCY}`;
    } else {
      const midY = (sCY + tCY) / 2;
      pathD = `M${sourceX!},${sCY} L${midX},${sCY} L${midX},${midY} L${approachX},${midY} L${approachX},${tCY} L${targetX!},${tCY}`;
    }

    lines.push(`<path d="${pathD}" fill="none" stroke="${theme.dependencyColor}" stroke-width="${theme.dependencyWidth}" />`);

    // Arrowhead
    if (targetEntersLeft) {
      lines.push(`<polygon points="${targetX!},${tCY} ${targetX! - ARROW_SIZE},${tCY - ARROW_HALF_HEIGHT} ${targetX! - ARROW_SIZE},${tCY + ARROW_HALF_HEIGHT}" fill="${theme.dependencyColor}" />`);
    } else {
      lines.push(`<polygon points="${targetX!},${tCY} ${targetX! + ARROW_SIZE},${tCY - ARROW_HALF_HEIGHT} ${targetX! + ARROW_SIZE},${tCY + ARROW_HALF_HEIGHT}" fill="${theme.dependencyColor}" />`);
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}

// ─── Plugin Factory ─────────────────────────────────────────────────────

export function ExportPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;

  function getExportTimeScale(): ExportTimeScale {
    const gantt = host!;
    const state = gantt.getState();
    const tsApi = gantt.getTimeScale();

    // We need the full TimeScale for headers/grid lines. Since the PluginHost
    // only exposes TimeScaleAPI (dateToX, xToDate, getColumnWidth), we import
    // TimeScale from the layout module and recreate it for the full content.
    // However, to keep the plugin self-contained, we build a minimal shim.

    const { start, end } = state.dateRange;
    const totalMs = end.getTime() - start.getTime();
    const colWidth = tsApi.getColumnWidth();

    // Compute total width based on zoom level + column width
    const zoomLevel = state.zoomLevel;
    let unitCount: number;
    switch (zoomLevel) {
      case 'day':
        unitCount = Math.round(totalMs / MS_PER_DAY);
        break;
      case 'week':
        unitCount = Math.ceil(totalMs / (MS_PER_DAY * 7));
        break;
      case 'month': {
        const sy = start.getUTCFullYear(), sm = start.getUTCMonth();
        const ey = end.getUTCFullYear(), em = end.getUTCMonth();
        unitCount = (ey - sy) * 12 + (em - sm);
        break;
      }
      case 'quarter': {
        const sy2 = start.getUTCFullYear(), sq = Math.floor(start.getUTCMonth() / 3);
        const ey2 = end.getUTCFullYear(), eq = Math.floor(end.getUTCMonth() / 3);
        unitCount = (ey2 - sy2) * 4 + (eq - sq);
        break;
      }
    }

    const totalWidth = unitCount * colWidth;

    return {
      dateToX(date: Date): number {
        const msFromStart = date.getTime() - start.getTime();
        return (msFromStart / totalMs) * totalWidth;
      },
      getColumnWidth(): number {
        return colWidth;
      },
      getTotalWidth(): number {
        return totalWidth;
      },
      getHeaderRows(): HeaderCell[][] {
        // Build header rows based on zoom level
        return buildHeaderRows(zoomLevel, start, end, colWidth, totalWidth);
      },
      getGridLines(): number[] {
        const minorCells = this.getHeaderRows()[1];
        return minorCells.map((cell) => cell.x).filter((x) => x > 0);
      },
    };
  }

  function computeGridWidth(): number {
    if (!host) return 0;
    const state = host.getState();
    if (state.config.gridWidth === 0) return 0;
    let total = 0;
    for (const col of state.config.columns) {
      total += col.width ?? 120;
    }
    return total;
  }

  function exportPNG(filename?: string): void {
    if (!host) return;

    const state = host.getState();
    const timeScale = getExportTimeScale();
    const layouts = host.getLayouts();
    const gridWidth = computeGridWidth();

    const totalTimelineWidth = timeScale.getTotalWidth();
    const totalWidth = gridWidth + totalTimelineWidth;
    const bodyHeight = state.flatVisibleIds.length * state.config.rowHeight;
    const totalHeight = state.config.headerHeight + bodyHeight;

    const name = filename ?? 'gantt-export.png';

    // Handle very large charts by tiling
    if (totalWidth > MAX_CANVAS_DIM || totalHeight > MAX_CANVAS_DIM) {
      exportPNGTiled(state, layouts, timeScale, gridWidth, totalWidth, totalHeight, name);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Render grid
    if (gridWidth > 0) {
      renderGridToCanvas(ctx, state, gridWidth, totalHeight);
    }

    // Render timeline
    renderTimelineToCanvas(ctx, state, layouts, timeScale, gridWidth);

    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, name);
    }, 'image/png');
  }

  function exportPNGTiled(
    state: GanttState,
    layouts: TaskLayout[],
    timeScale: ExportTimeScale,
    gridWidth: number,
    totalWidth: number,
    totalHeight: number,
    filename: string,
  ): void {
    // For very large charts, render in tiles and stitch together.
    // We scale down to fit within MAX_CANVAS_DIM on each axis.
    const scale = Math.min(1, MAX_CANVAS_DIM / totalWidth, MAX_CANVAS_DIM / totalHeight);
    const scaledWidth = Math.ceil(totalWidth * scale);
    const scaledHeight = Math.ceil(totalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(scale, scale);

    // Render grid
    if (gridWidth > 0) {
      renderGridToCanvas(ctx, state, gridWidth, totalHeight);
    }

    // Render timeline
    renderTimelineToCanvas(ctx, state, layouts, timeScale, gridWidth);

    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, filename);
    }, 'image/png');
  }

  function exportSVG(filename?: string): void {
    if (!host) return;

    const state = host.getState();
    const timeScale = getExportTimeScale();
    const layouts = host.getLayouts();
    const gridWidth = computeGridWidth();

    const svgString = generateSVG(state, layouts, timeScale, gridWidth);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, filename ?? 'gantt-export.svg');
  }

  return {
    name: 'ExportPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Expose methods via event system
      gantt.on('export:png', (...args: unknown[]) => {
        exportPNG(args[0] as string | undefined);
      });

      gantt.on('export:svg', (...args: unknown[]) => {
        exportSVG(args[0] as string | undefined);
      });
    },

    destroy(): void {
      host = null;
    },
  };
}

// ─── Header Row Builders (standalone for export) ──────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function addUTCDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function startOfNextUTCMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function addUTCMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function dateToXForHeaders(date: Date, rangeStart: Date, totalMs: number, totalWidth: number): number {
  const msFromStart = date.getTime() - rangeStart.getTime();
  return (msFromStart / totalMs) * totalWidth;
}

function buildHeaderRows(
  zoomLevel: string,
  rangeStart: Date,
  rangeEnd: Date,
  columnWidth: number,
  totalWidth: number,
): HeaderCell[][] {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const dtx = (d: Date) => dateToXForHeaders(d, rangeStart, totalMs, totalWidth);

  switch (zoomLevel) {
    case 'day': {
      const major: HeaderCell[] = [];
      const minor: HeaderCell[] = [];
      const numDays = Math.round(totalMs / MS_PER_DAY);

      let cursor = new Date(rangeStart);
      for (let i = 0; i < numDays; i++) {
        minor.push({
          label: String(cursor.getUTCDate()),
          x: i * columnWidth,
          width: columnWidth,
          date: new Date(cursor),
        });
        cursor = addUTCDays(cursor, 1);
      }

      let monthStart = new Date(rangeStart);
      while (monthStart.getTime() < rangeEnd.getTime()) {
        const nextMonth = startOfNextUTCMonth(monthStart);
        const x1 = dtx(monthStart);
        const x2 = nextMonth.getTime() >= rangeEnd.getTime() ? totalWidth : dtx(nextMonth);
        major.push({
          label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
          x: x1, width: x2 - x1, date: new Date(monthStart),
        });
        monthStart = nextMonth;
      }
      return [major, minor];
    }

    case 'week': {
      const major: HeaderCell[] = [];
      const minor: HeaderCell[] = [];
      const numWeeks = Math.ceil(totalMs / (MS_PER_DAY * 7));

      for (let i = 0; i < numWeeks; i++) {
        const weekDate = addUTCDays(rangeStart, i * 7);
        minor.push({
          label: `${MONTH_ABBR[weekDate.getUTCMonth()]} ${weekDate.getUTCDate()}`,
          x: i * columnWidth, width: columnWidth, date: new Date(weekDate),
        });
      }

      let monthStart = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1));
      while (monthStart.getTime() < rangeEnd.getTime()) {
        const nextMonth = startOfNextUTCMonth(monthStart);
        const cs = monthStart.getTime() < rangeStart.getTime() ? rangeStart : monthStart;
        const ce = nextMonth.getTime() > rangeEnd.getTime() ? rangeEnd : nextMonth;
        major.push({
          label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
          x: dtx(cs), width: dtx(ce) - dtx(cs), date: new Date(cs),
        });
        monthStart = nextMonth;
      }
      return [major, minor];
    }

    case 'month': {
      const major: HeaderCell[] = [];
      const minor: HeaderCell[] = [];
      const sy = rangeStart.getUTCFullYear(), sm = rangeStart.getUTCMonth();
      const ey = rangeEnd.getUTCFullYear(), em = rangeEnd.getUTCMonth();
      const numMonths = (ey - sy) * 12 + (em - sm);

      let cursor = new Date(Date.UTC(sy, sm, 1));
      for (let i = 0; i < numMonths; i++) {
        minor.push({
          label: MONTH_ABBR[cursor.getUTCMonth()],
          x: i * columnWidth, width: columnWidth, date: new Date(cursor),
        });
        cursor = startOfNextUTCMonth(cursor);
      }

      let yearStart = new Date(Date.UTC(sy, 0, 1));
      while (yearStart.getTime() < rangeEnd.getTime()) {
        const nextYear = new Date(Date.UTC(yearStart.getUTCFullYear() + 1, 0, 1));
        const cs = yearStart.getTime() < rangeStart.getTime() ? rangeStart : yearStart;
        const ce = nextYear.getTime() > rangeEnd.getTime() ? rangeEnd : nextYear;
        major.push({
          label: String(yearStart.getUTCFullYear()),
          x: dtx(cs), width: dtx(ce) - dtx(cs), date: new Date(cs),
        });
        yearStart = nextYear;
      }
      return [major, minor];
    }

    case 'quarter': {
      const major: HeaderCell[] = [];
      const minor: HeaderCell[] = [];
      const sy = rangeStart.getUTCFullYear(), sq = Math.floor(rangeStart.getUTCMonth() / 3);
      const ey = rangeEnd.getUTCFullYear(), eq = Math.floor(rangeEnd.getUTCMonth() / 3);
      const numQuarters = (ey - sy) * 4 + (eq - sq);

      let cursor = new Date(Date.UTC(sy, sq * 3, 1));
      for (let i = 0; i < numQuarters; i++) {
        const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
        minor.push({
          label: `Q${q}`,
          x: i * columnWidth, width: columnWidth, date: new Date(cursor),
        });
        cursor = addUTCMonths(cursor, 3);
      }

      let yearStart = new Date(Date.UTC(sy, 0, 1));
      while (yearStart.getTime() < rangeEnd.getTime()) {
        const nextYear = new Date(Date.UTC(yearStart.getUTCFullYear() + 1, 0, 1));
        const cs = yearStart.getTime() < rangeStart.getTime() ? rangeStart : yearStart;
        const ce = nextYear.getTime() > rangeEnd.getTime() ? rangeEnd : nextYear;
        major.push({
          label: String(yearStart.getUTCFullYear()),
          x: dtx(cs), width: dtx(ce) - dtx(cs), date: new Date(cs),
        });
        yearStart = nextYear;
      }
      return [major, minor];
    }

    default:
      return [[], []];
  }
}
