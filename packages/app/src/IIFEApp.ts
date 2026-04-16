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
  VanillaSlotInstance,
} from './templates/types';
import {
  buildDepthMap, buildTasks, buildTasksEpic, applyFilter, computeStats,
  DONE_STAGES, STAGE_COLORS, STAGE_TO_CATEGORY_COLOR, isBucketId,
} from './pipeline';
import type { PriorityBucket } from './types';
import { startDepthShading } from './depthShading';
import { startDragReparent } from './dragReparent';

import { resolveTemplate } from './templates/resolver';
import { INITIAL_STATE, reduceAppState } from './templates/state';
import { SLOT_ORDER, shouldRenderSlot } from './templates/slots';
import { ensureTemplateCss, removeTemplateCss } from './templates/stylesheet-loader';
import { themeToScopedCss } from './templates/css';

// Ensure built-in templates self-register on module load.
// CRITICAL: Use .vanilla variants — React imports break Locker Service.
import './templates/cloudnimbus/index.vanilla';
import './templates/minimal/index.vanilla';

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

/* ── Legacy gantt-CSS injection (kept from v5 for library class overrides) ── */
function injectLegacyNgCss(): void {
  if (document.getElementById('nga-v5-css')) return;
  const s = document.createElement('style');
  s.id  = 'nga-v5-css';
  s.textContent = [
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

function renderList(container: HTMLElement, tasks: ReturnType<typeof buildTasks>, buckets: PriorityBucket[]): void {
  container.innerHTML = '';
  const wrap = el('div', 'height:100%;overflow:auto;font-family:sans-serif;font-size:12px');
  const byGroup: Record<string, typeof tasks> = {};
  const noGroup: typeof tasks = [];
  tasks.forEach(t => {
    if (t.parentId) return;
    if (t.groupId) {
      if (!byGroup[t.groupId]) byGroup[t.groupId] = [];
      byGroup[t.groupId].push(t);
    } else { noGroup.push(t); }
  });
  buckets.forEach(b => {
    const members = byGroup[b.id] || [];
    if (!members.length) return;
    const hdr = el('div', 'background:' + b.bgTint + ';color:#fff;font-weight:700;font-size:11px;padding:7px 14px;text-transform:uppercase;position:sticky;top:0;z-index:1');
    hdr.textContent = b.label + ' — ' + members.length + ' items';
    wrap.appendChild(hdr);
    members.forEach(t => {
      const row = el('div', 'display:flex;align-items:center;padding:5px 14px;gap:8px;border-bottom:1px solid #f3f4f6');
      const dot = el('span', 'width:7px;height:7px;border-radius:50%;background:' + (STAGE_COLORS[t.status] || '#94a3b8'));
      row.appendChild(dot);
      const title = el('span', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#1f2937');
      title.textContent = t.title; row.appendChild(title);
      if (t.hoursLabel) {
        const h = el('span', 'font-size:10px;color:#94a3b8;font-family:monospace'); h.textContent = t.hoursLabel; row.appendChild(h);
      }
      wrap.appendChild(row);
    });
  });
  container.appendChild(wrap);
}

function renderTreemap(container: HTMLElement, tasks: ReturnType<typeof buildTasks>, buckets: PriorityBucket[]): void {
  container.innerHTML = '';
  const wrap = el('div', 'height:100%;overflow:auto;padding:8px;font-family:sans-serif;background:#f8fafc');
  const leaves = tasks.filter(t => !(t as { isParent?: boolean }).isParent && (t.metadata?.hoursHigh || 0) > 0);
  const total  = leaves.reduce((s, t) => s + (t.metadata?.hoursHigh || 0), 0);
  if (!total) { wrap.textContent = 'No hours to show'; container.appendChild(wrap); return; }
  const grouped: Record<string, typeof leaves> = {};
  leaves.forEach(t => { const g = t.groupId || 'other'; (grouped[g] = grouped[g] || []).push(t); });
  buckets.forEach(b => {
    const members = grouped[b.id] || [];
    if (!members.length) return;
    const sec = el('div', 'margin-bottom:8px');
    const hdr = el('div', 'font-size:10px;font-weight:700;color:#fff;padding:3px 8px;border-radius:4px;display:inline-block;margin-bottom:3px;background:' + b.bgTint);
    hdr.textContent = b.label;
    sec.appendChild(hdr);
    const row = el('div', 'display:flex;flex-wrap:wrap;gap:3px');
    members.forEach(t => {
      const tile = el('div', 'background:' + (t.color || '#94a3b8') + '44;border:1px solid ' + (t.color || '#94a3b8') + ';padding:4px 6px;border-radius:4px;font-size:10px');
      tile.textContent = t.title.slice(0, 20) + ' ' + (t.metadata?.hoursHigh || 0) + 'h';
      row.appendChild(tile);
    });
    sec.appendChild(row);
    wrap.appendChild(sec);
  });
  container.appendChild(wrap);
}

function renderBubbles(container: HTMLElement, tasks: ReturnType<typeof buildTasks>): void {
  container.innerHTML = '';
  const leaves = tasks.filter(t => !(t as { isParent?: boolean }).isParent && (t.metadata?.hoursHigh || 0) > 0);
  const wrap = el('div', 'height:100%;overflow:auto;padding:10px;font-family:sans-serif;background:#f8fafc');
  if (!leaves.length) { wrap.textContent = 'No tasks'; container.appendChild(wrap); return; }
  const maxH = Math.max(1, ...leaves.map(t => t.metadata?.hoursHigh || 0));
  leaves.forEach(t => {
    const r = Math.max(20, Math.sqrt((t.metadata?.hoursHigh || 0) / maxH) * 60);
    const bub = el('div', 'display:inline-block;width:' + r*2 + 'px;height:' + r*2 + 'px;border-radius:50%;background:' + (t.color || '#94a3b8') + '55;border:1.5px solid ' + (t.color || '#94a3b8') + ';margin:4px;text-align:center;line-height:' + r*2 + 'px;font-size:10px;color:#1f2937');
    bub.textContent = t.title.slice(0, 8);
    wrap.appendChild(bub);
  });
  container.appendChild(wrap);
}

function renderCalendar(container: HTMLElement, tasks: ReturnType<typeof buildTasks>): void {
  container.innerHTML = '';
  const wrap = el('div', 'height:100%;overflow:auto;padding:10px;font-family:sans-serif');
  const today = new Date();
  const monday = new Date(today);
  const dow = today.getDay();
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0,0,0,0);
  const WEEK_MS = 7 * 86400000;
  for (let i = 0; i < 8; i++) {
    const wkStart = new Date(monday.getTime() + i * WEEK_MS);
    const wkEnd   = new Date(wkStart.getTime() + WEEK_MS);
    const wkTasks = tasks.filter(t => {
      if (!t.startDate || !t.endDate) return false;
      const tS = new Date(t.startDate + 'T00:00:00').getTime();
      const tE = new Date(t.endDate   + 'T00:00:00').getTime();
      return tE > wkStart.getTime() && tS < wkEnd.getTime();
    });
    const row = el('div', 'display:flex;gap:4px;padding:6px;border-bottom:1px solid #e5e7eb');
    const lbl = el('div', 'width:80px;font-size:10px;color:#64748b');
    lbl.textContent = wkStart.toISOString().slice(0,10);
    row.appendChild(lbl);
    const cnt = el('div', 'flex:1;font-size:10px;color:#1f2937');
    cnt.textContent = wkTasks.length + ' task' + (wkTasks.length === 1 ? '' : 's');
    row.appendChild(cnt);
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}

function renderFlow(container: HTMLElement, tasks: ReturnType<typeof buildTasks>): void {
  container.innerHTML = '';
  const wrap = el('div', 'height:100%;overflow-x:auto;display:flex;gap:8px;padding:8px;background:#f8fafc;font-family:sans-serif');
  const cols: Array<{ label: string; color: string; match: (c: string) => boolean }> = [
    { label: 'Backlog',   color: '#f59e0b', match: c => c === '#f59e0b' },
    { label: 'Next Up',   color: '#3b82f6', match: c => c === '#3b82f6' },
    { label: 'In Flight', color: '#10b981', match: c => c === '#10b981' },
    { label: 'Blocked',   color: '#ef4444', match: c => c === '#ef4444' },
    { label: 'Done',      color: '#cbd5e1', match: c => c === '#cbd5e1' },
  ];
  const leaves = tasks.filter(t => !(t as { isParent?: boolean }).isParent);
  cols.forEach(c => {
    const colEl = el('div', 'width:200px;flex-shrink:0');
    const hdr = el('div', 'background:' + c.color + '22;color:' + c.color + ';padding:5px 8px;font-size:11px;font-weight:700;border-radius:4px 4px 0 0');
    hdr.textContent = c.label;
    colEl.appendChild(hdr);
    const inner = el('div', 'border:1px solid ' + c.color + '55;border-radius:0 0 4px 4px;padding:4px');
    leaves.filter(t => c.match(t.color || '')).forEach(t => {
      const card = el('div', 'background:#fff;border-left:3px solid ' + (t.color || '#94a3b8') + ';padding:5px 8px;margin-bottom:3px;font-size:10px;border-radius:4px');
      card.textContent = t.title;
      inner.appendChild(card);
    });
    colEl.appendChild(inner);
    wrap.appendChild(colEl);
  });
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

export class IIFEApp {
  static mount(container: HTMLElement, options: TemplateAwareMountOptions): AppInstance {
    IIFEApp.unmount(container);

    const templateName = options.template || 'cloudnimbus';
    const overrides: TemplateOverrides = options.overrides ? { ...options.overrides } : {};
    // Legacy title/version passthrough
    if (options.config?.title !== undefined)   overrides.title   = options.config.title;
    if (options.config?.version !== undefined) overrides.version = options.config.version;
    if (options.config?.buckets) overrides.buckets = options.config.buckets;

    let tplConfig: TemplateConfig;
    try {
      tplConfig = resolveTemplate(templateName, overrides);
    } catch (err) {
      console.error('[nimbus-gantt] template resolution failed:', err);
      // Fallback to cloudnimbus defaults silently
      tplConfig = resolveTemplate('cloudnimbus', overrides);
    }
    if (options.engine) tplConfig.engine = options.engine;

    /* ── engineOnly: React owns chrome — just run the gantt engine ──── */
    if (options.engineOnly) {
      container.style.cssText = 'height:100%;width:100%;position:relative';
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
      // Scroll to today after a tick so the canvas has its final dimensions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTimeout(() => { try { (inst as any).scrollToDate?.(new Date()); } catch (_e) { /* ok */ } }, 50);

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
    container.style.cssText = 'height:100%;display:flex;flex-direction:column;background:' + tplConfig.theme.bg + ';overflow:hidden;font-family:' + tplConfig.theme.fontFamily;

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
      const filtered = applyFilter(allTasks, state.filter as 'active', state.search);
      const maybeHide = state.hideCompleted
        ? filtered.filter((t) => !DONE_STAGES[t.stage || ''])
        : filtered;
      const mapped = buildTasks(maybeHide);
      if      (state.viewMode === 'gantt')    initGantt(ganttHost);
      else if (state.viewMode === 'flow')     renderFlow(ganttHost, mapped);
      else if (state.viewMode === 'calendar') renderCalendar(ganttHost, mapped);
      else if (state.viewMode === 'treemap')  renderTreemap(ganttHost, mapped, tplConfig.buckets);
      else if (state.viewMode === 'bubbles')  renderBubbles(ganttHost, mapped);
      else                                    renderList(ganttHost, mapped, tplConfig.buckets);
      renderSlots();
    }

    /* ── First render ───────────────────────────────────────────────── */
    renderSlots();
    if (ganttHost) initGantt(ganttHost);

    /* ── Registry + AppInstance ─────────────────────────────────────── */
    const cleanup = () => {
      if (cleanupShading) cleanupShading();
      if (cleanupDrag)    cleanupDrag();
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
