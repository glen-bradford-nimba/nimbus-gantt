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
} from './types';
import type {
  TemplateOverrides, TemplateConfig, AppState, AppEvent, SlotProps, SlotData, PatchLogEntry,
  VanillaSlotInstance, FeatureFlags,
} from './templates/types';
import {
  buildDepthMap, buildTasks, buildTasksEpic, applyFilter, computeStats,
  DONE_STAGES, STAGE_COLORS, STAGE_TO_CATEGORY_COLOR, isBucketId,
} from './pipeline';
import { startDepthShading } from './depthShading';
import { startDragReparent } from './dragReparent';
import { renderAuditListView } from './templates/cloudnimbus/components/vanilla/AuditListView.vanilla';

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

const GANTT_COLS = [
  { field: 'title',      header: '', width: 210, tree: true },
  { field: 'hoursLabel', header: '', width: 85,  align: 'right' },
];

/**
 * Initial viewport offset from today — gantt scrolls to `today - 14 days`
 * on mount so users see ~2 weeks of recent past context rather than today
 * flush at the left edge. Matches v9 default. If a future consumer needs
 * configurability, expose `initialViewportOffsetDays` on MountOptions and
 * derive this value from it; the library-side default here stays.
 */
const INITIAL_VIEWPORT_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;

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
    '.ng-expand-icon{font-size:9px!important;opacity:.5!important;color:#6b7280!important;width:14px!important;min-width:14px!important}',
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
        tasks: gtasks, dependencies: [], columns: GANTT_COLS, theme: V3_THEME,
        rowHeight: 32, barHeight: 20, headerHeight: 32, gridWidth: 295,
        zoomLevel: state.zoom, showToday: true, showWeekends: true, showProgress: true,
        colorMap: options.config?.colorMap || { ...STAGE_COLORS, ...STAGE_TO_CATEGORY_COLOR },
        readOnly: false,
        onTaskClick: (task: { id: string }) => {
          if (!task || !task.id || isBucketId(task.id)) return;
          const t = findTaskById(task.id);
          if (t) options.onTaskClick?.(t, 'canvas');
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
      const handleContextMenu = (e: MouseEvent) => {
        if (!options.onTaskContextMenu) return;
        const target = e.target as HTMLElement | null;
        const row = target?.closest?.('.ng-grid-row[data-task-id]') as HTMLElement | null;
        const rowId = row?.getAttribute('data-task-id') ?? null;
        const taskId = (rowId && !isBucketId(rowId)) ? rowId : lastHoveredTaskId;
        const t = findTaskById(taskId);
        if (!t) return;
        e.preventDefault();
        options.onTaskContextMenu(t, { x: e.clientX, y: e.clientY });
      };
      ganttEl.addEventListener('mouseover', handleMouseOver);
      ganttEl.addEventListener('mouseleave', handleMouseLeave);
      ganttEl.addEventListener('contextmenu', handleContextMenu);
      if (typeof tplConfig.engine?.PriorityGroupingPlugin === 'function') {
        inst.use(tplConfig.engine.PriorityGroupingPlugin({
          buckets: tplConfig.buckets,
          getBucket: (task: { groupId?: string | null }) => task.groupId || null,
        }));
      }
      inst.setData(gtasks, []);
      try { inst.expandAll(); } catch (_e) { /* ok */ }
      // Scroll so (today - 14 days) lands at the LEFT EDGE of the viewport.
      // 0.181 used inst.scrollToDate(today-14d), but the engine's
      // scrollToDate centers the date in the viewport (NimbusGantt.ts:309
      // computes `targetX = x - viewportWidth/2`). With today-14d centered,
      // viewportWidth/2-worth of past dates appears LEFT of today-14d,
      // pushing today off-center to the right — and the centering math
      // often clamps to 0 (negative targetX) so the scroll silently
      // no-ops. v9 (DeliveryTimelineV5.tsx:1176-1188) bypasses scrollToDate
      // and calls timeScale.dateToX + scrollManager.scrollToX directly to
      // get true left-edge semantics. We replicate that pattern here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTimeout(() => {
        try {
          const gi = inst as { timeScale?: { dateToX?: (d: Date) => number }; scrollManager?: { scrollToX?: (x: number) => void } };
          const x = gi.timeScale?.dateToX?.(new Date(Date.now() - INITIAL_VIEWPORT_OFFSET_MS));
          if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
        } catch (_e) { /* ok */ }
      }, 50);

      let cleanupShading: (() => void) | null = null;
      let cleanupDrag: (() => void) | null = null;
      if (tplConfig.features.depthShading) cleanupShading = startDepthShading(ganttEl, depthMap);
      if (tplConfig.features.dragReparent) cleanupDrag    = startDragReparent(ganttEl, allTasks, depthMap, options.onPatch || (() => { /* no-op */ }));

      const cleanup = () => {
        if (cleanupShading) cleanupShading();
        if (cleanupDrag)    cleanupDrag();
        ganttEl.removeEventListener('mouseover', handleMouseOver);
        ganttEl.removeEventListener('mouseleave', handleMouseLeave);
        ganttEl.removeEventListener('contextmenu', handleContextMenu);
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
        if (typeof gi.setData === 'function') { gi.setData(g, []); try { gi.expandAll(); } catch (_e) { /* ok */ } }
      }

      return {
        setTasks(tasks: NormalizedTask[]) {
          allTasks = tasks;
          _syncToCanvas();
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
        destroy() { IIFEApp.unmount(container); },
      };
    }

    /* ── State ──────────────────────────────────────────────────────── */
    let state: AppState = { ...INITIAL_STATE };
    let allTasks: NormalizedTask[] = options.tasks || [];
    const patchLog: PatchLogEntry[] = [];

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
      dispatch({ type: 'PATCH', patch });
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
        renderSlots();
        // Re-render the gantt/view content if the view changed.
        if (ev.type === 'SET_VIEW' || ev.type === 'SET_GROUP_BY' || ev.type === 'SET_FILTER' ||
            ev.type === 'SET_SEARCH' || ev.type === 'TOGGLE_HIDE_COMPLETED') {
          rebuildView();
        } else if (ev.type === 'SET_ZOOM') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (ganttInst && typeof (ganttInst as any).setZoom === 'function') (ganttInst as any).setZoom(state.zoom);
        }
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

      // Re-bind the gantt host (ContentArea slot's inner [data-nga-gantt-host])
      const contentInst = slotInstances.get('ContentArea');
      if (contentInst) {
        ganttHost = contentInst.el.querySelector<HTMLElement>('[data-nga-gantt-host="1"]');
      }
    }

    /* ── Gantt engine mount ─────────────────────────────────────────── */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ganttInst: any = null;
    let cleanupShading: (() => void) | null = null;
    let cleanupDrag:    (() => void) | null = null;
    let depthMap = buildDepthMap(allTasks);

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
        tasks: gtasks, dependencies: [], columns: GANTT_COLS, theme: V3_THEME,
        rowHeight: 32, barHeight: 20, headerHeight: 32, gridWidth: 295,
        zoomLevel: state.zoom, showToday: true, showWeekends: true, showProgress: true,
        colorMap: options.config?.colorMap || { ...STAGE_COLORS, ...STAGE_TO_CATEGORY_COLOR },
        readOnly: false,
        onTaskClick:  (task: { id: string }) => {
          if (!task || !task.id || isBucketId(task.id)) return;
          dispatch({ type: 'TOGGLE_DETAIL', taskId: task.id });
          const t = allTasks.find((x) => x.id === task.id);
          if (t) options.onTaskClick?.(t, 'canvas');
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
          if (task && task.id && !isBucketId(task.id)) onTaskPatch({ id: task.id, startDate: s, endDate: e });
        },
        onTaskResize: (task: { id: string }, s: string, e: string) => {
          if (task && task.id && !isBucketId(task.id)) onTaskPatch({ id: task.id, startDate: s, endDate: e });
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
      const onContextMenu = (e: MouseEvent) => {
        if (!options.onTaskContextMenu) return;
        const target = e.target as HTMLElement | null;
        const row = target?.closest?.('.ng-grid-row[data-task-id]') as HTMLElement | null;
        const rowId = row?.getAttribute('data-task-id') ?? null;
        const taskId = (rowId && !isBucketId(rowId)) ? rowId : lastHoveredTaskId;
        const t = findTaskById(taskId);
        if (!t) return;
        e.preventDefault();
        options.onTaskContextMenu(t, { x: e.clientX, y: e.clientY });
      };
      ganttEl.addEventListener('mouseover', onMouseOver);
      ganttEl.addEventListener('mouseleave', onMouseLeave);
      ganttEl.addEventListener('contextmenu', onContextMenu);
      // Attach cleanup — reuse cleanupDrag slot indirectly by stacking:
      const prevCleanupDrag = cleanupDrag;
      cleanupDrag = () => {
        ganttEl.removeEventListener('mouseover', onMouseOver);
        ganttEl.removeEventListener('mouseleave', onMouseLeave);
        ganttEl.removeEventListener('contextmenu', onContextMenu);
        if (prevCleanupDrag) prevCleanupDrag();
      };

      if (typeof PGP === 'function') {
        const pluginBuckets = tplConfig.buckets;
        ganttInst.use(PGP({
          buckets: pluginBuckets,
          getBucket: (task: { groupId?: string | null }) => task.groupId || null,
          getBucketProgress: typeof hwp === 'function' ? hwp : undefined,
        }));
      }

      ganttInst.setData(gtasks, []);
      try { ganttInst.expandAll(); } catch (_e) { /* ok */ void 0; }

      // Scroll so (today - 14 days) lands at the LEFT EDGE of the viewport.
      // See engineOnly-path equivalent above for the full v9-parity rationale
      // — short version: engine.scrollToDate centers the date, which silently
      // clamps to 0 when (x - viewportWidth/2) goes negative; v9 bypasses
      // scrollToDate via timeScale.dateToX + scrollManager.scrollToX direct.
      setTimeout(() => {
        try {
          const gi = ganttInst as { timeScale?: { dateToX?: (d: Date) => number }; scrollManager?: { scrollToX?: (x: number) => void } };
          const x = gi.timeScale?.dateToX?.(new Date(Date.now() - INITIAL_VIEWPORT_OFFSET_MS));
          if (typeof x === 'number') gi.scrollManager?.scrollToX?.(Math.max(0, x));
        } catch (_e) { /* ok */ void 0; }
      }, 50);

      if (cleanupShading) cleanupShading();
      if (cleanupDrag)    cleanupDrag();
      if (tplConfig.features.depthShading) cleanupShading = startDepthShading(ganttEl, depthMap);
      if (tplConfig.features.dragReparent) cleanupDrag    = startDragReparent(ganttEl, allTasks, depthMap, onTaskPatch);
    }

    function refreshGantt(): void {
      if (!ganttHost) return;
      if (state.viewMode === 'gantt' && ganttInst) {
        const filtered = applyFilter(allTasks, state.filter as 'active', state.search);
        const maybeHide = state.hideCompleted
          ? filtered.filter((t) => !DONE_STAGES[t.stage || ''])
          : filtered;
        const gtasks = state.groupBy === 'epic'
          ? buildTasks(buildTasksEpic(maybeHide))
          : buildTasks(maybeHide);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gi = ganttInst as any;
        if (typeof gi.setData === 'function') {
          gi.setData(gtasks, []);
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
        renderAuditListView(ganttHost, allTasks);
      } else {
        const labelMap: Record<string, string> = {
          treemap: 'Treemap', bubbles: 'Bubbles',
          calendar: 'Calendar', flow: 'Flow',
        };
        renderComingSoon(ganttHost, labelMap[state.viewMode] || state.viewMode);
      }
      renderSlots();
    }

    /* ── First render ───────────────────────────────────────────────── */
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
    const cleanup = () => {
      if (cleanupShading) cleanupShading();
      if (cleanupDrag)    cleanupDrag();
      if (cleanupEmbeddedBtn) cleanupEmbeddedBtn();
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
        rebuildView();
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
