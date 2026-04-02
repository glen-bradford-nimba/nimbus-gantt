import { describe, it, expect } from 'vitest';
import { TimeScale } from './TimeScale';

// ─── Helpers ──────────────────────────────────────────────────────────────

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

// ─── dateToX / xToDate ────────────────────────────────────────────────────

describe('TimeScale dateToX', () => {
  it('returns 0 for the start date', () => {
    const start = utcDate(2026, 3, 1);
    const end = utcDate(2026, 3, 31);
    const ts = new TimeScale('day', { start, end }, 1200);

    expect(ts.dateToX(start)).toBe(0);
  });

  it('returns totalWidth for the end date', () => {
    const start = utcDate(2026, 3, 1);
    const end = utcDate(2026, 3, 31);
    const ts = new TimeScale('day', { start, end }, 1200);

    const totalWidth = ts.getTotalWidth();
    expect(ts.dateToX(end)).toBeCloseTo(totalWidth, 5);
  });

  it('returns proportional value for a midpoint date', () => {
    const start = utcDate(2026, 1, 1);
    const end = utcDate(2026, 1, 11); // 10 days
    const ts = new TimeScale('day', { start, end }, 800);
    const totalWidth = ts.getTotalWidth();

    // Day 5 = halfway
    const mid = utcDate(2026, 1, 6);
    const expected = totalWidth / 2;
    expect(ts.dateToX(mid)).toBeCloseTo(expected, 5);
  });
});

describe('TimeScale xToDate', () => {
  it('is the inverse of dateToX', () => {
    const start = utcDate(2026, 3, 1);
    const end = utcDate(2026, 3, 31);
    const ts = new TimeScale('day', { start, end }, 1200);

    const testDate = utcDate(2026, 3, 15);
    const x = ts.dateToX(testDate);
    const roundTrip = ts.xToDate(x);

    // Should be within a minute of the original due to floating point
    expect(Math.abs(roundTrip.getTime() - testDate.getTime())).toBeLessThan(60_000);
  });

  it('returns start date for x = 0', () => {
    const start = utcDate(2026, 3, 1);
    const end = utcDate(2026, 3, 31);
    const ts = new TimeScale('day', { start, end }, 1200);

    const result = ts.xToDate(0);
    expect(result.getTime()).toBe(start.getTime());
  });
});

// ─── Column widths per zoom level ─────────────────────────────────────────

describe('TimeScale column widths', () => {
  it('day zoom produces 40px columns', () => {
    const ts = new TimeScale('day', { start: utcDate(2026, 3, 1), end: utcDate(2026, 3, 31) }, 1200);
    expect(ts.getColumnWidth()).toBe(40);
  });

  it('week zoom produces 120px columns', () => {
    const ts = new TimeScale('week', { start: utcDate(2026, 3, 1), end: utcDate(2026, 3, 31) }, 1200);
    expect(ts.getColumnWidth()).toBe(120);
  });

  it('month zoom produces 180px columns', () => {
    const ts = new TimeScale('month', { start: utcDate(2026, 1, 1), end: utcDate(2026, 12, 31) }, 2000);
    expect(ts.getColumnWidth()).toBe(180);
  });

  it('quarter zoom produces 200px columns', () => {
    const ts = new TimeScale('quarter', { start: utcDate(2026, 1, 1), end: utcDate(2026, 12, 31) }, 2000);
    expect(ts.getColumnWidth()).toBe(200);
  });

  it('different zoom levels produce different total widths for same range', () => {
    const range = { start: utcDate(2026, 1, 1), end: utcDate(2026, 6, 30) };
    const dayTs = new TimeScale('day', range, 1200);
    const weekTs = new TimeScale('week', range, 1200);

    expect(dayTs.getTotalWidth()).not.toBe(weekTs.getTotalWidth());
  });
});

// ─── getHeaderRows ────────────────────────────────────────────────────────

