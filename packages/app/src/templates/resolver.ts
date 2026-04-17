/**
 * templates/resolver.ts — Extension chain + per-field merge (per API design §5).
 *
 * Walks `extends` chain inward to a leaf, applies defaults outermost-first,
 * then consumer overrides on top. Cycles throw.
 */
import type {
  Template,
  TemplateConfig,
  TemplateOverrides,
  TemplateDefaults,
  FeatureFlags,
  ThemeTokens,
  PriorityBucket,
  FilterOption,
  ViewMode,
  ComponentSlot,
  SlotName,
  TemplateStylesheet,
} from './types';
import { getTemplate, hasTemplate } from './registry';

/* ── Default feature flags (all on; consumers can disable) ─────────────── */
const DEFAULT_FEATURES: FeatureFlags = {
  titleBar: true,
  statsPanel: true,
  filterBar: true,
  zoomBar: true,
  sidebar: true,
  detailPanel: true,
  auditPanel: true,
  hrsWkStrip: true,
  dragReparent: true,
  depthShading: true,
  groupByToggle: true,
  hideCompletedToggle: true,
};

/* ── Default theme — safe neutral fallback used when a template lacks tokens ── */
const DEFAULT_THEME: ThemeTokens = {
  primary: '#2563eb', primaryHover: '#1d4ed8', accent: '#7c3aed',
  bg: '#f8fafc', surface: '#ffffff', surfaceAlt: '#f1f5f9',
  border: '#e2e8f0', borderSubtle: '#f1f5f9',
  textPrimary: '#0f172a', textSecondary: '#475569', textMuted: '#94a3b8', textInverse: '#ffffff',
  danger: '#ef4444', warning: '#f59e0b', success: '#10b981', info: '#3b82f6',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMono: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
  fontSizeBase: '12px', fontSizeSm: '10px', fontSizeXs: '9px',
  radiusSm: '4px', radiusMd: '6px', radiusLg: '12px', radiusFull: '9999px',
  spacingUnit: '4px',
  ganttGridColor: '#e5e7eb', ganttHeaderBg: '#f3f4f6', ganttWeekendBg: 'rgba(229,231,235,0.4)',
  ganttTodayLine: '#ef4444', ganttTodayBg: 'rgba(239,68,68,0.08)',
  ganttBarDefault: '#94a3b8', ganttBarTextColor: '#ffffff',
  ganttRowHoverBg: 'rgba(59,130,246,0.04)', ganttSelectionRing: '#3b82f6',
  ganttDependencyLine: '#3b82f6',
};

const ALL_SLOT_NAMES: SlotName[] = [
  'TitleBar', 'StatsPanel', 'FilterBar', 'ZoomBar',
  'Sidebar', 'ContentArea', 'DetailPanel', 'AuditPanel', 'HrsWkStrip',
];

/* ── §9.1 Slot inheritance helpers ──────────────────────────────────────── */
export function inheritReact(
  prev: ComponentSlot | undefined,
  next: ComponentSlot | undefined,
): ComponentSlot {
  return {
    react: (next && next.react) || (prev && prev.react),
    vanilla: (next && next.vanilla) || (prev && prev.vanilla),
  };
}

export function inheritVanilla(
  prev: ComponentSlot | undefined,
  next: ComponentSlot | undefined,
): ComponentSlot {
  // Inheritance rules are identical — alias kept for clarity at call site.
  return inheritReact(prev, next);
}

/** Walk `extends` chain root-first. Throws on cycles or missing ancestors. */
function collectChain(template: Template | string): Template[] {
  const chain: Template[] = [];
  const visited = new Set<string>();
  let cursor: Template | undefined = typeof template === 'string'
    ? getTemplate(template)
    : template;

  while (cursor) {
    if (visited.has(cursor.name)) {
      throw new Error("Template cycle detected at '" + cursor.name + "'");
    }
    visited.add(cursor.name);
    chain.push(cursor);
    if (cursor.extends) {
      if (!hasTemplate(cursor.extends)) {
        throw new Error(
          "Template '" + cursor.name + "' extends unknown '" + cursor.extends + "'",
        );
      }
      cursor = getTemplate(cursor.extends);
    } else {
      cursor = undefined;
    }
  }

  // We built child-first; return root-first.
  chain.reverse();
  return chain;
}

