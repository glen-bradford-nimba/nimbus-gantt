import React, { useRef, useEffect, useMemo } from 'react';
import type {
  GanttTask,
  GanttDependency,
  GanttConfig,
  ZoomLevel,
  NimbusGanttPlugin,
  ThemeConfig,
  ColumnConfig,
  DependencyType,
} from '@nimbus-gantt/core';
import { NimbusGantt } from '@nimbus-gantt/core';

export interface NimbusGanttChartProps {
  // Data
  tasks: GanttTask[];
  dependencies?: GanttDependency[];

  // Configuration
  columns?: ColumnConfig[];
  zoomLevel?: ZoomLevel;
  rowHeight?: number;
  barHeight?: number;
  headerHeight?: number;
  gridWidth?: number;
  readOnly?: boolean;
  showToday?: boolean;
  showWeekends?: boolean;
  showProgress?: boolean;
  colorMap?: Record<string, string>;
  theme?: 'light' | 'dark' | ThemeConfig;

  // Plugins
  plugins?: NimbusGanttPlugin[];

  // Callbacks
  onTaskClick?: (task: GanttTask) => void;
  onTaskDblClick?: (task: GanttTask) => void;
  onTaskMove?: (task: GanttTask, startDate: string, endDate: string) => void | Promise<void>;
  onTaskResize?: (task: GanttTask, startDate: string, endDate: string) => void | Promise<void>;
  onTaskProgressChange?: (task: GanttTask, progress: number) => void | Promise<void>;
  onDependencyCreate?: (source: string, target: string, type: DependencyType) => void | Promise<void>;
  onDependencyClick?: (dep: GanttDependency) => void;
  onViewChange?: (zoomLevel: ZoomLevel, startDate: string, endDate: string) => void;
  onTaskSelect?: (taskIds: string[]) => void;

  // Styling
  className?: string;
  style?: React.CSSProperties;
  height?: string | number;
}

export function NimbusGanttChart(props: NimbusGanttChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<NimbusGantt | null>(null);
  const pluginsApplied = useRef(false);

  // Build config from props — used only for initial creation
  const config = useMemo(
    (): GanttConfig => ({
      tasks: props.tasks,
      dependencies: props.dependencies,
      columns: props.columns,
      zoomLevel: props.zoomLevel,
      rowHeight: props.rowHeight,
      barHeight: props.barHeight,
      headerHeight: props.headerHeight,
      gridWidth: props.gridWidth,
      readOnly: props.readOnly,
      showToday: props.showToday,
      showWeekends: props.showWeekends,
      showProgress: props.showProgress,
      colorMap: props.colorMap,
      theme: props.theme,
      onTaskClick: props.onTaskClick,
      onTaskDblClick: props.onTaskDblClick,
      onTaskMove: props.onTaskMove,
      onTaskResize: props.onTaskResize,
      onTaskProgressChange: props.onTaskProgressChange,
      onDependencyCreate: props.onDependencyCreate,
      onDependencyClick: props.onDependencyClick,
      onViewChange: props.onViewChange,
      onTaskSelect: props.onTaskSelect,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Initialize gantt on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const gantt = new NimbusGantt(containerRef.current, {
      ...config,
      tasks: props.tasks,
      dependencies: props.dependencies,
    });

    ganttRef.current = gantt;

    // Apply plugins once
    if (props.plugins && !pluginsApplied.current) {
      for (const plugin of props.plugins) {
        gantt.use(plugin);
      }
      pluginsApplied.current = true;
    }

    return () => {
      gantt.destroy();
      ganttRef.current = null;
      pluginsApplied.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when tasks/dependencies change
  useEffect(() => {
    if (ganttRef.current) {
      ganttRef.current.setData(props.tasks, props.dependencies);
    }
  }, [props.tasks, props.dependencies]);

  // Update zoom when it changes
  useEffect(() => {
    if (ganttRef.current && props.zoomLevel) {
      ganttRef.current.setZoom(props.zoomLevel);
    }
  }, [props.zoomLevel]);

  const height = props.height || '100%';

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{
        width: '100%',
        height: typeof height === 'number' ? `${height}px` : height,
        ...props.style,
      }}
    />
  );
}
