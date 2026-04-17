/**
 * diag.ts — opt-in structured lifecycle emitter for Cowork verification.
 *
 * OFF by default. Zero runtime cost when disabled — the flag check runs once
 * at module load, and diag() early-returns without touching `window` or
 * allocating an event object.
 *
 * Enable via any of (checked at module load):
 *   - localStorage.NGA_DIAG === '1'
 *   - window.NGA_DIAG === true   (set this BEFORE the script loads)
 *   - URL query has ?nga_diag=1
 *
 * Events accumulate on `window.__nga_diag` (array of {t, kind, ...}).
 * Set `window.NGA_DIAG_VERBOSE === true` to also console.log each event.
 *
 * Event schema:
 *   { t: number (perf.now), kind: string, ...data }
 *
 * Emitted kinds (see IIFEApp for emission sites):
 *   lib:loaded                 — once per bundle load
 *   mount:start                — NimbusGanttApp.mount() entry
 *   mount:styles-applied       — after non-destructive style writes
 *   mount:data-mode            — after data-mode attribute set
 *   mount:slots-rendered       — after renderSlots() (initial only)
 *   mount:chrome-heights       — after first layout settles (rAF)
 *   mount:init-gantt           — after initGantt() (canvas present)
 *   mount:complete             — data ready, taskCount known
 *   warn:*                     — internal sanity-check trips
 *   err:*                      — caught exceptions
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DiagEvent {
  t: number;
  kind: string;
  [key: string]: unknown;
}

function detectEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if ((window as any).NGA_DIAG === true) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('NGA_DIAG') === '1') return true;
    const q = (window.location && window.location.search) || '';
    if (/[?&]nga_diag=1(?:&|$)/.test(q)) return true;
  } catch { /* ignore — e.g. Safari private mode localStorage throw */ }
  return false;
}

const enabled = detectEnabled();

if (enabled && typeof window !== 'undefined') {
  const w = window as any;
  if (!Array.isArray(w.__nga_diag)) w.__nga_diag = [];
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function diag(kind: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  const ev: DiagEvent = { t: now(), kind, ...(data || {}) };
  try {
    const arr = (window as any).__nga_diag;
    if (Array.isArray(arr)) arr.push(ev);
  } catch { /* ignore */ }
  try {
    if ((window as any).NGA_DIAG_VERBOSE === true) {
      // eslint-disable-next-line no-console
      console.log('[NGA]', kind, data || {});
    }
  } catch { /* ignore */ }
}

export function diagEnabled(): boolean { return enabled; }
