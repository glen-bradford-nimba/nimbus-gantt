/**
 * IIFEApp.ts — Template-driven vanilla-JS application chrome (v10).
 *
 * Rewritten in Phase 2 to route all chrome rendering through the template
 * framework in ./templates/. Preserves the gantt/list/treemap/bubbles/
 * calendar/flow renderers + depthShading + dragReparent engines from v5.
 *
 * Mount contract:
 *   IIFEApp.mount(container, {
 *     template?: 'cloudnimbus',     // defaults to 'cloudnimbus'
 *     tasks, onPatch,
 *     config?: { ... }              // legacy passthrough (title/version/etc)
 *     overrides?: TemplateOverrides,
 *     engine?: NimbusGanttEngine,
 *   });
 */
import type {
  NormalizedTask, AppInstance, MountOptions, TaskPatch, NimbusGanttEngine,
  PendingEdit, CommitEditsResult, GanttDependency,
} from './types';
import type {
  TemplateOverrides, TemplateConfig, AppState, AppEvent, SlotProps, SlotData, PatchLogEntry,
  VanillaSlotInstance, FeatureFlags, AuditPreviewItem,
} from './templates/types';
import {
  buildDepthMap, buildTasks, buildTasksEpic, applyFilter, computeStats,
  DONE_STAGES, STAGE_COLORS, STAGE_TO_CATEGORY_COLOR, isBucketId,
} from './pipeline';
import { startDepthShading } from './depthShading';
import { startDragReparent } from './dragReparent';
import { renderAuditListView } from './templates/cloudnimbus/components/vanilla/AuditListView.vanilla';
import { renderTreemap } from './renderers/treemap';
import { renderBubble } from './renderers/bubble';

import { resolveTemplate } from './templates/resolver';
import { INITIAL_STATE, reduceAppState } from './templates/state';
import { SLOT_ORDER, shouldRenderSlot } from './templates/slots';
import { ensureTemplateCss, removeTemplateCss } from './templates/stylesheet-loader';
import { themeToScopedCss } from './templates/css';
import { diag } from './diag';

// Ensure built-in templates self-register on module load.
// CRITICAL: Use .vanilla variants — React imports break Locker Service.
import './templates/cloudnimbus/index.vanilla';
import './templates/minimal/index.vanilla';

// One-shot emitter — fires when the bundle is loaded. Cowork correlates
// diag events with the HANDOFF commit SHA on the consumer side; the app
// field is reserved for a build-time version string once vite.config.ts
// grows a define. For now, 'unknown' is fine — SHA lives in HANDOFF.md.
diag('lib:loaded', { app: 'unknown' });

/* ── Theme (V3_MATCH_THEME — used by the gantt engine) ──────────────────── */
const V3_THEME = {
  timelineBg: '#ffffff', timelineGridColor: '#e5e7eb', timelineHeaderBg: '#f3f4f6',
  timelineHeaderText: '#1f2937', timelineWeekendBg: 'rgba(229,231,235,0.4)',
  todayLineColor: '#ef4444', todayBg: 'rgba(239,68,68,0.08)',
  barDefaultColor: '#94a3b8', barBorderRadius: 4, barTextColor: '#ffffff',
  barSelectedBorder: '#3b82f6',
  gridBg: '#ffffff', gridAltRowBg: 'rgba(255,255,255,0)', gridBorderColor: '#e5e7eb',
  gridTextColor: '#1f2937', gridHeaderBg: '#f3f4f6', gridHeaderText: '#1f2937',
  gridHoverBg: 'rgba(229,231,235,0.3)',
  dependencyColor: '#3b82f6', dependencyWidth: 2,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 12, selectionColor: '#3b82f6', singleRowHeader: true,
};

/**
 * Default gantt tree columns. DM-3 (0.183) adds two optional extra columns
 * gated by `features.hoursColumn` / `features.budgetUsedColumn`. Build
 * dynamically at mount time so each surface can opt into the split view.
 *
 * NOTE: the default columns have empty header strings because the library
 * CSS hides the header row (see injectLegacyNgCss: `.ng-grid-header{visibility:hidden}`).
 * DM-3 columns carry real header labels so DH surfaces that enable them
 * get readable column titles when consumer CSS re-shows the header.
 */
interface GanttCol {
  field: string;
  header: string;
  width: number;
  tree?: boolean;
  align?: 'left' | 'right' | 'center';
}
function buildGanttCols(features: FeatureFlags): GanttCol[] {
  const cols: GanttCol[] = [
    { field: 'title',      header: '',            width: 210, tree: true },
    { field: 'hoursLabel', header: '',            width: 85,  align: 'right' },
  ];
  if (features.hoursColumn) {
    cols.push({ field: 'hours',         header: 'Hours',       width: 60, align: 'right' });
  }
  if (features.budgetUsedColumn) {
    cols.push({ field: 'budgetUsedPct', header: 'Budget Used', width: 90, align: 'right' });
  }
  return cols;
}

/**
 * Initial viewport offset from today — gantt scrolls to `today - 14 days`
 * on mount so users see ~2 weeks of recent past context rather than today
 * flush at the left edge. Matches v9 default. If a future consumer needs
 * configurability, expose `initialViewportOffsetDays` on MountOptions and
 * derive this value from it; the library-side default here stays.
 */
const INITIAL_VIEWPORT_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * 0.185.1 — snap a focus date to the start-of-period for the active zoom.
 * Used by `initialFocusDate` mount option + `handle.scrollToDate()` so the
 * landing position aligns with the period column the user expects to see
 * at the left edge.
 *
 *   'day'     → date as-is
 *   'week'    → snap to Monday (ISO 8601 week start)
 *   'month'   → snap to the 1st of the month
 *   'quarter' → snap to the 1st of the quarter (Jan/Apr/Jul/Oct)
 *
 * Operates in UTC throughout — same convention pipeline.ts uses for date
 * parsing so `addDays`/`parseDate`/the snap math don't disagree about the
 * day boundary.
 */
function snapDateToZoomPeriod(date: Date, zoom: string | undefined): Date {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  if (zoom === 'week') {
    // ISO 8601: Monday = 1, Sunday = 0. Compute distance back to Monday.
    const dow = d.getUTCDay();
    const offsetDays = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + offsetDays);
  } else if (zoom === 'month') {
    d.setUTCDate(1);
  } else if (zoom === 'quarter') {
    const m = d.getUTCMonth();
    const qm = Math.floor(m / 3) * 3;
    d.setUTCMonth(qm, 1);
  }
  // 'day' or undefined — no snap.
  return d;
}

/**
 * 0.185.1 — parse an `initialFocusDate` / `scrollToDate` argument into a
 * Date. Accepts ISO strings ('2026-04-19', '2026-04-19T00:00:00Z') or a
 * Date instance. Returns null on parse failure so callers can short-circuit
 * cleanly without throwing inside the scroll hot path.
 */
function parseFocusDate(input: string | Date | undefined | null): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  // ISO-only path. Date.parse handles both 'YYYY-MM-DD' and full ISO.
  const t = Date.parse(input);
  if (isNaN(t)) return null;
  return new Date(t);
}

/* ── Legacy gantt-CSS injection (kept from v5 for library class overrides) ──
 *
 * Also carries CRITICAL template-flex rules so the gantt canvas measures the
 * correct host dimensions at initGantt() time, BEFORE the async template
 * stylesheet (ensureTemplateCss) arrives. Without these, the column-flex
 * layout hasn't applied yet — ContentArea is content-sized (tiny), host
 * measures ~40-60px, and the canvas permanently sticks at that size.
 * Regression observed on /v12 2026-04-16 (canvas 43px tall).
 *
 * The async template stylesheet still handles everything else (colours,
 * spacing, typography). Only the load-order-critical flex rules live here. */
function injectLegacyNgCss(): void {
  if (document.getElementById('nga-v5-css')) return;
  const s = document.createElement('style');
  s.id  = 'nga-v5-css';
  s.textContent = [
    /* Critical template-flex rules — must apply synchronously at mount. */
    '.nga-root{display:flex;flex-direction:column;height:100%;width:100%;overflow:hidden}',
    /* Fullscreen mode safety floor — if the consumer\'s parent chain doesn\'t
     * resolve to a real viewport height (e.g. Lightning app page with weird
     * layout, or a plain div that lost its position:fixed), fall back to
     * 100vh so the canvas always has room. Embedded mode is explicitly NOT
     * floored — embedded consumers opt into small container sizes. */
    '.nga-root[data-mode="fullscreen"]{min-height:100vh}',
    '.nga-titlebar,.nga-filterbar,.nga-zoombar,.nga-stats,.nga-hrswkstrip,.nga-audit{flex-shrink:0}',
    '.nga-content-outer{flex:1 1 auto;display:flex;overflow:hidden;min-width:0;min-height:0}',
    '.nga-content{flex:1 1 auto;position:relative;min-width:0;min-height:0}',
    /* Library-class (.ng-*) overrides — v5 styling carried forward. */
    '.ng-grid{font-family:sans-serif!important;font-size:12px!important;color:#1f2937!important;letter-spacing:-.01em}',
    '.ng-grid table{border-collapse:collapse!important;border-spacing:0!important}',
    '.ng-grid-header{background:#f3f4f6!important;visibility:hidden!important}',
    '.ng-grid-th{font-size:12px!important;font-weight:700!important;color:#1f2937!important;padding:0 6px!important;border-right:none!important}',
    '.ng-grid-row:not(.ng-group-row) .ng-tree-cell .ng-expand-icon+.ng-grid-cell-text{font-weight:700!important;color:#1f2937!important}',
    '.ng-grid-row .ng-tree-cell .ng-expand-spacer+.ng-grid-cell-text{font-weight:400!important;color:#6b7280!important;font-size:11px!important}',
    '.ng-grid-cell{padding-top:0!important;padding-right:6px!important;padding-bottom:0!important;padding-left:6px;line-height:32px!important;border-right:none!important}',
    '.ng-expand-spacer{width:0!important;min-width:0!important}',
    /* .ng-expand-icon — ARROW_DIFF 2026-04-18 font-family normalization.
     * Must match the canonical rule in styles.css:~687 so SF's
     * synchronous injection backstop doesn't fight the async template
     * stylesheet. See styles.css for rationale. */
    '.ng-expand-icon{font-family:-apple-system,"Segoe UI Symbol","Apple Symbols","Helvetica Neue",Arial,sans-serif!important;font-size:10px!important;line-height:1!important;display:inline-block!important;text-align:center!important;opacity:.5!important;color:#6b7280!important;width:16px!important;min-width:16px!important}',
    '.ng-expand-icon:hover{opacity:1!important}',
    '.ng-grid-row{border:none!important;box-shadow:inset 0 -1px 0 #f3f4f6;box-sizing:border-box!important}',
    '.ng-grid-row:not(.ng-group-row){cursor:grab}',
    '.ng-grid-row:not(.ng-group-row):hover{background:rgba(59,130,246,0.04)!important;outline:1px solid rgba(59,130,246,0.12)!important;outline-offset:-1px}',
    '.ng-grid-row:not(.ng-group-row):active{cursor:grabbing}',
    '.ng-grid-row td{border:none!important;box-sizing:border-box!important}',
    '.ng-row-alt:not(.ng-group-row){background:unset}',
    '.ng-scroll-content>canvas{position:sticky!important;left:0!important}',
    '[data-depth-stripes]{display:none!important}',
    '.ng-group-row{font-weight:700;font-size:11px;letter-spacing:.03em;box-sizing:border-box!important;box-shadow:none!important;color:#fff!important}',
    '.ng-group-row .ng-grid-cell-text{font-weight:700!important;font-size:12px!important;color:#fff!important;text-transform:uppercase}',
    '.ng-group-row .ng-expand-icon{color:inherit!important;opacity:.5!important}',
    '.ng-group-row .ng-grid-cell[data-field="hoursLabel"]{font-weight:600!important;font-size:11px!important;color:inherit!important;opacity:.75;white-space:nowrap!important;overflow:visible!important}',
    '.ng-grid-cell[data-field="hoursLabel"]{font-family:monospace;font-size:10px;color:#94a3b8;font-weight:400}',
    '.ng-row-selected:not(.ng-group-row){background:rgba(59,130,246,0.06)!important;box-shadow:inset 3px 0 0 #3b82f6!important}',
    '.ng-grid-row:not(.ng-group-row) .ng-tree-cell[style*="padding-left: 28px"]{padding-left:8px!important}',
    '.ng-grid-row:not(.ng-group-row) .ng-tree-cell[style*="padding-left: 48px"]{padding-left:18px!important}',
    '.ng-grid-row:not(.ng-group-row) .ng-tree-cell[style*="padding-left: 68px"]{padding-left:28px!important}',
    '.ng-grid-row:not(.ng-group-row) .ng-tree-cell[style*="padding-left: 88px"]{padding-left:38px!important}',
    /* 0.183.1 — chrome button cursor. CLS_PILL_BTN_BASE (Tailwind) doesn't
     * declare cursor, so the UA default for <button> (which is 'default'
     * per spec, regardless of Chrome's old override) renders a non-click-
     * signal arrow. Force pointer inside every chrome surface so users
     * read the buttons as interactive. VF/Locker-safe — bare selector,
     * no Tailwind arbitrary-value syntax. */
    '.nga-titlebar button,.nga-filterbar button,.nga-zoombar button,.nga-audit button,.nga-stats button,.nga-sidebar button{cursor:pointer}',
  ].join('');
  document.head.appendChild(s);
}

/* ── Alt-view renderers (carried over from v5) ─────────────────────────── */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, css?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  return e;
}

/**
 * Unified "Coming Soon" placeholder for non-Gantt views (A1 stage-1, 0.182).
 *
 * v9 has six functional view-mode renderers — Gantt + List + Treemap + Bubbles
 * + Calendar + Flow. We ship Gantt as the only fully-ported view in 0.182.
 * Per HQ scope decision (2026-04-18 option b for visual parity), the pill
 * row in TitleBar shows all six labels — clicking a non-Gantt pill lands
 * here instead of a half-working stub.
 *
 * 0.183 ports: AuditListView (List), then wire the proper renderers from
 * packages/app/src/renderers/{treemap,bubble}.ts (which are real squarified
 * + bubble implementations, ~170-180 lines each, just need the right call
 * signatures). Calendar + Flow get fresh ports.
 *
 * Removed in this edit: the v5-era inline 30-line stubs for renderList /
 * renderTreemap / renderBubbles / renderCalendar / renderFlow. Per the
 * "stubs are worse than absence in cut context" feedback principle, those
 * stubs created a worse first impression than an honest placeholder.
 */
/**
 * 0.185.7 — mount a canvas-based alt view (treemap or bubble). Creates a
 * DPI-scaled canvas sized to the container and invokes the passed renderer
 * function with the current task list and a minimal theme. Re-runs on
 * every rebuildView call since view-mode changes flow through that path.
 */
