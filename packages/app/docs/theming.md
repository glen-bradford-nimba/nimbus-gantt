# Theming

`ThemeTokens` is the design-system surface of a template. Every key becomes a
CSS custom property scoped to `.nga-root[data-template="<name>"]`, so two
templates can coexist on the same page without collision.

See also: [templates.md](./templates.md) for the `Template` interface,
[overrides.md](./overrides.md) for per-mount theme tweaks,
`docs/template-api-design.md` §1.3 for the full `ThemeTokens` type,
`docs/phase-0-status.md` for the rationale behind Strategy C injection.

---

## Token surface

Source: `packages/app/src/templates/types.ts`.

```typescript
export interface ThemeTokens {
  // Brand
  primary: string; primaryHover: string; accent: string;

  // Surfaces
  bg: string; surface: string; surfaceAlt: string;
  border: string; borderSubtle: string;

  // Text
  textPrimary: string; textSecondary: string; textMuted: string; textInverse: string;

  // Semantic
  danger: string; warning: string; success: string; info: string;

  // Typography
  fontFamily: string; fontFamilyMono: string;
  fontSizeBase: string; fontSizeSm: string; fontSizeXs: string;

  // Shape
  radiusSm: string; radiusMd: string; radiusLg: string; radiusFull: string;
  spacingUnit: string;

  // Gantt-specific
  ganttGridColor: string; ganttHeaderBg: string; ganttWeekendBg: string;
  ganttTodayLine: string; ganttTodayBg: string;
  ganttBarDefault: string; ganttBarTextColor: string;
  ganttRowHoverBg: string; ganttSelectionRing: string; ganttDependencyLine: string;
}
```

Every token is a `string` — CSS color, dimension, font-family, etc. The
resolver fills any missing tokens from a neutral fallback
(`DEFAULT_THEME` in `packages/app/src/templates/resolver.ts`) so a template's
theme can be `Partial<ThemeTokens>` without the renderer choking.

---

## Tokens → CSS variables

`themeToCssVars(theme)` converts a `ThemeTokens` object into a
semicolon-delimited declaration list using the naming convention
`--nga-{kebab-case}`:

```typescript
themeToCssVars({
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  ganttGridColor: '#e5e7eb',
});
// => "--nga-primary:#2563eb;--nga-primary-hover:#1d4ed8;--nga-gantt-grid-color:#e5e7eb"
```

`themeToScopedCss(name, theme)` wraps that in a scoped rule:

```css
.nga-root[data-template="cloudnimbus"] {
  --nga-primary: #2563eb;
  --nga-primary-hover: #1d4ed8;
  --nga-gantt-grid-color: #e5e7eb;
  /* ... every ThemeTokens key */
}
```

The drivers emit this rule into the container's `<style>` before first render
— both in React and in the IIFE/Salesforce path. Your template CSS (in
`styles.css`) consumes the variables:

```css
.nga-titlebar {
  background: var(--nga-surface);
  border-bottom: 1px solid var(--nga-border);
  color: var(--nga-text-primary);
  font-family: var(--nga-font-family);
}
.nga-pill--primary {
  background: var(--nga-primary);
  color: var(--nga-text-inverse);
}
```

### Scoping

`data-template="{name}"` on the root element means two templates mounted on
the same page (e.g. one `cloudnimbus` and one `acme-corp`) get independent
variable scopes. The resolver never emits unscoped `:root { --nga-* }` rules.

---

## Integrating with an existing design system

Two integration shapes:

### 1. Mirror tokens from your design system into the template

