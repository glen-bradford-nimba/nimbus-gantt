// ─── Canvas Renderer ────────────────────────────────────────────────────────
// Renders the timeline portion of the Gantt chart onto an HTML5 Canvas element.
// Handles DPI scaling, scrolling, and the full back-to-front rendering pipeline.

import type {
  GanttState,
  TaskLayout,
  ResolvedTheme,
  ResolvedConfig,
  HeaderCell,
} from '../model/types';

// ─── TimeScale interface ───────────────────────────────────────────────────
// Consumed from ../layout/TimeScale — imported as a type contract.

interface TimeScale {
  dateToX(date: Date): number;
  xToDate(x: number): Date;
  getColumnWidth(): number;
  getHeaderRows(): HeaderCell[][];
  getGridLines(): number[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const HEADER_SEPARATOR_WIDTH = 1;
const TODAY_LINE_WIDTH = 2;
const GRID_LINE_WIDTH = 0.5;
const MILESTONE_INSET = 2;
const BAR_TEXT_PADDING_X = 8;
const BAR_TEXT_PADDING_OUTSIDE = 6;
const SELECTION_BORDER_WIDTH = 2;

// ─── CanvasRenderer ────────────────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private displayWidth = 0;
  private displayHeight = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    // Disable browser touch gestures (pan/zoom) on the canvas so pointer
    // events fire reliably for drag/click interactions.
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('CanvasRenderer: failed to get 2d context');
    }
    this.ctx = ctx;

    this.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Set the display size of the canvas. Applies DPI scaling internally.
   */
  resize(width: number, height: number): void {
    this.displayWidth = width;
    this.displayHeight = height;

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /**
   * Full render pass. Draws every layer back-to-front.
   */
  render(state: GanttState, layouts: TaskLayout[], timeScale: TimeScale): void {
    const { ctx, displayWidth, displayHeight, dpr } = this;
    const { config } = state;
    const { theme } = config;
    const scrollX = state.scrollX;
    const scrollY = state.scrollY;

    // Apply DPI scaling for this frame
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Total header height: two rows
    const headerHeight = config.headerHeight;
    const bodyTop = headerHeight;
    const bodyHeight = displayHeight - bodyTop;

    // ── 1. Clear canvas ──────────────────────────────────────────────────
    this.fillRect(0, 0, displayWidth, displayHeight, theme.timelineBg);

    // ── Body rendering (scrollable region) ───────────────────────────────
    // Clip body so nothing bleeds into the header area
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bodyTop, displayWidth, bodyHeight);
    ctx.clip();

    // Apply scroll translation for body content
    ctx.translate(-scrollX, 0);

    // ── 2. Weekend shading ───────────────────────────────────────────────
    if (config.showWeekends) {
      this.renderWeekendShading(state, timeScale, bodyTop, bodyHeight, theme);
    }

    // ── 3. Grid lines ───────────────────────────────────────────────────
    this.renderGridLines(timeScale, bodyTop, bodyHeight, theme, scrollX);

    // ── 4. Row alternating stripes ──────────────────────────────────────
    this.renderAltRows(state, layouts, bodyTop, theme, scrollX, scrollY);

    // ── 5. Today marker background ──────────────────────────────────────
    const todayX = this.getTodayX(state, config, timeScale);
    if (config.showToday && todayX !== null) {
      this.renderTodayBackground(todayX, timeScale, bodyTop, bodyHeight, theme);
    }

    // ── 6. Group-header row background tints (canvas layer) ─────────────
    // DomTreeGrid also applies inline CSS background to the <tr>, but the
    // canvas needs its own fill so the tint shows through the timeline column.
    this.renderGroupRowBgs(state, layouts, config, scrollX, scrollY, bodyTop, bodyHeight);

    // ── 7. Task bars ────────────────────────────────────────────────────
    this.renderTaskBars(state, layouts, config, theme, scrollX, scrollY, bodyTop, bodyHeight);

    // ── 7a. 0.185.22 — Snap guide during date drag ──────────────────────
    // When a move/resize drag is active, draw a vertical guide at the
    // day boundary the gesture will commit to on release. Helps users
    // see precision before they let go.
    this.renderDragSnapGuide(state, layouts, timeScale, bodyTop, bodyHeight, theme);

    // ── 8. Today marker line ────────────────────────────────────────────
    if (config.showToday && todayX !== null) {
      this.renderTodayLine(todayX, bodyTop, bodyHeight, theme);
    }

    // Restore from body clip
    ctx.restore();

    // ── 9. Header (fixed, does not scroll vertically) ───────────────────
    this.renderHeader(timeScale, config, theme, scrollX);
  }

