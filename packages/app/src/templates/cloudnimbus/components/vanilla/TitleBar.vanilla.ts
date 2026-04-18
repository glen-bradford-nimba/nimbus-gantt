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

  // Admin / Advisor / Unpin are placeholder toggles (not in AppState yet).
  // Keep their "on" state here so the button can flip visually for user feedback.
  let adminOn = false;
  let advisorOn = false;
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
    // Unpin — placeholder (toggles chromeVisible in v9). Show as toggleable pill.
    const unpinBtn = el('button',
      CLS_PILL_BTN_BASE + ' ' + (unpinOn ? CLS_RIGHT_UNPIN_ON : CLS_RIGHT_UNPIN_OFF));
    unpinBtn.textContent = unpinOn ? 'Pin' : 'Unpin';
    unpinBtn.title = unpinOn ? 'Pin toolbar' : 'Unpin toolbar';
    unpinBtn.addEventListener('click', () => {
      unpinOn = !unpinOn;
      // eslint-disable-next-line no-console
      console.log('[TitleBar] unpin toggled →', unpinOn);
      render(currentProps);
    });
    rowMain.appendChild(unpinBtn);

    // Fullscreen — host-nav mode vs local-toggle mode.
    // When the host passes `onExitFullscreen` AND mode==='fullscreen' (i.e.
    // we're mounted on the Salesforce Delivery_Gantt_Standalone page), the
    // button becomes "← Exit Full Screen" and invokes the host callback so
    // the LWC can navigate back to the embedded tab. Otherwise it keeps the
    // v9-style local TOGGLE_FULLSCREEN behaviour (expands within the page).
    const hostExit = config.mode === 'fullscreen' && typeof config.onExitFullscreen === 'function';
    const fsBtn = el('button',
      CLS_PILL_BTN_BASE + ' ' + ((state.fullscreen || hostExit) ? CLS_RIGHT_FS_ON : CLS_RIGHT_FS_OFF));
    if (hostExit) {
      fsBtn.textContent = '\u2190 Exit Full Screen';
      fsBtn.setAttribute('data-nga-fullscreen-exit', '1');
      fsBtn.addEventListener('click', () => { config.onExitFullscreen!(); });
    } else {
      fsBtn.textContent = state.fullscreen ? 'Exit Fullscreen' : 'Fullscreen';
      fsBtn.addEventListener('click', () => dispatch({ type: 'TOGGLE_FULLSCREEN' }));
    }
    rowMain.appendChild(fsBtn);

    // Admin — no-op placeholder
    const adminBtn = el('button',
      CLS_PILL_BTN_BASE + ' ' + (adminOn ? CLS_RIGHT_ADMIN_ON : CLS_RIGHT_ADMIN_OFF));
    adminBtn.textContent = 'Admin';
    adminBtn.title = 'Advanced feature toggles';
    adminBtn.addEventListener('click', () => {
      adminOn = !adminOn;
      // eslint-disable-next-line no-console
      console.log('[TitleBar] admin toggled →', adminOn);
      render(currentProps);
    });
    rowMain.appendChild(adminBtn);

    // Advisor — no-op placeholder
    const advisorBtn = el('button',
      CLS_PILL_BTN_BASE + ' ' + (advisorOn ? CLS_RIGHT_ADVISOR_ON : CLS_RIGHT_ADVISOR_OFF));
    advisorBtn.textContent = 'Advisor';
    advisorBtn.title = 'Scope advisor — local analysis, no API needed';
    advisorBtn.addEventListener('click', () => {
      advisorOn = !advisorOn;
      // eslint-disable-next-line no-console
      console.log('[TitleBar] advisor toggled →', advisorOn);
      render(currentProps);
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
  }

  render(initial);
  return {
    el: root,
    update(p) { currentProps = p; render(p); },
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); void currentProps; },
  };
}
