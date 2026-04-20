/**
 * HrsWkStrip.tsx — v10 8-week hours sparkline (spec §9).
 */
import type { SlotProps } from '../../types';
import { CLS_HRSWK, CLS_HRSWK_LABEL, CLS_HRSWK_COL, CLS_HRSWK_TRACK } from './shared/classes';

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;
const NUM_WEEKS = 8;

function computeWeeks(tasks: SlotProps['data']['tasks']): { label: string; hours: number; isCurrent: boolean }[] {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  const weeks: { startMs: number; endMs: number; label: string; hours: number; isCurrent: boolean }[] = [];
  for (let i = 0; i < NUM_WEEKS; i++) {
    const s = new Date(monday.getTime() + i * WEEK_MS);
    weeks.push({
      startMs: s.getTime(),
      endMs:   s.getTime() + WEEK_MS,
      label:   MON[s.getMonth()] + String(s.getDate()),
      hours:   0,
      isCurrent: i === 0,
    });
  }
  tasks.forEach((t) => {
    const h = Number(t.estimatedHours) || 0;
    if (!h || !t.startDate || !t.endDate || t.isInactive) return;
    const ts = new Date(t.startDate + 'T00:00:00').getTime();
    const te = new Date(t.endDate + 'T00:00:00').getTime();
    const td = Math.max(1, (te - ts) / DAY_MS);
    const hpd = h / td;
    weeks.forEach((w) => {
      const oS = Math.max(ts, w.startMs);
      const oE = Math.min(te, w.endMs);
      if (oE > oS) w.hours += hpd * (oE - oS) / DAY_MS;
    });
  });
  return weeks.map((w) => ({ label: w.label, hours: Math.round(w.hours), isCurrent: w.isCurrent }));
}

export function HrsWkStrip({ data, state }: SlotProps) {
  const weeks = computeWeeks(data.tasks);
  const maxH = Math.max(1, ...weeks.map((w) => w.hours));
  if (!state.hrsWkStripOpen) return null;
  return (
    <div className={CLS_HRSWK} data-slot="HrsWkStrip">
      <span className={CLS_HRSWK_LABEL}>Hrs/wk</span>
      {weeks.map((w) => {
        const pct = Math.round((w.hours / maxH) * 100);
        return (
          <div key={w.label} className={CLS_HRSWK_COL}>
            <span className={'text-[9px] font-bold ' + (w.isCurrent ? 'text-indigo-600' : 'text-slate-500')}>
              {w.hours}h
            </span>
            <div className={CLS_HRSWK_TRACK}>
              <div
                className={'h-full rounded-sm ' + (w.isCurrent ? 'bg-indigo-500' : 'bg-slate-400')}
                style={{ width: pct + '%' }}
              />
            </div>
            <span className={'text-[8px] ' + (w.isCurrent ? 'text-indigo-500 font-semibold' : 'text-slate-400')}>
              {w.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
