# Template API Design — nimbus-gantt v10

**Phase 1C deliverable.** Complete TypeScript API specification for the template-driven framework in `@nimbus-gantt/app`. Phase 2 implements exactly what is specified here.

---

## 0. Design goals and constraints

1. **Template as framework**, not skin. The template owns defaults (features, theme, buckets, filters, views) **and** slot components (both React + vanilla). Consumers never have to reproduce v8/v9 chrome by hand.
2. **One resolved config, two renderers.** A single `TemplateConfig` is produced from `resolveTemplate(template, overrides)` and fed to *both* the React slot tree and the vanilla IIFE slot tree. Identical HTML output is a non-negotiable contract.
3. **Salesforce Locker Service compatibility.** No `eval`, no dynamic `import()`, no class-reference exports from the IIFE surface. Templates register via module-time side effects; vanilla slot factories are plain functions returning `HTMLElement`.
4. **v8/v9 untouched.** The v10 route consumes this API; it does not mutate the existing routes.
5. **Extensibility without forking.** Users build templates via `defineTemplate({ extends: 'cloudnimbus', ... })`; overrides are layered deterministically.

---

## 1. Core types

File: `packages/app/src/templates/types.ts`

### 1.1 Primitive enums

```typescript
export type ViewMode =
  | 'gantt' | 'list' | 'treemap' | 'bubbles' | 'calendar' | 'flow';

export type SlotName =
  | 'TitleBar' | 'StatsPanel' | 'FilterBar' | 'ZoomBar'
  | 'Sidebar' | 'ContentArea' | 'DetailPanel' | 'AuditPanel' | 'HrsWkStrip';
```

### 1.2 Feature flags

```typescript
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
```

### 1.3 Theme tokens

```typescript
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
```

### 1.4 FilterOption, PriorityBucket

```typescript
export interface FilterOption {
  id: string;
  label: string;
  predicate: (task: NormalizedTask) => boolean;
  count?: (tasks: NormalizedTask[]) => string;
}

export interface PriorityBucket {
  id: string; label: string; color: string; bgTint: string; order: number;
}
```

### 1.5 Component slots

```typescript
import type { ComponentType } from 'react';

export interface SlotProps {
  config: TemplateConfig;
  state: AppState;
  dispatch: (event: AppEvent) => void;
  data: SlotData;
}

export interface VanillaSlot {
  (props: SlotProps): {
    el: HTMLElement;
    update: (props: SlotProps) => void;
    destroy: () => void;
  };
}

export interface ComponentSlot {
  react?: ComponentType<SlotProps>;
  vanilla?: VanillaSlot;
}
```

### 1.6 AppState, AppEvent, SlotData

```typescript
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
  | { type: 'SELECT_TASK'; taskId: string | null }
  | { type: 'PATCH'; patch: TaskPatch }
  | { type: 'RESET_PATCHES' };

export interface SlotData {
  tasks: NormalizedTask[];
  visibleTasks: MappedTask[];
  stats: TaskStats;
  patchLog: Array<{ ts: Date; desc: string }>;
}
```

### 1.7 Template definition

```typescript
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
  url?: string;         // for IIFE static resource
  inline?: string;      // fallback inlined CSS
  importedByBundler?: true;  // React marker
}

export interface Template {
  name: string;
  extends?: string;
  defaults: Partial<TemplateDefaults>;
  stylesheet: TemplateStylesheet;
  components: Partial<Record<SlotName, ComponentSlot>>;
}
```

### 1.8 Overrides & resolved config

```typescript
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
}
```

---

## 2. Consumer API — React

```tsx
export interface NimbusGanttAppProps {
  template: 'cloudnimbus' | 'minimal' | (string & {}) | Template;
  data: NormalizedTask[];
  onPatch: (patch: TaskPatch) => void | Promise<void>;
  overrides?: TemplateOverrides;
  engine?: NimbusGanttEngine;
  style?: React.CSSProperties;
  className?: string;
}

export function NimbusGanttApp(props: NimbusGanttAppProps): JSX.Element;
```

### Usage

```tsx
// Default
<NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save} />

// Overrides
<NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save}
  overrides={{ features: { auditPanel: false }, theme: { primary: '#0ea5e9' } }} />

// Custom template
const acme = defineTemplate({ name: 'acme', extends: 'cloudnimbus', ... });
<NimbusGanttApp template={acme} data={tasks} onPatch={save} />
```

---

## 3. Consumer API — IIFE / Salesforce

```javascript
window.NimbusGanttApp.mount(container, {
  template: 'cloudnimbus',  // string only
  data: [...],
  onPatch: fn,
  overrides: { features: { auditPanel: false }, theme: { primary: '#0ea5e9' } },
  engine: window.NimbusGantt,
});

window.NimbusGanttApp.unmount(container);
```

