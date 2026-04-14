# @nimbus-gantt/app — Template Framework Docs

The `@nimbus-gantt/app` package is a **template-driven framework**. Ship one
compiled IIFE bundle plus one CSS file and render identical chrome everywhere
you mount it — React apps, Salesforce LWCs, static HTML. A template owns
defaults (feature flags, theme, priority buckets, filter chips, views), slot
components (React + vanilla pairs), and a stylesheet. Consumers pass `data` and
`onPatch`; everything else is the template's job.

## Start here

| Doc | What it covers |
|-----|----------------|
| [templates.md](./templates.md) | What a template is, the built-ins, how to define and register custom templates, when to build a new one vs. just pass overrides. |
| [overrides.md](./overrides.md) | The `TemplateOverrides` interface, per-field merge rules, slot-override semantics, feature-flag gating, stacking behaviour. |
| [theming.md](./theming.md) | `ThemeTokens` → CSS custom properties, design-system integration, stylesheet injection strategy, writing a custom stylesheet. |
| [examples/minimal-template.md](./examples/minimal-template.md) | A complete runnable example: the `austere` template extending `minimal`, plus React and Salesforce IIFE consumers. |

## Related references

- `../../../docs/template-api-design.md` — the authoritative TypeScript API spec (types, merge semantics, rendering contract, edge cases). The docs here never duplicate it; they link into it.
- `../../../docs/phase-2-status.md` — implementation notes, known gaps, files created.
- `../src/templates/` — the actual code.

## TL;DR

```tsx
import { NimbusGanttApp } from '@nimbus-gantt/app';
import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css';

<NimbusGanttApp template="cloudnimbus" data={tasks} onPatch={save} />
```

```javascript
// Salesforce / static HTML — same bundle, same CSS
window.NimbusGanttApp.mount(container, {
  template: 'cloudnimbus',
  data: tasks,
  onPatch: save,
  engine: window.NimbusGantt,
  overrides: { stylesheet: { url: CLOUDNIMBUS_CSS_URL } },
});
```
