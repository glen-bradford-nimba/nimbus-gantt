/**
 * HrsWkStrip.vanilla.ts — vanilla DOM hrs/wk capacity strip.
 *
 * Ports v9's 16-week rolling capacity bar chart (see v10-spec §9, but with
 * taller bars per the v9 cloudnimbusllc.com reference). Each column is one
 * week, bar height is proportional to scheduled hours, current week is
 * highlighted indigo. Hours are distributed proportionally across weeks a
 * task spans, using estimatedHours as the upper bound.
 */
import type { SlotProps, VanillaSlotInstance, NormalizedTask } from '../../../types';
import {
  CLS_HRSWK, CLS_HRSWK_LABEL, CLS_HRSWK_COL,
} from '../shared/classes';
import { el, clear } from '../shared/el';

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;
const NUM_WEEKS = 16;
/** Pixel height of the bar track (matches v9 HrsWkStrip). */
const TRACK_PX = 32;

interface WeekBucket { label: string; hours: number; isCurrent: boolean }

function computeWeeks(tasks: NormalizedTask[]): WeekBucket[] {
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
      label:   MON[s.getMonth()] + ' ' + String(s.getDate()),
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

export function HrsWkStripVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_HRSWK);
  root.setAttribute('data-slot', 'HrsWkStrip');

  function render(p: SlotProps) {
    clear(root);
    // Default collapsed — TitleBar's Hrs/Wk toggle opens it. Mirrors the
    // AuditPanel pattern: slot always mounts, content hides via display.
    root.style.display = p.state.hrsWkStripOpen ? '' : 'none';
    if (!p.state.hrsWkStripOpen) return;
    const weeks = computeWeeks(p.data.tasks);
    const totalHours = weeks.reduce((s, w) => s + w.hours, 0);
    const maxH = Math.max(1, ...weeks.map((w) => w.hours));

    const lbl = el('span', CLS_HRSWK_LABEL);
    lbl.textContent = 'HRS/WK';
    root.appendChild(lbl);

    if (totalHours === 0) {
      const empty = el('span', 'text-[9px] text-slate-400 italic ml-2');
      empty.textContent = 'No scheduled hours';
      root.appendChild(empty);
      return;
    }

    weeks.forEach((w) => {
      const pct = Math.round((w.hours / maxH) * 100);
      const col = el('div', CLS_HRSWK_COL);

      // Hours number above the bar
      const hrsLbl = el('span', 'text-[9px] font-mono ' + (w.isCurrent ? 'text-indigo-600 font-bold' : 'text-slate-500'));
      hrsLbl.textContent = w.hours + 'h';
      col.appendChild(hrsLbl);

      // Vertical bar track (rendered bottom-up so the fill grows upward)
      const track = el('div', 'w-full rounded-sm overflow-hidden bg-slate-200 relative');
      track.style.height = TRACK_PX + 'px';
      const fill = el('div', 'absolute bottom-0 left-0 right-0 rounded-sm ' +
        (w.isCurrent ? 'bg-indigo-500' : 'bg-slate-400'));
      fill.style.height = pct + '%';
      track.appendChild(fill);
      col.appendChild(track);

      // Week label ("Apr 14" format)
      const dLbl = el('span', 'text-[9px] ' + (w.isCurrent ? 'text-indigo-500 font-semibold' : 'text-slate-500'));
      dLbl.textContent = w.label;
      col.appendChild(dLbl);

      root.appendChild(col);
    });
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