IIFE rules:
- `template` must be string
- Only built-in + pre-registered custom templates accepted
- `overrides.components` honors only `.vanilla`; `.react` silently ignored
- Plain object export (not class)

```typescript
export interface NimbusGanttAppIIFE {
  mount(container: HTMLElement, options: IIFEMountOptions): AppInstance;
  unmount(container: HTMLElement): void;
  registerTemplate(template: Template): void;
  listTemplates(): string[];
}
```

---

## 4. Template author API

```typescript
export function defineTemplate(template: Template): Template;
export function registerTemplate(template: Template): void;
export function getTemplate(name: string): Template;
export function listTemplates(): string[];
export function resolveTemplate(template: string | Template, overrides?: TemplateOverrides): TemplateConfig;
```

Both `cloudnimbus` and `minimal` self-register on module load.

---

## 5. Override merge semantics

**Extension chain resolution:**
1. Walk `extends` inward until leaf. Throw on cycles.
2. Apply defaults outermost-first, then consumer overrides on top.

**Per-field rules:**

| Field | Rule |
|-------|------|
| `features` | Shallow merge, `undefined` doesn't unset |
| `theme` | Shallow merge |
| `buckets` | Replace |
| `filters` | Replace |
| `views` | Replace |
| `components[slot]` | Replace per-slot; `.react` and `.vanilla` fields inherit independently |
| `stylesheet` | Replace; outermost wins |
| `title`, `version` | Replace if defined |

**Feature disabled wins:** If `features[f] === false` and slot `s` corresponds to feature `f`, slot is not rendered even if `components[s]` is overridden.

Slot-to-feature mapping:
- titleBar → TitleBar
- statsPanel → StatsPanel
- filterBar → FilterBar
- zoomBar → ZoomBar
- sidebar → Sidebar
- detailPanel → DetailPanel
- auditPanel → AuditPanel
- hrsWkStrip → HrsWkStrip
- dragReparent, depthShading, groupByToggle, hideCompletedToggle → behavior only, no slot gating

---

## 6. Registry

```typescript
const registry = new Map<string, Template>();

export function registerTemplate(template: Template): void {
  if (!template.name) throw new Error('Template.name is required');
  registry.set(template.name, template);
}

export function getTemplate(name: string): Template {
  const t = registry.get(name);
  if (!t) throw new Error(`Unknown template: '${name}'`);
  return t;
}

export function listTemplates(): string[] { return [...registry.keys()]; }
```

---

## 7. Rendering contract

1. **Identical DOM structure** — same tags, same nesting, same data attrs
2. **Identical CSS class names** — from `cloudnimbus.template.css`
3. **Same SlotProps** — both surfaces receive identical props
4. **No static inline styles** — only dynamic values (bucket colors, computed widths)
5. **React: reconciliation; Vanilla: `{el, update, destroy}` pattern**
6. **Events via `dispatch(event)` only** — slots never call engine directly

### Root skeleton

```
<div class="nga-root" data-template="{name}">
  <div class="nga-titlebar">       <!-- if features.titleBar -->
  <div class="nga-stats">          <!-- if features.statsPanel && state.statsOpen -->
  <div class="nga-filterbar">      <!-- if features.filterBar -->
  <div class="nga-zoombar">        <!-- if features.zoomBar -->
  <div class="nga-hrswkstrip">     <!-- if features.hrsWkStrip -->
  <div class="nga-content-outer">
    <div class="nga-sidebar">      <!-- if features.sidebar -->
    <div class="nga-content">
    <div class="nga-detail">       <!-- if features.detailPanel -->
    <div class="nga-audit">        <!-- if features.auditPanel -->
```

Theme tokens emit CSS variables on `.nga-root`:
```css
.nga-root[data-template="acme"] {
  --nga-primary: #dc2626;
  /* ...every ThemeTokens key → --nga-{kebab-case} */
}
```

### Stylesheet loading (Phase 0 Strategy C)
- **React**: `import './styles.css'` — bundler extracts, applied before first render
- **IIFE**: `fetch(stylesheet.url)` then inject `<style>` element INSIDE the `container` element (not document.head). This pierces LWC synthetic shadow DOM correctly. If `stylesheet.inline` is present, use it directly without fetching.

```typescript
// The canonical stylesheet loader for IIFE (implements Phase 0 Strategy C):
async function ensureTemplateCss(container: HTMLElement, stylesheet: TemplateStylesheet): Promise<void> {
  const markerId = 'nga-style-' + stylesheet.url || 'inline';
  if (container.querySelector('#' + markerId)) return;  // dedupe
  let css = stylesheet.inline;
  if (!css && stylesheet.url) {
    const res = await fetch(stylesheet.url);
    css = await res.text();
  }
  if (!css) return;
  const styleEl = document.createElement('style');
  styleEl.id = markerId;
  styleEl.textContent = css;
  container.appendChild(styleEl);  // NOT document.head — shadow-root pierce
}
```

