/**
 * templates/types.ts — All shared types for the v10 template framework.
 * Implements the API surface described in docs/template-api-design.md §1.
 */
import type { ComponentType } from 'react';
import type {
  NormalizedTask,
  TaskPatch,
  MappedTask,
  NimbusGanttEngine,
  AppMode,
} from '../types';
import type { TaskStats } from '../pipeline';

/* ── §1.1 Primitive enums ───────────────────────────────────────────────── */
export type ViewMode = 'gantt' | 'list' | 'treemap' | 'bubbles' | 'calendar' | 'flow';

export type SlotName =
  | 'TitleBar' | 'StatsPanel' | 'FilterBar' | 'ZoomBar'
  | 'Sidebar' | 'ContentArea' | 'DetailPanel' | 'AuditPanel' | 'HrsWkStrip';

/* ── §1.2 Feature flags ─────────────────────────────────────────────────── */
export interface FeatureFlags {
  titleBar: boolean;
  statsPanel: boolean;
  filterBar: boolean;
  zoomBar: boolean;
  sidebar: boolean;
  detailPanel: boolean;
  auditPanel: boolean;
  hrsWkStrip: boolean;
  dragReparent: boolean;
  depthShading: boolean;
  groupByToggle: boolean;
  hideCompletedToggle: boolean;
  /** DM-3 (0.183) — render a numeric hours column right of the tree.
   *  Optional so existing templates don't need churn; resolver defaults
   *  to false. */
  hoursColumn?: boolean;
  /** DM-3 (0.183) — render a "Budget Used" percent column right of tree.
   *  Optional so existing templates don't need churn; resolver defaults
   *  to false. */
  budgetUsedColumn?: boolean;
  /** DM-5 (0.183) — draw the rolled-up completion bar on header/bucket
   *  rows alongside the DM-4 per-item bars. Optional, resolver defaults
   *  to true. Pass `false` to suppress the fill (label stays). */
  headerRowCompletionBar?: boolean;
}

/* ── §1.3 Theme tokens ──────────────────────────────────────────────────── */
export interface ThemeTokens {
  primary: string; primaryHover: string; accent: string;
  bg: string; surface: string; surfaceAlt: string; border: string; borderSubtle: string;
  textPrimary: string; textSecondary: string; textMuted: string; textInverse: string;
  danger: string; warning: string; success: string; info: string;
  fontFamily: string; fontFamilyMono: string;
  fontSizeBase: string; fontSizeSm: string; fontSizeXs: string;
  radiusSm: string; radiusMd: string; radiusLg: string; radiusFull: string;
  spacingUnit: string;
  ganttGridColor: string; ganttHeaderBg: string; ganttWeekendBg: string;
  ganttTodayLine: string; ganttTodayBg: string;
  ganttBarDefault: string; ganttBarTextColor: string;
  ganttRowHoverBg: string; ganttSelectionRing: string; ganttDependencyLine: string;
}

/* ── §1.4 FilterOption, PriorityBucket ──────────────────────────────────── */
export interface FilterOption {
  id: string;
  label: string;
  predicate: (task: NormalizedTask) => boolean;
  count?: (tasks: NormalizedTask[]) => string;
}

export interface PriorityBucket {
  id: string; label: string; color: string; bgTint: string; order: number;
}

/* ── §1.6 AppState, AppEvent, SlotData ──────────────────────────────────── */
export type FilterMode = 'active' | 'proposal' | 'done' | 'real' | 'workstreams' | 'all';
export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';
export type GroupBy = 'priority' | 'epic';
/** DetailPanel render mode — 'view' shows read-only fields, 'edit' shows inputs. */
export type DetailMode = 'view' | 'edit';

export interface AppState {
  viewMode: ViewMode;
  filter: FilterMode | string;
  search: string;
  zoom: ZoomLevel;
  groupBy: GroupBy;
  hideCompleted: boolean;
  sidebarOpen: boolean;
  statsOpen: boolean;
  detailOpen: boolean;
  /** DetailPanel mode — toggled via pencil button in header, or set by
   *  TOGGLE_DETAIL's optional editMode payload (e.g. dblclick → edit). */
  detailMode: DetailMode;
  auditPanelOpen: boolean;
  fullscreen: boolean;
  selectedTaskId: string | null;
  pendingPatchCount: number;
}

