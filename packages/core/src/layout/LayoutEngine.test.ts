import { describe, it, expect } from 'vitest';
import { LayoutEngine, parseDate } from './LayoutEngine';
import { TimeScale } from './TimeScale';
import type { GanttTask, ResolvedConfig } from '../model/types';
import { LIGHT_THEME, DEFAULT_COLUMNS } from '../theme/themes';

// ─── Helpers ──────────────────────────────────────────────────────────────

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function defaultConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    columns: DEFAULT_COLUMNS,
    zoomLevel: 'day',
    rowHeight: 36,
    barHeight: 24,
    headerHeight: 56,
    gridWidth: 300,
    minBarWidth: 8,
    readOnly: false,
    fitToView: true,
    showToday: true,
    showWeekends: true,
    showProgress: true,
    snapToDays: true,
    colorMap: {},
    theme: { ...LIGHT_THEME },
    ...overrides,
  };
}

function makeTask(id: string, name: string, extras?: Partial<GanttTask>): GanttTask {
  return {
    id,
    name,
    startDate: '2026-03-01',
    endDate: '2026-03-10',
    ...extras,
  };
}

function buildTimeScale(): TimeScale {
  return new TimeScale(
    'day',
    { start: utcDate(2026, 1, 1), end: utcDate(2026, 6, 30) },
    2000,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('LayoutEngine computeLayouts', () => {
  const engine = new LayoutEngine();

  it('produces correct number of layouts for visible tasks', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Task 1')],
      ['t2', makeTask('t2', 'Task 2')],
      ['t3', makeTask('t3', 'Task 3')],
    ]);
    const flatVisibleIds = ['t1', 't2', 't3'];
    const ts = buildTimeScale();
    const config = defaultConfig();

    const layouts = engine.computeLayouts(flatVisibleIds, tasks, ts, config);

    expect(layouts).toHaveLength(3);
  });

  it('bar x position matches TimeScale.dateToX(startDate)', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Task', { startDate: '2026-03-15', endDate: '2026-03-25' })],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig();

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    const expectedX = ts.dateToX(parseDate('2026-03-15'));
    expect(layouts[0].x).toBeCloseTo(expectedX, 5);
  });

  it('bar width = endDate x - startDate x, minimum enforced', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Normal', { startDate: '2026-03-01', endDate: '2026-03-20' })],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig();

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    const startX = ts.dateToX(parseDate('2026-03-01'));
    const endX = ts.dateToX(parseDate('2026-03-20'));
    const expectedWidth = Math.max(endX - startX, config.minBarWidth);

    expect(layouts[0].width).toBeCloseTo(expectedWidth, 5);
  });

  it('enforces minimum bar width', () => {
    // A task where start === end would produce zero width
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'ZeroLen', { startDate: '2026-03-01', endDate: '2026-03-01' })],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig({ minBarWidth: 10 });

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    expect(layouts[0].width).toBeGreaterThanOrEqual(10);
  });

  it('progress width is proportional to progress value', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Half Done', {
        startDate: '2026-03-01',
        endDate: '2026-03-11',
        progress: 0.5,
      })],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig();

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    expect(layouts[0].progressWidth).toBeCloseTo(layouts[0].width * 0.5, 5);
  });

  it('progress width is 0 when progress is undefined', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'No Progress', { startDate: '2026-03-01', endDate: '2026-03-11' })],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig();

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    expect(layouts[0].progressWidth).toBe(0);
  });

  it('color resolution: task.color takes priority', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Custom Color', {
        color: '#ff0000',
        status: 'Active',
      })],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig({ colorMap: { Active: '#00ff00' } });

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    expect(layouts[0].color).toBe('#ff0000');
  });

  it('color resolution: colorMap[status] is second priority', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Status Color', { status: 'Active' })],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig({ colorMap: { Active: '#00ff00' } });

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    expect(layouts[0].color).toBe('#00ff00');
  });

  it('color resolution: default bar color is fallback', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Default Color')],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig();

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    expect(layouts[0].color).toBe(LIGHT_THEME.barDefaultColor);
  });

  it('milestone flag is propagated', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Milestone', { isMilestone: true })],
      ['t2', makeTask('t2', 'Regular')],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig();

    const layouts = engine.computeLayouts(['t1', 't2'], tasks, ts, config);

    expect(layouts[0].isMilestone).toBe(true);
    expect(layouts[1].isMilestone).toBe(false);
  });

  it('y positions are based on rowIndex and rowHeight', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'First')],
      ['t2', makeTask('t2', 'Second')],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig({ rowHeight: 40 });

    const layouts = engine.computeLayouts(['t1', 't2'], tasks, ts, config);

    expect(layouts[0].y).toBe(0);
    expect(layouts[1].y).toBe(40);
  });

  it('barY is vertically centered within the row', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Task')],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig({ rowHeight: 40, barHeight: 20 });

    const layouts = engine.computeLayouts(['t1'], tasks, ts, config);

    // (40 - 20) / 2 = 10
    expect(layouts[0].barY).toBe(10);
  });

  it('skips tasks not found in the map', () => {
    const tasks = new Map<string, GanttTask>([
      ['t1', makeTask('t1', 'Exists')],
    ]);
    const ts = buildTimeScale();
    const config = defaultConfig();

    // flatVisibleIds references a task that doesn't exist
    const layouts = engine.computeLayouts(['t1', 'missing'], tasks, ts, config);

    expect(layouts).toHaveLength(1);
    expect(layouts[0].taskId).toBe('t1');
  });
});