describe('TimeScale getHeaderRows', () => {
  it('returns exactly two rows of HeaderCells', () => {
    const ts = new TimeScale('day', { start: utcDate(2026, 3, 1), end: utcDate(2026, 3, 31) }, 1200);
    const rows = ts.getHeaderRows();

    expect(rows).toHaveLength(2);
    expect(rows[0].length).toBeGreaterThan(0); // major row
    expect(rows[1].length).toBeGreaterThan(0); // minor row
  });

  it('day zoom minor row has one cell per day', () => {
    const start = utcDate(2026, 3, 1);
    const end = utcDate(2026, 3, 11); // 10 days
    const ts = new TimeScale('day', { start, end }, 1200);
    const [, minor] = ts.getHeaderRows();

    expect(minor).toHaveLength(10);
    expect(minor[0].label).toBe('1'); // March 1
  });

  it('week zoom labels include abbreviated month and day', () => {
    const start = utcDate(2026, 3, 1);
    const end = utcDate(2026, 3, 22); // 3 weeks
    const ts = new TimeScale('week', { start, end }, 1200);
    const [, minor] = ts.getHeaderRows();

    expect(minor.length).toBeGreaterThanOrEqual(3);
    expect(minor[0].label).toMatch(/Mar/);
  });

  it('month zoom minor row shows month abbreviations', () => {
    const start = utcDate(2026, 1, 1);
    const end = utcDate(2026, 4, 1); // 3 months
    const ts = new TimeScale('month', { start, end }, 1200);
    const [, minor] = ts.getHeaderRows();

    expect(minor).toHaveLength(3);
    expect(minor[0].label).toBe('Jan');
    expect(minor[1].label).toBe('Feb');
    expect(minor[2].label).toBe('Mar');
  });

  it('quarter zoom minor row shows Q1..Q4', () => {
    const start = utcDate(2026, 1, 1);
    const end = utcDate(2027, 1, 1); // 4 quarters
    const ts = new TimeScale('quarter', { start, end }, 1600);
    const [, minor] = ts.getHeaderRows();

    expect(minor).toHaveLength(4);
    expect(minor[0].label).toBe('Q1');
    expect(minor[1].label).toBe('Q2');
    expect(minor[2].label).toBe('Q3');
    expect(minor[3].label).toBe('Q4');
  });
});

// ─── getGridLines ─────────────────────────────────────────────────────────

describe('TimeScale getGridLines', () => {
  it('returns X positions that are all > 0', () => {
    const ts = new TimeScale('day', { start: utcDate(2026, 3, 1), end: utcDate(2026, 3, 11) }, 1200);
    const lines = ts.getGridLines();

    expect(lines.length).toBeGreaterThan(0);
    for (const x of lines) {
      expect(x).toBeGreaterThan(0);
    }
  });

  it('has count equal to minor cells minus 1 (first column is skipped)', () => {
    const start = utcDate(2026, 3, 1);
    const end = utcDate(2026, 3, 8); // 7 days
    const ts = new TimeScale('day', { start, end }, 1200);
    const [, minor] = ts.getHeaderRows();
    const lines = ts.getGridLines();

    // Minor cells that have x > 0
    const nonZeroMinors = minor.filter(c => c.x > 0);
    expect(lines.length).toBe(nonZeroMinors.length);
  });
});

// ─── UTC / DST safety ─────────────────────────────────────────────────────

describe('TimeScale UTC date math', () => {
  it('handles DST spring-forward boundary (March second Sunday US)', () => {
    // March 8, 2026 is a Sunday — US DST spring forward
    const start = utcDate(2026, 3, 7);
    const end = utcDate(2026, 3, 9);
    const ts = new TimeScale('day', { start, end }, 400);

    const [, minor] = ts.getHeaderRows();
    expect(minor).toHaveLength(2);
    // Each day cell should have equal width
    expect(minor[0].width).toBe(minor[1].width);
  });

  it('handles DST fall-back boundary (November first Sunday US)', () => {
    // November 1, 2026 is a Sunday — US DST fall back
    const start = utcDate(2026, 10, 31);
    const end = utcDate(2026, 11, 2);
    const ts = new TimeScale('day', { start, end }, 400);

    const [, minor] = ts.getHeaderRows();
    expect(minor).toHaveLength(2);
    expect(minor[0].width).toBe(minor[1].width);
  });
});
