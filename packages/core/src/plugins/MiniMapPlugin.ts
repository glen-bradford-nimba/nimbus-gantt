// ─── MiniMap Plugin ─────────────────────────────────────────────────────────
// A miniature overview map in the bottom-right corner showing the entire
// project timeline at a glance. A viewport rectangle shows what's currently
// visible, and the user can drag or click the minimap to scroll the main view.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
} from '../model/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 80;
const MINIMAP_MARGIN = 12;
const MINIMAP_BORDER_RADIUS = 6;
const MINIMAP_BG = '#1a1a2e';
const MINIMAP_BORDER = '#334155';
const VIEWPORT_COLOR = 'rgba(59, 130, 246, 0.3)';
const VIEWPORT_BORDER_COLOR = 'rgba(59, 130, 246, 0.7)';
const VIEWPORT_BORDER_WIDTH = 1.5;
const TASK_BAR_HEIGHT = 2;
const TASK_BAR_GAP = 1;
const STYLE_ID = 'nimbus-gantt-minimap-styles';

const MS_PER_DAY = 86_400_000;

// ─── CSS ────────────────────────────────────────────────────────────────────

const MINIMAP_CSS = `
  .ng-minimap {
    position: absolute;
    bottom: ${MINIMAP_MARGIN}px;
    right: ${MINIMAP_MARGIN}px;
    width: ${MINIMAP_WIDTH}px;
    height: ${MINIMAP_HEIGHT}px;
    z-index: 900;
    border-radius: ${MINIMAP_BORDER_RADIUS}px;
    border: 1px solid ${MINIMAP_BORDER};
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    cursor: pointer;
    user-select: none;
    transition: opacity 200ms ease, transform 200ms ease;
  }
  .ng-minimap.ng-hidden {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.9);
  }
  .ng-minimap canvas {
    display: block;
    border-radius: ${MINIMAP_BORDER_RADIUS}px;
  }
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MINIMAP_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function MiniMapPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  let wrapper: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let isVisible = true;
  let isDragging = false;
  const unsubs: (() => void)[] = [];

  // Cached scale factors for coordinate conversion
  let scaleX = 1;
  let scaleY = 1;
  let fullContentWidth = 0;
  let fullContentHeight = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;

  function toggle(): void {
    isVisible = !isVisible;
    if (wrapper) {
      wrapper.classList.toggle('ng-hidden', !isVisible);
    }
  }

  function show(): void {
    isVisible = true;
    if (wrapper) wrapper.classList.remove('ng-hidden');
  }

  function hide(): void {
    isVisible = false;
    if (wrapper) wrapper.classList.add('ng-hidden');
  }

  /**
   * Convert minimap pixel coordinates to main view scroll position
   */
  function minimapToScroll(mx: number, my: number): { x: number; y: number } {
    // Center the viewport on the clicked point
    const scrollX = (mx / scaleX) - (viewportWidth / 2);
    const scrollY = (my / scaleY) - (viewportHeight / 2);
    return {
      x: Math.max(0, Math.min(scrollX, fullContentWidth - viewportWidth)),
      y: Math.max(0, Math.min(scrollY, fullContentHeight - viewportHeight)),
    };
  }

  function handleMouseDown(e: MouseEvent): void {
    if (!host || !canvas) return;
    e.preventDefault();
    isDragging = true;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const scroll = minimapToScroll(mx, my);
    host.dispatch({ type: 'SET_SCROLL', x: scroll.x, y: scroll.y });
  }

  function handleMouseMove(e: MouseEvent): void {
    if (!isDragging || !host || !canvas) return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mx = Math.max(0, Math.min(e.clientX - rect.left, MINIMAP_WIDTH));
    const my = Math.max(0, Math.min(e.clientY - rect.top, MINIMAP_HEIGHT));

    const scroll = minimapToScroll(mx, my);
    host.dispatch({ type: 'SET_SCROLL', x: scroll.x, y: scroll.y });
  }

  function handleMouseUp(): void {
    isDragging = false;
  }

  function renderMinimap(state: GanttState, layouts: TaskLayout[]): void {
    if (!ctx || !canvas || !isVisible) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_WIDTH * dpr;
    canvas.height = MINIMAP_HEIGHT * dpr;
    canvas.style.width = MINIMAP_WIDTH + 'px';
    canvas.style.height = MINIMAP_HEIGHT + 'px';
    ctx.scale(dpr, dpr);

    const { config, scrollX, scrollY, dateRange } = state;

    // ── Compute full content dimensions ────────────────────────────────
    const timeScale = host!.getTimeScale();
    const totalDays = Math.round(
      (dateRange.end.getTime() - dateRange.start.getTime()) / MS_PER_DAY,
    );
    const colWidth = timeScale.getColumnWidth();

    fullContentWidth = Math.max(totalDays * colWidth, 1);
    fullContentHeight = Math.max(state.flatVisibleIds.length * config.rowHeight, 1);

    // Estimate visible viewport size from container (approximate)
    // The main container size isn't directly exposed, so we estimate from layouts
    viewportWidth = fullContentWidth > 0 ? Math.min(fullContentWidth, 1200) : 1200;
    viewportHeight = fullContentHeight > 0 ? Math.min(fullContentHeight, 600) : 600;

    // If we can find the actual gantt container, use its real size
    if (wrapper && wrapper.parentElement) {
      const parent = wrapper.parentElement;
      viewportWidth = parent.clientWidth - config.gridWidth;
      viewportHeight = parent.clientHeight - config.headerHeight;
    }

    // Scale factors: minimap pixels per content pixel
    scaleX = MINIMAP_WIDTH / Math.max(fullContentWidth, 1);
    scaleY = MINIMAP_HEIGHT / Math.max(fullContentHeight, 1);

    // ── Clear background ───────────────────────────────────────────────
    ctx.fillStyle = MINIMAP_BG;
    ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    // ── Draw task bars ─────────────────────────────────────────────────
    // Group tasks by row to stack them vertically
    const rowTasks = new Map<number, TaskLayout[]>();
    for (const layout of layouts) {
      if (!rowTasks.has(layout.rowIndex)) {
        rowTasks.set(layout.rowIndex, []);
      }
      rowTasks.get(layout.rowIndex)!.push(layout);
    }

    for (const layout of layouts) {
      // Map task position to minimap coordinates
      const x = layout.x * scaleX;
      const width = Math.max(layout.width * scaleX, 1); // At least 1px
      const y = (layout.rowIndex * config.rowHeight) * scaleY;

      ctx.fillStyle = layout.color || config.theme.barDefaultColor;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(x, y, width, Math.max(TASK_BAR_HEIGHT, config.rowHeight * scaleY - TASK_BAR_GAP));
    }
    ctx.globalAlpha = 1;

    // ── Draw viewport rectangle ────────────────────────────────────────
    const vpX = scrollX * scaleX;
    const vpY = scrollY * scaleY;
    const vpW = viewportWidth * scaleX;
    const vpH = viewportHeight * scaleY;

    // Clamp viewport rect to minimap bounds
    const clampedVpX = Math.max(0, Math.min(vpX, MINIMAP_WIDTH - 1));
    const clampedVpY = Math.max(0, Math.min(vpY, MINIMAP_HEIGHT - 1));
    const clampedVpW = Math.min(vpW, MINIMAP_WIDTH - clampedVpX);
    const clampedVpH = Math.min(vpH, MINIMAP_HEIGHT - clampedVpY);

    // Fill
    ctx.fillStyle = VIEWPORT_COLOR;
    ctx.fillRect(clampedVpX, clampedVpY, clampedVpW, clampedVpH);

    // Border
    ctx.strokeStyle = VIEWPORT_BORDER_COLOR;
    ctx.lineWidth = VIEWPORT_BORDER_WIDTH;
    ctx.strokeRect(clampedVpX, clampedVpY, clampedVpW, clampedVpH);
  }

  return {
    name: 'MiniMapPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      injectStyles();

      const unsubToggle = gantt.on('minimap:toggle', () => toggle());
      const unsubShow = gantt.on('minimap:show', () => show());
      const unsubHide = gantt.on('minimap:hide', () => hide());
      unsubs.push(unsubToggle, unsubShow, unsubHide);

      // Global mouse events for drag
      if (typeof document !== 'undefined') {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }
    },

    renderDOM(container: HTMLElement, state: GanttState): void {
      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'ng-minimap' + (isVisible ? '' : ' ng-hidden');

        canvas = document.createElement('canvas');
        ctx = canvas.getContext('2d');

        canvas.addEventListener('mousedown', handleMouseDown);

        wrapper.appendChild(canvas);
        container.appendChild(wrapper);
      }

      // Render the minimap content
      const layouts = host?.getLayouts() ?? [];
      renderMinimap(state, layouts);
    },

    destroy(): void {
      unsubs.forEach(fn => fn());
      unsubs.length = 0;

      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }

      if (wrapper) { wrapper.remove(); wrapper = null; }
      canvas = null;
      ctx = null;

      removeStyles();
      host = null;
      isVisible = true;
      isDragging = false;
    },
  };
}
