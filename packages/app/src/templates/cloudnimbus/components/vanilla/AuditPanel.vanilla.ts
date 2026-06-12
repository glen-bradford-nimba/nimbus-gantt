/**
 * AuditPanel.vanilla.ts — vanilla DOM port of the v10 audit commit strip.
 *
 * 0.184 changes:
 *   - Submit now actually calls config.onAuditSubmit (prior vanilla variant
 *     only dispatched RESET_PATCHES, silently swallowing the commit path).
 *   - Submit opens a preview modal listing every pending change (populated
 *     from config.pendingChanges) so the user can review + confirm before
 *     committing. Legacy no-modal path is preserved when pendingChanges is
 *     absent or empty.
 */
import type { SlotProps, VanillaSlotInstance, AuditSubmitResult } from '../../../types';
import {
  CLS_AUDIT, CLS_AUDIT_LABEL, CLS_AUDIT_STATUS_DIRTY, CLS_AUDIT_STATUS_CLEAN,
  CLS_AUDIT_INPUT, CLS_AUDIT_SUBMIT, CLS_AUDIT_RESET,
} from '../shared/classes';
import { el, clear } from '../shared/el';

export function AuditPanelVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_AUDIT);
  root.setAttribute('data-slot', 'AuditPanel');
  root.setAttribute('data-testid', 'audit-panel');

  let note = '';
  let submitting = false;
  let lastResult: AuditSubmitResult | null = null;
  let inputEl: HTMLInputElement | null = null;
  let latestProps: SlotProps = initial;

  function render(p: SlotProps) {
    latestProps = p;
    clear(root);
    inputEl = null;
    root.style.display = p.state.auditPanelOpen ? '' : 'none';
    if (!p.state.auditPanelOpen) return;
    const dirty = (p.config.isDirty ?? false) || p.state.pendingPatchCount > 0;

    const inner = el('div', 'flex flex-wrap items-center gap-2');

    const lbl = el('span', CLS_AUDIT_LABEL);
    lbl.textContent = '\ud83d\udce4 Audit pass';
    inner.appendChild(lbl);

    const stat = el('span', dirty ? CLS_AUDIT_STATUS_DIRTY : CLS_AUDIT_STATUS_CLEAN);
    stat.textContent = dirty ? 'unsaved changes' : 'clean';
    inner.appendChild(stat);

    const input = el('input', CLS_AUDIT_INPUT) as HTMLInputElement;
    input.type = 'text';
    input.placeholder = 'commit note (optional - auto-summarized if empty)';
    input.value = note;
    input.setAttribute('data-testid', 'audit-note-input');
    input.disabled = submitting;
    input.addEventListener('input', (e) => {
      note = (e.target as HTMLInputElement).value;
    });
    inputEl = input;
    inner.appendChild(input);

    const sb = el('button', CLS_AUDIT_SUBMIT) as HTMLButtonElement;
    sb.type = 'button';
    sb.textContent = submitting ? 'Committing...' : '\ud83d\udce4 Submit + commit';
    sb.setAttribute('data-testid', 'audit-submit-btn');
    sb.disabled = !dirty || submitting;
    sb.addEventListener('click', onSubmitClick);
    inner.appendChild(sb);

    const rst = el('button', CLS_AUDIT_RESET) as HTMLButtonElement;
    rst.type = 'button';
    rst.textContent = '\u21ba Reset';
    rst.setAttribute('data-testid', 'audit-reset-btn');
    rst.disabled = submitting;
    rst.addEventListener('click', () => {
      if (dirty && !confirm('Reset all unsaved overrides? This discards every drag/edit you made this session.')) return;
      note = '';
      if (inputEl) inputEl.value = '';
      lastResult = null;
      p.dispatch({ type: 'RESET_PATCHES' });
    });
    inner.appendChild(rst);

    root.appendChild(inner);

    if (lastResult) {
      const r = el('div', `mt-1.5 text-[11px] ${lastResult.ok ? 'text-emerald-700' : 'text-rose-700'}`) as HTMLDivElement;
      r.setAttribute('data-testid', 'audit-result');
      r.textContent = (lastResult.ok ? '\u2713 ' : '\u2717 ') + lastResult.msg;
      if (lastResult.sha) {
        const sha = el('code', 'ml-2 font-mono bg-slate-100 px-1 rounded');
        sha.textContent = lastResult.sha;
        r.appendChild(sha);
      }
      root.appendChild(r);
    }
  }

  async function onSubmitClick() {
    const p = latestProps;
    const pending = p.config.pendingChanges ?? [];
    if (pending.length === 0) {
      await runSubmit();
      return;
    }
    openPreviewModal(
      pending,
      async () => {
        await runSubmit();
      },
      // 0.190 — per-row ✗ rejector. When the host wires
      // config.onRejectPendingChange, surface it; modal calls back into
      // the audit-pass module to refresh its row list against the
      // freshly-shrunk buffer (latestProps.config.pendingChanges is
      // updated by the IIFEApp's syncPendingChanges → renderSlots cycle).
      p.config.onRejectPendingChange
        ? (taskId: string) => {
            p.config.onRejectPendingChange?.(taskId);
            return latestProps.config.pendingChanges ?? [];
          }
        : undefined,
      // 0.203.0 — subset commit: per-row skip checkboxes. The modal passes
      // the UNCHECKED taskIds here before Confirm so the IIFE's commitEdits
      // leaves them staged.
      p.config.onSkipPendingChanges,
    );
  }

  async function runSubmit() {
    const p = latestProps;
    lastResult = null;
    if (p.config.onAuditSubmit) {
      submitting = true;
      render(p);
      try {
        const res = await p.config.onAuditSubmit(note);
        lastResult = res;
        if (res.ok) {
          note = '';
          p.dispatch({ type: 'RESET_PATCHES' });
        }
      } catch (e) {
        lastResult = { ok: false, msg: e instanceof Error ? e.message : String(e) };
      } finally {
        submitting = false;
        render(latestProps);
      }
    } else {
      note = '';
      p.dispatch({ type: 'RESET_PATCHES' });
      render(latestProps);
    }
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

function openPreviewModal(
  items: { id: string; title?: string; error?: string; fields: string[]; descs: string[] }[],
  onConfirm: () => void | Promise<void>,
  /** 0.190 \u2014 per-row \u2717 rejector. Returns the post-reject items list so
   *  the modal re-renders against the live buffer state. When the
   *  returned list is empty the modal auto-closes. */
  onReject?: (taskId: string) => { id: string; title?: string; error?: string; fields: string[]; descs: string[] }[],
  /** 0.203.0 \u2014 subset-commit selection. When present, each row renders a
   *  checkbox (checked = include). Confirm passes the UNCHECKED taskIds
   *  here first, so the commit path leaves them staged for later \u2014 unlike
   *  \u2717 reject, which reverts the row entirely. */
  onSkip?: (taskIds: string[]) => void,
): void {
  const existing = document.getElementById('ng-audit-preview-modal');
  if (existing) existing.remove();

  let currentItems = items.slice();
  const skipped = new Set<string>();

  const backdrop = document.createElement('div');
  backdrop.id = 'ng-audit-preview-modal';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Audit preview');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;z-index:2147483646;backdrop-filter:blur(2px)';

  const panel = document.createElement('div');
  panel.style.cssText = 'background:#fff;border-radius:10px;box-shadow:0 20px 40px rgba(15,23,42,0.25);width:min(720px,92vw);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;font-family:ui-sans-serif,system-ui,sans-serif';

  const header = document.createElement('div');
  header.style.cssText = 'padding:14px 18px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:600;color:#0f172a';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '\u2715';
  close.setAttribute('aria-label', 'Close preview');
  close.style.cssText = 'background:transparent;border:0;font-size:18px;cursor:pointer;color:#64748b;padding:4px 8px;line-height:1';
  close.addEventListener('click', cleanup);
  header.appendChild(title);
  header.appendChild(close);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'padding:8px 18px 12px;overflow-y:auto;flex:1';
  const list = document.createElement('ul');
  list.style.cssText = 'margin:0;padding:0;list-style:none;font-size:12.5px;color:#334155';
  body.appendChild(list);
  panel.appendChild(body);

  function renderRows() {
    title.textContent = 'Review ' + currentItems.length + ' change' + (currentItems.length === 1 ? '' : 's') + ' - ' + summarizeKinds(currentItems);
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const it of currentItems) {
      const li = document.createElement('li');
      li.style.cssText = 'padding:8px 0;border-bottom:1px solid #f1f5f9;display:flex;gap:8px;align-items:flex-start';

      if (onSkip) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !skipped.has(it.id);
        cb.setAttribute('data-testid', 'audit-preview-include');
        cb.setAttribute('data-task-id', it.id);
        cb.setAttribute('aria-label', 'Include ' + (it.title || it.id) + ' in this commit');
        cb.title = 'Unchecked rows stay staged for a later commit (not sent this round)';
        cb.style.cssText = 'flex:0 0 auto;margin-top:3px;cursor:pointer;accent-color:#a21caf';
        cb.addEventListener('change', () => {
          if (cb.checked) skipped.delete(it.id); else skipped.add(it.id);
          li.style.opacity = cb.checked ? '' : '0.45';
          updateConfirmLabel();
        });
        li.appendChild(cb);
        if (skipped.has(it.id)) li.style.opacity = '0.45';
      }

      const main = document.createElement('div');
      main.style.cssText = 'flex:1;min-width:0';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap';
      const idEl = document.createElement('code');
      idEl.style.cssText = 'font-family:ui-monospace,monospace;background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:11.5px;color:#0f172a';
      idEl.textContent = it.id;
      head.appendChild(idEl);
      if (it.title && it.title !== it.id) {
        const titleEl = document.createElement('span');
        titleEl.style.cssText = 'color:#0f172a;font-weight:500';
        titleEl.textContent = it.title;
        head.appendChild(titleEl);
      }
      main.appendChild(head);
      const descs = it.descs && it.descs.length ? it.descs : it.fields.map((f) => f + ' edited');
      const descList = document.createElement('div');
      descList.style.cssText = 'margin-top:3px;color:#475569;font-size:12px;line-height:1.45';
      descList.textContent = descs.join(' \u00b7 ');
      main.appendChild(descList);
      // 0.205.0 \u2014 continue-on-error: a row whose last commit attempt failed
      // shows the failure inline so the user can retry or reject it.
      if (it.error) {
        const errLine = document.createElement('div');
        errLine.setAttribute('data-testid', 'audit-preview-error');
        errLine.style.cssText = 'margin-top:3px;color:#dc2626;font-size:11.5px;line-height:1.4;font-weight:500';
        errLine.textContent = '\u2717 last commit failed: ' + it.error;
        main.appendChild(errLine);
      }
      li.appendChild(main);

      if (onReject) {
        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.textContent = '\u2717';
        rejectBtn.setAttribute('data-testid', 'audit-preview-reject');
        rejectBtn.setAttribute('data-task-id', it.id);
        rejectBtn.setAttribute('aria-label', 'Reject changes for ' + (it.title || it.id));
        rejectBtn.title = 'Reject this change (revert this row, keep the rest)';
        rejectBtn.style.cssText = 'flex:0 0 auto;background:transparent;border:1px solid #cbd5e1;border-radius:6px;padding:2px 8px;font-size:12px;color:#64748b;cursor:pointer;line-height:1.2';
        rejectBtn.addEventListener('click', () => {
          const next = onReject(it.id);
          currentItems = next;
          skipped.delete(it.id); // rejected row is gone — drop any stale skip
          if (currentItems.length === 0) { cleanup(); return; }
          renderRows();
          if (onSkip) updateConfirmLabel();
        });
        li.appendChild(rejectBtn);
      }

      list.appendChild(li);
    }
  }
  renderRows();

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 18px;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:flex-end;gap:8px';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.style.cssText = 'padding:6px 14px;font-size:13px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer';
  cancel.addEventListener('click', cleanup);
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.setAttribute('data-testid', 'audit-preview-confirm');
  confirmBtn.style.cssText = 'padding:6px 14px;font-size:13px;border-radius:6px;border:1px solid #a21caf;background:#a21caf;color:#fff;cursor:pointer;font-weight:500';
  // 0.203.0 \u2014 selection-aware label: "commit N of M" when rows are skipped.
  // Zero selected disables Confirm (nothing to send).
  function selectedCount(): number {
    return currentItems.filter((it) => !skipped.has(it.id)).length;
  }
  function updateConfirmLabel(): void {
    const sel = selectedCount();
    confirmBtn.textContent = onSkip && sel < currentItems.length
      ? '\ud83d\udce4 Confirm + commit ' + sel + ' of ' + currentItems.length
      : '\ud83d\udce4 Confirm + commit';
    confirmBtn.disabled = sel === 0;
    confirmBtn.style.opacity = sel === 0 ? '0.5' : '';
  }
  updateConfirmLabel();
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancel.disabled = true;
    confirmBtn.textContent = 'Committing...';
    // Record the skipped rows BEFORE the commit runs \u2014 only ids still in the
    // list count (a row rejected after being unchecked is already gone).
    if (onSkip) {
      const live = new Set(currentItems.map((it) => it.id));
      onSkip(Array.from(skipped).filter((id) => live.has(id)));
    }
    try {
      await onConfirm();
    } finally {
      cleanup();
    }
  });
  footer.appendChild(cancel);
  footer.appendChild(confirmBtn);
  panel.appendChild(footer);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cleanup();
  });
  // 0.205.0 — Escape listener moved from document to the backdrop:
  // document.addEventListener silently no-ops under Salesforce LWS, so
  // Escape was dead on SF. Key events from focused descendants (checkboxes,
  // buttons) bubble to the backdrop; focusing it on open (deferred — the
  // house pattern, synchronous focus after append is swallowed under LWS)
  // makes Escape work before any interaction too.
  backdrop.tabIndex = -1;
  backdrop.style.outline = 'none';
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };
  backdrop.addEventListener('keydown', onKey);
  try { setTimeout(() => { try { backdrop.focus(); } catch (_e) { /* ok */ } }, 0); } catch (_e) { /* ok */ }

  function cleanup() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }
}

