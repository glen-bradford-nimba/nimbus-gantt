/**
 * AuditPanel.tsx — v10 fuchsia audit commit strip (spec §8).
 *
 * 0.184: clicking Submit opens a confirm modal listing every pending change
 * when config.pendingChanges is populated. Legacy direct-submit path is
 * preserved when no preview items are provided.
 *
 * When config.onAuditSubmit is provided, the Submit+commit button calls it,
 * shows loading/success/error state, and only clears pending patches on
 * success. When the handler is absent (SF or demo contexts without a commit
 * endpoint), it falls back to the local RESET_PATCHES dispatch.
 */
import { useEffect, useState } from 'react';
import type { SlotProps } from '../../types';
import type { AuditSubmitResult, AuditPreviewItem } from '../../types';
import {
  CLS_AUDIT, CLS_AUDIT_LABEL, CLS_AUDIT_STATUS_DIRTY, CLS_AUDIT_STATUS_CLEAN,
  CLS_AUDIT_INPUT, CLS_AUDIT_SUBMIT, CLS_AUDIT_RESET,
} from './shared/classes';

export function AuditPanel({ state, dispatch, config }: SlotProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AuditSubmitResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dirty = (config.isDirty ?? false) || state.pendingPatchCount > 0;
  const pending = config.pendingChanges ?? [];

  if (!state.auditPanelOpen) return null;

  async function runSubmit() {
    setResult(null);
    if (config.onAuditSubmit) {
      setSubmitting(true);
      try {
        const res = await config.onAuditSubmit(note);
        setResult(res);
        if (res.ok) {
          dispatch({ type: 'RESET_PATCHES' });
          setNote('');
        }
      } catch (e) {
        setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
      } finally {
        setSubmitting(false);
      }
    } else {
      dispatch({ type: 'RESET_PATCHES' });
      setNote('');
    }
  }

  function onSubmitClick() {
    if (pending.length === 0) {
      void runSubmit();
      return;
    }
    setPreviewOpen(true);
  }

  return (
    <div className={CLS_AUDIT} data-slot="AuditPanel" data-testid="audit-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className={CLS_AUDIT_LABEL}>📤 Audit pass</span>
        <span className={dirty ? CLS_AUDIT_STATUS_DIRTY : CLS_AUDIT_STATUS_CLEAN}>
          {dirty ? 'unsaved changes' : 'clean'}
        </span>
        <input
          type="text"
          placeholder="commit note (optional — auto-summarized if empty)"
          className={CLS_AUDIT_INPUT}
          data-testid="audit-note-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={submitting}
        />
        <button
          type="button"
          className={CLS_AUDIT_SUBMIT}
          data-testid="audit-submit-btn"
          disabled={!dirty || submitting}
          onClick={onSubmitClick}
        >
          {submitting ? 'Committing…' : '📤 Submit + commit'}
        </button>
        <button
          type="button"
          className={CLS_AUDIT_RESET}
          data-testid="audit-reset-btn"
          disabled={submitting}
          onClick={() => {
            if (dirty && !confirm('Reset all unsaved overrides? This discards every drag/edit you made this session.')) return;
            setNote('');
            setResult(null);
            dispatch({ type: 'RESET_PATCHES' });
          }}
        >
          ↺ Reset
        </button>
      </div>
      {result && (
        <div className={`mt-1.5 text-[11px] ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`} data-testid="audit-result">
          {result.ok ? '✓' : '✗'} {result.msg}
          {result.sha && <code className="ml-2 font-mono bg-slate-100 px-1 rounded">{result.sha}</code>}
        </div>
      )}
      {previewOpen && (
        <AuditPreviewModal
          items={pending}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={async () => {
            setPreviewOpen(false);
            await runSubmit();
          }}
        />
      )}
    </div>
  );
}

function AuditPreviewModal({
  items,
  onCancel,
  onConfirm,
}: {
  items: AuditPreviewItem[];
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming, onCancel]);
  const kinds = summarizeKinds(items);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Audit preview"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2147483646, backdropFilter: 'blur(2px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !confirming) onCancel(); }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 10, boxShadow: '0 20px 40px rgba(15,23,42,0.25)',
          width: 'min(720px,92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', fontFamily: 'ui-sans-serif,system-ui,sans-serif',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
            Review {items.length} change{items.length === 1 ? '' : 's'} — {kinds}
          </div>
          <button
            type="button"
            onClick={() => { if (!confirming) onCancel(); }}
            aria-label="Close preview"
            style={{ background: 'transparent', border: 0, fontSize: 18, cursor: 'pointer', color: '#64748b', padding: '4px 8px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: '8px 18px 12px', overflowY: 'auto', flex: 1 }}>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12.5, color: '#334155' }}>
            {items.map((it) => {
              const descs = it.descs && it.descs.length ? it.descs : it.fields.map((f) => `${f} edited`);
              return (
                <li key={it.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <code style={{ fontFamily: 'ui-monospace,monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontSize: 11.5, color: '#0f172a' }}>
                      {it.id}
                    </code>
                    {it.title && it.title !== it.id && (
                      <span style={{ color: '#0f172a', fontWeight: 500 }}>{it.title}</span>
                    )}
                  </div>
                  <div style={{ marginTop: 3, color: '#475569', fontSize: 12, lineHeight: 1.45 }}>
                    {descs.join(' · ')}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            disabled={confirming}
            onClick={onCancel}
            style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="audit-preview-confirm"
            disabled={confirming}
            onClick={async () => { setConfirming(true); try { await onConfirm(); } finally { setConfirming(false); } }}
            style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid #a21caf', background: '#a21caf', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
          >
            {confirming ? 'Committing…' : '📤 Confirm + commit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function summarizeKinds(items: AuditPreviewItem[]): string {
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
  if (counts.dates) parts.push(`${counts.dates} date`);
  if (counts.group) parts.push(`${counts.group} group`);
  if (counts.reorder) parts.push(`${counts.reorder} reorder`);
  if (counts.parent) parts.push(`${counts.parent} parent`);
  if (counts.other) parts.push(`${counts.other} field`);
  return parts.length ? parts.join(', ') : 'changes';
}
