/**
 * renderers/pacing.ts — Pacing / Forecast view (0.195.0).
 *
 * The in-gantt "budget" subtab. Renders a per-period hours/$ forecast aligned
 * to the same task data the Gantt draws, so editing the board updates it.
 * Interactive: range/bucket/measure/mode cuts, series toggles, and click-a-bar
 * to decompose a period into its constituent work items (rich breakout).
 *
 * ── Layering (decided 2026-06-05 across NG/DH/MF) ───────────────────────────
 * DH is the forecast BRAIN; NG is the forecast SCREEN. The accurate engine —
 * dated actuals, $ at rate, client scoping, approval-governance, grading —
 * lives in DH. DH computes and passes NG a render-ready `PacingData`; NG draws
 * it. Standalone (no pacingData), NG derives a FORECAST-ONLY preview by
 * spreading each task's REMAINING hours (estimate − logged) across its span —
 * demoable + instant drag-feedback, not the authoritative engine.
 *
 * Interaction contract for hosts (DH wires these): every work item row and bar
 * fires `onOpenItem` (navigate) and `onItemHover` (tooltip/mouseover); bucket
 * "Open report" fires `onOpenReport`. NG never navigates itself — host owns it.
 *
 * Styling: uses the cloudnimbus template's Tailwind vocabulary + shared pill
 * classes so the controls match the rest of the chrome.
 */

import type { NormalizedTask } from '../types';
import {
  CLS_PILL_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_BLUE, CLS_PILL_BTN_IDLE_BLUE,
  CLS_PILL_BTN_ACTIVE_SLATE, CLS_PILL_BTN_IDLE_SLATE,
} from '../templates/cloudnimbus/components/shared/classes';

// ─── DH → NG contract ───────────────────────────────────────────────────────

/** One work item's contribution to a single bucket, plus item-level metrics
 *  for the breakout columns + host tooltips. NG's fallback fills what it can;
 *  DH enriches (dated actuals, $, scope) when it owns the data. */
export interface PacingBucketItem {
  id: string;
  name: string;
  hours: number;             // hours landing in THIS bucket
  pctOfItem?: number;        // this bucket's hours ÷ the item's spread total (0–100)
  estimatedHours?: number;
  loggedHours?: number;
  remainingHours?: number;
  budgetUsedPct?: number;    // loggedHours ÷ estimatedHours (0–100+)
  startDate?: string;
  endDate?: string;
  assignee?: string;
  status?: string;
  group?: string;
}

export interface PacingBucket {
  key: string;            // '2026-06' | '2026-Q2' | 'W2026-06-01'
  label: string;          // 'Jun 26'
  startMs?: number;       // bucket start (NG sets it; host may omit → parsed from key)
  actual: number;         // logged hours in this period (DH-only: dated WorkLogs)
  forecast: number;       // projected remaining hours landing here
  target: number;         // planned/estimate hours for this period
  isPast: boolean;
  isCurrent: boolean;
  items: PacingBucketItem[];
}

export interface PacingSummary {
  estimatedHours: number;
  loggedHours: number;
  remainingHours: number;
  projectedFinalHours: number;
  pacingPct: number;
  activeItems: number;
  unscheduledHours: number;
}

export type PacingBucketSize = 'week' | 'month' | 'quarter';

export interface PacingData {
  buckets: PacingBucket[];
  bucket: PacingBucketSize;
  summary: PacingSummary;
  rate?: number;
  currency?: string;
  scopeLabel?: string;
  authoritative?: boolean;
}

