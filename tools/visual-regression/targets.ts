/**
 * Visual-regression targets.
 *
 * Each target is a surface we want to screenshot and compare. Current set:
 *   v9          — reference build on cloudnimbusllc.com dev server (DeliveryTimelineV5)
 *   v10         — new template-framework build on cloudnimbusllc.com dev server
 *   salesforce  — Pro Forma Timeline tab in the scratch org, only included when
 *                 SF_SESSION_URL is provided (frontdoor.jsp URL from `sf org open --url-only`)
 *
 * Auth:
 *   v9 + v10    — MFAuthGate auto-auths on localhost (see MFAuthGate.tsx L71-74),
 *                 so no cookie injection is needed as long as BASE_URL is
 *                 http://localhost:3000 / 127.0.0.1.
 *   salesforce  — SF_SESSION_URL contains a one-shot frontdoor token. We open it
 *                 once per run to establish a session cookie, then navigate to the
 *                 Pro Forma Timeline Lightning page URL.
 */

export interface Target {
  /** Short slug used in screenshot/diff directory names. */
  id: 'v9' | 'v10' | 'salesforce';
  /** Human-readable label for the HTML report. */
  label: string;
  /** Fully-qualified URL to navigate to. */
  url: string;
  /**
   * Optional pre-navigation hook. Used by the Salesforce target to visit the
   * frontdoor.jsp URL and establish a session cookie before the real URL load.
   */
  preAuthUrl?: string;
  /**
   * Selector we wait for before screenshotting. Signals "render complete enough
   * that the chrome is stable." Has to be present in all templates.
   */
  readySelector: string;
  /** Extra wait after readySelector appears, to let async renders settle. */
  settleMs: number;
  /** Whether this target is enabled for the current run. */
  enabled: boolean;
  /** Reason the target is disabled (shown in the report). */
  disabledReason?: string;
}

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SF_SESSION_URL = process.env.SF_SESSION_URL ?? '';
const SF_PRO_FORMA_URL = process.env.SF_PRO_FORMA_URL ?? '';

export const targets: Target[] = [
  {
    id: 'v9',
    label: 'cloudnimbusllc.com /mf/delivery-timeline-v9 (reference)',
    url: `${BASE}/mf/delivery-timeline-v9`,
    // v9 is DeliveryTimelineV5 — the "nga-root" / data-slot attributes only exist
    // on the v10 template framework, so we fall back to the outermost class wrapper.
    readySelector: '[data-drv], [data-slot="TitleBar"], .nga-root',
    settleMs: 1500,
    enabled: true,
  },
  {
    id: 'v10',
    label: 'cloudnimbusllc.com /mf/delivery-timeline-v10 (template framework)',
    url: `${BASE}/mf/delivery-timeline-v10`,
    readySelector: '[data-slot="TitleBar"]',
    settleMs: 1500,
    enabled: true,
  },
  {
    id: 'salesforce',
    label: 'Salesforce Pro Forma Timeline tab',
    url: SF_PRO_FORMA_URL || SF_SESSION_URL,
    preAuthUrl: SF_SESSION_URL || undefined,
    // In Salesforce the gantt mounts inside a LWC, so the host element is our
    // data-nga-gantt-host="1" marker. readySelector uses the same data-slot
    // attrs because they're emitted by the identical template framework.
    readySelector: '[data-slot="TitleBar"], [data-nga-gantt-host="1"]',
    settleMs: 4000,
    enabled: Boolean(SF_SESSION_URL),
    disabledReason: SF_SESSION_URL
      ? undefined
      : 'Set SF_SESSION_URL (frontdoor.jsp URL from `sf org open --url-only`) to enable.',
  },
];

export const comparisonPairs: Array<{ name: string; a: Target['id']; b: Target['id'] }> = [
  { name: 'v9-vs-v10', a: 'v9', b: 'v10' },
  { name: 'v10-vs-salesforce', a: 'v10', b: 'salesforce' },
];

export function enabledTargets(): Target[] {
  return targets.filter((t) => t.enabled && !!t.url);
}

export function getTarget(id: Target['id']): Target | undefined {
  return targets.find((t) => t.id === id);
}