export type AppEvent =
  | { type: 'SET_VIEW'; mode: ViewMode }
  | { type: 'SET_FILTER'; id: string }
  | { type: 'SET_SEARCH'; q: string }
  | { type: 'SET_ZOOM'; zoom: ZoomLevel }
  | { type: 'SET_GROUP_BY'; groupBy: GroupBy }
  | { type: 'TOGGLE_HIDE_COMPLETED' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'TOGGLE_STATS' }
  | { type: 'TOGGLE_DETAIL'; taskId?: string; editMode?: boolean }
  | { type: 'SET_DETAIL_MODE'; mode: DetailMode }
  | { type: 'TOGGLE_AUDIT_PANEL' }
  | { type: 'TOGGLE_FULLSCREEN' }
  | { type: 'SELECT_TASK'; taskId: string | null }
  | { type: 'PATCH'; patch: TaskPatch }
  | { type: 'RESET_PATCHES' };

export interface PatchLogEntry {
  ts: Date;
  desc: string;
}

export interface SlotData {
  tasks: NormalizedTask[];
  visibleTasks: MappedTask[];
  stats: TaskStats;
  patchLog: PatchLogEntry[];
}

/* ── §1.5 Component slots ───────────────────────────────────────────────── */
export interface SlotProps {
  config: TemplateConfig;
  state: AppState;
  dispatch: (event: AppEvent) => void;
  data: SlotData;
}

export interface VanillaSlotInstance {
  el: HTMLElement;
  update: (props: SlotProps) => void;
  destroy: () => void;
}

export interface VanillaSlot {
  (props: SlotProps): VanillaSlotInstance;
}

export interface ComponentSlot {
  react?: ComponentType<SlotProps>;
  vanilla?: VanillaSlot;
}

/* ── §1.7 Template definition ───────────────────────────────────────────── */
export interface TemplateDefaults {
  features: FeatureFlags;
  theme: ThemeTokens;
  buckets: PriorityBucket[];
  filters: FilterOption[];
  views: ViewMode[];
  title?: string;
  version?: string;
  /** Optional URL for the "API docs" anchor in TitleBar. When unset, the
   *  link is not rendered. v9 parity wires this on cloudnimbusllc.com to
   *  '/mf/delivery-timeline-v8-api'. Salesforce consumers leave it unset
   *  unless they have a hosted docs page reachable from Lightning. */
  apiDocsUrl?: string;
  /** Optional URL that the TitleBar "Fullscreen" button navigates to when
   *  clicked. When set: if `location.pathname === fullscreenUrl` the
   *  button is HIDDEN (user is already there); otherwise the button
   *  becomes a link (`window.location.href = fullscreenUrl`). When unset:
   *  the button falls back to the existing native TOGGLE_FULLSCREEN state
   *  toggle (CNN + localhost UX preserved). Salesforce consumers pass
   *  e.g. '/apex/DeliveryGanttStandalone' on the embedded-tab mount so
   *  users can jump to the fullscreen FlexiPage without the LWC wiring
   *  NavigationMixin manually. */
  fullscreenUrl?: string;
  /** Optional label prefix for completion-% displays (per-row progress,
   *  future bar labels). Default 'Budget Used' — the visible % is
   *  computed as `loggedHours / estimatedHours`, which is a budget
   *  tracker, not a true completion tracker. Keep overridable for
   *  future DM-7/DM-8 modes that may want different semantics. */
  progressLabel?: string;
  /** When true (default), the AuditListView's first-column record-ID chip
   *  is NOT rendered. Salesforce consumers hit this because `task.name`
   *  (or the fallback `task.id`) is the raw 18-char SF record ID
   *  (`a0D0300000…`), which should never reach end users (roadmap DM-2:
   *  names-not-IDs). Pass `false` from dev-/debug-only contexts to
   *  surface the ID for troubleshooting. Default true. */
  hideRecordIds?: boolean;
}

export interface TemplateStylesheet {
  /** Static-resource URL for IIFE mode. */
  url?: string;
  /** Inline CSS for fallback / dev mode. */
  inline?: string;
  /** Marker for React consumer: the bundler will resolve `import './styles.css'`. */
  importedByBundler?: true;
}

export interface Template {
  name: string;
  extends?: string;
  defaults: Partial<TemplateDefaults>;
  stylesheet: TemplateStylesheet;
  components: Partial<Record<SlotName, ComponentSlot>>;
}

/* ── §1.8 Overrides & resolved config ───────────────────────────────────── */
export interface TemplateOverrides {
  features?: Partial<FeatureFlags>;
  theme?: Partial<ThemeTokens>;
  components?: Partial<Record<SlotName, ComponentSlot>>;
  buckets?: PriorityBucket[];
  filters?: FilterOption[];
  views?: ViewMode[];
  title?: string;
  version?: string;
  apiDocsUrl?: string;
  fullscreenUrl?: string;
  progressLabel?: string;
  hideRecordIds?: boolean;
}

