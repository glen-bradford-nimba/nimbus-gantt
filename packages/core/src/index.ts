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
} from './model/types';

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