  /**
   * Remove the canvas from the DOM and release resources.
   */
  destroy(): void {
    this.canvas.remove();
  }

  // ─── Private Rendering Methods ─────────────────────────────────────────────

  /**
   * Shade Saturday and Sunday columns with translucent overlay.
   */
  private renderWeekendShading(
    state: GanttState,
    timeScale: TimeScale,
    bodyTop: number,
    bodyHeight: number,
    theme: ResolvedTheme,
  ): void {
    const { start, end } = state.dateRange;

    // Walk each day in the visible date range
    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);
    const endTime = end.getTime();

    while (current.getTime() <= endTime) {
      const dayOfWeek = current.getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const x = timeScale.dateToX(current);
        const nextDay = new Date(current.getTime() + MS_PER_DAY);
        const xEnd = timeScale.dateToX(nextDay);
        const width = xEnd - x;

        this.fillRect(x, bodyTop, width, bodyHeight, theme.timelineWeekendBg);
      }
      current.setTime(current.getTime() + MS_PER_DAY);
    }
  }

  /**
   * Draw vertical grid lines at each time unit boundary.
   */
  private renderGridLines(
    timeScale: TimeScale,
    bodyTop: number,
    bodyHeight: number,
    theme: ResolvedTheme,
    scrollX: number,
  ): void {
    const { ctx } = this;
    const gridLines = timeScale.getGridLines();

    ctx.beginPath();
    ctx.strokeStyle = theme.timelineGridColor;
    ctx.lineWidth = GRID_LINE_WIDTH;

    for (const x of gridLines) {
      const px = this.snapToPixel(x);
      ctx.moveTo(px, bodyTop);
      ctx.lineTo(px, bodyTop + bodyHeight);
    }

    ctx.stroke();
  }

  /**
   * Draw alternating row background stripes.
   */
  private renderAltRows(
    state: GanttState,
    layouts: TaskLayout[],
    bodyTop: number,
    theme: ResolvedTheme,
    scrollX: number,
    scrollY: number,
  ): void {
    const { ctx, displayWidth } = this;
    const rowHeight = state.config.rowHeight;

    // Determine the visible row range
    const visibleRowCount = state.flatVisibleIds.length;
    const totalCanvasWidth = displayWidth + scrollX * 2; // wide enough to cover scroll

    for (let i = 0; i < visibleRowCount; i++) {
      if (i % 2 === 1) {
        const y = bodyTop + i * rowHeight - scrollY;
        // Only render rows that are at least partially visible
        if (y + rowHeight < bodyTop || y > bodyTop + this.displayHeight) continue;
        // Fill across the full scrollable width — using the translated coordinate system
        this.fillRect(scrollX, y, displayWidth + scrollX, rowHeight, theme.gridAltRowBg);
      }
    }
  }

  /**
   * Compute the X position for "today", or null if outside the visible range.
   */
  private getTodayX(
    state: GanttState,
    config: ResolvedConfig,
    timeScale: TimeScale,
  ): number | null {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const { start, end } = state.dateRange;
    if (now.getTime() < start.getTime() || now.getTime() > end.getTime()) {
      return null;
    }

    return timeScale.dateToX(now);
  }

  /**
   * Draw the translucent column background for today.
   * Always renders exactly one day wide regardless of the current zoom level.
   */
  private renderTodayBackground(
    todayX: number,
    timeScale: TimeScale,
    bodyTop: number,
    bodyHeight: number,
    theme: ResolvedTheme,
  ): void {
    // Compute the pixel width of exactly one day by converting today and
    // tomorrow to X coordinates. This ensures the highlight is always one
    // day wide even when the zoom unit is week/month/quarter.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + MS_PER_DAY);
    const dayWidth = timeScale.dateToX(tomorrow) - timeScale.dateToX(today);
    this.fillRect(todayX, bodyTop, dayWidth, bodyHeight, theme.todayBg);
  }

  /**
   * Draw colored background fills for group-header rows (bucket headers).
   * The DOM grid applies an inline background to the <tr>, but the timeline
   * canvas needs its own layer so the tint bleeds into the bar area too.
   * (cloudnimbusllc.com patch — ported from local core.js)
   */
  private renderGroupRowBgs(
    state: GanttState,
    layouts: TaskLayout[],
    config: ResolvedConfig,
    scrollX: number,
    scrollY: number,
    bodyTop: number,
    bodyHeight: number,
  ): void {
    const { ctx, displayWidth } = this;
    const rowH = config.rowHeight;

    for (const layout of layouts) {
      const task = state.tasks.get(layout.taskId);
      if (!task || !task.groupBg) continue;

      const rowY = layout.y - scrollY + bodyTop;
      // Skip rows outside the visible body area
      if (rowY + rowH < bodyTop || rowY > bodyTop + bodyHeight) continue;

      ctx.save();
      ctx.fillStyle = task.groupBg;
      ctx.fillRect(scrollX, rowY, displayWidth, rowH);
      if (task.groupColor) {
        // Thin accent line along the top of the header row
        ctx.fillStyle = task.groupColor;
        ctx.fillRect(scrollX, rowY, displayWidth, 2);
      }
      ctx.restore();
    }
  }

  /**
   * 0.185.22 — Draw a vertical snap guide at the day boundary the current
   * drag will commit to on release. Renders only when an active move /
   * resize drag is in progress and the target bar is in view. Day-granular
   * because DragManager.completeDrag uses pixelsToDays() for the commit.
   */
  private renderDragSnapGuide(
    state: GanttState,
    layouts: TaskLayout[],
    timeScale: TimeScale,
    bodyTop: number,
    bodyHeight: number,
    theme: ResolvedTheme,
  ): void {
    const drag = state.dragState;
    if (!drag) return;
    if (drag.type !== 'move' && drag.type !== 'resize-left' && drag.type !== 'resize-right') return;
    const layout = layouts.find((l) => l.taskId === drag.taskId);
    if (!layout) return;

    // Compute the day width once so we can snap pixel positions to day
    // boundaries. Matches the existing renderTodayBackground pattern.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + MS_PER_DAY);
    const dayWidth = timeScale.dateToX(tomorrow) - timeScale.dateToX(today);
    if (dayWidth <= 0) return;

    // Determine which edge the user is moving.
    const deltaX = drag.currentX - drag.startX;
    let targetX: number;
    if (drag.type === 'move') {
      // For move, snap the LEADING (left) edge.
      targetX = layout.x + deltaX;
    } else if (drag.type === 'resize-left') {
      targetX = layout.x + deltaX;
    } else {
      // resize-right: snap the TRAILING (right) edge.
      targetX = layout.x + layout.width + deltaX;
    }

    // Snap to nearest day boundary. Anchor the grid at day 0 (timeScale
    // origin); pixelsToDays uses the same grid so the snap matches what
    // completeDrag will actually commit.
    const snappedX = Math.round(targetX / dayWidth) * dayWidth;

    const { ctx } = this;
    ctx.save();
    // Use the same accent as drag preview bar outline (barSelectedBorder)
    // so the guide and the preview visually relate.
    ctx.strokeStyle = theme.barSelectedBorder || '#3b82f6';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(snappedX + 0.5, bodyTop);
    ctx.lineTo(snappedX + 0.5, bodyTop + bodyHeight);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw all task bars with progress fills, labels, and selection outlines.
   */
  private renderTaskBars(
    state: GanttState,
    layouts: TaskLayout[],
    config: ResolvedConfig,
    theme: ResolvedTheme,
    scrollX: number,
    scrollY: number,
    bodyTop: number,
    bodyHeight: number,
  ): void {
    const { ctx } = this;
    const radius = theme.barBorderRadius;

    // 0.185.4 — live drag preview. When a bar is being dragged, offset the
    // active edge(s) by the pixel delta so the bar visually follows the
    // cursor instead of jumping on release. Computed once per render.
    const drag = state.dragState;
    const dragDeltaX = drag ? (drag.currentX - drag.startX) : 0;
    const MIN_BAR_W = 4;

    for (const layout of layouts) {
      // The layout positions are in content-space coordinates (0-based from top
      // of the scrollable body). Convert to screen coordinates by:
      //  - Adding bodyTop to shift below the fixed header
      //  - Subtracting scrollY for vertical scroll
      // Horizontal scroll is handled by the ctx.translate(-scrollX, 0) above.
      let barX = layout.x;
      const barY = layout.barY - scrollY + bodyTop;
      let barW = layout.width;
      const barH = layout.barHeight;

      // Skip bars that are fully outside the visible body region
      if (barY + barH < bodyTop || barY > bodyTop + bodyHeight) continue;

      // Apply drag preview offset for the bar under an active drag gesture.
      const isDragActive = drag && drag.taskId === layout.taskId;
      if (isDragActive) {
        if (drag!.type === 'move') {
          barX += dragDeltaX;
        } else if (drag!.type === 'resize-left') {
          const newX = barX + dragDeltaX;
          const newW = barW - dragDeltaX;
          if (newW >= MIN_BAR_W) { barX = newX; barW = newW; }
        } else if (drag!.type === 'resize-right') {
          const newW = barW + dragDeltaX;
          if (newW >= MIN_BAR_W) { barW = newW; }
        }
      }

      if (layout.isMilestone) {
        this.renderMilestone(barX, barY, barH, layout.color, theme, state.selectedIds.has(layout.taskId));
        continue;
      }

      // ── Main bar fill ──────────────────────────────────────────────────
      this.fillRoundedRect(barX, barY, barW, barH, radius, layout.color);

      // ── Progress fill ──────────────────────────────────────────────────
      if (config.showProgress && layout.progressWidth > 0) {
        // During a move drag the progress fill follows the bar; during a
        // resize the original progress width is preserved but clipped to
        // the new bar bounds via the same clip path.
        const progressColor = this.darkenColor(layout.color, 0.2);
        ctx.save();
        ctx.beginPath();
        this.roundedRectPath(barX, barY, barW, barH, radius);
        ctx.clip();
        ctx.fillStyle = progressColor;
        ctx.fillRect(barX, barY, layout.progressWidth, barH);
        ctx.restore();
      }

      // ── Selection border ───────────────────────────────────────────────
      if (state.selectedIds.has(layout.taskId)) {
        this.strokeRoundedRect(
          barX,
          barY,
          barW,
          barH,
          radius,
          theme.barSelectedBorder,
          SELECTION_BORDER_WIDTH,
        );
      }

      // Outline the bar under active drag so the preview is visually distinct
      // from the committed state (helps when the delta is small).
      if (isDragActive) {
        this.strokeRoundedRect(
          barX,
          barY,
          barW,
          barH,
          radius,
          theme.barSelectedBorder,
          SELECTION_BORDER_WIDTH,
        );
      }

      // ── Label text ─────────────────────────────────────────────────────
      this.renderBarLabel(layout, barX, barY, barW, barH, theme);
    }
  }

  /**
   * Draw a milestone diamond marker.
   */
  private renderMilestone(
    cx: number,
    barY: number,
    barH: number,
    color: string,
    theme: ResolvedTheme,
    isSelected: boolean,
  ): void {
    const { ctx } = this;
    const size = (barH - MILESTONE_INSET * 2) / 2;
    const cy = barY + barH / 2;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);        // top
    ctx.lineTo(cx + size, cy);        // right
    ctx.lineTo(cx, cy + size);        // bottom
    ctx.lineTo(cx - size, cy);        // left
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = theme.barSelectedBorder;
      ctx.lineWidth = SELECTION_BORDER_WIDTH;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Render the label text inside or beside the task bar.
   */
  private renderBarLabel(
    layout: TaskLayout,
    barX: number,
    barY: number,
    barW: number,
    barH: number,
    theme: ResolvedTheme,
  ): void {
    const { ctx } = this;
    if (!layout.label) return;

    ctx.save();

    const font = `${theme.fontSize}px ${theme.fontFamily}`;
    ctx.font = font;
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(layout.label).width;
    const textY = barY + barH / 2;
    const fitsInside = textWidth + BAR_TEXT_PADDING_X * 2 <= barW;

    if (fitsInside) {
      // Render inside the bar, clipped to bar bounds
      ctx.beginPath();
      ctx.rect(barX, barY, barW, barH);
      ctx.clip();

      ctx.fillStyle = layout.textColor;
      ctx.textAlign = 'left';
      ctx.fillText(layout.label, barX + BAR_TEXT_PADDING_X, textY);
    } else {
      // Render to the right of the bar
      ctx.fillStyle = theme.gridTextColor;
      ctx.textAlign = 'left';
      ctx.fillText(layout.label, barX + barW + BAR_TEXT_PADDING_OUTSIDE, textY);
    }

    ctx.restore();
  }

  /**
   * Draw the bold "today" vertical line.
   */
  private renderTodayLine(
    todayX: number,
    bodyTop: number,
    bodyHeight: number,
    theme: ResolvedTheme,
  ): void {
    const { ctx } = this;
    const px = this.snapToPixel(todayX);

    ctx.beginPath();
    ctx.strokeStyle = theme.todayLineColor;
    ctx.lineWidth = TODAY_LINE_WIDTH;
    ctx.moveTo(px, bodyTop);
    ctx.lineTo(px, bodyTop + bodyHeight);
    ctx.stroke();
  }

  /**
   * Draw the two-row header at the top of the canvas.
   * The header is fixed vertically and only scrolls horizontally.
   */
  private renderHeader(
    timeScale: TimeScale,
    config: ResolvedConfig,
    theme: ResolvedTheme,
    scrollX: number,
  ): void {
    const { ctx, displayWidth } = this;
    const headerHeight = config.headerHeight;
    const headerRows = timeScale.getHeaderRows();

    // Reset transform for fixed header — only apply horizontal scroll
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // ── Header background ────────────────────────────────────────────────
    this.fillRect(0, 0, displayWidth, headerHeight, theme.timelineHeaderBg);

    // Compute row heights
    const rowCount = headerRows.length || 2;
    const rowHeightPerHeader = headerHeight / rowCount;

    const font = `${theme.fontSize}px ${theme.fontFamily}`;
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.timelineHeaderText;

    // ── Render each header row ───────────────────────────────────────────
    for (let rowIdx = 0; rowIdx < headerRows.length; rowIdx++) {
      const cells = headerRows[rowIdx];
      const rowTop = rowIdx * rowHeightPerHeader;

      for (const cell of cells) {
        // Translate cell positions by scroll offset
        const cellX = cell.x - scrollX;
        const cellW = cell.width;

        // Skip cells fully outside the visible area
        if (cellX + cellW < 0 || cellX > displayWidth) continue;

        // Cell separator line (right edge)
        ctx.beginPath();
        ctx.strokeStyle = theme.timelineGridColor;
        ctx.lineWidth = HEADER_SEPARATOR_WIDTH;
        const sepX = this.snapToPixelRaw(cellX + cellW);
        ctx.moveTo(sepX, rowTop);
        ctx.lineTo(sepX, rowTop + rowHeightPerHeader);
        ctx.stroke();

        // Cell label (centered)
        ctx.save();
        ctx.beginPath();
        ctx.rect(cellX, rowTop, cellW, rowHeightPerHeader);
        ctx.clip();

        ctx.fillStyle = theme.timelineHeaderText;
        ctx.font = rowIdx === 0
          ? `600 ${theme.fontSize}px ${theme.fontFamily}`
          : `${theme.fontSize}px ${theme.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          cell.label,
          cellX + cellW / 2,
          rowTop + rowHeightPerHeader / 2,
        );

        ctx.restore();
      }
    }

    // ── Separator line between header and body ───────────────────────────
    const sepY = this.snapToPixelRaw(headerHeight);
    ctx.beginPath();
    ctx.strokeStyle = theme.gridBorderColor;
    ctx.lineWidth = HEADER_SEPARATOR_WIDTH;
    ctx.moveTo(0, sepY);
    ctx.lineTo(displayWidth, sepY);
    ctx.stroke();
  }

  // ─── Drawing Primitives ────────────────────────────────────────────────────

  /**
   * Fill a rectangle with the given color.
   */
  private fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  /**
   * Build a rounded-rectangle path (no stroke/fill — just the path).
   */
  private roundedRectPath(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const { ctx } = this;
    // Clamp radius to half the smallest dimension
    const radius = Math.min(r, w / 2, h / 2);

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

  /**
   * Fill a rounded rectangle.
   */
  private fillRoundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    color: string,
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    this.roundedRectPath(x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * Stroke a rounded rectangle.
   */
  private strokeRoundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    color: string,
    lineWidth: number,
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    this.roundedRectPath(x, y, w, h, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  /**
   * Snap a coordinate to the nearest half-pixel for crisp 1px lines
   * when the context has a translation applied.
   */
  private snapToPixel(x: number): number {
    return Math.round(x) + 0.5;
  }

  /**
   * Snap a coordinate to the nearest half-pixel for crisp lines
   * without accounting for translation (used in header).
   */
  private snapToPixelRaw(x: number): number {
    return Math.round(x) + 0.5;
  }

  /**
   * Produce a darkened variant of a hex color for progress bar fills.
   * @param hex - CSS hex color (#RRGGBB or #RGB)
   * @param amount - How much to darken (0 = no change, 1 = black)
   */
  private darkenColor(hex: string, amount: number): string {
    // Parse hex
    let r: number;
    let g: number;
    let b: number;

    const cleaned = hex.replace('#', '');

    if (cleaned.length === 3) {
      r = parseInt(cleaned[0] + cleaned[0], 16);
      g = parseInt(cleaned[1] + cleaned[1], 16);
      b = parseInt(cleaned[2] + cleaned[2], 16);
    } else {
      r = parseInt(cleaned.substring(0, 2), 16);
      g = parseInt(cleaned.substring(2, 4), 16);
      b = parseInt(cleaned.substring(4, 6), 16);
    }

    // Darken
    r = Math.round(r * (1 - amount));
    g = Math.round(g * (1 - amount));
    b = Math.round(b * (1 - amount));

    // Convert back to hex
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
}
