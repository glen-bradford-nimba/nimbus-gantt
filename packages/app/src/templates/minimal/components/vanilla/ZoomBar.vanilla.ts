import type { SlotProps, VanillaSlotInstance, ZoomLevel } from '../../../types';
import { el, clear } from '../../../cloudnimbus/components/shared/el';

const ZOOMS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

export function ZoomBarVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', 'nga-zoombar');
  root.setAttribute('data-slot', 'ZoomBar');

  function render(p: SlotProps) {
    clear(root);
    ZOOMS.forEach((z) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = z;
      if (p.state.zoom === z) b.style.fontWeight = '700';
      b.addEventListener('click', () => p.dispatch({ type: 'SET_ZOOM', zoom: z }));
      root.appendChild(b);
    });
  }

  render(initial);
  return {
    el: root, update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
