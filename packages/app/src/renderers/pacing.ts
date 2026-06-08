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
 * it. Standalone (no pacingData), NG derives a preview client-side: it spreads
 * each task's LOGGED hours across the elapsed part of its span (actual, past)
 * and its REMAINING hours across the rest (forecast, future) — so the chart
 * reads actual → today → forecast even without DH's dated worklogs.
 *
 * ── Styling parity (CN web == DH Salesforce == demo) ────────────────────────
 * This view INJECTS ITS OWN scoped stylesheet (the same pattern TooltipManager
 * and ContextMenuPlugin use). It does NOT depend on the host's pre-compiled
 * Tailwind `styles.css`, so it renders identically on every surface regardless
 * of which sheet the host loaded. All selectors are scoped under `.ngp-root`.
 *
 * Interaction contract for hosts (DH wires these): every work-item row fires
 * `onOpenItem` (navigate) and `onItemHover` (tooltip/mouseover); bucket
 * "Open report" fires `onOpenReport`. NG never navigates itself — host owns it.
 */

import type { NormalizedTask } from '../types';
import { DONE_STAGES } from '../pipeline';

// ─── DH → NG contract ───────────────────────────────────────────────────────

export interface PacingBucketItem {
  id: string;
  name: string;
  hours: number;             // hours landing in THIS bucket (actual + forecast)
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
  /** 0.200.0 — the commitment tier (PacingSegment.id) this item belongs to, so
   *  the drill-down can show "what's in each tier". NG fills it from priorityGroup
   *  in the preview; hosts may set it directly. */
  tier?: string;
}

export interface PacingBucket {
  key: string;
  label: string;
  startMs?: number;
  actual: number;            // logged hours landing in this period
  forecast: number;          // projected remaining hours landing here
  target: number;            // planned/estimate hours for this period
  isPast: boolean;
  isCurrent: boolean;
  items: PacingBucketItem[];
  /** 0.200.0 — stacked forecast breakdown: segmentId → hours landing in this
   *  period for that commitment tier. When present (+ PacingData.segments
   *  defines them), the chart stacks these instead of the flat `forecast` bar.
   *  The values should sum to `forecast` for a consistent bar height. Hosts
   *  (DH/CN) populate this to drive the "greenlit / predicted / ready-to-approve"
   *  hockey stick; NG fills a default split (from priorityGroup) when omitted. */
  segments?: Record<string, number>;
}

/** 0.200.0 — a stacked forecast tier ("segment") definition. NG owns this
 *  contract so DH and CN drive the layered forecast uniformly; NG renders it.
 *  A host declares its tiers (e.g. greenlit / predicted / ready-to-approve) and
 *  feeds per-bucket hours via PacingBucket.segments. Segments stack bottom→top
 *  by `order`; `style:'dotted'` draws a hatched/outlined cap (e.g. unapproved,
 *  ready-to-approve upside). Each segment gets its own legend toggle. */
export interface PacingSegment {
  id: string;
  label: string;
  color?: string;                 // fill; falls back to a blue ramp by order
  /** Fill treatment. 'solid' (default); 'dotted' → light fill + dashed outline
   *  (conditional/speculative tier); 'outline' → transparent fill + solid border;
   *  'hatched' → diagonal-line pattern. Host-overridable per series. */
  style?: 'solid' | 'dotted' | 'outline' | 'hatched';
  opacity?: number;               // 0–1 fill opacity override (default 1, .92 future)
  order?: number;                 // stack order, low = bottom
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

// 0.200.0 — NG's DEFAULT forecast tiers, used by the task-derived preview so the
// stacked hockey stick renders with zero host changes. Hosts (DH/CN) override by
// feeding PacingData.segments + per-bucket PacingBucket.segments. Bottom→top:
// committed work, then likely, then the dotted "ready to approve" upside cap.
// Colours align to the /glen/mf-forecast-stack-0607 prototype (the agreed
// direction): committed = green, predicted/maintenance = blue, ready = amber +
// dotted. All host-overridable via PacingData.segments.
export const PACING_SEGMENT_DEFAULTS: PacingSegment[] = [
  { id: 'greenlit',  label: 'Greenlit',         color: '#059669', style: 'solid',  order: 0 },
  { id: 'predicted', label: 'Predicted',        color: '#2563eb', style: 'solid',  order: 1 },
  { id: 'ready',     label: 'Ready to approve', color: '#d97706', style: 'dotted', order: 2 },
];
// Maps NG's priority lanes → default tiers. HOLD (deferred) is intentionally
// absent → its remaining is excluded from the forecast stack. Unknown lanes fall
// back to 'greenlit' (committed) so no work silently vanishes.
const PACING_LANE_TO_SEGMENT: Record<string, string> = {
  'top-priority': 'greenlit',
  'active': 'greenlit',
  'follow-on': 'predicted',
  'proposed': 'ready',
};
// Fallback fills for host segments that don't declare a `color`.
const PACING_SEG_RAMP = ['#2563eb', '#7dabf5', '#c3dafc', '#1e40af', '#93c5fd', '#1d4ed8'];
// Page-unique id seed for hatch <pattern> defs (multiple charts can coexist).
let pacingHatchSeq = 0;

export interface PacingData {
  buckets: PacingBucket[];
  bucket: PacingBucketSize;
  summary: PacingSummary;
  rate?: number;
  currency?: string;
  scopeLabel?: string;
  authoritative?: boolean;
  /** 0.200.0 — forecast tier definitions for the stacked hockey-stick view.
   *  When set, the chart stacks each bucket's `segments` by these (in `order`)
   *  with per-tier legend toggles. Host-fed (DH/CN) for authoritative tiers;
   *  NG supplies a default set (greenlit/predicted/ready) in the task-derived
   *  preview so it renders without host changes. */
  segments?: PacingSegment[];
}

/** 0.197.0 — DH's PortfolioPacingDTO shape
 *  (DeliveryHoursAnalyticsController.getPortfolioPacing). Mirrored here so NG
 *  can adapt it; DH owns the canonical Apex definition. */
export interface PortfolioPacingDTO {
  granularity?: string;
  rootCount?: number;
  totalEstimatedHours?: number;
  totalLoggedHours?: number;
  projectedFinalHours?: number;
  runRateHoursPerPeriod?: number;
  blendedRate?: number;
  hasEstimate?: boolean;
  isOverBudgetTrajectory?: boolean;
  earliestStart?: string;
  latestEnd?: string;
  periods?: Array<{
    label?: string; startDate?: string; endDate?: string;
    loggedHours?: number; targetHours?: number; forecastHours?: number;
    isForecast?: boolean; overTarget?: boolean;
  }>;
}

const _num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);

