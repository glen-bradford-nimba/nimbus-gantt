/**
 * FilterBar.tsx — v10 filter chips + search + color legend + team + auto-schedule.
 * Spec §2.
 */
import type { SlotProps } from '../../types';
import { CLOUD_NIMBUS_CATEGORIES, CLOUD_NIMBUS_POOL } from '../defaults';
import {
  CLS_FILTERBAR, CLS_FILTERBAR_INNER, CLS_FILTERBAR_LABEL,
  CLS_FILTER_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_BLUE, CLS_PILL_BTN_IDLE_BLUE,
  CLS_SEARCH_WRAP, CLS_SEARCH_ICON, CLS_SEARCH_INPUT, CLS_SEARCH_CLEAR,
  CLS_LEGEND_CHIP, CLS_LEGEND_SWATCH, CLS_LEGEND_TEXT,
  CLS_TEAM_PILL, CLS_CAPACITY_TEXT, CLS_AUTO_SCHED_BTN,
  CLS_COUNT_LABEL, CLS_RESET_LINK, CLS_SEP,
} from './shared/classes';

function Sep() { return <span className={CLS_SEP + ' mx-1'}>|</span>; }

export function FilterBar({ config, state, dispatch, data }: SlotProps) {
  const totalH = CLOUD_NIMBUS_POOL.reduce((s, m) => s + m.hoursPerMonth, 0);
  const s = data.stats;
  const filters = config.filters;
  return (
    <div className={CLS_FILTERBAR} data-slot="FilterBar">
      <div className={CLS_FILTERBAR_INNER}>
        <span className={CLS_FILTERBAR_LABEL}>View:</span>
        {filters.map((f) => {
          const on = state.filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              className={
                CLS_FILTER_BTN_BASE + ' ' +
                (on ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE)
              }
              onClick={() => dispatch({ type: 'SET_FILTER', id: f.id })}
            >
              {f.label}
            </button>
          );
        })}
        <Sep />
        <div className={CLS_SEARCH_WRAP}>
          <span className={CLS_SEARCH_ICON}>🔎</span>
          <input
            data-testid="gantt-search-input"
            type="text"
            placeholder="Search T-NNNN, title, owner…"
            className={CLS_SEARCH_INPUT}
            value={state.search}
            onChange={(e) => dispatch({ type: 'SET_SEARCH', q: e.target.value })}
          />
          {state.search ? (
            <button
              type="button"
              className={CLS_SEARCH_CLEAR}
              onClick={() => dispatch({ type: 'SET_SEARCH', q: '' })}
            >
              ×
            </button>
          ) : null}
        </div>
        <Sep />
        <span className={CLS_FILTERBAR_LABEL}>Colors:</span>
        {CLOUD_NIMBUS_CATEGORIES.map((cat) => {
          const n = s.categoryCounts[cat.label] || 0;
          if (n <= 0) return null;
          return (
            <span key={cat.category} className={CLS_LEGEND_CHIP}>
              <span className={CLS_LEGEND_SWATCH} style={{ background: cat.color }} />
              <span className={CLS_LEGEND_TEXT}>{cat.label} ({n})</span>
            </span>
          );
        })}
        <Sep />
        <button type="button" className={CLS_TEAM_PILL}>
          Team <span>{CLOUD_NIMBUS_POOL.length}×</span>
        </button>
        <span className={CLS_CAPACITY_TEXT}>{totalH}h/mo</span>
        <button type="button" className={CLS_AUTO_SCHED_BTN}>
          Auto-Schedule
        </button>
        <div className="flex-1" />
        <span className={CLS_COUNT_LABEL}>
          {s.total} items · {s.scheduled} scheduled · {s.needDates} need dates
        </span>
        {state.pendingPatchCount > 0 ? (
          <button
            type="button"
            className={CLS_RESET_LINK}
            onClick={() => dispatch({ type: 'RESET_PATCHES' })}
          >
            Reset changes
          </button>
        ) : null}
      </div>
    </div>
  );
}
