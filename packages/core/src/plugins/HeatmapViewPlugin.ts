// ─── Heatmap View Plugin ────────────────────────────────────────────────────
// An alternative visualization mode that shows resource utilization as a
// heatmap. Rows represent unique assignees, columns represent days, and each
// cell is colored by load intensity. Hover for details, click to highlight
// the corresponding tasks in the normal Gantt view.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  TaskLayout,
} from '../model/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const STYLE_ID = 'nimbus-gantt-heatmap-styles';

// Cell sizing
const CELL_SIZE = 28;
const CELL_GAP = 2;
const HEADER_ROW_HEIGHT = 48;    // Date header height (two rows: month + day)
const ROW_HEADER_WIDTH = 160;    // Assignee name column width
const CELL_BORDER_RADIUS = 3;

// Colors by task count
const COLOR_ZERO = '#1e1e2e';     // No tasks — dark gray
const COLOR_ONE = '#166534';      // 1 task — green
const COLOR_TWO = '#a16207';      // 2 tasks — yellow/amber
const COLOR_THREE_PLUS = '#b91c1c'; // 3+ tasks — red
const COLOR_HOVER = 'rgba(255, 255, 255, 0.15)';

// Tooltip
const TOOLTIP_BG = 'rgba(15, 23, 42, 0.95)';
const TOOLTIP_TEXT = '#e2e8f0';
const TOOLTIP_BORDER = '#334155';
const TOOLTIP_MAX_WIDTH = 240;

// ─── CSS ────────────────────────────────────────────────────────────────────

