import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadViewsStore, saveViewsStore, newViewId } from './savedViews';
import type { SavedView, SavedViewsStore } from './savedViews';

function mkView(id: string, name = id): SavedView {
  return { id, name, viewMode: 'gantt' };
}

describe('newViewId', () => {
  it('starts at view-1 for an empty set', () => {
    expect(newViewId([])).toBe('view-1');
  });

  it('avoids collisions with existing ids', () => {
    const existing = [mkView('view-1'), mkView('view-2'), mkView('view-3')];
    expect(newViewId(existing)).toBe('view-4');
  });

  it('skips past gaps and reused ids to stay unique', () => {
    // length+1 = 3 collides with 'view-3'; must advance to a free id.
    const existing = [mkView('view-1'), mkView('view-3')];
    const id = newViewId(existing);
    expect(existing.some((v) => v.id === id)).toBe(false);
  });
});

describe('loadViewsStore / saveViewsStore — no storage (LWS / node)', () => {
  it('returns an empty store when localStorage is unavailable', () => {
    expect(loadViewsStore()).toEqual({ views: [], defaultId: null, last: null });
  });

  it('saveViewsStore does not throw when localStorage is unavailable', () => {
    expect(() => saveViewsStore({ views: [mkView('view-1')], defaultId: null, last: null })).not.toThrow();
  });
});

describe('loadViewsStore / saveViewsStore — with storage', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { store = {}; },
      key: () => null,
      length: 0,
    } as Storage;
  });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('round-trips a full store', () => {
    const s: SavedViewsStore = {
      views: [{ id: 'view-1', name: 'Client forecast', viewMode: 'pacing', pacing: { range: 'span6' } }],
      defaultId: 'view-1',
      last: { viewMode: 'gantt', filter: 'active' },
    };
    saveViewsStore(s);
    expect(loadViewsStore()).toEqual(s);
  });

  it('degrades a corrupt payload to an empty store', () => {
    store['nga.views.v1'] = '{not valid json';
    expect(loadViewsStore()).toEqual({ views: [], defaultId: null, last: null });
  });

  it('coerces a partial/garbage payload to the store shape', () => {
    store['nga.views.v1'] = JSON.stringify({ views: 'nope', defaultId: 42 });
    expect(loadViewsStore()).toEqual({ views: [], defaultId: null, last: null });
  });
});