// 0.205.0 — batchMode pushes RAW field keys (startDate/endDate/priorityGroup)
// while the legacy host path pushes short names (start/end/group); normalize
// so a pure date-drag commit reads "3 date", not "3 field".
const KIND_ALIAS: Record<string, string> = { startDate: 'start', endDate: 'end', priorityGroup: 'group' };
function summarizeKinds(
  items: { fields: string[] }[],
): string {
  const counts = { dates: 0, group: 0, reorder: 0, parent: 0, other: 0 };
  const covered = new Set(['start', 'end', 'group', 'sortOrder', 'parentId']);
  for (const it of items) {
    const f = new Set(it.fields.map((k) => KIND_ALIAS[k] || k));
    if (f.has('start') || f.has('end')) counts.dates++;
    if (f.has('group')) counts.group++;
    if (f.has('sortOrder') && !f.has('start') && !f.has('end') && !f.has('group')) counts.reorder++;
    if (f.has('parentId')) counts.parent++;
    if ([...f].some((k) => !covered.has(k))) counts.other++;
  }
  const parts: string[] = [];
  if (counts.dates) parts.push(counts.dates + ' date');
  if (counts.group) parts.push(counts.group + ' group');
  if (counts.reorder) parts.push(counts.reorder + ' reorder');
  if (counts.parent) parts.push(counts.parent + ' parent');
  if (counts.other) parts.push(counts.other + ' field');
  return parts.length ? parts.join(', ') : 'changes';
}
