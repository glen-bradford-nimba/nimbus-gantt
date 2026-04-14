/**
 * Sidebar.tsx — v10 priority bucket list (spec §4) — simplified display.
 * React slot is render-only; drag-to-reparent happens in ContentArea via
 * the existing dragReparent engine on the gantt grid.
 */
import type { SlotProps } from '../../types';
import {
  CLS_SIDEBAR, CLS_SIDEBAR_HEADER, CLS_SIDEBAR_LABEL_BIG, CLS_SIDEBAR_LABEL_SM,
  CLS_SIDEBAR_SCROLL, CLS_BUCKET_HEADER, CLS_BUCKET_LABEL, CLS_BUCKET_COUNT,
  CLS_ITEM_ROW, CLS_DRAG_HANDLE, CLS_CAT_DOT, CLS_ITEM_TITLE, CLS_ITEM_HOURS,
  BUCKET_META, CATEGORY_DOT,
} from './shared/classes';

export function Sidebar({ config, data, dispatch }: SlotProps) {
  const tasks = data.tasks;
  return (
    <aside className={CLS_SIDEBAR} data-slot="Sidebar">
      <div className={CLS_SIDEBAR_HEADER}>
        <p className={CLS_SIDEBAR_LABEL_BIG}>Priority Groups</p>
        <p className={CLS_SIDEBAR_LABEL_SM}>Drag ☰ to move between buckets</p>
      </div>
      <div className={CLS_SIDEBAR_SCROLL}>
        {config.buckets.map((b) => {
          const members = tasks.filter((t) => t.priorityGroup === b.id && !t.parentWorkItemId);
          const totalHours = members.reduce((s, t) => s + (Number(t.estimatedHours) || 0), 0);
          const meta = BUCKET_META[b.id] || BUCKET_META.deferred;
          return (
            <div key={b.id} data-group-id={b.id} className={'border-b ' + meta.border + ' transition-colors'}>
              <div className={CLS_BUCKET_HEADER + ' ' + meta.bg}>
                <span className={CLS_BUCKET_LABEL + ' ' + meta.text}>{meta.label}</span>
                <span className={CLS_BUCKET_COUNT}>{members.length} · {Math.round(totalHours)}h</span>
              </div>
              {members.length === 0 ? (
                <div className="px-3 py-3 text-[10px] text-slate-400 italic">Drop items here</div>
              ) : (
                members.map((it) => {
                  const cat = (it.stage || '').toLowerCase().indexOf('backlog') === 0 ? 'backlog' :
                    (it.stage || '').toLowerCase().indexOf('paused') === 0 ? 'paused' :
                    (it.stage || '').toLowerCase().indexOf('done') === 0 ? 'done' : 'in-flight';
                  const dot = CATEGORY_DOT[cat] || '#94a3b8';
                  return (
                    <div
                      key={String(it.id)}
                      data-item-id={String(it.id)}
                      data-item-title={it.title}
                      className={CLS_ITEM_ROW}
                      onClick={() => dispatch({ type: 'TOGGLE_DETAIL', taskId: String(it.id) })}
                    >
                      <span data-drag-handle="1" className={CLS_DRAG_HANDLE}>☰</span>
                      <span className={CLS_CAT_DOT} style={{ background: dot }} />
                      <span className={CLS_ITEM_TITLE}>{it.title}</span>
                      <span className={CLS_ITEM_HOURS}>{Number(it.estimatedHours) || 0}h</span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
