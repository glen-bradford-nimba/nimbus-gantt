'use client';
/**
 * NimbusGanttAppReact.tsx — Template-driven React driver (v10).
 *
 * Renders the resolved template's React slots. The ContentArea slot owns a
 * host div (`[data-nga-gantt-host="1"]`); we imperatively mount the v5
 * IIFEApp gantt engine inside that host so React never fights the canvas.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, createElement, Fragment } from 'react';
import type { CSSProperties } from 'react';
import type {
  Template, TemplateOverrides, TemplateConfig, SlotProps, SlotData, AppEvent,
  AuditSubmitHandler,
} from './templates/types';
import type { NormalizedTask, TaskPatch, NimbusGanttEngine, ScreenPos, TaskClickSource } from './types';
import { resolveTemplate } from './templates/resolver';
import { INITIAL_STATE, reduceAppState } from './templates/state';
import { SLOT_ORDER, shouldRenderSlot } from './templates/slots';
import { themeToCssVars } from './templates/css';
import { applyFilter, buildTasks, computeStats } from './pipeline';
import { IIFEApp } from './IIFEApp';

// Register built-in templates so `template="cloudnimbus"` works without
// the consumer importing them separately.
import './templates/cloudnimbus';
import './templates/minimal';

export interface NimbusGanttAppProps {
  template?: 'cloudnimbus' | 'minimal' | (string & {}) | Template;
  data?: NormalizedTask[];
  /** Legacy alias for `data`. */
  tasks?: NormalizedTask[];
  onPatch: (patch: TaskPatch) => void | Promise<void>;
  /** Optional runtime audit-submit handler. When present, AuditPanel's
   *  Submit+commit button calls this; when absent, commit is local-only. */
  onAuditSubmit?: AuditSubmitHandler;
  /** Optional runtime override for AuditPanel dirty state. */
  isDirty?: boolean;
  /** Interaction callbacks — forwarded through to the underlying NimbusGantt
   *  engine + container-level listeners. Consumers use these to render
   *  tooltips, context menus, dependency-linking UI, etc. */
  onTaskClick?: (task: NormalizedTask, source: TaskClickSource) => void;
  onTaskDoubleClick?: (task: NormalizedTask) => void;
  onTaskHover?: (taskId: string | null) => void;
  onTaskContextMenu?: (task: NormalizedTask, pos: ScreenPos) => void;
  overrides?: TemplateOverrides;
  engine?: NimbusGanttEngine;
  style?: CSSProperties;
  className?: string;
  /** Legacy field — forwarded to IIFEApp mount. */
  config?: Parameters<typeof IIFEApp.mount>[1]['config'];
}

