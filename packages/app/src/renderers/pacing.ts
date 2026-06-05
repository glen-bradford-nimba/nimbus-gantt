/**
 * renderers/pacing.ts — Pacing / Forecast view (0.195.0).
 *
 * The in-gantt "budget" subtab. Renders a per-period hours forecast aligned
 * to the same task data the Gantt draws, so editing the board updates this
 * view. Interactive: bucket selector, series toggles, click-a-bucket to
 * decompose it into the constituent work items, click an item to drill out.
 *
 * ── Layering (decided 2026-06-05 across NG/DH/MF) ───────────────────────────
 * DH is the forecast BRAIN; NG is the forecast SCREEN. The accurate engine —
 * dated actuals, $ at rate, client scoping, approval-governance, estimate-vs-
 * actual grading — lives in DH (Salesforce has the data). DH computes and
 * passes NG a render-ready `PacingData`; NG just draws it.
 *
 * Fallback: when no `pacingData` is supplied (standalone demo, or for instant
 * drag-preview before DH recomputes on save), NG derives a FORECAST-ONLY view
 * client-side by spreading each task's REMAINING hours (estimate − logged)
 * across its scheduled span. This is preview math, not the authoritative
 * engine — actuals/$/grading require DH. The view labels itself accordingly.
 */

import type { NormalizedTask } from '../types';

// ─── DH → NG contract ───────────────────────────────────────────────────────

/** One work item's hours contribution to a single bucket (for drill-down). */
export interface PacingBucketItem {
  id: string;
  name: string;
  hours: number;
}

export interface PacingBucket {
  key: string;            // stable period key, e.g. '2026-06' / '2026-Q2' / '2026-W23'
  label: string;          // display, e.g. 'Jun 26'
  actual: number;         // logged hours landing in this period (DH-only; past)
  forecast: number;       // projected remaining hours landing in this period
  target: number;         // planned/estimate hours for this period (baseline)
  isPast: boolean;
  isCurrent: boolean;
  items: PacingBucketItem[]; // composition for the drill-down panel
}

export interface PacingSummary {
  estimatedHours: number;
  loggedHours: number;
  remainingHours: number;
  projectedFinalHours: number;   // logged + remaining
  pacingPct: number;             // loggedHours / estimatedHours (0–100+)
  activeItems: number;
  unscheduledHours: number;      // estimate present but no dates → can't place
}

export interface PacingData {
  buckets: PacingBucket[];
  bucket: PacingBucketSize;
  summary: PacingSummary;
  rate?: number;          // $/hr — when present, NG shows $ as a secondary unit
  currency?: string;      // e.g. 'USD'
  scopeLabel?: string;    // e.g. client name (DH client-scoping)
  authoritative?: boolean; // true when this came from DH's engine (vs NG fallback)
}

export type PacingBucketSize = 'week' | 'month' | 'quarter';

export interface PacingViewOptions {
  /** DH-computed, render-ready data. When present NG renders it verbatim. */
  pacingData?: PacingData;
  /** Fired when the user switches bucket. When pacingData is host-owned, the
   *  host should recompute at the new granularity and re-pass pacingData. */
  onBucketChange?: (bucket: PacingBucketSize) => void;
  /** Fired when the user clicks a work item in the drill-down. Host owns nav. */
  onOpenItem?: (taskId: string) => void;
  /** Fired from a bucket's "Open report" action. Host owns nav (no URLs here). */
  onOpenReport?: (ctx: { bucketKey: string; taskIds: string[] }) => void;
  defaultBucket?: PacingBucketSize;
}

// ─── Small DOM helpers (dependency-free, match codebase style) ───────────────

function el(tag: string, style?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (style) e.setAttribute('style', style);
  if (text != null) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
const FONT = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif';
const DAY_MS = 86_400_000;

function parseISO(d?: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d.length <= 10 ? d + 'T00:00:00Z' : d);
  return Number.isNaN(t) ? null : t;
}
function round(n: number): number { return Math.round(n); }
function fmtH(n: number): string { return (Number.isInteger(n) ? n : Math.round(n)) + 'h'; }

