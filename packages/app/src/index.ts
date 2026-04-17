/**
 * @nimbus-gantt/app — Batteries-included NimbusGantt application shell (v10).
 *
 * TypeScript module entry (for bundler consumers / React adapters).
 * Use iife-entry.ts for the vanilla IIFE bundle.
 */

export { IIFEApp } from './IIFEApp';
export type { TemplateAwareMountOptions } from './IIFEApp';

export { NimbusGanttApp, NimbusGanttAppReact } from './NimbusGanttAppReact';
export type { NimbusGanttAppProps } from './NimbusGanttAppReact';

/* ── Core pipeline types + helpers (unchanged) ──────────────────────────── */
export type {
  NormalizedTask,
  TaskPatch,
  PriorityBucket,
  AppConfig,
  MountOptions,
  AppInstance,
  MappedTask,
  NimbusGanttEngine,
  ScreenPos,
  TaskClickSource,
  AppMode,
} from './types';

export {
  DEFAULT_PRIORITY_BUCKETS,
  GROUP_BAR,
  STAGE_COLORS,
  DONE_STAGES,
  buildDepthMap,
  buildTasks,
  buildTasksEpic,
  applyFilter,
  computeStats,
  isBucketId,
  todayISO,
  addDays,
  addMonths,
  darkenColor,
} from './pipeline';

export type { TaskStats } from './pipeline';

export { startDepthShading } from './depthShading';
export { startDragReparent } from './dragReparent';

export { renderTreemap } from './renderers/treemap';
export type { TreemapRenderOptions } from './renderers/treemap';
export { renderBubble } from './renderers/bubble';
export type { BubbleRenderOptions } from './renderers/bubble';

/* ── v10 template framework ────────────────────────────────────────────── */
export {
  defineTemplate, registerTemplate, getTemplate, listTemplates, hasTemplate,
  resolveTemplate, inheritReact, inheritVanilla,
  INITIAL_STATE, reduceAppState,
  SLOT_ORDER, SLOT_TO_FEATURE, shouldRenderSlot,
  themeToCssVars, themeToScopedCss,
  ensureTemplateCss, removeTemplateCss,
} from './templates';

export type {
  Template, TemplateOverrides, TemplateConfig, TemplateDefaults, TemplateStylesheet,
  FeatureFlags, ThemeTokens,
  SlotName, SlotProps, ComponentSlot, VanillaSlot, VanillaSlotInstance,
  ViewMode, FilterOption, FilterMode, ZoomLevel, GroupBy, DetailMode,
  AppState, AppEvent, SlotData, PatchLogEntry,
} from './templates/types';

export { cloudnimbusTemplate } from './templates/cloudnimbus';
export { minimalTemplate } from './templates/minimal';
