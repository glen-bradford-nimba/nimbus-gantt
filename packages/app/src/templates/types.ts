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
  | { type: 'TOGGLE_DETAIL'; taskId?: string }
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
  /** Optional engine reference — used by ContentArea to mount the Gantt. */
  engine?: NimbusGanttEngine;
}

/* ── Re-export upstream core types ──────────────────────────────────────── */
export type {
  NormalizedTask,
  TaskPatch,
  MappedTask,
  NimbusGanttEngine,
} from '../types';
export type { TaskStats } from '../pipeline';