/* ── Field merge helpers (per design §5 table) ──────────────────────────── */
function shallowMerge<T extends object>(prev: Partial<T>, next: Partial<T>): Partial<T> {
  const out: Partial<T> = { ...prev };
  (Object.keys(next) as Array<keyof T>).forEach((k) => {
    if (next[k] !== undefined) (out as T)[k] = next[k] as T[keyof T];
  });
  return out;
}

function mergeComponents(
  prev: Partial<Record<SlotName, ComponentSlot>>,
  next: Partial<Record<SlotName, ComponentSlot>>,
): Partial<Record<SlotName, ComponentSlot>> {
  const out: Partial<Record<SlotName, ComponentSlot>> = { ...prev };
  (Object.keys(next) as SlotName[]).forEach((slot) => {
    out[slot] = inheritReact(prev[slot], next[slot]);
  });
  return out;
}

/* ── Main resolver ──────────────────────────────────────────────────────── */
export function resolveTemplate(
  template: string | Template,
  overrides?: TemplateOverrides,
): TemplateConfig {
  const chain = collectChain(template);
  const leaf = chain[chain.length - 1];

  // Start with engine-provided fallbacks.
  let features: FeatureFlags = { ...DEFAULT_FEATURES };
  let theme: ThemeTokens = { ...DEFAULT_THEME };
  let buckets: PriorityBucket[] = [];
  let filters: FilterOption[] = [];
  let views: ViewMode[] = ['gantt', 'list', 'treemap', 'bubbles', 'calendar', 'flow'];
  let components: Partial<Record<SlotName, ComponentSlot>> = {};
  let stylesheet: TemplateStylesheet = {};
  let title = 'Nimbus Gantt';
  let version = '';

  // Apply each template in the chain (root-first).
  chain.forEach((tpl) => {
    const d: Partial<TemplateDefaults> = tpl.defaults || {};
    if (d.features) features = { ...features, ...d.features };
    if (d.theme)    theme    = { ...theme,    ...d.theme };
    if (d.buckets)  buckets  = d.buckets; // replace
    if (d.filters)  filters  = d.filters; // replace
    if (d.views)    views    = d.views;   // replace
    if (d.title !== undefined)   title   = d.title;
    if (d.version !== undefined) version = d.version;
    if (tpl.stylesheet && (tpl.stylesheet.url || tpl.stylesheet.inline || tpl.stylesheet.importedByBundler)) {
      stylesheet = tpl.stylesheet; // outermost (leaf) wins because chain is root-first
    }
    if (tpl.components) {
      components = mergeComponents(components, tpl.components);
    }
  });

  // Apply consumer overrides last.
  if (overrides) {
    if (overrides.features) features = shallowMerge(features, overrides.features) as FeatureFlags;
    if (overrides.theme)    theme    = shallowMerge(theme,    overrides.theme)    as ThemeTokens;
    if (overrides.buckets)  buckets  = overrides.buckets;
    if (overrides.filters)  filters  = overrides.filters;
    if (overrides.views)    views    = overrides.views;
    if (overrides.title !== undefined)   title   = overrides.title;
    if (overrides.version !== undefined) version = overrides.version;
    if (overrides.components) {
      components = mergeComponents(components, overrides.components);
    }
  }

  // Materialize components into a full Record<SlotName, ComponentSlot>.
  const finalComponents = {} as Record<SlotName, ComponentSlot>;
  ALL_SLOT_NAMES.forEach((s) => {
    finalComponents[s] = components[s] || {};
  });

  return {
    templateName: leaf.name,
    features,
    theme,
    buckets,
    filters,
    views,
    components: finalComponents,
    stylesheet,
    title,
    version,
    // mode defaults to 'fullscreen'; IIFEApp / React driver may overwrite
    // this post-resolve to reflect the caller's MountOptions.mode.
    mode: 'fullscreen',
  };
}
