import { describe, it, expect } from 'vitest';
import { renderPacingView } from './pacing';
import type { PacingData, PacingBucket } from './pacing';

// levelForecast is internal; exercise it through the public renderPacingView in a
// jsdom-free way is awkward, so we re-implement the contract check via a crafted
// PacingData fed as authoritative and read back off the DOM is overkill. Instead
// we validate the OBSERVABLE invariants by driving renderPacingView with a host
// stub and a spy on the chart. Simpler + robust: assert the math directly by
// importing the transform. To keep it unit-pure, the transform is re-exported for
// tests below.
import { __levelForecastForTest as levelForecast, __capPerBucketForTest as capPerBucket } from './pacing';

function bucket(key: string, startMs: number, actual: number, forecast: number, segs: Record<string, number>, items: Array<[string, number, string]>): PacingBucket {
  return {
    key, label: key, startMs, actual, forecast, target: 0, isPast: false, isCurrent: false,
    segments: { ...segs },
    items: items.map(([id, hours, tier]) => ({ id, name: id, hours, tier })),
  };
}

function data(buckets: PacingBucket[]): PacingData {
  return {
    buckets, bucket: 'week',
    summary: { estimatedHours: 0, loggedHours: 0, remainingHours: 0, projectedFinalHours: 0, pacingPct: 0, activeItems: 0, unscheduledHours: 0 },
    segments: [
      { id: 'greenlit', label: 'Greenlit', order: 0 },
      { id: 'ready', label: 'Ready', order: 1 },
    ],
  };
}

const sumForecast = (d: PacingData) => d.buckets.reduce((s, b) => s + b.forecast, 0);

describe('levelForecast — capacity-leveling invariants', () => {
  it('caps every bucket at the ceiling and preserves total forecast', () => {
    // One week carrying 300h of forecast, ceiling 40h → must spread over ≥8 weeks.
    const d = data([
      bucket('W1', 0, 0, 300, { greenlit: 200, ready: 100 }, [['a', 200, 'greenlit'], ['b', 100, 'ready']]),
    ]);
    const out = levelForecast(d, 40);
    for (const b of out.buckets) expect(b.actual + b.forecast).toBeLessThanOrEqual(40 + 0.5);
    expect(sumForecast(out)).toBeCloseTo(300, 0);
    expect(out.buckets.length).toBeGreaterThanOrEqual(8); // 300/40 = 7.5 → 8 buckets
  });

  it('preserves per-tier (segment) totals across the level', () => {
    const d = data([
      bucket('W1', 0, 0, 300, { greenlit: 200, ready: 100 }, [['a', 200, 'greenlit'], ['b', 100, 'ready']]),
    ]);
    const out = levelForecast(d, 40);
    const tier = (id: string) => out.buckets.reduce((s, b) => s + (b.segments?.[id] || 0), 0);
    expect(tier('greenlit')).toBeCloseTo(200, 0);
    expect(tier('ready')).toBeCloseTo(100, 0);
  });

  it('leaves actuals (past/logged) untouched in place', () => {
    const d = data([
      bucket('W0', 0, 50, 0, {}, [['done', 50, 'greenlit']]),       // past actual
      bucket('W1', 7 * 86400000, 0, 120, { greenlit: 120 }, [['a', 120, 'greenlit']]),
    ]);
    const out = levelForecast(d, 40);
    const w0 = out.buckets.find((b) => b.key === 'W0')!;
    expect(w0.actual).toBe(50);
    expect(w0.forecast).toBe(0);
  });

  it('schedules committed-tier work before ready-to-approve at the same start', () => {
    const d = data([
      bucket('W1', 0, 0, 80, { greenlit: 40, ready: 40 }, [['g', 40, 'greenlit'], ['r', 40, 'ready']]),
    ]);
    const out = levelForecast(d, 40);
    // First bucket should be all greenlit (committed front-loads); ready spills next.
    const first = out.buckets[0];
    expect(first.segments?.greenlit).toBeCloseTo(40, 0);
    expect(first.segments?.ready || 0).toBeCloseTo(0, 0);
  });

  it('is a no-op when capacity is non-positive', () => {
    const d = data([bucket('W1', 0, 0, 300, { greenlit: 300 }, [['a', 300, 'greenlit']])]);
    expect(levelForecast(d, 0)).toBe(d);
  });
});

describe('capacityPerBucket — pool → bucket ceiling', () => {
  it('scales a monthly pool to week/month/quarter and applies the pace multiplier', () => {
    expect(capPerBucket(170, 'month', 1)).toBeCloseTo(170, 0);
    expect(capPerBucket(170, 'quarter', 1)).toBeCloseTo(510, 0);
    expect(capPerBucket(170, 'week', 1)).toBeCloseTo(170 * 12 / 52, 1); // ~39.2
    expect(capPerBucket(170, 'week', 2)).toBeCloseTo(170 * 12 / 52 * 2, 1);
  });
});

// Smoke: renderPacingView is exported and callable (guards the import path).
describe('renderPacingView export', () => {
  it('is a function', () => expect(typeof renderPacingView).toBe('function'));
});