// ─── Bucketing ───────────────────────────────────────────────────────────────

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function bucketKey(ms: number, size: PacingBucketSize): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (size === 'month') return y + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  if (size === 'quarter') return y + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
  // week: ISO-ish Monday anchor
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = ms - dow * DAY_MS;
  return 'W' + new Date(monday).toISOString().slice(0, 10);
}
function bucketLabel(ms: number, size: PacingBucketSize): string {
  const d = new Date(ms);
  if (size === 'month') return MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2);
  if (size === 'quarter') return 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) + ' ' + String(d.getUTCFullYear()).slice(2);
  return MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
function bucketStartMs(ms: number, size: PacingBucketSize): number {
  const d = new Date(ms);
  if (size === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (size === 'quarter') return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
  const dow = (d.getUTCDay() + 6) % 7;
  return ms - dow * DAY_MS;
}
function nextBucketMs(ms: number, size: PacingBucketSize): number {
  const d = new Date(bucketStartMs(ms, size));
  if (size === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (size === 'quarter') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
  return d.getTime() + 7 * DAY_MS;
}

/**
 * NG fallback: forecast-only buckets from task spans. Spreads each task's
 * REMAINING hours (estimate − logged) evenly across its scheduled span,
 * from max(today, start) to end. Past buckets get 0 forecast (remaining is
 * future work); actuals are left 0 because NG has no dated worklogs. Tracks
 * unscheduled hours (estimate but no dates) as a board-sizing signal.
 */
function computeFromTasks(tasks: NormalizedTask[], size: PacingBucketSize): PacingData {
  const now = Date.now();
  const buckets = new Map<string, PacingBucket>();
  let estTotal = 0, loggedTotal = 0, unscheduled = 0, active = 0;

  function ensure(ms: number): PacingBucket {
    const k = bucketKey(ms, size);
    let b = buckets.get(k);
    if (!b) {
      const start = bucketStartMs(ms, size);
      b = {
        key: k, label: bucketLabel(start, size),
        actual: 0, forecast: 0, target: 0,
        isPast: nextBucketMs(start, size) <= now,
        isCurrent: start <= now && now < nextBucketMs(start, size),
        items: [],
      };
      buckets.set(k, b);
    }
    return b;
  }

  for (const t of tasks) {
    if (t.isInactive) continue;
    const est = Number(t.estimatedHours) || 0;
    const logged = Number(t.loggedHours) || 0;
    if (est <= 0 && logged <= 0) continue;
    active++;
    estTotal += est;
    loggedTotal += logged;
    const remaining = Math.max(0, est - logged);
    const s = parseISO(t.startDate);
    const e = parseISO(t.endDate);
    if (remaining <= 0) continue;
    if (s == null || e == null || e < s) { unscheduled += remaining; continue; }
    const from = Math.max(s, bucketStartMs(now, size));
    const spanStart = Math.max(from, s);
    const spanEnd = Math.max(spanStart + DAY_MS, e);
    const spanDays = (spanEnd - spanStart) / DAY_MS;
    if (spanDays <= 0) { unscheduled += remaining; continue; }
    const perDay = remaining / spanDays;
    // Walk buckets across the span, allocating day-overlap × perDay.
    let cur = bucketStartMs(spanStart, size);
    let guard = 0;
    while (cur < spanEnd && guard++ < 600) {
      const next = nextBucketMs(cur, size);
      const oS = Math.max(cur, spanStart);
      const oE = Math.min(next, spanEnd);
      if (oE > oS) {
        const hrs = perDay * (oE - oS) / DAY_MS;
        if (hrs > 0.01) {
          const b = ensure(cur);
          b.forecast += hrs;
          b.items.push({ id: t.id, name: t.title || t.name || t.id, hours: hrs });
        }
      }
      cur = next;
    }
  }

  const ordered = Array.from(buckets.values()).sort((a, b) => a.key < b.key ? -1 : 1);
  for (const b of ordered) {
    b.forecast = round(b.forecast);
    b.items.sort((x, y) => y.hours - x.hours).forEach(i => i.hours = round(i.hours));
  }
  const remainingTotal = Math.max(0, estTotal - loggedTotal);
  return {
    buckets: ordered,
    bucket: size,
    summary: {
      estimatedHours: round(estTotal),
      loggedHours: round(loggedTotal),
      remainingHours: round(remainingTotal),
      projectedFinalHours: round(loggedTotal + remainingTotal),
      pacingPct: estTotal > 0 ? round(loggedTotal / estTotal * 100) : 0,
      activeItems: active,
      unscheduledHours: round(unscheduled),
    },
    authoritative: false,
  };
}

// ─── Render ──────────────────────────────────────────────────────────────────

const COL = {
  actual: '#10b981', actualOver: '#ef4444', forecast: '#93c5fd',
  target: '#64748b', grid: '#e2e8f0', text: '#1f2937', muted: '#64748b', bg: '#ffffff',
};

export function renderPacingView(
  host: HTMLElement,
  tasks: NormalizedTask[],
  options: PacingViewOptions = {},
): () => void {
  let bucket: PacingBucketSize = options.pacingData?.bucket || options.defaultBucket || 'month';
  let expandedKey: string | null = null;
  const show = { actual: true, forecast: true, target: false };

  function data(): PacingData {
    // Authoritative DH data wins; otherwise NG's forecast-only fallback.
    if (options.pacingData && options.pacingData.bucket === bucket) return options.pacingData;
    return computeFromTasks(tasks, bucket);
  }

  function render(): void {
    const d = data();
    host.innerHTML = '';
    const root = el('div', [
      'height:100%', 'width:100%', 'overflow:auto', 'background:#f8fafc',
      'font-family:' + FONT, 'color:' + COL.text, 'padding:16px', 'box-sizing:border-box',
    ].join(';'));

    // ── Header ───────────────────────────────────────────────────────────
    const head = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px');
    const titleWrap = el('div');
    titleWrap.appendChild(el('div', 'font-size:18px;font-weight:800;letter-spacing:-0.01em', 'Pacing & Forecast'));
    const sub = d.authoritative
      ? 'Actuals, forecast and target' + (d.scopeLabel ? ' · ' + d.scopeLabel : '')
      : 'Forecast preview — remaining hours spread across scheduled dates (live from the board)';
    titleWrap.appendChild(el('div', 'font-size:12px;color:' + COL.muted + ';margin-top:2px', sub));
    head.appendChild(titleWrap);

    // bucket selector
    const seg = el('div', 'display:flex;gap:0;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden');
    (['week', 'month', 'quarter'] as PacingBucketSize[]).forEach((b) => {
      const on = b === bucket;
      const btn = el('button', [
        'border:0', 'padding:6px 12px', 'font-size:12px', 'font-weight:600', 'cursor:pointer',
        'font-family:' + FONT,
        on ? 'background:#1e293b;color:#fff' : 'background:#fff;color:#475569',
      ].join(';'), b[0].toUpperCase() + b.slice(1));
      btn.addEventListener('click', () => {
        bucket = b; expandedKey = null;
        if (options.onBucketChange) options.onBucketChange(b);
        render();
      });
      seg.appendChild(btn);
    });
    head.appendChild(seg);
    root.appendChild(head);

    // ── Stat cards ───────────────────────────────────────────────────────
    const s = d.summary;
    const cards = el('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px');
    const stat = (label: string, value: string, tone?: string) => {
      const c = el('div', 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px');
      c.appendChild(el('div', 'font-size:20px;font-weight:800;' + (tone ? 'color:' + tone : ''), value));
      c.appendChild(el('div', 'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:' + COL.muted + ';margin-top:2px', label));
      return c;
    };
    const dollars = (h: number) => d.rate ? ' · $' + (h * d.rate).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
    cards.appendChild(stat('Logged', fmtH(s.loggedHours) + dollars(s.loggedHours)));
    cards.appendChild(stat('Estimated', fmtH(s.estimatedHours) + dollars(s.estimatedHours)));
    cards.appendChild(stat('Remaining', fmtH(s.remainingHours), '#2563eb'));
    cards.appendChild(stat('Projected final', fmtH(s.projectedFinalHours)));
    cards.appendChild(stat('Pacing', s.pacingPct + '%', s.pacingPct > 100 ? COL.actualOver : '#10b981'));
    cards.appendChild(stat('Active items', String(s.activeItems)));
    if (s.unscheduledHours > 0) {
      cards.appendChild(stat('Unscheduled', fmtH(s.unscheduledHours), '#d97706'));
    }
    root.appendChild(cards);

    // ── Unscheduled callout (board-sizing signal) ─────────────────────────
    if (s.unscheduledHours > 0) {
      const warn = el('div', 'background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;margin-bottom:14px;font-size:12px;color:#92400e');
      warn.textContent = '⚠ ' + fmtH(s.unscheduledHours) + ' of work has an estimate but no scheduled dates — the forecast can\'t place it. Size + schedule those items to make the forecast complete.';
      root.appendChild(warn);
    }

    // ── Legend / series toggles ───────────────────────────────────────────
    const legend = el('div', 'display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap');
    const toggle = (key: 'actual' | 'forecast' | 'target', label: string, color: string) => {
      const on = show[key];
      const item = el('button', [
        'display:flex', 'align-items:center', 'gap:6px', 'border:0', 'background:none',
        'cursor:pointer', 'font-family:' + FONT, 'font-size:12px', 'padding:2px 4px',
        'opacity:' + (on ? '1' : '0.4'), 'color:' + COL.text,
      ].join(';'));
      const sw = el('span', 'width:12px;height:12px;border-radius:3px;background:' + color + (on ? '' : ';filter:grayscale(1)'));
      item.appendChild(sw);
      item.appendChild(el('span', '', label));
      item.addEventListener('click', () => { show[key] = !show[key]; render(); });
      return item;
    };
    legend.appendChild(toggle('actual', 'Actual (logged)', COL.actual));
    legend.appendChild(toggle('forecast', 'Forecast', COL.forecast));
    legend.appendChild(toggle('target', 'Target (estimate)', COL.target));
    root.appendChild(legend);

    // ── Chart (SVG) ───────────────────────────────────────────────────────
    const chart = buildChart(d, show, expandedKey, (key) => {
      expandedKey = expandedKey === key ? null : key;
      render();
    });
    root.appendChild(chart);

    // ── Drill-down panel ──────────────────────────────────────────────────
    if (expandedKey) {
      const b = d.buckets.find(x => x.key === expandedKey);
      if (b) root.appendChild(buildDrilldown(b, d, options));
    } else {
      root.appendChild(el('div', 'font-size:11px;color:' + COL.muted + ';margin-top:10px;text-align:center',
        'Click a bar to see the work items that make up that period.'));
    }

    host.appendChild(root);
  }

  render();
  return () => { host.innerHTML = ''; };
}

// ─── Chart builder ───────────────────────────────────────────────────────────

function buildChart(
  d: PacingData,
  show: { actual: boolean; forecast: boolean; target: boolean },
  expandedKey: string | null,
  onBucketClick: (key: string) => void,
): HTMLElement {
  const wrap = el('div', 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px');
  const buckets = d.buckets;
  const W = 900, H = 280, padL = 44, padB = 34, padT = 10, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = Math.max(1, buckets.length);
  const slot = plotW / n;
  const barW = Math.min(46, slot * 0.62);

  let maxV = 1;
  for (const b of buckets) {
    const stacked = (show.actual ? b.actual : 0) + (show.forecast ? b.forecast : 0);
    maxV = Math.max(maxV, stacked, show.target ? b.target : 0);
  }
  const niceMax = niceCeil(maxV);
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;

  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: 'auto', style: 'display:block' });

  // gridlines + y labels
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const val = niceMax * i / ticks;
    const yy = y(val);
    svg.appendChild(svgEl('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, stroke: COL.grid, 'stroke-width': 1 }));
    const lbl = svgEl('text', { x: padL - 6, y: yy + 3, 'text-anchor': 'end', 'font-size': 9, fill: COL.muted, 'font-family': FONT });
    lbl.textContent = String(round(val));
    svg.appendChild(lbl);
  }

  buckets.forEach((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const x = cx - barW / 2;
    let top = padT + plotH;
    // actual (bottom)
    if (show.actual && b.actual > 0) {
      const h = (b.actual / niceMax) * plotH;
      top -= h;
      svg.appendChild(svgEl('rect', {
        x, y: top, width: barW, height: h, rx: 2,
        fill: b.actual > b.target && b.target > 0 ? COL.actualOver : COL.actual,
      }));
    }
    // forecast (stacked on top)
    if (show.forecast && b.forecast > 0) {
      const h = (b.forecast / niceMax) * plotH;
      top -= h;
      const r = svgEl('rect', { x, y: top, width: barW, height: h, rx: 2, fill: COL.forecast });
      if (!b.isPast) r.setAttribute('opacity', '0.92');
      svg.appendChild(r);
    }
    // target marker (line across the slot)
    if (show.target && b.target > 0) {
      const ty = y(b.target);
      svg.appendChild(svgEl('line', { x1: x - 3, y1: ty, x2: x + barW + 3, y2: ty, stroke: COL.target, 'stroke-width': 2, 'stroke-dasharray': '4 2' }));
    }
    // current-period marker
    if (b.isCurrent) {
      svg.appendChild(svgEl('rect', { x: padL + slot * i, y: padT, width: slot, height: plotH, fill: '#6366f1', opacity: 0.06 }));
    }
    // hit area + selection outline
    const hit = svgEl('rect', {
      x: padL + slot * i, y: padT, width: slot, height: plotH,
      fill: 'transparent', cursor: 'pointer',
    });
    hit.addEventListener('click', () => onBucketClick(b.key));
    svg.appendChild(hit);
    if (b.key === expandedKey) {
      svg.appendChild(svgEl('rect', { x: padL + slot * i + 1, y: padT, width: slot - 2, height: plotH, fill: 'none', stroke: '#6366f1', 'stroke-width': 1.5, rx: 4 }));
    }
    // x label (thin out if crowded)
    if (n <= 16 || i % Math.ceil(n / 16) === 0) {
      const lbl = svgEl('text', { x: cx, y: H - padB + 14, 'text-anchor': 'middle', 'font-size': 9, fill: b.isCurrent ? '#4f46e5' : COL.muted, 'font-family': FONT, 'font-weight': b.isCurrent ? 700 : 400 });
      lbl.textContent = b.label;
      svg.appendChild(lbl);
    }
  });

  wrap.appendChild(svg);
  return wrap;
}

function buildDrilldown(b: PacingBucket, d: PacingData, options: PacingViewOptions): HTMLElement {
  const panel = el('div', 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-top:12px;overflow:hidden');
  const head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;background:#f1f5f9;border-bottom:1px solid #e2e8f0');
  const total = b.actual + b.forecast;
  head.appendChild(el('div', 'font-weight:700;font-size:13px', b.label + ' — ' + fmtH(round(total)) + (d.rate ? ' · $' + round(total * d.rate).toLocaleString('en-US') : '')));
  if (options.onOpenReport) {
    const rpt = el('button', 'border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:' + FONT, 'Open report ↗');
    rpt.addEventListener('click', () => options.onOpenReport!({ bucketKey: b.key, taskIds: b.items.map(i => i.id) }));
    head.appendChild(rpt);
  }
  panel.appendChild(head);

  if (b.items.length === 0) {
    panel.appendChild(el('div', 'padding:14px;font-size:12px;color:' + COL.muted, 'No itemized work in this period.'));
    return panel;
  }
  const maxH = Math.max(...b.items.map(i => i.hours), 1);
  for (const it of b.items) {
    const row = el('div', 'display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid #f1f5f9;cursor:' + (options.onOpenItem ? 'pointer' : 'default'));
    const name = el('div', 'flex:1;font-size:12px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis', it.name);
    const track = el('div', 'width:120px;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;flex-shrink:0');
    track.appendChild(el('div', 'height:100%;background:#93c5fd;width:' + round(it.hours / maxH * 100) + '%'));
    const hrs = el('div', 'width:48px;text-align:right;font-size:12px;font-weight:600;flex-shrink:0', fmtH(it.hours));
    row.appendChild(name); row.appendChild(track); row.appendChild(hrs);
    if (options.onOpenItem) {
      row.addEventListener('mouseenter', () => row.style.background = '#f8fafc');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', () => options.onOpenItem!(it.id));
    }
    panel.appendChild(row);
  }
  return panel;
}

function niceCeil(v: number): number {
  if (v <= 10) return Math.ceil(v / 2) * 2;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / (mag / 2)) * (mag / 2);
}
