'use client';
/**
 * NimbusGanttAppReact.tsx — Template-driven React driver (v10).
 *
 * Renders the resolved template's React slots. The ContentArea slot owns a
 * host div (`[data-nga-gantt-host="1"]`); we imperatively mount the v5
 * IIFEApp gantt engine inside that host so React never fights the canvas.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, createElement, Fragment } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';
import type {
  Template, TemplateOverrides, TemplateConfig, SlotProps, SlotData, AppEvent,
  AuditSubmitHandler, FeatureFlags, AppMode,
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

const EMBEDDED_FEATURE_OVERRIDES: Partial<FeatureFlags> = {
  titleBar: false,
  statsPanel: false,
  filterBar: false,
  zoomBar: false,
  sidebar: false,
  detailPanel: false,
  auditPanel: false,
  hrsWkStrip: false,
};

export interface NimbusGanttAppProps {
  template?: 'cloudnimbus' | 'minimal' | (string & {}) | Template;
  data?: NormalizedTask[];
  /** Legacy alias for `data`. */
  tasks?: NormalizedTask[];
  onPatch: (patch: TaskPatch) => void | Promise<void>;
  /** Render mode — 'fullscreen' (default) or 'embedded'. Embedded suppresses
   *  all chrome slots and shows a single "↗ Full Screen" button overlay. */
  mode?: AppMode;
  /** Fired when the user clicks the embedded-mode "↗ Full Screen" button. */
  onEnterFullscreen?: () => void;
  /** Fired when the user clicks the fullscreen-mode "← Exit Full Screen"
   *  button in TitleBar. */
  onExitFullscreen?: () => void;
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
  /** 0.185 — when true, drag-edits and reorders are buffered inside the
   *  IIFE instance instead of firing onPatch per-edit. Host commits via
   *  `handleRef.current.commitEdits()` (typically wired to AuditPanel
   *  Submit) or reverts via `discardEdits()`.
   *
   *  ⚠️ React-driver caveat (0.185): NimbusGanttAppReact mounts with
   *  `engineOnly: true`, which currently has stub handle methods —
   *  `getPendingEdits()` returns `[]`, `commitEdits()` resolves empty,
   *  `discardEdits()` is a no-op. Real batch buffering only works on
   *  the vanilla `IIFEApp.mount(...)` path (DH LWC's primary surface).
   *  React-driver batch support is queued for a follow-up cut once a
   *  React consumer needs it. */
  batchMode?: boolean;
  /** 0.185 — ref object that receives the IIFEApp mount handle once the
   *  underlying engine is mounted. Consumers (CN v10/v12 React, future
   *  React-driver hosts) call `handleRef.current.commitEdits()` etc.
   *  See batchMode caveat above for the engineOnly limitation. */
  handleRef?: MutableRefObject<ReturnType<typeof IIFEApp.mount> | null>;
}

export function NimbusGanttApp(props: NimbusGanttAppProps) {
  const tasks = props.data ?? props.tasks ?? [];
  const tplInput = props.template ?? 'cloudnimbus';
  const mode: AppMode = props.mode ?? 'fullscreen';

  const tplConfig: TemplateConfig = useMemo(
    () => {
      // Embedded mode overlays feature=off for all chrome slots BEFORE
      // template resolution so SLOT_ORDER iteration skips them entirely.
      // Consumer overrides still win on top.
      const resolvedOverrides: TemplateOverrides = mode === 'embedded'
        ? {
            ...(props.overrides || {}),
            features: {
              ...EMBEDDED_FEATURE_OVERRIDES,
              ...(props.overrides?.features || {}),
            },
          }
        : (props.overrides || {});
      const cfg = resolveTemplate(tplInput as string | Template, resolvedOverrides);
      cfg.mode = mode;
      if (props.engine) cfg.engine = props.engine;
      if (props.onAuditSubmit) cfg.onAuditSubmit = props.onAuditSubmit;
      if (props.isDirty !== undefined) cfg.isDirty = props.isDirty;
      if (props.onEnterFullscreen) cfg.onEnterFullscreen = props.onEnterFullscreen;
      if (props.onExitFullscreen)  cfg.onExitFullscreen  = props.onExitFullscreen;
      return cfg;
    },
    [tplInput, mode, props.overrides, props.engine, props.onAuditSubmit, props.isDirty, props.onEnterFullscreen, props.onExitFullscreen],
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
      // 0.185 — pass-through. engineOnly mount stubs the batch handle
      // verbs (see prop docstring) so this is functionally a no-op until
      // engineOnly batch support lands in a follow-up.
      batchMode: props.batchMode,
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

    // 0.185 — forward the mount handle to the consumer's handleRef so they
    // can call getPendingEdits/commitEdits/discardEdits (batch verbs) +
    // toggleChrome/setTasks (existing verbs). Cleared on unmount so a stale
    // ref doesn't outlive the engine.
    if (props.handleRef) props.handleRef.current = ganttInstanceRef.current;

    return () => {
      IIFEApp.unmount(host);
      ganttInstanceRef.current = null;
      if (props.handleRef) props.handleRef.current = null;
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

  // Embedded-mode floating "↗ Full Screen" button. Rendered INSIDE the root
  // div so it overlays ContentArea. Host owns navigation — library only
  // invokes the callback.
  if (mode === 'embedded' && props.onEnterFullscreen) {
    children.push(
      createElement(
        'button',
        {
          key: '__nga_embedded_fs',
          type: 'button',
          'data-nga-fullscreen-enter': '1',
          onClick: () => props.onEnterFullscreen?.(),
          style: {
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 50,
            padding: '6px 10px',
            fontSize: 11,
            fontWeight: 600,
            color: '#1f2937',
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            cursor: 'pointer',
          },
        },
        '\u2197 Full Screen',
      ),
    );
  }

  return createElement(
    'div',
    {
      ref: rootRef,
      className: rootClassName,
      'data-template': tplConfig.templateName,
      style: { ...style, position: (style.position as 'relative' | undefined) || 'relative' },
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
