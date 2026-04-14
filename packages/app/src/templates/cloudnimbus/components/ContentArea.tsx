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
import { AuditPanel } from './AuditPanel';

export function ContentArea(props: SlotProps) {
  const { config, state } = props;
  const ganttHostRef = useRef<HTMLDivElement>(null);

  // Mount a placeholder div; the React driver is responsible for mounting the
  // actual IIFEApp gantt instance INSIDE the host container (via its own
  // useEffect). We render children that are purely React — Sidebar + detail +
  // audit. The raw gantt canvas is mounted imperatively into `ganttHostRef`.
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
      {state.detailOpen && config.features.detailPanel ? <DetailPanel {...props} /> : null}
      {state.auditPanelOpen && config.features.auditPanel ? <AuditPanel {...props} /> : null}
    </div>
  );
}
