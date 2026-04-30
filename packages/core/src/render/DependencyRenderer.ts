// ─── Dependency Renderer ────────────────────────────────────────────────────
// Renders dependency arrows between connected task bars on the Canvas.
// Called by CanvasRenderer as part of the render pipeline, AFTER task bars
// and BEFORE the today line.

import type {
  GanttState,
  TaskLayout,
  ResolvedTheme,
  DependencyType,
} from '../model/types';

// ─── Constants ─────────────────────────────────────────────────────────────

const HORIZONTAL_GAP = 12;       // Gap from source/target bar edge before first turn
const ARROW_SIZE = 6;            // Arrowhead width (pixels along the approach axis)
const ARROW_HALF_HEIGHT = 4;     // Arrowhead half-height (perpendicular to approach axis)
const CONNECTION_DOT_RADIUS = 3; // Radius of connection-point dots

// ─── DependencyRenderer ───────────────────────────────────────────────────

export class DependencyRenderer {
  /**
   * Render all dependency arrows.
   *
   * Called AFTER canvasRenderer.render() completes, so the context has a clean
   * DPI transform with no scroll translation or body clip applied.  This method
   * sets up its own clip region and scroll translation so arrows are correctly
   * positioned and confined to the body area (below the header).
   *
   * Layout coordinates are in content-space (0-based from the top of the
   * scrollable body).  We convert to screen coordinates by adding headerHeight
   * and subtracting scrollY for vertical, and applying ctx.translate for
   * horizontal scroll.
   */
  render(
    ctx: CanvasRenderingContext2D,
    state: GanttState,
    layouts: TaskLayout[],
    theme: ResolvedTheme,
    scrollX: number,
    scrollY: number,
    headerHeight: number,
  ): void {
    const { dependencies } = state;
    if (dependencies.size === 0) return;

    // Build O(1) lookup map: taskId → TaskLayout
    const layoutMap = new Map<string, TaskLayout>();
    for (const layout of layouts) {
      layoutMap.set(layout.taskId, layout);
    }

    const canvasWidth = ctx.canvas.width / (window.devicePixelRatio || 1);
    const canvasHeight = ctx.canvas.height / (window.devicePixelRatio || 1);

    ctx.save();

    // Clip to the body region so arrows don't bleed into the header
    ctx.beginPath();
    ctx.rect(0, headerHeight, canvasWidth, canvasHeight - headerHeight);
    ctx.clip();

    // Apply horizontal scroll translation (same as CanvasRenderer body pass)
    ctx.translate(-scrollX, 0);

    for (const dep of dependencies.values()) {
      const sourceLayout = layoutMap.get(dep.source);
      const targetLayout = layoutMap.get(dep.target);

      // Only render when both tasks are visible (have layouts)
      if (!sourceLayout || !targetLayout) continue;

      const type: DependencyType = dep.type || 'FS';

      // Compute connection points based on dependency type
      const { sourceX, sourceY, targetX, targetY } = this.getConnectionPoints(
        type,
        sourceLayout,
        targetLayout,
        scrollY,
        headerHeight,
      );

      // Draw the routed path
      this.drawRoutedPath(ctx, type, sourceX, sourceY, targetX, targetY, theme);

      // Draw arrowhead at the target point
      this.drawArrowhead(ctx, type, targetX, targetY, theme);

      // Draw connection dots at source and target
      this.drawConnectionDot(ctx, sourceX, sourceY, theme);
      this.drawConnectionDot(ctx, targetX, targetY, theme);
    }

    ctx.restore();
  }

