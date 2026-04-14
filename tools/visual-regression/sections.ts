/**
 * Section definitions for visual regression.
 *
 * A "section" is a named, screenshot-able region. Each section supplies a
 * prioritized list of CSS selectors; the capture script picks the first one
 * that matches. Selectors fall into two tiers:
 *
 *   1. Template-framework `[data-slot="…"]` — stable on v10 + Salesforce.
 *   2. Structural class fallbacks — best-effort match for v9 (DeliveryTimelineV5)
 *      which predates the slot attributes. These are intentionally loose so we
 *      still get a screenshot even if v9 classnames drift slightly.
 *
 * If no selector matches, the section is captured as a full-page screenshot with
 * a "missing" flag recorded in the compare step.
 */

export interface Section {
  /** Filename-safe slug. */
  id: string;
  /** Human label for the HTML report. */
  label: string;
  /** Ordered selector list — first match wins. */
  selectors: string[];
  /** If true, capture full-page viewport instead of an element screenshot. */
  fullPage?: boolean;
}

export const sections: Section[] = [
  {
    id: 'full-page',
    label: 'Full viewport',
    selectors: [],
    fullPage: true,
  },
  {
    id: 'title-bar',
    label: 'Title bar',
    selectors: [
      '[data-slot="TitleBar"]',
      '.nga-titlebar',
      // v9 / V5 fallback: the first header-ish row inside the page container.
      '[data-drv] > div.bg-white.border-b:nth-of-type(1)',
    ],
  },
  {
    id: 'filter-bar',
    label: 'Filter bar',
    selectors: [
      '[data-slot="FilterBar"]',
      '.nga-filterbar',
      '[data-drv] > div.bg-white.border-b:nth-of-type(2)',
    ],
  },
  {
    id: 'zoom-bar',
    label: 'Zoom bar',
    selectors: [
      '[data-slot="ZoomBar"]',
      '.nga-zoombar',
    ],
  },
  {
    id: 'hrs-wk-strip',
    label: 'Hours / week strip',
    selectors: [
      '[data-slot="HrsWkStrip"]',
      '.nga-hrswk',
    ],
  },
  {
    id: 'stats-panel',
    label: 'Stats panel',
    selectors: [
      '[data-slot="StatsPanel"]',
      '.nga-stats',
    ],
  },
  {
    id: 'audit-panel',
    label: 'Audit panel',
    selectors: [
      '[data-slot="AuditPanel"]',
      '[data-testid="audit-panel"]',
      '.nga-audit',
    ],
  },
  {
    id: 'sidebar',
    label: 'Priority-group sidebar',
    selectors: [
      '[data-slot="Sidebar"]',
      '.nga-sidebar',
      // V5 fallback — the aside inside the flex content area.
      '[data-drv] aside',
    ],
  },
  {
    id: 'content-area',
    label: 'Content area (sidebar + gantt host)',
    selectors: [
      '[data-slot="ContentArea"]',
      '.nga-content-outer',
      '.nga-content',
      '[data-drv] > div.flex-1',
    ],
  },
  {
    id: 'gantt-host',
    label: 'Gantt canvas host',
    selectors: [
      '[data-nga-gantt-host="1"]',
      '.nga-content',
      // v9 uses raw canvas inside the flex content region.
      '[data-drv] canvas',
    ],
  },
  {
    id: 'detail-panel',
    label: 'Detail panel',
    selectors: [
      '[data-slot="DetailPanel"]',
      '.nga-detail',
    ],
  },
];