type AltRenderer = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tasks: NormalizedTask[],
  opts: {
    colorMap: Record<string, string>;
    hoveredId?: string | null;
    theme: { bg: string; text: string; altRowBg: string; textMuted: string; font: string };
  },
) => void;

function mountAltCanvasView(
  container: HTMLElement,
  tasks: NormalizedTask[],
  renderer: AltRenderer,
  colorMap: Record<string, string>,
): void {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);
  const rect = container.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(240, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  renderer(ctx, w, h, tasks, {
    colorMap,
    hoveredId: null,
    theme: {
      bg: '#ffffff',
      text: '#1f2937',
      altRowBg: 'rgba(229,231,235,0.4)',
      textMuted: '#64748b',
      font: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
    },
  });
}

/**
 * 0.185.8 — Admin panel. Floating surface listing user-toggleable feature
 * flags from tplConfig.features. Each checkbox dispatches TOGGLE_FEATURE
 * so the state reducer records the override. IIFEApp's state-change path
 * reconciles the override back onto tplConfig.features before rebuildView
 * runs, so toggles take effect on the next rebuild tick.
 *
 * Whitelisted toggles (runtime-safe): hoursColumn, budgetUsedColumn,
 * headerRowCompletionBar, statsPanel, filterBar, zoomBar, sidebar,
 * auditPanel, hrsWkStrip, depthShading. Interaction flags (dragReparent,
 * detailPanel, titleBar, groupByToggle, hideCompletedToggle) are not
 * toggleable at runtime — flipping them mid-session causes visible seams.
 */
const ADMIN_TOGGLEABLE_FEATURES: Array<{ key: string; label: string }> = [
  { key: 'statsPanel',           label: 'Stats panel' },
  { key: 'filterBar',            label: 'Filter bar' },
  { key: 'zoomBar',              label: 'Zoom bar' },
  { key: 'sidebar',              label: 'Sidebar' },
  { key: 'auditPanel',           label: 'Audit panel' },
  { key: 'hrsWkStrip',           label: 'Hours/week strip' },
  { key: 'depthShading',         label: 'Depth shading' },
  { key: 'hoursColumn',          label: 'Hours column' },
  { key: 'budgetUsedColumn',     label: 'Budget-used column' },
  { key: 'headerRowCompletionBar', label: 'Header completion bar' },
  // 0.185.11 — drag-to-reparent. Default OFF. When ON: drop-onto-row
  // middle = nest under, drop-on-bucket-header = deparent, horizontal
  // drag changes depth. When OFF: pure reorder, no parent changes.
  { key: 'enableDragReparent',   label: 'Enable drag to reparent' },
  // 0.185.16 — canvas-bar vertical drag reprioritize. Default OFF.
  // When ON: vertical-dominant drag of a bar commits a reorder
  // instead of shifting dates. Horizontal drags still shift dates.
  { key: 'enableDragBarToReprioritize', label: 'Prioritize by Gantt bar' },
];

type AdminDispatch = (ev: { type: 'TOGGLE_ADMIN' } | { type: 'TOGGLE_ADVISOR' } | { type: 'TOGGLE_FEATURE'; key: string }) => void;

function renderAdminPanel(
  container: HTMLElement,
  state: AppState,
  dispatch: AdminDispatch,
  tplConfig: TemplateConfig,
): void {
  const id = 'nga-admin-panel';
  let panel = container.querySelector<HTMLElement>(`#${id}`);
  if (!state.adminOpen) {
    if (panel) panel.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.id = id;
    panel.style.cssText = [
      'position:absolute',
      'top:60px',
      'right:12px',
      'width:260px',
      'max-height:calc(100vh - 120px)',
      'overflow:auto',
      'background:#ffffff',
      'border:1px solid #e5e7eb',
      'border-radius:8px',
      'box-shadow:0 12px 32px rgba(15,23,42,0.18)',
      'padding:12px 14px',
      'z-index:9998',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    ].join(';');
    container.appendChild(panel);
  }
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
  const title = document.createElement('div');
  title.textContent = 'Admin — Feature Toggles';
  title.style.cssText = 'font-size:12px;font-weight:700;color:#1f2937';
  header.appendChild(title);
  const close = document.createElement('button');
  close.textContent = '\u00D7';
  close.style.cssText = 'background:none;border:none;font-size:18px;line-height:1;color:#64748b;cursor:pointer;padding:0 4px';
  close.addEventListener('click', () => dispatch({ type: 'TOGGLE_ADMIN' }));
  header.appendChild(close);
  panel.appendChild(header);

  const hint = document.createElement('div');
  hint.textContent = 'Toggle chrome surfaces on/off. Changes apply immediately.';
  hint.style.cssText = 'font-size:10px;color:#64748b;margin-bottom:10px;line-height:1.4';
  panel.appendChild(hint);

  const features = tplConfig.features as unknown as Record<string, boolean | undefined>;
  for (const item of ADMIN_TOGGLEABLE_FEATURES) {
    const base = features[item.key];
    const override = state.featureOverrides[item.key];
    const on = override === undefined ? !!base : override;

    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:11px;color:#1f2937';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.style.cssText = 'cursor:pointer';
    cb.addEventListener('change', () => dispatch({ type: 'TOGGLE_FEATURE', key: item.key }));
    row.appendChild(cb);

    const lbl = document.createElement('span');
    lbl.textContent = item.label;
    row.appendChild(lbl);

    panel.appendChild(row);
  }
}

/**
 * 0.185.8 — Advisor panel. Honest "coming soon" body for the narrative-mode
 * feature until the Claude-API infrastructure is designed (auth path, CSP
 * allowances under LWS, error surface, streaming UX). The button wiring and
 * panel framing are in place so restoration in a later cut is pure body work
 * — no chrome plumbing to redo.
 */
function renderAdvisorPanel(
  container: HTMLElement,
  state: AppState,
  dispatch: AdminDispatch,
): void {
  const id = 'nga-advisor-panel';
  let panel = container.querySelector<HTMLElement>(`#${id}`);
  if (!state.advisorOpen) {
    if (panel) panel.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.id = id;
    panel.style.cssText = [
      'position:absolute',
      'top:60px',
      'right:282px',
      'width:300px',
      'background:#ffffff',
      'border:1px solid #e5e7eb',
      'border-radius:8px',
      'box-shadow:0 12px 32px rgba(15,23,42,0.18)',
      'padding:14px 16px',
      'z-index:9998',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    ].join(';');
    container.appendChild(panel);
  }
  panel.innerHTML = '';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
  const title = document.createElement('div');
  title.textContent = 'Advisor — Narrative Mode';
  title.style.cssText = 'font-size:12px;font-weight:700;color:#1f2937';
  header.appendChild(title);
  const close = document.createElement('button');
  close.textContent = '\u00D7';
  close.style.cssText = 'background:none;border:none;font-size:18px;line-height:1;color:#64748b;cursor:pointer;padding:0 4px';
  close.addEventListener('click', () => dispatch({ type: 'TOGGLE_ADVISOR' }));
  header.appendChild(close);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'font-size:11px;color:#475569;line-height:1.5';
  body.innerHTML =
    '<p style="margin:0 0 8px 0"><strong>Coming in a later cut.</strong></p>' +
    '<p style="margin:0 0 8px 0">Advisor mode turns the visible task list + date range into a Claude-generated narrative walkthrough of what the timeline actually says.</p>' +
    '<p style="margin:0;color:#64748b">Restoration pending API infrastructure decisions (auth, CSP under LWS, streaming UX, error handling).</p>';
  panel.appendChild(body);
}

function renderComingSoon(container: HTMLElement, viewLabel: string): void {
  container.innerHTML = '';
  const wrap = el('div', [
    'height:100%',
    'width:100%',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'padding:32px',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'color:#475569',
    'background:#f8fafc',
    'text-align:center',
  ].join(';'));
  const title = el('div', 'font-size:18px;font-weight:700;color:#1f2937');
  title.textContent = viewLabel + ' view — coming in 0.183';
  wrap.appendChild(title);
  const msg = el('div', 'font-size:13px;color:#64748b;max-width:480px;line-height:1.5');
  msg.textContent =
    'Only the Gantt view is fully ported in this release. Switch back to ' +
    'Gantt to see the timeline. The other views are planned for the next ' +
    'cut alongside the AuditListView port.';
  wrap.appendChild(msg);
  container.appendChild(wrap);
}

/* ══════════════════════════════════════════════════════════════════════════ */

interface Registry { container: HTMLElement; cleanup: () => void; }
const registry: Registry[] = [];
function getEntry(c: HTMLElement): Registry | null { return registry.find(e => e.container === c) || null; }
function removeEntry(c: HTMLElement): void {
  const idx = registry.findIndex(e => e.container === c);
  if (idx !== -1) registry.splice(idx, 1);
}

/* Extended mount options: allow the caller to name a template. */
export interface TemplateAwareMountOptions extends MountOptions {
  template?: string;
  overrides?: TemplateOverrides;
  /**
   * engineOnly — skip all slot/chrome rendering and treat `container`
   * directly as the gantt canvas surface. Used by NimbusGanttAppReact
   * when React already owns the chrome; IIFEApp just drives the engine.
   */
  engineOnly?: boolean;
}

/**
 * Chrome features forced OFF in embedded mode. Behaviour-only flags
 * (dragReparent, depthShading, groupByToggle, hideCompletedToggle) are
 * intentionally left alone so the canvas remains interactive.
 *
 * CH-1 (0.183): reused by `toggleChrome()` to flip chrome off at runtime
 * without re-mounting. Same keyset as embedded-mode — if you add a new
 * chrome slot, add the flag here too.
 */
const EMBEDDED_FEATURE_OVERRIDES: Partial<FeatureFlags> = {
  titleBar: false,
  statsPanel: false,
  filterBar: false,
  zoomBar: false,
  sidebar: false,
  detailPanel: false,
  auditPanel: false,
  hrsWkStrip: false,
};

/**
 * Render the floating "↗ Full Screen" button for embedded mode. Inlined styles
 * keep it self-contained — it renders before the template stylesheet arrives
 * and doesn't require any Tailwind classes to resolve. The button is absolutely
 * positioned top-right of the container.
 */
function renderEmbeddedFullscreenButton(
  container: HTMLElement,
  onClick: () => void,
): () => void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-nga-fullscreen-enter', '1');
  btn.textContent = '\u2197 Full Screen';
  btn.style.cssText = [
    'position:absolute',
    'top:8px',
    'right:8px',
    'z-index:50',
    'padding:6px 10px',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    'font-size:11px',
    'font-weight:600',
    'color:#1f2937',
    'background:#ffffff',
    'border:1px solid #e5e7eb',
    'border-radius:6px',
    'box-shadow:0 1px 2px rgba(0,0,0,0.04)',
    'cursor:pointer',
  ].join(';');
  btn.addEventListener('click', onClick);
  // container is the gantt host; make sure it positions our button correctly.
  if (!container.style.position) container.style.position = 'relative';
  container.appendChild(btn);
  return () => { try { btn.remove(); } catch (_e) { /* ok */ } };
}

