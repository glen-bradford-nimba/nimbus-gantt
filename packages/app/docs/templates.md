# Templates

A template is the unit of "look + feature surface" in `@nimbus-gantt/app`. One
template declaration packs together:

- **Defaults** — feature flags, theme tokens, priority buckets, filter chips, view modes, title, version.
- **Components** — per-slot React + vanilla factory pairs (`TitleBar`, `StatsPanel`, `FilterBar`, `ZoomBar`, `Sidebar`, `ContentArea`, `DetailPanel`, `AuditPanel`, `HrsWkStrip`).
- **Stylesheet** — a URL, an inline CSS string, or a bundler-import marker.

Pass `template="..."` to `<NimbusGanttApp>` (React) or `window.NimbusGanttApp.mount(container, { template: '...' })` (IIFE) and you get the whole chrome, pre-wired.

See also: [overrides.md](./overrides.md) for consumer-side tweaks, [theming.md](./theming.md) for token/CSS plumbing, [examples/minimal-template.md](./examples/minimal-template.md) for an end-to-end walk-through.

---

## Built-in templates

### `cloudnimbus`

The full v8/v9 look. All feature flags on. Ships all nine React slots + all nine vanilla slots. Stylesheet is `packages/app/src/templates/cloudnimbus/styles.css` (~48 KB).

```tsx
import { NimbusGanttApp } from '@nimbus-gantt/app';
import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css';

<NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save} />
```

Use it when you want the full Pro Forma Timeline experience (priority sidebar, audit trail, h/wk strip, stats panel, filter bar with team popup, etc.).

### `minimal`

A stripped skeleton: `TitleBar` + `ZoomBar` + `ContentArea` only. All other feature flags default to `false`. Use it as the `extends` base when you want just the gantt canvas plus a header.

```tsx
<NimbusGanttApp template="minimal" data={tasks} onPatch={save} />
```

Get the set of registered templates at runtime via `listTemplates(): string[]`.

---

## Template anatomy

Full interface (source: `packages/app/src/templates/types.ts`, see API design §1.7):

```typescript
export interface Template {
  name: string;
  extends?: string;
  defaults: Partial<TemplateDefaults>;
  stylesheet: TemplateStylesheet;
  components: Partial<Record<SlotName, ComponentSlot>>;
}

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
  url?: string;                // IIFE: fetched via Strategy C loader
  inline?: string;             // inline <style> text (no network)
  importedByBundler?: true;    // React: marker only — consumer imports the CSS
}

export interface ComponentSlot {
  react?: ComponentType<SlotProps>;
  vanilla?: VanillaSlot;
}
```

Each field:

- **`name`** — unique key in the registry. Throws on `registerTemplate` if missing.
- **`extends`** — optional parent template name. Resolver walks this chain root-first; see [overrides.md § extends chain](./overrides.md#extends-chain-resolution).
- **`defaults.features`** — `FeatureFlags` (12 booleans). Slot-gating flags (`titleBar`, `statsPanel`, `filterBar`, `zoomBar`, `sidebar`, `detailPanel`, `auditPanel`, `hrsWkStrip`) suppress rendering when `false`. Behaviour flags (`dragReparent`, `depthShading`, `groupByToggle`, `hideCompletedToggle`) tweak what's inside slots without hiding them.
- **`defaults.theme`** — `ThemeTokens` (colors, typography, radii, gantt tints). Each key becomes a `--nga-{kebab-case}` CSS variable on the scoped root. See [theming.md](./theming.md).
- **`defaults.buckets`** — priority buckets (`{ id, label, color, bgTint, order }`). Rendered as sidebar groups and used to tint gantt bars.
- **`defaults.filters`** — filter-chip list (`{ id, label, predicate, count? }`). Each predicate is called with a `NormalizedTask` and gates visibility.
- **`defaults.views`** — allowed `ViewMode` values (`'gantt' | 'list' | 'treemap' | 'bubbles' | 'calendar' | 'flow'`, or any string for custom views).
- **`defaults.title` / `version`** — strings for the TitleBar.
- **`stylesheet`** — see [theming.md § stylesheet injection](./theming.md#stylesheet-injection-strategy).
- **`components`** — partial map of `SlotName` → `ComponentSlot`. Each slot can provide `.react`, `.vanilla`, or both. The renderer picks whichever matches the driver.

---

## Using a built-in template

### React

```tsx
import { NimbusGanttApp } from '@nimbus-gantt/app';
import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css';

export default function Timeline({ tasks, save }: Props) {
  return <NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save} />;
}
```

### IIFE / Salesforce

```javascript
// The built-ins self-register on module load. Just reference by name.
window.NimbusGanttApp.mount(container, {
  template: 'cloudnimbus',
  data: tasks,
  onPatch: save,
  engine: window.NimbusGantt,
  overrides: {
    // IIFE must be told where to fetch the CSS (Strategy C).
    stylesheet: { url: CLOUDNIMBUS_CSS_URL },
  },
});
```

See API design §2 (React props) and §3 (IIFE surface) for the full signatures.

---

## Defining a custom template

Use `defineTemplate(...)` for type inference + a lint surface; the function is an identity helper. Then register it so `resolveTemplate` can find it by name (or the `extends` chain can walk into it).

```typescript
import {
  defineTemplate,
  registerTemplate,
  cloudnimbusTemplate,  // needed only so we can reference its defaults directly if wanted
} from '@nimbus-gantt/app';

export const acmeCorpTemplate = defineTemplate({
  name: 'acme-corp',
  extends: 'cloudnimbus',
  defaults: {
    // Shallow-merged on top of cloudnimbus.features — everything still on by default.
    features: {
      auditPanel: false,     // hide the audit rail
      hrsWkStrip: false,     // no h/wk strip for this tenant
    },
    // Shallow-merged on top of cloudnimbus.theme — other tokens inherited unchanged.
    theme: {
      primary: '#dc2626',
      primaryHover: '#b91c1c',
      accent: '#f59e0b',
    },
    title: 'Acme Delivery',
    version: 'acme 2026.04',
  },
  stylesheet: {
    // Inherit cloudnimbus CSS — but add a tenant override layer on top.
    inline: `
      .nga-root[data-template="acme-corp"] .nga-titlebar {
        background: linear-gradient(90deg, #dc2626, #f59e0b);
      }
    `,
  },
  components: {
    // Inherit every slot component from cloudnimbus. Empty is fine — resolver
    // copies parent-chain slots automatically.
  },
});

registerTemplate(acmeCorpTemplate);
```

Consumer:

```tsx
<NimbusGanttApp template="acme-corp" data={tasks} onPatch={save} />
```

Or pass the `Template` object directly (React only — IIFE requires strings):

```tsx
<NimbusGanttApp template={acmeCorpTemplate} data={tasks} onPatch={save} />
```

### Registering: auto vs. explicit

Two ways for a template to end up in the registry:

1. **Side-effect of module import.** The template file calls
   `registerTemplate(myTemplate)` at module top level (this is how the built-ins
   work — see `packages/app/src/templates/cloudnimbus/index.ts`). Importing the
   module is enough.
2. **Explicit call.** The consumer imports the `Template` object and calls
   `registerTemplate(t)` themselves. Useful when one bundle ships multiple
   optional templates.

In IIFE / Salesforce contexts, custom templates **must** be registered *before*
the corresponding `mount()` call. Practically this means loading the template
as its own static resource script tag that runs before the mount script, or
calling `window.NimbusGanttApp.registerTemplate(t)` explicitly from your LWC
wrapper. See [examples/minimal-template.md](./examples/minimal-template.md) for
the pattern.

---

## The `extends` chain

Templates form a single-inheritance chain via `extends: 'parentName'`.
`resolveTemplate(templateOrName, overrides?)` walks this chain root-first and
applies:

1. Root template's defaults (e.g. `cloudnimbus`).
2. Each child template's defaults, one by one.
3. Consumer `overrides` (last, wins).

Per-field merge rules live in [overrides.md](./overrides.md#per-field-merge-rules)
— briefly: features/theme shallow-merge, buckets/filters/views replace whole,
components merge per-slot with `.react`/`.vanilla` inheriting independently.

Cycles throw. Missing ancestors throw. A template that `extends` an
unregistered parent cannot itself be registered — register the parent first.

```
cloudnimbus   (root)
    └── acme-corp   (extends cloudnimbus)
            └── acme-corp-dark   (extends acme-corp)

resolveTemplate('acme-corp-dark', { features: { sidebar: false } })
  = cloudnimbus.defaults
  + acme-corp.defaults
  + acme-corp-dark.defaults
  + { features: { sidebar: false } }
```

---

## Template vs. overrides — when to build a new template

| Decision | Use overrides | Build a template |
|----------|---------------|------------------|
| One-off tweak for a single mount | ✓ | |
| Toggle a couple of feature flags | ✓ | |
| Different tenants / customers need different brands | | ✓ |
| Custom slot component (replace the TitleBar) | Either (overrides work, but reuse via template is cleaner) | ✓ if multiple places need it |
| Different priority buckets for different business domains | | ✓ |
| A/B testing a fresh UI | | ✓ (test template extends cloudnimbus) |
| You want the change to be distributable to other teams | | ✓ |

Rule of thumb: if the change belongs in a **design artifact you'd version and
ship separately**, it's a template. If it's a local knob, it's an override.

---

## Public API surface

From `@nimbus-gantt/app` (barrel: `packages/app/src/templates/index.ts`):

```typescript
// Template authoring
export function defineTemplate(t: Template): Template;
export function registerTemplate(t: Template): void;
export function getTemplate(name: string): Template;
export function hasTemplate(name: string): boolean;
export function listTemplates(): string[];

// Resolution
export function resolveTemplate(
  template: string | Template,
  overrides?: TemplateOverrides,
): TemplateConfig;
export function inheritReact(prev?: ComponentSlot, next?: ComponentSlot): ComponentSlot;
export function inheritVanilla(prev?: ComponentSlot, next?: ComponentSlot): ComponentSlot;

// Slot gating
export const SLOT_TO_FEATURE: Record<SlotName, keyof FeatureFlags>;
export const SLOT_ORDER: SlotName[];
export function shouldRenderSlot(slot: SlotName, features: FeatureFlags): boolean;

// Theme/CSS helpers
export function themeToCssVars(theme: ThemeTokens): string;
export function themeToScopedCss(templateName: string, theme: ThemeTokens): string;

// Stylesheet loader (IIFE — React uses bundler import)
export function ensureTemplateCss(container: HTMLElement, s: TemplateStylesheet): Promise<void>;
export function removeTemplateCss(container: HTMLElement): void;

// Built-in templates (self-registering on import)
export { cloudnimbusTemplate } from './templates/cloudnimbus';
export { minimalTemplate }     from './templates/minimal';

// Types
export type {
  Template, TemplateOverrides, TemplateConfig, TemplateDefaults, TemplateStylesheet,
  FeatureFlags, ThemeTokens,
  SlotName, SlotProps, ComponentSlot, VanillaSlot,
  ViewMode, FilterOption, PriorityBucket,
  AppState, AppEvent, SlotData,
} from './templates/types';
```

On the IIFE `window.NimbusGanttApp` surface:

```typescript
interface NimbusGanttAppIIFE {
  mount(container: HTMLElement, options: IIFEMountOptions): AppInstance;
  unmount(container: HTMLElement): void;
  registerTemplate(template: Template): void;
  listTemplates(): string[];
}
```

The full type spec is in `docs/template-api-design.md`.