/** 0.197.0 — adapt DH's PortfolioPacingDTO → NG PacingData (one call for DH's
 *  LWC). Period totals map 1:1 (logged→actual, forecast, target); per-period
 *  items[] are left empty — NG's items-hybrid fills the drill-down from the
 *  task list, so no DH change is needed for drill-down to work. `todayMs` is
 *  injectable for testing; defaults to today. */
export function portfolioPacingToPacingData(dto: PortfolioPacingDTO, todayMs?: number): PacingData {
  const g = String(dto.granularity || 'month').toLowerCase();
  const bucket: PacingBucketSize = g.startsWith('week') ? 'week' : g.startsWith('quart') ? 'quarter' : 'month';
  const now = todayMs ?? Date.parse(new Date().toISOString().slice(0, 10));
  const est = _num(dto.totalEstimatedHours);
  const logged = _num(dto.totalLoggedHours);
  const buckets: PacingBucket[] = (dto.periods || []).map((p) => {
    const startMs = p.startDate ? Date.parse(p.startDate) : undefined;
    const endMs = p.endDate ? Date.parse(p.endDate) : undefined;
    const isCurrent = startMs != null && endMs != null && now >= startMs && now <= endMs;
    const isPast = !p.isForecast && (endMs != null ? endMs < now : false);
    return {
      key: p.startDate || p.label || '',
      label: p.label || p.startDate || '',
      startMs,
      actual: _num(p.loggedHours),
      forecast: _num(p.forecastHours),
      target: _num(p.targetHours),
      isPast,
      isCurrent,
      items: [],
    };
  });
  return {
    buckets,
    bucket,
    summary: {
      estimatedHours: est,
      loggedHours: logged,
      remainingHours: Math.max(0, est - logged),
      projectedFinalHours: _num(dto.projectedFinalHours) || est,
      pacingPct: est > 0 ? Math.round((logged / est) * 100) : 0,
      activeItems: _num(dto.rootCount),
      unscheduledHours: 0,
    },
    rate: dto.blendedRate != null ? _num(dto.blendedRate) : undefined,
    authoritative: true,
  };
}

/** Initial control state on page load — host (DH) seeds the view per client. */
export interface PacingDefaults {
  bucket?: PacingBucketSize;
  range?: RangePreset;
  customStart?: string;        // ISO, only used when range === 'custom'
  customEnd?: string;
  measure?: 'hours' | 'dollars';
  mode?: 'period' | 'cumulative';
  series?: { actual?: boolean; forecast?: boolean; target?: boolean };
}

/** Which controls are shown / allowed — host (DH) tailors the pill set per
 *  client. Omitted → sensible defaults (everything that has data shows). */
export interface PacingControls {
  /** Show the $ measure pill. Default: true when a rate is present. MF → false. */
  dollars?: boolean;
  /** Show the Measure group at all (Hours/$). Default: true. */
  measure?: boolean;
  /** Show the Mode group (Per-period / Cumulative). Default: true. */
  mode?: boolean;
  /** Show the Series toggles. Default: true. */
  series?: boolean;
  /** Restrict the Range presets shown (and order). Omit → all. `false` hides the group. */
  ranges?: RangePreset[] | false;
  /** Restrict the Bucket sizes shown. Omit → all three. `false` hides the group. */
  buckets?: PacingBucketSize[] | false;
}

/** 0.199.5 — payload for PacingViewOptions.onParamsChange. The full visible-window
 *  parameter set the host needs to recompute an authoritative PacingData. */
export interface PacingParamsChange {
  bucket: PacingBucketSize;
  range: RangePreset;
  /** ISO YYYY-MM-DD, present when range === 'custom' (or a stepper resolved it). */
  customStart?: string;
  customEnd?: string;
}

export interface PacingViewOptions {
  pacingData?: PacingData;
  rate?: number;
  /** Initial control state on load (DH seeds per client). */
  defaults?: PacingDefaults;
  /** Which controls/pills are shown (DH tailors per client; MF hides $). */
  controls?: PacingControls;
  onBucketChange?: (bucket: PacingBucketSize) => void;
  /** 0.199.5 — fired when the user changes ANY pacing parameter (bucket / range
   *  preset / custom window). An authoritative host (DH) recomputes PacingData
   *  for these params and pushes it back via setPacingData. Without this, a host
   *  that fed only one granularity (e.g. Week) silently falls back to the
   *  task-derived preview on Month/Quarter or a range change. Superset of
   *  onBucketChange (which is kept for back-compat). */
  onParamsChange?: (params: PacingParamsChange) => void;
  onOpenItem?: (taskId: string) => void;
  onItemHover?: (taskId: string | null, pos: { x: number; y: number }) => void;
  onOpenReport?: (ctx: { bucketKey: string; taskIds: string[] }) => void;
  /** @deprecated use defaults.bucket */
  defaultBucket?: PacingBucketSize;
}

// ─── Self-contained stylesheet (parity guarantee) ────────────────────────────

