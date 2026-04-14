/**
 * StatsPanel.tsx — v10 6-card KPI strip (spec §5).
 */
import type { SlotProps } from '../../types';
import {
  CLS_STATS_PANEL, CLS_STATS_GRID,
  CLS_KPI_CARD_BASE, CLS_KPI_LABEL, CLS_KPI_VALUE, CLS_KPI_HINT,
  STATS_TONE,
} from './shared/classes';

function KpiCard({ label, value, tone, hint }: { label: string; value: string; tone: keyof typeof STATS_TONE; hint?: string }) {
  const t = STATS_TONE[tone] || STATS_TONE.slate;
  return (
    <div className={CLS_KPI_CARD_BASE + ' ' + t.border}>
      <p className={CLS_KPI_LABEL + ' ' + t.label}>{label}</p>
      <p className={CLS_KPI_VALUE + ' ' + t.value}>{value}</p>
      {hint ? <p className={CLS_KPI_HINT}>{hint}</p> : null}
    </div>
  );
}

export function StatsPanel({ state, data }: SlotProps) {
  if (!state.statsOpen) return null;
  const s = data.stats;
  const hrsLow  = s.estLow;
  const hrsHigh = s.est;
  const logged  = s.logged;
  const hoursPerMonth = 120;
  const monthsLow  = hrsLow  > 0 ? (hrsLow  / hoursPerMonth).toFixed(1) : '0';
  const monthsHigh = hrsHigh > 0 ? (hrsHigh / hoursPerMonth).toFixed(1) : '0';
  const hoursRange = hrsLow < hrsHigh && hrsLow > 0 ? (hrsLow + '–' + hrsHigh + 'h') : (hrsHigh + 'h');

  return (
    <div className={CLS_STATS_PANEL} data-slot="StatsPanel">
      <div className={CLS_STATS_GRID}>
        <KpiCard label="Items in View"       value={String(s.total)}     tone="slate" />
        <KpiCard label="Active (scheduled)"  value={String(s.scheduled)} tone="emerald" />
        <KpiCard label="Scheduled"           value={String(s.scheduled)} tone="blue"    hint={'of ' + s.total + ' total'} />
        <KpiCard label="Hours Logged"        value={logged + 'h'}        tone="purple"  hint="Actuals" />
        <KpiCard label="Hours Range"         value={hoursRange}          tone="amber"   hint="Estimate envelope" />
        <div className={CLS_KPI_CARD_BASE + ' border-indigo-200'}>
          <p className={CLS_KPI_LABEL + ' text-indigo-700'}>Months to complete</p>
          <p className={CLS_KPI_VALUE + ' text-indigo-700'}>{monthsLow}–{monthsHigh}</p>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="text-[9px] text-indigo-700">at</span>
            <span className="text-[10px] font-mono font-bold text-indigo-700">{hoursPerMonth}</span>
            <span className="text-[9px] text-indigo-700">h/mo</span>
          </div>
        </div>
      </div>
    </div>
  );
}
