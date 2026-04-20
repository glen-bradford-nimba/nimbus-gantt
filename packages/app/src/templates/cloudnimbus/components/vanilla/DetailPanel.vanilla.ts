/**
 * DetailPanel.vanilla.ts — vanilla DOM DetailPanel (Phase 3: edit mode).
 *
 * Reads `state.detailMode` to decide view vs edit. Pencil button dispatches
 * SET_DETAIL_MODE. In edit mode `startDate` / `endDate` render as <input>
 * controls; Save dispatches a PATCH event (same as drag/resize). Kept in
 * lockstep with the React slot so SF Locker / LWS consumers of the IIFE
 * bundle get identical UX.
 */
import type { SlotProps, VanillaSlotInstance } from '../../../types';
import { CLS_DETAIL, CLS_DETAIL_HEADER, CLS_DETAIL_BODY, CLS_CATEGORY_PILL } from '../shared/classes';
import { el, clear } from '../shared/el';

export function DetailPanelVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_DETAIL);
  root.setAttribute('data-slot', 'DetailPanel');

  // Local draft state — mirrors the React slot's useState. Re-initialised
  // every time the selected task or edit mode flips.
  let draftStart = '';
  let draftEnd = '';
  let lastRenderedKey = '';

  function render(p: SlotProps) {
    clear(root);
    const { state, data, dispatch } = p;
    if (!state.selectedTaskId) { root.style.display = 'none'; return; }
    const task = data.tasks.find((t) => String(t.id) === state.selectedTaskId);
    if (!task) { root.style.display = 'none'; return; }
    root.style.display = '';

    const editing = state.detailMode === 'edit';
    const catColor = '#64748b';
    root.style.bottom = '80px';
    root.style.right  = '24px';
    root.style.width  = '380px';
    root.style.borderColor = catColor;
    root.setAttribute('data-detail-mode', state.detailMode);

    // Reset draft when task id or editing flag changes — prevents stale
    // values leaking between tasks / view↔edit transitions.
    const renderKey = `${task.id}|${editing ? 1 : 0}|${task.startDate || ''}|${task.endDate || ''}`;
    if (renderKey !== lastRenderedKey) {
      draftStart = task.startDate || '';
      draftEnd = task.endDate || '';
      lastRenderedKey = renderKey;
    }

    /* ── Header ─────────────────────────────────────────────────────────── */
    const header = el('div', CLS_DETAIL_HEADER);
    header.style.background = catColor + '15';
    const lwrap = el('div', 'flex items-center gap-2 min-w-0');
    const dot = el('span', 'w-2.5 h-2.5 rounded-full flex-shrink-0');
    dot.style.background = catColor;
    lwrap.appendChild(dot);
    // 0.185.4 — when config.recordUrlTemplate is set, render the ID as an
    // `<a href>` so users can navigate to the underlying record. Template
    // replaces `{id}` with the task id. When absent, ID stays plain text
    // (legacy). Library never navigates itself — the anchor is a passive
    // <a> and the browser/host handles the nav.
    const urlTemplate = p.config?.recordUrlTemplate;
    let idEl: HTMLElement;
    if (urlTemplate && task.id) {
      const a = document.createElement('a');
      a.className = 'text-[10px] font-mono font-bold text-slate-500 hover:text-slate-900 hover:underline flex-shrink-0';
      a.textContent = String(task.id);
      a.href = urlTemplate.replace('{id}', encodeURIComponent(String(task.id)));
      a.setAttribute('target', '_top');
      a.setAttribute('title', 'Open record');
      // Don't let the click bubble to row-click handlers that might toggle
      // the detail panel closed on us.
      a.addEventListener('click', (e) => { e.stopPropagation(); });
      idEl = a;
    } else {
      idEl = el('span', 'text-[10px] font-mono font-bold text-slate-500 flex-shrink-0');
      idEl.textContent = String(task.id);
    }
    lwrap.appendChild(idEl);
    const titleSp = el('span', 'text-xs font-bold text-slate-900 truncate');
    titleSp.textContent = task.title;
    lwrap.appendChild(titleSp);
    header.appendChild(lwrap);

    const rwrap = el('div', 'flex items-center gap-1 flex-shrink-0 ml-2');

    // Pencil edit-toggle button — SF Locker can't do contextmenu, so this
    // is the canonical single-click path into edit mode.
    const editBtn = el(
      'button',
      editing
        ? 'text-fuchsia-600 hover:text-fuchsia-800 text-sm px-1 transition-colors'
        : 'text-slate-400 hover:text-slate-700 text-sm px-1 transition-colors',
    );
    editBtn.setAttribute('data-testid', 'detail-edit-toggle');
    editBtn.setAttribute('title', editing ? 'Exit edit mode' : 'Edit');
    editBtn.setAttribute('aria-pressed', editing ? 'true' : 'false');
    editBtn.textContent = '\u270E'; // pencil glyph
    editBtn.addEventListener('click', () => {
      dispatch({ type: 'SET_DETAIL_MODE', mode: editing ? 'view' : 'edit' });
    });
    rwrap.appendChild(editBtn);

    const closeBtn = el('button', 'text-slate-400 hover:text-slate-700 text-sm px-1 transition-colors');
    closeBtn.textContent = '\u00D7'; // ×
    closeBtn.setAttribute('title', 'Close');
    closeBtn.addEventListener('click', () => dispatch({ type: 'TOGGLE_DETAIL' }));
    rwrap.appendChild(closeBtn);
    header.appendChild(rwrap);
    root.appendChild(header);

    /* ── Body ───────────────────────────────────────────────────────────── */
    const body = el('div', CLS_DETAIL_BODY);
    const pill = el('span', CLS_CATEGORY_PILL);
    pill.style.background = catColor + '20';
    pill.style.color = catColor;
    pill.textContent = task.stage || '\u2014';
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
    function inpField(
      label: string,
      type: 'text' | 'date' | 'number',
      value: string,
      onInput: (v: string) => void,
    ) {
      const w = el('div', '');
      const l = el('p', 'text-[9px] text-slate-400 uppercase tracking-wide');
      l.textContent = label;
      const input = document.createElement('input');
      input.type = type;
      input.value = value;
      input.className =
        'w-full px-1.5 py-0.5 text-xs text-slate-900 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-fuchsia-400';
      input.addEventListener('input', () => onInput(input.value));
      w.appendChild(l); w.appendChild(input);
      grid.appendChild(w);
    }
    fld('Status',   task.stage || '\u2014');
    fld('Priority', task.priorityGroup || '\u2014');
    if (editing) {
      inpField('Start', 'date', draftStart, (v) => { draftStart = v; });
      inpField('End',   'date', draftEnd,   (v) => { draftEnd   = v; });
    } else {
      fld('Start', task.startDate || '\u2014');
      fld('End',   task.endDate   || '\u2014');
    }
    fld('Estimated', task.estimatedHours ? task.estimatedHours + 'h' : '\u2014');
    fld('Logged',    task.loggedHours ? task.loggedHours + 'h' : '\u2014');
    body.appendChild(grid);

    if (editing) {
      const actions = el('div', 'pt-2 border-t border-slate-100 flex gap-2');
      const saveBtn = el(
        'button',
        'flex-1 text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors',
      );
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => {
        const patch: { id: string; startDate?: string; endDate?: string } = {
          id: String(task.id),
        };
        if (draftStart !== (task.startDate || '')) patch.startDate = draftStart;
        if (draftEnd   !== (task.endDate   || '')) patch.endDate   = draftEnd;
        if (patch.startDate !== undefined || patch.endDate !== undefined) {
          dispatch({ type: 'PATCH', patch });
        }
        dispatch({ type: 'SET_DETAIL_MODE', mode: 'view' });
      });
      actions.appendChild(saveBtn);

      const cancelBtn = el(
        'button',
        'flex-1 text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors',
      );
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        draftStart = task.startDate || '';
        draftEnd   = task.endDate   || '';
        dispatch({ type: 'SET_DETAIL_MODE', mode: 'view' });
      });
      actions.appendChild(cancelBtn);
      body.appendChild(actions);
    }

    root.appendChild(body);
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