const STYLE_ID = 'nga-pacing-styles';
const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
const PACING_CSS = `
.ngp-root{height:100%;width:100%;overflow:auto;background:#f8fafc;color:#1f2937;font-family:${FONT};box-sizing:border-box}
.ngp-root *{box-sizing:border-box}
.ngp-bar{background:#fff;border-bottom:1px solid #e2e8f0;padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.ngp-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ngp-grp{display:flex;align-items:center;gap:4px}
.ngp-lbl{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-right:2px}
.ngp-pill{font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;color:#475569;cursor:pointer;transition:all .12s;font-family:${FONT}}
.ngp-pill:hover{border-color:#94a3b8}
.ngp-pill.on{background:#2563eb;color:#fff;border-color:#2563eb}
.ngp-pill.on-slate{background:#1e293b;color:#fff;border-color:#1e293b}
.ngp-date{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid #e2e8f0;color:#475569;font-family:${FONT}}
.ngp-body{padding:16px}
.ngp-h1{font-size:18px;font-weight:800;letter-spacing:-.01em;color:#0f172a}
.ngp-sub{font-size:12px;color:#64748b;margin-top:2px}
.ngp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin:14px 0}
.ngp-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
.ngp-card-v{font-size:20px;font-weight:800;line-height:1.1}
.ngp-card-l{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-top:2px}
.ngp-warn{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#92400e}
.ngp-scope{display:flex;gap:8px;align-items:flex-start;border-radius:8px;padding:7px 12px;margin-bottom:12px;font-size:12px;line-height:1.45}
.ngp-scope.auth{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}
.ngp-scope.preview{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}
.ngp-scope .ngp-scope-ico{font-size:13px;line-height:1.2}
.ngp-scope b{font-weight:700}
.ngp-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px}
.ngp-leg{display:flex;align-items:center;gap:6px;border:0;background:none;cursor:pointer;font-size:12px;color:#1f2937;padding:2px 4px;font-family:${FONT}}
.ngp-leg.off{opacity:.4}
.ngp-sw{width:12px;height:12px;border-radius:3px;flex-shrink:0}
.ngp-chart{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px}
.ngp-empty{font-size:12px;color:#94a3b8;text-align:center;padding:40px 0}
.ngp-hint{font-size:11px;color:#94a3b8;margin-top:10px;text-align:center}
.ngp-panel{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-top:12px;overflow:hidden}
.ngp-phead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;background:#f1f5f9;border-bottom:1px solid #e2e8f0}
.ngp-ptitle{font-weight:700;font-size:13px;color:#1e293b}
.ngp-cols{display:grid;align-items:center;gap:8px;grid-template-columns:minmax(0,2.4fr) 64px 54px 56px 56px 64px 60px}
.ngp-colhead{padding:6px 14px;border-bottom:1px solid #f1f5f9;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8}
.ngp-irow{padding:8px 14px;border-bottom:1px solid #f8fafc}
.ngp-irow.click{cursor:pointer}
.ngp-irow.click:hover{background:#f8fafc}
.ngp-iname{font-size:12px;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ngp-imeta{font-size:10px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.ngp-track{width:56px;height:6px;background:#f1f5f9;border-radius:999px;overflow:hidden;flex-shrink:0}
.ngp-track>div{height:100%;background:#93c5fd}
.ngp-num{text-align:right;font-size:12px;color:#475569}
.ngp-num.strong{font-weight:700;color:#0f172a}
.ngp-num.over{color:#dc2626;font-weight:700}
`;

function injectStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = PACING_CSS;
  document.head.appendChild(s);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
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
function str(v: unknown): string | undefined { return (v == null || v === '') ? undefined : String(v); }

// ─── Bucketing ───────────────────────────────────────────────────────────────

function bucketKey(ms: number, size: PacingBucketSize): string {
  const d = new Date(ms), y = d.getUTCFullYear();
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
function prevBucketMs(ms: number, size: PacingBucketSize): number {
  const d = new Date(bucketStartMs(ms, size));
  if (size === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  if (size === 'quarter') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1);
  return d.getTime() - 7 * DAY_MS;
}
/** Step a timestamp by n buckets (n<0 = earlier), snapping to bucket start. */
function stepBuckets(ms: number, size: PacingBucketSize, n: number): number {
  let cur = bucketStartMs(ms, size);
  const step = n >= 0 ? nextBucketMs : prevBucketMs;
  for (let i = 0; i < Math.abs(n); i++) cur = step(cur, size);
  return cur;
}
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// ─── Saved preferences (0.198 — restart from where you left off) ───────────────
// Persisted to localStorage, LWS-guarded (Salesforce can throw on storage access).
const PACING_PREFS_KEY = 'nga.pacing.prefs.v1';
interface PacingPrefs {
  range?: string; bucket?: PacingBucketSize; customS?: string; customE?: string;
  measure?: 'hours' | 'dollars'; mode?: 'period' | 'cumulative';
  show?: { actual: boolean; forecast: boolean; target: boolean; seg?: Record<string, boolean> };
}
function loadPacingPrefs(): PacingPrefs | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PACING_PREFS_KEY) : null;
    return raw ? (JSON.parse(raw) as PacingPrefs) : null;
  } catch { return null; }
}
function savePacingPrefs(p: PacingPrefs): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(PACING_PREFS_KEY, JSON.stringify(p)); } catch { /* LWS / no storage — ignore */ }
}

// 0.199.0 — Saved Views accessors. The views layer snapshots/restores the
// pacing config as an opaque blob (structurally decoupled — it never sees the
// PacingPrefs shape). Restoring writes the blob to the same localStorage key the
// renderer reads at mount, so applying a saved view + rebuilding paints pacing in
// the saved state. Returning `Record<string,unknown>` keeps PacingPrefs private.
export function getPacingPrefs(): Record<string, unknown> | null {
  return loadPacingPrefs() as Record<string, unknown> | null;
}
export function setPacingPrefs(p: Record<string, unknown> | null): void {
  if (p == null) {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(PACING_PREFS_KEY); } catch { /* ignore */ }
    return;
  }
  savePacingPrefs(p as PacingPrefs);
}
function keyToMs(key: string): number {
  if (key[0] === 'W') return parseISO(key.slice(1)) ?? 0;
  if (key.indexOf('Q') >= 0) { const [y, q] = key.split('-Q'); return Date.UTC(+y, (+q - 1) * 3, 1); }
  const [y, m] = key.split('-'); return Date.UTC(+y, +m - 1, 1);
}

