/**
 * cloudnimbus/index.vanilla.ts — IIFE-safe template registration.
 *
 * CRITICAL: Must NOT import any React component from ./components/*.tsx.
 * React's runtime (jsx-runtime + scheduler) uses `new MessageChannel()` at
 * module load time, which throws in Salesforce Locker Service and prevents
 * `window.NimbusGanttApp` from being set.
 *
 * The regular `./index.ts` includes React slots for bundler/React consumers.
 * IIFE entry imports THIS file instead.
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
  TitleBarVanilla, ZoomBarVanilla, FilterBarVanilla, StatsPanelVanilla,
  SidebarVanilla, ContentAreaVanilla, DetailPanelVanilla, AuditPanelVanilla,
  HrsWkStripVanilla,
} from './components/vanilla';
// Inlined copy for cloudnimbusllc.com: CSS is loaded as a side-effect import
// at the component level (DeliveryTimelineV10.tsx), so we pass an empty string
// here. The stylesheet is still applied — Next bundles styles.css into the
// page CSS via `import "./styles.css"`. The inline injection path is only
// needed for the IIFE/Salesforce build where there's no CSS bundler.
const inlineStyles = '';

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
      // KEEP IN SYNC with index.ts — the React variant.
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
    inline: inlineStyles,
  },
  components: {
    TitleBar:    { vanilla: TitleBarVanilla    },
    ZoomBar:     { vanilla: ZoomBarVanilla     },
    FilterBar:   { vanilla: FilterBarVanilla   },
    StatsPanel:  { vanilla: StatsPanelVanilla  },
    Sidebar:     { vanilla: SidebarVanilla     },
    ContentArea: { vanilla: ContentAreaVanilla },
    DetailPanel: { vanilla: DetailPanelVanilla },
    AuditPanel:  { vanilla: AuditPanelVanilla  },
    HrsWkStrip:  { vanilla: HrsWkStripVanilla  },
  },
});

registerTemplate(cloudnimbusTemplate);