export interface AuditSubmitResult {
  ok: boolean;
  msg: string;
  /** Optional short commit SHA for the audit log UI. */
  sha?: string;
}

export type AuditSubmitHandler = (note: string) => Promise<AuditSubmitResult>;

/**
 * 0.184 — shape for the AuditPanel preview modal. One entry per item with
 * pending changes. `descs` is preferred for display (human-readable); fields
 * is the raw list for grouping/stats. Consumers (ProFormaAdapter on CN,
 * deliveryProFormaTimeline on DH) compute these from their local override
 * map and pass them through `TemplateConfig.pendingChanges`.
 */
export interface AuditPreviewItem {
  id: string;
  /** Display title — falls back to id if absent. */
  title?: string;
  /** Raw list of fields that differ from baseline (e.g. ["start","end"]). */
  fields: string[];
  /** Human-readable change descriptions (e.g. ["dates → 2026-04-13 → 2026-04-17"]). */
  descs: string[];
}

export interface TemplateConfig {
  templateName: string;
  features: FeatureFlags;
  theme: ThemeTokens;
  buckets: PriorityBucket[];
  filters: FilterOption[];
  views: ViewMode[];
  components: Record<SlotName, ComponentSlot>;
  stylesheet: TemplateStylesheet;
  title: string;
  version: string;
  /** Optional URL for the "API docs" anchor in TitleBar. See TemplateDefaults. */
  apiDocsUrl?: string;
  /** Optional URL for the TitleBar "Fullscreen" button nav. See TemplateDefaults. */
  fullscreenUrl?: string;
  /** Optional label prefix for completion-% displays. See TemplateDefaults. */
  progressLabel?: string;
  /** Default-true: suppress AuditListView's raw-record-ID first column.
   *  See TemplateDefaults. */
  hideRecordIds?: boolean;
  /** Render mode — default 'fullscreen'. When 'embedded', chrome feature
   *  flags are forced off before resolution, leaving ContentArea only. */
  mode: AppMode;
  /** Optional engine reference — used by ContentArea to mount the Gantt. */
  engine?: NimbusGanttEngine;
  /** Host-provided fullscreen navigation callbacks. TitleBar reads
   *  onExitFullscreen to relabel its Fullscreen button when mode==='fullscreen';
   *  IIFEApp reads onEnterFullscreen to wire the embedded-mode floating
   *  button. Library NEVER navigates itself. */
  onEnterFullscreen?: () => void;
  onExitFullscreen?: () => void;
  /** Optional runtime audit-submit handler. When present, AuditPanel's
   *  Submit+commit button will call it, show result state, and only reset
   *  the pending-patch count on success. When absent, falls back to a
   *  local RESET_PATCHES dispatch (no persistence). */
  onAuditSubmit?: AuditSubmitHandler;
  /** 0.184 — list of pending changes surfaced in the AuditPanel preview
   *  modal when the user clicks Submit. When present + non-empty, the panel
   *  opens a confirm-before-commit modal listing every change. When empty or
   *  absent, Submit fires onAuditSubmit immediately (legacy behaviour). */
  pendingChanges?: AuditPreviewItem[];
  /** Optional runtime override for the AuditPanel dirty flag. When present,
   *  this wins over state.pendingPatchCount. Consumers with their own state
   *  store (e.g. useProFormaState) should pipe their isDirty here so the
   *  "unsaved changes" pill and Submit button reflect real dirty state. */
  isDirty?: boolean;
  /** 0.185.4 — record-URL template passed through from MountOptions.
   *  DetailPanel renders task.id as an `<a href>` when this is set. */
  recordUrlTemplate?: string;
  /** CH-1 / 0.183.1 — runtime chrome-visibility toggle. Wired by IIFEApp to
   *  the same closure that backs `handle.toggleChrome()`. Slots (e.g. the
   *  TitleBar Unpin button) call this to hide chrome without needing the
   *  outer mount handle in scope. Re-show is programmatic via
   *  `handle.toggleChrome(true)` since the button that hid chrome hides
   *  with it. */
  toggleChrome?: (visible?: boolean) => void;
}

/* ── Re-export upstream core types ──────────────────────────────────────── */
export type {
  NormalizedTask,
  TaskPatch,
  MappedTask,
  NimbusGanttEngine,
  AppMode,
} from '../types';
export type { TaskStats } from '../pipeline';