/** NG fallback: actual(logged over elapsed span) + forecast(remaining over rest). */
function computeFromTasks(tasks: NormalizedTask[], size: PacingBucketSize): PacingData {
  const now = Date.now();
  const buckets = new Map<string, PacingBucket>();
  const itemMaps = new Map<string, Map<string, PacingBucketItem>>(); // bucketKey -> taskId -> item
  let estTotal = 0, loggedTotal = 0, unscheduled = 0, active = 0;

  function ensure(ms: number): PacingBucket {
    const start = bucketStartMs(ms, size), k = bucketKey(ms, size);
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
      itemMaps.set(k, new Map());
    }
    return b;
  }
  function addItem(bk: string, t: NormalizedTask, hrs: number, meta: Partial<PacingBucketItem>): void {
    const m = itemMaps.get(bk)!;
    let it = m.get(t.id);
    if (!it) { it = { id: t.id, name: t.title || t.name || t.id, hours: 0, ...meta }; m.set(t.id, it); }
    it.hours += hrs;
  }
  /** Spread `amount` across buckets overlapping [a,b], adding to series + items.
   *  For forecast, `segId` routes the hours into that commitment tier (0.200.0). */
  function spread(t: NormalizedTask, a: number, b: number, amount: number, series: 'actual' | 'forecast', meta: Partial<PacingBucketItem>, segId?: string): void {
    const span = b - a;
    if (span <= 0 || amount <= 0) return;
    const perDay = amount / (span / DAY_MS);
    let cur = bucketStartMs(a, size), guard = 0;
    while (cur < b && guard++ < 800) {
      const next = nextBucketMs(cur, size);
      const oS = Math.max(cur, a), oE = Math.min(next, b);
      if (oE > oS) {
        const hrs = perDay * (oE - oS) / DAY_MS;
        if (hrs > 0.01) {
          const bkt = ensure(cur);
          bkt[series] += hrs;
          if (series === 'forecast' && segId) {
            if (!bkt.segments) bkt.segments = {};
            bkt.segments[segId] = (bkt.segments[segId] || 0) + hrs;
          }
          addItem(bkt.key, t, hrs, meta);
        }
      }
      cur = next;
    }
  }

  for (const t of tasks) {
    // 0.200.1 — exclude terminal-stage work (Done/Cancelled/…) from the forecast,
    // mirroring the board's hideCompleted + the priority lanes + DH's authoritative
    // scope. Without this, a Cancelled/Done item whose isInactive flag isn't set
    // had its remaining spread into future bars (live: "CF 2.0 · Cancelled · 15h"
    // polluting a forecast bucket) and mis-tiered in the stack. Wholesale exclusion
    // (not just remaining) keeps the preview + drill-down reconciled with DH totals.
    if (t.isInactive || DONE_STAGES[t.stage || '']) continue;
    const est = Number(t.estimatedHours) || 0;
    const logged = Number(t.loggedHours) || 0;
    if (est <= 0 && logged <= 0) continue;
    active++; estTotal += est; loggedTotal += logged;
    const remaining = Math.max(0, est - logged);
    const s = parseISO(t.startDate);
    const e = parseISO(t.endDate);
    // 0.200.0 — classify this item's forecast into a commitment tier (NG default
    // mapping; hosts override via PacingData.segments). HOLD/deferred is excluded
    // from the forecast stack; unknown lanes fall back to 'greenlit'. The tier is
    // also stamped on the drill-down item so the breakdown can group by it.
    const lane = t.priorityGroup || '';
    const segId = lane === 'deferred' ? null : (PACING_LANE_TO_SEGMENT[lane] || 'greenlit');
    const meta: Partial<PacingBucketItem> = {
      estimatedHours: round(est), loggedHours: round(logged), remainingHours: round(remaining),
      budgetUsedPct: est > 0 ? round(logged / est * 100) : 0,
      startDate: str(t.startDate), endDate: str(t.endDate),
      assignee: str(t.assignee), status: str(t.status), group: str(t.groupName) || str(t.groupId),
      tier: segId || (lane || undefined),
    };
    if (s == null || e == null || e < s) {
      if (remaining > 0) unscheduled += remaining;
      continue;
    }
    // Actual: logged across the elapsed part of the span [start, min(now,end)].
    spread(t, s, Math.min(now, e), logged, 'actual', meta);
    // Forecast: remaining across the future part [max(now,start), end] — only for
    // non-HOLD work, routed into its tier so the chart can stack the hockey stick.
    if (segId) {
      const fs = Math.max(now, s);
      if (fs < e) spread(t, fs, e, remaining, 'forecast', meta, segId);
      else if (remaining > 0) { // overdue: drop remaining into the current bucket
        const bkt = ensure(now); bkt.forecast += remaining;
        if (!bkt.segments) bkt.segments = {};
        bkt.segments[segId] = (bkt.segments[segId] || 0) + remaining;
        addItem(bkt.key, t, remaining, meta);
      }
    }
  }

  const ordered = Array.from(buckets.values()).sort((a, b) => a.key < b.key ? -1 : 1);
  for (const b of ordered) {
    b.actual = round(b.actual); b.forecast = round(b.forecast);
    if (b.segments) for (const k in b.segments) b.segments[k] = round(b.segments[k]);
    const items = Array.from(itemMaps.get(b.key)!.values());
    for (const it of items) {
      it.hours = round(it.hours);
      const span = it.remainingHours != null && it.loggedHours != null ? it.remainingHours + it.loggedHours : 0;
      it.pctOfItem = span > 0 ? round(it.hours / span * 100) : undefined;
    }
    b.items = items.sort((x, y) => y.hours - x.hours);
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
    // 0.200.0 — only advertise tiers that actually carry hours, so the legend
    // doesn't show empty toggles on a board with no PROPOSED/PLANNED work.
    segments: PACING_SEGMENT_DEFAULTS.filter(seg =>
      ordered.some(b => b.segments && (b.segments[seg.id] || 0) > 0)),
  };
}

// ─── Ranges ──────────────────────────────────────────────────────────────────

// 0.198 — 'span3'/'span6' are symmetric windows centred on today (last N + next N
// buckets) — the best situational-awareness default. 'next3'/'next6' kept as
// back-compat aliases (legacy host configs) that normalise to the symmetric span.
type RangePreset = 'all' | 'ytd' | 'thisQtr' | 'span3' | 'span6' | 'rest' | 'custom' | 'next3' | 'next6';
const RANGE_LABELS: Record<RangePreset, string> = {
  all: 'All', ytd: 'YTD', thisQtr: 'This Qtr', span3: '±3', span6: '±6', rest: 'Rest of yr', custom: 'Custom',
  next3: '±3', next6: '±6',
};
function rangeWindow(preset: RangePreset, size: PacingBucketSize, cs: string, ce: string): { from: number | null; to: number | null } {
  const now = Date.now(), d = new Date(now), y = d.getUTCFullYear();
  if (preset === 'all') return { from: null, to: null };
  if (preset === 'ytd') return { from: Date.UTC(y, 0, 1), to: now };
  if (preset === 'rest') return { from: bucketStartMs(now, size), to: Date.UTC(y, 11, 31) };
  if (preset === 'thisQtr') { const q = Math.floor(d.getUTCMonth() / 3); return { from: Date.UTC(y, q * 3, 1), to: Date.UTC(y, q * 3 + 3, 0) }; }
  if (preset === 'custom') return { from: parseISO(cs), to: parseISO(ce) };
  // symmetric span: last N + current + next N buckets, centred on today.
  const n = (preset === 'span3' || preset === 'next3') ? 3 : 6;
  const cur = bucketStartMs(now, size);
  let from = cur;
  for (let i = 0; i < n; i++) from = prevBucketMs(from, size);
  let to = cur;
  for (let i = 0; i <= n; i++) to = nextBucketMs(to, size); // through the end of the next-N bucket
  return { from, to };
}

