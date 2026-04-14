/**
 * AuditPanel.tsx — v10 fuchsia audit commit strip (spec §8).
 */
import { useState } from 'react';
import type { SlotProps } from '../../types';
import {
  CLS_AUDIT, CLS_AUDIT_LABEL, CLS_AUDIT_STATUS_DIRTY, CLS_AUDIT_STATUS_CLEAN,
  CLS_AUDIT_INPUT, CLS_AUDIT_SUBMIT, CLS_AUDIT_RESET,
} from './shared/classes';

export function AuditPanel({ state, dispatch }: SlotProps) {
  const [note, setNote] = useState('');
  const dirty = state.pendingPatchCount > 0;
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
        />
        <button
          type="button"
          className={CLS_AUDIT_SUBMIT}
          data-testid="audit-submit-btn"
          disabled={!dirty}
          onClick={() => {
            dispatch({ type: 'RESET_PATCHES' });
            setNote('');
          }}
        >
          📤 Submit + commit
        </button>
        <button
          type="button"
          className={CLS_AUDIT_RESET}
          data-testid="audit-reset-btn"
          onClick={() => { setNote(''); dispatch({ type: 'RESET_PATCHES' }); }}
        >
          ↺ Reset
        </button>
      </div>
    </div>
  );
}