export interface PacingViewOptions {
  pacingData?: PacingData;
  /** $/hr used when no pacingData.rate — lets a host turn on $ without the full engine. */
  rate?: number;
  onBucketChange?: (bucket: PacingBucketSize) => void;
  /** Navigate to a work item (drill-down row or — future — its Gantt bar). Host owns nav. */
  onOpenItem?: (taskId: string) => void;
  /** Hover a work item row — host can show a tooltip/mouseover. */
  onItemHover?: (taskId: string | null, pos: { x: number; y: number }) => void;
  /** Bucket "Open report" — host owns nav (no URLs in NG). */
  onOpenReport?: (ctx: { bucketKey: string; taskIds: string[] }) => void;
  defaultBucket?: PacingBucketSize;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function el(tag: string, style?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (style) e.setAttribute('style', style);
  if (text != null) e.textContent = text;
  return e;
}
function elc(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
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
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseISO(d?: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d.length <= 10 ? d + 'T00:00:00Z' : d);
  return Number.isNaN(t) ? null : t;
}
const round = (n: number) => Math.round(n);
function fmtH(n: number): string { return round(n) + 'h'; }
function fmtMoney(n: number): string { return '$' + round(n).toLocaleString('en-US'); }

// ─── Bucketing ───────────────────────────────────────────────────────────────

function bucketKey(ms: number, size: PacingBucketSize): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (size === 'month') return y + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  if (size === 'quarter') return y + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
  const dow = (d.getUTCDay() + 6) % 7;
  return 'W' + new Date(ms - dow * DAY_MS).toISOString().slice(0, 10);
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
/** Recover a bucket's start ms from its key when the host omitted startMs. */
function keyToMs(key: string): number {
  if (key[0] === 'W') return parseISO(key.slice(1)) ?? 0;
  if (key.indexOf('Q') >= 0) { const [y, q] = key.split('-Q'); return Date.UTC(+y, (+q - 1) * 3, 1); }
  const [y, m] = key.split('-'); return Date.UTC(+y, +m - 1, 1);
}

/** NG fallback: forecast-only buckets from task spans (remaining-spread). */
function computeFromTasks(tasks: NormalizedTask[], size: PacingBucketSize): PacingData {
  const now = Date.now();
  const buckets = new Map<string, PacingBucket>();
  let estTotal = 0, loggedTotal = 0, unscheduled = 0, active = 0;

  function ensure(ms: number): PacingBucket {
    const start = bucketStartMs(ms, size);
    const k = bucketKey(ms, size);
    let b = buckets.get(k);
    if (!b) {
      b = {
        key: k, label: bucketLabel(start, size), startMs: start,
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
    estTotal += est; loggedTotal += logged;
    const remaining = Math.max(0, est - logged);
    const s = parseISO(t.startDate);
    const e = parseISO(t.endDate);
    if (remaining <= 0) continue;
    if (s == null || e == null || e < s) { unscheduled += remaining; continue; }
    const spanStart = Math.max(s, bucketStartMs(now, size));
    const spanEnd = Math.max(spanStart + DAY_MS, e);
    const spanDays = (spanEnd - spanStart) / DAY_MS;
    if (spanDays <= 0) { unscheduled += remaining; continue; }
    const perDay = remaining / spanDays;
    const str = (v: unknown): string | undefined => (v == null || v === '') ? undefined : String(v);
    const meta = {
      estimatedHours: round(est), loggedHours: round(logged), remainingHours: round(remaining),
      budgetUsedPct: est > 0 ? round(logged / est * 100) : 0,
      startDate: str(t.startDate), endDate: str(t.endDate),
      assignee: str(t.assignee), status: str(t.status), group: str(t.groupName) || str(t.groupId),
    };
    let cur = bucketStartMs(spanStart, size), guard = 0;
    while (cur < spanEnd && guard++ < 600) {
      const next = nextBucketMs(cur, size);
      const oS = Math.max(cur, spanStart), oE = Math.min(next, spanEnd);
      if (oE > oS) {
        const hrs = perDay * (oE - oS) / DAY_MS;
        if (hrs > 0.01) {
          const b = ensure(cur);
          b.forecast += hrs;
          b.items.push({
            id: t.id, name: t.title || t.name || t.id, hours: hrs,
            pctOfItem: remaining > 0 ? round(hrs / remaining * 100) : 0, ...meta,
          });
        }
      }
      cur = next;
    }
  }

  const ordered = Array.from(buckets.values()).sort((a, b) => a.key < b.key ? -1 : 1);
  for (const b of ordered) {
    b.forecast = round(b.forecast);
    b.items.sort((x, y) => y.hours - x.hours).forEach(i => { i.hours = round(i.hours); });
  }
  const remainingTotal = Math.max(0, estTotal - loggedTotal);
  return {
    buckets: ordered, bucket: size,
    summary: {
      estimatedHours: round(estTotal), loggedHours: round(loggedTotal),
      remainingHours: round(remainingTotal), projectedFinalHours: round(loggedTotal + remainingTotal),
      pacingPct: estTotal > 0 ? round(loggedTotal / estTotal * 100) : 0,
      activeItems: active, unscheduledHours: round(unscheduled),
    },
    authoritative: false,
  };
}

// ─── Ranges ──────────────────────────────────────────────────────────────────

type RangePreset = 'all' | 'ytd' | 'thisQtr' | 'next3' | 'next6' | 'rest' | 'custom';
const RANGE_LABELS: Record<RangePreset, string> = {
  all: 'All', ytd: 'YTD', thisQtr: 'This Qtr', next3: 'Next 3', next6: 'Next 6', rest: 'Rest of yr', custom: 'Custom',
};

function rangeWindow(preset: RangePreset, size: PacingBucketSize, customS: string, customE: string): { from: number | null; to: number | null } {
  const now = Date.now();
  const d = new Date(now);
  const y = d.getUTCFullYear();
  if (preset === 'all') return { from: null, to: null };
  if (preset === 'ytd') return { from: Date.UTC(y, 0, 1), to: now };
  if (preset === 'rest') return { from: bucketStartMs(now, size), to: Date.UTC(y, 11, 31) };
  if (preset === 'thisQtr') { const q = Math.floor(d.getUTCMonth() / 3); return { from: Date.UTC(y, q * 3, 1), to: Date.UTC(y, q * 3 + 3, 0) }; }
  if (preset === 'custom') return { from: parseISO(customS), to: parseISO(customE) };
  const n = preset === 'next3' ? 3 : 6;
  let cur = bucketStartMs(now, size);
  for (let i = 0; i < n; i++) cur = nextBucketMs(cur, size);
  return { from: bucketStartMs(now, size), to: cur };
}

// ─── Render ──────────────────────────────────────────────────────────────────

const COL = {
  actual: '#10b981', actualOver: '#ef4444', forecast: '#93c5fd',
  target: '#64748b', grid: '#e2e8f0', text: '#1f2937', muted: '#64748b',
};

export function renderPacingView(
  host: HTMLElement,
  tasks: NormalizedTask[],
  options: PacingViewOptions = {},
): () => void {
  let bucket: PacingBucketSize = options.pacingData?.bucket || options.defaultBucket || 'month';
  let range: RangePreset = 'next6';
  let customS = '', customE = '';
  let measure: 'hours' | 'dollars' = 'hours';
  let mode: 'period' | 'cumulative' = 'period';
  let expandedKey: string | null = null;
  const show = { actual: true, forecast: true, target: false };

  function data(): PacingData {
    if (options.pacingData && options.pacingData.bucket === bucket) return options.pacingData;
    return computeFromTasks(tasks, bucket);
  }
  function rate(d: PacingData): number | undefined { return d.rate ?? options.rate; }
  function canDollars(d: PacingData): boolean { return !!rate(d); }

  function pill(label: string, on: boolean, onClick: () => void, blue = true): HTMLElement {
    const cls = CLS_PILL_BTN_BASE + ' ' + (on
      ? (blue ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_ACTIVE_SLATE)
      : (blue ? CLS_PILL_BTN_IDLE_BLUE : CLS_PILL_BTN_IDLE_SLATE));
    const b = elc('button', cls, label);
    b.addEventListener('click', onClick);
    return b;
  }
  function group(label: string, ...pills: HTMLElement[]): HTMLElement {
    const g = elc('div', 'flex items-center gap-1');
    g.appendChild(elc('span', 'text-[10px] font-bold text-slate-500 uppercase tracking-wide mr-0.5', label));
    pills.forEach(p => g.appendChild(p));
    return g;
  }

  function render(): void {
    const d = data();
    const r = rate(d);
    const useDollars = measure === 'dollars' && !!r;
    const cum = mode === 'cumulative';
    host.innerHTML = '';
    const rootCls = 'nga-pacing flex flex-col h-full w-full bg-slate-50 overflow-auto';
    const root = elc('div', rootCls);

    // ── Control bar (template-aligned) ────────────────────────────────────
    const bar = elc('div', 'nga-pacing-controls bg-white border-b border-slate-200 px-3 py-2 flex flex-col gap-1.5');
    const row1 = elc('div', 'flex items-center gap-3 flex-wrap');
    row1.appendChild(group('Range',
      ...(['next3', 'next6', 'rest', 'thisQtr', 'ytd', 'all', 'custom'] as RangePreset[]).map(p =>
        pill(RANGE_LABELS[p], range === p, () => { range = p; expandedKey = null; render(); }))));
    if (range === 'custom') {
      const inp = (val: string, set: (v: string) => void) => {
        const i = document.createElement('input');
        i.type = 'date'; i.value = val;
        i.className = 'text-[10px] px-2 py-1 rounded-full border border-slate-200 text-slate-700 focus:border-blue-400 focus:outline-none';
        i.addEventListener('change', () => { set(i.value); render(); });
        return i;
      };
      const cwrap = elc('div', 'flex items-center gap-1');
      cwrap.appendChild(inp(customS, v => customS = v));
      cwrap.appendChild(elc('span', 'text-[10px] text-slate-400', '→'));
      cwrap.appendChild(inp(customE, v => customE = v));
      row1.appendChild(cwrap);
    }
    row1.appendChild(group('Bucket',
      ...(['week', 'month', 'quarter'] as PacingBucketSize[]).map(b =>
        pill(b[0].toUpperCase() + b.slice(1), bucket === b, () => {
          bucket = b; expandedKey = null;
          if (options.onBucketChange) options.onBucketChange(b);
          render();
        }, false))));
    bar.appendChild(row1);

    const row2 = elc('div', 'flex items-center gap-3 flex-wrap');
    const measures: HTMLElement[] = [pill('Hours', measure === 'hours', () => { measure = 'hours'; render(); })];
    if (canDollars(d)) measures.push(pill('$', measure === 'dollars', () => { measure = 'dollars'; render(); }));
    row2.appendChild(group('Measure', ...measures));
    row2.appendChild(group('Mode',
      pill('Per period', mode === 'period', () => { mode = 'period'; render(); }, false),
      pill('Cumulative', mode === 'cumulative', () => { mode = 'cumulative'; render(); }, false)));
    row2.appendChild(group('Series',
      pill('Actual', show.actual, () => { show.actual = !show.actual; render(); }),
      pill('Forecast', show.forecast, () => { show.forecast = !show.forecast; render(); }),
      pill('Target', show.target, () => { show.target = !show.target; render(); })));
    bar.appendChild(row2);
    root.appendChild(bar);

    // ── Body ───────────────────────────────────────────────────────────────
    const body = elc('div', 'flex-1 p-4');

    // header line
    const sub = d.authoritative
      ? 'Actuals · forecast · target' + (d.scopeLabel ? ' — ' + d.scopeLabel : '')
      : 'Forecast preview — remaining hours spread across scheduled dates (live from the board)';
    const hd = elc('div', 'mb-3');
    hd.appendChild(elc('div', 'text-lg font-extrabold tracking-tight text-slate-900', 'Pacing & Forecast'));
    hd.appendChild(elc('div', 'text-xs text-slate-500 mt-0.5', sub + (useDollars ? ' · $ at ' + fmtMoney(r!) + '/hr' : '') + (cum ? ' · cumulative' : '')));
    body.appendChild(hd);

    // stat cards
    const s = d.summary;
    const cards = elc('div', 'grid gap-2.5 mb-4');
    cards.setAttribute('style', 'grid-template-columns:repeat(auto-fit,minmax(120px,1fr))');
    const val = (h: number) => useDollars ? fmtMoney(h * r!) : fmtH(h);
    const stat = (label: string, value: string, tone?: string) => {
      const c = elc('div', 'bg-white border border-slate-200 rounded-xl px-3 py-2.5');
      c.appendChild(el('div', 'font-size:20px;font-weight:800;line-height:1.1' + (tone ? ';color:' + tone : ''), value));
      c.appendChild(elc('div', 'text-[10px] uppercase tracking-wide text-slate-500 mt-0.5', label));
      return c;
    };
    cards.appendChild(stat('Logged', val(s.loggedHours)));
    cards.appendChild(stat('Estimated', val(s.estimatedHours)));
    cards.appendChild(stat('Remaining', val(s.remainingHours), '#2563eb'));
    cards.appendChild(stat('Projected final', val(s.projectedFinalHours)));
    cards.appendChild(stat('Pacing', s.pacingPct + '%', s.pacingPct > 100 ? COL.actualOver : '#10b981'));
    cards.appendChild(stat('Active items', String(s.activeItems)));
    if (s.unscheduledHours > 0) cards.appendChild(stat('Unscheduled', val(s.unscheduledHours), '#d97706'));
    body.appendChild(cards);

    if (s.unscheduledHours > 0) {
      const warn = elc('div', 'bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs text-amber-800');
      warn.textContent = '⚠ ' + fmtH(s.unscheduledHours) + ' of work has an estimate but no scheduled dates — the forecast can\'t place it. Size + schedule those items to complete the picture.';
      body.appendChild(warn);
    }

    // chart (range-filtered)
    const win = rangeWindow(range, bucket, customS, customE);
    const visible = d.buckets.filter(b => {
      const ms = b.startMs ?? keyToMs(b.key);
      if (win.from != null && ms < win.from) return false;
      if (win.to != null && ms > win.to) return false;
      return true;
    });
    body.appendChild(buildChart(visible, { show, useDollars, rate: r || 0, cum, expandedKey }, (key) => {
      expandedKey = expandedKey === key ? null : key; render();
    }));

    // drill-down
    if (expandedKey) {
      const b = visible.find(x => x.key === expandedKey) || d.buckets.find(x => x.key === expandedKey);
      if (b) body.appendChild(buildDrilldown(b, { useDollars, rate: r || 0 }, options));
    } else {
      body.appendChild(elc('div', 'text-[11px] text-slate-400 mt-2.5 text-center',
        'Click a bar to break the period down into its work items.'));
    }

    root.appendChild(body);
    host.appendChild(root);
  }

  render();
  return () => {
    try { options.onItemHover?.(null, { x: 0, y: 0 }); } catch { /* ignore */ }
    host.innerHTML = '';
  };
}

// ─── Chart ───────────────────────────────────────────────────────────────────

interface ChartOpts { show: { actual: boolean; forecast: boolean; target: boolean }; useDollars: boolean; rate: number; cum: boolean; expandedKey: string | null; }

function buildChart(buckets: PacingBucket[], o: ChartOpts, onBucketClick: (key: string) => void): HTMLElement {
  const wrap = elc('div', 'bg-white border border-slate-200 rounded-xl p-3');
  if (buckets.length === 0) {
    wrap.appendChild(elc('div', 'text-xs text-slate-400 text-center py-10', 'No periods in this range.'));
    return wrap;
  }
  const mul = o.useDollars ? (o.rate || 1) : 1;
  // cumulative running sums
  let cumA = 0, cumF = 0, cumT = 0;
  const rows = buckets.map((b) => {
    cumA += b.actual; cumF += b.forecast; cumT += b.target;
    return {
      b,
      actual: (o.cum ? cumA : b.actual) * mul,
      forecast: (o.cum ? cumF : b.forecast) * mul,
      target: (o.cum ? cumT : b.target) * mul,
    };
  });

  const W = 920, H = 300, padL = 52, padB = 34, padT = 10, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = rows.length, slot = plotW / n, barW = Math.min(46, slot * 0.62);
  let maxV = 1;
  for (const r of rows) {
    maxV = Math.max(maxV, (o.show.actual ? r.actual : 0) + (o.show.forecast ? r.forecast : 0), o.show.target ? r.target : 0);
  }
  const niceMax = niceCeil(maxV);
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;
  const fmtAxis = (v: number) => o.useDollars ? '$' + (v >= 1000 ? round(v / 1000) + 'k' : round(v)) : round(v) + '';

  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: 'auto', style: 'display:block' });
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = niceMax * i / ticks, yy = y(v);
    svg.appendChild(svgEl('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, stroke: COL.grid, 'stroke-width': 1 }));
    const lbl = svgEl('text', { x: padL - 6, y: yy + 3, 'text-anchor': 'end', 'font-size': 9, fill: COL.muted, 'font-family': FONT });
    lbl.textContent = fmtAxis(v); svg.appendChild(lbl);
  }

  rows.forEach((r, i) => {
    const cx = padL + slot * i + slot / 2, x = cx - barW / 2;
    if (r.b.isCurrent) svg.appendChild(svgEl('rect', { x: padL + slot * i, y: padT, width: slot, height: plotH, fill: '#6366f1', opacity: 0.06 }));
    let top = padT + plotH;
    if (o.show.actual && r.actual > 0) {
      const h = (r.actual / niceMax) * plotH; top -= h;
      svg.appendChild(svgEl('rect', { x, y: top, width: barW, height: h, rx: 2, fill: r.actual > r.target && r.target > 0 ? COL.actualOver : COL.actual }));
    }
    if (o.show.forecast && r.forecast > 0) {
      const h = (r.forecast / niceMax) * plotH; top -= h;
      const rc = svgEl('rect', { x, y: top, width: barW, height: h, rx: 2, fill: COL.forecast });
      if (!r.b.isPast) rc.setAttribute('opacity', '0.92');
      svg.appendChild(rc);
    }
    if (o.show.target && r.target > 0) {
      const ty = y(r.target);
      svg.appendChild(svgEl('line', { x1: x - 3, y1: ty, x2: x + barW + 3, y2: ty, stroke: COL.target, 'stroke-width': 2, 'stroke-dasharray': '4 2' }));
    }
    const hit = svgEl('rect', { x: padL + slot * i, y: padT, width: slot, height: plotH, fill: 'transparent', cursor: 'pointer' });
    const tip = (o.useDollars ? '$' + round((r.actual + r.forecast)) : round(r.actual + r.forecast) + 'h');
    hit.appendChild(svgEl('title', {})).textContent = r.b.label + ' — ' + tip + (o.cum ? ' (cumulative)' : '');
    hit.addEventListener('click', () => onBucketClick(r.b.key));
    svg.appendChild(hit);
    if (r.b.key === o.expandedKey) svg.appendChild(svgEl('rect', { x: padL + slot * i + 1, y: padT, width: slot - 2, height: plotH, fill: 'none', stroke: '#6366f1', 'stroke-width': 1.5, rx: 4 }));
    if (n <= 16 || i % Math.ceil(n / 16) === 0) {
      const lbl = svgEl('text', { x: cx, y: H - padB + 14, 'text-anchor': 'middle', 'font-size': 9, fill: r.b.isCurrent ? '#4f46e5' : COL.muted, 'font-family': FONT, 'font-weight': r.b.isCurrent ? 700 : 400 });
      lbl.textContent = r.b.label; svg.appendChild(lbl);
    }
  });
  wrap.appendChild(svg);
  return wrap;
}

// ─── Drill-down (rich breakout) ──────────────────────────────────────────────

function buildDrilldown(b: PacingBucket, o: { useDollars: boolean; rate: number }, options: PacingViewOptions): HTMLElement {
  const panel = elc('div', 'bg-white border border-slate-200 rounded-xl mt-3 overflow-hidden');
  const total = b.actual + b.forecast;
  const head = elc('div', 'flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-100 border-b border-slate-200');
  const tv = o.useDollars ? fmtMoney(total * o.rate) : fmtH(total);
  head.appendChild(elc('div', 'font-bold text-sm text-slate-800', b.label + ' — ' + tv + ' · ' + b.items.length + ' item' + (b.items.length === 1 ? '' : 's')));
  if (options.onOpenReport) {
    const rpt = elc('button', CLS_PILL_BTN_BASE + ' ' + CLS_PILL_BTN_IDLE_SLATE, 'Open report ↗');
    rpt.addEventListener('click', () => options.onOpenReport!({ bucketKey: b.key, taskIds: b.items.map(i => i.id) }));
    head.appendChild(rpt);
  }
  panel.appendChild(head);

  if (b.items.length === 0) {
    panel.appendChild(elc('div', 'p-4 text-xs text-slate-500', 'No itemized work in this period.'));
    return panel;
  }

  // column header
  const fmtv = (h?: number) => h == null ? '—' : (o.useDollars ? fmtMoney(h * o.rate) : fmtH(h));
  const hrow = elc('div', 'grid items-center gap-2 px-4 py-1.5 border-b border-slate-100 text-[9px] font-bold uppercase tracking-wide text-slate-400');
  const cols = 'grid-template-columns:minmax(0,2.4fr) 64px 54px 60px 60px 70px 64px';
  hrow.setAttribute('style', cols);
  ['Work item', 'This period', '% of item', 'Est', 'Logged', 'Remaining', '% used'].forEach((c, i) =>
    hrow.appendChild(elc('div', i === 0 ? '' : 'text-right', c)));
  panel.appendChild(hrow);

  const maxH = Math.max(...b.items.map(i => i.hours), 1);
  for (const it of b.items) {
    const row = elc('div', 'grid items-center gap-2 px-4 py-2 border-b border-slate-50 ' + (options.onOpenItem ? 'cursor-pointer hover:bg-slate-50' : ''));
    row.setAttribute('style', cols);

    // name cell (name + bar + secondary meta line)
    const nameCell = elc('div', 'min-w-0');
    const nameLine = elc('div', 'flex items-center gap-2 min-w-0');
    nameLine.appendChild(elc('div', 'text-xs text-slate-800 truncate flex-1 min-w-0', it.name));
    const track = elc('div', 'w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden flex-shrink-0');
    track.appendChild(el('div', 'height:100%;background:#93c5fd;width:' + round(it.hours / maxH * 100) + '%'));
    nameLine.appendChild(track);
    nameCell.appendChild(nameLine);
    const meta = [it.group, it.assignee, it.status,
      (it.startDate && it.endDate) ? (it.startDate + ' → ' + it.endDate) : null].filter(Boolean).join(' · ');
    if (meta) nameCell.appendChild(elc('div', 'text-[10px] text-slate-400 truncate mt-0.5', meta));
    row.appendChild(nameCell);

    const cell = (txt: string, tone?: string) => {
      const c = elc('div', 'text-right text-xs ' + (tone || 'text-slate-700'));
      c.textContent = txt; return c;
    };
    row.appendChild(cell(o.useDollars ? fmtMoney(it.hours * o.rate) : fmtH(it.hours), 'text-right text-xs font-semibold text-slate-900'));
    row.appendChild(cell(it.pctOfItem != null ? it.pctOfItem + '%' : '—', 'text-right text-xs text-slate-500'));
    row.appendChild(cell(fmtv(it.estimatedHours)));
    row.appendChild(cell(fmtv(it.loggedHours)));
    row.appendChild(cell(fmtv(it.remainingHours)));
    row.appendChild(cell(it.budgetUsedPct != null ? it.budgetUsedPct + '%' : '—',
      it.budgetUsedPct != null && it.budgetUsedPct > 100 ? 'text-right text-xs font-semibold text-red-600' : 'text-right text-xs text-slate-500'));

    // interactions — host owns navigation + tooltips
    if (options.onOpenItem) row.addEventListener('click', () => options.onOpenItem!(it.id));
    if (options.onItemHover) {
      row.addEventListener('mousemove', (e) => options.onItemHover!(it.id, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));
      row.addEventListener('mouseleave', () => options.onItemHover!(null, { x: 0, y: 0 }));
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