// ─── Render ──────────────────────────────────────────────────────────────────

const COL = { actual: '#10b981', actualOver: '#ef4444', forecast: '#93c5fd', target: '#64748b', grid: '#e2e8f0', muted: '#64748b' };

export function renderPacingView(host: HTMLElement, tasks: NormalizedTask[], options: PacingViewOptions = {}): () => void {
  injectStyles();
  const dflt = options.defaults ?? {};
  const ctrl = options.controls ?? {};
  const allowDollars = ctrl.dollars !== false; // MF passes controls.dollars=false
  // 0.198 — precedence: the user's saved prefs (last session) win over host
  // defaults, which win over the built-in default. So the view reopens exactly
  // where the user left it; a host can still seed the first-ever load via defaults.
  const saved = loadPacingPrefs() ?? {};
  let bucket: PacingBucketSize = saved.bucket || dflt.bucket || options.pacingData?.bucket || options.defaultBucket || 'week';
  let range: RangePreset = saved.range as RangePreset || dflt.range || 'span6';
  let customS = saved.customS ?? dflt.customStart ?? '';
  let customE = saved.customE ?? dflt.customEnd ?? '';
  let measure: 'hours' | 'dollars' = (((saved.measure || dflt.measure) === 'dollars') && allowDollars) ? 'dollars' : 'hours';
  let mode: 'period' | 'cumulative' = saved.mode || dflt.mode || 'period';
  let expandedKey: string | null = null;
  const show = {
    actual: saved.show?.actual ?? dflt.series?.actual ?? true,
    forecast: saved.show?.forecast ?? dflt.series?.forecast ?? true,
    target: saved.show?.target ?? dflt.series?.target ?? false,
    // 0.200.0 — per-segment visibility for the stacked forecast tiers. Absent =
    // visible; toggled off entries persist here. Keyed by PacingSegment.id.
    seg: { ...(saved.show?.seg ?? {}) } as Record<string, boolean>,
  };
  const segOn = (id: string): boolean => show.seg[id] !== false;
  // Persist the full control state so the next mount restarts from here.
  function persistPrefs(): void {
    savePacingPrefs({ range, bucket, customS, customE, measure, mode, show: { ...show } });
  }
  // 0.199.5 — notify the host when a pacing PARAMETER (bucket / range / custom
  // window) changes, so an authoritative host (DH) can recompute PacingData for
  // the new params and push it back via setPacingData. Fired only on parameter
  // changes — NOT on every internal re-render (drill-down expand must not
  // refetch). Empty custom dates are passed as undefined.
  function notifyParams(): void {
    options.onParamsChange?.({ bucket, range, customStart: customS || undefined, customEnd: customE || undefined });
  }
  // 0.198 — window steppers: nudge one end of the visible window by ±1 bucket.
  // First click on a preset resolves it to a concrete custom window, then nudges;
  // grows/shrinks at the start (past) or end (future). Guards start < end.
  function stepWindow(end: 'start' | 'end', dirBuckets: number): void {
    if (range !== 'custom' || !customS || !customE) {
      const w = rangeWindow(range, bucket, customS, customE);
      const baseFrom = w.from ?? bucketStartMs(Date.now(), bucket);
      const baseTo = w.to ?? nextBucketMs(bucketStartMs(Date.now(), bucket), bucket);
      customS = isoOf(baseFrom);
      customE = isoOf(baseTo);
      range = 'custom';
    }
    if (end === 'start') {
      const cand = isoOf(stepBuckets(parseISO(customS) ?? Date.now(), bucket, dirBuckets));
      if ((parseISO(cand) ?? 0) < (parseISO(customE) ?? 0)) customS = cand;
    } else {
      const cand = isoOf(stepBuckets(parseISO(customE) ?? Date.now(), bucket, dirBuckets));
      if ((parseISO(cand) ?? 0) > (parseISO(customS) ?? 0)) customE = cand;
    }
    expandedKey = null; notifyParams(); render();
  }

  function data(): PacingData {
    if (options.pacingData && options.pacingData.bucket === bucket) {
      return mergeLocalItems(options.pacingData);
    }
    return computeFromTasks(tasks, bucket);
  }

  // 0.197.0 — items-hybrid. DH's authoritative PacingData carries period totals
  // (actual/forecast/target/summary/$) but no per-period items[] — its
  // PacingPeriodDTO has no composition list. So when an authoritative bucket
  // has no items, borrow the drill-down composition from NG's own task-derived
  // preview (matched by key/startMs/label). Authoritative numbers drive the
  // bars + summary; local tasks populate the drill-down — no DH change needed.
  function mergeLocalItems(d: PacingData): PacingData {
    const needItems = d.buckets.some(b => !b.items || b.items.length === 0);
    // 0.200.0 — also borrow the forecast TIER split when the host hasn't fed one,
    // so prod renders the stacked hockey stick today. The host (DH/CN) should
    // feed PacingData.segments + per-bucket segments for authoritative tiers;
    // until then NG scales its own priorityGroup-derived split to the host's
    // authoritative per-bucket forecast (total stays authoritative, split is NG's).
    const needSegs = !d.segments || d.segments.length === 0;
    if (!needItems && !needSegs) return d;
    const local = computeFromTasks(tasks, d.bucket);
    const byKey = new Map(local.buckets.map(b => [b.key, b] as const));
    const matchLocal = (b: PacingBucket): PacingBucket | undefined => byKey.get(b.key)
      || local.buckets.find(x => (b.startMs != null && x.startMs === b.startMs) || x.label === b.label);
    return {
      ...d,
      segments: needSegs ? local.segments : d.segments,
      buckets: d.buckets.map(b => {
        const lb = matchLocal(b);
        const items = (b.items && b.items.length) ? b.items : (lb ? lb.items : []);
        let segments = b.segments;
        if (needSegs && !segments && lb && lb.segments) {
          const localTot = Object.keys(lb.segments).reduce((s, k) => s + (lb.segments![k] || 0), 0);
          if (localTot > 0) {
            const scale = b.forecast / localTot;
            segments = {};
            for (const k in lb.segments) segments[k] = round(lb.segments[k] * scale);
          }
        }
        return { ...b, items, segments };
      }),
    };
  }
  const rate = (d: PacingData) => d.rate ?? options.rate;

  function pill(label: string, on: boolean, onClick: () => void, slate = false): HTMLElement {
    const b = el('button', 'ngp-pill' + (on ? (slate ? ' on-slate' : ' on') : ''), label);
    b.addEventListener('click', onClick);
    return b;
  }
  function grp(label: string, ...kids: HTMLElement[]): HTMLElement {
    const g = el('div', 'ngp-grp');
    g.appendChild(el('span', 'ngp-lbl', label));
    kids.forEach(k => g.appendChild(k));
    return g;
  }

  function render(): void {
    persistPrefs(); // 0.198 — restart-where-you-left-off
    const d = data();
    const r = rate(d);
    const useDollars = measure === 'dollars' && !!r;
    const cum = mode === 'cumulative';
    host.innerHTML = '';
    const root = el('div', 'ngp-root');

    // control bar — each group is host-configurable via options.controls
    const bar = el('div', 'ngp-bar');
    const row1 = el('div', 'ngp-row');
    let row1n = 0;
    if (ctrl.ranges !== false) {
      const ranges = (Array.isArray(ctrl.ranges) ? ctrl.ranges
        : ['span3', 'span6', 'rest', 'thisQtr', 'ytd', 'all', 'custom']) as RangePreset[];
      row1.appendChild(grp('Range', ...ranges.map(p =>
        pill(RANGE_LABELS[p], range === p, () => { range = p; expandedKey = null; notifyParams(); render(); })))); row1n++;
      // 0.198 — edge steppers: add/remove one bucket at each end of the window.
      const u = bucket === 'week' ? 'wk' : bucket === 'quarter' ? 'qtr' : 'mo';
      row1.appendChild(grp('Earlier',
        pill('−', false, () => stepWindow('start', 1), true),   // trim oldest
        pill('+' + u, false, () => stepWindow('start', -1), true), // add a past bucket
      ));
      row1.appendChild(grp('Later',
        pill('+' + u, false, () => stepWindow('end', 1), true),  // add a future bucket
        pill('−', false, () => stepWindow('end', -1), true),     // trim newest
      ));
      if (range === 'custom') {
        const mk = (v: string, set: (x: string) => void) => {
          const i = document.createElement('input');
          i.type = 'date'; i.value = v; i.className = 'ngp-date';
          i.addEventListener('change', () => { set(i.value); notifyParams(); render(); });
          return i;
        };
        const cw = el('div', 'ngp-grp');
        cw.appendChild(mk(customS, x => customS = x));
        cw.appendChild(el('span', 'ngp-lbl', '→'));
        cw.appendChild(mk(customE, x => customE = x));
        row1.appendChild(cw);
      }
    }
    if (ctrl.buckets !== false) {
      const buckets = (Array.isArray(ctrl.buckets) ? ctrl.buckets
        : ['week', 'month', 'quarter']) as PacingBucketSize[];
      row1.appendChild(grp('Bucket', ...buckets.map(b =>
        pill(b[0].toUpperCase() + b.slice(1), bucket === b, () => {
          bucket = b; expandedKey = null; options.onBucketChange?.(b); notifyParams(); render();
        }, true)))); row1n++;
    }
    if (row1n > 0) bar.appendChild(row1);

    const row2 = el('div', 'ngp-row');
    let row2n = 0;
    // Measure: show the group unless disabled; $ pill only when a rate exists AND
    // dollars are allowed (MF passes controls.dollars=false to hide $).
    if (ctrl.measure !== false) {
      const measures = [pill('Hours', measure === 'hours', () => { measure = 'hours'; render(); })];
      if (r && allowDollars) measures.push(pill('$', measure === 'dollars', () => { measure = 'dollars'; render(); }));
      if (measures.length > 1) { row2.appendChild(grp('Measure', ...measures)); row2n++; }
    }
    if (ctrl.mode !== false) {
      row2.appendChild(grp('Mode',
        pill('Per period', mode === 'period', () => { mode = 'period'; render(); }, true),
        pill('Cumulative', mode === 'cumulative', () => { mode = 'cumulative'; render(); }, true))); row2n++;
    }
    if (ctrl.series !== false) {
      const legPill = (key: 'actual' | 'forecast' | 'target', label: string, color: string) => {
        const b = el('button', 'ngp-leg' + (show[key] ? '' : ' off'));
        b.appendChild(el('span', 'ngp-sw')).setAttribute('style', 'background:' + color);
        b.appendChild(el('span', undefined, label));
        b.addEventListener('click', () => { show[key] = !show[key]; render(); });
        return b;
      };
      // 0.200.0 — when the data defines forecast tiers, the single "Forecast"
      // toggle is replaced by one toggle per tier (dotted tiers get a dashed
      // swatch). Each toggles show.seg[id]; the chart stacks accordingly.
      const segPill = (seg: PacingSegment, i: number): HTMLElement => {
        const b = el('button', 'ngp-leg' + (segOn(seg.id) ? '' : ' off'));
        const c = seg.color || PACING_SEG_RAMP[i % PACING_SEG_RAMP.length];
        const sw = seg.style === 'dotted' ? 'background:' + c + '33;border:1px dashed ' + c
          : seg.style === 'outline' ? 'background:' + c + '14;border:1px solid ' + c
          : seg.style === 'hatched' ? 'background:repeating-linear-gradient(45deg,' + c + '22 0 2px,transparent 2px 4px);border:1px solid ' + c
          : 'background:' + c;
        b.appendChild(el('span', 'ngp-sw')).setAttribute('style', sw);
        b.appendChild(el('span', undefined, seg.label));
        b.addEventListener('click', () => { show.seg[seg.id] = !segOn(seg.id); render(); });
        return b;
      };
      const segs = d.segments && d.segments.length
        ? [...d.segments].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : null;
      const leg = el('div', 'ngp-grp');
      leg.appendChild(el('span', 'ngp-lbl', 'Series'));
      leg.appendChild(legPill('actual', 'Actual', COL.actual));
      if (segs) segs.forEach((seg, i) => leg.appendChild(segPill(seg, i)));
      else leg.appendChild(legPill('forecast', 'Forecast', COL.forecast));
      leg.appendChild(legPill('target', 'Target', COL.target));
      row2.appendChild(leg); row2n++;
    }
    if (row2n > 0) bar.appendChild(row2);
    root.appendChild(bar);

    // body
    const body = el('div', 'ngp-body');
    const hd = el('div');
    hd.appendChild(el('div', 'ngp-h1', 'Pacing & Forecast'));
    const sub = (d.authoritative ? 'Actuals · forecast · target' + (d.scopeLabel ? ' — ' + d.scopeLabel : '')
      : 'Forecast preview — actual to date, remaining spread across scheduled dates (live from the board)')
      + (useDollars ? ' · $ at ' + fmtMoney(r!) + '/hr' : '') + (cum ? ' · cumulative' : '');
    hd.appendChild(el('div', 'ngp-sub', sub));
    body.appendChild(hd);

    // 0.199.2 — loud source/scope DESIGNATION. The forecast's basis must never
    // be a silent surprise: (a) authoritative (host feed) vs preview (task-
    // derived) can swap silently when a host only feeds some buckets, and
    // (b) the authoritative scope (system-of-record portfolio) may not match the
    // board's current filter/search. Banner it either way.
    {
      const auth = !!d.authoritative;
      const scope = el('div', 'ngp-scope ' + (auth ? 'auth' : 'preview'));
      scope.appendChild(el('span', 'ngp-scope-ico', auth ? 'ⓘ' : '⚠'));
      const txt = el('span');
      if (auth) {
        const n = d.summary.activeItems;
        const what = d.scopeLabel || (n + ' active item' + (n === 1 ? '' : 's'));
        txt.appendChild(document.createTextNode('Authoritative forecast · scope: '));
        txt.appendChild(el('b', undefined, what));
        txt.appendChild(document.createTextNode('. From the host’s system of record — may not match the board’s current filter or search.'));
      } else {
        txt.appendChild(el('b', undefined, 'Preview forecast'));
        txt.appendChild(document.createTextNode(' — derived from the board’s task dates + estimates, not an authoritative feed. Numbers can differ from the live view (e.g. this bucket/filter has no authoritative data).'));
      }
      scope.appendChild(txt);
      body.appendChild(scope);
    }

    const s = d.summary;
    const val = (h: number) => useDollars ? fmtMoney(h * r!) : fmtH(h);
    const cards = el('div', 'ngp-cards');
    const stat = (label: string, value: string, tone?: string) => {
      const c = el('div', 'ngp-card');
      const v = el('div', 'ngp-card-v', value);
      if (tone) v.setAttribute('style', 'color:' + tone);
      c.appendChild(v); c.appendChild(el('div', 'ngp-card-l', label));
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
      body.appendChild(el('div', 'ngp-warn',
        '⚠ ' + fmtH(s.unscheduledHours) + ' of work has an estimate but no scheduled dates — the forecast can\'t place it. Size + schedule those items to complete the picture.'));
    }

    // chart (range-filtered)
    const win = rangeWindow(range, bucket, customS, customE);
    const visible = d.buckets.filter(b => {
      const ms = b.startMs ?? keyToMs(b.key);
      if (win.from != null && ms < win.from) return false;
      if (win.to != null && ms > win.to) return false;
      return true;
    });
    body.appendChild(buildChart(visible, { show, segments: d.segments, useDollars, rate: r || 0, cum, expandedKey }, (k) => {
      expandedKey = expandedKey === k ? null : k; render();
    }));

    if (expandedKey) {
      const b = visible.find(x => x.key === expandedKey) || d.buckets.find(x => x.key === expandedKey);
      if (b) body.appendChild(buildDrilldown(b, { useDollars, rate: r || 0 }, options));
    } else {
      body.appendChild(el('div', 'ngp-hint', 'Click a bar to break the period down into its work items.'));
    }

    root.appendChild(body);
    host.appendChild(root);
  }

  render();
  return () => { try { options.onItemHover?.(null, { x: 0, y: 0 }); } catch { /* ignore */ } host.innerHTML = ''; };
}

