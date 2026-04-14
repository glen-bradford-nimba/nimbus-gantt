# Overrides

`TemplateOverrides` is the consumer-side escape hatch. Pass it to
`<NimbusGanttApp>` or `window.NimbusGanttApp.mount` and the resolver layers
your values on top of the template's defaults — no template fork required.

See also: [templates.md](./templates.md) for when to build a template vs.
pass overrides, [theming.md](./theming.md) for the theme-token surface,
`docs/template-api-design.md` §5 for the canonical merge rules.

---

## The `TemplateOverrides` interface

Source: `packages/app/src/templates/types.ts`.

```typescript
export interface TemplateOverrides {
  features?:   Partial<FeatureFlags>;
  theme?:      Partial<ThemeTokens>;
  components?: Partial<Record<SlotName, ComponentSlot>>;
  buckets?:    PriorityBucket[];
  filters?:    FilterOption[];
  views?:      ViewMode[];
  title?:      string;
  version?:    string;
}
```

Every field is optional. `undefined` never unsets a value — to disable a
feature you must explicitly write `features: { x: false }`.

---

## Per-field merge rules

The resolver (`packages/app/src/templates/resolver.ts`) treats each field
differently:

| Field | Rule | Why |
|-------|------|-----|
| `features` | **Shallow merge** — each flag is replaced independently | Disabling one panel shouldn't require restating the other eleven. |
| `theme` | **Shallow merge** — each token is replaced independently | Tweaking `primary` shouldn't wipe typography tokens. |
| `components[slot]` | **Per-slot replace**, with `.react` and `.vanilla` inheriting independently (see below) | A slot is an atomic UI unit; mix-and-match inside `.react` / `.vanilla` lets you override React-only without breaking IIFE. |
| `buckets` | **Whole-array replace** | Buckets encode a domain model. Mixing two bucket lists produces incoherent groupings. |
| `filters` | **Whole-array replace** | Same reasoning — filter chips need a coherent set. |
| `views` | **Whole-array replace** | The set of visible view tabs is authored, not merged. |
| `stylesheet` | Outermost template in the `extends` chain wins; consumer overrides (if set) replace the whole `TemplateStylesheet`. | One CSS payload per mount; merging stylesheets is ambiguous. |
| `title`, `version` | Replace if defined | Simple strings. |

