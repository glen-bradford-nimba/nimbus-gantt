/**
 * ZoomBar.tsx (minimal) — 4 zoom buttons.
 */
import type { SlotProps, ZoomLevel } from '../../types';

const ZOOMS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

export function ZoomBar({ state, dispatch }: SlotProps) {
  return (
    <div className="nga-zoombar" data-slot="ZoomBar">
      {ZOOMS.map((z) => (
        <button
          key={z}
          type="button"
          onClick={() => dispatch({ type: 'SET_ZOOM', zoom: z })}
          style={{ fontWeight: state.zoom === z ? 700 : 400 }}
        >
          {z}
        </button>
      ))}
    </div>
  );
}
