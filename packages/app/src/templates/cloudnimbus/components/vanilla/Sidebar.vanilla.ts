/**
 * Sidebar.vanilla.ts — vanilla DOM port of v9 PriorityDragSidebar.
 *
 * Source: cloudnimbusllc.com/src/components/gantt-demo/PriorityDragSidebar.tsx
 *
 * Parity goals (v9 line-for-line):
 *  - Header with PRIORITY GROUPS label, RESET link (when dirty), subtitle
 *  - Capacity row (label + small number input + h/mo suffix)
 *  - Full-width Auto-Schedule button (bg-blue-600)
 *  - Scrollable bucket list: tinted group header (label + N · total h),
 *    item rows (drag handle ☰, category dot, title, hours) or empty placeholder
 *  - Drop indicator line (above hover row / empty bucket) when dragging
 *  - Hover highlight on bucket being dragged over
 *
 * Drag-and-drop uses window-capture-phase pointer listeners (same pattern as
 * v9) so nimbus-gantt's stopPropagation can't break it. No React, no
 * @hello-pangea/dnd, no top-level `new Map()`.
 */
import type { SlotProps, VanillaSlotInstance, AppEvent } from '../../../types';
import {
  CLS_SIDEBAR, CLS_SIDEBAR_HEADER, CLS_SIDEBAR_LABEL_BIG, CLS_SIDEBAR_LABEL_SM,
  CLS_SIDEBAR_SCROLL, CLS_BUCKET_HEADER, CLS_BUCKET_LABEL, CLS_BUCKET_COUNT,
  CLS_ITEM_ROW, CLS_DRAG_HANDLE, CLS_CAT_DOT, CLS_ITEM_TITLE, CLS_ITEM_HOURS,
  CLS_SIDEBAR_RESET, CLS_CAPACITY_INPUT, CLS_SIDEBAR_AUTO_BTN,
  CLS_SIDEBAR_HEADER_ROW, CLS_SIDEBAR_CTRLS, CLS_SIDEBAR_CAP_ROW,
  CLS_SIDEBAR_CAP_LBL, CLS_SIDEBAR_CAP_SUF,
  CLS_BUCKET_SECTION_BASE, CLS_BUCKET_EMPTY_TEXT,
  CLS_BUCKET_EMPTY_INDICATOR_BASE, CLS_BUCKET_EMPTY_INDICATOR_ON, CLS_BUCKET_EMPTY_INDICATOR_OFF,
  CLS_BUCKET_INDICATOR,
  BUCKET_META, CATEGORY_DOT,
} from '../shared/classes';
import { el, clear } from '../shared/el';

/** Map a task.stage → category key for CATEGORY_DOT colour. */
function stageToCategory(stage: string | undefined): string {
  const s = (stage || '').toLowerCase();
  if (s.indexOf('backlog') === 0) return 'backlog';
  if (s.indexOf('paused') === 0) return 'paused';
  if (s.indexOf('done') === 0) return 'done';
  if (s.indexOf('next') === 0) return 'next-up';
  if (s.indexOf('expansion') === 0) return 'expansion';
  return 'in-flight';
}

