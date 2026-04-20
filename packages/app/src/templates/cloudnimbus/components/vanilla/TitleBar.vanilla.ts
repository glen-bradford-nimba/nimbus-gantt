/**
 * TitleBar.vanilla.ts — vanilla DOM factory for TitleBar. Ports v9's JSX
 * (cloudnimbusllc.com DeliveryTimelineV5.tsx lines ~1842-1984) line-for-line
 * so Salesforce IIFE renders match the v9 look.
 *
 * Layout order (mirrors v9):
 *   1. Brand  2. Version pill  3. "|"
 *   4. VIEW_MODES row (6 view pills)  5. "|"
 *   6. Sidebar / Stats / Audit toggles  7. "|"
 *   8. ZOOM row (Day/Week/Month/Quarter)  9. "|"
 *   10. Group: label + Priority/Epics buttons  11. "|"
 *   12. flex-1 fill
 *   13. Summary (scheduled · hours-range · months-range)
 *   14. Unpin / Fullscreen / Admin / Advisor / v3 link
 */
import type { SlotProps, VanillaSlotInstance, ViewMode, ZoomLevel, GroupBy } from '../../../types';
import { CLOUD_NIMBUS_VIEW_MODES } from '../../defaults';
import { CLOUD_NIMBUS_POOL } from '../../defaults';
import {
  CLS_TITLEBAR, CLS_TITLEBAR_ROW, CLS_TITLE_BRAND, CLS_VERSION_PILL, CLS_SEP,
  CLS_TB_FILL, CLS_TB_SUMMARY,
  CLS_PILL_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_VIOLET, CLS_PILL_BTN_IDLE_VIOLET,
  CLS_PILL_BTN_ACTIVE_BLUE, CLS_PILL_BTN_IDLE_BLUE,
  CLS_PILL_BTN_ACTIVE_SLATE, CLS_PILL_BTN_IDLE_SLATE,
} from '../shared/classes';
import { el, clear } from '../shared/el';

const ZOOMS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];
const GROUPS: GroupBy[] = ['priority', 'epic'];

/**
 * 0.185.10 — Fullscreen API helpers. Replaces the earlier navigate-to-VF-page
 * behavior (which only hid the Lightning tab header but kept one.app chrome,
 * and introduced a separate surface that caused stale-bundle + persistence
 * divergence bugs). Real fullscreen uses browser Fullscreen API on the host
 * element so chrome disappears entirely on the same mounted LWC — no
 * navigation, no surface divergence, Esc exits.
 *
 * The earlier `fullscreenUrl` and `onExitFullscreen` options stay wired for
 * backwards compat when a consumer needs a separate surface (e.g. CNN page-
 * level fullscreen). Default precedence now favors the Fullscreen API when
 * the browser supports it AND the consumer hasn't explicitly opted into the
 * URL/host-exit paths.
 */