  /**
   * 0.189.0 — hit-test a content-space coordinate against rendered
   * dependency arrows. Returns the dependency id whose arrowhead /
   * approach segment is within `tolerance` pixels of the point, or
   * null when no arrow is hit.
   *
   * Used by gantt.hitTestAt to surface the `dependency` context-menu
   * zone. The hit-test targets the arrowhead area + the final
   * horizontal approach segment — the parts users naturally aim for
   * when right-clicking an arrow. Hitting the long mid-routing
   * segment isn't as reliable but acceptable for v1.
   *
   * `contentX` / `contentY` are post-scroll content-space coords (same
   * frame the renderer uses internally — `clientX - timelinePanelLeft + scrollX`
   * for X, `clientY - timelinePanelTop` for Y including the header
   * offset).
   */
  hitTest(
    contentX: number,
    contentY: number,
    state: GanttState,
    layouts: TaskLayout[],
    scrollY: number,
    headerHeight: number,
    tolerance: number = 8,
  ): string | null {
    const { dependencies } = state;
    if (dependencies.size === 0) return null;
    if (contentY < headerHeight) return null;

    const layoutMap = new Map<string, TaskLayout>();
    for (const layout of layouts) layoutMap.set(layout.taskId, layout);

    let best: { depId: string; dist: number } | null = null;

    for (const dep of dependencies.values()) {
      const sLayout = layoutMap.get(dep.source);
      const tLayout = layoutMap.get(dep.target);
      if (!sLayout || !tLayout) continue;
      const type: DependencyType = dep.type || 'FS';
      const { sourceX, sourceY, targetX, targetY } = this.getConnectionPoints(
        type, sLayout, tLayout, scrollY, headerHeight,
      );

      // Hit zone 1: arrowhead — small radius around (targetX, targetY).
      const arrowDx = contentX - targetX;
      const arrowDy = contentY - targetY;
      const arrowDist = Math.sqrt(arrowDx * arrowDx + arrowDy * arrowDy);
      if (arrowDist <= tolerance + ARROW_SIZE) {
        if (!best || arrowDist < best.dist) {
          best = { depId: dep.id, dist: arrowDist };
        }
        continue;
      }

      // Hit zone 2: final horizontal approach segment from
      // (targetX - HORIZONTAL_GAP, targetY) → (targetX, targetY).
      const approachLeftX =
        type === 'FS' || type === 'SS'
          ? targetX - HORIZONTAL_GAP
          : targetX + HORIZONTAL_GAP;
      const segMinX = Math.min(approachLeftX, targetX);
      const segMaxX = Math.max(approachLeftX, targetX);
      if (
        contentX >= segMinX - tolerance &&
        contentX <= segMaxX + tolerance &&
        Math.abs(contentY - targetY) <= tolerance
      ) {
        const dist = Math.abs(contentY - targetY);
        if (!best || dist < best.dist) {
          best = { depId: dep.id, dist };
        }
      }

      // Hit zone 3: source exit segment.
      const sourceExitX =
        type === 'FS' || type === 'FF'
          ? sourceX + HORIZONTAL_GAP
          : sourceX - HORIZONTAL_GAP;
      const srcMinX = Math.min(sourceX, sourceExitX);
      const srcMaxX = Math.max(sourceX, sourceExitX);
      if (
        contentX >= srcMinX - tolerance &&
        contentX <= srcMaxX + tolerance &&
        Math.abs(contentY - sourceY) <= tolerance
      ) {
        const dist = Math.abs(contentY - sourceY);
        if (!best || dist < best.dist) {
          best = { depId: dep.id, dist };
        }
      }
    }

    return best?.depId ?? null;
  }

  // ─── Connection Points ─────────────────────────────────────────────────────

  /**
   * Compute the source and target connection points based on dependency type.
   * All Y values are converted from content-space to screen-space by adding
   * headerHeight (to shift below the fixed header) and subtracting scrollY.
   */
  private getConnectionPoints(
    type: DependencyType,
    source: TaskLayout,
    target: TaskLayout,
    scrollY: number,
    headerHeight: number,
  ): { sourceX: number; sourceY: number; targetX: number; targetY: number } {
    const sCenterY = source.barY + source.barHeight / 2 - scrollY + headerHeight;
    const tCenterY = target.barY + target.barHeight / 2 - scrollY + headerHeight;

    switch (type) {
      case 'FS': // Finish-to-Start
        return {
          sourceX: source.x + source.width,
          sourceY: sCenterY,
          targetX: target.x,
          targetY: tCenterY,
        };

      case 'SS': // Start-to-Start
        return {
          sourceX: source.x,
          sourceY: sCenterY,
          targetX: target.x,
          targetY: tCenterY,
        };

      case 'FF': // Finish-to-Finish
        return {
          sourceX: source.x + source.width,
          sourceY: sCenterY,
          targetX: target.x + target.width,
          targetY: tCenterY,
        };

      case 'SF': // Start-to-Finish
        return {
          sourceX: source.x,
          sourceY: sCenterY,
          targetX: target.x + target.width,
          targetY: tCenterY,
        };
    }
  }

