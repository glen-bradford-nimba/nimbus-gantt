/**
 * templates/registry.ts — Template registry (per API design §6).
 *
 * CRITICAL (2026-04-14): Must NOT use `new Map()` at module top level.
 * Salesforce Locker Service wraps scripts in a blob:// sandbox and
 * `new Map()` executed during module init throws, preventing
 * `window.NimbusGanttApp` from being set.
 *
 * Use an array-based store instead. Each mutation does O(n) scan but
 * N = number of registered templates, which is tiny (2 built-in +
 * occasional user templates).
 */
import type { Template } from './types';

interface RegistryEntry {
  name: string;
  template: Template;
}

const registry: RegistryEntry[] = [];

function findIndex(name: string): number {
  for (let i = 0; i < registry.length; i++) {
    if (registry[i].name === name) return i;
  }
  return -1;
}

export function registerTemplate(template: Template): void {
  if (!template || !template.name) {
    throw new Error('Template.name is required');
  }
  const idx = findIndex(template.name);
  if (idx >= 0) registry[idx].template = template;
  else registry.push({ name: template.name, template });
}

export function getTemplate(name: string): Template {
  const idx = findIndex(name);
  if (idx < 0) throw new Error("Unknown template: '" + name + "'");
  return registry[idx].template;
}

export function hasTemplate(name: string): boolean {
  return findIndex(name) >= 0;
}

export function listTemplates(): string[] {
  const names: string[] = [];
  for (let i = 0; i < registry.length; i++) names.push(registry[i].name);
  return names;
}

export function defineTemplate(template: Template): Template {
  return template;
}
