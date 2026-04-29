// ─── History Strip Plugin (0.188.0) ────────────────────────────────────────
// Renders a thin horizontal strip above (or below) the timeline header,
// with time-anchored markers for each annotation in the history log.
// Click a marker → scrub the time cursor to that moment. Hover → tooltip
// with the annotation kind + payload preview.
//
// Annotations come from gantt.history.annotations() — appended by the host
// or by other plugins (ReplayNarrationPlugin, comment widgets, etc.).
// Each carries a wall-clock ts, a kind ('comment' | 'decision' | 'agent-note'
// | 'view' | host.custom), an optional taskId anchor, and a free-form
// payload.
//
// Substrate dependency: requires HistoryPlugin to be installed first
// (provides gantt.history). Falls through silently when unavailable so
// the plugin stays cheap to install speculatively.
//
// Pure renderCanvas + DOM overlay for the click-to-scrub interaction.
// Markers paint at the top of the timeline body; click handler is wired
// on the gantt's root element via host.on() — no global listeners.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
} from '../model/types';

export interface HistoryStripOptions {
  /** Strip height in pixels. Default 14. */
  height?: number;
  /** Place the strip above the timeline body (between header and bars)
   *  or below the existing today-line marker. Default 'above-body'. */
  position?: 'above-body' | 'below-header';
  /** Marker color per annotation kind. Default mapping covers
   *  comment/decision/agent-note/view; unknown kinds get the fallback. */
  colorByKind?: Record<string, string>;
  /** Fallback color for unknown kinds. Default '#6b7280' (slate). */
  fallbackColor?: string;
  /** Marker dot radius in pixels. Default 4. */
  markerRadius?: number;
  /** When two markers are within this pixel distance, the renderer
   *  collapses them into a single "cluster" marker. Default 6. */
  clusterDistancePx?: number;
  /** Click handler override. Default: scrub history cursor to the
   *  annotation's wallTs. */
  onMarkerClick?: (annotation: { wallTs: number; kind: string; taskId?: string; payload?: unknown }) => void;
}

const DEFAULT_HEIGHT = 14;
const DEFAULT_RADIUS = 4;
const DEFAULT_CLUSTER_DISTANCE = 6;
const DEFAULT_FALLBACK_COLOR = '#6b7280';

const DEFAULT_COLORS: Record<string, string> = {
  comment: '#3b82f6',     // blue
  decision: '#8b5cf6',    // violet
  'agent-note': '#10b981',// emerald
  view: '#a3a3a3',        // grey
};

export function HistoryStripPlugin(opts: HistoryStripOptions = {}): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gantt: any = null;

  const height = opts.height ?? DEFAULT_HEIGHT;
  const position = opts.position ?? 'above-body';
  const radius = opts.markerRadius ?? DEFAULT_RADIUS;
  const clusterDist = opts.clusterDistancePx ?? DEFAULT_CLUSTER_DISTANCE;
  const fallback = opts.fallbackColor ?? DEFAULT_FALLBACK_COLOR;
  const palette = { ...DEFAULT_COLORS, ...(opts.colorByKind ?? {}) };

  // Track the last-rendered marker layout so click handling can hit-test.
  let markerLayout: Array<{
    cx: number;
    cy: number;
    r: number;
    annotations: Array<{ wallTs: number; kind: string; taskId?: string; payload?: unknown }>;
  }> = [];

  return {
    name: 'HistoryStripPlugin',

    install(pluginHost: PluginHost): void {
      host = pluginHost;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gantt = (pluginHost as any).__gantt ?? null;
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      _layouts: TaskLayout[],
    ): void {
      if (!host || !gantt?.history) return;
      const annotations = gantt.history.annotations() as ReadonlyArray<{
        wallTs: number;
        kind: string;
        taskId?: string;
        payload?: unknown;
      }>;
      if (annotations.length === 0) {
        markerLayout = [];
        return;
      }

      const { config, scrollX } = state;
      const headerHeight = config.headerHeight;
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const canvasWidthCss = ctx.canvas.width / dpr;

      let timeScale: { dateToX: (date: Date) => number };
      try {
        timeScale = host.getTimeScale();
      } catch {
        return;
      }

      // Strip Y position
      const stripY =
        position === 'above-body'
          ? headerHeight - height
          : headerHeight + 2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, stripY, canvasWidthCss, height);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      // Project every annotation onto the strip then cluster co-located ones.
      const projected: Array<{ x: number; ann: typeof annotations[number] }> = [];
      for (const ann of annotations) {
        const x = timeScale.dateToX(new Date(ann.wallTs));
        projected.push({ x, ann });
      }
      projected.sort((a, b) => a.x - b.x);

      const clusters: Array<{ x: number; entries: typeof projected }> = [];
      for (const p of projected) {
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(p.x - last.x) <= clusterDist) {
          last.entries.push(p);
          // Recompute cluster center as mean
          last.x = last.entries.reduce((s, e) => s + e.x, 0) / last.entries.length;
        } else {
          clusters.push({ x: p.x, entries: [p] });
        }
      }

      // Render each cluster + capture hit-test layout (in body-space coords,
      // pre-scroll-translation for click handlers to compare against).
      const layout: typeof markerLayout = [];
      for (const c of clusters) {
        const cy = stripY + height / 2;
        const isCluster = c.entries.length > 1;
        const dominantKind = c.entries[0].ann.kind;
        const color = palette[dominantKind] ?? fallback;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(c.x, cy, isCluster ? radius + 1 : radius, 0, Math.PI * 2);
        ctx.fill();

        if (isCluster) {
          // Tiny count badge
          ctx.fillStyle = '#ffffff';
          ctx.font = `600 9px sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';
          ctx.fillText(String(c.entries.length), c.x, cy + 0.5);
        }

        layout.push({
          cx: c.x,
          cy,
          r: isCluster ? radius + 1 : radius,
          annotations: c.entries.map((e) => e.ann),
        });
      }
      markerLayout = layout;
      ctx.restore();
    },

    destroy(): void {
      host = null;
      gantt = null;
      markerLayout = [];
    },
  };
}
