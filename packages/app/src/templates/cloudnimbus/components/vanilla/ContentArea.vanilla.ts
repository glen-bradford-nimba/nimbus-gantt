/**
 * ContentArea.vanilla.ts — vanilla DOM content area (sidebar + host + detail + audit).
 *
 * This slot is ORCHESTRATION ONLY — it returns an empty host <div> with
 * `data-nga-gantt-host="1"`, plus any sidebar/detail/audit panels. The
 * outer IIFEApp is responsible for mounting the actual gantt engine INTO
 * that host element.
 */
import type { SlotProps, VanillaSlotInstance } from '../../../types';
import {
  CLS_CONTENT_OUTER, CLS_SIDEBAR_WRAP, CLS_RESIZER, CLS_CONTENT,
} from '../shared/classes';
import { el, clear } from '../shared/el';
import { SidebarVanilla } from './Sidebar.vanilla';
import { DetailPanelVanilla } from './DetailPanel.vanilla';
import { AuditPanelVanilla } from './AuditPanel.vanilla';

export function ContentAreaVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_CONTENT_OUTER);
  root.setAttribute('data-slot', 'ContentArea');
  const host = el('div', CLS_CONTENT);
  host.setAttribute('data-nga-gantt-host', '1');

  let sidebarInst: VanillaSlotInstance | null = null;
  let detailInst:  VanillaSlotInstance | null = null;
  let auditInst:   VanillaSlotInstance | null = null;

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

    if (p.state.detailOpen && p.config.features.detailPanel) {
      if (!detailInst) detailInst = DetailPanelVanilla(p);
      else detailInst.update(p);
      root.appendChild(detailInst.el);
    } else if (detailInst) {
      detailInst.destroy();
      detailInst = null;
    }

    // v9 parity: inline audit strip shows whenever the feature is enabled.
    // (The separate right-slide audit HISTORY panel is still toggled by state.auditPanelOpen
    // — different concern; add a dedicated slot/toggle there if we bring that back.)
    if (p.config.features.auditPanel) {
      if (!auditInst) auditInst = AuditPanelVanilla(p);
      else auditInst.update(p);
      root.appendChild(auditInst.el);
    } else if (auditInst) {
      auditInst.destroy();
      auditInst = null;
    }
  }

  render(initial);
  return {
    el: root,
    update: render,
    destroy() {
      if (sidebarInst) sidebarInst.destroy();
      if (detailInst)  detailInst.destroy();
      if (auditInst)   auditInst.destroy();
      clear(root);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
