/**
 * minimal/index.vanilla.ts — IIFE-safe registration (no React imports).
 */
import type { Template } from '../types';
import { defineTemplate, registerTemplate } from '../registry';
import { minimalTheme } from './theme';
import { TitleBarVanilla } from './components/vanilla/TitleBar.vanilla';
import { ZoomBarVanilla } from './components/vanilla/ZoomBar.vanilla';
import { ContentAreaVanilla } from './components/vanilla/ContentArea.vanilla';

export const minimalTemplate: Template = defineTemplate({
  name: 'minimal',
  defaults: {
    features: {
      titleBar: true, statsPanel: false, filterBar: false, zoomBar: true,
      sidebar: false, detailPanel: false, auditPanel: false, hrsWkStrip: false,
      dragReparent: false, depthShading: false,
      groupByToggle: false, hideCompletedToggle: false,
    },
    theme: minimalTheme,
    title: 'Gantt',
    version: 'minimal',
    views: ['gantt', 'list'],
  },
  stylesheet: { importedByBundler: true },
  components: {
    TitleBar:    { vanilla: TitleBarVanilla    },
    ZoomBar:     { vanilla: ZoomBarVanilla     },
    ContentArea: { vanilla: ContentAreaVanilla },
  },
});

registerTemplate(minimalTemplate);
