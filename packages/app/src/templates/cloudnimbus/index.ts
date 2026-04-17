/**
 * cloudnimbus/index.ts — the canonical v10 template.
 *
 * Bundles theme + defaults + React + vanilla slot factories. Self-registers
 * on module load so consumers can pass `template="cloudnimbus"` directly.
 */
import type { Template } from '../types';
import { defineTemplate, registerTemplate } from '../registry';
import { cloudnimbusTheme } from './theme';
import {
  CLOUD_NIMBUS_PRIORITY_BUCKETS,
  CLOUD_NIMBUS_FILTERS,
  CLOUD_NIMBUS_VIEWS,
} from './defaults';
import {
  TitleBar, ZoomBar, FilterBar, StatsPanel, Sidebar,
  ContentArea, DetailPanel, AuditPanel, HrsWkStrip,
} from './components';
import {
  TitleBarVanilla, ZoomBarVanilla, FilterBarVanilla, StatsPanelVanilla,
  SidebarVanilla, ContentAreaVanilla, DetailPanelVanilla, AuditPanelVanilla,
  HrsWkStripVanilla,
} from './components/vanilla';

export const cloudnimbusTemplate: Template = defineTemplate({
  name: 'cloudnimbus',
  defaults: {
    features: {
      titleBar: true,
      statsPanel: true,
      filterBar: true,
      // zoomBar default OFF — TitleBar already renders inline zoom pills
      // (Day/Week/Month/Quarter), matching v9's gold-standard layout. The
      // standalone ZoomBar slot exists for minimal-template consumers that
      // skip TitleBar; cloudnimbus consumers would render it twice. Observed
      // 2026-04-16 on /v12 (8 zoom buttons instead of 4). Same class of
      // dup as the AuditPanel fix at c9c765d.
      zoomBar: false,
      sidebar: true,
      detailPanel: true,
      auditPanel: true,
      hrsWkStrip: true,
      dragReparent: true,
      depthShading: true,
      groupByToggle: true,
      hideCompletedToggle: true,
    },
    theme: cloudnimbusTheme,
    buckets: CLOUD_NIMBUS_PRIORITY_BUCKETS,
    filters: CLOUD_NIMBUS_FILTERS,
    views: CLOUD_NIMBUS_VIEWS,
    title: 'Pro Forma Timeline',
    version: 'v10 · Nimbus Gantt',
  },
  stylesheet: {
    // React bundler will resolve this import at build time (see comment below).
    importedByBundler: true,
    // IIFE consumers pass `overrides.stylesheet.url` or set this via code in
    // the LWC wrapper. Left undefined here so IIFE callers can pick up the
    // static-resource URL dynamically.
  },
  components: {
    TitleBar:    { react: TitleBar,    vanilla: TitleBarVanilla    },
    ZoomBar:     { react: ZoomBar,     vanilla: ZoomBarVanilla     },
    FilterBar:   { react: FilterBar,   vanilla: FilterBarVanilla   },
    StatsPanel:  { react: StatsPanel,  vanilla: StatsPanelVanilla  },
    Sidebar:     { react: Sidebar,     vanilla: SidebarVanilla     },
    ContentArea: { react: ContentArea, vanilla: ContentAreaVanilla },
    DetailPanel: { react: DetailPanel, vanilla: DetailPanelVanilla },
    AuditPanel:  { react: AuditPanel,  vanilla: AuditPanelVanilla  },
    HrsWkStrip:  { react: HrsWkStrip,  vanilla: HrsWkStripVanilla  },
  },
});

// Self-register on module load (design §4: "cloudnimbus and minimal self-register").
registerTemplate(cloudnimbusTemplate);

// NOTE on React CSS:
//   Consumers that use the React driver (NimbusGanttAppReact) should import
//   the stylesheet themselves to let the bundler extract it:
//       import '@nimbus-gantt/app/src/templates/cloudnimbus/styles.css';
//   or this file could add `import './styles.css'` at the top. We keep that
//   optional because the IIFE build must not pull a CSS import into the JS
//   bundle (Vite would try to emit CSS out of the IIFE entry).