export function NimbusGanttApp(props: NimbusGanttAppProps) {
  const tasks = props.data ?? props.tasks ?? [];
  const tplInput = props.template ?? 'cloudnimbus';

  const tplConfig: TemplateConfig = useMemo(
    () => {
      const cfg = resolveTemplate(tplInput as string | Template, props.overrides);
      if (props.engine) cfg.engine = props.engine;
      if (props.onAuditSubmit) cfg.onAuditSubmit = props.onAuditSubmit;
      if (props.isDirty !== undefined) cfg.isDirty = props.isDirty;
      return cfg;
    },
    [tplInput, props.overrides, props.engine, props.onAuditSubmit, props.isDirty],
  );

  const [state, rawDispatch] = useReducer(reduceAppState, INITIAL_STATE);

  // Wrap the reducer dispatch so slot-level PATCH events are forwarded to
  // the consumer's onPatch callback (same surface drag/resize already use
  // via IIFEApp.onTaskPatch). Without this, a Save button inside a slot
  // would update pendingPatchCount but never persist the patch.
  const onPatchRefForDispatch = useRef(props.onPatch);
  onPatchRefForDispatch.current = props.onPatch;
  const dispatch = useCallback((ev: AppEvent) => {
    rawDispatch(ev);
    if (ev.type === 'PATCH') {
      try { onPatchRefForDispatch.current(ev.patch); } catch { /* swallow */ }
    }
  }, []);

  const data: SlotData = useMemo(() => {
    const filtered = applyFilter(tasks, state.filter as 'active', state.search);
    return {
      tasks,
      visibleTasks: buildTasks(filtered),
      stats: computeStats(filtered),
      patchLog: [],
    };
  }, [tasks, state.filter, state.search]);

  const slotProps: SlotProps = { config: tplConfig, state, dispatch, data };

  const rootRef = useRef<HTMLDivElement>(null);
  const ganttInstanceRef = useRef<ReturnType<typeof IIFEApp.mount> | null>(null);

  const onPatchRef = useRef(props.onPatch);
  onPatchRef.current = props.onPatch;

  // Latest-value refs for the interaction callbacks so IIFEApp.mount can
  // capture them once without stale-closure issues when props change.
  const onTaskClickRef = useRef(props.onTaskClick);
  const onTaskDblClickRef = useRef(props.onTaskDoubleClick);
  const onTaskHoverRef = useRef(props.onTaskHover);
  const onTaskContextMenuRef = useRef(props.onTaskContextMenu);
  onTaskClickRef.current = props.onTaskClick;
  onTaskDblClickRef.current = props.onTaskDoubleClick;
  onTaskHoverRef.current = props.onTaskHover;
  onTaskContextMenuRef.current = props.onTaskContextMenu;

  // Mount the IIFEApp gantt engine inside the ContentArea host exactly once.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const host = root.querySelector<HTMLElement>('[data-nga-gantt-host="1"]');
    if (!host) return;

    ganttInstanceRef.current = IIFEApp.mount(host, {
      tasks,
      onPatch: (p) => onPatchRef.current(p),
      engine: props.engine,
      template: tplConfig.templateName,
      overrides: props.overrides,
      config: props.config,
      // React already renders all chrome slots above — IIFEApp only drives
      // the gantt engine inside the ContentArea host. No chrome duplication.
      engineOnly: true,
      // Forward interaction callbacks through to consumers via refs so
      // changing callbacks doesn't require a re-mount.
      // Click: open DetailPanel in view mode (mirrors v5 single-click).
      onTaskClick: (t, src) => {
        try {
          dispatch({ type: 'TOGGLE_DETAIL', taskId: String(t.id), editMode: false });
        } catch { /* swallow */ }
        onTaskClickRef.current?.(t, src);
      },
      // Double-click: Phase 3 — open DetailPanel directly in edit mode
      // (v5 parity via `openPanel(item, true)`). The consumer callback
      // fires after as a notification, not a control path. This keeps v10
      // consumers from needing to juggle refs or a dispatch handle.
      onTaskDoubleClick: (t) => {
        try {
          dispatch({ type: 'TOGGLE_DETAIL', taskId: String(t.id), editMode: true });
        } catch { /* swallow */ }
        onTaskDblClickRef.current?.(t);
      },
      onTaskHover: (id) => onTaskHoverRef.current?.(id),
      onTaskContextMenu: (t, pos) => onTaskContextMenuRef.current?.(t, pos),
    });

    return () => {
      IIFEApp.unmount(host);
      ganttInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forward raw task updates (data edits, patches) to the live IIFE instance.
  useEffect(() => {
    if (ganttInstanceRef.current) ganttInstanceRef.current.setTasks(tasks);
  }, [tasks]);

  // Forward filter/search state changes to the gantt engine so the canvas
  // rerenders when the user clicks a filter tab or types in the search box.
  useEffect(() => {
    type WithFilter = typeof ganttInstanceRef.current & { setFilter?: (f: string, s: string) => void };
    const inst = ganttInstanceRef.current as WithFilter | null;
    if (inst?.setFilter) inst.setFilter(state.filter, state.search || '');
  }, [state.filter, state.search]);

  // Forward zoom level changes to the gantt engine.
  useEffect(() => {
    type WithZoom = typeof ganttInstanceRef.current & { setZoom?: (z: string) => void };
    const inst = ganttInstanceRef.current as WithZoom | null;
    if (inst?.setZoom) inst.setZoom(state.zoom);
  }, [state.zoom]);

  // Forward groupBy changes to the gantt engine so Priority/Epics toggle rerenders.
  useEffect(() => {
    type WithGroupBy = typeof ganttInstanceRef.current & { setGroupBy?: (g: string) => void };
    const inst = ganttInstanceRef.current as WithGroupBy | null;
    if (inst?.setGroupBy) inst.setGroupBy(state.groupBy);
  }, [state.groupBy]);

  const themeStyle: CSSProperties = useMemo(() => {
    const cssVars = themeToCssVars(tplConfig.theme)
      .split(';')
      .filter(Boolean)
      .reduce<Record<string, string>>((acc, decl) => {
        const ix = decl.indexOf(':');
        if (ix > 0) acc[decl.slice(0, ix)] = decl.slice(ix + 1);
        return acc;
      }, {});
    return cssVars as CSSProperties;
  }, [tplConfig.theme]);

  const rootClassName = ('nga-root ' + (props.className || '')).trim();
  const style: CSSProperties = { height: '100%', width: '100%', ...themeStyle, ...props.style };

  // Render slots via the template's React components. SLOT_ORDER determines
  // the visual order of top-level slots.
  const children: Array<ReturnType<typeof createElement>> = [];
  SLOT_ORDER.forEach((slotName) => {
    if (!shouldRenderSlot(slotName, tplConfig.features)) return;
    const slotDef = tplConfig.components[slotName];
    if (!slotDef || !slotDef.react) return;
    children.push(createElement(slotDef.react, { ...slotProps, key: slotName }));
  });

  return createElement(
    'div',
    {
      ref: rootRef,
      className: rootClassName,
      'data-template': tplConfig.templateName,
      style,
    },
    createElement(Fragment, null, ...children),
  );
}

/** Legacy named export kept for back-compat. */
export const NimbusGanttAppReact = NimbusGanttApp;

export function useDispatch(): (ev: AppEvent) => void {
  // Re-exported so custom templates can create useDispatch hooks if needed.
  throw new Error('useDispatch is a placeholder — use props.dispatch inside a slot.');
}
