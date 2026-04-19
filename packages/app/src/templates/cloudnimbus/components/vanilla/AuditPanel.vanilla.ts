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
    openPreviewModal(pending, async () => {
      await runSubmit();
    });
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
  items: { id: string; title?: string; fields: string[]; descs: string[] }[],
  onConfirm: () => void | Promise<void>,
): void {
  const existing = document.getElementById('ng-audit-preview-modal');
  if (existing) existing.remove();

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
  const kinds = summarizeKinds(items);
  title.textContent = 'Review ' + items.length + ' change' + (items.length === 1 ? '' : 's') + ' - ' + kinds;
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
  for (const it of items) {
    const li = document.createElement('li');
    li.style.cssText = 'padding:8px 0;border-bottom:1px solid #f1f5f9';
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
    li.appendChild(head);
    const descs = it.descs && it.descs.length ? it.descs : it.fields.map((f) => f + ' edited');
    const descList = document.createElement('div');
    descList.style.cssText = 'margin-top:3px;color:#475569;font-size:12px;line-height:1.45';
    descList.textContent = descs.join(' \u00b7 ');
    li.appendChild(descList);
    list.appendChild(li);
  }
  body.appendChild(list);
  panel.appendChild(body);

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 18px;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:flex-end;gap:8px';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.style.cssText = 'padding:6px 14px;font-size:13px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer';
  cancel.addEventListener('click', cleanup);
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = '\ud83d\udce4 Confirm + commit';
  confirmBtn.setAttribute('data-testid', 'audit-preview-confirm');
  confirmBtn.style.cssText = 'padding:6px 14px;font-size:13px;border-radius:6px;border:1px solid #a21caf;background:#a21caf;color:#fff;cursor:pointer;font-weight:500';
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancel.disabled = true;
    confirmBtn.textContent = 'Committing...';
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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };
  document.addEventListener('keydown', onKey);

  function cleanup() {
    document.removeEventListener('keydown', onKey);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }
}

function summarizeKinds(
  items: { fields: string[] }[],
): string {
  const counts = { dates: 0, group: 0, reorder: 0, parent: 0, other: 0 };
  const covered = new Set(['start', 'end', 'group', 'sortOrder', 'parentId']);
  for (const it of items) {
    const f = new Set(it.fields);
    if (f.has('start') || f.has('end')) counts.dates++;
    if (f.has('group')) counts.group++;
    if (f.has('sortOrder') && !f.has('start') && !f.has('end') && !f.has('group')) counts.reorder++;
    if (f.has('parentId')) counts.parent++;
    if (it.fields.some((k) => !covered.has(k))) counts.other++;
  }
  const parts: string[] = [];
  if (counts.dates) parts.push(counts.dates + ' date');
  if (counts.group) parts.push(counts.group + ' group');
  if (counts.reorder) parts.push(counts.reorder + ' reorder');
  if (counts.parent) parts.push(counts.parent + ' parent');
  if (counts.other) parts.push(counts.other + ' field');
  return parts.length ? parts.join(', ') : 'changes';
}
