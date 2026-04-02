// ─── Timeline Notes Plugin ──────────────────────────────────────────────────
// Allows adding annotations/notes at specific dates on the timeline. Each note
// renders a vertical dashed line at its date position with an icon at the top
// (flag, star, warning, info, or deadline). Hover shows a tooltip with the
// label and description.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
} from '../model/types';

// ─── Public Types ───────────────────────────────────────────────────────────

export interface TimelineNote {
  id: string;
  date: string;                 // YYYY-MM-DD
  label: string;
  description?: string;
  color?: string;               // default: '#f59e0b' (amber)
  icon?: 'flag' | 'star' | 'warning' | 'info' | 'deadline';
}

export interface TimelineNotesOptions {
  notes: TimelineNote[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_COLOR = '#f59e0b';
const LINE_DASH = [6, 4];
const LINE_WIDTH = 1;
const ICON_SIZE = 16;
const ICON_TOP_MARGIN = 4;      // pixels below the header top
const TOOLTIP_BG = 'rgba(15, 23, 42, 0.95)';
const TOOLTIP_TEXT = '#e2e8f0';
const TOOLTIP_BORDER = '#334155';
const TOOLTIP_RADIUS = 6;
const TOOLTIP_PADDING = 10;
const TOOLTIP_MAX_WIDTH = 220;
const TOOLTIP_FONT_SIZE = 12;
const TOOLTIP_TITLE_FONT_SIZE = 13;

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Darken a hex color by a fraction (0-1) */
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

// ─── Icon Renderers ─────────────────────────────────────────────────────────

type IconRenderer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
) => void;

/** Flag: triangle pennant on a pole */
function drawFlag(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const half = size / 2;
  const poleX = cx - half * 0.4;

  // Pole
  ctx.beginPath();
  ctx.strokeStyle = darkenColor(color, 0.2);
  ctx.lineWidth = 1.5;
  ctx.moveTo(poleX, cy - half);
  ctx.lineTo(poleX, cy + half);
  ctx.stroke();

  // Pennant triangle
  ctx.beginPath();
  ctx.moveTo(poleX, cy - half);
  ctx.lineTo(poleX + size * 0.7, cy - half + size * 0.3);
  ctx.lineTo(poleX, cy - half + size * 0.6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Star: five-pointed star */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const outerR = size / 2;
  const innerR = outerR * 0.4;
  const points = 5;

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 2) * -1 + (Math.PI / points) * i;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.strokeStyle = darkenColor(color, 0.25);
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

/** Warning: triangle with exclamation mark */
function drawWarning(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const half = size / 2;

  // Triangle
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx + half, cy + half * 0.7);
  ctx.lineTo(cx - half, cy + half * 0.7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = darkenColor(color, 0.25);
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Exclamation mark
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size * 0.45}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', cx, cy + half * 0.05);
}

/** Info: circle with "i" */
function drawInfo(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const r = size / 2;

  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = darkenColor(color, 0.25);
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // "i" letter
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size * 0.55}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('i', cx, cy + 1);
}

/** Deadline: clock-like circle with hands */
function drawDeadline(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const r = size / 2;

  // Clock circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = darkenColor(color, 0.25);
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Clock hands
  ctx.beginPath();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  // Hour hand (pointing ~10 o'clock)
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - r * 0.25, cy - r * 0.45);
  ctx.stroke();

  // Minute hand (pointing ~2 o'clock)
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.4, cy - r * 0.2);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

const ICON_RENDERERS: Record<string, IconRenderer> = {
  flag: drawFlag,
  star: drawStar,
  warning: drawWarning,
  info: drawInfo,
  deadline: drawDeadline,
};

// ─── Tooltip Helpers ────────────────────────────────────────────────────────

