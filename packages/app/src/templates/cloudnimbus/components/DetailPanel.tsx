/**
 * DetailPanel.tsx — v10 floating task detail popover (simplified, spec §7).
 *
 * Phase 3: renders in view vs edit mode based on `state.detailMode`. Pencil
 * toggles the mode. In edit mode the `startDate` and `endDate` fields become
 * inputs and a Save button dispatches a TaskPatch through the slot-level
 * PATCH event (IIFEApp intercepts PATCH and forwards to the consumer's
 * onPatch callback — same surface drag/resize already uses). Other v5-level
 * edits (title / hours / owner) are intentionally not wired here: those
 * fields don't exist on the framework's TaskPatch type and extending it is
 * out of Phase 3 scope.
 */
import { useEffect, useState } from 'react';
import type { SlotProps } from '../../types';
import { CLS_DETAIL, CLS_DETAIL_HEADER, CLS_DETAIL_BODY, CLS_CATEGORY_PILL } from './shared/classes';

export function DetailPanel({ state, data, dispatch, config }: SlotProps) {
  const editing = state.detailMode === 'edit';
  const task = state.selectedTaskId
    ? data.tasks.find((t) => String(t.id) === state.selectedTaskId)
    : undefined;

  // Local draft state for editable fields. Resets whenever the selected task
  // or edit mode flips — mirrors v5 FloatingDetailPanel's useEffect pattern.
  const [draftStart, setDraftStart] = useState<string>(task?.startDate || '');
  const [draftEnd, setDraftEnd] = useState<string>(task?.endDate || '');

  useEffect(() => {
    setDraftStart(task?.startDate || '');
    setDraftEnd(task?.endDate || '');
  }, [task?.id, task?.startDate, task?.endDate, editing]);

  if (!state.selectedTaskId) return null;
  if (!task) return null;

  const categoryColor = '#64748b';
  const taskId = String(task.id);

  const handleToggleMode = () => {
    dispatch({ type: 'SET_DETAIL_MODE', mode: editing ? 'view' : 'edit' });
  };

  const handleCancel = () => {
    setDraftStart(task.startDate || '');
    setDraftEnd(task.endDate || '');
    dispatch({ type: 'SET_DETAIL_MODE', mode: 'view' });
  };

  const handleSave = () => {
    const patch: { id: string; startDate?: string; endDate?: string } = { id: taskId };
    if (draftStart !== (task.startDate || '')) patch.startDate = draftStart;
    if (draftEnd !== (task.endDate || '')) patch.endDate = draftEnd;
    // Only dispatch when something actually changed — matches v5 behavior.
    if (patch.startDate !== undefined || patch.endDate !== undefined) {
      dispatch({ type: 'PATCH', patch });
    }
    dispatch({ type: 'SET_DETAIL_MODE', mode: 'view' });
  };

  return (
    <div
      className={CLS_DETAIL}
      data-slot="DetailPanel"
      data-detail-mode={state.detailMode}
      style={{ bottom: 80, right: 24, width: 380, borderColor: categoryColor }}
    >
      <div className={CLS_DETAIL_HEADER} style={{ background: categoryColor + '15' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: categoryColor }} />
          {config.recordUrlTemplate ? (
            <a
              className="text-[10px] font-mono font-bold text-slate-500 hover:text-slate-900 hover:underline flex-shrink-0"
              href={config.recordUrlTemplate.replace('{id}', encodeURIComponent(taskId))}
              target="_top"
              title="Open record"
              onClick={(e) => e.stopPropagation()}
            >
              {taskId}
            </a>
          ) : (
            <span className="text-[10px] font-mono font-bold text-slate-500 flex-shrink-0">{taskId}</span>
          )}
          <span className="text-xs font-bold text-slate-900 truncate">{task.title}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <button
            type="button"
            className={
              editing
                ? 'text-fuchsia-600 hover:text-fuchsia-800 text-sm px-1 transition-colors'
                : 'text-slate-400 hover:text-slate-700 text-sm px-1 transition-colors'
            }
            onClick={handleToggleMode}
            title={editing ? 'Exit edit mode' : 'Edit'}
            aria-pressed={editing}
            data-testid="detail-edit-toggle"
          >
            {/* Pencil glyph — unicode, no icon dependency */}
            &#9998;
          </button>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 text-sm px-1 transition-colors"
            onClick={() => dispatch({ type: 'TOGGLE_DETAIL' })}
            title="Close"
          >
            &times;
          </button>
        </div>
      </div>
      <div className={CLS_DETAIL_BODY}>
        <div className="flex items-center gap-2">
          <span
            className={CLS_CATEGORY_PILL}
            style={{ background: categoryColor + '20', color: categoryColor }}
          >
            {task.stage || '—'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
          <Field label="Status" value={task.stage || '—'} />
          <Field label="Priority" value={task.priorityGroup || '—'} />
          {editing ? (
            <EditField
              label="Start"
              type="date"
              value={draftStart}
              onChange={setDraftStart}
            />
          ) : (
            <Field label="Start" value={task.startDate || '—'} />
          )}
          {editing ? (
            <EditField
              label="End"
              type="date"
              value={draftEnd}
              onChange={setDraftEnd}
            />
          ) : (
            <Field label="End" value={task.endDate || '—'} />
          )}
          <Field label="Estimated" value={task.estimatedHours ? task.estimatedHours + 'h' : '—'} />
          <Field label="Logged" value={task.loggedHours ? task.loggedHours + 'h' : '—'} />
        </div>

        {editing && (
          <div className="pt-2 border-t border-slate-100 flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-slate-900">{value}</p>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'number';
}) {
  return (
    <div>
      <p className="text-[9px] text-slate-400 uppercase tracking-wide">{label}</p>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-1.5 py-0.5 text-xs text-slate-900 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-fuchsia-400"
      />
    </div>
  );
}