// ─── Chart ───────────────────────────────────────────────────────────────────

interface ChartOpts { show: { actual: boolean; forecast: boolean; target: boolean; seg: Record<string, boolean> }; segments?: PacingSegment[]; useDollars: boolean; rate: number; cum: boolean; expandedKey: string | null; }

function buildChart(buckets: PacingBucket[], o: ChartOpts, onBucketClick: (k: string) => void): HTMLElement {
  const wrap = el('div', 'ngp-chart');
  if (buckets.length === 0) { wrap.appendChild(el('div', 'ngp-empty', 'No periods in this range.')); return wrap; }
  const mul = o.useDollars ? (o.rate || 1) : 1;
  // 0.200.0 — stacked forecast tiers. segDefs = host-declared (or NG-default)
  // segments in stack order; visSegs = those toggled on. When present, the
  // forecast bar is replaced by these stacked sub-bars (cumulative-aware).
  const segDefs = (o.segments && o.segments.length)
    ? [...o.segments].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : null;
  const visSegs = segDefs ? segDefs.filter(s => o.show.seg[s.id] !== false) : null;
  let cA = 0, cF = 0, cT = 0;
  const cSeg: Record<string, number> = {};
  const rows = buckets.map(b => {
    cA += b.actual; cF += b.forecast; cT += b.target;
    const segVals: Record<string, number> = {};
    if (segDefs) for (const sd of segDefs) {
      const v = (b.segments && b.segments[sd.id]) || 0;
      cSeg[sd.id] = (cSeg[sd.id] || 0) + v;
      segVals[sd.id] = (o.cum ? cSeg[sd.id] : v) * mul;
    }
    return { b, actual: (o.cum ? cA : b.actual) * mul, forecast: (o.cum ? cF : b.forecast) * mul, target: (o.cum ? cT : b.target) * mul, segVals };
  });
  const W = 920, H = 300, padL = 52, padB = 34, padT = 10, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = rows.length, slot = plotW / n, barW = Math.min(46, slot * 0.62);
  let maxV = 1;
  for (const r of rows) {
    const segSum = visSegs
      ? visSegs.reduce((s, sd) => s + (r.segVals[sd.id] || 0), 0)
      : (o.show.forecast ? r.forecast : 0);
    maxV = Math.max(maxV, (o.show.actual ? r.actual : 0) + segSum, o.show.target ? r.target : 0);
  }
  const niceMax = niceCeil(maxV);
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;
  const fmtAxis = (v: number) => o.useDollars ? '$' + (v >= 1000 ? round(v / 1000) + 'k' : round(v)) : round(v) + '';
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: 'auto', style: 'display:block' });
  // 0.200.2 — lazily-built diagonal hatch patterns for style:'hatched' segments.
  const defs = svgEl('defs', {}); svg.appendChild(defs);
  const hatchCache = new Map<string, string>();
  const hatchUrl = (color: string): string => {
    let id = hatchCache.get(color);
    if (!id) {
      id = 'ngp-hx-' + (pacingHatchSeq++);
      const p = svgEl('pattern', { id, patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(45)' });
      p.appendChild(svgEl('rect', { width: 5, height: 5, fill: color, opacity: 0.12 }));
      p.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: color, 'stroke-width': 1.4 }));
      defs.appendChild(p); hatchCache.set(color, id);
    }
    return 'url(#' + id + ')';
  };
  for (let i = 0; i <= 4; i++) {
    const v = niceMax * i / 4, yy = y(v);
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
    if (visSegs) {
      // Stacked tiers, bottom→top. Dotted tiers render as a hatched/outlined cap
      // (e.g. unapproved "ready to approve" upside). Host color/style override
      // the NG defaults; the legend toggles which tiers are disclosed here.
      visSegs.forEach((sd, si) => {
        const v = r.segVals[sd.id] || 0;
        if (v <= 0) return;
        const h = (v / niceMax) * plotH; top -= h;
        const c = sd.color || PACING_SEG_RAMP[si % PACING_SEG_RAMP.length];
        const attrs: Record<string, string | number> = { x, y: top, width: barW, height: h, rx: 2 };
        const st = sd.style || 'solid';
        if (st === 'dotted') {
          attrs.fill = c + '33'; attrs.stroke = c; attrs['stroke-width'] = 1.2; attrs['stroke-dasharray'] = '3 2';
        } else if (st === 'outline') {
          attrs.fill = c + '14'; attrs.stroke = c; attrs['stroke-width'] = 1.4;
        } else if (st === 'hatched') {
          attrs.fill = hatchUrl(c); attrs.stroke = c; attrs['stroke-width'] = 1;
        } else {
          attrs.fill = c; if (!r.b.isPast) attrs.opacity = 0.95;
        }
        if (sd.opacity != null) attrs.opacity = sd.opacity;  // host override wins
        svg.appendChild(svgEl('rect', attrs));
      });
    } else if (o.show.forecast && r.forecast > 0) {
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
    const tot = round(r.actual + r.forecast);
    hit.appendChild(svgEl('title', {})).textContent = r.b.label + ' — ' + (o.useDollars ? '$' + tot : tot + 'h') + (o.cum ? ' (cumulative)' : '');
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

// ─── Drill-down ──────────────────────────────────────────────────────────────

function buildDrilldown(b: PacingBucket, o: { useDollars: boolean; rate: number }, options: PacingViewOptions): HTMLElement {
  const panel = el('div', 'ngp-panel');
  const total = b.actual + b.forecast;
  const head = el('div', 'ngp-phead');
  head.appendChild(el('div', 'ngp-ptitle', b.label + ' — ' + (o.useDollars ? fmtMoney(total * o.rate) : fmtH(total)) + ' · ' + b.items.length + ' item' + (b.items.length === 1 ? '' : 's')));
  if (options.onOpenReport) {
    const rpt = el('button', 'ngp-pill', 'Open report ↗');
    rpt.addEventListener('click', () => options.onOpenReport!({ bucketKey: b.key, taskIds: b.items.map(i => i.id) }));
    head.appendChild(rpt);
  }
  panel.appendChild(head);
  // 0.200.1 — drop 0h-contribution rows (rounding/zero noise the live drill-down
  // surfaced, e.g. "[RR] Confirm authoritative… · 0h"); only show real contributors.
  const items = b.items.filter(i => (i.hours || 0) > 0);
  if (items.length === 0) { panel.appendChild(el('div', 'ngp-empty', 'No itemized work in this period.')); return panel; }

  const fmtv = (h?: number) => h == null ? '—' : (o.useDollars ? fmtMoney(h * o.rate) : fmtH(h));
  const hrow = el('div', 'ngp-cols ngp-colhead');
  ['Work item', 'This period', '% of item', 'Est', 'Logged', 'Remaining', '% used'].forEach((c, i) =>
    hrow.appendChild(el('div', i === 0 ? '' : 'ngp-num', c)));
  panel.appendChild(hrow);

  const maxH = Math.max(...items.map(i => i.hours), 1);
  for (const it of items) {
    const row = el('div', 'ngp-cols ngp-irow' + (options.onOpenItem ? ' click' : ''));
    const nameCell = el('div');
    const nl = el('div', 'ngp-grp');
    nl.appendChild(el('div', 'ngp-iname', it.name)).setAttribute('style', 'flex:1;min-width:0');
    const track = el('div', 'ngp-track');
    track.appendChild(el('div')).setAttribute('style', 'width:' + round(it.hours / maxH * 100) + '%');
    nl.appendChild(track);
    nameCell.appendChild(nl);
    const meta = [it.group, it.assignee, it.status, (it.startDate && it.endDate) ? (it.startDate + ' → ' + it.endDate) : null].filter(Boolean).join(' · ');
    if (meta) nameCell.appendChild(el('div', 'ngp-imeta', meta));
    row.appendChild(nameCell);
    const num = (txt: string, extra = '') => el('div', 'ngp-num' + extra, txt);
    row.appendChild(num(o.useDollars ? fmtMoney(it.hours * o.rate) : fmtH(it.hours), ' strong'));
    row.appendChild(num(it.pctOfItem != null ? it.pctOfItem + '%' : '—'));
    row.appendChild(num(fmtv(it.estimatedHours)));
    row.appendChild(num(fmtv(it.loggedHours)));
    row.appendChild(num(fmtv(it.remainingHours)));
    row.appendChild(num(it.budgetUsedPct != null ? it.budgetUsedPct + '%' : '—', it.budgetUsedPct != null && it.budgetUsedPct > 100 ? ' over' : ''));
    if (options.onOpenItem) row.addEventListener('click', () => options.onOpenItem!(it.id));
    if (options.onItemHover) {
      row.addEventListener('mousemove', e => options.onItemHover!(it.id, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));
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
