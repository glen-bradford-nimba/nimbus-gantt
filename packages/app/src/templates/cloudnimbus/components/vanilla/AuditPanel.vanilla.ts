/**
 * AuditPanel.vanilla.ts — vanilla DOM port of the v9 inline audit strip.
 *
 * Source: cloudnimbusllc.com/src/app/mf/delivery-timeline-v5/DeliveryTimelineV5.tsx
 *         (inline audit panel around line 2233)
 *
 * The strip is a fuchsia-tinted row with:
 *   - "📤 Audit pass" label
 *   - status pill: "clean" (emerald) when no pending patches,
 *                  "unsaved changes" (amber) when pendingPatchCount > 0
 *   - commit note input (local closure state — no dispatch on typing)
 *   - "Submit + commit" button (dispatches RESET_PATCHES, clears input)
 *   - "Reset" button (dispatches RESET_PATCHES, clears input)
 *
 * Submit is disabled when BOTH the input is empty AND there are no pending
 * patches — matches the v9 spec sheet in the user task prompt.
 */
import type { SlotProps, VanillaSlotInstance } from '../../../types';
import {
  CLS_AUDIT, CLS_AUDIT_LABEL, CLS_AUDIT_STATUS_DIRTY, CLS_AUDIT_STATUS_CLEAN,
  CLS_AUDIT_INPUT, CLS_AUDIT_SUBMIT, CLS_AUDIT_RESET,
} from '../shared/classes';
import { el, clear } from '../shared/el';

export function AuditPanelVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_AUDIT);
  root.setAttribute('data-slot', 'AuditPanel');
  root.setAttribute('data-testid', 'audit-panel');

  // Local closure state — not mirrored in AppState, mirrors v9 useState(note).
  let note = '';
  // Cached input ref so typing doesn't trigger a full re-render (which would
  // blow away focus + cursor position mid-keystroke).
  let inputEl: HTMLInputElement | null = null;

  function render(p: SlotProps) {
    clear(root);
    inputEl = null;
    // State-gated visibility — matches StatsPanel.vanilla.ts:48 pattern.
    // The slot itself is always mounted (slot-rendering is feature-gated
    // via shouldRenderSlot → features.auditPanel), but visibility is
    // driven by state.auditPanelOpen so the Audit pill in TitleBar
    // toggles the strip cleanly. Without this gate the Audit pill would
    // flip its own active/idle class but the panel stayed visible no
    // matter what — the Blocker 2 bug reported on v12 localhost
    // 2026-04-17. INITIAL_STATE.auditPanelOpen = true preserves v9
    // parity (Audit strip open by default).
    root.style.display = p.state.auditPanelOpen ? '' : 'none';
    if (!p.state.auditPanelOpen) return;
    const dirty = p.state.pendingPatchCount > 0;

    const inner = el('div', 'flex flex-wrap items-center gap-2');

    const lbl = el('span', CLS_AUDIT_LABEL);
    lbl.textContent = '\ud83d\udce4 Audit pass';
    inner.appendChild(lbl);

    const stat = el('span', dirty ? CLS_AUDIT_STATUS_DIRTY : CLS_AUDIT_STATUS_CLEAN);
    stat.textContent = dirty ? 'unsaved changes' : 'clean';
    inner.appendChild(stat);

    const submitBtn = el('button', CLS_AUDIT_SUBMIT) as HTMLButtonElement;

    const input = el('input', CLS_AUDIT_INPUT) as HTMLInputElement;
    input.type = 'text';
    input.placeholder = 'commit note (optional)';
    input.value = note;
    input.setAttribute('data-testid', 'audit-note-input');
    input.addEventListener('input', (e) => {
      note = (e.target as HTMLInputElement).value;
      // Toggle submit disabled as note/empty changes — no full re-render.
      submitBtn.disabled = note.length === 0 && !dirty;
    });
    inputEl = input;
    inner.appendChild(input);

    submitBtn.type = 'button';
    submitBtn.textContent = '\ud83d\udce4 Submit + commit';
    submitBtn.setAttribute('data-testid', 'audit-submit-btn');
    submitBtn.disabled = note.length === 0 && !dirty;
    submitBtn.addEventListener('click', () => {
      p.dispatch({ type: 'RESET_PATCHES' });
      note = '';
      if (inputEl) inputEl.value = '';
      submitBtn.disabled = true;
    });
    inner.appendChild(submitBtn);

    const rst = el('button', CLS_AUDIT_RESET) as HTMLButtonElement;
    rst.type = 'button';
    rst.textContent = '\u21ba Reset';
    rst.setAttribute('data-testid', 'audit-reset-btn');
    rst.addEventListener('click', () => {
      note = '';
      if (inputEl) inputEl.value = '';
      p.dispatch({ type: 'RESET_PATCHES' });
    });
    inner.appendChild(rst);

    root.appendChild(inner);
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
