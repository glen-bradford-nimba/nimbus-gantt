/**
 * savedViews.ts — Saved Views persistence (0.199.0).
 *
 * A "view" is a named snapshot of the user's layout: which view-mode is open
 * plus that mode's settings (filter / search / zoom / grouping / hide-completed
 * and, for the Pacing view, its full prefs snapshot). The store also holds the
 * starred DEFAULT view (decides what opens on load) and a `last` snapshot of the
 * most recent session (the remember-where-you-left-off fallback when nothing is
 * starred).
 *
 * Persistence is per-browser localStorage, LWS-guarded (Salesforce Lightning Web
 * Security can throw on storage access) — every read/write is wrapped so a throw
 * degrades to "no saved views" rather than crashing the mount. Hosts can also
 * seed an initial list via mount config and drive it programmatically through the
 * app handle (getSavedViews / saveView / applyView / deleteView / setDefaultView).
 */

/** The layout a view captures. `pacing` is an opaque snapshot of the pacing
 *  renderer's prefs (kept structurally decoupled — the views layer never reads
 *  pacing's internal shape, it just round-trips the blob via get/setPacingPrefs). */
export interface SavedViewState {
  viewMode: string;
  filter?: string;
  search?: string;
  zoom?: string;
  groupBy?: string;
  hideCompleted?: boolean;
  pacing?: Record<string, unknown>;
}

export interface SavedView extends SavedViewState {
  id: string;
  name: string;
}

export interface SavedViewsStore {
  views: SavedView[];
  /** Starred view id — opens on load. null = no default (fall back to `last`). */
  defaultId: string | null;
  /** Snapshot of the most recent session's layout (remember-last fallback). */
  last: SavedViewState | null;
}

const VIEWS_KEY = 'nga.views.v1';

const EMPTY: SavedViewsStore = { views: [], defaultId: null, last: null };

export function loadViewsStore(): SavedViewsStore {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEWS_KEY) : null;
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SavedViewsStore>;
    return {
      views: Array.isArray(parsed.views) ? parsed.views : [],
      defaultId: typeof parsed.defaultId === 'string' ? parsed.defaultId : null,
      last: parsed.last && typeof parsed.last === 'object' ? parsed.last : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveViewsStore(store: SavedViewsStore): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(VIEWS_KEY, JSON.stringify(store));
  } catch {
    /* LWS / no storage — ignore */
  }
}

/** Deterministic-enough unique id for a new view. Counter off the existing set
 *  avoids collisions without relying on wall-clock entropy. */
export function newViewId(existing: SavedView[]): string {
  let n = existing.length + 1;
  const ids = new Set(existing.map((v) => v.id));
  let id = 'view-' + n;
  while (ids.has(id)) { n += 1; id = 'view-' + n; }
  return id;
}
