/**
 * AuditPanel.tsx — v10 fuchsia audit commit strip (spec §8).
 *
 * When config.onAuditSubmit is provided, the Submit+commit button calls it,
 * shows loading/success/error state, and only clears pending patches on
 * success. When the handler is absent (SF or demo contexts without a commit
 * endpoint), it falls back to the local RESET_PATCHES dispatch.
 */
import { useState } from 'react';
import type { SlotProps } from '../../types';
import type { AuditSubmitResult } from '../../types';
import {
  CLS_AUDIT, CLS_AUDIT_LABEL, CLS_AUDIT_STATUS_DIRTY, CLS_AUDIT_STATUS_CLEAN,
  CLS_AUDIT_INPUT, CLS_AUDIT_SUBMIT, CLS_AUDIT_RESET,
} from './shared/classes';

export function AuditPanel({ state, dispatch, config }: SlotProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AuditSubmitResult | null>(null);
  // Prefer consumer-supplied dirty flag (e.g. useProFormaState.isDirty)
  // over the framework's internal patch counter.
  const dirty = config.isDirty ?? state.pendingPatchCount > 0;

  // Rendered unconditionally at top level — gate on auditPanelOpen here
  // to preserve the show/hide toggle behaviour wired through the title bar.
  if (!state.auditPanelOpen) return null;

  async function handleSubmit() {
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
      // No handler wired — local-only reset (demo / SF-sandbox fallback).
      dispatch({ type: 'RESET_PATCHES' });
      setNote('');
    }
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
          placeholder="commit note (optional)"
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
          onClick={handleSubmit}
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
    </div>
  );
}
