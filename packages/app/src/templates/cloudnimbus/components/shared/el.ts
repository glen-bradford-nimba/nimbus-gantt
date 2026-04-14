/**
 * shared/el.ts — DOM helpers shared by vanilla slot factories.
 * Mirrors the `el()` helper used throughout IIFEApp.ts for API familiarity.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  styleText?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (styleText) e.style.cssText = styleText;
  return e;
}

export function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content: string,
): HTMLElementTagNameMap[K] {
  const e = el(tag, className);
  e.textContent = content;
  return e;
}

/** Remove all children of el. */
export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace className with a new value. */
export function setCls(node: HTMLElement, cls: string): void {
  node.className = cls;
}

/** Toggle a class on/off. */
export function toggleCls(node: HTMLElement, cls: string, on: boolean): void {
  if (on) node.classList.add(cls);
  else node.classList.remove(cls);
}
