/**
 * ZoomBar.vanilla.ts — vanilla DOM ZoomBar slot.
 */
import type { SlotProps, VanillaSlotInstance, ZoomLevel } from '../../../types';
import {
  CLS_ZOOMBAR, CLS_PILL_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_SLATE, CLS_PILL_BTN_IDLE_SLATE,
} from '../shared/classes';
import { el, clear } from '../shared/el';

const ZOOMS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

export function ZoomBarVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', CLS_ZOOMBAR);
  root.setAttribute('data-slot', 'ZoomBar');
  function render(p: SlotProps) {
    clear(root);
    ZOOMS.forEach((z) => {
      const on = p.state.zoom === z;
      const cls = CLS_PILL_BTN_BASE + ' ' + (on ? CLS_PILL_BTN_ACTIVE_SLATE : CLS_PILL_BTN_IDLE_SLATE);
      const b = el('button', cls);
      b.textContent = z.charAt(0).toUpperCase() + z.slice(1);
      b.addEventListener('click', () => p.dispatch({ type: 'SET_ZOOM', zoom: z }));
      root.appendChild(b);
    });
  }
  render(initial);
  return {
    el: root,
    update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
