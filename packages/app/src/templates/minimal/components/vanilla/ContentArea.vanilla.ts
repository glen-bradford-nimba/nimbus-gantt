import type { SlotProps, VanillaSlotInstance } from '../../../types';
import { el, clear } from '../../../cloudnimbus/components/shared/el';

export function ContentAreaVanilla(_initial: SlotProps): VanillaSlotInstance {
  const root = el('div', 'nga-content-outer');
  root.setAttribute('data-slot', 'ContentArea');
  const host = el('div', 'nga-content');
  host.setAttribute('data-nga-gantt-host', '1');
  root.appendChild(host);

  return {
    el: root,
    update: () => { /* no reactive state */ },
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
