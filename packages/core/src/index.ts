// Nimbus Gantt — A high-performance, framework-agnostic Gantt chart library
// MIT License — Cloud Nimbus LLC

export { NimbusGantt } from './NimbusGantt';

// Types
export type {
  GanttTask,
  GanttDependency,
  GanttConfig,
  ColumnConfig,
  ZoomLevel,
  DependencyType,
  ThemeConfig,
  NimbusGanttPlugin,
  PluginHost,
  TimeScaleAPI,
  GanttState,
  TaskLayout,
  TaskTreeNode,
  HeaderCell,
  ResolvedConfig,
  ResolvedTheme,
  Action,
  DragState,
  GanttEventType,
  GanttRowDecorators,
  GanttRowDecoratorBadge,
  DecoratorBorderStyle,
  DecoratorBorderWidth,
  DecoratorFillStyle,
  DecoratorBadgePlacement,
} from './model/types';

// DAG utilities — consumers that need to walk parentId + additionalParentIds
export {
  getAllParentIds,
  getDescendantIds,
  rollupHoursDeduped,
} from './model/dag';

// Utilities consumers might need
export { TimeScale } from './layout/TimeScale';
export { LayoutEngine, parseDate } from './layout/LayoutEngine';
export { LIGHT_THEME, DARK_THEME, resolveConfig } from './theme/themes';
export { EventBus } from './events/EventBus';
export { DependencyRenderer } from './render/DependencyRenderer';
export { TooltipManager } from './render/TooltipManager';
export { HitTest } from './interaction/HitTest';
export type { HitResult, HitType } from './interaction/HitTest';

// Plugins
export { UndoRedoPlugin } from './plugins/UndoRedoPlugin';
export { KeyboardPlugin } from './plugins/KeyboardPlugin';
export { MilestonePlugin } from './plugins/MilestonePlugin';
export { GroupingPlugin } from './plugins/GroupingPlugin';
export {
  PriorityGroupingPlugin,
  CLOUD_NIMBUS_PRIORITY_BUCKETS,
  hoursWeightedProgress,
} from './plugins/PriorityGroupingPlugin';
export type {
  PriorityBucket,
  PriorityGroupingConfig,
} from './plugins/PriorityGroupingPlugin';
export { CriticalPathPlugin, computeCPM } from './plugins/CriticalPathPlugin';
export type { CPMResult, TaskCPMAnalysis } from './plugins/CriticalPathPlugin';
export { BaselinePlugin } from './plugins/BaselinePlugin';
export type { BaselineEntry, BaselinePluginOptions } from './plugins/BaselinePlugin';
export { VirtualScrollPlugin } from './plugins/VirtualScrollPlugin';
export type { VisibleRange, VirtualScrollPluginAPI } from './plugins/VirtualScrollPlugin';
export { ExportPlugin } from './plugins/ExportPlugin';
export { DarkThemePlugin } from './plugins/DarkThemePlugin';
export { WorkCalendarPlugin } from './plugins/WorkCalendarPlugin';
export { TelemetryPlugin } from './plugins/TelemetryPlugin';
export type { TelemetryEvent } from './plugins/TelemetryPlugin';
export { MotionControlPlugin } from './plugins/MotionControlPlugin';
export type { MotionControlOptions, OrientationMessage, GestureMessage } from './plugins/MotionControlPlugin';
export { MSProjectPlugin, importMSProjectXML, exportMSProjectXML } from './plugins/MSProjectPlugin';
export type { MSProjectExportOptions, MSProjectImportResult } from './plugins/MSProjectPlugin';
export { SplitTaskPlugin } from './plugins/SplitTaskPlugin';
export type { TaskSplit, SplitTaskPluginOptions } from './plugins/SplitTaskPlugin';
export { ResourceLevelingPlugin } from './plugins/ResourceLevelingPlugin';
export type {
  ResourceConfig,
  ResourceAssignment,
  LevelingResult,
  ResourceConflict,
  ResourceUtilization,
} from './plugins/ResourceLevelingPlugin';
export { RiskAnalysisPlugin } from './plugins/RiskAnalysisPlugin';
export type {
  RiskAssessment,
  RiskFactor,
  ProjectHealth,
  Recommendation,
} from './plugins/RiskAnalysisPlugin';
export { NetworkGraphPlugin } from './plugins/NetworkGraphPlugin';
export type {
  NetworkLayoutMode,
  NetworkNode,
  NetworkEdge,
} from './plugins/NetworkGraphPlugin';
export { ConfigPanelPlugin } from './plugins/ConfigPanelPlugin';
export { HeatmapViewPlugin } from './plugins/HeatmapViewPlugin';
export { MiniMapPlugin } from './plugins/MiniMapPlugin';
export { TimelineNotesPlugin } from './plugins/TimelineNotesPlugin';
export type { TimelineNote, TimelineNotesOptions } from './plugins/TimelineNotesPlugin';
export { TimeTravelPlugin } from './plugins/TimeTravelPlugin';
export type { HistorySnapshot, TimeTravelOptions } from './plugins/TimeTravelPlugin';
export { MonteCarloPlugin } from './plugins/MonteCarloPlugin';
export type { SimulationConfig, SimulationResult } from './plugins/MonteCarloPlugin';
export { NarrativePlugin } from './plugins/NarrativePlugin';
export type { ProjectNarrative, NarrativeChapter } from './plugins/NarrativePlugin';
export { WhatIfPlugin } from './plugins/WhatIfPlugin';
export type { WhatIfScenario, WhatIfChange } from './plugins/WhatIfPlugin';
export { SonificationPlugin } from './plugins/SonificationPlugin';
export type { SonificationConfig } from './plugins/SonificationPlugin';
