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
import { useEffect, useRef, useState } from 'react';
import type { SlotProps, FieldDescriptor } from '../../types';
import { CLS_DETAIL, CLS_DETAIL_HEADER, CLS_DETAIL_BODY, CLS_CATEGORY_PILL } from './shared/classes';

export function DetailPanel({ state, data, dispatch, config }: SlotProps) {
  const editing = state.detailMode === 'edit';
  const task = state.selectedTaskId
    ? data.tasks.find((t) => String(t.id) === state.selectedTaskId)
    : undefined;

  const schema = config.fieldSchema;

  // 0.185.15 — generalized draft state. Keyed by schema field name when
  // schema is provided; falls back to startDate/endDate for legacy path.
  const [drafts, setDrafts] = useState<Record<string, unknown>>(() => {
    if (schema && schema.length && task) {
      const d: Record<string, unknown> = {};
      for (const f of schema) d[f.key] = (task as unknown as Record<string, unknown>)[f.key];
      return d;
    }
    return { startDate: task?.startDate || '', endDate: task?.endDate || '' };
  });

  useEffect(() => {
    if (schema && schema.length && task) {
      const d: Record<string, unknown> = {};
      for (const f of schema) d[f.key] = (task as unknown as Record<string, unknown>)[f.key];
      setDrafts(d);
    } else {
      setDrafts({ startDate: task?.startDate || '', endDate: task?.endDate || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, editing, schema]);

  if (!state.selectedTaskId) return null;
  if (!task) return null;

  const categoryColor = '#64748b';
  const taskId = String(task.id);

  const handleToggleMode = () => {
    dispatch({ type: 'SET_DETAIL_MODE', mode: editing ? 'view' : 'edit' });
  };

  const handleCancel = () => {
    if (schema && schema.length) {
      const d: Record<string, unknown> = {};
      for (const f of schema) d[f.key] = (task as unknown as Record<string, unknown>)[f.key];
      setDrafts(d);
    } else {
      setDrafts({ startDate: task.startDate || '', endDate: task.endDate || '' });
    }
    dispatch({ type: 'SET_DETAIL_MODE', mode: 'view' });
  };

  const handleSave = () => {
    // 0.185.15 — diff drafts against task, emit only changed keys.
    const changes: Record<string, unknown> = {};
    const keys = schema && schema.length
      ? schema.filter((f) => !f.readOnly).map((f) => f.key)
      : ['startDate', 'endDate'];
    for (const k of keys) {
      const draftVal = drafts[k];
      const taskVal = (task as unknown as Record<string, unknown>)[k];
      const dNorm = draftVal == null || draftVal === '' ? null : draftVal;
      const tNorm = taskVal == null || taskVal === '' ? null : taskVal;
      if (dNorm !== tNorm) changes[k] = draftVal;
    }
    if (Object.keys(changes).length > 0) {
      const patch: Record<string, unknown> = { id: taskId, ...changes };
      dispatch({ type: 'PATCH', patch: patch as unknown as import('../../types').TaskPatch });
    }
    dispatch({ type: 'SET_DETAIL_MODE', mode: 'view' });
  };

  // 0.185.17 — draggable panel state. `pos` null = use default right/bottom
  // anchor; otherwise absolute left/top in container coords. Persists across
  // task switches within the same mount.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    startX: number; startY: number; origX: number; origY: number;
  } | null>(null);

  const onHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    let origX = pos?.x ?? 0;
    let origY = pos?.y ?? 0;
    if (pos == null && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const parent = rootRef.current.parentElement;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
      origX = rect.left - parentRect.left;
      origY = rect.top - parentRect.top;
      setPos({ x: origX, y: origY });
    }
    dragState.current = { startX: e.clientX, startY: e.clientY, origX, origY };
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const s = dragState.current;
      if (!s) return;
      setPos({ x: s.origX + (ev.clientX - s.startX), y: s.origY + (ev.clientY - s.startY) });
    };
    const onUp = () => {
      dragState.current = null;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const panelStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, width: 380, borderColor: categoryColor }
    : { bottom: 80, right: 24, width: 380, borderColor: categoryColor };

  return (
    <div
      ref={rootRef}
      className={CLS_DETAIL}
      data-slot="DetailPanel"
      data-detail-mode={state.detailMode}
      style={panelStyle}
    >
      <div
        className={CLS_DETAIL_HEADER}
        style={{ background: categoryColor + '15', cursor: 'move', userSelect: 'none' }}
        onMouseDown={onHeaderMouseDown}
      >
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
          {schema && schema.length ? (
            schema.map((f) => (
              <SchemaField
                key={f.key}
                desc={f}
                editing={editing}
                value={drafts[f.key]}
                onChange={(v) => setDrafts((d) => ({ ...d, [f.key]: v }))}
              />
            ))
          ) : (
            <>
              <Field label="Status" value={task.stage || '—'} />
              <Field label="Priority" value={task.priorityGroup || '—'} />
              {editing ? (
                <EditField
                  label="Start"
                  type="date"
                  value={String(drafts.startDate ?? '')}
                  onChange={(v) => setDrafts((d) => ({ ...d, startDate: v }))}
                />
              ) : (
                <Field label="Start" value={task.startDate || '—'} />
              )}
              {editing ? (
                <EditField
                  label="End"
                  type="date"
                  value={String(drafts.endDate ?? '')}
                  onChange={(v) => setDrafts((d) => ({ ...d, endDate: v }))}
                />
              ) : (
                <Field label="End" value={task.endDate || '—'} />
              )}
              <Field label="Estimated" value={task.estimatedHours ? task.estimatedHours + 'h' : '—'} />
              <Field label="Logged" value={task.loggedHours ? task.loggedHours + 'h' : '—'} />
            </>
          )}
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

function Field({ label, value, fullWidth }: { label: string; value: string; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'col-span-2' : undefined}>
      <p className="text-[9px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-slate-900 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

/**
 * 0.185.15 — SchemaField. Renders a single FieldDescriptor based on the
 * editing flag and the field's type. Textareas always span both columns
 * so their content doesn't get cramped. readOnly descriptors render as
 * Field (view-only) even when editing. Mirrors the vanilla renderField.
 */
function SchemaField({
  desc,
  editing,
  value,
  onChange,
}: {
  desc: FieldDescriptor;
  editing: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const fullWidth = desc.type === 'textarea';
  const currentVal = value == null ? '' : String(value);

  if (!editing || desc.readOnly) {
    return <Field label={desc.label} value={currentVal || '—'} fullWidth={fullWidth} />;
  }

  const cls =
    'w-full px-1.5 py-0.5 text-xs text-slate-900 border border-slate-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-fuchsia-400';

  let control;
  if (desc.type === 'textarea') {
    control = (
      <textarea
        className={cls + ' resize-y'}
        rows={3}
        value={currentVal}
        placeholder={desc.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (desc.type === 'picklist') {
    control = (
      <select
        className={cls}
        value={currentVal}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{desc.placeholder || '—'}</option>
        {(desc.options || []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  } else {
    const inputType = desc.type === 'number' ? 'number' : desc.type === 'date' ? 'date' : 'text';
    control = (
      <input
        type={inputType}
        className={cls}
        value={currentVal}
        placeholder={desc.placeholder}
        min={desc.type === 'number' ? desc.min : undefined}
        max={desc.type === 'number' ? desc.max : undefined}
        onChange={(e) => {
          const v = e.target.value;
          onChange(desc.type === 'number' ? (v === '' ? null : Number(v)) : v);
        }}
      />
    );
  }

  return (
    <div className={fullWidth ? 'col-span-2' : undefined}>
      <p className="text-[9px] text-slate-400 uppercase tracking-wide">{desc.label}</p>
      {control}
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