interface NoteHitZone {
  note: TimelineNote;
  x: number;
  y: number;
  size: number;
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  note: TimelineNote,
  anchorX: number,
  anchorY: number,
  canvasWidth: number,
): void {
  ctx.save();

  const font = `${TOOLTIP_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const titleFont = `600 ${TOOLTIP_TITLE_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  ctx.font = titleFont;
  const titleWidth = ctx.measureText(note.label).width;

  ctx.font = font;
  const descLines: string[] = [];
  let descMaxWidth = 0;

  if (note.description) {
    // Simple word-wrapping
    const words = note.description.split(' ');
    let line = '';
    for (const word of words) {
      const testLine = line ? line + ' ' + word : word;
      const testWidth = ctx.measureText(testLine).width;
      if (testWidth > TOOLTIP_MAX_WIDTH - TOOLTIP_PADDING * 2 && line) {
        descLines.push(line);
        descMaxWidth = Math.max(descMaxWidth, ctx.measureText(line).width);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      descLines.push(line);
      descMaxWidth = Math.max(descMaxWidth, ctx.measureText(line).width);
    }
  }

  const boxWidth = Math.min(
    TOOLTIP_MAX_WIDTH,
    Math.max(titleWidth, descMaxWidth) + TOOLTIP_PADDING * 2,
  );
  const lineHeight = TOOLTIP_FONT_SIZE + 4;
  const titleHeight = TOOLTIP_TITLE_FONT_SIZE + 4;
  const boxHeight = TOOLTIP_PADDING * 2 + titleHeight + (descLines.length > 0 ? 4 + descLines.length * lineHeight : 0);

  // Position tooltip above the anchor, centered horizontally
  let x = anchorX - boxWidth / 2;
  const y = anchorY - boxHeight - 8;

  // Clamp to canvas bounds
  if (x < 4) x = 4;
  if (x + boxWidth > canvasWidth - 4) x = canvasWidth - boxWidth - 4;

  // Rounded rectangle background
  ctx.beginPath();
  roundRect(ctx, x, y, boxWidth, boxHeight, TOOLTIP_RADIUS);
  ctx.fillStyle = TOOLTIP_BG;
  ctx.fill();
  ctx.strokeStyle = TOOLTIP_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Title text
  ctx.font = titleFont;
  ctx.fillStyle = TOOLTIP_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(note.label, x + TOOLTIP_PADDING, y + TOOLTIP_PADDING);

  // Description text
  if (descLines.length > 0) {
    ctx.font = font;
    ctx.fillStyle = '#94a3b8';
    let textY = y + TOOLTIP_PADDING + titleHeight + 4;
    for (const line of descLines) {
      ctx.fillText(line, x + TOOLTIP_PADDING, textY);
      textY += lineHeight;
    }
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function TimelineNotesPlugin(options: TimelineNotesOptions): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  let notes: TimelineNote[] = [...options.notes];
  let hoveredNoteId: string | null = null;
  let hitZones: NoteHitZone[] = [];
  const unsubs: (() => void)[] = [];

  // Track mouse position for hover detection in renderCanvas
  let mouseX = -1;
  let mouseY = -1;
  let mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  let canvasEl: HTMLCanvasElement | null = null;

  function findNote(id: string): TimelineNote | undefined {
    return notes.find(n => n.id === id);
  }

  function addNote(note: TimelineNote): void {
    notes.push(note);
    triggerRerender();
  }

  function removeNote(id: string): void {
    notes = notes.filter(n => n.id !== id);
    triggerRerender();
  }

  function updateNote(id: string, changes: Partial<TimelineNote>): void {
    const note = findNote(id);
    if (note) {
      Object.assign(note, changes);
      triggerRerender();
    }
  }

  function listNotes(): TimelineNote[] {
    return [...notes];
  }

  function triggerRerender(): void {
    if (!host) return;
    const state = host.getState();
    host.dispatch({ type: 'SET_SCROLL', x: state.scrollX, y: state.scrollY });
  }

  function setupMouseTracking(ctx: CanvasRenderingContext2D): void {
    const newCanvas = ctx.canvas;
    if (canvasEl === newCanvas) return;

    // Cleanup old listener
    if (canvasEl && mouseMoveHandler) {
      canvasEl.removeEventListener('mousemove', mouseMoveHandler);
    }

    canvasEl = newCanvas;
    mouseMoveHandler = (e: MouseEvent) => {
      const rect = newCanvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;

      // Check hit zones
      let newHovered: string | null = null;
      for (const zone of hitZones) {
        const dx = mouseX - zone.x;
        const dy = mouseY - zone.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= zone.size) {
          newHovered = zone.note.id;
          break;
        }
      }

      if (newHovered !== hoveredNoteId) {
        hoveredNoteId = newHovered;
        newCanvas.style.cursor = hoveredNoteId ? 'pointer' : '';
        triggerRerender();
      }
    };

    newCanvas.addEventListener('mousemove', mouseMoveHandler);
  }

  return {
    name: 'TimelineNotesPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Event: add a new note
      const unsubAdd = gantt.on('notes:add', (...args: unknown[]) => {
        const note = args[0] as TimelineNote;
        if (note && note.id && note.date && note.label) {
          addNote(note);
        }
      });

      // Event: remove a note by id
      const unsubRemove = gantt.on('notes:remove', (...args: unknown[]) => {
        const id = args[0] as string;
        if (id) removeNote(id);
      });

      // Event: update a note
      const unsubUpdate = gantt.on('notes:update', (...args: unknown[]) => {
        const payload = args[0] as { id: string } & Partial<TimelineNote>;
        if (payload && payload.id) {
          const { id, ...changes } = payload;
          updateNote(id, changes);
        }
      });

      // Event: list all notes (returns via callback in args[0])
      const unsubList = gantt.on('notes:list', (...args: unknown[]) => {
        const callback = args[0] as ((notes: TimelineNote[]) => void) | undefined;
        if (typeof callback === 'function') {
          callback(listNotes());
        }
      });

      unsubs.push(unsubAdd, unsubRemove, unsubUpdate, unsubList);
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!host || notes.length === 0) return;

      const { config, scrollX, scrollY, dateRange } = state;
      const { theme } = config;
      const headerHeight = config.headerHeight;
      const timeScale = host.getTimeScale();

      // Set up mouse tracking for hover detection
      setupMouseTracking(ctx);

      const canvasW = ctx.canvas.width / (window.devicePixelRatio || 1);
      const canvasH = ctx.canvas.height / (window.devicePixelRatio || 1);
      const bodyTop = headerHeight;
      const bodyHeight = canvasH - bodyTop;

      // Clear hit zones for this frame
      hitZones = [];

      ctx.save();

      for (const note of notes) {
        const noteDate = parseDate(note.date);

        // Check if note is within visible date range (with some padding)
        if (noteDate < dateRange.start || noteDate > dateRange.end) continue;

        const color = note.color || DEFAULT_COLOR;
        const iconType = note.icon || 'flag';
        const x = timeScale.dateToX(noteDate) - scrollX;

        // Skip if off-screen
        if (x < -ICON_SIZE || x > canvasW + ICON_SIZE) continue;

        // ── 1. Vertical dashed line (full body height) ──────────────────
        // Render behind task bars but in front of grid lines
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash(LINE_DASH);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = LINE_WIDTH;
        ctx.moveTo(x, bodyTop);
        ctx.lineTo(x, bodyTop + bodyHeight);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.restore();

        // ── 2. Icon at the top of the line ──────────────────────────────
        const iconCenterX = x;
        const iconCenterY = bodyTop + ICON_TOP_MARGIN + ICON_SIZE / 2;

        const renderer = ICON_RENDERERS[iconType] || ICON_RENDERERS.flag;

        // Draw a subtle background circle behind the icon for visibility
        ctx.save();
        ctx.beginPath();
        ctx.arc(iconCenterX, iconCenterY, ICON_SIZE / 2 + 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fill();
        ctx.restore();

        // Draw the icon
        ctx.save();
        renderer(ctx, iconCenterX, iconCenterY, ICON_SIZE, color);
        ctx.restore();

        // Record hit zone for hover detection
        hitZones.push({
          note,
          x: iconCenterX,
          y: iconCenterY,
          size: ICON_SIZE / 2 + 4,
        });

        // ── 3. Tooltip for hovered note ─────────────────────────────────
        if (hoveredNoteId === note.id) {
          drawTooltip(ctx, note, iconCenterX, iconCenterY - ICON_SIZE / 2 - 4, canvasW);
        }
      }

      ctx.restore();
    },

    destroy(): void {
      unsubs.forEach(fn => fn());
      unsubs.length = 0;

      if (canvasEl && mouseMoveHandler) {
        canvasEl.removeEventListener('mousemove', mouseMoveHandler);
      }

      host = null;
      canvasEl = null;
      mouseMoveHandler = null;
      hoveredNoteId = null;
      hitZones = [];
    },
  };
}