export class IIFEApp {
  static mount(container: HTMLElement, options: TemplateAwareMountOptions): AppInstance {
    const mountStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    IIFEApp.unmount(container);

    const templateName = options.template || 'cloudnimbus';
    const mode = options.mode || 'fullscreen';

    try {
      const r = container.getBoundingClientRect();
      diag('mount:start', {
        containerRect: { x: r.x, y: r.y, w: r.width, h: r.height },
        mode,
        engineVersion: (options.engine && (options.engine as { version?: string }).version) || 'unknown',
        hasOnExit: typeof options.onExitFullscreen === 'function',
        hasOnEnter: typeof options.onEnterFullscreen === 'function',
        engineOnly: !!options.engineOnly,
        template: templateName,
      });
    } catch (_e) { /* diag never throws */ }
    const overrides: TemplateOverrides = options.overrides ? { ...options.overrides } : {};
    // Legacy title/version passthrough
    if (options.config?.title !== undefined)   overrides.title   = options.config.title;
    if (options.config?.version !== undefined) overrides.version = options.config.version;
    if (options.config?.buckets) overrides.buckets = options.config.buckets;

    // Embedded mode: force chrome feature flags off before template
    // resolution so no slot wastes work rendering + destroying. Consumer
    // overrides still win on top (rare — if an LWC wanted embedded mode
    // with e.g. a stats panel, it would pass features.statsPanel=true).
    if (mode === 'embedded') {
      overrides.features = {
        ...EMBEDDED_FEATURE_OVERRIDES,
        ...(overrides.features || {}),
      };
    }

    let tplConfig: TemplateConfig;
    try {
      tplConfig = resolveTemplate(templateName, overrides);
    } catch (err) {
      console.error('[nimbus-gantt] template resolution failed:', err);
      // Fallback to cloudnimbus defaults silently
      tplConfig = resolveTemplate('cloudnimbus', overrides);
    }
    tplConfig.mode = mode;
    if (options.onEnterFullscreen) tplConfig.onEnterFullscreen = options.onEnterFullscreen;
    if (options.onExitFullscreen)  tplConfig.onExitFullscreen  = options.onExitFullscreen;
    if (options.cssUrl) tplConfig.stylesheet = { ...tplConfig.stylesheet, url: options.cssUrl };
    if (options.engine) tplConfig.engine = options.engine;
    if (options.recordUrlTemplate) tplConfig.recordUrlTemplate = options.recordUrlTemplate;
    // 0.185.15 — pipe fieldSchema mount option through to tplConfig so
    // DetailPanel (vanilla + React) can read it via slot props.
    if (options.fieldSchema) tplConfig.fieldSchema = options.fieldSchema;
    // 0.185.26 — pipe titleBarButtons mount option through to tplConfig so
    // TitleBar (vanilla + React) can render them before the Full Screen
    // button. Runtime updates flow via handle.setTitleBarButtons(...).
    if (options.titleBarButtons) tplConfig.titleBarButtons = options.titleBarButtons;
    // 0.185.11 — wire enableDragReparent mount option → tplConfig.features.
    // Default FALSE (reparent gesture off); consumers must opt in explicitly.
    // AdminPanel can toggle at runtime via the existing featureOverrides path.
    tplConfig.features.enableDragReparent = options.enableDragReparent === true;
    try { console.log('[NG config] enableDragReparent=', tplConfig.features.enableDragReparent); } catch (_e) { /* ok */ }
    // 0.185.16 — same pattern for canvas-bar vertical drag reprioritize.
    tplConfig.features.enableDragBarToReprioritize = options.enableDragBarToReprioritize === true;
    try { console.log('[NG config] enableDragBarToReprioritize=', tplConfig.features.enableDragBarToReprioritize); } catch (_e) { /* ok */ }

    /* ── engineOnly: React owns chrome — just run the gantt engine ──── */
    if (options.engineOnly) {
      // Non-destructive: only add what we need (position:relative so absolute
      // children anchor correctly, plus a height:100% default when consumer
      // hasn't provided one). DON'T clobber existing cssText — that would
      // wipe consumer-provided positioning (e.g. position:fixed; inset:0).
      if (!container.style.position) container.style.position = 'relative';
      if (!container.style.height)   container.style.height   = '100%';
      if (!container.style.width)    container.style.width    = '100%';
      const ganttEl = document.createElement('div');
      ganttEl.style.cssText = 'height:100%;width:100%;position:absolute;inset:0';
      container.innerHTML = '';
      container.appendChild(ganttEl);

      const _win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
      const eng: NimbusGanttEngine | null = options.engine ?? (_win?.NimbusGantt as NimbusGanttEngine | undefined) ?? null;
      if (!eng || !eng.NimbusGantt) {
        ganttEl.style.cssText += ';padding:20px;color:#b91c1c;font-size:13px';
        ganttEl.textContent = 'nimbus-gantt engine not loaded';
        registry.push({ container, cleanup: () => { container.innerHTML = ''; } });
        return { setTasks: () => { /* no-op */ }, destroy: () => IIFEApp.unmount(container) };
      }

      injectLegacyNgCss();
      let allTasks: NormalizedTask[] = options.tasks || [];
      // 0.185.27 — dependencies re-exposed. Default [] keeps legacy
      // behavior (no arrows) when host doesn't pass the option.
      let allDependencies: GanttDependency[] = options.dependencies || [];
      const state: AppState = { ...INITIAL_STATE };
      const depthMap = buildDepthMap(allTasks);
      const filtered = applyFilter(allTasks, state.filter as 'active', state.search);
      const gtasks = buildTasks(filtered);

      // Last-hovered task id (canvas OR grid) — shared between mouseover
      // tracking and the container-level contextmenu listener so right-click
      // on a canvas bar resolves to the correct task.
      let lastHoveredTaskId: string | null = null;

      const findTaskById = (id: string | null): NormalizedTask | null => {
        if (!id) return null;
        return allTasks.find((t) => t.id === id) ?? null;
      };

      const inst = new eng.NimbusGantt(ganttEl, {
        tasks: gtasks, dependencies: allDependencies, columns: buildGanttCols(tplConfig.features), theme: V3_THEME,
        rowHeight: 32, barHeight: 20, headerHeight: 32, gridWidth: 295,
        zoomLevel: state.zoom, showToday: true, showWeekends: true, showProgress: true,
        colorMap: options.config?.colorMap || { ...STAGE_COLORS, ...STAGE_TO_CATEGORY_COLOR },
        readOnly: false,
        onTaskClick: (task: { id: string }) => {
          if (!task || !task.id || isBucketId(task.id)) return;
          const t = findTaskById(task.id);
          if (t) options.onTaskClick?.(t, 'canvas');
          // IM-5 (0.183) — id-only click alias for hosts that prefer the new
          // taskId-first contract over the legacy NormalizedTask signature.
          options.onItemClick?.(task.id);
        },
        onTaskDblClick: (task: { id: string }) => {
          if (!task || !task.id || isBucketId(task.id)) return;
          const t = findTaskById(task.id);
          // engineOnly: no internal reducer — consumer's callback is the
          // control path. The React driver's reducer handles TOGGLE_DETAIL
          // with editMode:true on this same event via its own engine-bridge.
          if (t) options.onTaskDoubleClick?.(t);
        },
        // Canvas-bar hover: engine fires onHover on every pointermove that
        // hits a bar, with task=null when the cursor leaves all bars. We
        // coalesce to avoid duplicate fires when the cursor stays over the
        // same bar, and share lastHoveredTaskId with the grid-row + context-
        // menu path so right-click on a canvas bar resolves correctly.
        onHover: (task: { id?: string } | null) => {
          const id = task?.id && !isBucketId(task.id) ? task.id : null;
          if (id === lastHoveredTaskId) return;
          lastHoveredTaskId = id;
          options.onTaskHover?.(id);
        },
        onTaskMove: (task: { id: string }, s: string, e: string) => {
          if (task && task.id && !isBucketId(task.id)) options.onPatch?.({ id: task.id, startDate: s, endDate: e });
        },
        onTaskResize: (task: { id: string }, s: string, e: string) => {
          if (task && task.id && !isBucketId(task.id)) options.onPatch?.({ id: task.id, startDate: s, endDate: e });
        },
      });

      /* ── DOM-level hover + contextmenu listeners ────────────────────────
       * Canvas-bar hover is handled by the engine's `onHover` callback in
       * the Ctor options above (fires on every pointermove hit). The DOM
       * `mouseover` listener below catches hover on the left-side grid
       * tree-cell (which sits outside the canvas), so consumers see both
       * surfaces as the same taskId.
       *
       * The contextmenu listener uses lastHoveredTaskId to resolve right-
       * clicks on canvas bars, since contextmenu fires on the container
       * element rather than a bar.
       *
       * Salesforce Locker/LWS swallows contextmenu events — the listener
       * attaches but the event never fires, so consumers must provide an
       * alternate UX (e.g. "edit dependencies" button in DetailPanel).
       */
      const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        const row = target?.closest?.('.ng-grid-row[data-task-id]') as HTMLElement | null;
        const id = row?.getAttribute('data-task-id') ?? null;
        if (id && !isBucketId(id) && id !== lastHoveredTaskId) {
          lastHoveredTaskId = id;
          options.onTaskHover?.(id);
        }
      };
      const handleMouseLeave = () => {
        if (lastHoveredTaskId !== null) {
          lastHoveredTaskId = null;
          options.onTaskHover?.(null);
        }
      };
      // 0.185.28 — shared resolver for contextmenu + pointerdown(button===2).
      // Salesforce LEX/Locker suppresses the canvas `contextmenu` event
      // before this listener can see it (probe failed in glen-walk
      // 2026-04-21 13:05 UTC). `pointerdown` with `button === 2` still
      // fires inside LEX, so we listen for both and short-circuit to the
      // same callback. preventDefault on contextmenu belt-and-suspenders
      // suppresses the browser default menu on platforms where it leaks.
      // 0.185.32 — coordinate-based task resolver, exposed on the mount
       // handle as `taskAt(x, y)`. Reused by both the internal event
       // listeners (non-LWS hosts) and the public handle method (LWS
       // hosts whose IIFE `document` reference is sandboxed — they catch
       // contextmenu from their own LWC class and call taskAt).
      const resolveTaskAt = (clientX: number, clientY: number, target: EventTarget | null): NormalizedTask | null => {
        const el = target as HTMLElement | null;
        const row = el?.closest?.('.ng-grid-row[data-task-id]') as HTMLElement | null;
        const rowId = row?.getAttribute('data-task-id') ?? null;
        let taskId = (rowId && !isBucketId(rowId)) ? rowId : lastHoveredTaskId;
        if (!taskId) {
          const hit = document.elementFromPoint?.(clientX, clientY) as HTMLElement | null;
          const hitRow = hit?.closest?.('[data-task-id]') as HTMLElement | null;
          const hitId = hitRow?.getAttribute('data-task-id');
          if (hitId && !isBucketId(hitId)) taskId = hitId;
        }
        return findTaskById(taskId);
      };
      const fireContextMenu = (clientX: number, clientY: number, target: EventTarget | null): boolean => {
        if (!options.onTaskContextMenu) return false;
        const t = resolveTaskAt(clientX, clientY, target);
        if (!t) return false;
        options.onTaskContextMenu(t, { x: clientX, y: clientY });
        return true;
      };
      const handleContextMenu = (e: MouseEvent) => {
        if (fireContextMenu(e.clientX, e.clientY, e.target)) e.preventDefault();
      };
      const handlePointerDown = (e: PointerEvent) => {
        if (e.button !== 2) return;
        if (fireContextMenu(e.clientX, e.clientY, e.target)) e.preventDefault();
      };
      ganttEl.addEventListener('mouseover', handleMouseOver);
      ganttEl.addEventListener('mouseleave', handleMouseLeave);
      ganttEl.addEventListener('contextmenu', handleContextMenu);
      ganttEl.addEventListener('pointerdown', handlePointerDown);
      if (typeof tplConfig.engine?.PriorityGroupingPlugin === 'function') {
        inst.use(tplConfig.engine.PriorityGroupingPlugin({
          buckets: tplConfig.buckets,
          getBucket: (task: { groupId?: string | null }) => task.groupId || null,
        }));
      }
      inst.setData(gtasks, allDependencies);
      try { inst.expandAll(); } catch (_e) { /* ok */ }
      // Initial viewport positioning. 0.185.1 priority order matches the
      // chrome-aware path: scrollLeft (px) > initialFocusDate (semantic) >
      // today-14d default. v9-parity rationale documented in the chrome-
      // aware mount path's equivalent block.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTimeout(() => {
        try {
          const gi = inst as { timeScale?: { dateToX?: (d: Date) => number }; scrollManager?: { scrollToX?: (x: number) => void } };
          const iv = options.initialViewport;
          if (iv && typeof iv.scrollLeft === 'number') {
            gi.scrollManager?.scrollToX?.(Math.max(0, iv.scrollLeft));
          } else if (options.initialFocusDate) {
            const parsed = parseFocusDate(options.initialFocusDate);
            if (parsed) {
              const snapped = snapDateToZoomPeriod(parsed, state.zoom);
              const x = gi.timeScale?.dateToX?.(snapped);
              if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
            }
          } else {
            const x = gi.timeScale?.dateToX?.(new Date(Date.now() - INITIAL_VIEWPORT_OFFSET_MS));
            if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
          }
        } catch (_e) { /* ok */ }
      }, 50);

      let cleanupShading: (() => void) | null = null;
      let cleanupDrag: (() => void) | null = null;
      if (tplConfig.features.depthShading) cleanupShading = startDepthShading(ganttEl, depthMap);
      if (tplConfig.features.dragReparent) cleanupDrag    = startDragReparent(ganttEl, allTasks, depthMap, options.onPatch || (() => { /* no-op */ }), () => !!tplConfig.features.enableDragReparent);

      const cleanup = () => {
        if (cleanupShading) cleanupShading();
        if (cleanupDrag)    cleanupDrag();
        ganttEl.removeEventListener('mouseover', handleMouseOver);
        ganttEl.removeEventListener('mouseleave', handleMouseLeave);
        ganttEl.removeEventListener('contextmenu', handleContextMenu);
        ganttEl.removeEventListener('pointerdown', handlePointerDown);
        try { inst.destroy(); } catch (_e) { /* ok */ }
        container.innerHTML = '';
      };
      registry.push({ container, cleanup });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function _syncToCanvas() {
        const f = applyFilter(allTasks, state.filter as 'active', state.search);
        const g = state.groupBy === 'epic'
          ? buildTasks(buildTasksEpic(f))
          : buildTasks(f);
        const gi = inst as any;
        if (typeof gi.setData === 'function') { gi.setData(g, allDependencies); try { gi.expandAll(); } catch (_e) { /* ok */ } }
      }

      return {
        setTasks(tasks: NormalizedTask[]) {
          allTasks = tasks;
          _syncToCanvas();
        },
        /** 0.185.27 — full replace of tasks AND dependencies. Pass the
         *  new deps array when the host has a fresh set (e.g. after Apex
         *  refresh pulls both timeline data and getGanttDependencies in
         *  parallel). Passing `undefined` leaves the existing deps alone
         *  — equivalent to `setTasks(tasks)`. */
        setData(tasks: NormalizedTask[], dependencies?: GanttDependency[]) {
          allTasks = tasks;
          if (dependencies !== undefined) allDependencies = dependencies;
          _syncToCanvas();
        },
        /** 0.185.32 — coordinate-based hit-test for host-driven right-click
         *  UX in LWS/Locker contexts where NG's internal document listeners
         *  silently no-op. Host attaches its own document listener, calls
         *  taskAt(e.clientX, e.clientY) to resolve the task under the cursor. */
        taskAt(clientX: number, clientY: number): NormalizedTask | null {
          return resolveTaskAt(clientX, clientY, null);
        },
        /** Called by NimbusGanttAppReact when the React filter/search state changes. */
        setFilter(filter: string, search: string) {
          state.filter = filter as AppState['filter'];
          state.search = search;
          _syncToCanvas();
        },
        /** Called by NimbusGanttAppReact when the zoom pill changes. */
        setZoom(zoom: string) {
          state.zoom = zoom as AppState['zoom'];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gi = inst as any;
          if (typeof gi.setZoom === 'function') gi.setZoom(zoom);
        },
        /** Called by NimbusGanttAppReact when the groupBy toggle changes. */
        setGroupBy(groupBy: string) {
          state.groupBy = groupBy as AppState['groupBy'];
          _syncToCanvas();
        },
        /** 0.185 — engineOnly batchMode stubs.
         *
         *  The engineOnly mount path doesn't currently buffer edits — it
         *  forwards onTaskMove/onTaskResize directly to options.onPatch.
         *  These stubs exist so NimbusGanttAppReact consumers calling
         *  `handleRef.current.commitEdits()` get a clean no-op rather than
         *  a TypeError. Real batch buffering for the React driver is queued
         *  for a follow-up cut once a React consumer needs it (CN v10/v12
         *  stay on per-patch flow per 0.185 spec). */
        getPendingEdits(): PendingEdit[] { return []; },
        commitEdits(): Promise<CommitEditsResult> { return Promise.resolve({ committed: [] }); },
        discardEdits(): void { /* no-op in engineOnly */ },
        /** 0.185.1 — same impl as the chrome-aware path. Snap then scroll. */
        scrollToDate(date: string | Date): void {
          const parsed = parseFocusDate(date);
          if (!parsed) return;
          try {
            const gi = inst as { timeScale?: { dateToX?: (d: Date) => number }; scrollManager?: { scrollToX?: (x: number) => void } };
            const snapped = snapDateToZoomPeriod(parsed, state.zoom);
            const x = gi.timeScale?.dateToX?.(snapped);
            if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
          } catch (_e) { /* ok */ }
        },
        destroy() { IIFEApp.unmount(container); },
      };
    }

    /* ── State ──────────────────────────────────────────────────────── */
    let state: AppState = { ...INITIAL_STATE };
    // IM-7 (0.183) — apply initialViewport.zoom to state before the first
    // renderSlots so the ZoomBar pill picks up the restored value on paint,
    // and initGantt passes the right zoomLevel to the engine Ctor.
    if (options.initialViewport?.zoom) {
      state = { ...state, zoom: options.initialViewport.zoom as AppState['zoom'] };
    }
    let allTasks: NormalizedTask[] = options.tasks || [];
    // 0.185.27 — dependencies re-exposed on chrome-aware mount path too.
    let allDependencies: GanttDependency[] = options.dependencies || [];
    const patchLog: PatchLogEntry[] = [];

    /* IM-7 (0.183) — Viewport emission helpers.
     *
     * After the engine mounts we attach a scroll listener to the
     * `.ng-scroll-wrapper` (inside ganttEl). Scroll bursts are debounced
     * to 150 ms before firing onViewportChange — matches Glen's spec and
     * avoids thrashing host persistence on fast drags / pan gestures.
     *
     * Zoom changes are emitted from the dispatch reducer (see below)
     * instead of via scroll events — zoom changes don't always cause a
     * scroll so the scroll path alone would drop them. */
    const _viewportEmitTimer: { t: ReturnType<typeof setTimeout> | null } = { t: null };
    function emitViewport(): void {
      if (!options.onViewportChange || !ganttInst) return;
      if (_viewportEmitTimer.t) clearTimeout(_viewportEmitTimer.t);
      _viewportEmitTimer.t = setTimeout(() => {
        _viewportEmitTimer.t = null;
        try {
          const sm = (ganttInst as { scrollManager?: { getScrollPosition?: () => { x: number; y: number } } }).scrollManager;
          const pos = sm?.getScrollPosition?.() ?? { x: 0, y: 0 };
          options.onViewportChange?.({
            scrollLeft: pos.x,
            scrollTop:  pos.y,
            zoom:       state.zoom,
          });
        } catch (_e) { /* swallow — emission is best-effort */ }
      }, 150);
    }

    /* CH-1 (0.183) — Chrome visibility.
     *
     * Starts from `options.chromeVisibleDefault` (default true). When false,
     * chrome slots are forced off via EMBEDDED_FEATURE_OVERRIDES at render
     * time, leaving the gantt canvas as the only rendered slot. Mutated by
     * `handle.toggleChrome()` at runtime.
     *
     * NOTE: `mode: 'embedded'` already forces features off before template
     * resolution; chromeVisible=false is the runtime equivalent that can
     * flip back without re-mounting. In embedded mode chromeVisible is
     * pinned false (toggling would have no effect since features are
     * already scrubbed from tplConfig). */
    let chromeVisible = options.chromeVisibleDefault !== false;
    if (mode === 'embedded') chromeVisible = false;
    // Capture a snapshot of the template-resolved features so toggleChrome
    // can restore them when re-enabling chrome. tplConfig.features is
    // mutated below to reflect chromeVisible state.
    const ORIGINAL_FEATURES: FeatureFlags = { ...tplConfig.features };
    function applyChromeVisibility(): void {
      if (chromeVisible) {
        tplConfig.features = { ...ORIGINAL_FEATURES };
      } else {
        tplConfig.features = {
          ...ORIGINAL_FEATURES,
          ...EMBEDDED_FEATURE_OVERRIDES,
        };
      }
    }
    applyChromeVisibility();
    // 0.183.1 — expose toggleChrome via tplConfig so slots (TitleBar Unpin
    // button) can hit it without needing the mount handle in scope.
    // handle.toggleChrome below delegates through this same closure.
    function runToggleChrome(visible?: boolean): void {
      const next = typeof visible === 'boolean' ? visible : !chromeVisible;
      if (next === chromeVisible) return;
      chromeVisible = next;
      applyChromeVisibility();
      renderSlots();
      // 0.185.9 — when chrome hides, render a small floating "show toolbar"
      // button so users can bring the TitleBar back without a handle call.
      // When chrome shows, remove the button. Before this, once the user
      // clicked Unpin the chrome disappeared permanently from their POV —
      // the only recovery path was `handle.toggleChrome(true)` from a
      // developer console, which is not a user-facing recovery.
      updateRepinButton();
    }
    tplConfig.toggleChrome = runToggleChrome;

    let repinButtonEl: HTMLElement | null = null;
    function updateRepinButton(): void {
      if (chromeVisible) {
        if (repinButtonEl) {
          try { repinButtonEl.remove(); } catch (_e) { /* ok */ }
          repinButtonEl = null;
        }
        return;
      }
      if (repinButtonEl) return; // already shown
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-nga-repin', '1');
      btn.textContent = '\u{1F4CC} Show toolbar';
      btn.title = 'Restore toolbar';
      btn.style.cssText = [
        'position:absolute',
        'top:8px',
        'right:8px',
        'z-index:60',
        'padding:6px 12px',
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
        'font-size:11px',
        'font-weight:600',
        'color:#1f2937',
        'background:#ffffff',
        'border:1px solid #e5e7eb',
        'border-radius:6px',
        'box-shadow:0 2px 6px rgba(15,23,42,0.08)',
        'cursor:pointer',
      ].join(';');
      btn.addEventListener('click', () => {
        try { console.log('[NG repin click] restoring chrome'); } catch (_e) { /* ok */ }
        runToggleChrome(true);
      });
      if (!container.style.position) container.style.position = 'relative';
      container.appendChild(btn);
      repinButtonEl = btn;
    }

    /* ── Root shell ─────────────────────────────────────────────────── */
    injectLegacyNgCss();
    // Scope CSS variables via <style data-nga-theme>
    const themeStyleEl = document.createElement('style');
    themeStyleEl.setAttribute('data-nga-theme', tplConfig.templateName);
    themeStyleEl.textContent = themeToScopedCss(tplConfig.templateName, tplConfig.theme);
    container.appendChild(themeStyleEl);

    // Fetch + inject template stylesheet per Strategy C.
    ensureTemplateCss(container, tplConfig.stylesheet).catch((err) => {
      console.warn('[nimbus-gantt] stylesheet load error', err);
    });

    container.className = 'nga-root';
    container.setAttribute('data-template', tplConfig.templateName);
    container.setAttribute('data-mode', mode);
    // 0.185.10 — marker for the Fullscreen API to find the right request
    // target (the whole mounted app, not just the TitleBar that triggered
    // the click). TitleBar's fullscreen button uses closest() to locate
    // this ancestor so chrome + gantt canvas go fullscreen together.
    container.setAttribute('data-nga-template-root', '1');
    // Non-destructive style application. Previously this assigned
    // container.style.cssText = '...' which WIPED consumer-provided inline
    // styles (position:fixed; inset:0 on /v12; any host-owned sizing on SF)
    // — making .nga-root content-size to the chrome sum (~240 px) and
    // leaving 0 px of surplus for ContentArea → canvas height 0.
    // Regression observed 2026-04-16 on /v12 + SF Delivery_Gantt_Standalone.
    //
    // We only need flex-column + overflow + theme defaults. Height/width/
    // position are the consumer's business — preserve whatever they set.
    // The critical CSS (injectLegacyNgCss) adds `.nga-root { height:100% }`
    // and `.nga-root[data-mode="fullscreen"] { min-height:100vh }` as
    // sensible defaults that only kick in if the consumer didn't size.
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.overflow = 'hidden';
    container.style.background = tplConfig.theme.bg;
    container.style.fontFamily = tplConfig.theme.fontFamily;
    diag('mount:styles-applied', {
      propsWritten: ['display', 'flex-direction', 'overflow', 'background', 'font-family'],
      preservedConsumer: {
        height: container.style.height || '(inherits)',
        width: container.style.width || '(inherits)',
        position: container.style.position || '(inherits)',
      },
    });
    diag('mount:data-mode', { mode });

    /* ── Dispatch + data helpers ────────────────────────────────────── */
    const _patchRefreshTimer: { t: ReturnType<typeof setTimeout> | null } = { t: null };
    const rawOnPatch = options.onPatch || (() => { /* no-op */ });

    /* IM-1/2/3 (0.183) — Async drag-to-edit state.
     *
     * The engine fires onTaskMove / onTaskResize synchronously on pointer-up
     * AFTER optimistically updating its internal state. We intercept those
     * callbacks, maintain a per-task pending-edit registry, and drive the
     * async contract Glen specified:
     *   - Capture original dates at first-in-chain edit (reused on subsequent
     *     rapid edits so revert restores truly-persisted state, not a prior
     *     in-flight optimistic value).
     *   - Apply optimistic update to allTasks + re-render the gantt with the
     *     affected bar dimmed (inflightTaskIds set).
     *   - Await host's onItemEdit(taskId, changes). On resolve (only if this
     *     edit is still the current seq for the task): clear in-flight, done.
     *   - On reject (current seq only): revert allTasks to captured originals,
     *     refreshGantt, call onItemEditError. Stale settles are ignored so
     *     newer in-flight edits aren't clobbered.
     *
     * When options.onItemEdit is absent, date-edits fall through to the
     * legacy onPatch path (no async contract, fires immediately). */
    /** Local seq-tracking entry for the 0.183 in-flight async path. Renamed
     *  from `PendingEdit` in 0.185 to avoid colliding with the public
     *  `PendingEdit` type (which describes the batch buffer). */
    interface EditSeqEntry {
      seq: number;
      origStart: string;
      origEnd: string;
    }
    const pendingEdits = new Map<string, EditSeqEntry>();
    let nextEditSeq = 0;
    const inflightTaskIds = new Set<string>();

    /* 0.185 — Batch buffer for batchMode mounts.
     *
     * Key: taskId+'::'+kind so an edit + a reorder on the same task can
     * coexist (DH may want to commit them as separate Apex calls).
     * Coalesces multiple drags on the same task: changes merge, original
     * snapshot preserved from the FIRST edit so discardEdits restores
     * truly-persisted state (same pattern as the 0.183 pendingEdits seq
     * registry).
     *
     * `dirtyTaskIds` parallels inflightTaskIds for the renderer dim
     * treatment. Bars with buffered (uncommitted) edits render in the
     * same dim color as in-flight bars. discardEdits + successful
     * commitEdits both clear from this set. */
    const pendingBuffer = new Map<string, PendingEdit>();
    const dirtyTaskIds = new Set<string>();

    function bufferEdit(
      taskId: string,
      kind: 'edit' | 'reorder',
      payloadDelta: Record<string, unknown>,
      originalDelta: PendingEdit['original'],
    ): void {
      const key = taskId + '::' + kind;
      const existing = pendingBuffer.get(key);
      if (kind === 'edit') {
        pendingBuffer.set(key, {
          taskId,
          kind: 'edit',
          changes: { ...(existing?.changes ?? {}), ...(payloadDelta as { startDate?: string; endDate?: string }) },
          original: existing?.original ?? originalDelta,
          ts: Date.now(),
        });
      } else {
        pendingBuffer.set(key, {
          taskId,
          kind: 'reorder',
          reorderPayload: {
            ...(existing?.reorderPayload ?? {}),
            ...(payloadDelta as { priorityGroup?: string; sortOrder?: number; parentId?: string | null }),
          },
          original: existing?.original ?? originalDelta,
          ts: Date.now(),
        });
      }
    }

    /** Translates the internal PendingEdit buffer into AuditPanel's
     *  AuditPreviewItem shape. One entry per taskId (collapses both
     *  edit + reorder kinds for the same task into a single preview row).
     *  Used by syncPendingChanges() to auto-populate
     *  tplConfig.pendingChanges when batchMode is on. */
    function buildPendingChangesFromBuffer(): AuditPreviewItem[] {
      if (pendingBuffer.size === 0) return [];
      const byTask = new Map<string, AuditPreviewItem>();
      for (const p of pendingBuffer.values()) {
        let entry = byTask.get(p.taskId);
        if (!entry) {
          const task = allTasks.find((t) => t.id === p.taskId);
          const title = (task?.title || (task?.name as string) || p.taskId);
          entry = { id: p.taskId, title, fields: [], descs: [] };
          byTask.set(p.taskId, entry);
        }
        if (p.kind === 'edit' && p.changes) {
          if (p.changes.startDate !== undefined) {
            entry.fields.push('startDate');
            entry.descs.push('start: ' + (p.original.startDate || '?') + ' → ' + p.changes.startDate);
          }
          if (p.changes.endDate !== undefined) {
            entry.fields.push('endDate');
            entry.descs.push('end: ' + (p.original.endDate || '?') + ' → ' + p.changes.endDate);
          }
        }
        if (p.kind === 'reorder' && p.reorderPayload) {
          if (p.reorderPayload.priorityGroup !== undefined) {
            entry.fields.push('priorityGroup');
            entry.descs.push('group: ' + (p.original.priorityGroup || '?') + ' → ' + p.reorderPayload.priorityGroup);
          }
          if (p.reorderPayload.parentId !== undefined) {
            entry.fields.push('parentId');
            entry.descs.push('parent: ' + (p.original.parentId || 'none') + ' → ' + (p.reorderPayload.parentId || 'none'));
          }
          if (p.reorderPayload.sortOrder !== undefined) {
            entry.fields.push('sortOrder');
            entry.descs.push('sortOrder → ' + p.reorderPayload.sortOrder);
          }
        }
      }
      return Array.from(byTask.values());
    }

    /** When batchMode is on, mirror the buffer state into
     *  tplConfig.pendingChanges so the AuditPanel modal shows the live
     *  diff. No-op when batchMode is off — host-supplied pendingChanges
     *  remains in control on the per-patch flow (CN v10 path). */
    function syncPendingChanges(): void {
      if (!options.batchMode) return;
      tplConfig.pendingChanges = buildPendingChangesFromBuffer();
      renderSlots();
    }

    /** Dim a bar color for the in-flight visual state. Appends a 50%-alpha
     *  byte to hex colors; rgb/rgba colors pass through unchanged (dimming
     *  alpha-mix is not worth the parse cost — these are rare in practice
     *  since buildTasks uses STAGE_COLORS / STAGE_TO_CATEGORY_COLOR which
     *  are 6-digit hex). */
    function dimColor(hex: string): string {
      if (!hex) return '#94a3b880';
      if (hex.startsWith('rgb')) return hex;
      const s = hex.charAt(0) === '#' ? hex.slice(1) : hex;
      const full = s.length === 3
        ? s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2)
        : s;
      if (full.length !== 6) return hex;
      return '#' + full + '80';
    }

    async function onTaskEditAsync(
      taskId: string,
      nextStart: string,
      nextEnd: string,
      changes: { startDate?: string; endDate?: string },
    ): Promise<void> {
      const idx = allTasks.findIndex((t) => t.id === taskId);
      // 0.183.3-diag — entry probe with idx + onItemEdit-presence so we can
      // see in one log whether we're on happy path or divergence path, and
      // whether the host wired the new async callback.
      try { console.log('[NG] onTaskEditAsync hit', taskId, 'idx=', idx, 'hasOnItemEdit=', !!options.onItemEdit, 'hasOnPatch=', !!options.onPatch); } catch (_e) { /* ok */ }
      if (idx === -1) {
        // 0.185 — batchMode + divergence: we have no allTasks entry, so we
        // can neither buffer nor track originals. Surface a warn so HQ can
        // see the lost edit; do NOT call host (host doesn't know about the
        // task either). Engine's optimistic visual move stands until the
        // next setTasks() refresh pulls fresh data.
        if (options.batchMode) {
          try { diag('warn:task-not-in-allTasks', { taskId, origin: 'edit-batch', changes }); } catch (_e) { /* ok */ }
          return;
        }
        // 0.183.2 — divergence path. The engine fired onTaskMove/Resize with
        // a task the app layer doesn't know about (allTasks replaced via
        // setTasks() without this id, filter drift, namespace mismatch,
        // etc). We have no originals to capture and no local state to
        // update, but the HOST still needs to know so it can save. Legacy
        // onTaskPatch's contract was "always call host"; the async path in
        // 0.183 regressed this by returning silently. Symptom observed on
        // DH fd9cf675 + round-4 probe: bar moved visually (engine state
        // advanced) but no callback fired, no Apex save, zero console logs.
        try { diag('warn:task-not-in-allTasks', { taskId, origin: 'edit', changes }); } catch (_e) { /* ok */ }
        try {
          if (options.onItemEdit) {
            await options.onItemEdit(taskId, changes);
          } else {
            rawOnPatch({ id: taskId, startDate: nextStart, endDate: nextEnd });
          }
        } catch (err) {
          // No revert possible (no originals captured). Surface error so
          // the host toast fires; engine bar stays at new position until
          // host-side refresh pulls fresh data.
          try {
            options.onItemEditError?.(
              taskId,
              err instanceof Error ? err : new Error(String(err)),
            );
          } catch (_e) { /* swallow host-handler throws */ }
        }
        return;
      }

      // 0.185 — batchMode happy path: buffer instead of forwarding to host.
      // Self-contained — skips the seq-tracking + dispatch + onItemEdit
      // chain entirely. dispatch is intentionally NOT called here because
      // the reducer routes PATCH back to onTaskPatch which would fire
      // rawOnPatch (defeats buffering).
      if (options.batchMode) {
        const origStartB = (allTasks[idx].startDate || '');
        const origEndB   = (allTasks[idx].endDate   || '');
        // Optimistic local update (engine already moved the bar; mirror in allTasks).
        allTasks[idx] = { ...allTasks[idx], startDate: nextStart, endDate: nextEnd };
        const titleB = allTasks[idx].title || (allTasks[idx].name as string) || taskId;
        patchLog.unshift({ ts: new Date(), desc: titleB + ': dates updated (pending)' });
        if (patchLog.length > 50) patchLog.pop();
        bufferEdit(
          taskId,
          'edit',
          { startDate: nextStart, endDate: nextEnd } as Record<string, unknown>,
          { startDate: origStartB, endDate: origEndB },
        );
        dirtyTaskIds.add(taskId);
        syncPendingChanges();
        refreshGantt();
        return;
      }

      // Capture pre-edit-chain originals (reused when a prior edit is still
      // in flight for this task — revert must restore truly-persisted state).
      const existing = pendingEdits.get(taskId);
      const origStart = existing ? existing.origStart : (allTasks[idx].startDate || '');
      const origEnd   = existing ? existing.origEnd   : (allTasks[idx].endDate   || '');

      const seq = ++nextEditSeq;
      pendingEdits.set(taskId, { seq, origStart, origEnd });
      inflightTaskIds.add(taskId);

      // Optimistic local update + audit trail (same surface legacy onTaskPatch
      // hits, so pendingPatchCount + patchLog stay consistent).
      allTasks[idx] = { ...allTasks[idx], startDate: nextStart, endDate: nextEnd };
      const title = allTasks[idx].title || (allTasks[idx].name as string) || taskId;
      patchLog.unshift({ ts: new Date(), desc: title + ': dates updated' });
      if (patchLog.length > 50) patchLog.pop();
      dispatch({ type: 'PATCH', patch: { id: taskId, startDate: nextStart, endDate: nextEnd } });
      refreshGantt();

      if (!options.onItemEdit) {
        // Legacy: immediate commit via onPatch. No async contract to honor.
        inflightTaskIds.delete(taskId);
        pendingEdits.delete(taskId);
        // 0.183.3-diag — instrument the rawOnPatch fire site. If we see this
        // log on CN v12 but no proForma update happens, the break is in
        // CN's onPatch handler / onPatchRef.current capture. If we DON'T
        // see this log, the break is upstream in onTaskEditAsync.
        try { console.log('[NG] rawOnPatch firing', { taskId, startDate: nextStart, endDate: nextEnd, hasOnPatch: !!options.onPatch }); } catch (_e) { /* ok */ }
        rawOnPatch({ id: taskId, startDate: nextStart, endDate: nextEnd });
        // Permanent diag emit so future regressions on the happy-path
        // legacy branch don't go silent. Today's regression hid because
        // every code path on this branch ran without emitting anything.
        try { diag('edit:commit', { taskId, nextStart, nextEnd, via: 'rawOnPatch' }); } catch (_e) { /* ok */ }
        refreshGantt();
        return;
      }

      try {
        await options.onItemEdit(taskId, changes);
        const current = pendingEdits.get(taskId);
        if (!current || current.seq !== seq) return; // stale — newer owns state
        pendingEdits.delete(taskId);
        inflightTaskIds.delete(taskId);
        refreshGantt();
      } catch (err) {
        const current = pendingEdits.get(taskId);
        if (!current || current.seq !== seq) return; // stale — newer decides
        const idxNow = allTasks.findIndex((t) => t.id === taskId);
        if (idxNow !== -1) {
          allTasks[idxNow] = { ...allTasks[idxNow], startDate: origStart, endDate: origEnd };
        }
        pendingEdits.delete(taskId);
        inflightTaskIds.delete(taskId);
        refreshGantt();
        try {
          options.onItemEditError?.(
            taskId,
            err instanceof Error ? err : new Error(String(err)),
          );
        } catch (_e) { /* swallow host-handler throws */ }
      }
    }

    /* IM-4 (0.183) — Async drag-to-reprioritize with revert.
     *
     * Same seq/in-flight/revert primitive as onTaskEditAsync, but for
     * parent + sortOrder (+ priorityGroup) changes fired by dragReparent.
     * Triggered via interceptedOnPatch below — which routes date patches
     * to the legacy onTaskPatch and structural patches here.
     *
     * Originals captured on first edit in a chain (shared with any later
     * reorder of the same task) so revert restores truly-persisted state,
     * not a prior in-flight optimistic value. */
    /** Local seq-tracking entry for the 0.183 in-flight async reorder
     *  path. Renamed in 0.185 for naming consistency with EditSeqEntry. */
    interface ReorderSeqEntry {
      seq: number;
      origParentId: string | null | undefined;
      origSortOrder: number | undefined;
      origPriorityGroup: string | null | undefined;
    }
    const pendingReorders = new Map<string, ReorderSeqEntry>();
    let nextReorderSeq = 0;

    async function onTaskReorderAsync(patch: TaskPatch): Promise<void> {
      const taskId = patch.id;
      const idx = allTasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        // 0.185 — batchMode + divergence: same skip-with-warn semantics as
        // onTaskEditAsync. Can't buffer without an allTasks entry.
        if (options.batchMode) {
          try { diag('warn:task-not-in-allTasks', { taskId, origin: 'reorder-batch', patch }); } catch (_e) { /* ok */ }
          return;
        }
        // 0.183.2 — divergence path mirror of onTaskEditAsync. Host still
        // needs to hear the reorder event even when allTasks diverges from
        // engine state. Skip the optimistic update + revert (no originals)
        // but fire options.onItemReorder with the best-effort payload OR
        // fall back to rawOnPatch so legacy consumers keep working.
        try { diag('warn:task-not-in-allTasks', { taskId, origin: 'reorder', patch }); } catch (_e) { /* ok */ }
        try {
          if (options.onItemReorder) {
            const newIndex = typeof patch.sortOrder === 'number' ? patch.sortOrder : 0;
            const reorderPayload: {
              newIndex: number;
              newParentId?: string | null;
              newPriorityGroup?: string;
            } = { newIndex };
            if (patch.parentId !== undefined) reorderPayload.newParentId = patch.parentId;
            if (patch.priorityGroup !== undefined) reorderPayload.newPriorityGroup = patch.priorityGroup;
            await options.onItemReorder(taskId, reorderPayload);
          } else {
            rawOnPatch(patch);
          }
        } catch (err) {
          try {
            options.onItemReorderError?.(
              taskId,
              err instanceof Error ? err : new Error(String(err)),
            );
          } catch (_e) { /* swallow */ }
        }
        return;
      }

      // 0.185 — batchMode happy path: buffer the reorder instead of forwarding
      // to host. Self-contained — skips the seq-tracking + dispatch +
      // onItemReorder chain entirely. Same dispatch-skip rationale as
      // onTaskEditAsync's batch path.
      if (options.batchMode) {
        const origTaskB = allTasks[idx];
        const u: NormalizedTask = { ...origTaskB };
        if (patch.parentId      !== undefined) u.parentWorkItemId = patch.parentId;
        if (patch.priorityGroup !== undefined) u.priorityGroup    = patch.priorityGroup;
        if (patch.sortOrder     !== undefined) u.sortOrder        = patch.sortOrder;
        allTasks[idx] = u;
        const titleB = origTaskB.title || (origTaskB.name as string) || taskId;
        const partsB: string[] = [];
        if (patch.priorityGroup) partsB.push('→ ' + patch.priorityGroup);
        if (patch.parentId !== undefined) partsB.push('parent ' + (patch.parentId || 'none'));
        if (patch.sortOrder !== undefined) partsB.push('reordered');
        patchLog.unshift({ ts: new Date(), desc: titleB + ': ' + partsB.join(', ') + ' (pending)' });
        if (patchLog.length > 50) patchLog.pop();
        const reorderDelta: { priorityGroup?: string; sortOrder?: number; parentId?: string | null } = {};
        if (patch.priorityGroup !== undefined) reorderDelta.priorityGroup = patch.priorityGroup;
        if (patch.sortOrder !== undefined) reorderDelta.sortOrder = patch.sortOrder;
        if (patch.parentId !== undefined) reorderDelta.parentId = patch.parentId;
        bufferEdit(taskId, 'reorder', reorderDelta as Record<string, unknown>, {
          priorityGroup: origTaskB.priorityGroup ?? undefined,
          sortOrder: origTaskB.sortOrder,
          parentId: origTaskB.parentWorkItemId ?? null,
        });
        dirtyTaskIds.add(taskId);
        syncPendingChanges();
        refreshGantt();
        return;
      }

      const existing = pendingReorders.get(taskId);
      const origTask = allTasks[idx];
      const origParentId      = existing ? existing.origParentId      : origTask.parentWorkItemId;
      const origSortOrder     = existing ? existing.origSortOrder     : origTask.sortOrder;
      const origPriorityGroup = existing ? existing.origPriorityGroup : origTask.priorityGroup;

      const seq = ++nextReorderSeq;
      pendingReorders.set(taskId, { seq, origParentId, origSortOrder, origPriorityGroup });
      // Reuse the edit-path inflight set so dim rendering stays consistent —
      // a task can only be in one async flow at a time from the user's POV.
      inflightTaskIds.add(taskId);

      // Optimistic update (dragReparent has already repainted the row in
      // its new position on the grid side; this keeps allTasks in sync so
      // the canvas refresh reflects the new ordering too).
      const u: NormalizedTask = { ...origTask };
      if (patch.parentId      !== undefined) u.parentWorkItemId = patch.parentId;
      if (patch.priorityGroup !== undefined) u.priorityGroup    = patch.priorityGroup;
      if (patch.sortOrder     !== undefined) u.sortOrder        = patch.sortOrder;
      allTasks[idx] = u;

      const title = origTask.title || (origTask.name as string) || taskId;
      const logParts: string[] = [];
      if (patch.priorityGroup) logParts.push('→ ' + patch.priorityGroup);
      if (patch.parentId !== undefined) logParts.push('parent ' + (patch.parentId || 'none'));
      if (patch.sortOrder !== undefined) logParts.push('reordered');
      patchLog.unshift({ ts: new Date(), desc: title + ': ' + logParts.join(', ') });
      if (patchLog.length > 50) patchLog.pop();
      dispatch({ type: 'PATCH', patch });
      refreshGantt();

      if (!options.onItemReorder) {
        // Legacy: no async contract — fire rawOnPatch and clear in-flight.
        inflightTaskIds.delete(taskId);
        pendingReorders.delete(taskId);
        rawOnPatch(patch);
        refreshGantt();
        return;
      }

      try {
        // 0.183.1 — payload carries all three fields the coalesced patch
        // collected (sortOrder, parentId, priorityGroup). newIndex always
        // present (dragReparent always dispatches sortOrder). newParentId
        // and newPriorityGroup are optional — omitted when the drop
        // didn't change those axes. DH's handler ignores fields it
        // doesn't care about.
        const newIndex = typeof patch.sortOrder === 'number' ? patch.sortOrder : 0;
        const reorderPayload: {
          newIndex: number;
          newParentId?: string | null;
          newPriorityGroup?: string;
        } = { newIndex };
        if (patch.parentId !== undefined) reorderPayload.newParentId = patch.parentId;
        if (patch.priorityGroup !== undefined) reorderPayload.newPriorityGroup = patch.priorityGroup;
        await options.onItemReorder(taskId, reorderPayload);
        const current = pendingReorders.get(taskId);
        if (!current || current.seq !== seq) return; // stale
        pendingReorders.delete(taskId);
        inflightTaskIds.delete(taskId);
        refreshGantt();
      } catch (err) {
        const current = pendingReorders.get(taskId);
        if (!current || current.seq !== seq) return; // stale
        const idxNow = allTasks.findIndex((t) => t.id === taskId);
        if (idxNow !== -1) {
          const rev: NormalizedTask = { ...allTasks[idxNow] };
          rev.parentWorkItemId = origParentId ?? null;
          if (origSortOrder !== undefined) rev.sortOrder = origSortOrder;
          rev.priorityGroup = origPriorityGroup ?? null;
          allTasks[idxNow] = rev;
        }
        pendingReorders.delete(taskId);
        inflightTaskIds.delete(taskId);
        refreshGantt();
        try {
          options.onItemReorderError?.(
            taskId,
            err instanceof Error ? err : new Error(String(err)),
          );
        } catch (_e) { /* swallow */ }
      }
    }

    /** Route structural patches (parent / sortOrder / priorityGroup) through
     *  the IM-4 async path when `onItemReorder` is wired; date-only patches
     *  continue to land on legacy onTaskPatch (IM-1/2/3 date patches take
     *  the dedicated onTaskEditAsync branch inside the engine Ctor bindings,
     *  so they never reach this interceptor).
     *
     *  0.183.1 — dragReparent fires up to 3 structural patches per drop
     *  (priorityGroup, parentId, sortOrder) in the same tick. We coalesce
     *  them per-taskId via a microtask flush so `onItemReorder` receives
     *  one merged `{ newIndex, newParentId?, newPriorityGroup? }` payload
     *  per drop instead of 3 racing async calls (which would each pick up
     *  a different seq and trip the stale-settle guard).
     */
    const _reorderBuffer = new Map<string, TaskPatch>();
    let _reorderFlushScheduled = false;
    function flushReorderBuffer(): void {
      _reorderFlushScheduled = false;
      const merged = Array.from(_reorderBuffer.values());
      _reorderBuffer.clear();
      merged.forEach((p) => onTaskReorderAsync(p));
    }
    function interceptedOnPatch(patch: TaskPatch): void {
      // 0.185.23 — removed the direction-unaware collision-breaker from
      // 0.185.21. It nudged UP (+epsilon) unconditionally, which flipped
      // the visual outcome for UP-moves (task meant to land ABOVE target
      // ended up BELOW target after the nudge). Callers (dragReparent +
      // onBarReorderDrag) now produce distinct-bounded values directly so
      // central breaking isn't needed. If edge cases produce collisions
      // at the emit layer, the caller's own math is at fault and should
      // be fixed there with access to drop-direction intent.
      const hasStructural =
        patch.parentId !== undefined ||
        patch.priorityGroup !== undefined ||
        patch.sortOrder !== undefined;
      const hasDates =
        patch.startDate !== undefined || patch.endDate !== undefined;
      if (hasStructural && !hasDates) {
        const prev = _reorderBuffer.get(patch.id);
        _reorderBuffer.set(patch.id, prev ? { ...prev, ...patch } : { ...patch });
        if (!_reorderFlushScheduled) {
          _reorderFlushScheduled = true;
          Promise.resolve().then(flushReorderBuffer);
        }
      } else {
        onTaskPatch(patch);
      }
    }

    function onTaskPatch(patch: TaskPatch): void {
      // Apply optimistic update locally (mirrors v5 behaviour)
      const idx = allTasks.findIndex(t => t.id === patch.id);
      if (idx !== -1) {
        const t = allTasks[idx];
        const u: NormalizedTask = { ...t };
        if (patch.priorityGroup !== undefined) u.priorityGroup = patch.priorityGroup;
        if (patch.sortOrder     !== undefined) u.sortOrder = patch.sortOrder;
        if ('parentId' in patch)               u.parentWorkItemId = patch.parentId ?? null;
        if (patch.startDate     !== undefined) u.startDate = patch.startDate;
        if (patch.endDate       !== undefined) u.endDate = patch.endDate;
        allTasks[idx] = u;
      }
      // Log entry
      const task = allTasks.find(t => t.id === patch.id);
      const title = (task && (task.title || task.name)) || String(patch.id);
      const parts: string[] = [];
      if (patch.priorityGroup) parts.push('→ ' + patch.priorityGroup);
      if (patch.parentId !== undefined) parts.push('parent ' + (patch.parentId || 'none'));
      if (patch.sortOrder !== undefined) parts.push('reordered');
      if (patch.startDate || patch.endDate) parts.push('dates updated');
      if (parts.length) {
        patchLog.unshift({ ts: new Date(), desc: title + ': ' + parts.join(', ') });
        if (patchLog.length > 50) patchLog.pop();
      }
      // NOTE (2026-04-18 regression fix): removed `dispatch({ type: 'PATCH', patch })`
      // here. `dispatch` intercepts PATCH events and routes them back to
      // onTaskPatch(ev.patch), which creates infinite mutual recursion:
      //   onTaskPatch -> dispatch({PATCH}) -> onTaskPatch -> dispatch({PATCH}) -> ...
      // -> RangeError: Maximum call stack size exceeded, swallowed by the
      // try/catch in onTaskEditAsync, nothing persists. Introduced in a49a130.
      // The reducer has no PATCH case, so the removed call was pure recursion.
      rawOnPatch(patch);
      if (_patchRefreshTimer.t) clearTimeout(_patchRefreshTimer.t);
      _patchRefreshTimer.t = setTimeout(() => { _patchRefreshTimer.t = null; refreshGantt(); }, 50);
    }

    function dispatch(ev: AppEvent): void {
      // Slot-dispatched PATCH (e.g. DetailPanel Save button) needs to flow
      // to the consumer's onPatch callback — same surface drag/resize use
      // via onTaskPatch(). Without this, Save would bump pendingPatchCount
      // but never persist. We route through onTaskPatch so optimistic
      // update + refresh happens uniformly.
      if (ev.type === 'PATCH') {
        onTaskPatch(ev.patch);
        return;
      }
      const nextState = reduceAppState(state, ev);
      const stateChanged = nextState !== state;
      state = nextState;
      if (stateChanged) {
        // Apply fullscreen class to host container — escapes Salesforce chrome.
        if (state.fullscreen) container.classList.add('nga-fullscreen');
        else container.classList.remove('nga-fullscreen');
        // 0.185.8 — reconcile feature overrides onto tplConfig.features before
        // anything downstream reads them. State owns the override; tplConfig
        // owns the defaults. On every state change we recompute the live
        // value so renderSlots + rebuildView pick up toggles from the Admin
        // panel without needing to thread state.featureOverrides through
        // every call site.
        reconcileFeatureOverrides();
        renderSlots();
        // Re-render the gantt/view content if the view changed OR if a
        // feature toggle changed a column-affecting flag (hoursColumn,
        // budgetUsedColumn, headerRowCompletionBar).
        const viewChangingEvents = ['SET_VIEW','SET_GROUP_BY','SET_FILTER','SET_SEARCH','TOGGLE_HIDE_COMPLETED'];
        if (viewChangingEvents.indexOf(ev.type) >= 0) {
          rebuildView();
        } else if (ev.type === 'TOGGLE_FEATURE') {
          // Column-affecting feature toggles require a rebuild; slot-visibility
          // toggles are handled by renderSlots alone. Rebuild unconditionally
          // — cheap relative to the user-initiated gesture and safe.
          rebuildView();
        } else if (ev.type === 'SET_ZOOM') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (ganttInst && typeof (ganttInst as any).setZoom === 'function') (ganttInst as any).setZoom(state.zoom);
          // IM-7 (0.183) — zoom changes aren't always paired with scroll
          // events, so emit here directly. Debounced inside emitViewport.
          emitViewport();
        }
      }
    }

    // 0.185.8 — snapshot of tplConfig.features at mount time; overrides
    // are applied on top of this snapshot so un-checking then re-checking
    // a toggle restores the original default value rather than whatever
    // tplConfig.features held a tick ago.
    const FEATURE_DEFAULTS: Record<string, boolean | undefined> = {};
    function snapshotFeatureDefaults(): void {
      const f = tplConfig.features as unknown as Record<string, boolean | undefined>;
      for (const k of Object.keys(f)) FEATURE_DEFAULTS[k] = f[k];
    }
    function reconcileFeatureOverrides(): void {
      const f = tplConfig.features as unknown as Record<string, boolean | undefined>;
      for (const k of Object.keys(FEATURE_DEFAULTS)) {
        const override = state.featureOverrides[k];
        f[k] = override === undefined ? FEATURE_DEFAULTS[k] : override;
      }
    }

    function buildSlotData(): SlotData {
      const stats = computeStats(applyFilter(allTasks, state.filter as 'active', state.search));
      const visibleTasks = buildTasks(applyFilter(allTasks, state.filter as 'active', state.search));
      return { tasks: allTasks, visibleTasks, stats, patchLog: patchLog.slice() };
    }

    function currentProps(): SlotProps {
      return { config: tplConfig, state, dispatch, data: buildSlotData() };
    }

    /* ── Slot mount (template-driven chrome) ────────────────────────── */
    const slotInstances = new Map<string, VanillaSlotInstance>();
    let ganttHost: HTMLElement | null = null;

    function renderSlots(): void {
      const props = currentProps();
      // Remove any children in render-order & reconstruct
      SLOT_ORDER.forEach((slotName) => {
        const enabled = shouldRenderSlot(slotName, tplConfig.features);
        const existing = slotInstances.get(slotName);
        const slotDef = tplConfig.components[slotName];

        if (!enabled) {
          if (existing) {
            existing.destroy();
            slotInstances.delete(slotName);
          }
          return;
        }

        const factory = slotDef && slotDef.vanilla;
        if (!factory) {
          if (existing) { existing.destroy(); slotInstances.delete(slotName); }
          return;
        }

        if (existing) {
          existing.update(props);
        } else {
          const inst = factory(props);
          slotInstances.set(slotName, inst);
          container.appendChild(inst.el);
        }
      });

      // CH-1 (0.183) — after any destroy/recreate cycle (e.g. toggleChrome),
      // re-append each mounted slot in SLOT_ORDER so DOM order matches the
      // declared layout. appendChild on an already-attached node moves it to
      // the end; doing this in SLOT_ORDER gives us the correct final order
      // without special-casing "was this slot just created?". Cheap —
      // browsers optimise node re-insertion at the same level.
      SLOT_ORDER.forEach((slotName) => {
        const inst = slotInstances.get(slotName);
        if (inst && inst.el.parentNode === container) {
          container.appendChild(inst.el);
        }
      });

      // Re-bind the gantt host (ContentArea slot's inner [data-nga-gantt-host])
      const contentInst = slotInstances.get('ContentArea');
      if (contentInst) {
        ganttHost = contentInst.el.querySelector<HTMLElement>('[data-nga-gantt-host="1"]');
      }

      // 0.185.8 — Admin / Advisor floating panels. Render inline here so
      // they live in the same root as other chrome and participate in
      // the same destroy/rebuild cycle. Both respect state.adminOpen /
      // state.advisorOpen. Advisor is an honest "coming soon" body until
      // Claude-API infrastructure is scoped.
      renderAdminPanel(container, state, dispatch, tplConfig);
      renderAdvisorPanel(container, state, dispatch);
    }

    /* ── Gantt engine mount ─────────────────────────────────────────── */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ganttInst: any = null;
    let cleanupShading: (() => void) | null = null;
    let cleanupDrag:    (() => void) | null = null;
    let depthMap = buildDepthMap(allTasks);
    // 0.185.32 — coordinate-based hit-test, populated by initGantt and
    // called from the public handle's taskAt(). Null when the engine
    // hasn't mounted yet (e.g., taskAt called before mount settles).
    let chromeTaskAt: ((x: number, y: number) => NormalizedTask | null) | null = null;

    function resolveEngine(): NimbusGanttEngine | null {
      if (options.engine) return options.engine;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (w && w.NimbusGantt) return w.NimbusGantt as NimbusGanttEngine;
      return null;
    }

    function initGantt(host: HTMLElement): void {
      const eng = resolveEngine();
      if (!eng || !eng.NimbusGantt) {
        host.style.cssText = 'padding:20px;color:#b91c1c;font-size:13px';
        host.textContent = 'nimbus-gantt engine not loaded';
        return;
      }
      const Ctor = eng.NimbusGantt;
      const PGP  = eng.PriorityGroupingPlugin;
      const hwp  = eng.hoursWeightedProgress;

      const filtered = applyFilter(allTasks, state.filter as 'active', state.search);
      const maybeHide = state.hideCompleted
        ? filtered.filter((t) => !DONE_STAGES[t.stage || ''])
        : filtered;
      const gtasks = state.groupBy === 'epic'
        ? buildTasks(buildTasksEpic(maybeHide))
        : buildTasks(maybeHide);

      const ganttEl = document.createElement('div');
      ganttEl.style.cssText = 'height:100%;width:100%;position:absolute;inset:0';
      host.innerHTML = '';
      host.appendChild(ganttEl);

      // Declared before the Ctor call so the engine's onHover callback can
      // update it (single source of truth shared with the DOM grid-row +
      // contextmenu listeners added below).
      let lastHoveredTaskId: string | null = null;

      ganttInst = new Ctor(ganttEl, {
        tasks: gtasks, dependencies: allDependencies, columns: buildGanttCols(tplConfig.features), theme: V3_THEME,
        rowHeight: 32, barHeight: 20, headerHeight: 32, gridWidth: 295,
        zoomLevel: state.zoom, showToday: true, showWeekends: true, showProgress: true,
        colorMap: options.config?.colorMap || { ...STAGE_COLORS, ...STAGE_TO_CATEGORY_COLOR },
        readOnly: false,
        onTaskClick:  (task: { id: string }) => {
          if (!task || !task.id || isBucketId(task.id)) return;
          dispatch({ type: 'TOGGLE_DETAIL', taskId: task.id });
          const t = allTasks.find((x) => x.id === task.id);
          if (t) options.onTaskClick?.(t, 'canvas');
          // IM-5 (0.183) — id-only click alias for hosts that prefer the new
          // taskId-first contract over the legacy NormalizedTask signature.
          options.onItemClick?.(task.id);
        },
        onTaskDblClick: (task: { id: string }) => {
          if (!task || !task.id || isBucketId(task.id)) return;
          // Phase 3: dblclick opens the DetailPanel directly in edit mode
          // (v5 parity — `openPanel(item, true)`). The reducer's TOGGLE_DETAIL
          // honours the editMode payload. Single-click still uses the view
          // mode path (onTaskClick above). Consumer callback fires after as
          // a notification (analytics, side effects) — not a control path.
          dispatch({ type: 'TOGGLE_DETAIL', taskId: task.id, editMode: true });
          const t = allTasks.find((x) => x.id === task.id);
          if (t) options.onTaskDoubleClick?.(t);
        },
        // Canvas-bar hover — engine fires onHover on pointermove hits.
        // Coalesce so identical-id sequential fires are a no-op, and keep
        // lastHoveredTaskId in sync with the DOM grid-row path (set below)
        // so right-click on a canvas bar resolves correctly.
        onHover: (task: { id?: string } | null) => {
          const id = task?.id && !isBucketId(task.id) ? task.id : null;
          if (id === lastHoveredTaskId) return;
          lastHoveredTaskId = id;
          options.onTaskHover?.(id);
        },
        onTaskMove: (task: { id: string }, s: string, e: string) => {
          // 0.183.3-diag — engine→main-path arrival probe.
          try { console.log('[NG] main onTaskMove received', task?.id, s, e); } catch (_e) { /* ok */ }
          if (!task || !task.id || isBucketId(task.id)) return;
          // IM-1 (0.183) — drag whole bar: both start + end shifted.
          onTaskEditAsync(task.id, s, e, { startDate: s, endDate: e });
        },
        onTaskResize: (task: { id: string }, s: string, e: string) => {
          // 0.183.3-diag — engine→main-path arrival probe (resize variant).
          try { console.log('[NG] main onTaskResize received', task?.id, s, e); } catch (_e) { /* ok */ }
          if (!task || !task.id || isBucketId(task.id)) return;
          // IM-2/3 (0.183) — edge drag: diff against the pre-edit task so
          // `changes` carries only the moved field (left-edge → start only,
          // right-edge → end only). Minimum-delta payload for the host.
          const orig = allTasks.find((t) => t.id === task.id);
          const changes: { startDate?: string; endDate?: string } = {};
          if (!orig || orig.startDate !== s) changes.startDate = s;
          if (!orig || orig.endDate !== e) changes.endDate = e;
          onTaskEditAsync(task.id, s, e, changes);
        },
        // 0.185.16 — canvas bar vertical-drag reprioritize. Getter reads
        // the live feature flag (via tplConfig.features.enableDragBarToReprioritize
        // which is already reconciled by reconcileFeatureOverrides each
        // state change). Callback resolves target row → newSortOrder +
        // optional newPriorityGroup, then routes through the existing
        // onItemReorder chain so DH's handler receives the same payload
        // shape as the sidebar reorder path.
        isBarReprioritizeEnabled: () => !!tplConfig.features.enableDragBarToReprioritize,
        onBarReorderDrag: (task: { id: string }, targetTaskId: string | null, targetRowIndex: number, targetBucketId?: string | null) => {
          try { console.log('[NG] main onBarReorderDrag received', task?.id, '→ target=', targetTaskId, 'rowIdx=', targetRowIndex, 'bucket=', targetBucketId); } catch (_e) { /* ok */ }
          if (!task || !task.id || isBucketId(task.id)) return;
          const srcTask = allTasks.find((t) => t.id === task.id);
          if (!srcTask) return;
          const tgtTask = targetTaskId && !isBucketId(targetTaskId)
            ? allTasks.find((t) => t.id === targetTaskId)
            : null;

          // 0.185.19 — resolve target bucket. Priority:
          //   1. DragManager's targetBucketId (from preceding bucket-header
          //      layout) — present when the cursor is anywhere below a
          //      bucket header, including below the last task row.
          //   2. Target task's priorityGroup — fallback when no header
          //      precedes and the cursor landed directly on a task row.
          //   3. Source task's priorityGroup — final fallback (no bucket
          //      change, same-bucket reorder).
          const resolvedBucket = targetBucketId
            || (tgtTask && tgtTask.priorityGroup ? tgtTask.priorityGroup : null)
            || srcTask.priorityGroup
            || null;

          const patch: TaskPatch = { id: task.id };
          if (resolvedBucket && resolvedBucket !== srcTask.priorityGroup) {
            patch.priorityGroup = resolvedBucket;
          }

          // 0.185.19 — compute target sortOrder using proper "above/between/
          // below" zone logic within the resolved bucket. Get tasks in the
          // bucket sorted by sortOrder ASC; find the target's position in
          // that list; place adjacent using midpoint math.
          const bucketTasks = allTasks
            .filter((t) => t.priorityGroup === resolvedBucket && t.id !== task.id)
            .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));

          if (bucketTasks.length === 0) {
            // Empty bucket — any sortOrder works.
            patch.sortOrder = 1000;
          } else if (!tgtTask || !bucketTasks.find((t) => t.id === tgtTask.id)) {
            // Target is null (below last row) OR target task isn't in the
            // resolved bucket (cross-bucket drop where the resolved bucket
            // came from targetBucketId, not from target task). Default:
            // place at the BOTTOM of the resolved bucket (max + 1000).
            const maxSort = bucketTasks[bucketTasks.length - 1];
            patch.sortOrder = (Number(maxSort.sortOrder) || 0) + 1000;
          } else {
            // Target task is in the resolved bucket. Place the source
            // ADJACENT to the target: if source's current sortOrder is
            // less than target's, place below target (srcSort < tgtSort
            // means source appeared ABOVE target in the sorted list;
            // dropping means user wants source to be BELOW target now —
            // so new sortOrder = tgtSort + 500, then siblings keep their
            // order). Symmetric for the other direction.
            const tgtIdx = bucketTasks.findIndex((t) => t.id === tgtTask.id);
            const tgtSort = Number(tgtTask.sortOrder) || 0;
            const srcSort = Number(srcTask.sortOrder) || 0;
            const crossBucket = srcTask.priorityGroup !== resolvedBucket;
            if (crossBucket) {
              // Cross-bucket: insert above the target (take its place).
              // Compute midpoint between previous sibling and target.
              const prev = tgtIdx > 0 ? bucketTasks[tgtIdx - 1] : null;
              if (prev) {
                const prevSort = Number(prev.sortOrder) || 0;
                patch.sortOrder = (prevSort + tgtSort) / 2;
              } else {
                patch.sortOrder = tgtSort - 500;
              }
            } else {
              // Same-bucket: use srcSort vs tgtSort to decide direction.
              if (srcSort < tgtSort) {
                // Moving DOWN: insert between target and its next sibling
                // (or just below target if target is last).
                const next = tgtIdx < bucketTasks.length - 1 ? bucketTasks[tgtIdx + 1] : null;
                if (next) {
                  patch.sortOrder = (tgtSort + (Number(next.sortOrder) || 0)) / 2;
                } else {
                  patch.sortOrder = tgtSort + 500;
                }
              } else {
                // Moving UP: insert between target and its previous sibling
                // (or just above target if target is first).
                const prev = tgtIdx > 0 ? bucketTasks[tgtIdx - 1] : null;
                if (prev) {
                  patch.sortOrder = ((Number(prev.sortOrder) || 0) + tgtSort) / 2;
                } else {
                  patch.sortOrder = tgtSort - 500;
                }
              }
            }
          }
          // 0.185.21 — collision breaker is centralized in
          // interceptedOnPatch so all reorder paths (canvas vertical,
          // sidebar drag, list-view drag) share the same logic. Handler
          // computes the midpoint here; interceptedOnPatch nudges it off
          // any existing task's value before the flush.
          try {
            console.log('[NG bar-reorder] emitting',
              'src=', task.id, 'srcSort=', Number(srcTask.sortOrder) || 0,
              'srcBucket=', srcTask.priorityGroup,
              'target=', targetTaskId, 'targetBucket=', targetBucketId,
              'resolvedBucket=', resolvedBucket,
              'bucketTaskCount=', bucketTasks.length,
              '→ patch=', JSON.stringify(patch));
          } catch (_e) { /* ok */ }
          interceptedOnPatch(patch);
        },
      });

      /* DOM hover + contextmenu (same pattern as engineOnly path). Canvas-bar
       * hover is handled by the engine's onHover callback above; the DOM
       * grid-row mouseover below catches hover on the left-side tree cell.
       * Contextmenu silently no-ops in Salesforce Locker. */
      const findTaskById = (id: string | null): NormalizedTask | null =>
        id ? (allTasks.find((t) => t.id === id) ?? null) : null;
      const onMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        const row = target?.closest?.('.ng-grid-row[data-task-id]') as HTMLElement | null;
        const id = row?.getAttribute('data-task-id') ?? null;
        if (id && !isBucketId(id) && id !== lastHoveredTaskId) {
          lastHoveredTaskId = id;
          options.onTaskHover?.(id);
        }
      };
      const onMouseLeave = () => {
        if (lastHoveredTaskId !== null) {
          lastHoveredTaskId = null;
          options.onTaskHover?.(null);
        }
      };
      // 0.185.28 — shared resolver + pointerdown fallback (LEX/Locker
      // suppresses canvas contextmenu; pointerdown survives). See the
      // engineOnly sibling listener for the full rationale.
      // 0.185.32 — chrome-aware resolver. Shape mirrors engineOnly sibling.
      const resolveTaskAtChrome = (clientX: number, clientY: number, target: EventTarget | null): NormalizedTask | null => {
        const el = target as HTMLElement | null;
        const row = el?.closest?.('.ng-grid-row[data-task-id]') as HTMLElement | null;
        const rowId = row?.getAttribute('data-task-id') ?? null;
        let taskId = (rowId && !isBucketId(rowId)) ? rowId : lastHoveredTaskId;
        if (!taskId) {
          const hit = document.elementFromPoint?.(clientX, clientY) as HTMLElement | null;
          const hitRow = hit?.closest?.('[data-task-id]') as HTMLElement | null;
          const hitId = hitRow?.getAttribute('data-task-id');
          if (hitId && !isBucketId(hitId)) taskId = hitId;
        }
        return findTaskById(taskId);
      };
      // Expose on the app handle via closure — the return block below reads
      // `chromeTaskAt` rather than recomputing the resolver there.
      chromeTaskAt = (x: number, y: number) => resolveTaskAtChrome(x, y, null);
      const fireCtxMenu = (clientX: number, clientY: number, target: EventTarget | null): boolean => {
        if (!options.onTaskContextMenu) return false;
        const t = resolveTaskAtChrome(clientX, clientY, target);
        if (!t) return false;
        options.onTaskContextMenu(t, { x: clientX, y: clientY });
        return true;
      };
      const onContextMenu = (e: MouseEvent) => {
        if (fireCtxMenu(e.clientX, e.clientY, e.target)) e.preventDefault();
      };
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 2) return;
        if (fireCtxMenu(e.clientX, e.clientY, e.target)) e.preventDefault();
      };
      ganttEl.addEventListener('mouseover', onMouseOver);
      ganttEl.addEventListener('mouseleave', onMouseLeave);
      ganttEl.addEventListener('contextmenu', onContextMenu);
      ganttEl.addEventListener('pointerdown', onPointerDown);
      // Attach cleanup — reuse cleanupDrag slot indirectly by stacking:
      const prevCleanupDrag = cleanupDrag;
      cleanupDrag = () => {
        ganttEl.removeEventListener('mouseover', onMouseOver);
        ganttEl.removeEventListener('mouseleave', onMouseLeave);
        ganttEl.removeEventListener('contextmenu', onContextMenu);
        ganttEl.removeEventListener('pointerdown', onPointerDown);
        if (prevCleanupDrag) prevCleanupDrag();
      };

      if (typeof PGP === 'function') {
        const pluginBuckets = tplConfig.buckets;
        // DM-5 (0.183) — when headerRowCompletionBar is explicitly false,
        // feed the plugin a zero-progress function so the header bar
        // renders without the fill overlay. The row itself still shows
        // (label + color). When on, use hoursWeightedProgress from the
        // engine bundle (falls back to arithmetic-mean inside the plugin
        // when absent).
        const bucketProgressFn = tplConfig.features.headerRowCompletionBar === false
          ? () => 0
          : (typeof hwp === 'function' ? hwp : undefined);
        ganttInst.use(PGP({
          buckets: pluginBuckets,
          getBucket: (task: { groupId?: string | null }) => task.groupId || null,
          getBucketProgress: bucketProgressFn,
        }));
      }

      ganttInst.setData(gtasks, allDependencies);
      try { ganttInst.expandAll(); } catch (_e) { /* ok */ void 0; }

      // Initial viewport positioning.
      //
      // 0.185.1 — three-way priority (most specific wins):
      //   1. options.initialViewport.scrollLeft (explicit pixels)
      //   2. options.initialFocusDate (semantic — library snaps to zoom period
      //      then computes pixels via timeScale.dateToX)
      //   3. today-14d default (v9-parity fallback)
      setTimeout(() => {
        try {
          const gi = ganttInst as {
            timeScale?: { dateToX?: (d: Date) => number };
            scrollManager?: {
              scrollToX?: (x: number) => void;
              scrollToY?: (y: number) => void;
              setScrollPosition?: (x: number, y: number) => void;
            };
          };
          const iv = options.initialViewport;
          if (iv && (typeof iv.scrollLeft === 'number' || typeof iv.scrollTop === 'number')) {
            const x = typeof iv.scrollLeft === 'number' ? Math.max(0, iv.scrollLeft) : 0;
            const y = typeof iv.scrollTop === 'number' ? Math.max(0, iv.scrollTop) : 0;
            if (typeof gi.scrollManager?.setScrollPosition === 'function') {
              gi.scrollManager.setScrollPosition(x, y);
            } else {
              gi.scrollManager?.scrollToX?.(x);
              gi.scrollManager?.scrollToY?.(y);
            }
          } else if (options.initialFocusDate) {
            const parsed = parseFocusDate(options.initialFocusDate);
            if (parsed) {
              const snapped = snapDateToZoomPeriod(parsed, state.zoom);
              const x = gi.timeScale?.dateToX?.(snapped);
              if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
            }
          } else {
            const x = gi.timeScale?.dateToX?.(new Date(Date.now() - INITIAL_VIEWPORT_OFFSET_MS));
            if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
          }
        } catch (_e) { /* ok */ void 0; }
      }, 50);

      if (cleanupShading) cleanupShading();
      if (cleanupDrag)    cleanupDrag();
      if (tplConfig.features.depthShading) cleanupShading = startDepthShading(ganttEl, depthMap);
      // IM-4 (0.183) — route through interceptedOnPatch so structural
      // patches (parent / sortOrder / priorityGroup) go through the async
      // onItemReorder contract when wired. Date-only patches still land
      // on legacy onTaskPatch.
      if (tplConfig.features.dragReparent) cleanupDrag    = startDragReparent(ganttEl, allTasks, depthMap, interceptedOnPatch, () => !!tplConfig.features.enableDragReparent);

      /* IM-7 (0.183) — scroll emission. Attach AFTER the dragReparent
       * cleanup is assigned so the scroll-listener cleanup chains onto
       * the final cleanupDrag (which fires on unmount). The engine's
       * ScrollManager wraps the canvas in `.ng-scroll-wrapper`
       * (overflow:auto). Scroll events don't bubble, so we listen
       * directly on the wrapper. Debounce lives inside emitViewport. */
      if (options.onViewportChange) {
        try {
          const wrapper = ganttEl.querySelector<HTMLElement>('.ng-scroll-wrapper');
          if (wrapper) {
            const onScroll = () => emitViewport();
            wrapper.addEventListener('scroll', onScroll, { passive: true });
            const prevCleanupDrag2 = cleanupDrag;
            cleanupDrag = () => {
              wrapper.removeEventListener('scroll', onScroll);
              if (prevCleanupDrag2) prevCleanupDrag2();
            };
          }
        } catch (_e) { /* ok */ void 0; }
      }
    }

    function refreshGantt(): void {
      if (!ganttHost) return;
      if (state.viewMode === 'gantt' && ganttInst) {
        const filtered = applyFilter(allTasks, state.filter as 'active', state.search);
        const maybeHide = state.hideCompleted
          ? filtered.filter((t) => !DONE_STAGES[t.stage || ''])
          : filtered;
        let gtasks = state.groupBy === 'epic'
          ? buildTasks(buildTasksEpic(maybeHide))
          : buildTasks(maybeHide);
        // IM-1/2/3 (0.183) — in-flight visual. Bars whose edit is awaiting
        // the host's onItemEdit promise render with a dimmed color until the
        // promise settles. Cheap — only runs when at least one edit is in
        // flight, and alpha-byte append preserves the canvas fast-path.
        // 0.185 — also dim bars sitting in the batchMode buffer (dirty).
        // Same visual treatment, single-pass through gtasks.
        if (inflightTaskIds.size > 0 || dirtyTaskIds.size > 0) {
          gtasks = gtasks.map((t) => (inflightTaskIds.has(t.id) || dirtyTaskIds.has(t.id))
            ? { ...t, color: dimColor(t.color) }
            : t);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gi = ganttInst as any;
        if (typeof gi.setData === 'function') {
          gi.setData(gtasks, allDependencies);
          try { gi.expandAll(); } catch (_e) { /* ok */ void 0; }
        }
      } else {
        rebuildView();
      }
      // Re-render chrome too so stats update
      renderSlots();
    }

    function rebuildView(): void {
      if (!ganttHost) return;
      if (cleanupShading) { cleanupShading(); cleanupShading = null; }
      if (cleanupDrag)    { cleanupDrag();    cleanupDrag = null; }
      if (ganttInst) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        try { (ganttInst as any).destroy(); } catch (_e) { /* ok */ void 0; }
        ganttInst = null;
      }
      ganttHost.innerHTML = '';
      // A1 stage-1 (0.182): Gantt and List have real renderers. Other
      // view-mode pills (Treemap/Bubbles/Calendar/Flow) route through
      // renderComingSoon — honest placeholder, full ports in 0.183.
      if (state.viewMode === 'gantt') {
        initGantt(ganttHost);
      } else if (state.viewMode === 'list') {
        // AuditListView v0 — vanilla port of v9's AuditListView.tsx core.
        // Filters by audit field presence (owner/dates/hours), groups by
        // priority bucket, supports search + sort + section collapse.
        // Drag-to-reorder + edit/add/merge/export/submit defer to 0.183.
        renderAuditListView(ganttHost, allTasks, {
          progressLabel: tplConfig.progressLabel,
          hideRecordIds: tplConfig.hideRecordIds,
          // 0.185.5 — forward the host's onItemReorder contract so the
          // list-view 3-dot handle persists drops through the same path
          // the gantt sidebar uses.
          onReorder: options.onItemReorder
            ? (taskId, payload) => { void options.onItemReorder!(taskId, payload); }
            : undefined,
        });
      } else if (state.viewMode === 'treemap' || state.viewMode === 'bubbles') {
        // 0.185.7 — wire the treemap + bubble canvas renderers that have
        // been sitting unreferenced in packages/app/src/renderers/. Each
        // gets a sized canvas matching the host, DPI-scaled for crispness
        // on retina displays. Re-runs on every state change that reaches
        // rebuildView — no animation loop needed for static views.
        mountAltCanvasView(
          ganttHost,
          allTasks,
          state.viewMode === 'treemap' ? renderTreemap : renderBubble,
          options.config?.colorMap || { ...STAGE_COLORS, ...STAGE_TO_CATEGORY_COLOR },
        );
      } else {
        const labelMap: Record<string, string> = {
          calendar: 'Calendar', flow: 'Flow',
        };
        renderComingSoon(ganttHost, labelMap[state.viewMode] || state.viewMode);
      }
      renderSlots();
    }

    /* ── First render ───────────────────────────────────────────────── */
    // 0.185.8 — capture feature defaults before any user-driven override
    // could land so reconcileFeatureOverrides has a stable baseline.
    snapshotFeatureDefaults();
    renderSlots();
    try {
      const renderedSlots: string[] = [];
      slotInstances.forEach((_inst, name) => renderedSlots.push(name));
      diag('mount:slots-rendered', {
        slotOrder: SLOT_ORDER,
        rendered: renderedSlots,
        features: tplConfig.features,
      });
    } catch (_e) { /* diag never throws */ }
    if (ganttHost) initGantt(ganttHost);

    /* ── Post-mount layout + canvas diagnostics ─────────────────────── */
    // Defer one animation frame so browser layout has settled. Gives Cowork
    // real measured heights rather than pre-layout zeros.
    try {
      const raf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 16) as unknown as number;
      raf(() => {
        try {
          const measure = (sel: string): number => {
            const elSel = container.querySelector<HTMLElement>(sel);
            return elSel ? Math.round(elSel.getBoundingClientRect().height) : 0;
          };
          diag('mount:chrome-heights', {
            root:        Math.round(container.getBoundingClientRect().height),
            titlebar:    measure('.nga-titlebar'),
            stats:       measure('.nga-stats'),
            filterbar:   measure('.nga-filterbar'),
            zoombar:     measure('.nga-zoombar'),
            audit:       measure('.nga-audit'),
            hrswkstrip:  measure('.nga-hrswkstrip'),
            contentOuter: measure('.nga-content-outer'),
            content:     measure('.nga-content'),
          });
          const canvasEl = container.querySelector<HTMLCanvasElement>('canvas');
          if (canvasEl) {
            diag('mount:init-gantt', {
              canvasW:   canvasEl.width,
              canvasH:   canvasEl.height,
              cssW:      Math.round(canvasEl.getBoundingClientRect().width),
              cssH:      Math.round(canvasEl.getBoundingClientRect().height),
            });
            if (canvasEl.height < 64) {
              diag('warn:zero-height', { surface: 'canvas', canvasH: canvasEl.height });
            }
          } else {
            diag('warn:no-canvas', {});
          }
          const durationMs = ((typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now()) - mountStartedAt;
          diag('mount:complete', {
            taskCount: allTasks.length,
            durationMs: Math.round(durationMs),
          });
        } catch (err) {
          diag('err:post-mount', { message: (err as Error)?.message || String(err) });
        }
      });
    } catch (_e) { /* ignore — diag is best-effort */ }

    /* ── Embedded-mode fullscreen button ────────────────────────────── */
    // Renders a single floating "↗ Full Screen" button top-right of the
    // container. Library does NOT navigate — it just invokes the callback.
    let cleanupEmbeddedBtn: (() => void) | null = null;
    if (mode === 'embedded' && options.onEnterFullscreen) {
      cleanupEmbeddedBtn = renderEmbeddedFullscreenButton(
        container,
        () => options.onEnterFullscreen?.(),
      );
    }

    /* ── Registry + AppInstance ─────────────────────────────────────── */
    // 0.185.10 — re-render slots when browser fullscreen state changes so
    // the TitleBar button label flips between "Full Screen" and "Exit Full
    // Screen" on Esc-exit or programmatic transitions. Same listener covers
    // both vendor-prefixed and standard events.
    // 0.185.14 — also re-assert the repin button after any fullscreen
    // transition. Entering/exiting fullscreen can leave the floating button
    // in an inconsistent state (detached, wrong z-index under the new
    // backdrop, etc.). Re-invoking updateRepinButton is a cheap defensive
    // restore — the function is idempotent on the chromeVisible check.
    const onFullscreenChange = (): void => {
      try { renderSlots(); } catch (_e) { /* ok */ }
      try { updateRepinButton(); } catch (_e) { /* ok */ }
    };
    try {
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      document.addEventListener('msfullscreenchange', onFullscreenChange);
    } catch (_e) { /* ok */ }

    const cleanup = () => {
      if (cleanupShading) cleanupShading();
      if (cleanupDrag)    cleanupDrag();
      if (cleanupEmbeddedBtn) cleanupEmbeddedBtn();
      if (repinButtonEl) { try { repinButtonEl.remove(); } catch (_e) { /* ok */ void 0; } repinButtonEl = null; }
      try {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
        document.removeEventListener('msfullscreenchange', onFullscreenChange);
      } catch (_e) { /* ok */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (ganttInst) { try { (ganttInst as any).destroy(); } catch (_e) { /* ok */ void 0; } }
      slotInstances.forEach((inst) => inst.destroy());
      slotInstances.clear();
      removeTemplateCss(container);
      try { themeStyleEl.remove(); } catch (_e) { /* ok */ void 0; }
    };
    registry.push({ container, cleanup });

    return {
      setTasks(tasks: NormalizedTask[]) {
        allTasks = tasks;
        depthMap = buildDepthMap(allTasks);
        // 0.185.25 — when liveDataUpdate is on (default), route through the
        // light-touch refreshGantt() path so scroll position, canvas, and
        // timescale survive the refresh. Kills the post-drop "snap 2-4 times"
        // glitch when hosts fire setTasks repeatedly during drop settlement.
        // Legacy rebuildView() path still runs when flag is off, or when the
        // engine isn't alive, or view mode isn't 'gantt' (non-gantt views
        // currently require rebuild).
        const live = tplConfig.features.liveDataUpdate !== false;
        if (live && ganttInst && state.viewMode === 'gantt') {
          refreshGantt();
        } else {
          rebuildView();
        }
      },
      /** 0.185.27 — full replace of tasks AND dependencies. Pass the
       *  new deps array when the host has a fresh set (e.g. after Apex
       *  refresh pulls both `getProFormaTimelineData` + `getGanttDependencies`
       *  in parallel). Passing `undefined` leaves the existing deps alone —
       *  equivalent to calling `setTasks(tasks)` alone. Routes through the
       *  same liveDataUpdate-gated refresh path as setTasks. */
      setData(tasks: NormalizedTask[], dependencies?: GanttDependency[]) {
        allTasks = tasks;
        if (dependencies !== undefined) allDependencies = dependencies;
        depthMap = buildDepthMap(allTasks);
        const live = tplConfig.features.liveDataUpdate !== false;
        if (live && ganttInst && state.viewMode === 'gantt') {
          refreshGantt();
        } else {
          rebuildView();
        }
      },
      /** 0.185.32 — coordinate-based hit-test for host-driven right-click
       *  UX in LWS/Locker contexts where NG's internal document listeners
       *  silently no-op. Host attaches its own document listener, calls
       *  taskAt(e.clientX, e.clientY) to resolve the task under the cursor. */
      taskAt(clientX: number, clientY: number): NormalizedTask | null {
        return chromeTaskAt ? chromeTaskAt(clientX, clientY) : null;
      },
      /** CH-1 (0.183) — toggle chrome visibility at runtime. With no arg,
       *  flips current state; boolean arg sets explicitly. Embedded-mode
       *  mounts cannot re-show chrome this way because features were
       *  scrubbed at resolve time (mount with mode='fullscreen' first if
       *  runtime re-show is needed). Delegates to runToggleChrome so
       *  slot-dispatched toggles (TitleBar Unpin) and handle-dispatched
       *  toggles share one code path. */
      toggleChrome(visible?: boolean) {
        runToggleChrome(visible);
      },
      /** 0.185 — snapshot of the batch buffer. Empty array when batchMode
       *  is off or the buffer is clean. Insertion-order preserved across
       *  the Map iteration. */
      getPendingEdits(): PendingEdit[] {
        return Array.from(pendingBuffer.values());
      },
      /** 0.185 — flush every buffered edit to the host. Edits first
       *  (date changes), reorders second (parent/sortOrder/priorityGroup) —
       *  matches DH Apex's race-avoidance pattern (sortOrder reads neighbor
       *  state, so updateWorkItemDates must land first). Resolves with
       *  `{ committed }` on full success. On first failure, throws
       *  `{ failedAt, successful, error }`; failed + remaining stay in
       *  the buffer so the host can retry or discardEdits(). */
      async commitEdits(): Promise<CommitEditsResult> {
        const all = Array.from(pendingBuffer.values());
        const edits = all.filter((p) => p.kind === 'edit');
        const reorders = all.filter((p) => p.kind === 'reorder');
        const ordered = [...edits, ...reorders];
        const committed: PendingEdit[] = [];
        for (const p of ordered) {
          try {
            if (p.kind === 'edit' && p.changes) {
              if (options.onItemEdit) {
                await options.onItemEdit(p.taskId, p.changes);
              } else if (options.onPatch) {
                await Promise.resolve(options.onPatch({
                  id: p.taskId,
                  startDate: p.changes.startDate,
                  endDate: p.changes.endDate,
                }));
              }
            } else if (p.kind === 'reorder' && p.reorderPayload) {
              if (options.onItemReorder) {
                const newIndex = typeof p.reorderPayload.sortOrder === 'number'
                  ? p.reorderPayload.sortOrder
                  : 0;
                const payload: { newIndex: number; newParentId?: string | null; newPriorityGroup?: string } = { newIndex };
                if (p.reorderPayload.parentId !== undefined) payload.newParentId = p.reorderPayload.parentId;
                if (p.reorderPayload.priorityGroup !== undefined) payload.newPriorityGroup = p.reorderPayload.priorityGroup;
                await options.onItemReorder(p.taskId, payload);
              } else if (options.onPatch) {
                await Promise.resolve(options.onPatch({
                  id: p.taskId,
                  parentId: p.reorderPayload.parentId,
                  priorityGroup: p.reorderPayload.priorityGroup,
                  sortOrder: p.reorderPayload.sortOrder,
                }));
              }
            }
            // Success — remove from buffer + clear dim.
            pendingBuffer.delete(p.taskId + '::' + p.kind);
            // Only clear dirtyTaskIds when no other buffered entry still
            // references this taskId (a task could have BOTH edit + reorder).
            const stillBuffered = pendingBuffer.has(p.taskId + '::edit') || pendingBuffer.has(p.taskId + '::reorder');
            if (!stillBuffered) dirtyTaskIds.delete(p.taskId);
            committed.push(p);
          } catch (err) {
            // Partial-rollback per Glen's locked decision: failed + remaining
            // stay in the buffer; already-committed cleared above. Modal stays
            // open with "committed N of M, failed on X — retry or discard?"
            syncPendingChanges();
            refreshGantt();
            throw { failedAt: p, successful: committed, error: err };
          }
        }
        // Full success.
        syncPendingChanges();
        refreshGantt();
        return { committed };
      },
      /** 0.185.1 — imperative scroll-to-date. Snaps to start-of-period for
       *  the current zoom (Mon for week, 1st for month, 1st of quarter for
       *  quarter; day = no snap), then computes scrollLeft via
       *  `timeScale.dateToX` and lands the date at the LEFT edge. No-op if
       *  the engine isn't mounted yet (early call before initGantt). */
      scrollToDate(date: string | Date): void {
        if (!ganttInst) return;
        const parsed = parseFocusDate(date);
        if (!parsed) return;
        try {
          const gi = ganttInst as {
            timeScale?: { dateToX?: (d: Date) => number };
            scrollManager?: { scrollToX?: (x: number) => void };
          };
          const snapped = snapDateToZoomPeriod(parsed, state.zoom);
          const x = gi.timeScale?.dateToX?.(snapped);
          if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
        } catch (_e) { /* ok */ }
      },
      /** 0.185.26 — runtime update of host-supplied TitleBar buttons. Pass
       *  the full desired array (not a diff); replacing `pressed` state on
       *  an existing button is the typical use. Re-renders slots so the
       *  TitleBar picks up the new array immediately — no remount. */
      setTitleBarButtons(buttons) {
        tplConfig.titleBarButtons = buttons;
        renderSlots();
      },
      /** 0.185 — visual-only revert. Restores `original` on every buffered
       *  task and clears the buffer. Host never sees a callback. Use when
       *  the user clicks Cancel on the audit preview modal. */
      discardEdits(): void {
        for (const p of pendingBuffer.values()) {
          const idx = allTasks.findIndex((t) => t.id === p.taskId);
          if (idx === -1) continue;
          const u: NormalizedTask = { ...allTasks[idx] };
          if (p.kind === 'edit') {
            if (p.original.startDate !== undefined) u.startDate = p.original.startDate;
            if (p.original.endDate   !== undefined) u.endDate   = p.original.endDate;
          } else {
            if (p.original.priorityGroup !== undefined) u.priorityGroup    = p.original.priorityGroup;
            if (p.original.parentId      !== undefined) u.parentWorkItemId = p.original.parentId;
            if (p.original.sortOrder     !== undefined) u.sortOrder        = p.original.sortOrder;
          }
          allTasks[idx] = u;
        }
        pendingBuffer.clear();
        dirtyTaskIds.clear();
        syncPendingChanges();
        refreshGantt();
      },
      destroy() { IIFEApp.unmount(container); },
    };
  }

  static unmount(container: HTMLElement): void {
    const e = getEntry(container);
    if (e) { if (e.cleanup) e.cleanup(); removeEntry(container); }
    container.innerHTML = '';
  }
}
