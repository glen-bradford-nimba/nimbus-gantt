/**
 * iife-entry.ts — IIFE bundle entry for Salesforce Locker Service (v10).
 *
 * Exports a PLAIN OBJECT (not a class) as `window.NimbusGanttApp`. Locker
 * Service wraps the window global in a Proxy that blocks access to static
 * class methods; plain object properties pass through fine.
 *
 * Added in v10: template registration + listing.
 *
 * Usage:
 *   window.NimbusGanttApp.mount(container, {
 *     template: 'cloudnimbus',       // optional; defaults to cloudnimbus
 *     tasks, onPatch,
 *     overrides: { features: { auditPanel: false } },
 *     engine: window.NimbusGantt,
 *   });
 *   window.NimbusGanttApp.unmount(container);
 *   window.NimbusGanttApp.listTemplates(); // ['cloudnimbus', 'minimal', ...]
 */
import { IIFEApp } from './IIFEApp';
import { registerTemplate, listTemplates, getTemplate } from './templates/registry';
import type { Template } from './templates/types';

// Make sure the built-in templates are registered on module load.
// CRITICAL: import the .vanilla variants to keep React out of the IIFE bundle.
// React's jsx-runtime uses new MessageChannel() which throws in Salesforce
// Locker Service and prevents window.NimbusGanttApp from being set.
import './templates/cloudnimbus/index.vanilla';
import './templates/minimal/index.vanilla';

type MountOpts = Parameters<typeof IIFEApp.mount>[1];

const NimbusGanttApp = {
  mount: (container: HTMLElement, options: MountOpts) =>
    IIFEApp.mount(container, options),
  unmount: (container: HTMLElement) =>
    IIFEApp.unmount(container),
  /**
   * Register a custom template. Silently ignores React-only fields; only
   * .vanilla slot factories are honoured in IIFE builds.
   */
  registerTemplate: (template: Template) => {
    registerTemplate(template);
  },
  /** Return names of all registered templates. */
  listTemplates: (): string[] => listTemplates(),
  /** Retrieve a template by name. */
  getTemplate: (name: string): Template => getTemplate(name),
};

export { NimbusGanttApp };
