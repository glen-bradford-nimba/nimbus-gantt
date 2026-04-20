/**
 * FilterBar.vanilla.ts — vanilla DOM FilterBar slot. Ports v9's JSX
 * (cloudnimbusllc.com DeliveryTimelineV5.tsx lines ~1986-2148) so Salesforce
 * IIFE renders match the v9 look line-for-line.
 *
 * Layout order (mirrors v9):
 *   1. "View:" label
 *   2. 6 filter chips (Active / Proposal / Done / Real / Workstreams / Everything)
 *   3. "|"
 *   4. Search box (🔎 icon + input + × clear)
 *   5. "|"
 *   6. "Colors:" label
 *   7. Category chips (swatch + label + count), hidden when count = 0
 *   8. "|"
 *   9. Team pill + Nx capacity text
 *   10. Auto-Schedule button
 *   11. flex-1 fill
 *   12. Count label (items · scheduled · need dates)
 *   13. Reset changes link (only when pendingPatchCount > 0)
 */
import type { SlotProps, VanillaSlotInstance } from '../../../types';
import { CLOUD_NIMBUS_CATEGORIES, CLOUD_NIMBUS_POOL } from '../../defaults';
import {
  CLS_FILTERBAR, CLS_FILTERBAR_INNER, CLS_FILTERBAR_LABEL,
  CLS_FILTER_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_BLUE, CLS_PILL_BTN_IDLE_BLUE,
  CLS_SEARCH_WRAP, CLS_SEARCH_ICON, CLS_SEARCH_INPUT, CLS_SEARCH_CLEAR,
  CLS_LEGEND_CHIP, CLS_LEGEND_SWATCH, CLS_LEGEND_TEXT,
  CLS_TEAM_PILL, CLS_CAPACITY_TEXT, CLS_AUTO_SCHED_BTN,
  CLS_COUNT_LABEL, CLS_RESET_LINK, CLS_SEP,
} from '../shared/classes';
import { el, clear } from '../shared/el';

function mkSep(): HTMLElement { const s = el('span', CLS_SEP + ' mx-1'); s.textContent = '|'; return s; }

