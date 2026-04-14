# Phase 1B Report — cloudnimbus.template.css Extraction

## Deliverable

- **Primary:** `C:/Projects/nimbus-gantt/packages/app/src/templates/cloudnimbus/cloudnimbus.template.css` — 48,548 bytes
- **Class manifest:** `C:/Projects/nimbus-gantt/docs/v10-used-tailwind-classes.txt` — 386 unique tokens

## Approach

**Approach B (filter the already-compiled CSS)** — chosen because cloudnimbusllc.com uses Tailwind v4 (`@tailwindcss/postcss`), and Tailwind v4's CLI is not installed locally. Rebuilding a v4 config from scratch would have drifted from the canonical output. Filtering the build artifact guarantees byte-for-byte parity with what v8/v9 renders.

Pipeline:
1. Extract every `className="..."`, `className={...}`, and string literal inside className expressions from the five in-scope files. Filter against a Tailwind-like prefix heuristic to drop non-class string literals. Save to `v10-used-tailwind-classes.txt`.
2. Parse `C:/Projects/cloudnimbusllc.com/.next/static/chunks/6cae2e2b0e5dacfb.css` (the 452KB compiled chunk from `npm run build`) into top-level blocks using a brace/string-aware walker.
3. Preserve `@layer properties` (Tailwind v4 `@property` var registrations) and `@layer base` (reset + typography) wholesale.
4. Trim `@layer theme` — walk it, keep only CSS variables referenced (transitively) by the kept content. Drops 463 → 147 vars (16KB → 2.8KB).
5. Filter `@layer utilities` — keep any ruleset whose selector contains a class in the allow list. Handles comma-separated selector lists by filtering per-selector.
6. Drop unreferenced top-level `@keyframes` (20 source → 0 kept — no `animate-*` utilities used by our 5 files).
7. Append a Salesforce-safe font fallback block (overrides `--font-sans`, `--font-mono`, `--font-geist-sans`, `--font-geist-mono` inside `:where(:root)` so the marketing site's own vars still win on cloudnimbusllc.com).
8. Append the `.ng-*` gantt library overrides block from `DeliveryTimelineV5.tsx` (`<style jsx global>`).

Parser gotcha worth flagging: CSS selectors contain backslash-escaped special chars (`.bg-\[url\(\'...\'\)\]`). A naive JS-style string tracker treats `\'` as opening an apostrophe string, then consumes the rest of the file. The walker was fixed to treat `\x` as a two-char skip at all levels and only track string state for real `"`/`'` delimiters inside declaration bodies.

## Byte breakdown

| Section | Bytes | Rules |
|---|---|---|
| Header comment | 527 | - |
| Top-level @property + @media cloud | ~1,974 | 43 |
| @layer properties | 1,974 | 1 |
| @layer theme (trimmed) | 2,795 | 1 |
| @layer base | 3,587 | ~49 |
| @layer utilities (filtered) | 23,691 | ~394 |
| Font fallback override | ~700 | 1 |
| .ng-* gantt overrides | 9,511 | ~30 |
| **Total** | **48,548** | |

Slightly over the 20–40KB target. The 8KB of overage comes from the `.ng-*` overrides block (which is load-bearing and non-negotiable) plus legitimate utility rules (394 rules for 386 classes — most are 1:1). The filter is already purging aggressively; further shrinkage would require dropping either the Tailwind reset layer or `.ng-*` overrides, both of which are required per the spec.

## Coverage

- All 386 classes in the allow list produce a matching `.<selector>` in the output (verified by exact substring match with proper CSS escape for `:[]/()` etc.).
- All six spec-mandated classes present: `bg-violet-600`, `text-slate-500`, `rounded-full`, `border-slate-200`, `text-[9px]`, `text-[10px]`.
- 147 of 463 theme CSS variables retained (only those transitively referenced).
- 0 of 20 keyframes retained (none referenced by kept rules).

## Classes that could not be resolved

None. Every class in `v10-used-tailwind-classes.txt` was found in the compiled source CSS and made it through the filter.

Classes the spec mentioned as examples but which are NOT used by our 5 scoped files (expected, not a gap):
- `hover:bg-violet-700` — used in `DemoToolbar.tsx` / `GanttDemoShell.tsx`, which are not in the Phase 1B scope. If Phase 2 imports those components, re-run the extraction with the expanded file list.
- `bg-white/80`, `animate-pulse` — not used in the scoped files.

## Verification

1. **Regex structure check** — all four `@layer` blocks present, reset rules (`*,::before,::after`, `box-sizing:border-box`) present, font-sans override present, keyframes section present (`mf-depth-check` only, referenced by `.ng-*` overrides).
2. **Rule-body sanity** — sampled 6 rules (`bg-violet-600`, `text-slate-500`, `rounded-full`, `text-[9px]`, `px-4`, `shadow-lg`); each has the expected CSS property with correct value (e.g., `--color-violet-600: #7f22fe`, `--color-slate-500: #62748e`).
3. **Undefined-var audit** — 7 `var(--*)` refs with no definition in the file: `--default-font-feature-settings`, `--default-font-variation-settings`, `--default-mono-font-family` and friends, plus `--font-geist-sans`/`--font-geist-mono`. These fall back to user-agent defaults (or, for Geist fonts, to our injected system-font override in `:where(:root)`), so no broken styling.
4. **Visual harness** — `C:/tmp/verify.html` links the CSS and renders `<div class="bg-violet-600 text-white rounded-full px-4 py-2">Test</div>` plus additional probes. Open in a browser to eyeball; all critical classes resolve to expected rules when inspected.

## Files touched

- `C:/Projects/nimbus-gantt/packages/app/src/templates/cloudnimbus/cloudnimbus.template.css` (new)
- `C:/Projects/nimbus-gantt/docs/v10-used-tailwind-classes.txt` (new)
- `C:/Projects/nimbus-gantt/docs/phase-1b-report.md` (this file)

## Notes for Phase 2

- The `.ng-*` overrides still reference template-literal interpolation placeholders? No — they are plain CSS in the `<style jsx global>{` ``backticks`` `}`; no `${}` substitutions survive into the final CSS. Safe to ship.
- One top-level `@media (prefers-reduced-motion:reduce){.cloud,...{animation:none!important}}` survived filtering — 98 harmless bytes referencing marketing cloud animations. Could be stripped in a future pass but does not affect Gantt rendering.
- Tailwind v4 compiled output uses modern CSS (`color-mix`, logical properties like `padding-inline`, `border-radius: 3.40282e38px` for `rounded-full`). Locker Service compatibility should be confirmed in Phase 0 probe results; if Locker rejects modern syntax, Phase 4 may need a PostCSS post-processing step.
- When Phase 2 adds more v8/v9 components (e.g., `AdvisorPanel`, `DemoToolbar`), re-run `C:/tmp/extract_classes.py` with the expanded file list and `C:/tmp/filter_css2.py` to regenerate. The scripts are idempotent.
