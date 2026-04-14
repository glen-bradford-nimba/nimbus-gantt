/**
 * StatsPanel.vanilla.ts — vanilla DOM StatsPanel slot (v10-spec §5).
 *
 * Six-card KPI strip, visible when `state.statsOpen === true`:
 *   1. Items in View        — data.visibleTasks.length         (slate)
 *   2. Active (scheduled)   — stats.scheduled, hint needDates  (emerald)
 *   3. Scheduled            — stats.scheduled, hint "of N"     (blue)
 *   4. Hours Logged         — stats.logged + "h"               (purple)
 *   5. Hours Range          — estLow–est envelope              (amber)
 *   6. Months to complete   — low–high + editable h/mo input   (indigo)
 */
import type { SlotProps, VanillaSlotInstance } from '../../../types';
import {
  CLS_STATS_PANEL, CLS_STATS_GRID,
  CLS_KPI_CARD_BASE, CLS_KPI_LABEL, CLS_KPI_VALUE, CLS_KPI_HINT,
  STATS_TONE,
} from '../shared/classes';
import { el, clear } from '../shared/el';

function kpiCard(label: string, value: string, tone: keyof typeof STATS_TONE, hint?: string): HTMLElement {
  const t = STATS_TONE[tone] || STATS_TONE.slate;
  const card = el('div', CLS_KPI_CARD_BASE + ' ' + t.border);
  const lbl = el('p', CLS_KPI_LABEL + ' ' + t.label);
  lbl.textContent = label;
  const val = el('p', CLS_KPI_VALUE + ' ' + t.value);
  val.textContent = value;
  card.appendChild(lbl);
  card.appendChild(val);
  if (hint) {
    const h = el('p', CLS_KPI_HINT);
    h.textContent = hint;
    card.appendChild(h);
  }
  return card;
}

export function StatsPanelVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_STATS_PANEL + ' flex-shrink-0');
  root.setAttribute('data-slot', 'StatsPanel');
  const grid = el('div', CLS_STATS_GRID);
  root.appendChild(grid);

  // Local closure state for the editable "hours per month" input. Persists
  // across re-renders without React; no top-level `new Map()` etc.
  let hoursPerMonth = 120;

  function render(p: SlotProps) {
    root.style.display = p.state.statsOpen ? '' : 'none';
    clear(grid);
    if (!p.state.statsOpen) return;

    const s = p.data.stats;
    const visibleCount = p.data.visibleTasks ? p.data.visibleTasks.length : s.total;
    const hrsLow  = s.estLow;
    const hrsHigh = s.est;
    const logged  = s.logged;
    const needDates = s.needDates;

    const moLow  = hrsLow  > 0 ? (hrsLow  / hoursPerMonth).toFixed(1) : '0.0';
    const moHigh = hrsHigh > 0 ? (hrsHigh / hoursPerMonth).toFixed(1) : '0.0';
    const hrsRange = hrsLow < hrsHigh && hrsLow > 0
      ? (hrsLow + '–' + hrsHigh + 'h')
      : (hrsHigh + 'h');
    const activeHint = needDates > 0
      ? needDates + ' need dates'
      : 'all scheduled';

    grid.appendChild(kpiCard('Items in View',       String(visibleCount), 'slate'));
    grid.appendChild(kpiCard('Active (scheduled)',  String(s.scheduled),  'emerald', activeHint));
    grid.appendChild(kpiCard('Scheduled',           String(s.scheduled),  'blue',    'of ' + s.total + ' total'));
    grid.appendChild(kpiCard('Hours Logged',        logged + 'h',         'purple',  'Actuals'));
    grid.appendChild(kpiCard('Hours Range',         hrsRange,             'amber',   'Estimate envelope'));

    // Sixth card: editable "Months to complete"
    const mcard = el('div', CLS_KPI_CARD_BASE + ' border-indigo-200');
    const mlbl = el('p', CLS_KPI_LABEL + ' text-indigo-700');
    mlbl.textContent = 'Months to complete';
    mcard.appendChild(mlbl);

    const mval = el('p', CLS_KPI_VALUE + ' text-indigo-700');
    mval.textContent = moLow + '–' + moHigh;
    mcard.appendChild(mval);

    const row = el('div', 'mt-0.5 flex items-center gap-1');
    const atSpan = el('span', 'text-[9px] text-indigo-700');
    atSpan.textContent = 'at';
    const input = el('input',
      'w-12 text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1 py-0.5 text-center'
    ) as HTMLInputElement;
    input.type = 'number';
    input.min = '1';
    input.value = String(hoursPerMonth);
    input.addEventListener('input', () => {
      const n = Math.max(1, Number(input.value) || 120);
      hoursPerMonth = n;
      const newLow  = hrsLow  > 0 ? (hrsLow  / hoursPerMonth).toFixed(1) : '0.0';
      const newHigh = hrsHigh > 0 ? (hrsHigh / hoursPerMonth).toFixed(1) : '0.0';
      mval.textContent = newLow + '–' + newHigh;
    });
    const unit = el('span', 'text-[9px] text-indigo-700');
    unit.textContent = 'h/mo';

    row.appendChild(atSpan);
    row.appendChild(input);
    row.appendChild(unit);
    mcard.appendChild(row);

    grid.appendChild(mcard);
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