  // ─── Path Routing ──────────────────────────────────────────────────────────

  /**
   * Draw a right-angle routed path between source and target points.
   * Uses an L-shaped path when the target is to the right, or an S-shaped
   * path when the target is behind/overlapping the source.
   */
  private drawRoutedPath(
    ctx: CanvasRenderingContext2D,
    type: DependencyType,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    theme: ResolvedTheme,
  ): void {
    ctx.beginPath();
    ctx.strokeStyle = theme.dependencyColor;
    ctx.lineWidth = theme.dependencyWidth;
    ctx.moveTo(sourceX, sourceY);

    // Determine approach directions based on dependency type
    const sourceExitsRight = type === 'FS' || type === 'FF';
    const targetEntersLeft = type === 'FS' || type === 'SS';

    // The midX is the first turning point from the source
    const midX = sourceExitsRight
      ? sourceX + HORIZONTAL_GAP
      : sourceX - HORIZONTAL_GAP;

    // The approach point before the target
    const approachX = targetEntersLeft
      ? targetX - HORIZONTAL_GAP
      : targetX + HORIZONTAL_GAP;

    // Determine if we can use a simple L-shape or need an S-shape
    const canSimpleRoute = sourceExitsRight
      ? (targetEntersLeft ? approachX >= midX : targetX + HORIZONTAL_GAP >= midX)
      : (targetEntersLeft ? targetX - HORIZONTAL_GAP <= midX : approachX <= midX);

    if (canSimpleRoute) {
      // L-shape: source → midX → turn to targetY → approach target
      ctx.lineTo(midX, sourceY);
      ctx.lineTo(midX, targetY);
      ctx.lineTo(targetX, targetY);
    } else {
      // S-shape: source → midX → midY → approachX → targetY → target
      const midY = (sourceY + targetY) / 2;
      ctx.lineTo(midX, sourceY);
      ctx.lineTo(midX, midY);
      ctx.lineTo(approachX, midY);
      ctx.lineTo(approachX, targetY);
      ctx.lineTo(targetX, targetY);
    }

    ctx.stroke();
  }

  // ─── Arrowhead ─────────────────────────────────────────────────────────────

  /**
   * Draw a filled triangular arrowhead at the target connection point.
   * The arrow points in the direction the line approaches the target bar.
   */
  private drawArrowhead(
    ctx: CanvasRenderingContext2D,
    type: DependencyType,
    targetX: number,
    targetY: number,
    theme: ResolvedTheme,
  ): void {
    const targetEntersLeft = type === 'FS' || type === 'SS';

    ctx.beginPath();

    if (targetEntersLeft) {
      // Arrow points right (toward the left edge of the target bar)
      ctx.moveTo(targetX, targetY);
      ctx.lineTo(targetX - ARROW_SIZE, targetY - ARROW_HALF_HEIGHT);
      ctx.lineTo(targetX - ARROW_SIZE, targetY + ARROW_HALF_HEIGHT);
    } else {
      // Arrow points left (toward the right edge of the target bar)
      ctx.moveTo(targetX, targetY);
      ctx.lineTo(targetX + ARROW_SIZE, targetY - ARROW_HALF_HEIGHT);
      ctx.lineTo(targetX + ARROW_SIZE, targetY + ARROW_HALF_HEIGHT);
    }

    ctx.closePath();
    ctx.fillStyle = theme.dependencyColor;
    ctx.fill();
  }

  // ─── Connection Dot ────────────────────────────────────────────────────────

  /**
   * Draw a small filled circle at a connection point for visual clarity.
   */
  private drawConnectionDot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    theme: ResolvedTheme,
  ): void {
    ctx.beginPath();
    ctx.arc(x, y, CONNECTION_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = theme.dependencyColor;
    ctx.fill();
  }
}
