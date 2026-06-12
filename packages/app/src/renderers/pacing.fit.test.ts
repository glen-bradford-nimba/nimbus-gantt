// 0.205.0 — tests for the pure axis-fit transform (the Month/All sprawl fix,
// Cowork repro 6/11: axis stretched May 2024 → Jan 2029 with data only in 2026).
import { describe, it, expect } from 'vitest';
import { fitBucketsToData } from './pacing';
import type { PacingBucket } from './pacing';

function bucket(key: string, hours: number, opts?: Partial<PacingBucket>): PacingBucket {
  return {
    key, label: key, startMs: Date.parse(key + '-01T00:00:00Z'),
    actual: 0, forecast: hours, target: 0,
    isPast: false, isCurrent: false, items: [],
    ...opts,
  };
}
const keys = (bs: PacingBucket[]): string[] => bs.map(b => b.key);
const UNBOUNDED = { from: null, to: null };

describe('fitBucketsToData — axis-fit for unbounded windows', () => {
  it('trims empty era edges to the data extent + one pad bucket per side', () => {
    const bs = [
      bucket('2024-05', 0), bucket('2024-06', 0), bucket('2025-01', 0),
      bucket('2026-01', 10), bucket('2026-02', 25), bucket('2026-03', 5),
      bucket('2027-06', 0), bucket('2028-01', 0), bucket('2029-01', 0),
    ];
    expect(keys(fitBucketsToData(bs, UNBOUNDED)))
      .toEqual(['2025-01', '2026-01', '2026-02', '2026-03', '2027-06']);
  });

  it('keeps an empty CURRENT bucket anchored (today never disappears)', () => {
    const bs = [
      bucket('2026-01', 10), bucket('2026-02', 0),
      bucket('2026-06', 0, { isCurrent: true }),
      bucket('2027-01', 0), bucket('2028-01', 0),
    ];
    // current bucket counts as live → trailing trim keeps it + one pad.
    expect(keys(fitBucketsToData(bs, UNBOUNDED)))
      .toEqual(['2026-01', '2026-02', '2026-06', '2027-01']);
  });

  it('never trims a BOUNDED edge — the user chose that window', () => {
    const bs = [
      bucket('2026-01', 0), bucket('2026-02', 10), bucket('2026-03', 0), bucket('2026-04', 0),
    ];
    // from bounded (user picked it), to unbounded → only the tail trims.
    const fit = fitBucketsToData(bs, { from: Date.parse('2026-01-01'), to: null });
    expect(keys(fit)).toEqual(['2026-01', '2026-02', '2026-03']);
    // both bounded → untouched even with empty edges.
    expect(keys(fitBucketsToData(bs, { from: 0, to: Infinity }))).toEqual(keys(bs));
  });

  it('returns all-empty windows untouched (nothing to fit toward)', () => {
    const bs = [bucket('2026-01', 0), bucket('2026-02', 0), bucket('2026-03', 0)];
    expect(keys(fitBucketsToData(bs, UNBOUNDED))).toEqual(keys(bs));
  });

  it('leaves tiny windows (≤2 buckets) untouched', () => {
    const bs = [bucket('2024-01', 0), bucket('2026-01', 10)];
    expect(keys(fitBucketsToData(bs, UNBOUNDED))).toEqual(keys(bs));
  });

  it('treats sub-threshold rounding noise (≤0.5h) as empty', () => {
    const bs = [
      bucket('2024-01', 0.4), bucket('2026-01', 10), bucket('2029-01', 0.3),
    ];
    expect(keys(fitBucketsToData(bs, UNBOUNDED))).toEqual(['2024-01', '2026-01', '2029-01']);
    // 0.4h edges are noise, but they're also the only pad available — with a
    // wider window they'd be trimmed:
    const wide = [
      bucket('2023-01', 0.4), bucket('2024-01', 0.2), bucket('2026-01', 10),
      bucket('2028-01', 0.1), bucket('2029-01', 0.4),
    ];
    expect(keys(fitBucketsToData(wide, UNBOUNDED))).toEqual(['2024-01', '2026-01', '2028-01']);
  });

  it('target-only buckets count as live (a plan with no actuals still bounds the axis)', () => {
    const bs = [
      bucket('2024-01', 0), bucket('2026-01', 0, { target: 40 }), bucket('2029-01', 0),
    ];
    expect(keys(fitBucketsToData(bs, UNBOUNDED))).toEqual(keys(bs)); // 3 buckets: pad each side
  });
});
