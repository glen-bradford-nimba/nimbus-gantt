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
   * Context expectations:
   * - ctx already has `translate(-scrollX, 0)` applied (X is timeline-space)
   * - ctx is clipped to the body region (below headerHeight)
   * - Y coordinates must be offset by `-scrollY` relative to absolute layout positions
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

    ctx.save();

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

  // ─── Connection Points ─────────────────────────────────────────────────────

  /**
   * Compute the source and target connection points based on dependency type.
   * All Y values are adjusted for scrollY.
   */
  private getConnectionPoints(
    type: DependencyType,
    source: TaskLayout,
    target: TaskLayout,
    scrollY: number,
  ): { sourceX: number; sourceY: number; targetX: number; targetY: number } {
    const sCenterY = source.barY + source.barHeight / 2 - scrollY;
    const tCenterY = target.barY + target.barHeight / 2 - scrollY;

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