If your app already exposes design tokens via CSS variables (shadcn's
`--background`, MUI's theme `--mui-palette-primary-main`, etc.), define a
template whose theme reads them:

```typescript
export const shadcnTemplate = defineTemplate({
  name: 'shadcn',
  extends: 'cloudnimbus',
  defaults: {
    theme: {
      primary:       'hsl(var(--primary))',
      primaryHover:  'hsl(var(--primary) / 0.9)',
      bg:            'hsl(var(--background))',
      surface:       'hsl(var(--card))',
      border:        'hsl(var(--border))',
      textPrimary:   'hsl(var(--foreground))',
      textSecondary: 'hsl(var(--muted-foreground))',
    },
  },
  stylesheet: { importedByBundler: true },
  components: {},  // inherit cloudnimbus slots
});
```

Now flipping your design-system variables (dark mode, tenant theme, etc.)
automatically propagates through the gantt — the gantt's `--nga-primary`
resolves at use-time to `hsl(var(--primary))`, which resolves to whatever your
app's `--primary` currently is.

### 2. Pass concrete values via overrides

If you only need a one-off tweak:

```tsx
<NimbusGanttApp
  template="cloudnimbus"
  overrides={{ theme: { primary: theme.palette.primary.main } }}
  data={tasks}
  onPatch={save}
/>
```

The override hard-codes a value at mount-time. It does **not** track design-system changes unless you re-mount or re-render.

### Example: dark-mode template

```typescript
import { defineTemplate, registerTemplate } from '@nimbus-gantt/app';

export const cloudnimbusDark = defineTemplate({
  name: 'cloudnimbus-dark',
  extends: 'cloudnimbus',
  defaults: {
    theme: {
      bg:            '#0f172a',
      surface:       '#1e293b',
      surfaceAlt:    '#334155',
      border:        '#475569',
      borderSubtle:  '#334155',
      textPrimary:   '#f8fafc',
      textSecondary: '#cbd5e1',
      textMuted:     '#94a3b8',
      textInverse:   '#0f172a',
      ganttHeaderBg: '#1e293b',
      ganttGridColor:'#334155',
      ganttWeekendBg:'rgba(51,65,85,0.4)',
      ganttRowHoverBg:'rgba(148,163,184,0.08)',
      // All other tokens inherit from cloudnimbus
    },
  },
  stylesheet: { importedByBundler: true },  // reuse cloudnimbus styles.css
  components: {},                             // reuse cloudnimbus slots
});

registerTemplate(cloudnimbusDark);
```

Because `cloudnimbus/styles.css` already addresses every element through
`--nga-*` variables, swapping the theme is enough to invert the palette. No
extra CSS required.

---

## CSS custom property fallbacks

CSS variables cascade. If your app sets `--my-primary: #7c3aed` globally and
you'd like the gantt to pick it up, you can author a template that references
it directly:

```typescript
theme: {
  primary: 'var(--my-primary, #2563eb)',
}
```

At render time the browser resolves `--nga-primary` to
`var(--my-primary, #2563eb)`, which in turn resolves to `#7c3aed` (or the
fallback). This is the cheapest way to let the gantt follow an existing
design system live.

Caveat: some properties that require actual colors (e.g. Canvas 2D context
`fillStyle` in the gantt renderer) read computed values. Those points get the
resolved RGB, not the token reference. If you're animating design-system
variables, the gantt canvas may lag until the next redraw.

---

## Stylesheet injection strategy

The `TemplateStylesheet` contract:

```typescript
export interface TemplateStylesheet {
  url?: string;              // IIFE fetches and injects
  inline?: string;           // inline CSS text — no network
  importedByBundler?: true;  // React marker — consumer imports the CSS
}
```

Resolution:

- **React**: the consumer imports `styles.css` directly
  (`import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css'`). The
  bundler extracts it into the app's CSS. `importedByBundler: true` is just a
  marker saying "don't fetch at runtime". Nothing else happens at runtime for
  the stylesheet.
- **IIFE / Salesforce**: `ensureTemplateCss(container, stylesheet)` runs during
  `mount()`. Strategy:
  1. If `stylesheet.inline` is set → inject `<style>inline</style>` into the
     container.
  2. Else if `stylesheet.url` is set → `fetch(url)`, then inject `<style>`.
  3. Else → no-op. (Relies on React bundler import.)

### Why inject into the container, not document.head?

Salesforce Lightning Web Components use synthetic shadow DOM. A `<style>` in
`document.head` does **not** reach content rendered inside a component's
shadow root — specifically, nothing under `lwc:dom="manual"`. Injecting the
`<style>` element as a **child of the container** scopes it correctly to the
LWC's slot content.

This is "Phase 0 Strategy C". See `docs/phase-0-status.md` for the CSP probe
that validated it.

Dedup marker: the loader tags each injected `<style>` with
`data-nga-template-css="{url|inline}"` and short-circuits if one is already
present in the container. Safe to call `ensureTemplateCss` multiple times
(e.g. across re-mounts).

---

## Writing a completely custom stylesheet

Two paths, depending on how much of cloudnimbus you want to reuse.

### Path A — Reuse cloudnimbus layout, override specific rules

Inline a thin override layer on top of `cloudnimbus/styles.css`:

```typescript
export const acmeCorpTemplate = defineTemplate({
  name: 'acme-corp',
  extends: 'cloudnimbus',
  defaults: {
    theme: { primary: '#dc2626', accent: '#f59e0b' },
  },
  stylesheet: {
    // Fetches cloudnimbus URL then appends inline overrides. But because
    // `stylesheet` replaces (not merges), you need to pick one or the other.
    // Usually the cleaner choice: just let theme tokens do the work and keep
    // the template stylesheet empty.
    inline: `
      .nga-root[data-template="acme-corp"] .nga-titlebar {
        background: linear-gradient(90deg, var(--nga-primary), var(--nga-accent));
      }
    `,
  },
  components: {},
});
```

Important: because `stylesheet` replaces whole (no merge),
Path A works best in combination with `importedByBundler: true` on React (the
consumer imports cloudnimbus's `styles.css` at app bootstrap) and a separate
resource URL for IIFE. Structured more robustly, host both the base and
overrides as two separate `<style>` tags the consumer injects in order.

### Path B — Write your own stylesheet from scratch

You own the entire CSS surface. Caveats:

- **You must include the `.ng-*` rules** from cloudnimbus's `styles.css`. The
  nimbus-gantt engine emits `.ng-row`, `.ng-task-bar`, `.ng-grid-cell`, etc.
  via its canvas + DOM renderer. If your stylesheet doesn't style them, the
  gantt grid collapses to zero-height rows and task bars disappear. Copy the
  `/* ── ng-* gantt engine ── */` section verbatim from
  `packages/app/src/templates/cloudnimbus/styles.css` into yours.
- **Use `--nga-*` variables**, not hard-coded colors. The drivers still emit
  `.nga-root[data-template="..."] { --nga-primary: ... }` automatically from
  the theme, and your stylesheet gets those for free. This is what makes
  dark-mode variants trivial (see earlier example).
- **Scope everything under `.nga-root[data-template="your-name"]`** to avoid
  colliding with a second template on the same page.

```typescript
export const austereTemplate = defineTemplate({
  name: 'austere',
  extends: 'minimal',
  defaults: { theme: { primary: '#000', surface: '#fff' } },
  stylesheet: {
    inline: `
      /* Your custom chrome */
      .nga-root[data-template="austere"] {
        font-family: var(--nga-font-family-mono);
      }
      .nga-root[data-template="austere"] .nga-titlebar {
        border-bottom: 2px solid var(--nga-text-primary);
        padding: 8px 12px;
      }

      /* Gantt engine rules — copy from cloudnimbus/styles.css */
      .nga-root[data-template="austere"] .ng-row { ... }
      .nga-root[data-template="austere"] .ng-task-bar { ... }
      .nga-root[data-template="austere"] .ng-grid-cell { ... }
      /* ... etc */
    `,
  },
  components: {},
});
```

See [examples/minimal-template.md](./examples/minimal-template.md) for a
complete runnable austere example.

---

## Caveats / gotchas

1. **v8's `.ng-*` gantt-library rules are load-bearing.** If you write a
   fully custom stylesheet and don't include them, the gantt rows, grid cells,
   task bars, and dependency lines won't render. Safest path: extend
   `cloudnimbus` (or inherit its stylesheet via `importedByBundler: true`) and
   override on top.

2. **`stylesheet` field is replace, not merge.** There's no way to "append"
   your CSS to the parent's from inside the template definition. Either:
   - Use `theme` for tenant color tweaks (recommended — it's what the system
     was built for), OR
   - Host an external "overrides" CSS file and have the consumer include both
     (`import 'cloudnimbus/styles.css'` then `import './my-overrides.css'`), OR
   - Copy cloudnimbus's CSS into your template and edit.

3. **IIFE needs a URL at runtime.** `@salesforce/resourceUrl/...` → pass it
   via `overrides.stylesheet.url` from the LWC wrapper. The template itself
   can't know the static-resource URL at bundle time. The LWC wrapper is the
   right place to inject it.

4. **Theme values are passed into `style` as raw strings.** `primary: '#000'`
   and `primary: 'hsl(var(--x))'` both work. Malformed values silently break
   the emitted `<style>` block — lint your tokens.

5. **Custom property names are lowercase-kebab.** `ganttGridColor` →
   `--nga-gantt-grid-color`. Follow this exactly in your stylesheet or the
   variable won't resolve.

6. **Re-mounting into the same container is idempotent.** The stylesheet
   loader dedupes on `data-nga-template-css="{key}"`. To force a reload, call
   `removeTemplateCss(container)` before the next `mount`.
