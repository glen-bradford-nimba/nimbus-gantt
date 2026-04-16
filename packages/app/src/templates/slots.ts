/**
 * templates/slots.ts — Slot-to-feature mapping (per API design §5.3).
 */
import type { SlotName, FeatureFlags } from './types';

/**
 * When features[flag] === false, the corresponding slot will not render.
 * Behaviour-only flags (dragReparent, depthShading, groupByToggle,
 * hideCompletedToggle) are NOT in this map — they gate behaviour inside
 * slots instead.
 */
export const SLOT_TO_FEATURE: Record<SlotName, keyof FeatureFlags> = {
  TitleBar:    'titleBar',
  StatsPanel:  'statsPanel',
  FilterBar:   'filterBar',
  ZoomBar:     'zoomBar',
  Sidebar:     'sidebar',
  ContentArea: 'titleBar', // ContentArea is always rendered — titleBar as a sentinel that's effectively always on
  DetailPanel: 'detailPanel',
  AuditPanel:  'auditPanel',
  HrsWkStrip:  'hrsWkStrip',
};

/**
 * Returns true if a slot should be rendered given the current feature flags.
 * ContentArea is a special case — it is always rendered (no feature gate).
 */
export function shouldRenderSlot(slot: SlotName, features: FeatureFlags): boolean {
  if (slot === 'ContentArea') return true;
  const flag = SLOT_TO_FEATURE[slot];
  return features[flag] !== false;
}

/** Ordered slot list used by both React + vanilla drivers.
 *  AuditPanel is a full-width horizontal commit strip above the gantt content
 *  (v9 parity), not a right-column sibling inside ContentArea. */
export const SLOT_ORDER: SlotName[] = [
  'TitleBar',
  'StatsPanel',
  'FilterBar',
  'ZoomBar',
  'AuditPanel',
  'HrsWkStrip',
  'ContentArea', // wraps Sidebar + main + DetailPanel
];
