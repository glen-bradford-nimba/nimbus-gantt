/**
 * DetailPanel.vanilla.ts — vanilla DOM DetailPanel (Phase 3: edit mode).
 *
 * Reads `state.detailMode` to decide view vs edit. Pencil button dispatches
 * SET_DETAIL_MODE. In edit mode `startDate` / `endDate` render as <input>
 * controls; Save dispatches a PATCH event (same as drag/resize). Kept in
 * lockstep with the React slot so SF Locker / LWS consumers of the IIFE
 * bundle get identical UX.
 */
import type { SlotProps, VanillaSlotInstance, FieldDescriptor } from '../../../types';
import { CLS_DETAIL, CLS_DETAIL_HEADER, CLS_DETAIL_BODY, CLS_CATEGORY_PILL } from '../shared/classes';
import { el, clear } from '../shared/el';

export function DetailPanelVanilla(
  initial: SlotProps,
  // 0.185.18 — optional override: when given, this panel instance renders
  // the specified task regardless of state.selectedTaskId. ContentArea
  // passes this when iterating state.openDetailTaskIds so each panel
  // stays pinned to its own task. When omitted, falls back to the
  // pre-0.185.18 behavior of rendering state.selectedTaskId.
  forTaskId?: string,
): VanillaSlotInstance {
  const root = el('div', CLS_DETAIL);
  root.setAttribute('data-slot', 'DetailPanel');
  if (forTaskId) root.setAttribute('data-task-id', forTaskId);

  // Local draft state — mirrors the React slot's useState. Re-initialised
  // every time the selected task or edit mode flips.
  // 0.185.15 — generalized from {draftStart, draftEnd} to a keyed map so
  // DetailPanel can render arbitrary field schemas provided by the host.
  // Legacy date-only fields still work when config.fieldSchema is absent.
  let drafts: Record<string, unknown> = {};
  let lastRenderedKey = '';
  // 0.185.17 — draggable panel state. When the user drags the header, we
  // switch from the default right/bottom anchor to an absolute left/top
  // position. Null means "use defaults." Persists across task switches
  // within the same mount (user drags the panel, it stays there) so the
  // multi-instance follow-up (0.185.18) can stack them without re-teaching
  // the user where each panel is.
  let panelX: number | null = null;
  let panelY: number | null = null;
  let headerDragging = false;
  let headerDragStartX = 0;
  let headerDragStartY = 0;
  let headerDragOrigX = 0;
  let headerDragOrigY = 0;

  function onHeaderDragMove(e: MouseEvent): void {
    if (!headerDragging) return;
    const dx = e.clientX - headerDragStartX;
    const dy = e.clientY - headerDragStartY;
    panelX = headerDragOrigX + dx;
    panelY = headerDragOrigY + dy;
    // Apply position directly (skip full re-render — cheap + focus-safe).
    root.style.left = panelX + 'px';
    root.style.top = panelY + 'px';
    root.style.right = '';
    root.style.bottom = '';
  }
  function onHeaderDragEnd(): void {
    headerDragging = false;
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onHeaderDragMove);
    window.removeEventListener('mouseup',   onHeaderDragEnd);
  }

  function render(p: SlotProps) {
    clear(root);
    const { state, data, dispatch } = p;
    // 0.185.18 — if this panel instance is pinned to a specific taskId
    // (multi-panel case), render that task. Otherwise fall back to
    // state.selectedTaskId for single-panel legacy behavior.
    const targetId = forTaskId || state.selectedTaskId;
    if (!targetId) { root.style.display = 'none'; return; }
    const task = data.tasks.find((t) => String(t.id) === targetId);
    if (!task) { root.style.display = 'none'; return; }
    root.style.display = '';

    const editing = state.detailMode === 'edit';
    const catColor = '#64748b';
    // 0.185.17 — position: use dragged location if set, else default
    // anchor (bottom-right). Both paths keep the panel inside the
    // container via the same width/border settings.
    if (panelX != null && panelY != null) {
      root.style.left = panelX + 'px';
      root.style.top = panelY + 'px';
      root.style.right = '';
      root.style.bottom = '';
    } else {
      root.style.bottom = '80px';
      root.style.right  = '24px';
      root.style.left = '';
      root.style.top = '';
    }
    root.style.width  = '380px';
    root.style.borderColor = catColor;
    root.setAttribute('data-detail-mode', state.detailMode);

    // Reset draft when task id or editing flag changes — prevents stale
    // values leaking between tasks / view↔edit transitions.
    // 0.185.15 — render key now includes fieldSchema identity so switching
    // schemas mid-session (rare) still resets drafts.
    const schema: FieldDescriptor[] | undefined = p.config.fieldSchema;
    const schemaKey = schema ? schema.map((f) => f.key).join(',') : '';
    const renderKey = `${task.id}|${editing ? 1 : 0}|${task.startDate || ''}|${task.endDate || ''}|${schemaKey}`;
    if (renderKey !== lastRenderedKey) {
      drafts = {};
      if (schema && schema.length) {
        for (const f of schema) {
          drafts[f.key] = (task as unknown as Record<string, unknown>)[f.key];
        }
      } else {
        // Legacy date-only defaults.
        drafts.startDate = task.startDate || '';
        drafts.endDate   = task.endDate   || '';
      }
      lastRenderedKey = renderKey;
    }

    /* ── Header ─────────────────────────────────────────────────────────── */
    const header = el('div', CLS_DETAIL_HEADER);
    header.style.background = catColor + '15';
    // 0.185.17 — drag-to-reposition via header. Skip when mousedown lands
    // on a button or anchor (edit toggle, close, record link) so clicks
    // on those controls don't accidentally start a drag.
    header.style.cursor = 'move';
    header.style.userSelect = 'none';
    header.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('button, a, input, select, textarea')) return;
      e.preventDefault();
      // Capture initial pointer + current panel position as the drag origin.
      // If panelX/Y haven't been set yet (still at default right/bottom),
      // read the current bounding rect to seed the absolute position.
      if (panelX == null || panelY == null) {
        const rect = root.getBoundingClientRect();
        const parent = root.parentElement;
        const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
        panelX = rect.left - parentRect.left;
        panelY = rect.top - parentRect.top;
      }
      headerDragging = true;
      headerDragStartX = e.clientX;
      headerDragStartY = e.clientY;
      headerDragOrigX = panelX;
      headerDragOrigY = panelY;
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onHeaderDragMove);
      window.addEventListener('mouseup',   onHeaderDragEnd);
    });
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
    // 0.185.18 — dirty indicator. "•" prefix when any draft differs from
    // task's current value. Useful in multi-panel mode to spot which
    // panels have unsaved edits at a glance.
    let dirty = false;
    if (editing) {
      const dirtyKeys = schema && schema.length
        ? schema.filter((f) => !f.readOnly).map((f) => f.key)
        : ['startDate', 'endDate'];
      for (const k of dirtyKeys) {
        const dv = drafts[k];
        const tv = (task as unknown as Record<string, unknown>)[k];
        const dn = dv == null || dv === '' ? null : dv;
        const tn = tv == null || tv === '' ? null : tv;
        if (dn !== tn) { dirty = true; break; }
      }
    }
    titleSp.textContent = (dirty ? '\u2022 ' : '') + task.title;
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
    // 0.185.18 — multi-instance: when this panel is pinned to a specific
    // task (forTaskId set), × closes just this panel. When running in
    // legacy single-panel mode (forTaskId undefined), fall back to the
    // broad TOGGLE_DETAIL so the old UX still works.
    closeBtn.addEventListener('click', () => {
      if (forTaskId) dispatch({ type: 'CLOSE_DETAIL', taskId: forTaskId });
      else dispatch({ type: 'TOGGLE_DETAIL' });
    });
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
    function fld(label: string, value: string, fullWidth = false) {
      const w = el('div', fullWidth ? 'col-span-2' : '');
      const l = el('p', 'text-[9px] text-slate-400 uppercase tracking-wide');
      l.textContent = label;
      const v = el('p', 'text-slate-900 whitespace-pre-wrap');
      v.textContent = value;
      w.appendChild(l); w.appendChild(v);
      grid.appendChild(w);
    }
    // 0.185.15 — schema-driven field renderer. Handles text/date/number/
    // textarea/picklist/lookup. Textareas auto-span both columns so they
    // don't look cramped. Changes write into the `drafts` map; Save diffs
    // against task on commit. readOnly descriptors render in view style
    // even when `editing` is true.
    function renderField(desc: FieldDescriptor) {
      const fullWidth = desc.type === 'textarea';
      const raw = drafts[desc.key];
      const currentVal = raw == null ? '' : String(raw);
      const readOnly = !!desc.readOnly;
      if (!editing || readOnly) {
        const displayVal = currentVal || '\u2014';
        fld(desc.label, displayVal, fullWidth);
        return;
      }
      const w = el('div', fullWidth ? 'col-span-2' : '');
      const l = el('p', 'text-[9px] text-slate-400 uppercase tracking-wide');
      l.textContent = desc.label;
      w.appendChild(l);
      const inputCls =
        'w-full px-1.5 py-0.5 text-xs text-slate-900 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-fuchsia-400';
      if (desc.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.value = currentVal;
        ta.rows = 3;
        ta.className = inputCls + ' resize-y';
        if (desc.placeholder) ta.placeholder = desc.placeholder;
        ta.addEventListener('input', () => { drafts[desc.key] = ta.value; });
        w.appendChild(ta);
      } else if (desc.type === 'picklist') {
        const sel = document.createElement('select');
        sel.className = inputCls;
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = desc.placeholder || '—';
        sel.appendChild(blank);
        for (const opt of (desc.options || [])) {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          if (opt === currentVal) o.selected = true;
          sel.appendChild(o);
        }
        if (!currentVal) blank.selected = true;
        sel.addEventListener('change', () => { drafts[desc.key] = sel.value; });
        w.appendChild(sel);
      } else {
        // text / date / number / lookup (lookup renders as plain text for now)
        const input = document.createElement('input');
        input.type = desc.type === 'number' ? 'number'
                   : desc.type === 'date'   ? 'date'
                   : 'text';
        input.value = currentVal;
        input.className = inputCls;
        if (desc.placeholder) input.placeholder = desc.placeholder;
        if (desc.type === 'number') {
          if (desc.min !== undefined) input.min = String(desc.min);
          if (desc.max !== undefined) input.max = String(desc.max);
        }
        input.addEventListener('input', () => {
          drafts[desc.key] = desc.type === 'number'
            ? (input.value === '' ? null : Number(input.value))
            : input.value;
        });
        w.appendChild(input);
      }
      grid.appendChild(w);
    }

    if (schema && schema.length) {
      for (const desc of schema) renderField(desc);
    } else {
      // Legacy date-only render path (unchanged behavior when no schema).
      fld('Status',   task.stage || '\u2014');
      fld('Priority', task.priorityGroup || '\u2014');
      if (editing) {
        renderField({ key: 'startDate', label: 'Start', type: 'date' });
        renderField({ key: 'endDate',   label: 'End',   type: 'date' });
      } else {
        fld('Start', task.startDate || '\u2014');
        fld('End',   task.endDate   || '\u2014');
      }
      fld('Estimated', task.estimatedHours ? task.estimatedHours + 'h' : '\u2014');
      fld('Logged',    task.loggedHours ? task.loggedHours + 'h' : '\u2014');
    }
    body.appendChild(grid);

    if (editing) {
      const actions = el('div', 'pt-2 border-t border-slate-100 flex gap-2');
      const saveBtn = el(
        'button',
        'flex-1 text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors',
      );
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => {
        // 0.185.15 — compute diff from drafts against task. Emits only the
        // keys whose drafts differ from the task's current value. When
        // schema is present, routes through the slot-level PATCH event (or
        // a later onItemEdit wire if the host moves that direction); for
        // the legacy date-only path, keeps the exact previous contract so
        // date-only consumers see no behavior change.
        const changes: Record<string, unknown> = {};
        const keys = schema && schema.length
          ? schema.filter((f) => !f.readOnly).map((f) => f.key)
          : ['startDate', 'endDate'];
        for (const k of keys) {
          const draftVal = drafts[k];
          const taskVal = (task as unknown as Record<string, unknown>)[k];
          // Normalize null/undefined/empty-string so "no value" doesn't
          // show as a spurious change on first save.
          const dNorm = draftVal == null || draftVal === '' ? null : draftVal;
          const tNorm = taskVal == null || taskVal === '' ? null : taskVal;
          if (dNorm !== tNorm) changes[k] = draftVal;
        }
        if (Object.keys(changes).length > 0) {
          // Legacy: dispatch PATCH with the task id + change fields inline,
          // matching the previous date-only shape. IIFEApp's interceptor
          // routes this through onPatch / onItemEdit uniformly. Non-date
          // keys flow through the same path now that the callback type
          // accepts Record<string, unknown>.
          const patch: Record<string, unknown> = { id: String(task.id), ...changes };
          dispatch({ type: 'PATCH', patch: patch as unknown as import('../../../types').TaskPatch });
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
        // Reset drafts to task's current values on cancel.
        if (schema && schema.length) {
          drafts = {};
          for (const f of schema) {
            drafts[f.key] = (task as unknown as Record<string, unknown>)[f.key];
          }
        } else {
          drafts.startDate = task.startDate || '';
          drafts.endDate   = task.endDate   || '';
        }
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
    destroy() {
      // 0.185.17 — detach any in-flight drag listeners on unmount so
      // they don't fire against a destroyed panel.
      window.removeEventListener('mousemove', onHeaderDragMove);
      window.removeEventListener('mouseup',   onHeaderDragEnd);
      document.body.style.userSelect = '';
      clear(root);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
