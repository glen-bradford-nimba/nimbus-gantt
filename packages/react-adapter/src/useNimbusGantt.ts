import { useRef, useEffect, useState, useCallback } from 'react';
import type {
  GanttTask,
  GanttDependency,
  GanttConfig,
  ZoomLevel,
  NimbusGanttPlugin,
} from '@nimbus-gantt/core';
import { NimbusGantt } from '@nimbus-gantt/core';

export function useNimbusGantt(
  containerRef: React.RefObject<HTMLDivElement | null>,
  config: GanttConfig,
) {
  const ganttRef = useRef<NimbusGantt | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const gantt = new NimbusGantt(containerRef.current, config);
    ganttRef.current = gantt;
    setIsReady(true);

    return () => {
      gantt.destroy();
      ganttRef.current = null;
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setData = useCallback((tasks: GanttTask[], deps?: GanttDependency[]) => {
    ganttRef.current?.setData(tasks, deps);
  }, []);

  const setZoom = useCallback((level: ZoomLevel) => {
    ganttRef.current?.setZoom(level);
  }, []);

  const scrollToDate = useCallback((date: string | Date) => {
    ganttRef.current?.scrollToDate(date);
  }, []);

  const scrollToTask = useCallback((taskId: string) => {
    ganttRef.current?.scrollToTask(taskId);
  }, []);

  const expandAll = useCallback(() => {
    ganttRef.current?.expandAll();
  }, []);

  const collapseAll = useCallback(() => {
    ganttRef.current?.collapseAll();
  }, []);

  const use = useCallback((plugin: NimbusGanttPlugin) => {
    ganttRef.current?.use(plugin);
  }, []);

  const destroy = useCallback(() => {
    ganttRef.current?.destroy();
    ganttRef.current = null;
  }, []);

  return {
    gantt: ganttRef.current,
    isReady,
    setData,
    setZoom,
    scrollToDate,
    scrollToTask,
    expandAll,
    collapseAll,
    use,
    destroy,
  };
}
