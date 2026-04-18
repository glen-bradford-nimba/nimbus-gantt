/**
 * cloudnimbus/defaults.ts — Priority buckets + filters + VIEW_MODES.
 * Extracted verbatim from v10-component-spec.md Plugin Constants.
 */
import type { PriorityBucket, FilterOption, ViewMode, NormalizedTask } from '../types';
import { DONE_STAGES } from '../../pipeline';

/* ── Priority buckets — GROUP_ORDER + GROUP_LABELS from spec ────────────── */
export const CLOUD_NIMBUS_PRIORITY_BUCKETS: PriorityBucket[] = [
  { id: 'top-priority', label: 'NOW',      color: '#dc2626', bgTint: '#ef4444', order: 0 },
  { id: 'active',       label: 'NEXT',     color: '#d97706', bgTint: '#f59e0b', order: 1 },
  { id: 'follow-on',    label: 'PLANNED',  color: '#059669', bgTint: '#10b981', order: 2 },
  { id: 'proposed',     label: 'PROPOSED', color: '#2563eb', bgTint: '#3b82f6', order: 3 },
  { id: 'deferred',     label: 'HOLD',     color: '#94a3b8', bgTint: '#94a3b8', order: 4 },
];

/* ── Stage category maps for filter predicates ──────────────────────────── */
const PROPOSAL_STAGES: Record<string, boolean> = {
  'Backlog': true,
  'Scoping In Progress': true,
  'Ready for Sizing': true,
  'Ready for Development': true,
};

/* ── FILTER_OPTIONS — spec order + labels ───────────────────────────────── */
export const CLOUD_NIMBUS_FILTERS: FilterOption[] = [
  {
    id: 'active',
    label: 'Active',
    predicate: (t) => !DONE_STAGES[t.stage || ''] && !t.isInactive,
  },
  {
    id: 'proposal',
    label: 'Proposal & Expansion',
    predicate: (t) => PROPOSAL_STAGES[t.stage || ''] || t.priorityGroup === 'proposed',
  },
  {
    id: 'done',
    label: 'Done',
    predicate: (t) => !!DONE_STAGES[t.stage || ''],
  },
  {
    id: 'real',
    label: 'Real T-NNNN tickets',
    predicate: (t) => !!(t.id && String(t.id).indexOf('T-') === 0),
  },
  {
    id: 'workstreams',
    label: 'Workstream rollups',
    predicate: (t) => !!(t.id && String(t.id).indexOf('WS-') === 0),
  },
  {
    id: 'all',
    label: 'Everything',
    predicate: () => true,
  },
];

/* ── VIEW_MODES (v10 spec §Plugin Constants) ───────────────────────────── */
export interface ViewModeDef { id: ViewMode; label: string; icon: string; }
/** All known view mode definitions — used by TitleBar to look up icons/labels. */
export const CLOUD_NIMBUS_VIEW_MODES: ViewModeDef[] = [
  { id: 'gantt',    label: 'Gantt',    icon: '\u25A4' },
  { id: 'list',     label: 'List',     icon: '\u2630' },
  { id: 'treemap',  label: 'Treemap',  icon: '\u25A6' },
  { id: 'bubbles',  label: 'Bubbles',  icon: '\u25C9' },
  { id: 'calendar', label: 'Calendar', icon: '\u25A5' },
  { id: 'flow',     label: 'Flow',     icon: '\u27FF' },
];

/**
 * Default enabled views for the cloudnimbus template.
 *
 * 2026-04-18 (0.182) — A1 stage-1 re-unlocked. All six pills render in
 * TitleBar via the existing `enabledViews.length > 1` gate. Per HQ's
 * scope decision (option b for visual parity with v9), non-Gantt views
 * route through a unified "Coming Soon" placeholder in IIFEApp's
 * renderComingSoon — explicit about scope rather than hiding the pills.
 *
 * Full alt-view renderer ports land in 0.183 alongside the AuditListView
 * port for the List view (v5's 2,225-line component is the reference for
 * List specifically; Treemap + Bubble have proper exported renderers in
 * packages/app/src/renderers/ that need wiring in once their consumer
 * surface is reconciled).
 */
export const CLOUD_NIMBUS_VIEWS: ViewMode[] = [
  'gantt',
  'list',
  'treemap',
  'bubbles',
  'calendar',
  'flow',
];

/* ── Category display — drives FilterBar color legend ──────────────────── */
export interface CategoryDisplay { label: string; color: string; category: string; }
export const CLOUD_NIMBUS_CATEGORIES: CategoryDisplay[] = [
  { category: 'in-flight', label: 'In Flight',       color: '#10b981' },
  { category: 'next-up',   label: 'Next Up',         color: '#3b82f6' },
  { category: 'paused',    label: 'Paused',          color: '#94a3b8' },
  { category: 'backlog',   label: 'Backlog (sized)', color: '#f59e0b' },
  { category: 'expansion', label: 'Expansion',       color: '#a78bfa' },
  { category: 'done',      label: 'Done',            color: '#cbd5e1' },
];

/* ── Default team pool (v8 Glen/Mahi/Antima) ────────────────────────────── */
export interface PoolMember { name: string; hoursPerMonth: number; role?: string; active?: boolean; }
export const CLOUD_NIMBUS_POOL: PoolMember[] = [
  { name: 'Glen',   role: 'Principal Engineer', hoursPerMonth: 80, active: true },
  { name: 'Mahi',   role: 'SFDC Dev',           hoursPerMonth: 50, active: true },
  { name: 'Antima', role: 'SFDC Dev (PT)',      hoursPerMonth: 40, active: true },
];

/** Safe fallback filter lookup by id. */
export function getFilterPredicate(
  filters: FilterOption[],
  id: string,
): (t: NormalizedTask) => boolean {
  const f = filters.find((x) => x.id === id);
  return f ? f.predicate : () => true;
}
