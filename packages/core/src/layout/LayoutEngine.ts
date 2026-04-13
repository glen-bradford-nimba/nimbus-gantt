import type { GanttTask, ResolvedConfig, TaskLayout } from '../model/types';
import type { TimeScale } from './TimeScale';

// ─── LayoutEngine ───────────────────────────────────────────────────────────

export class LayoutEngine {
  /**
   * Compute pixel-level layout for every visible task.
   *
   * @param flatVisibleIds  Ordered task IDs after tree expand/collapse
   * @param tasks           Full task map (keyed by ID)
   * @param timeScale       Converts dates to pixel positions
   * @param config          Resolved configuration with defaults applied
   */
  computeLayouts(
    flatVisibleIds: string[],
    tasks: Map<string, GanttTask>,
    timeScale: TimeScale,
    config: ResolvedConfig,
  ): TaskLayout[] {
    const layouts: TaskLayout[] = [];

    for (let rowIndex = 0; rowIndex < flatVisibleIds.length; rowIndex++) {
      const taskId = flatVisibleIds[rowIndex];
      const task = tasks.get(taskId);
      if (!task) continue;

      const startDate = parseDate(task.startDate);
      const endDate = parseDate(task.endDate);

      const x = timeScale.dateToX(startDate);
      const rawWidth = timeScale.dateToX(endDate) - x;
      const width = Math.max(rawWidth, config.minBarWidth);

      const y = rowIndex * config.rowHeight;
      const barY = y + (config.rowHeight - config.barHeight) / 2;

      const progressWidth = width * (task.progress || 0);

      const color =
        task.color ||
        config.colorMap[task.status || ''] ||
        config.theme.barDefaultColor;

      layouts.push({
        taskId,
        rowIndex,
        x,
        y,
        width,
        barY,
        barHeight: config.barHeight,
        progressWidth,
        color,
        textColor: config.theme.barTextColor,
        // ── Rich bar label: "137h · 27% · Title" (cloudnimbusllc.com patch) ──
        // Group headers just show their name; regular tasks get hours + progress + title.
        label: task.status === 'group-header'
          ? task.name
          : (
              (task.hoursLabel || (task.hours != null ? `${task.hours}h` : '')) +
              (task.hoursLabel || task.hours != null ? ' · ' : '') +
              ((task.progress || 0) > 0 ? `${Math.round((task.progress || 0) * 100)}% · ` : '') +
              (task.title || task.name)
            ),
        isMilestone: task.isMilestone || false,
      });
    }

    return layouts;
  }
}

// ─── Date Parser ────────────────────────────────────────────────────────────

/**
 * Parse a `YYYY-MM-DD` string into a UTC Date object.
 * Uses Date.UTC to avoid local-timezone / DST shifts.
 */
export function parseDate(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // JS months are 0-indexed
  const day = Number(dayStr);
  return new Date(Date.UTC(year, month, day));
}
