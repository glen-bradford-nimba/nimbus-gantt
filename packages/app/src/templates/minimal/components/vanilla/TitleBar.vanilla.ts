import type { SlotProps, VanillaSlotInstance, ViewMode } from '../../../types';
import { el, clear } from '../../../cloudnimbus/components/shared/el';

const VIEWS: ViewMode[] = ['gantt', 'list'];

export function TitleBarVanilla(initial: SlotProps): VanillaSlotInstance {
  const root = el('div', 'nga-titlebar');
  root.setAttribute('data-slot', 'TitleBar');

  function render(p: SlotProps) {
    clear(root);
    const strong = document.createElement('strong');
    strong.textContent = p.config.title || 'Nimbus Gantt';
    root.appendChild(strong);
    const spacer = el('span'); spacer.style.flex = '1';
    root.appendChild(spacer);
    VIEWS.forEach((v) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = v;
      if (p.state.viewMode === v) btn.style.fontWeight = '700';
      btn.addEventListener('click', () => p.dispatch({ type: 'SET_VIEW', mode: v }));
      root.appendChild(btn);
    });
  }

  render(initial);
  return {
    el: root, update: render,
    destroy() { clear(root); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
