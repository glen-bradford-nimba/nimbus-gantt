import type { TaskLayout, ResolvedConfig } from '../model/types';

// ─── Hit Test Types ────────────────────────────────────────────────────────

export type HitType =
  | 'bar'
  | 'bar-left-edge'
  | 'bar-right-edge'
  | 'progress-handle'
  | 'link-point'
  | 'none';

export interface HitResult {
  type: HitType;
  taskId: string;
  layout: TaskLayout;
}

// ─── HitTest ───────────────────────────────────────────────────────────────

/**
 * Resolves mouse/pointer coordinates on the Canvas to interactive elements.
 * All coordinates are in canvas space (already accounting for scroll offsets).
 */
export class HitTest {
  private edgeThreshold = 6;
  private linkPointRadius = 8;

  /**
   * Test a point against all visible task layouts.
   * x, y are in CANVAS coordinates (already accounting for scroll offsets).
   *
   * Iterates last-to-first for correct z-order (top-rendered items checked first).
   */
  test(
    canvasX: number,
    canvasY: number,
    layouts: TaskLayout[],
    config: ResolvedConfig,
  ): HitResult | null {
    // Iterate in reverse for correct z-order (last rendered = on top)
    for (let i = layouts.length - 1; i >= 0; i--) {
      const layout = layouts[i];
      const hitType = this.testLayout(canvasX, canvasY, layout, config);
      if (hitType !== null) {
        return {
          type: hitType,
          taskId: layout.taskId,
          layout,
        };
      }
    }
    return null;
  }

  /**
   * Get the cursor style for a given hit result.
   */
  getCursor(hit: HitResult | null, readOnly: boolean): string {
    if (!hit) return 'default';

    switch (hit.type) {
      case 'bar':
        return readOnly ? 'default' : 'grab';
      case 'bar-left-edge':
      case 'bar-right-edge':
        return 'col-resize';
      case 'progress-handle':
        return 'ew-resize';
      case 'link-point':
        return 'crosshair';
      case 'none':
      default:
        return 'default';
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private testLayout(
    canvasX: number,
    canvasY: number,
    layout: TaskLayout,
    config: ResolvedConfig,
  ): HitType | null {
    if (layout.isMilestone) {
      return this.testMilestone(canvasX, canvasY, layout);
    }
    return this.testBar(canvasX, canvasY, layout, config);
  }

  /**
   * Test a standard bar layout.
   * Order of checks matters: edges and progress handle take priority over the
   * generic bar hit when the pointer is near those affordances.
   */
  private testBar(
    canvasX: number,
    canvasY: number,
    layout: TaskLayout,
    config: ResolvedConfig,
  ): HitType | null {
    const { x, barY, width, barHeight } = layout;

    // Check if point is inside the bar bounding box
    if (
      canvasX < x ||
      canvasX > x + width ||
      canvasY < barY ||
      canvasY > barY + barHeight
    ) {
      return null;
    }

    // Left edge resize zone
    if (canvasX <= x + this.edgeThreshold) {
      return 'bar-left-edge';
    }

    // Right edge resize zone
    if (canvasX >= x + width - this.edgeThreshold) {
      return 'bar-right-edge';
    }

    // Progress handle — a narrow zone at the progress boundary
    if (config.showProgress && layout.progressWidth > 0) {
      const handleX = x + layout.progressWidth;
      if (Math.abs(canvasX - handleX) <= this.edgeThreshold) {
        return 'progress-handle';
      }
    }

    return 'bar';
  }

  /**
   * Test a milestone layout.
   * Milestones render as a diamond (rotated square) centered at (x, barY + barHeight/2).
   * We use a simple square hit area for the diamond shape — this is generous
   * enough to feel natural while being simple to compute.
   */
  private testMilestone(
    canvasX: number,
    canvasY: number,
    layout: TaskLayout,
  ): HitType | null {
    const centerX = layout.x;
    const centerY = layout.barY + layout.barHeight / 2;
    const halfSize = layout.barHeight / 2;

    // Square hit area centered on the diamond
    if (
      Math.abs(canvasX - centerX) <= halfSize &&
      Math.abs(canvasY - centerY) <= halfSize
    ) {
      return 'bar';
    }

    return null;
  }
}
