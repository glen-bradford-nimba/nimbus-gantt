/**
 * ContentArea.tsx — v10 orchestrator — Sidebar + main renderer + DetailPanel + AuditPanel.
 * Uses an imperative mount point (div) and the existing IIFEApp gantt stack
 * via `engine` from config. We hand off to the vanilla IIFEApp for the gantt
 * engine rather than duplicating the canvas logic in React.
 */
import { useRef, useEffect } from 'react';
import type { SlotProps } from '../../types';
import {
  CLS_CONTENT_OUTER, CLS_SIDEBAR_WRAP, CLS_RESIZER, CLS_CONTENT,
} from './shared/classes';
import { Sidebar } from './Sidebar';
import { DetailPanel } from './DetailPanel';

export function ContentArea(props: SlotProps) {
  const { config, state } = props;
  const ganttHostRef = useRef<HTMLDivElement>(null);

  // Mount a placeholder div; the React driver is responsible for mounting the
  // actual IIFEApp gantt instance INSIDE the host container (via its own
  // useEffect). We render children that are purely React — Sidebar + detail.
  // NOTE: AuditPanel used to live here as a right-column sibling of the gantt;
  // v9 parity moved it to a top-level SLOT_ORDER strip above the content
  // (horizontal commit bar), so it is no longer rendered inside ContentArea.
  useEffect(() => {
    // No-op here — the outer NimbusGanttAppReact drives the engine mount.
  }, []);

  return (
    <div className={CLS_CONTENT_OUTER} data-slot="ContentArea">
      {state.sidebarOpen && config.features.sidebar ? (
        <>
          <div className={CLS_SIDEBAR_WRAP} style={{ width: 280 }}>
            <Sidebar {...props} />
          </div>
          <div className={CLS_RESIZER} />
        </>
      ) : null}
      <div className={CLS_CONTENT} ref={ganttHostRef} data-nga-gantt-host="1">
        {/* engine mounts imperatively here */}
      </div>
      {/* 0.185.18 — multi-instance DetailPanels. Iterate openDetailTaskIds
          so triage can keep several open side-by-side. Each panel is
          pinned to a specific taskId via forTaskId prop. Stacking offset
          applied per index. */}
      {config.features.detailPanel && state.openDetailTaskIds && state.openDetailTaskIds.length > 0
        ? state.openDetailTaskIds.map((tid, i) => (
            <DetailPanel
              key={tid}
              {...props}
              forTaskId={tid}
              stackIndex={i}
            />
          ))
        : (state.detailOpen && config.features.detailPanel ? <DetailPanel {...props} /> : null)}
    </div>
  );
}
