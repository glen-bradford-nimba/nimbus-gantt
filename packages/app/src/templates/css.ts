/**
 * templates/css.ts — Token-to-CSS-variable emitter.
 *
 * Converts ThemeTokens into a `--nga-{kebab}: {value};` block that can be
 * injected as an inline style attribute or returned as a CSS rule string.
 */
import type { ThemeTokens } from './types';

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/**
 * Returns CSS declarations (no selector, no braces) that you can either:
 *   - assign to `style.cssText` on the root element, OR
 *   - wrap with `.nga-root[data-template="{name}"]{ ... }` for scoped injection.
 */
export function themeToCssVars(theme: ThemeTokens): string {
  const out: string[] = [];
  (Object.keys(theme) as Array<keyof ThemeTokens>).forEach((k) => {
    const v = theme[k];
    if (v !== undefined && v !== null) {
      out.push('--nga-' + kebab(String(k)) + ':' + String(v));
    }
  });
  return out.join(';');
}

/** Wraps `themeToCssVars` in a scoped selector for `<style>` injection. */
export function themeToScopedCss(templateName: string, theme: ThemeTokens): string {
  return (
    '.nga-root[data-template="' + templateName + '"]{' +
    themeToCssVars(theme) +
    '}'
  );
}
