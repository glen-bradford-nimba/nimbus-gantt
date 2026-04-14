/**
 * TitleBar.tsx (minimal) — bare title bar with view mode switcher.
 */
import type { SlotProps, ViewMode } from '../../types';

const VIEWS: ViewMode[] = ['gantt', 'list'];

export function TitleBar({ config, state, dispatch }: SlotProps) {
  return (
    <div className="nga-titlebar" data-slot="TitleBar">
      <strong>{config.title || 'Nimbus Gantt'}</strong>
      <span style={{ flex: 1 }} />
      {VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => dispatch({ type: 'SET_VIEW', mode: v })}
          style={{ fontWeight: state.viewMode === v ? 700 : 400 }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
