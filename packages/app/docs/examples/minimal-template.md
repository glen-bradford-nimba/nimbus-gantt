# Example — The `austere` template

A complete, runnable custom template. Extends `minimal`, keeps only a
`TitleBar` + `ZoomBar` + `ContentArea`, monospace typography, black-on-white
palette. Shows both the React consumer pattern and the Salesforce IIFE
registration pattern.

See also: [../templates.md](../templates.md) for the general authoring
workflow, [../overrides.md](../overrides.md) for per-mount tweaks,
[../theming.md](../theming.md) for the token surface.

---

## 1. Define the template

Create `src/templates/austere.ts` in your app (or a shared package):

```typescript
import {
  defineTemplate,
  registerTemplate,
  type Template,
} from '@nimbus-gantt/app';

export const austereTemplate: Template = defineTemplate({
  name: 'austere',
  extends: 'minimal',
  defaults: {
    title: 'Project Timeline',
    version: 'austere',
    features: {
      titleBar: true,
      zoomBar: true,
      // Every other slot-gating flag stays false (inherited from `minimal`).
      statsPanel: false,
      filterBar: false,
      sidebar: false,
      detailPanel: false,
      auditPanel: false,
      hrsWkStrip: false,
      dragReparent: false,
      depthShading: false,
      groupByToggle: false,
      hideCompletedToggle: false,
    },
    theme: {
      primary: '#000000',
      primaryHover: '#1a1a1a',
      accent: '#000000',
      bg: '#ffffff',
      surface: '#ffffff',
      surfaceAlt: '#fafafa',
      border: '#000000',
      borderSubtle: '#e5e5e5',
      textPrimary: '#000000',
      textSecondary: '#525252',
      textMuted: '#a3a3a3',
      textInverse: '#ffffff',
      fontFamily: "'SF Mono', 'Cascadia Code', Consolas, monospace",
      fontFamilyMono: "'SF Mono', 'Cascadia Code', Consolas, monospace",
    },
    views: ['gantt', 'list'],
  },
  components: {
    // Empty — inherit TitleBar / ZoomBar / ContentArea from `minimal`.
  },
  stylesheet: {
    inline: `
      .nga-root[data-template="austere"] {
        font-family: var(--nga-font-family-mono);
        background: var(--nga-bg);
        color: var(--nga-text-primary);
      }
      .nga-root[data-template="austere"] .nga-titlebar {
        border-bottom: 2px solid var(--nga-border);
        padding: 8px 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .nga-root[data-template="austere"] .nga-zoombar {
        border-bottom: 1px solid var(--nga-border-subtle);
        padding: 4px 12px;
      }
    `,
  },
});

registerTemplate(austereTemplate);
```

Key details:

- **`extends: 'minimal'`** — inherits the three minimal slot components, which
  means this template doesn't need to ship any React or vanilla code of its
  own. Every slot is covered.
- **Explicit `features`** — `minimal` already has most flags off, but the
  shallow-merge rule (see [../overrides.md](../overrides.md#per-field-merge-rules))
  means unstated flags inherit. Listing them makes the surface self-documenting.
- **Inline stylesheet** — small enough to keep in code. No network fetch, no
  static-resource wrestling.
- **`registerTemplate` at module top-level** — side-effect of import. Anyone
  who imports this module can use `template="austere"` by name.

---

## 2. Consume it in React

```tsx
// apps/my-app/src/TimelinePage.tsx
import { NimbusGanttApp } from '@nimbus-gantt/app';
import './templates/austere';  // side-effect import — registers the template
import type { NormalizedTask, TaskPatch } from '@nimbus-gantt/app';

export function TimelinePage({ tasks }: { tasks: NormalizedTask[] }) {
  const save = async (patch: TaskPatch) => {
    await fetch('/api/save', { method: 'POST', body: JSON.stringify(patch) });
  };
  return <NimbusGanttApp template="austere" data={tasks} onPatch={save} />;
}
```

You do **not** need to import a CSS file for `austere` — the inline
stylesheet travels with the template definition. If you'd extended
`cloudnimbus` instead, you'd also add:

```tsx
import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css';
```

so the Tailwind utility classes compile in.

---

## 3. Consume it in Salesforce (IIFE)

Custom templates in the IIFE channel must be registered **before** the
`mount()` call. The idiomatic pattern: load the template as a separate static
resource whose script tag fires ahead of your LWC's mount script, or
`eval`-inline the template via a `<script>` tag, or — cleanest — have your
LWC call `window.NimbusGanttApp.registerTemplate` directly from JS.

### Pattern A — LWC wrapper registers at connectedCallback

```javascript
// force-app/main/default/lwc/austereGantt/austereGantt.js
import { LightningElement, api } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import NIMBUS_APP from '@salesforce/resourceUrl/nimbusganttapp';
import NIMBUS_ENGINE from '@salesforce/resourceUrl/nimbusgantt';

const austereTemplate = {
  name: 'austere',
  extends: 'minimal',
  defaults: {
    title: 'Project Timeline',
    features: { titleBar: true, zoomBar: true },
    theme: {
      primary: '#000',
      surface: '#fff',
      fontFamily: "'SF Mono', monospace",
    },
    views: ['gantt', 'list'],
  },
  stylesheet: {
    inline: `
      .nga-root[data-template="austere"] { font-family: monospace; }
      .nga-root[data-template="austere"] .nga-titlebar {
        border-bottom: 2px solid #000;
      }
    `,
  },
  components: {},  // inherits minimal slots
};

export default class AustereGantt extends LightningElement {
  @api tasks;

  async connectedCallback() {
    // 1. Load the engine (window.NimbusGantt) then the app (window.NimbusGanttApp).
    await loadScript(this, NIMBUS_ENGINE);
    await loadScript(this, NIMBUS_APP);

    // 2. Register our custom template BEFORE mount.
    window.NimbusGanttApp.registerTemplate(austereTemplate);
  }

  renderedCallback() {
    if (this._mounted) return;
    const host = this.template.querySelector('[data-gantt-host]');
    if (!host || !window.NimbusGanttApp) return;
    this._mounted = true;

    window.NimbusGanttApp.mount(host, {
      template: 'austere',
      data: this.tasks,
      onPatch: (patch) => this.dispatchEvent(new CustomEvent('patch', { detail: patch })),
      engine: window.NimbusGantt,
    });
  }

  disconnectedCallback() {
    const host = this.template.querySelector('[data-gantt-host]');
    if (host) window.NimbusGanttApp.unmount(host);
  }
}
```

```html
<!-- force-app/main/default/lwc/austereGantt/austereGantt.html -->
<template>
  <div data-gantt-host lwc:dom="manual"></div>
</template>
```

### Pattern B — Ship the template in its own static resource

1. Package the template declaration above into a file `austere-template.js`
   that calls `window.NimbusGanttApp.registerTemplate(...)` on load.
2. Upload it as a static resource (`nimbusganttapp_austere`).
3. In the LWC, `await loadScript(this, NIMBUS_APP)` then
   `await loadScript(this, AUSTERE_TEMPLATE)` before mounting.

This separates template authoring from LWC wiring and lets the same template
be reused across multiple LWCs.

### IIFE caveats for custom templates

- **`.react` in `components` is silently ignored** — the IIFE bundle has no
  React. Make sure your template provides `.vanilla` (or inherits it via
  `extends`, as this example does from `minimal`).
- **`Template` objects passed as the `template` prop are rejected** — IIFE
  mounts accept only strings. You must `registerTemplate()` first, then
  `mount({ template: 'austere', ... })`.
- **Stylesheet URL vs. inline** — inline is the easier path for custom
  templates; no separate static resource required. For large stylesheets
  (> ~20 KB), package the CSS as a static resource and pass its URL through
  `overrides.stylesheet.url` at mount time.

---

## 4. Override on top

You can combine a custom template with ad-hoc overrides:

```tsx
<NimbusGanttApp
  template="austere"
  data={tasks}
  onPatch={save}
  overrides={{
    theme: { primary: '#dc2626' },          // red accent for this mount only
    features: { zoomBar: false },            // even more austere
  }}
/>
```

The resolution chain: `minimal.defaults` ← `austere.defaults` ←
`overrides` = final `TemplateConfig`. See
[../overrides.md § stacking](../overrides.md#stacking--extends-chain--consumer-overrides).

---

## 5. What you get

With roughly 40 lines of template definition + 5 lines of consumer code, you
have:

- TitleBar showing "Project Timeline" in monospace with a black underline.
- ZoomBar with day/week/month/quarter buttons.
- Full gantt canvas (from `window.NimbusGantt`) inside a white container.
- `--nga-*` CSS variables live on the root so any additional CSS you write
  resolves against the austere palette.
- Identical rendering in React and Salesforce — same `TemplateConfig`, same
  slot factories, same stylesheet injection.

No fork, no copy-paste, no divergence between your app's gantt and
Salesforce's.