export function FilterBarVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_FILTERBAR);
  root.setAttribute('data-slot', 'FilterBar');
  const inner = el('div', CLS_FILTERBAR_INNER);
  root.appendChild(inner);

  // Persist the input element across re-renders so focus + caret don't jump
  // away while the user is typing (clear+rebuild would destroy it).
  const searchInput = el('input', CLS_SEARCH_INPUT) as HTMLInputElement;
  searchInput.setAttribute('data-testid', 'gantt-search-input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search T-NNNN, title, owner…';

  // Track focus via our own listeners. document.activeElement returns the
  // shadow host (not the input) inside Salesforce's Locker/LWS shadow DOM,
  // so the activeElement identity check always failed there — producing the
  // "one char at a time" symptom. Own-listener state works on every surface.
  let searchInputFocused = false;
  searchInput.addEventListener('focus', () => { searchInputFocused = true; });
  searchInput.addEventListener('blur',  () => { searchInputFocused = false; });

  function render(p: SlotProps) {
    // Preserve search-input focus across re-renders. clear(inner) detaches
    // every child, which drops DOM focus even though the input element is
    // held in closure. Save caret state before clear, restore after rebuild.
    const hadSearchFocus = searchInputFocused;
    const selStart = hadSearchFocus ? searchInput.selectionStart : null;
    const selEnd   = hadSearchFocus ? searchInput.selectionEnd   : null;

    clear(inner);
    const { config, state, dispatch, data } = p;

    /* 1. "View:" label */
    const viewLbl = el('span', CLS_FILTERBAR_LABEL);
    viewLbl.textContent = 'View:';
    inner.appendChild(viewLbl);

    /* 2. Filter chips */
    config.filters.forEach((f) => {
      const on = state.filter === f.id;
      const cls = CLS_FILTER_BTN_BASE + ' ' + (on ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE);
      const b = el('button', cls);
      b.textContent = f.label;
      b.addEventListener('click', () => dispatch({ type: 'SET_FILTER', id: f.id }));
      inner.appendChild(b);
    });
    inner.appendChild(mkSep());

    /* 4. Search box */
    const sw = el('div', CLS_SEARCH_WRAP);
    const icon = el('span', CLS_SEARCH_ICON);
    icon.textContent = '🔎';
    sw.appendChild(icon);
    // Reuse the persistent input element. Sync value only if the dispatched
    // state has diverged (e.g. Reset changes) — never clobber while the user
    // is actively typing with the same value in flight.
    if (searchInput.value !== state.search) {
      searchInput.value = state.search;
    }
    // Rewire listener each render to capture the latest dispatch reference.
    searchInput.oninput = (e) =>
      dispatch({ type: 'SET_SEARCH', q: (e.target as HTMLInputElement).value });
    sw.appendChild(searchInput);
    if (state.search) {
      const clr = el('button', CLS_SEARCH_CLEAR);
      clr.textContent = '×';
      clr.title = 'Clear search';
      clr.setAttribute('aria-label', 'Clear search');
      clr.addEventListener('click', () => dispatch({ type: 'SET_SEARCH', q: '' }));
      sw.appendChild(clr);
    }
    inner.appendChild(sw);
    inner.appendChild(mkSep());

    /* 6. "Colors:" label + 7. Category chips */
    const clrLbl = el('span', CLS_FILTERBAR_LABEL);
    clrLbl.textContent = 'Colors:';
    inner.appendChild(clrLbl);
    CLOUD_NIMBUS_CATEGORIES.forEach((cat) => {
      const n = data.stats.categoryCounts[cat.label] || 0;
      if (n <= 0) return;
      const chip = el('span', CLS_LEGEND_CHIP);
      const sw2 = el('span', CLS_LEGEND_SWATCH);
      sw2.style.background = cat.color;
      chip.appendChild(sw2);
      const txt = el('span', CLS_LEGEND_TEXT);
      txt.textContent = cat.label + ' (' + n + ')';
      chip.appendChild(txt);
      inner.appendChild(chip);
    });
    inner.appendChild(mkSep());

    /* 9. Team pill + capacity */
    const active = CLOUD_NIMBUS_POOL.filter((m) => m.active !== false);
    const totalH = active.reduce((s, m) => s + m.hoursPerMonth, 0);

    const teamWrap = el('span', 'inline-flex items-center gap-1');
    const teamBtn = el('button', CLS_TEAM_PILL);
    teamBtn.title = 'Edit team resource capacity';
    const tLbl = document.createElement('span');
    tLbl.textContent = 'Team';
    teamBtn.appendChild(tLbl);
    const tCnt = el('span', 'font-mono text-indigo-500');
    tCnt.textContent = active.length + '×';
    teamBtn.appendChild(tCnt);
    teamBtn.addEventListener('click', () => {
      // eslint-disable-next-line no-console
      console.log('[FilterBar] open resource panel (placeholder)');
    });
    teamWrap.appendChild(teamBtn);
    const cap = el('span', CLS_CAPACITY_TEXT);
    cap.textContent = totalH + 'h/mo';
    teamWrap.appendChild(cap);
    inner.appendChild(teamWrap);

    /* 10. Auto-Schedule — button visible; behavior is a no-op stub until
       DH-side scheduler wires up. Glen's call 2026-04-20: "i want it; DH
       sorts out what it does." Follow-up will add an `onAutoSchedule`
       callback to forward the click to DH's ETA service. */
    const autoBtn = el('button', CLS_AUTO_SCHED_BTN);
    autoBtn.textContent = 'Auto-Schedule';
    autoBtn.addEventListener('click', () => {
      // eslint-disable-next-line no-console
      console.log('[FilterBar] auto-schedule (placeholder)');
    });
    inner.appendChild(autoBtn);

    /* 11. flex-1 fill */
    const spacer = el('div', 'flex-1');
    inner.appendChild(spacer);

    /* 12. Count label */
    const count = el('span', CLS_COUNT_LABEL);
    count.textContent =
      data.stats.total + ' items · ' +
      data.stats.scheduled + ' scheduled · ' +
      data.stats.needDates + ' need dates';
    inner.appendChild(count);

    /* 13. Reset changes link */
    if (state.pendingPatchCount > 0) {
      const rst = el('button', CLS_RESET_LINK);
      rst.textContent = 'Reset changes';
      rst.addEventListener('click', () => dispatch({ type: 'RESET_PATCHES' }));
      inner.appendChild(rst);
    }

    // 0.185.12 — restore search-input focus + caret if the user was typing.
    // Scheduled via microtask-ish Promise.resolve so the browser finishes
    // attaching the input before we call focus() — avoids a silent focus-
    // restoration failure on some browsers when the element was only just
    // re-appended.
    if (hadSearchFocus) {
      try { searchInput.focus(); } catch (_e) { /* ok */ }
      if (selStart !== null && selEnd !== null) {
        try { searchInput.setSelectionRange(selStart, selEnd); } catch (_e) { /* ok */ }
      }
    }
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
