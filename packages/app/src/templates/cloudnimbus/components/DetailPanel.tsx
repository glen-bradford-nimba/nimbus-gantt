/**
 * DetailPanel.tsx — v10 floating task detail popover (simplified, spec §7).
 */
import type { SlotProps } from '../../types';
import { CLS_DETAIL, CLS_DETAIL_HEADER, CLS_DETAIL_BODY, CLS_CATEGORY_PILL } from './shared/classes';

export function DetailPanel({ state, data, dispatch }: SlotProps) {
  if (!state.selectedTaskId) return null;
  const task = data.tasks.find((t) => String(t.id) === state.selectedTaskId);
  if (!task) return null;
  const categoryColor = '#64748b';
  return (
    <div
      className={CLS_DETAIL}
      data-slot="DetailPanel"
      style={{ bottom: 80, right: 24, width: 380, borderColor: categoryColor }}
    >
      <div className={CLS_DETAIL_HEADER} style={{ background: categoryColor + '15' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: categoryColor }} />
          <span className="text-[10px] font-mono font-bold text-slate-500 flex-shrink-0">{String(task.id)}</span>
          <span className="text-xs font-bold text-slate-900 truncate">{task.title}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 text-sm px-1 transition-colors"
            onClick={() => dispatch({ type: 'TOGGLE_DETAIL' })}
          >
            ×
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
          <Field label="Start" value={task.startDate || '—'} />
          <Field label="End" value={task.endDate || '—'} />
          <Field label="Estimated" value={task.estimatedHours ? task.estimatedHours + 'h' : '—'} />
          <Field label="Logged" value={task.loggedHours ? task.loggedHours + 'h' : '—'} />
        </div>
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
