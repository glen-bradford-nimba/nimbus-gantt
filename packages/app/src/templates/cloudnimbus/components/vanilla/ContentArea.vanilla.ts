/**
 * ContentArea.vanilla.ts — vanilla DOM content area (sidebar + host + detail).
 *
 * This slot is ORCHESTRATION ONLY — it returns an empty host <div> with
 * `data-nga-gantt-host="1"`, plus any sidebar/detail panels. The outer
 * IIFEApp is responsible for mounting the actual gantt engine INTO that
 * host element.
 *
 * AuditPanel is NOT rendered here — it lives at SLOT_ORDER's top level as a
 * full-width horizontal commit strip (v9 parity), matching React's
 * ContentArea.tsx which removed its inline audit render for the same reason.
 * Rendering here would duplicate the strip (regression observed on /v12
 * 2026-04-16 — two "AUDIT PASS" rows).
 */
import type { SlotProps, VanillaSlotInstance } from '../../../types';
import {
  CLS_CONTENT_OUTER, CLS_SIDEBAR_WRAP, CLS_RESIZER, CLS_CONTENT,
} from '../shared/classes';
import { el, clear } from '../shared/el';
import { SidebarVanilla } from './Sidebar.vanilla';
import { DetailPanelVanilla } from './DetailPanel.vanilla';

export function ContentAreaVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_CONTENT_OUTER);
  root.setAttribute('data-slot', 'ContentArea');
  const host = el('div', CLS_CONTENT);
  host.setAttribute('data-nga-gantt-host', '1');

  let sidebarInst: VanillaSlotInstance | null = null;
  // 0.185.18 — multi-instance DetailPanels keyed by taskId. One VanillaSlotInstance
  // per open task; preserved across re-renders so focus + drafts + panel
  // position survive state updates that don't touch that panel's task.
  const detailInsts: Map<string, VanillaSlotInstance> = new Map();

  function render(p: SlotProps) {
    clear(root);
    if (p.state.sidebarOpen && p.config.features.sidebar) {
      if (!sidebarInst) sidebarInst = SidebarVanilla(p);
      else sidebarInst.update(p);
      const wrap = el('div', CLS_SIDEBAR_WRAP);
      wrap.style.width = '280px';
      wrap.appendChild(sidebarInst.el);
      root.appendChild(wrap);
      const resizer = el('div', CLS_RESIZER);
      root.appendChild(resizer);
    } else if (sidebarInst) {
      sidebarInst.destroy();
      sidebarInst = null;
    }

    root.appendChild(host);

    // 0.185.18 — render one DetailPanel per open task id. Stack with a
    // cascading offset so stacked panels don't fully overlap. Clean up
    // any panels whose tasks are no longer in openDetailTaskIds.
    if (p.config.features.detailPanel) {
      const openIds = p.state.openDetailTaskIds || [];
      // Destroy panels for tasks that are no longer open
      for (const [tid, inst] of detailInsts) {
        if (!openIds.includes(tid)) {
          inst.destroy();
          detailInsts.delete(tid);
        }
      }
      // Create / update panels for each open task id
      openIds.forEach((tid, index) => {
        let inst = detailInsts.get(tid);
        if (!inst) {
          inst = DetailPanelVanilla(p, tid);
          detailInsts.set(tid, inst);
          // Cascade offset for panels opened without a manual drag — stack
          // each new panel 30px down + 30px left so they're individually
          // distinguishable. Users can drag any panel individually.
          const offset = index * 30;
          inst.el.style.transform = `translate(-${offset}px, -${offset}px)`;
        }
        inst.update(p);
        root.appendChild(inst.el);
      });
    } else if (detailInsts.size > 0) {
      for (const inst of detailInsts.values()) inst.destroy();
      detailInsts.clear();
    }
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() {
      if (sidebarInst) sidebarInst.destroy();
      for (const inst of detailInsts.values()) inst.destroy();
      detailInsts.clear();
      clear(root);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