**Consequence of array-replace:** you cannot partial-override a single bucket.
If `cloudnimbus.buckets` has 6 entries and you want to change the color of
just one, you have to pass all 6 back with your edit. See [gotchas](#gotchas)
below.

---

## Slot override semantics

`ComponentSlot` has two fields:

```typescript
interface ComponentSlot {
  react?: ComponentType<SlotProps>;
  vanilla?: VanillaSlot;
}
```

When `overrides.components[slot]` is set, the resolver calls
`inheritReact(prev, next)`:

```typescript
function inheritReact(prev, next) {
  return {
    react:   next?.react   ?? prev?.react,
    vanilla: next?.vanilla ?? prev?.vanilla,
  };
}
```

Result: overriding **only** `.react` preserves the template's `.vanilla` and
vice versa. This is what makes "React-side custom slot, IIFE unchanged"
possible — cloudnimbusllc.com can ship a richer React TitleBar without forking
the Salesforce experience.

```typescript
// Only react replaced; vanilla inherited from the template.
overrides = {
  components: {
    TitleBar: { react: MyRichReactTitleBar },
  },
};

// Only vanilla replaced; react inherited.
overrides = {
  components: {
    TitleBar: { vanilla: myCustomTitleBarFactory },
  },
};

// Both replaced.
overrides = {
  components: {
    TitleBar: { react: MyRichReactTitleBar, vanilla: myCustomTitleBarFactory },
  },
};
```

**IIFE caveat.** `window.NimbusGanttApp.mount` silently ignores `.react` in
`overrides.components` — the IIFE bundle doesn't ship React. Document this to
consumers so they understand why the browser Salesforce surface doesn't get
their React override.

---

## Feature-flag slot gating

`features.<flag> = false` **always** wins over a component override:

```typescript
// AuditPanel is NOT rendered, even though we provide a custom component.
overrides = {
  features: { auditPanel: false },
  components: { AuditPanel: { react: MyAuditPanel } },
};
```

This is deliberate. Slot-gating flags (`titleBar`, `statsPanel`, `filterBar`,
`zoomBar`, `sidebar`, `detailPanel`, `auditPanel`, `hrsWkStrip`) suppress
rendering entirely. If you later flip the flag back on, the override is still
in place — the resolver doesn't forget it.

The slot-to-feature map lives in `packages/app/src/templates/slots.ts`:

```typescript
export const SLOT_TO_FEATURE: Record<SlotName, keyof FeatureFlags> = {
  TitleBar:    'titleBar',
  StatsPanel:  'statsPanel',
  FilterBar:   'filterBar',
  ZoomBar:     'zoomBar',
  Sidebar:     'sidebar',
  ContentArea: 'titleBar',   // ContentArea is always rendered — sentinel only
  DetailPanel: 'detailPanel',
  AuditPanel:  'auditPanel',
  HrsWkStrip:  'hrsWkStrip',
};
```

`ContentArea` is never gated — disabling it would remove the gantt canvas
itself. The four behaviour-only flags (`dragReparent`, `depthShading`,
`groupByToggle`, `hideCompletedToggle`) don't appear in this map because they
don't gate slots — they tweak behaviour inside them.

---

## Examples

### Disable specific panels

```tsx
<NimbusGanttApp
  template="cloudnimbus"
  data={tasks}
  onPatch={save}
  overrides={{
    features: {
      auditPanel: false,
      sidebar: false,
    },
  }}
/>
```

### Change theme colors

```tsx
<NimbusGanttApp
  template="cloudnimbus"
  data={tasks}
  onPatch={save}
  overrides={{
    theme: {
      primary: '#dc2626',
      primaryHover: '#b91c1c',
      accent: '#f59e0b',
    },
  }}
/>
```

Each token becomes a `--nga-*` CSS variable on the scoped root. See
[theming.md](./theming.md).

### Replace a slot (React only)

```tsx
import type { SlotProps } from '@nimbus-gantt/app';

function MyTitleBar({ config, state, dispatch, data }: SlotProps) {
  return (
    <div className="nga-titlebar" data-my-brand>
      <h1>{config.title}</h1>
      <span>{data.stats.total} items</span>
    </div>
  );
}

<NimbusGanttApp
  template="cloudnimbus"
  data={tasks}
  onPatch={save}
  overrides={{
    components: { TitleBar: { react: MyTitleBar } },
  }}
/>
```

The IIFE surface keeps cloudnimbus's vanilla `TitleBar` in place. Identical
rendering everywhere still holds for the non-React channel.

### Replace the filters list

```tsx
import type { FilterOption } from '@nimbus-gantt/app';

const me = 'glen@nimbasolutions.com';

const myFilters: FilterOption[] = [
  { id: 'mine',   label: 'Mine',   predicate: t => t.assignee === me },
  { id: 'active', label: 'Active', predicate: t => t.status !== 'done' },
  { id: 'all',    label: 'All',    predicate: () => true },
];

<NimbusGanttApp
  template="cloudnimbus"
  data={tasks}
  onPatch={save}
  overrides={{ filters: myFilters }}
/>
```

`filters` is whole-array replace — you don't inherit any of the cloudnimbus
chips.

### Replace the bucket list

```tsx
import type { PriorityBucket } from '@nimbus-gantt/app';

const myBuckets: PriorityBucket[] = [
  { id: 'now',   label: 'Now',   color: '#dc2626', bgTint: '#fee2e2', order: 1 },
  { id: 'next',  label: 'Next',  color: '#f59e0b', bgTint: '#fef3c7', order: 2 },
  { id: 'later', label: 'Later', color: '#64748b', bgTint: '#f1f5f9', order: 3 },
];

<NimbusGanttApp
  template="cloudnimbus"
  data={tasks}
  onPatch={save}
  overrides={{ buckets: myBuckets }}
/>
```

---

## Stacking — extends chain + consumer overrides

When multiple layers of configuration apply, they compose in this order
(first listed is lowest priority):

```
1. Engine fallbacks (DEFAULT_FEATURES, DEFAULT_THEME in resolver.ts)
2. Root template's defaults          (e.g. cloudnimbus)
3. Each child template in extends chain, outermost last
4. Consumer TemplateOverrides        (wins)
```

So a custom `acme-corp-dark` template extending `acme-corp` extending
`cloudnimbus`, mounted with
`overrides={{ theme: { primary: '#000' } }}`, resolves as:

```
engine defaults
  ← cloudnimbus.defaults        (shallow-merge features/theme; replace buckets/filters/views)
  ← acme-corp.defaults
  ← acme-corp-dark.defaults
  ← consumer overrides           (primary: '#000' wins)
```

`resolveTemplate(t, overrides)` returns a single `TemplateConfig` with all
nine slots materialised and every token value resolved. Both the React driver
and the IIFE driver consume the same `TemplateConfig` — guaranteeing
identical output.

---

## `TemplateConfig` — the resolved output

You rarely need to look at this — it's what the drivers see — but for
debugging:

```typescript
export interface TemplateConfig {
  templateName: string;
  features:     FeatureFlags;                            // all 12, no undefineds
  theme:        ThemeTokens;                             // all tokens, no undefineds
  buckets:      PriorityBucket[];
  filters:      FilterOption[];
  views:        ViewMode[];
  components:   Record<SlotName, ComponentSlot>;         // all 9, possibly empty {}
  stylesheet:   TemplateStylesheet;
  title:        string;
  version:      string;
}
```

Call `resolveTemplate('cloudnimbus', yourOverrides)` from a test or a
debugger to see the fully materialised config.

---

## Gotchas

1. **Can't partial-override a single bucket.** `buckets` is a whole-array
   replace. If you want to tweak one of cloudnimbus's 6 buckets, import
   `CLOUD_NIMBUS_PRIORITY_BUCKETS` from `@nimbus-gantt/app`, clone, edit, and
   pass the whole array. (Same for `filters` and `views`.)

2. **`undefined` does not unset.** `overrides = { title: undefined }` is a
   no-op. To clear the title, pass `overrides = { title: '' }`.

3. **IIFE ignores `.react` overrides.** React components can't run in the
   IIFE. If you need a vanilla slot override for Salesforce, pass
   `.vanilla`; the React web app will keep the template's default `.react`.

4. **Disabling a feature hides the slot even if you override the
   component.** See the AuditPanel example above. Flip the feature first.

5. **`stylesheet` does not shallow-merge.** If you pass
   `overrides.stylesheet = { url: '...' }`, the whole `TemplateStylesheet` is
   replaced — you lose the template's `inline` and `importedByBundler`
   markers. Usually you want to set `stylesheet` only once, from the LWC
   wrapper or app bootstrap.

6. **Overrides don't register a template.** Passing a custom slot in
   `overrides` applies only to this one mount. If you want reuse, build a
   template and `registerTemplate(t)`.

7. **Feature-to-slot mapping is fixed.** You can't alias a new slot name to a
   feature flag. `SlotName` is a closed union. If you need a novel panel,
   wrap it inside `ContentArea` or an existing slot's override.
