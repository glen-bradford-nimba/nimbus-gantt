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

export function TitleBar({ config, state, dispatch, data }: SlotProps) {
  const s = data.stats;
  const summary =
    s.scheduled + ' scheduled · ' + (s.est || 0) + 'h';

  return (
    <div className={CLS_TITLEBAR} data-slot="TitleBar">
      <span className={CLS_TITLE_BRAND}>{config.title || 'Pro Forma Timeline'}</span>
      <span className={CLS_VERSION_PILL}>{config.version || 'v10 · Nimbus Gantt'}</span>
      <Sep />
      {CLOUD_NIMBUS_VIEW_MODES.map((v) => {
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
    </div>
  );
}
