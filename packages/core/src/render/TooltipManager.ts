import type { GanttTask } from '../model/types';

const TOOLTIP_OFFSET = 12;
const HIDE_DELAY_MS = 100;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TOOLTIP_STYLES = `
.ng-tooltip {
  position: absolute;
  z-index: 1000;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 0;
  pointer-events: none;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  min-width: 180px;
  max-width: 280px;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.ng-tooltip.ng-tooltip-visible {
  opacity: 1;
  transform: translateY(0);
}
.ng-tooltip-header {
  padding: 8px 10px;
  border-bottom: 1px solid #f3f4f6;
  font-weight: 600;
  color: #111827;
}
.ng-tooltip-id {
  margin-top: 2px;
  font-weight: 400;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  color: #9ca3af;
  user-select: all;
  word-break: break-all;
}
.ng-tooltip-body {
  padding: 6px 10px;
}
.ng-tooltip-divider {
  border-top: 1px solid #f3f4f6;
}
.ng-tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 0;
}
.ng-tooltip-label {
  color: #6b7280;
}
.ng-tooltip-value {
  color: #111827;
  font-weight: 500;
}
.ng-tooltip-value.ng-tooltip-over {
  color: #dc2626;
}
`;

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format "YYYY-MM-DD" as "Mon DD" (e.g. "Apr 1"). */
function formatDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return escapeHtml(iso);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (month < 0 || month > 11 || isNaN(day)) return escapeHtml(iso);
  return `${MONTH_NAMES[month]} ${day}`;
}

function buildRow(label: string, value: string, valueClass?: string): string {
  const cls = valueClass ? ` ${valueClass}` : '';
  return `<div class="ng-tooltip-row"><span class="ng-tooltip-label">${escapeHtml(label)}</span><span class="ng-tooltip-value${cls}">${escapeHtml(value)}</span></div>`;
}

/** Trim trailing-zero decimals: 8 \u2192 "8", 8.5 \u2192 "8.5", 8.25 \u2192 "8.3". */
function formatHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/**
 * Read a numeric field from a task, trying the top-level property first and
 * then `metadata`, across several known key aliases. Hosts populate hours
 * under different conventions (top-level `hours`, `metadata.estimatedHours`,
 * `metadata.loggedHours`, etc.) \u2014 the tooltip should surface whichever exists.
 */
function readNum(task: GanttTask, ...keys: string[]): number | undefined {
  const top = task as unknown as Record<string, unknown>;
  for (const k of keys) {
    const direct = top[k];
    if (typeof direct === 'number' && !Number.isNaN(direct)) return direct;
    const meta = task.metadata?.[k];
    if (typeof meta === 'number' && !Number.isNaN(meta)) return meta;
  }
  return undefined;
}

