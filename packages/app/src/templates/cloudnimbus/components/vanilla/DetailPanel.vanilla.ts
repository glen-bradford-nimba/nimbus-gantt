/**
 * DetailPanel.vanilla.ts — vanilla DOM DetailPanel.
 */
import type { SlotProps, VanillaSlotInstance } from '../../../types';
import { CLS_DETAIL, CLS_DETAIL_HEADER, CLS_DETAIL_BODY, CLS_CATEGORY_PILL } from '../shared/classes';
import { el, clear } from '../shared/el';

export function DetailPanelVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_DETAIL);
  root.setAttribute('data-slot', 'DetailPanel');

  function render(p: SlotProps) {
    clear(root);
    const { state, data, dispatch } = p;
    if (!state.selectedTaskId) { root.style.display = 'none'; return; }
    const task = data.tasks.find((t) => String(t.id) === state.selectedTaskId);
    if (!task) { root.style.display = 'none'; return; }
    root.style.display = '';
    const catColor = '#64748b';
    root.style.bottom = '80px';
    root.style.right  = '24px';
    root.style.width  = '380px';
    root.style.borderColor = catColor;

    const header = el('div', CLS_DETAIL_HEADER);
    header.style.background = catColor + '15';
    const lwrap = el('div', 'flex items-center gap-2 min-w-0');
    const dot = el('span', 'w-2.5 h-2.5 rounded-full flex-shrink-0');
    dot.style.background = catColor;
    lwrap.appendChild(dot);
    const idSp = el('span', 'text-[10px] font-mono font-bold text-slate-500 flex-shrink-0');
    idSp.textContent = String(task.id);
    lwrap.appendChild(idSp);
    const titleSp = el('span', 'text-xs font-bold text-slate-900 truncate');
    titleSp.textContent = task.title;
    lwrap.appendChild(titleSp);
    header.appendChild(lwrap);

    const rwrap = el('div', 'flex items-center gap-1 flex-shrink-0 ml-2');
    const closeBtn = el('button', 'text-slate-400 hover:text-slate-700 text-sm px-1 transition-colors');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => dispatch({ type: 'TOGGLE_DETAIL' }));
    rwrap.appendChild(closeBtn);
    header.appendChild(rwrap);
    root.appendChild(header);

    const body = el('div', CLS_DETAIL_BODY);
    const pill = el('span', CLS_CATEGORY_PILL);
    pill.style.background = catColor + '20';
    pill.style.color = catColor;
    pill.textContent = task.stage || '—';
    const pillWrap = el('div', 'flex items-center gap-2');
    pillWrap.appendChild(pill);
    body.appendChild(pillWrap);

    const grid = el('div', 'grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1');
    function fld(label: string, value: string) {
      const w = el('div', '');
      const l = el('p', 'text-[9px] text-slate-400 uppercase tracking-wide');
      l.textContent = label;
      const v = el('p', 'text-slate-900');
      v.textContent = value;
      w.appendChild(l); w.appendChild(v);
      grid.appendChild(w);
    }
    fld('Status',   task.stage || '—');
    fld('Priority', task.priorityGroup || '—');
    fld('Start',    task.startDate || '—');
    fld('End',      task.endDate || '—');
    fld('Estimated', task.estimatedHours ? task.estimatedHours + 'h' : '—');
    fld('Logged',    task.loggedHours ? task.loggedHours + 'h' : '—');
    body.appendChild(grid);
    root.appendChild(body);
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