Why fetch + inject instead of `<link>` in document.head: LWC uses synthetic shadow DOM; stylesheets in document.head do not reach `lwc:dom="manual"` content. Injecting the style inside the container element scopes it correctly.

---

## 8. File organization

```
packages/app/src/templates/
  index.ts            — public API
  types.ts            — all shared types
  resolver.ts         — extension chain + per-field merge
  registry.ts         — template registry Map
  state.ts            — AppState reducer
  slots.ts            — slot-to-feature mapping
  css.ts              — token-to-CSS-variable emitter
  stylesheet-loader.ts — <link>/<style> injection

  cloudnimbus/
    index.ts          — cloudnimbusTemplate + registration
    styles.css        — compiled CSS (Phase 1B)
    theme.ts          — ThemeTokens values
    defaults.ts       — buckets + filters
    components/
      index.ts
      TitleBar.tsx StatsPanel.tsx FilterBar.tsx ZoomBar.tsx
      Sidebar.tsx ContentArea.tsx DetailPanel.tsx AuditPanel.tsx HrsWkStrip.tsx
      vanilla/
        index.ts
        TitleBar.vanilla.ts  ...8 more...
      shared/
        el.ts             — DOM helpers
        classes.ts        — CSS class name constants

  minimal/
    (similar, fewer slots)

packages/app/src/
  NimbusGanttAppReact.tsx  — rewritten
  IIFEApp.ts               — rewritten
  iife-entry.ts            — plain object export
  index.ts                 — barrel
  pipeline.ts              — unchanged
  depthShading.ts          — unchanged
  dragReparent.ts          — unchanged
  renderers/treemap.ts, bubble.ts — unchanged
```

---

## 9. Edge cases

### 9.1 React override + vanilla inheritance
`TemplateOverrides.components[slot]` is `Partial<ComponentSlot>`. If only `.react` is provided, template's `.vanilla` is preserved:
```typescript
acc.components[slot] = {
  react: next.react ?? prev.react,
  vanilla: next.vanilla ?? prev.vanilla,
};
```

### 9.2 Feature disabled + slot override
Disabled wins. Slot not rendered. Override preserved for when feature re-enabled.

### 9.3 Locker Service
- No eval, no Function(), no dynamic import()
- Plain object exports only
- DOM mutation via native APIs
- Stylesheet via `<link>` or `<style>` (Phase 0 decides)

### 9.4 Custom view modes
`views` array accepts any string. ContentArea slot switches on `state.viewMode`; unknown modes render empty state unless custom ContentArea handles them.

### 9.5 Stylesheet load order
- React: imported at module load, applied before first render
- IIFE: injected synchronously during `mount()` before first slot renders

### 9.6 Theme token scoping
`data-template="{name}"` on root; CSS variables scoped to `.nga-root[data-template="..."]` — two templates on same page use separate scopes.

### 9.7 Override precedence
```
cloudnimbus defaults
  + child-template defaults (if extends)
  + consumer overrides
  = resolved TemplateConfig
```

### 9.8 SlotProps stability
`config` referentially stable until template/overrides change. `state` and `data` change every render. Vanilla slots cache DOM refs, update in place.

### 9.9 No react imports in vanilla directories
Phase 2 adds an ESLint rule forbidding `react` imports under `templates/*/components/vanilla/` to prevent accidental bundler bloat in IIFE.

---

## 10. Public exports

```typescript
export { NimbusGanttApp } from './NimbusGanttAppReact';
export type { NimbusGanttAppProps } from './NimbusGanttAppReact';

export {
  defineTemplate, registerTemplate, getTemplate, listTemplates,
  resolveTemplate, inheritReact, inheritVanilla,
} from './templates';

export { cloudnimbusTemplate } from './templates/cloudnimbus';
export { minimalTemplate } from './templates/minimal';

export type {
  Template, TemplateOverrides, TemplateConfig, TemplateDefaults, TemplateStylesheet,
  FeatureFlags, ThemeTokens,
  SlotName, SlotProps, ComponentSlot, VanillaSlot,
  ViewMode, FilterOption, PriorityBucket,
  AppState, AppEvent, SlotData,
  NormalizedTask, TaskPatch, NimbusGanttEngine,
} from './templates/types';

export { IIFEApp } from './IIFEApp';
```

---

## Critical files for Phase 2 implementation
- `packages/app/src/templates/types.ts` — all types
- `packages/app/src/templates/resolver.ts` — merge logic
- `packages/app/src/templates/index.ts` — public API
- `packages/app/src/NimbusGanttAppReact.tsx` — React driver
- `packages/app/src/IIFEApp.ts` — vanilla driver
