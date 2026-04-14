/**
 * minimal/index.ts — a stripped-down template with 3 slots.
 */
import type { Template } from '../types';
import { defineTemplate, registerTemplate } from '../registry';
import { minimalTheme } from './theme';
import { TitleBar } from './components/TitleBar';
import { ZoomBar } from './components/ZoomBar';
import { ContentArea } from './components/ContentArea';
import { TitleBarVanilla } from './components/vanilla/TitleBar.vanilla';
import { ZoomBarVanilla } from './components/vanilla/ZoomBar.vanilla';
import { ContentAreaVanilla } from './components/vanilla/ContentArea.vanilla';

export const minimalTemplate: Template = defineTemplate({
  name: 'minimal',
  defaults: {
    features: {
      titleBar: true,
      statsPanel: false,
      filterBar: false,
      zoomBar: true,
      sidebar: false,
      detailPanel: false,
      auditPanel: false,
      hrsWkStrip: false,
      dragReparent: false,
      depthShading: false,
      groupByToggle: false,
      hideCompletedToggle: false,
    },
    theme: minimalTheme,
    title: 'Gantt',
    version: 'minimal',
    views: ['gantt', 'list'],
  },
  stylesheet: {
    importedByBundler: true,
  },
  components: {
    TitleBar:    { react: TitleBar,    vanilla: TitleBarVanilla    },
    ZoomBar:     { react: ZoomBar,     vanilla: ZoomBarVanilla     },
    ContentArea: { react: ContentArea, vanilla: ContentAreaVanilla },
  },
});

registerTemplate(minimalTemplate);
