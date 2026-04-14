'use client';
/**
 * NimbusGanttAppReact.tsx — Template-driven React driver (v10).
 *
 * Renders the resolved template's React slots. The ContentArea slot owns a
 * host div (`[data-nga-gantt-host="1"]`); we imperatively mount the v5
 * IIFEApp gantt engine inside that host so React never fights the canvas.
 */
import { useEffect, useMemo, useReducer, useRef, createElement, Fragment } from 'react';
import type { CSSProperties } from 'react';
import type {
  Template, TemplateOverrides, TemplateConfig, SlotProps, SlotData, AppEvent,
} from './templates/types';
import type { NormalizedTask, TaskPatch, NimbusGanttEngine } from './types';
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
      return cfg;
    },
    [tplInput, props.overrides, props.engine],
  );

  const [state, dispatch] = useReducer(reduceAppState, INITIAL_STATE);

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
    });

    return () => {
      IIFEApp.unmount(host);
      ganttInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forward task updates to the live IIFE instance.
  useEffect(() => {
    if (ganttInstanceRef.current) ganttInstanceRef.current.setTasks(tasks);
  }, [tasks]);

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
