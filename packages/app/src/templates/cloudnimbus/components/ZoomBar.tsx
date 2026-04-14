/**
 * ZoomBar.tsx — v10 zoom pill group (spec §3).
 * Separate slot usable standalone when embedded without a TitleBar.
 */
import type { SlotProps, ZoomLevel } from '../../types';
import {
  CLS_ZOOMBAR, CLS_PILL_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_SLATE, CLS_PILL_BTN_IDLE_SLATE,
} from './shared/classes';

const ZOOMS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

export function ZoomBar({ state, dispatch }: SlotProps) {
  return (
    <div className={CLS_ZOOMBAR} data-slot="ZoomBar">
      {ZOOMS.map((z) => {
        const on = state.zoom === z;
        return (
          <button
            key={z}
            type="button"
            className={
              CLS_PILL_BTN_BASE + ' ' +
              (on ? CLS_PILL_BTN_ACTIVE_SLATE : CLS_PILL_BTN_IDLE_SLATE)
            }
            onClick={() => dispatch({ type: 'SET_ZOOM', zoom: z })}
          >
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        );
      })}
    </div>
  );
}
