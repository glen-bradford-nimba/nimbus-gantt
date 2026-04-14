/**
 * templates/stylesheet-loader.ts — Phase 0 Strategy C implementation.
 *
 * Fetch the template CSS and inject a <style> element INSIDE the container
 * element (NOT document.head). This is the only strategy that reliably
 * pierces Salesforce LWC synthetic shadow DOM to reach content under
 * `lwc:dom="manual"`.
 *
 * See docs/phase-0-status.md for the full rationale.
 */
import type { TemplateStylesheet } from './types';

const MARKER_ATTR = 'data-nga-template-css';

/**
 * Inject template CSS into the container. Idempotent per container+URL pair.
 *
 * Order of preference:
 *   1. If `stylesheet.inline` is set → inject that directly (no network).
 *   2. Else if `stylesheet.url` is set → fetch it, then inject.
 *   3. Else → no-op (caller relies on React bundler CSS import).
 */
export async function ensureTemplateCss(
  container: HTMLElement,
  stylesheet: TemplateStylesheet,
): Promise<void> {
  if (!stylesheet) return;

  const key = stylesheet.url || 'inline';
  // Dedup: a <style> element tagged for this key already lives in the container.
  const existing = container.querySelector<HTMLStyleElement>(
    'style[' + MARKER_ATTR + '="' + cssAttrEscape(key) + '"]',
  );
  if (existing) return;

  let css = stylesheet.inline || '';
  if (!css && stylesheet.url) {
    try {
      const res = await fetch(stylesheet.url);
      if (!res.ok) {
        console.warn('[nimbus-gantt] template CSS fetch failed:', stylesheet.url, res.status);
        return;
      }
      css = await res.text();
    } catch (err) {
      console.warn('[nimbus-gantt] template CSS fetch error:', err);
      return;
    }
  }
  if (!css) return;

  const styleEl = document.createElement('style');
  styleEl.setAttribute(MARKER_ATTR, key);
  styleEl.textContent = css;
  container.appendChild(styleEl);
}

/** Remove any template CSS <style> elements previously injected into container. */
export function removeTemplateCss(container: HTMLElement): void {
  const styles = container.querySelectorAll<HTMLStyleElement>('style[' + MARKER_ATTR + ']');
  styles.forEach((s) => s.remove());
}

function cssAttrEscape(v: string): string {
  return v.replace(/"/g, '&quot;');
}