const HEATMAP_CSS = `
  .ng-heatmap-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: #0f172a;
    z-index: 500;
    overflow: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: none;
  }
  .ng-heatmap-container.ng-active {
    display: block;
  }

  .ng-heatmap-header-bar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: #0f172a;
    display: flex;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid #1e293b;
    gap: 12px;
  }
  .ng-heatmap-title {
    font-size: 15px;
    font-weight: 600;
    color: #e2e8f0;
  }
  .ng-heatmap-close {
    margin-left: auto;
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .ng-heatmap-close:hover {
    background: #334155;
    color: #e2e8f0;
  }

  .ng-heatmap-legend {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #94a3b8;
    margin-left: 16px;
  }
  .ng-heatmap-legend-swatch {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    display: inline-block;
    vertical-align: middle;
  }

  .ng-heatmap-grid-wrapper {
    position: relative;
    padding: 8px 16px 16px;
  }

  .ng-heatmap-tooltip {
    position: fixed;
    z-index: 10000;
    background: ${TOOLTIP_BG};
    color: ${TOOLTIP_TEXT};
    border: 1px solid ${TOOLTIP_BORDER};
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    max-width: ${TOOLTIP_MAX_WIDTH}px;
    pointer-events: none;
    display: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    line-height: 1.5;
  }
  .ng-heatmap-tooltip.ng-visible {
    display: block;
  }
  .ng-heatmap-tooltip-date {
    font-weight: 600;
    margin-bottom: 4px;
    color: #cbd5e1;
  }
  .ng-heatmap-tooltip-task {
    color: #94a3b8;
    padding-left: 8px;
  }
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateShort(d: Date): string {
  return String(d.getUTCDate());
}

function formatMonthYear(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatFullDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function dateToKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLoadColor(count: number, maxHours?: number): string {
  if (count === 0) return COLOR_ZERO;
  if (count === 1) return COLOR_ONE;
  if (count === 2) return COLOR_TWO;
  return COLOR_THREE_PLUS;
}

function getLoadOpacity(count: number, maxCount: number): number {
  if (count === 0) return 0.3;
  if (maxCount <= 1) return 0.9;
  // Scale opacity: 0.5 to 1.0 based on relative load
  return 0.5 + 0.5 * (count / maxCount);
}

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HEATMAP_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── Data Model ─────────────────────────────────────────────────────────────

interface HeatmapCell {
  assignee: string;
  date: Date;
  dateKey: string;
  tasks: GanttTask[];
  count: number;
}

interface HeatmapData {
  assignees: string[];
  dates: Date[];
  cells: Map<string, HeatmapCell>; // key: "assignee|dateKey"
  maxCount: number;
}

function buildHeatmapData(state: GanttState): HeatmapData {
  const tasks = Array.from(state.tasks.values());

  // Gather all unique assignees
  const assigneeSet = new Set<string>();
  for (const t of tasks) {
    const assignee = t.assignee || 'Unassigned';
    assigneeSet.add(assignee);
  }
  const assignees = Array.from(assigneeSet).sort();

  // Determine date range
  let minDate = state.dateRange.start;
  let maxDate = state.dateRange.end;

  // Generate array of dates
  const totalDays = daysBetween(minDate, maxDate) + 1;
  const dates: Date[] = [];
  for (let i = 0; i < totalDays; i++) {
    dates.push(addDays(minDate, i));
  }

  // Build cell data
  const cells = new Map<string, HeatmapCell>();
  let maxCount = 0;

  // Initialize empty cells
  for (const assignee of assignees) {
    for (const date of dates) {
      const key = `${assignee}|${dateToKey(date)}`;
      cells.set(key, {
        assignee,
        date,
        dateKey: dateToKey(date),
        tasks: [],
        count: 0,
      });
    }
  }

  // Populate with task data
  for (const task of tasks) {
    const assignee = task.assignee || 'Unassigned';
    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    const taskDays = daysBetween(start, end) + 1;

    for (let i = 0; i < taskDays; i++) {
      const d = addDays(start, i);
      const key = `${assignee}|${dateToKey(d)}`;
      const cell = cells.get(key);
      if (cell) {
        cell.tasks.push(task);
        cell.count++;
        if (cell.count > maxCount) maxCount = cell.count;
      }
    }
  }

  return { assignees, dates, cells, maxCount };
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function HeatmapViewPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  let container: HTMLDivElement | null = null;
  let tooltip: HTMLDivElement | null = null;
  let isActive = false;
  let lastBuiltState: GanttState | null = null;
  const unsubs: (() => void)[] = [];

  function toggle(): void {
    isActive = !isActive;
    if (container) {
      container.classList.toggle('ng-active', isActive);
    }
    if (isActive && host && lastBuiltState) {
      renderHeatmap(lastBuiltState);
    }
  }

  function show(): void {
    isActive = true;
    if (container) container.classList.add('ng-active');
    if (host && lastBuiltState) renderHeatmap(lastBuiltState);
  }

  function hide(): void {
    isActive = false;
    if (container) container.classList.remove('ng-active');
  }

  function renderHeatmap(state: GanttState): void {
    if (!container || !isActive) return;

    const data = buildHeatmapData(state);

    // Clear the grid wrapper area (preserve header bar)
    let gridWrapper = container.querySelector('.ng-heatmap-grid-wrapper') as HTMLDivElement | null;
    if (!gridWrapper) {
      gridWrapper = document.createElement('div');
      gridWrapper.className = 'ng-heatmap-grid-wrapper';
      container.appendChild(gridWrapper);
    }
    gridWrapper.innerHTML = '';

    // Create a canvas for the heatmap (better performance for large datasets)
    const canvas = document.createElement('canvas');
    const totalWidth = ROW_HEADER_WIDTH + data.dates.length * (CELL_SIZE + CELL_GAP);
    const totalHeight = HEADER_ROW_HEIGHT + data.assignees.length * (CELL_SIZE + CELL_GAP);
    const dpr = window.devicePixelRatio || 1;

    canvas.width = totalWidth * dpr;
    canvas.height = totalHeight * dpr;
    canvas.style.width = totalWidth + 'px';
    canvas.style.height = totalHeight + 'px';
    canvas.style.cursor = 'pointer';

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Draw date column headers
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Month labels (top row of header)
    let prevMonth = '';
    let monthStartX = ROW_HEADER_WIDTH;
    for (let col = 0; col < data.dates.length; col++) {
      const d = data.dates[col];
      const monthLabel = formatMonthYear(d);
      const x = ROW_HEADER_WIDTH + col * (CELL_SIZE + CELL_GAP);

      if (monthLabel !== prevMonth) {
        if (prevMonth && col > 0) {
          // Draw the previous month label centered over its span
          const midX = (monthStartX + x) / 2;
          ctx.fillStyle = '#94a3b8';
          ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.fillText(prevMonth, midX, 12);
        }
        monthStartX = x;
        prevMonth = monthLabel;
      }
    }
    // Draw last month label
    if (prevMonth) {
      const endX = ROW_HEADER_WIDTH + data.dates.length * (CELL_SIZE + CELL_GAP);
      const midX = (monthStartX + endX) / 2;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(prevMonth, midX, 12);
    }

    // Day numbers (bottom row of header)
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    for (let col = 0; col < data.dates.length; col++) {
      const d = data.dates[col];
      const x = ROW_HEADER_WIDTH + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      ctx.fillStyle = isWeekend ? '#475569' : '#64748b';
      ctx.fillText(formatDateShort(d), x, 32);
    }

    // Draw separator line
    ctx.beginPath();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.moveTo(0, HEADER_ROW_HEIGHT - 0.5);
    ctx.lineTo(totalWidth, HEADER_ROW_HEIGHT - 0.5);
    ctx.stroke();

    // Draw rows
    for (let row = 0; row < data.assignees.length; row++) {
      const assignee = data.assignees[row];
      const y = HEADER_ROW_HEIGHT + row * (CELL_SIZE + CELL_GAP);

      // Assignee name label
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#cbd5e1';

      // Clip text to row header width
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, ROW_HEADER_WIDTH - 8, CELL_SIZE);
      ctx.clip();
      ctx.fillText(assignee, 8, y + CELL_SIZE / 2);
      ctx.restore();

      // Draw cells
      for (let col = 0; col < data.dates.length; col++) {
        const date = data.dates[col];
        const key = `${assignee}|${dateToKey(date)}`;
        const cell = data.cells.get(key);
        const count = cell?.count ?? 0;
        const x = ROW_HEADER_WIDTH + col * (CELL_SIZE + CELL_GAP);

        const color = getLoadColor(count);
        const opacity = getLoadOpacity(count, data.maxCount);

        ctx.globalAlpha = opacity;
        ctx.fillStyle = color;

        // Rounded rectangle
        roundRect(ctx, x, y, CELL_SIZE, CELL_SIZE, CELL_BORDER_RADIUS);
        ctx.fill();

        // Show count in cell if >= 2
        if (count >= 2) {
          ctx.globalAlpha = 1;
          ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.fillText(String(count), x + CELL_SIZE / 2, y + CELL_SIZE / 2);
        }

        ctx.globalAlpha = 1;
      }
    }

    gridWrapper.appendChild(canvas);

    // ── Mouse interactions ────────────────────────────────────────────
    canvas.addEventListener('mousemove', (e) => {
      if (!tooltip) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const col = Math.floor((mx - ROW_HEADER_WIDTH) / (CELL_SIZE + CELL_GAP));
      const row = Math.floor((my - HEADER_ROW_HEIGHT) / (CELL_SIZE + CELL_GAP));

      if (col < 0 || col >= data.dates.length || row < 0 || row >= data.assignees.length ||
          mx < ROW_HEADER_WIDTH || my < HEADER_ROW_HEIGHT) {
        tooltip.classList.remove('ng-visible');
        return;
      }

      const date = data.dates[col];
      const assignee = data.assignees[row];
      const key = `${assignee}|${dateToKey(date)}`;
      const cell = data.cells.get(key);

      if (!cell || cell.count === 0) {
        tooltip.classList.remove('ng-visible');
        return;
      }

      tooltip.innerHTML = '';
      const dateDiv = document.createElement('div');
      dateDiv.className = 'ng-heatmap-tooltip-date';
      dateDiv.textContent = `${assignee} - ${formatFullDate(date)}`;
      tooltip.appendChild(dateDiv);

      for (const task of cell.tasks) {
        const taskDiv = document.createElement('div');
        taskDiv.className = 'ng-heatmap-tooltip-task';
        taskDiv.textContent = `\u2022 ${task.name}`;
        tooltip.appendChild(taskDiv);
      }

      tooltip.classList.add('ng-visible');

      // Position tooltip near cursor
      const tipX = e.clientX + 12;
      const tipY = e.clientY + 12;
      tooltip.style.left = tipX + 'px';
      tooltip.style.top = tipY + 'px';
    });

    canvas.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.classList.remove('ng-visible');
    });

    canvas.addEventListener('click', (e) => {
      if (!host) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const col = Math.floor((mx - ROW_HEADER_WIDTH) / (CELL_SIZE + CELL_GAP));
      const row = Math.floor((my - HEADER_ROW_HEIGHT) / (CELL_SIZE + CELL_GAP));

      if (col < 0 || col >= data.dates.length || row < 0 || row >= data.assignees.length ||
          mx < ROW_HEADER_WIDTH || my < HEADER_ROW_HEIGHT) {
        return;
      }

      const date = data.dates[col];
      const assignee = data.assignees[row];
      const key = `${assignee}|${dateToKey(date)}`;
      const cell = data.cells.get(key);

      if (!cell || cell.count === 0) return;

      // Switch back to normal view and select those tasks
      hide();
      for (const task of cell.tasks) {
        host.dispatch({ type: 'SELECT_TASK', taskId: task.id, multi: true });
      }
    });
  }

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  return {
    name: 'HeatmapViewPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      injectStyles();

      const unsubToggle = gantt.on('heatmap:toggle', () => toggle());
      const unsubShow = gantt.on('heatmap:show', () => show());
      const unsubHide = gantt.on('heatmap:hide', () => hide());
      unsubs.push(unsubToggle, unsubShow, unsubHide);
    },

    renderDOM(parentContainer: HTMLElement, state: GanttState): void {
      lastBuiltState = state;

      if (!container) {
        container = document.createElement('div');
        container.className = 'ng-heatmap-container';

        // Header bar
        const headerBar = document.createElement('div');
        headerBar.className = 'ng-heatmap-header-bar';

        const title = document.createElement('span');
        title.className = 'ng-heatmap-title';
        title.textContent = 'Resource Heatmap';
        headerBar.appendChild(title);

        // Legend
        const legend = document.createElement('div');
        legend.className = 'ng-heatmap-legend';

        const legendItems = [
          { color: COLOR_ZERO, label: 'None' },
          { color: COLOR_ONE, label: '1 task' },
          { color: COLOR_TWO, label: '2 tasks' },
          { color: COLOR_THREE_PLUS, label: '3+ tasks' },
        ];

        for (const item of legendItems) {
          const swatch = document.createElement('span');
          swatch.className = 'ng-heatmap-legend-swatch';
          swatch.style.background = item.color;
          legend.appendChild(swatch);

          const label = document.createElement('span');
          label.textContent = item.label;
          legend.appendChild(label);
        }
        headerBar.appendChild(legend);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ng-heatmap-close';
        closeBtn.textContent = 'Back to Gantt';
        closeBtn.addEventListener('click', hide);
        headerBar.appendChild(closeBtn);

        container.appendChild(headerBar);

        // Tooltip
        tooltip = document.createElement('div');
        tooltip.className = 'ng-heatmap-tooltip';
        document.body.appendChild(tooltip);

        parentContainer.appendChild(container);
      }

      if (isActive) {
        renderHeatmap(state);
      }
    },

    destroy(): void {
      unsubs.forEach(fn => fn());
      unsubs.length = 0;

      if (container) { container.remove(); container = null; }
      if (tooltip) { tooltip.remove(); tooltip = null; }

      removeStyles();
      host = null;
      isActive = false;
      lastBuiltState = null;
    },
  };
}