interface FsApi { request(el: HTMLElement): Promise<void>; exit(): Promise<void>; element(): Element | null; }
function resolveFullscreenApi(): FsApi | null {
  if (typeof document === 'undefined') return null;
  const doc = document as unknown as Document & {
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?: () => Promise<void>;
    msFullscreenElement?: Element;
    msExitFullscreen?: () => Promise<void>;
  };
  // 0.185.13 — LWS probe. Salesforce Lightning Web Security blocks reads
  // of document.fullscreenElement on VF / Lightning Out surfaces with
  // "Cannot access fullscreenElement". 0.185.10 called this unguarded
  // during render → the throw killed TitleBar → whole gantt failed to
  // mount on LWS-strict surfaces. Probe once at init: if the property
  // access throws, return null so the button falls through to the legacy
  // TOGGLE_FULLSCREEN local-toggle path (safe on every surface).
  try { void doc.fullscreenElement; } catch (_e) { return null; }
  const request = (el: HTMLElement): Promise<void> => {
    const anyEl = el as unknown as {
      requestFullscreen?: () => Promise<void>;
      webkitRequestFullscreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    if (anyEl.requestFullscreen)         return anyEl.requestFullscreen();
    if (anyEl.webkitRequestFullscreen)   return anyEl.webkitRequestFullscreen();
    if (anyEl.msRequestFullscreen)       return anyEl.msRequestFullscreen();
    return Promise.reject(new Error('Fullscreen API not supported'));
  };
  const exit = (): Promise<void> => {
    try {
      if (doc.exitFullscreen)         return doc.exitFullscreen();
      if (doc.webkitExitFullscreen)   return doc.webkitExitFullscreen();
      if (doc.msExitFullscreen)       return doc.msExitFullscreen();
    } catch (_e) { /* LWS blocked */ }
    return Promise.reject(new Error('exitFullscreen not supported'));
  };
  const element = (): Element | null => {
    try {
      return doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
    } catch (_e) {
      // LWS can block the property read at any time; treat as "not in fullscreen."
      return null;
    }
  };
  const anyEl = document.documentElement as unknown as { requestFullscreen?: unknown; webkitRequestFullscreen?: unknown };
  if (!anyEl.requestFullscreen && !anyEl.webkitRequestFullscreen) return null;
  return { request, exit, element };
}

/* ── v9 "Group:" button variants ────────────────────────────────────────── */
const CLS_GROUP_BOTH   = 'bg-indigo-600 text-white border-indigo-600';
const CLS_GROUP_GANTT  = 'bg-indigo-100 text-indigo-700 border-indigo-400';
const CLS_GROUP_SIDE   = 'bg-blue-100 text-blue-700 border-blue-400';
const CLS_GROUP_NEITHER = 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300';

/* ── v9 right-side toggle variants (Unpin / Fullscreen / Admin / Advisor) ─ */
const CLS_RIGHT_UNPIN_ON   = 'bg-amber-500 text-white border-amber-500';
const CLS_RIGHT_UNPIN_OFF  = 'bg-white text-slate-500 border-slate-200 hover:border-amber-300';
const CLS_RIGHT_FS_ON      = 'bg-slate-700 text-white border-slate-700';
const CLS_RIGHT_FS_OFF     = 'bg-white text-slate-500 border-slate-200 hover:border-slate-400';
const CLS_RIGHT_ADMIN_ON   = 'bg-rose-500 text-white border-rose-500';
const CLS_RIGHT_ADMIN_OFF  = 'bg-white text-slate-400 border-slate-200 hover:border-rose-300';
const CLS_RIGHT_ADVISOR_ON  = 'bg-indigo-600 text-white border-indigo-600';
const CLS_RIGHT_ADVISOR_OFF = 'bg-white text-indigo-500 border-indigo-200 hover:border-indigo-400';

const CLS_GROUP_LABEL = 'text-[9px] text-slate-400';
const CLS_V3_LINK     = 'text-[9px] text-slate-400 hover:text-blue-500';
const CLS_SUPER_TAG   = 'ml-0.5 text-[8px] opacity-60';

function mkSep(): HTMLElement { const s = el('span', CLS_SEP); s.textContent = '|'; return s; }

function monthsToComplete(hours: number, hoursPerMonth: number): number {
  if (!hoursPerMonth || hoursPerMonth <= 0) return Infinity;
  return hours / hoursPerMonth;
}

export function TitleBarVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_TITLEBAR);
  root.setAttribute('data-slot', 'TitleBar');
  let currentProps = initial;

  // 0.185.8 — Admin + Advisor now read their on/off state from AppState
  // (state.adminOpen, state.advisorOpen) and dispatch TOGGLE_ADMIN /
  // TOGGLE_ADVISOR events. Unpin stays a local placeholder for now.
  let unpinOn = false; // "Unpin" shown when chromeVisible (default true in v9)

  function render(p: SlotProps) {
    clear(root);
    const { config, state, dispatch, data } = p;

    // Titlebar is column-flex — Row 1 (view pills) stacks above Row 2
    // (everything else). Row 1 is only appended when the template enables
    // >1 view mode; otherwise Row 2 is the only child (visually identical
    // to v12 prod's single-row titlebar).
    const rowViews = el('div', CLS_TITLEBAR_ROW);
    rowViews.setAttribute('data-nga-titlebar-row', 'views');
    const rowMain = el('div', CLS_TITLEBAR_ROW);
    rowMain.setAttribute('data-nga-titlebar-row', 'main');

    /* Row 1 — VIEW_MODES pills. Hidden when enabledViews.length <= 1. */
    const enabledViews = CLOUD_NIMBUS_VIEW_MODES.filter(
      (v) => !config.views || config.views.includes(v.id),
    );
    if (enabledViews.length > 1) {
      enabledViews.forEach((v) => {
        const on = state.viewMode === v.id;
        const cls = CLS_PILL_BTN_BASE + ' ' + (on ? CLS_PILL_BTN_ACTIVE_VIOLET : CLS_PILL_BTN_IDLE_VIOLET);
        const btn = el('button', cls);
        const ico = el('span', 'mr-1');
        ico.textContent = v.icon;
        btn.appendChild(ico);
        btn.appendChild(document.createTextNode(v.label));
        btn.addEventListener('click', () => dispatch({ type: 'SET_VIEW', mode: v.id as ViewMode }));
        rowViews.appendChild(btn);
      });
      root.appendChild(rowViews);
    }

    /* Row 2 — brand + version + toggles + zoom + group + summary + right-side. */

    /* 1. Brand */
    const brand = el('span', CLS_TITLE_BRAND);
    brand.textContent = config.title || 'Pro Forma Timeline';
    rowMain.appendChild(brand);

    /* 2. Version pill */
    const version = el('span', CLS_VERSION_PILL);
    version.textContent = config.version || 'v10 · Nimbus Gantt';
    rowMain.appendChild(version);
    rowMain.appendChild(mkSep());

    /* 6. Sidebar / Stats / Audit toggles */
    function toggleBtn(label: string, on: boolean, ev: () => void) {
      const cls = CLS_PILL_BTN_BASE + ' ' + (on ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE);
      const b = el('button', cls);
      b.textContent = label;
      b.addEventListener('click', ev);
      return b;
    }
    rowMain.appendChild(toggleBtn('Sidebar', state.sidebarOpen, () => dispatch({ type: 'TOGGLE_SIDEBAR' })));
    rowMain.appendChild(toggleBtn('Stats',   state.statsOpen,   () => dispatch({ type: 'TOGGLE_STATS' })));
    if (config.features.auditPanel) {
      rowMain.appendChild(toggleBtn('Audit',  state.auditPanelOpen, () => dispatch({ type: 'TOGGLE_AUDIT_PANEL' })));
    }
    rowMain.appendChild(mkSep());

    /* 8. Zoom row */
    ZOOMS.forEach((z) => {
      const on = state.zoom === z;
      const cls = CLS_PILL_BTN_BASE + ' ' + (on ? CLS_PILL_BTN_ACTIVE_SLATE : CLS_PILL_BTN_IDLE_SLATE);
      const b = el('button', cls);
      b.textContent = z.charAt(0).toUpperCase() + z.slice(1);
      b.addEventListener('click', () => dispatch({ type: 'SET_ZOOM', zoom: z }));
      rowMain.appendChild(b);
    });

    /* 10. Group: label + Priority/Epics buttons */
    if (config.features.groupByToggle) {
      rowMain.appendChild(mkSep());
      const gLbl = el('span', CLS_GROUP_LABEL);
      gLbl.textContent = 'Group:';
      gLbl.title = 'Left-click = Gantt · Right-click = Sidebar';
      rowMain.appendChild(gLbl);
      GROUPS.forEach((g) => {
        // v9 uses two independent group-by states (ganttGroupBy, sidebarGroupBy).
        // Our AppState only has one (groupBy). We drive both bindings from it so
        // the button shows the "both" active style — matches v9's default look.
        const isGantt = state.groupBy === g;
        const isSide  = state.groupBy === g;
        let variant = CLS_GROUP_NEITHER;
        if (isGantt && isSide) variant = CLS_GROUP_BOTH;
        else if (isGantt)      variant = CLS_GROUP_GANTT;
        else if (isSide)       variant = CLS_GROUP_SIDE;
        const cls = CLS_PILL_BTN_BASE + ' ' + variant;
        const b = el('button', cls);
        b.textContent = g === 'priority' ? 'Priority' : 'Epics';
        b.title = 'Left-click: Gantt → ' + g + ' · Right-click: Sidebar → ' + g;
        if (isGantt && !isSide) {
          const sup = el('span', CLS_SUPER_TAG);
          sup.textContent = 'G';
          b.appendChild(sup);
        } else if (isSide && !isGantt) {
          const sup = el('span', CLS_SUPER_TAG);
          sup.textContent = 'S';
          b.appendChild(sup);
        }
        b.addEventListener('click', () => dispatch({ type: 'SET_GROUP_BY', groupBy: g }));
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          dispatch({ type: 'SET_GROUP_BY', groupBy: g });
        });
        rowMain.appendChild(b);
      });
    }

    /* 12. flex-1 fill */
    const fill = el('div', CLS_TB_FILL);
    rowMain.appendChild(fill);

    /* 13. Summary — scheduled · hoursLow-hoursHigh · monthsLow-monthsHigh */
    const hoursHigh = data.stats.est;
    const hoursLow  = data.stats.estLow || data.stats.est;
    const totalCap  = CLOUD_NIMBUS_POOL.reduce((s, m) => s + (m.active !== false ? m.hoursPerMonth : 0), 0);
    const mLow  = monthsToComplete(hoursLow,  totalCap);
    const mHigh = monthsToComplete(hoursHigh, totalCap);
    const mLowS  = isFinite(mLow)  ? mLow.toFixed(1)  : '∞';
    const mHighS = isFinite(mHigh) ? mHigh.toFixed(1) : '∞';
    const summary = el('span', CLS_TB_SUMMARY);
    summary.textContent =
      data.stats.scheduled + ' scheduled · ' +
      hoursLow + '–' + hoursHigh + 'h · ' +
      mLowS + '–' + mHighS + ' mo';
    rowMain.appendChild(summary);

    /* 14. Right-side action buttons */
    // Unpin — 0.183.1: wired to config.toggleChrome (CH-1). Click hides
    // chrome entirely; re-show is programmatic via handle.toggleChrome(true)
    // since the button that hid chrome is itself hidden with the rest. UI
    // polish for two-way in-chrome toggle is a follow-up (floating "show
    // toolbar" affordance when chromeVisible=false).
    const unpinBtn = el('button',
      CLS_PILL_BTN_BASE + ' ' + CLS_RIGHT_UNPIN_OFF);
    unpinBtn.textContent = 'Unpin';
    unpinBtn.title = 'Hide toolbar';
    unpinBtn.setAttribute('data-nga-unpin', '1');
    unpinBtn.addEventListener('click', () => {
      if (typeof config.toggleChrome === 'function') {
        config.toggleChrome(false);
      } else {
        // Fallback for consumers on pre-0.183.1 bundles — stays a no-op
        // placeholder so the button doesn't throw.
        unpinOn = !unpinOn;
        render(currentProps);
      }
    });
    rowMain.appendChild(unpinBtn);

    // Fullscreen button — three dispatch modes in precedence order:
    //   1. config.fullscreenUrl set + user already on that URL → button
    //      is HIDDEN (already there; button would be a no-op).
    //   2. config.fullscreenUrl set + user NOT on that URL → button
    //      navigates (window.location.href). Salesforce embedded-tab
    //      mount passes '/apex/DeliveryGanttStandalone' so users jump
    //      to the fullscreen FlexiPage without the LWC wiring
    //      NavigationMixin manually.
    //   3. config.mode === 'fullscreen' + onExitFullscreen set (SF
    //      Standalone) → "← Exit Full Screen" invokes the host nav
    //      callback so the LWC returns to the embedded tab.
    //   4. Fallback → native state TOGGLE_FULLSCREEN (CNN + localhost
    //      expand-in-page UX preserved).
    // 0.185.10 — Default path uses the browser Fullscreen API on the gantt
    // root element: same surface, same mounted LWC, SF chrome outside the
    // container disappears entirely, Esc exits. No navigation, no separate
    // VF-wrapped surface, no stale-bundle or persistence divergence.
    //
    // Backwards-compat paths preserved (off by default; opt-in via config):
    //   - config.fullscreenUrl set → legacy URL-nav (e.g. CNN page-level)
    //   - config.onExitFullscreen set AND mode==='fullscreen' → legacy host-
    //     exit (SF Standalone VF page host callback to navigate back)
    //
    // Precedence (most specific wins):
    //   1. fullscreenUrl set → URL nav (opt-in)
    //   2. host-exit available → config.onExitFullscreen (opt-in)
    //   3. Fullscreen API available → real fullscreen on gantt root (default)
    //   4. Fallback → TOGGLE_FULLSCREEN local state (legacy expand-in-page)
    const fsApi = resolveFullscreenApi();
    const fsUrl = config.fullscreenUrl;
    const onCurrentFsUrl = !!(fsUrl && typeof location !== 'undefined' && location.pathname === fsUrl);
    if (!onCurrentFsUrl) {
      const hostExit = config.mode === 'fullscreen' && typeof config.onExitFullscreen === 'function';
      const useFsApi = !fsUrl && !hostExit && !!fsApi;
      const fsApiActive = !!(fsApi && fsApi.element());
      const active = state.fullscreen || hostExit || fsApiActive;
      const fsBtn = el('button',
        CLS_PILL_BTN_BASE + ' ' + (active ? CLS_RIGHT_FS_ON : CLS_RIGHT_FS_OFF));
      if (fsUrl) {
        fsBtn.textContent = 'Full Screen';
        fsBtn.setAttribute('data-nga-fullscreen-url', '1');
        fsBtn.addEventListener('click', () => { window.location.href = fsUrl; });
      } else if (hostExit) {
        fsBtn.textContent = '\u2190 Exit Full Screen';
        fsBtn.setAttribute('data-nga-fullscreen-exit', '1');
        fsBtn.addEventListener('click', () => { config.onExitFullscreen!(); });
      } else if (useFsApi) {
        fsBtn.textContent = fsApiActive ? '\u2190 Exit Full Screen' : 'Full Screen';
        fsBtn.setAttribute('data-nga-fullscreen-api', '1');
        fsBtn.addEventListener('click', async () => {
          try {
            if (fsApi!.element()) {
              await fsApi!.exit();
            } else {
              // Find the template root so the whole chrome+canvas goes
              // fullscreen together (not just the TitleBar). Fall back to
              // documentElement if no template-root marker is present.
              const target = (root.closest('[data-nga-template-root]') as HTMLElement | null)
                || (root.parentElement as HTMLElement | null)
                || document.documentElement;
              await fsApi!.request(target);
            }
          } catch (err) {
            try { console.error('[NG fs-btn] Fullscreen API threw', err); } catch (_e) { /* ok */ }
          }
        });
      } else {
        fsBtn.textContent = state.fullscreen ? 'Exit Full Screen' : 'Full Screen';
        fsBtn.addEventListener('click', () => dispatch({ type: 'TOGGLE_FULLSCREEN' }));
      }
      rowMain.appendChild(fsBtn);
    }

    // 0.185.8 — Admin button: dispatches TOGGLE_ADMIN; state.adminOpen
    // drives the button's on/off appearance. AdminPanel slot reads the
    // same state to show/hide.
    const adminOn = !!state.adminOpen;
    const adminBtn = el('button',
      CLS_PILL_BTN_BASE + ' ' + (adminOn ? CLS_RIGHT_ADMIN_ON : CLS_RIGHT_ADMIN_OFF));
    adminBtn.textContent = 'Admin';
    adminBtn.title = 'Feature toggles';
    adminBtn.addEventListener('click', () => {
      dispatch({ type: 'TOGGLE_ADMIN' });
    });
    rowMain.appendChild(adminBtn);

    // 0.185.8 — Advisor button: dispatches TOGGLE_ADVISOR. AdvisorPanel
    // currently shows an honest "coming soon" body pending Claude-API
    // infrastructure decisions (auth path, CSP, error surface).
    const advisorOn = !!state.advisorOpen;
    const advisorBtn = el('button',
      CLS_PILL_BTN_BASE + ' ' + (advisorOn ? CLS_RIGHT_ADVISOR_ON : CLS_RIGHT_ADVISOR_OFF));
    advisorBtn.textContent = 'Advisor';
    advisorBtn.title = 'Claude-powered narrative mode';
    advisorBtn.addEventListener('click', () => {
      dispatch({ type: 'TOGGLE_ADVISOR' });
    });
    rowMain.appendChild(advisorBtn);

    // API docs link — only renders when config.apiDocsUrl is set. v9 parity
    // anchor in top chrome (DeliveryTimelineV5.tsx:2290-2296). Salesforce
    // consumers leave apiDocsUrl unset → link absent. cloudnimbusllc.com sets
    // it to '/mf/delivery-timeline-v8-api' for v9 parity.
    if (config.apiDocsUrl) {
      const apiDocs = el('a',
        'text-[10px] text-slate-500 hover:text-fuchsia-600 underline decoration-dotted shrink-0');
      (apiDocs as HTMLAnchorElement).href = config.apiDocsUrl;
      apiDocs.title = 'API docs — how to automate submits';
      apiDocs.setAttribute('data-nga-api-docs', '1');
      apiDocs.textContent = 'API docs';
      rowMain.appendChild(apiDocs);
    }

    // v3 link-badge
    const v3 = el('a', CLS_V3_LINK);
    (v3 as HTMLAnchorElement).href = '#';
    v3.textContent = 'v3 (Canvas)';
    rowMain.appendChild(v3);

    // Attach Row 2 to the outer titlebar (always present; Row 1 already
    // appended above when enabledViews.length > 1).
    root.appendChild(rowMain);

    // 0.185.5 — Status color legend. Compact horizontal strip so users can
    // decode what the bar colors mean (In Flight / Next Up / Backlog /
    // Blocked / Paused / Done) without having to guess. Reads from the
    // same STAGE_TO_CATEGORY_COLOR buckets the renderer uses.
    const legend = el('div', 'flex items-center gap-3 px-3 py-1 text-[10px] text-slate-500 border-t border-slate-100');
    legend.setAttribute('data-slot-part', 'status-legend');
    const legendItems: Array<{ label: string; color: string }> = [
      { label: 'In Flight', color: '#10b981' },
      { label: 'Next Up',   color: '#3b82f6' },
      { label: 'Backlog',   color: '#f59e0b' },
      { label: 'Blocked',   color: '#ef4444' },
      { label: 'Paused',    color: '#94a3b8' },
      { label: 'Done',      color: '#cbd5e1' },
    ];
    const legendLabel = el('span', 'text-[9px] text-slate-400 uppercase tracking-wide');
    legendLabel.textContent = 'Status';
    legend.appendChild(legendLabel);
    for (const item of legendItems) {
      const chip = el('span', 'flex items-center gap-1');
      const dot = el('span', '');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${item.color};display:inline-block`;
      chip.appendChild(dot);
      const lbl = el('span', '');
      lbl.textContent = item.label;
      chip.appendChild(lbl);
      legend.appendChild(chip);
    }
    root.appendChild(legend);
  }

  render(initial);
  return {
    el: root,
    update(p) { currentProps = p; render(p); },
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); void currentProps; },
  };
}
