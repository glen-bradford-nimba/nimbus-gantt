/**
 * TitleBar.tsx — v10 title bar per v10-component-spec.md §1.
 * Brand + version pill + view-mode pills + sidebar/stats/audit toggles +
 * zoom pills + group-by toggle + summary.
 */
import type { SlotProps, ViewMode, ZoomLevel, GroupBy } from '../../types';
import { CLOUD_NIMBUS_VIEW_MODES } from '../defaults';
import {
  CLS_TITLEBAR, CLS_TITLE_BRAND, CLS_VERSION_PILL, CLS_SEP,
  CLS_TB_FILL, CLS_TB_SUMMARY,
  CLS_PILL_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_VIOLET, CLS_PILL_BTN_IDLE_VIOLET,
  CLS_PILL_BTN_ACTIVE_BLUE, CLS_PILL_BTN_IDLE_BLUE,
  CLS_PILL_BTN_ACTIVE_SLATE, CLS_PILL_BTN_IDLE_SLATE,
} from './shared/classes';

const ZOOMS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];
const GROUPS: GroupBy[] = ['priority', 'epic'];

function Sep() {
  return <span className={CLS_SEP}>|</span>;
}

const HOURS_PER_MONTH = 170; // 80 Glen + 50 Mahi + 40 Antima

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function TitleBar({ config, state, dispatch, data }: SlotProps) {
  const s = data.stats;
  const estLow  = s.estLow || 0;
  const estHigh = s.est    || 0;
  const hrsStr  = estLow < estHigh
    ? estLow + '-' + estHigh + 'h'
    : estHigh + 'h';
  const moLow  = estLow  > 0 ? fmt1(estLow  / HOURS_PER_MONTH) : null;
  const moHigh = estHigh > 0 ? fmt1(estHigh / HOURS_PER_MONTH) : null;
  const moStr  = moLow && moHigh && moLow !== moHigh
    ? moLow + '-' + moHigh + ' mo'
    : moHigh ? moHigh + ' mo' : null;
  const summary = s.scheduled + ' scheduled · ' + hrsStr + (moStr ? ' · ' + moStr : '');

  // Only render view pills for views enabled in the template config (config.views).
  // When only 1 view is available (default: gantt-only), hide the entire section
  // to avoid showing a button that does nothing.
  const enabledViews = CLOUD_NIMBUS_VIEW_MODES.filter(
    (v) => !config.views || config.views.includes(v.id),
  );

  return (
    <div className={CLS_TITLEBAR} data-slot="TitleBar">
      <span className={CLS_TITLE_BRAND}>{config.title || 'Pro Forma Timeline'}</span>
      <span className={CLS_VERSION_PILL}>{config.version || 'v10 · Nimbus Gantt'}</span>
      {enabledViews.length > 1 && (
        <>
          <Sep />
          {enabledViews.map((v) => {
            const on = state.viewMode === v.id;
            return (
              <button
                key={v.id}
                type="button"
                className={
                  CLS_PILL_BTN_BASE + ' ' +
                  (on ? CLS_PILL_BTN_ACTIVE_VIOLET : CLS_PILL_BTN_IDLE_VIOLET)
                }
                onClick={() => dispatch({ type: 'SET_VIEW', mode: v.id as ViewMode })}
              >
                <span className="mr-1">{v.icon}</span>{v.label}
              </button>
            );
          })}
        </>
      )}
      <Sep />
      <button
        type="button"
        className={
          CLS_PILL_BTN_BASE + ' ' +
          (state.sidebarOpen ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE)
        }
        onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
      >
        Sidebar
      </button>
      <button
        type="button"
        className={
          CLS_PILL_BTN_BASE + ' ' +
          (state.statsOpen ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE)
        }
        onClick={() => dispatch({ type: 'TOGGLE_STATS' })}
      >
        Stats
      </button>
      {config.features.auditPanel && (
        <button
          type="button"
          className={
            CLS_PILL_BTN_BASE + ' ' +
            (state.auditPanelOpen ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE)
          }
          onClick={() => dispatch({ type: 'TOGGLE_AUDIT_PANEL' })}
        >
          Audit
        </button>
      )}
      <Sep />
      {ZOOMS.map((z) => {
        const on = state.zoom === z;
        return (
          <button
            key={z}
            type="button"
            className={
              CLS_PILL_BTN_BASE + ' ' +
              (on ? CLS_PILL_BTN_ACTIVE_SLATE : CLS_PILL_BTN_IDLE_SLATE)
            }
            onClick={() => dispatch({ type: 'SET_ZOOM', zoom: z })}
          >
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        );
      })}
      {config.features.groupByToggle && (
        <>
          <Sep />
          <span className="text-[10px] text-slate-400 font-medium tracking-wide mr-0.5">Group:</span>
          {GROUPS.map((g) => {
            const on = state.groupBy === g;
            return (
              <button
                key={g}
                type="button"
                className={
                  CLS_PILL_BTN_BASE + ' ' +
                  (on ? CLS_PILL_BTN_ACTIVE_SLATE : CLS_PILL_BTN_IDLE_SLATE)
                }
                onClick={() => dispatch({ type: 'SET_GROUP_BY', groupBy: g })}
              >
                {g === 'priority' ? 'Priority' : 'Epics'}
              </button>
            );
          })}
        </>
      )}
      <div className={CLS_TB_FILL} />
      <span className={CLS_TB_SUMMARY}>{summary}</span>
      {config.apiDocsUrl ? (
        <a
          href={config.apiDocsUrl}
          title="API docs — how to automate submits"
          className="text-[10px] text-slate-500 hover:text-fuchsia-600 underline decoration-dotted shrink-0"
          data-nga-api-docs="1"
        >
          API docs
        </a>
      ) : null}
      {config.mode === 'fullscreen' && typeof config.onExitFullscreen === 'function' ? (
        <button
          type="button"
          data-nga-fullscreen-exit="1"
          className={CLS_PILL_BTN_BASE + ' bg-slate-700 text-white border-slate-700'}
          onClick={() => config.onExitFullscreen!()}
        >
          ← Exit Full Screen
        </button>
      ) : null}
    </div>
  );
}