/** Whole days spanned by [startDate, endDate], inclusive (min 1). */
function durationDays(startISO: string, endISO: string): number | null {
  const a = Date.parse(startISO);
  const b = Date.parse(endISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function buildDefaultContent(task: GanttTask, color: string): string {
  const progress = Math.round((task.progress ?? 0) * 100);
  const estimate = readNum(task, 'estimatedHours', 'estimateHours', 'hours');
  const logged = readNum(task, 'loggedHours', 'actualHours');

  // \u2500\u2500 Primary block: who / when / where it stands \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  let bodyRows = '';
  if (task.status) bodyRows += buildRow('Status', task.status);
  if (task.priority) bodyRows += buildRow('Priority', task.priority);
  bodyRows += buildRow('Assignee', task.assignee || 'Unassigned');
  const days = durationDays(task.startDate, task.endDate);
  const dateRange = `${formatDate(task.startDate)} \u2192 ${formatDate(task.endDate)}`;
  bodyRows += buildRow('Dates', days ? `${dateRange} (${days}d)` : dateRange);
  if (progress > 0) {
    bodyRows += buildRow('Progress', `${progress}%`);
  }

  // \u2500\u2500 Sizing & actuals block: estimate vs. logged, with burn % \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  let sizingRows = '';
  if (estimate != null) sizingRows += buildRow('Estimate', `${formatHours(estimate)}h`);
  if (logged != null) sizingRows += buildRow('Logged', `${formatHours(logged)}h`);
  if (estimate != null && logged != null && estimate > 0) {
    const pct = Math.round((logged / estimate) * 100);
    const over = logged > estimate;
    const remaining = estimate - logged;
    const detail = over
      ? `${pct}% (${formatHours(logged - estimate)}h over)`
      : `${pct}% (${formatHours(remaining)}h left)`;
    sizingRows += buildRow('Used', detail, over ? 'ng-tooltip-over' : undefined);
  }

  const idHtml = `<div class="ng-tooltip-id" title="Work item ID">${escapeHtml(task.id)}</div>`;
  const header = `<div class="ng-tooltip-header" style="border-left: 3px solid ${escapeHtml(color)}"><span class="ng-tooltip-name">${escapeHtml(task.name)}</span>${idHtml}</div>`;
  const sizingBlock = sizingRows
    ? `<div class="ng-tooltip-divider"></div><div class="ng-tooltip-body">${sizingRows}</div>`
    : '';
  return `${header}<div class="ng-tooltip-body">${bodyRows}</div>${sizingBlock}`;
}

export class TooltipManager {
  private container: HTMLElement;
  private tooltipEl: HTMLElement;
  private styleEl: HTMLStyleElement;
  private visible = false;
  private hideTimeout: number | null = null;
  private customRenderer?: (task: GanttTask) => string | HTMLElement;

  constructor(
    container: HTMLElement,
    customRenderer?: (task: GanttTask) => string | HTMLElement,
  ) {
    this.container = container;
    this.customRenderer = customRenderer;

    // Inject styles once
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = TOOLTIP_STYLES;
    document.head.appendChild(this.styleEl);

    // Create tooltip element
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'ng-tooltip';
    this.tooltipEl.style.display = 'none';
    this.container.appendChild(this.tooltipEl);
  }

  show(task: GanttTask, x: number, y: number, color: string): void {
    // Clear any pending hide
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    // Populate content
    if (this.customRenderer) {
      const result = this.customRenderer(task);
      if (typeof result === 'string') {
        this.tooltipEl.innerHTML = result;
      } else {
        this.tooltipEl.innerHTML = '';
        this.tooltipEl.appendChild(result);
      }
    } else {
      this.tooltipEl.innerHTML = buildDefaultContent(task, color);
    }

    // Make visible for measurement (but not yet animated in)
    this.tooltipEl.style.display = '';
    this.tooltipEl.classList.remove('ng-tooltip-visible');

    // Measure tooltip size
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    // Compute position relative to container
    let left = x + TOOLTIP_OFFSET;
    let top = y + TOOLTIP_OFFSET;

    // Flip horizontally if overflowing the right edge
    if (left + tooltipRect.width > containerRect.width) {
      left = x - TOOLTIP_OFFSET - tooltipRect.width;
    }

    // Flip vertically if overflowing the bottom edge
    if (top + tooltipRect.height > containerRect.height) {
      top = y - TOOLTIP_OFFSET - tooltipRect.height;
    }

    // Clamp to stay within container
    left = Math.max(0, left);
    top = Math.max(0, top);

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;

    // Trigger the enter animation on the next frame
    requestAnimationFrame(() => {
      this.tooltipEl.classList.add('ng-tooltip-visible');
    });

    this.visible = true;
  }

  hide(): void {
    if (!this.visible) return;

    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
    }

    this.hideTimeout = window.setTimeout(() => {
      this.tooltipEl.classList.remove('ng-tooltip-visible');

      // Wait for the CSS transition to finish before hiding
      const onTransitionEnd = (): void => {
        this.tooltipEl.removeEventListener('transitionend', onTransitionEnd);
        if (!this.tooltipEl.classList.contains('ng-tooltip-visible')) {
          this.tooltipEl.style.display = 'none';
        }
      };
      this.tooltipEl.addEventListener('transitionend', onTransitionEnd);

      // Fallback in case transitionend never fires (e.g. display:none race)
      window.setTimeout(() => {
        if (!this.tooltipEl.classList.contains('ng-tooltip-visible')) {
          this.tooltipEl.style.display = 'none';
        }
      }, 200);

      this.visible = false;
      this.hideTimeout = null;
    }, HIDE_DELAY_MS);
  }

  destroy(): void {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.tooltipEl.remove();
    this.styleEl.remove();
  }
}
