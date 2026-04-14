# Phase 6 Status — Template Framework Documentation

**Date:** 2026-04-14
**Agent:** Opus 4.6 (1M context), docs
**Scope:** Author end-user developer docs for the v10 template framework —
how to build custom templates, apply overrides, theme via tokens + CSS
custom properties, and register templates in both React and Salesforce IIFE
surfaces. Final phase of the V10 plan.

---

## 1. Files created (5)

All under `packages/app/docs/`.

| Path | Bytes |
|------|-------|
| `packages/app/docs/README.md` | 2,050 |
| `packages/app/docs/templates.md` | 11,662 |
| `packages/app/docs/overrides.md` | 10,746 |
| `packages/app/docs/theming.md` | 12,995 |
| `packages/app/docs/examples/minimal-template.md` | 8,900 |
| **Total** | **46,353** |

No source code was modified. No existing docs were touched.

---

## 2. Summary of each doc

### `README.md`
One-paragraph framing ("template-driven framework — ship one IIFE + one CSS,
render identical chrome everywhere") plus an index table pointing to the four
detail docs, and a TL;DR with React and IIFE mount snippets.

### `templates.md`
The authoring spine. Covers:
- What a template is (config + default components + stylesheet).
- Both built-ins (`cloudnimbus` all-on vs. `minimal` three-slot skeleton).
- Template anatomy — `Template`, `TemplateDefaults`, `TemplateStylesheet`,
  `ComponentSlot` — with the real TypeScript signatures from
  `packages/app/src/templates/types.ts`.
- Usage in React and IIFE.
- `defineTemplate` + `registerTemplate` — side-effect import vs. explicit call.
- The `extends` chain with the three-level `acme-corp-dark` example.
- A "template vs. overrides" decision table.
- Full public API surface pulled from the package's index barrel.

### `overrides.md`
The consumer-side escape hatch:
- `TemplateOverrides` interface exactly as exported.
- Per-field merge-rules table (features/theme shallow-merge,
  buckets/filters/views replace, components per-slot with `.react`/`.vanilla`
  independent, stylesheet whole-replace, title/version replace).
- Slot-override semantics — the `inheritReact` identity used by the resolver,
  and why overriding only `.react` preserves `.vanilla`.
- Feature-flag slot gating — disabled wins even if component override is
  present; `ContentArea` is always rendered.
- Five concrete examples (disable panels, change theme, replace slot, replace
  filters, replace buckets).
- Stacking model (engine defaults → root template → extends chain →
  consumer overrides).
- `TemplateConfig` shape.
- Seven gotchas, including array-replace, `undefined` behaviour, IIFE ignoring
  `.react`, feature gating, stylesheet replace-not-merge.

### `theming.md`
CSS custom-property plumbing:
- Complete `ThemeTokens` surface (brand, surfaces, text, semantic,
  typography, shape, gantt-specific).
- How tokens become `--nga-{kebab}` CSS variables scoped to
  `.nga-root[data-template="..."]`.
- Two design-system integration paths (mirror tokens into template via
  `hsl(var(--primary))`-style indirection, vs. pass concrete values via
  overrides). Includes a complete dark-mode template.
- `var(--my-primary, fallback)` pattern for consuming existing app-level
  CSS variables.
- Phase 0 Strategy C rationale — why fetch + inject into container instead
  of `<link>` in document.head (LWC synthetic shadow DOM).
- Custom-stylesheet authoring, including the warning that v8's `.ng-*`
  gantt-library rules are load-bearing — if you replace `styles.css` without
  copying them, the gantt grid breaks.
- Six caveats.

### `examples/minimal-template.md`
A complete runnable `austere` template (extends `minimal`, monospace
black-on-white, TitleBar + ZoomBar + ContentArea only):
- Full template definition with inline stylesheet — ~40 lines.
- React consumer (`import './templates/austere'` as side-effect + use by name).
- Salesforce LWC consumer with `connectedCallback` that calls
  `window.NimbusGanttApp.registerTemplate(austereTemplate)` before mount,
  plus alternate "ship template in its own static resource" pattern.
- IIFE caveats for custom templates (`.react` ignored, `Template` object not
  accepted as the mount arg, stylesheet URL vs. inline tradeoff).
- An example of stacking `overrides` on top of the custom template.

---

## 3. Gaps exposed by the documentation pass

Writing the docs surfaced several things the Phase 2 framework is silent on
or slightly inconsistent on. None are blockers for shipping; listing for
visibility.

1. **No `onError` / error-boundary story for slot overrides.**
   If a consumer's custom `.react` throws, the whole React root currently
   unmounts. Docs don't tell them this because there's no recommended
   pattern yet. Consider: a thin error boundary inside the driver that
   renders a sentinel `<div class="nga-slot-error">` and preserves other
   slots. Out of scope for Phase 6; worth a Phase 7 ticket.

2. **`stylesheet` is replace-not-merge, and there's no `appendInline`
   escape hatch.** The docs recommend three workarounds (use `theme` for
   tenant color tweaks, ship a separate "overrides" CSS file the consumer
   imports after, or copy cloudnimbus CSS into your template and edit).
   None are ergonomic for a user who wants "cloudnimbus plus five rules".
   Consider adding
   `TemplateStylesheet.additionalInline?: string` in a future phase;
   resolver would concat, not replace.

3. **`ContentArea` feature-gating is a sentinel.**
   `SLOT_TO_FEATURE.ContentArea = 'titleBar'` in `slots.ts`, with a comment
   "titleBar as a sentinel that's effectively always on" — but if the
   consumer disables `titleBar`, the gating function still returns `true`
   for ContentArea thanks to the `if (slot === 'ContentArea') return true`
   short-circuit in `shouldRenderSlot`. So the sentinel entry is
   effectively dead code. The docs sidestep this by saying "ContentArea is
   never gated" — but the map entry is misleading. Suggest removing the
   entry or changing the type to `SlotName | 'always'`. Minor cleanup.

4. **Custom view modes in `views: ViewMode[]`.**
   The type is a closed string union `'gantt' | 'list' | 'treemap' |
   'bubbles' | 'calendar' | 'flow'`, but API design §9.4 claims "views
   array accepts any string — unknown modes render empty state". The
   `ViewMode` type in `types.ts` appears not to include the open-ended
   `(string & {})` escape. If we want the claim to hold, `ViewMode` should
   be `TheseNames | (string & {})` like `template` on `NimbusGanttAppProps`
   is. Docs currently describe it as a closed union — consistent with the
   type today but inconsistent with the design intent.

5. **IIFE registration ordering is awkward to document.**
   Custom templates must be registered *before* `mount()`. For Salesforce
   consumers, that means either a second static resource loaded after
   `nimbusganttapp` but before mount, or a JS-level `registerTemplate()`
   call from the LWC. The docs cover both patterns, but a
   `NimbusGanttApp.mountWithTemplate(container, template, options)`
   convenience that does `registerTemplate(template)` + `mount({
   template: template.name, ... })` in one call would shrink the LWC
   surface area significantly. Not urgent.

6. **No `unregisterTemplate(name)` on the public surface.**
   The registry has a `Map` and `registerTemplate` is idempotent (same
   name overwrites), but there's no way to remove a template. Fine for
   normal use; comes up if anyone wants hot-reload in dev. Worth adding
   for completeness.

7. **Overrides are not validated at runtime.**
   If a consumer passes `overrides.buckets` with a duplicate `id`, nothing
   complains; the sidebar just renders two groups with the same key. Same
   for `filters.id`, feature flag typos, and unknown slot names (which
   TypeScript catches only if the consumer is typed). A
   `validateOverrides(overrides): string[]` helper returning human-readable
   warnings would be cheap and catch common mistakes in dev.

---

## 4. Suggested follow-ups

1. **Ship a CHANGELOG entry** for `@nimbus-gantt/app` that cross-links
   these docs once v10 is published to npm / the cloudnimbusllc.com
   `/mf/delivery-timeline-v10` route goes live. The docs land standalone
   in the repo; they should get a release-note pointer.

2. **Publish the docs** as a navigable site. GitHub renders them fine in
   the repo, but the real developer experience is a hosted docs site
   (`cloudnimbusllc.com/nimbus-gantt/templates` etc.) with a sidebar tree.
   Not a Phase 6 deliverable, but low-effort follow-up once the cloudnimbus
   Next.js site is the canonical home.

3. **Address gaps 1, 2, and 7 above as a batched Phase 2.1 patch.** Error
   boundary inside the driver, `additionalInline` on `TemplateStylesheet`,
   and a `validateOverrides()` helper. Each is a small, bounded change
   that would noticeably tighten the DX.

4. **Add example #2 — `shadcn` integration.** The `theming.md` doc has a
   sketch of how to mirror shadcn tokens into a template; a complete
   runnable example in `packages/app/docs/examples/shadcn-template.md`
   would turn that into a paste-and-go recipe. Especially valuable for
   third-party consumers wanting to demo nimbus-gantt inside their own
   component library.

5. **Reconcile `ViewMode` closed-union vs. design §9.4.** Either tighten
   the design doc or open the type. Doc currently follows the type.

6. **Add automated doc link-checking to CI.** Cross-references between
   `templates.md` / `overrides.md` / `theming.md` / `examples/` are dense;
   a markdown-link-check CI job would catch regressions when files move.

---

## Phase 6 status: COMPLETE

End state after Phase 6 (per V10 plan):
- v10 route shipped on cloudnimbusllc.com ✓ (Phase 3)
- Salesforce parity ✓ (Phase 4)
- Visual regression harness ✓ (Phase 5)
- Full docs for building custom templates ✓ (Phase 6, this report)

No code changes in this phase — pure documentation. All five docs are
internally linked, point to the canonical `docs/template-api-design.md` for
type-level detail, and include real TypeScript signatures + runnable code.