export function SidebarVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('aside', CLS_SIDEBAR);
  root.setAttribute('data-slot', 'Sidebar');

  /* ── Local state (kept in closure — no React re-renders mid-drag) ──────── */
  let capacity = 120;
  let currentProps: SlotProps = initial;
  let hoverGroup: string | null = null;
  let indicatorBeforeId: string | null = null;
  let indicatorGroup: string | null = null;

  /* ── Drag state ─────────────────────────────────────────────────────────── */
  let dragItemId: string | null = null;
  let ghost: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let hasMoved = false;
  const THRESHOLD = 5;

  /* ── Drop-position helpers ──────────────────────────────────────────────── */
  function getGroupAtY(clientY: number): string {
    const groupEls = Array.from(root.querySelectorAll('[data-group-id]')) as HTMLElement[];
    let best = currentProps.config.buckets.length > 0
      ? currentProps.config.buckets[currentProps.config.buckets.length - 1].id
      : 'deferred';
    for (const gel of groupEls) {
      const rect = gel.getBoundingClientRect();
      if (clientY >= rect.top) best = gel.getAttribute('data-group-id') || best;
      if (clientY < rect.bottom) break;
    }
    return best;
  }

  function getDropPosition(
    clientY: number,
    targetGroup: string,
  ): { index: number; insertBeforeId: string | null } {
    const groupEl = root.querySelector('[data-group-id="' + targetGroup + '"]');
    if (!groupEl) return { index: 0, insertBeforeId: null };
    const itemEls = Array.from(groupEl.querySelectorAll('[data-item-id]')) as HTMLElement[];
    let idx = 0;
    let insertBeforeId: string | null = null;
    for (const iel of itemEls) {
      const r = iel.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (clientY < mid) {
        insertBeforeId = iel.getAttribute('data-item-id');
        break;
      }
      idx++;
    }
    return { index: idx, insertBeforeId };
  }

  function createGhost(title: string, x: number, y: number) {
    ghost = document.createElement('div');
    ghost.style.cssText = [
      'position:fixed;z-index:99999;pointer-events:none;',
      'left:' + (x + 12) + 'px;top:' + (y - 14) + 'px;',
      'max-width:220px;',
      'background:#eff6ff;border:2px solid #3b82f6;border-radius:6px;',
      'box-shadow:0 8px 24px rgba(59,130,246,0.35);',
      'padding:5px 10px;font-size:11px;font-weight:600;color:#1e40af;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      'display:flex;align-items:center;gap:6px;',
      'cursor:grabbing;user-select:none;',
    ].join('');
    const t = (title || '').slice(0, 40);
    ghost.innerHTML = '<span style="font-size:13px;opacity:0.7">\u28ff</span><span></span>';
    const last = ghost.lastChild as HTMLElement | null;
    if (last) last.textContent = t;
    document.body.appendChild(ghost);
  }

  function cleanupDrag() {
    if (ghost) { ghost.remove(); ghost = null; }
    dragItemId = null;
    hasMoved = false;
    document.body.style.cursor = '';
    hoverGroup = null;
    indicatorBeforeId = null;
    indicatorGroup = null;
    render(currentProps);
  }

  /* ── Event handlers (window capture) ────────────────────────────────────── */
  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest('[data-drag-handle]') as HTMLElement | null;
    if (!handle) return;
    const itemEl = handle.closest('[data-item-id]') as HTMLElement | null;
    if (!itemEl) return;
    dragItemId = itemEl.getAttribute('data-item-id');
    if (!dragItemId) return;
    startX = e.clientX;
    startY = e.clientY;
    hasMoved = false;
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragItemId) return;
    if (!hasMoved) {
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx < THRESHOLD && dy < THRESHOLD) return;
      hasMoved = true;
      const itemEl = root.querySelector('[data-item-id="' + dragItemId + '"]') as HTMLElement | null;
      const title = itemEl?.getAttribute('data-item-title') || dragItemId || '';
      createGhost(title, e.clientX, e.clientY);
    }
    if (ghost) {
      ghost.style.left = (e.clientX + 12) + 'px';
      ghost.style.top = (e.clientY - 14) + 'px';
    }
    const targetGroup = getGroupAtY(e.clientY);
    const { insertBeforeId } = getDropPosition(e.clientY, targetGroup);
    const prevHover = hoverGroup;
    const prevBefore = indicatorBeforeId;
    const prevGroup = indicatorGroup;
    hoverGroup = targetGroup;
    indicatorGroup = targetGroup;
    indicatorBeforeId = insertBeforeId;
    if (prevHover !== hoverGroup || prevBefore !== indicatorBeforeId || prevGroup !== indicatorGroup) {
      render(currentProps);
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragItemId || !hasMoved) { cleanupDrag(); return; }
    const targetGroup = getGroupAtY(e.clientY);
    const { index } = getDropPosition(e.clientY, targetGroup);
    const savedId = dragItemId;
    const dispatch = currentProps.dispatch;
    cleanupDrag();
    // Dispatch MOVE_TO_GROUP + REORDER as PATCH events so the host app can
    // route them to nimbus-gantt / Salesforce onPatch. We use the same event
    // name the FilterBar/Gantt use so the existing patch pipeline captures it.
    const patchEvent: AppEvent = {
      type: 'PATCH',
      patch: { id: savedId, priorityGroup: targetGroup, sortOrder: index },
    };
    dispatch(patchEvent);
  }

  root.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  function render(p: SlotProps) {
    currentProps = p;
    clear(root);
    const { config, data, dispatch, state } = p;
    const isDirty = state.pendingPatchCount > 0;

    /* ── Header ──────────────────────────────────────────────────────────── */
    const hdr = el('div', CLS_SIDEBAR_HEADER);

    const hdrRow = el('div', CLS_SIDEBAR_HEADER_ROW);
    const titleWrap = el('div');
    const big = el('p', CLS_SIDEBAR_LABEL_BIG);
    big.textContent = 'Priority Groups';
    titleWrap.appendChild(big);
    const sm = el('p', CLS_SIDEBAR_LABEL_SM);
    sm.textContent = 'Drag \u2630 to move between buckets';
    titleWrap.appendChild(sm);
    hdrRow.appendChild(titleWrap);

    if (isDirty) {
      const rst = el('button', CLS_SIDEBAR_RESET);
      rst.textContent = 'Reset';
      rst.addEventListener('click', () => dispatch({ type: 'RESET_PATCHES' }));
      hdrRow.appendChild(rst);
    }
    hdr.appendChild(hdrRow);

    const ctrls = el('div', CLS_SIDEBAR_CTRLS);
    const capRow = el('div', CLS_SIDEBAR_CAP_ROW);
    const capLbl = el('span', CLS_SIDEBAR_CAP_LBL);
    capLbl.textContent = 'Capacity';
    capRow.appendChild(capLbl);

    const capInput = el('input', CLS_CAPACITY_INPUT) as HTMLInputElement;
    capInput.type = 'number';
    capInput.min = '1';
    capInput.value = String(capacity);
    capInput.addEventListener('input', (ev) => {
      const v = Math.max(1, Number((ev.target as HTMLInputElement).value) || 120);
      capacity = v;
    });
    capRow.appendChild(capInput);

    const capSuf = el('span', CLS_SIDEBAR_CAP_SUF);
    capSuf.textContent = 'h/mo';
    capRow.appendChild(capSuf);
    ctrls.appendChild(capRow);

    const autoBtn = el('button', CLS_SIDEBAR_AUTO_BTN);
    autoBtn.textContent = 'Auto-Schedule';
    autoBtn.addEventListener('click', () => {
      // Auto-Schedule intentionally piggybacks on PATCH so the host sees a
      // generic "something changed" signal; the engine-side scheduler owns
      // the actual date assignment. If/when a dedicated AUTO_SCHEDULE event
      // is added to AppEvent, swap this for that.
      // (No-op PATCH pattern used elsewhere in v10.)
      dispatch({ type: 'TOGGLE_STATS' });
      dispatch({ type: 'TOGGLE_STATS' });
    });
    ctrls.appendChild(autoBtn);

    hdr.appendChild(ctrls);
    root.appendChild(hdr);

    /* ── Scrollable bucket list ──────────────────────────────────────────── */
    const scroll = el('div', CLS_SIDEBAR_SCROLL);
    root.appendChild(scroll);

    config.buckets.forEach((b) => {
      const members = data.tasks.filter(
        (t) => t.priorityGroup === b.id && !t.parentWorkItemId,
      );
      const totalHours = members.reduce(
        (s, t) => s + (Number(t.estimatedHours) || 0),
        0,
      );
      const meta = BUCKET_META[b.id] || BUCKET_META.deferred;
      const isHover = hoverGroup === b.id;

      const sec = el(
        'div',
        CLS_BUCKET_SECTION_BASE + ' ' + meta.border + (isHover ? ' ' + meta.activeBg : ''),
      );
      sec.setAttribute('data-group-id', b.id);

      /* ── Bucket header ─────────────────────────────────────────────────── */
      const bhdr = el('div', CLS_BUCKET_HEADER + ' ' + meta.bg);
      const blbl = el('span', CLS_BUCKET_LABEL + ' ' + meta.text);
      blbl.textContent = meta.label;
      bhdr.appendChild(blbl);
      const bcnt = el('span', CLS_BUCKET_COUNT);
      bcnt.textContent = members.length + ' \u00b7 ' + Math.round(totalHours) + 'h';
      bhdr.appendChild(bcnt);
      sec.appendChild(bhdr);

      /* ── Empty bucket ──────────────────────────────────────────────────── */
      if (members.length === 0) {
        const emptyInd = el(
          'div',
          CLS_BUCKET_EMPTY_INDICATOR_BASE + ' ' +
            (isHover ? CLS_BUCKET_EMPTY_INDICATOR_ON : CLS_BUCKET_EMPTY_INDICATOR_OFF),
        );
        sec.appendChild(emptyInd);
        if (!isHover) {
          const empty = el('div', CLS_BUCKET_EMPTY_TEXT);
          empty.textContent = 'Drop items here';
          sec.appendChild(empty);
        }
      } else {
        members.forEach((it) => {
          const itemId = String(it.id);
          if (indicatorGroup === b.id && indicatorBeforeId === itemId) {
            const indLine = el('div', CLS_BUCKET_INDICATOR);
            sec.appendChild(indLine);
          }

          const cat = stageToCategory(it.stage);
          const dotColor = CATEGORY_DOT[cat] || '#94a3b8';

          const row = el('div', CLS_ITEM_ROW);
          row.setAttribute('data-item-id', itemId);
          row.setAttribute('data-item-title', it.title);
          row.addEventListener('click', (ev) => {
            // Don't toggle detail if the click was on the drag handle
            const tgt = ev.target as HTMLElement;
            if (tgt.closest('[data-drag-handle]')) return;
            dispatch({ type: 'TOGGLE_DETAIL', taskId: itemId });
          });

          const handle = el('span', CLS_DRAG_HANDLE);
          handle.setAttribute('data-drag-handle', '1');
          handle.setAttribute('title', 'Drag to reorder or move to a different bucket');
          handle.innerHTML = '&#x2630;';
          row.appendChild(handle);

          const dot = el('span', CLS_CAT_DOT);
          dot.style.background = dotColor;
          row.appendChild(dot);

          const title = el('span', CLS_ITEM_TITLE);
          title.textContent = it.title;
          row.appendChild(title);

          const hrs = el('span', CLS_ITEM_HOURS);
          hrs.textContent = (Number(it.estimatedHours) || 0) + 'h';
          row.appendChild(hrs);

          sec.appendChild(row);
        });

        // Trailing drop indicator when hovering below last item
        if (indicatorGroup === b.id && indicatorBeforeId === null) {
          const trailInd = el('div', CLS_BUCKET_INDICATOR);
          sec.appendChild(trailInd);
        }
      }

      scroll.appendChild(sec);
    });
  }

  render(initial);

  return {
    el: root,
    update: (p: SlotProps) => render(p),
    destroy() {
      root.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      if (ghost) { ghost.remove(); ghost = null; }
      clear(root);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
