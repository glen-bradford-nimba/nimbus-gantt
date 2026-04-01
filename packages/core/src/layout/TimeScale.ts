import type { ZoomLevel, HeaderCell } from '../model/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

const COLUMN_WIDTHS: Record<ZoomLevel, number> = {
  day: 40,
  week: 120,
  month: 180,
  quarter: 200,
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── TimeScale ──────────────────────────────────────────────────────────────

export class TimeScale {
  private readonly zoomLevel: ZoomLevel;
  private readonly rangeStart: Date;
  private readonly rangeEnd: Date;
  private readonly viewportWidth: number;
  private readonly columnWidth: number;
  private readonly totalMs: number;

  constructor(
    zoomLevel: ZoomLevel,
    dateRange: { start: Date; end: Date },
    viewportWidth: number,
  ) {
    this.zoomLevel = zoomLevel;
    this.rangeStart = dateRange.start;
    this.rangeEnd = dateRange.end;
    this.viewportWidth = viewportWidth;
    this.columnWidth = COLUMN_WIDTHS[zoomLevel];
    this.totalMs = this.rangeEnd.getTime() - this.rangeStart.getTime();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Convert a Date to a pixel X offset from the timeline start. */
  dateToX(date: Date): number {
    const msFromStart = date.getTime() - this.rangeStart.getTime();
    const totalWidth = this.getTotalWidth();
    return (msFromStart / this.totalMs) * totalWidth;
  }

  /** Convert a pixel X offset back to a Date (for drag operations). */
  xToDate(x: number): Date {
    const totalWidth = this.getTotalWidth();
    const ms = (x / totalWidth) * this.totalMs;
    return new Date(this.rangeStart.getTime() + ms);
  }

  /** Width of one time-unit column in pixels. */
  getColumnWidth(): number {
    return this.columnWidth;
  }

  /** Total timeline width in pixels. */
  getTotalWidth(): number {
    switch (this.zoomLevel) {
      case 'day':
        return this.countDays() * this.columnWidth;
      case 'week':
        return this.countWeeks() * this.columnWidth;
      case 'month':
        return this.countMonths() * this.columnWidth;
      case 'quarter':
        return this.countQuarters() * this.columnWidth;
    }
  }

  /**
   * Two header rows: major (top) + minor (bottom).
   * Major row groups several minor columns (e.g. months grouped by year).
   * Minor row has one cell per column unit.
   */
  getHeaderRows(): HeaderCell[][] {
    switch (this.zoomLevel) {
      case 'day':
        return this.headersDay();
      case 'week':
        return this.headersWeek();
      case 'month':
        return this.headersMonth();
      case 'quarter':
        return this.headersQuarter();
    }
  }

  /** X positions for vertical grid lines (at each minor header boundary). */
  getGridLines(): number[] {
    const minorCells = this.getHeaderRows()[1];
    // Grid line at the start of each minor cell (skip the first — that's the left edge).
    return minorCells.map((cell) => cell.x).filter((x) => x > 0);
  }

  // ── Unit counts ─────────────────────────────────────────────────────────

  private countDays(): number {
    return Math.round(this.totalMs / MS_PER_DAY);
  }

  private countWeeks(): number {
    return Math.ceil(this.totalMs / MS_PER_WEEK);
  }

  private countMonths(): number {
    const sy = this.rangeStart.getUTCFullYear();
    const sm = this.rangeStart.getUTCMonth();
    const ey = this.rangeEnd.getUTCFullYear();
    const em = this.rangeEnd.getUTCMonth();
    return (ey - sy) * 12 + (em - sm);
  }

  private countQuarters(): number {
    const sy = this.rangeStart.getUTCFullYear();
    const sq = Math.floor(this.rangeStart.getUTCMonth() / 3);
    const ey = this.rangeEnd.getUTCFullYear();
    const eq = Math.floor(this.rangeEnd.getUTCMonth() / 3);
    return (ey - sy) * 4 + (eq - sq);
  }

  // ── Header builders ─────────────────────────────────────────────────────

  /**
   * Day zoom:
   *   Major = months (e.g. "March 2026")
   *   Minor = day numbers (e.g. "1", "2", … "31")
   */
  private headersDay(): HeaderCell[][] {
    const major: HeaderCell[] = [];
    const minor: HeaderCell[] = [];

    const totalWidth = this.getTotalWidth();
    let cursor = new Date(this.rangeStart);

    // Minor: one cell per day
    for (let i = 0; i < this.countDays(); i++) {
      const x = i * this.columnWidth;
      minor.push({
        label: String(cursor.getUTCDate()),
        x,
        width: this.columnWidth,
        date: new Date(cursor),
      });
      cursor = addUTCDays(cursor, 1);
    }

    // Major: one cell per month span
    let monthStart = new Date(this.rangeStart);
    while (monthStart.getTime() < this.rangeEnd.getTime()) {
      const nextMonth = startOfNextUTCMonth(monthStart);
      const x1 = this.dateToX(monthStart);
      const x2 = nextMonth.getTime() >= this.rangeEnd.getTime()
        ? totalWidth
        : this.dateToX(nextMonth);
      major.push({
        label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
        x: x1,
        width: x2 - x1,
        date: new Date(monthStart),
      });
      monthStart = nextMonth;
    }

    return [major, minor];
  }

  /**
   * Week zoom:
   *   Major = months
   *   Minor = week start dates (e.g. "Mar 3")
   */
  private headersWeek(): HeaderCell[][] {
    const major: HeaderCell[] = [];
    const minor: HeaderCell[] = [];

    const totalWidth = this.getTotalWidth();
    const numWeeks = this.countWeeks();

    // Minor: one cell per week
    for (let i = 0; i < numWeeks; i++) {
      const weekDate = addUTCDays(this.rangeStart, i * 7);
      const x = i * this.columnWidth;
      minor.push({
        label: `${MONTH_ABBR[weekDate.getUTCMonth()]} ${weekDate.getUTCDate()}`,
        x,
        width: this.columnWidth,
        date: new Date(weekDate),
      });
    }

    // Major: months that span the range
    let monthStart = new Date(Date.UTC(
      this.rangeStart.getUTCFullYear(),
      this.rangeStart.getUTCMonth(),
      1,
    ));
    while (monthStart.getTime() < this.rangeEnd.getTime()) {
      const nextMonth = startOfNextUTCMonth(monthStart);
      const clampedStart = monthStart.getTime() < this.rangeStart.getTime()
        ? this.rangeStart
        : monthStart;
      const clampedEnd = nextMonth.getTime() > this.rangeEnd.getTime()
        ? this.rangeEnd
        : nextMonth;
      const x1 = this.dateToX(clampedStart);
      const x2 = this.dateToX(clampedEnd);
      major.push({
        label: `${MONTH_NAMES[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
        x: x1,
        width: x2 - x1,
        date: new Date(clampedStart),
      });
      monthStart = nextMonth;
    }

    return [major, minor];
  }

  /**
   * Month zoom:
   *   Major = years
   *   Minor = month names
   */
  private headersMonth(): HeaderCell[][] {
    const major: HeaderCell[] = [];
    const minor: HeaderCell[] = [];

    const totalWidth = this.getTotalWidth();
    const numMonths = this.countMonths();

    // Minor: one cell per month
    let cursor = new Date(Date.UTC(
      this.rangeStart.getUTCFullYear(),
      this.rangeStart.getUTCMonth(),
      1,
    ));
    for (let i = 0; i < numMonths; i++) {
      const x = i * this.columnWidth;
      minor.push({
        label: MONTH_ABBR[cursor.getUTCMonth()],
        x,
        width: this.columnWidth,
        date: new Date(cursor),
      });
      cursor = startOfNextUTCMonth(cursor);
    }

    // Major: one cell per year span
    let yearStart = new Date(Date.UTC(this.rangeStart.getUTCFullYear(), 0, 1));
    while (yearStart.getTime() < this.rangeEnd.getTime()) {
      const nextYear = new Date(Date.UTC(yearStart.getUTCFullYear() + 1, 0, 1));
      const clampedStart = yearStart.getTime() < this.rangeStart.getTime()
        ? this.rangeStart
        : yearStart;
      const clampedEnd = nextYear.getTime() > this.rangeEnd.getTime()
        ? this.rangeEnd
        : nextYear;
      const x1 = this.dateToX(clampedStart);
      const x2 = this.dateToX(clampedEnd);
      major.push({
        label: String(yearStart.getUTCFullYear()),
        x: x1,
        width: x2 - x1,
        date: new Date(clampedStart),
      });
      yearStart = nextYear;
    }

    return [major, minor];
  }

  /**
   * Quarter zoom:
   *   Major = years
   *   Minor = "Q1", "Q2", "Q3", "Q4"
   */
  private headersQuarter(): HeaderCell[][] {
    const major: HeaderCell[] = [];
    const minor: HeaderCell[] = [];

    const totalWidth = this.getTotalWidth();
    const numQuarters = this.countQuarters();

    // Minor: one cell per quarter
    let cursor = new Date(Date.UTC(
      this.rangeStart.getUTCFullYear(),
      Math.floor(this.rangeStart.getUTCMonth() / 3) * 3,
      1,
    ));
    for (let i = 0; i < numQuarters; i++) {
      const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
      const x = i * this.columnWidth;
      minor.push({
        label: `Q${q}`,
        x,
        width: this.columnWidth,
        date: new Date(cursor),
      });
      cursor = addUTCMonths(cursor, 3);
    }

    // Major: one cell per year span
    let yearStart = new Date(Date.UTC(this.rangeStart.getUTCFullYear(), 0, 1));
    while (yearStart.getTime() < this.rangeEnd.getTime()) {
      const nextYear = new Date(Date.UTC(yearStart.getUTCFullYear() + 1, 0, 1));
      const clampedStart = yearStart.getTime() < this.rangeStart.getTime()
        ? this.rangeStart
        : yearStart;
      const clampedEnd = nextYear.getTime() > this.rangeEnd.getTime()
        ? this.rangeEnd
        : nextYear;
      const x1 = this.dateToX(clampedStart);
      const x2 = this.dateToX(clampedEnd);
      major.push({
        label: String(yearStart.getUTCFullYear()),
        x: x1,
        width: x2 - x1,
        date: new Date(clampedStart),
      });
      yearStart = nextYear;
    }

    return [major, minor];
  }
}

// ─── UTC Date Helpers ───────────────────────────────────────────────────────

function addUTCDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function addUTCMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function startOfNextUTCMonth(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    1,
  ));
}
