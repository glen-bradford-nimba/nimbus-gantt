import { describe, it, expect } from 'vitest';
import { resolveConfig, LIGHT_THEME, DARK_THEME, DEFAULT_COLUMNS } from './themes';
import type { GanttConfig, GanttTask } from '../model/types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function minimalConfig(overrides?: Partial<GanttConfig>): GanttConfig {
  return {
    tasks: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  it('applies all defaults when no options provided', () => {
    const config = resolveConfig(minimalConfig());

    expect(config.zoomLevel).toBe('week');
    expect(config.rowHeight).toBe(36);
    expect(config.barHeight).toBe(24);
    expect(config.headerHeight).toBe(56);
    expect(config.gridWidth).toBe(300);
    expect(config.minBarWidth).toBe(8);
    expect(config.readOnly).toBe(false);
    expect(config.fitToView).toBe(true);
    expect(config.showToday).toBe(true);
    expect(config.showWeekends).toBe(true);
    expect(config.showProgress).toBe(true);
    expect(config.snapToDays).toBe(true);
    expect(config.columns).toEqual(DEFAULT_COLUMNS);
    expect(config.colorMap).toEqual({});
  });

  it('custom values override defaults', () => {
    const config = resolveConfig(minimalConfig({
      zoomLevel: 'day',
      rowHeight: 48,
      barHeight: 32,
      readOnly: true,
      fitToView: false,
    }));

    expect(config.zoomLevel).toBe('day');
    expect(config.rowHeight).toBe(48);
    expect(config.barHeight).toBe(32);
    expect(config.readOnly).toBe(true);
    expect(config.fitToView).toBe(false);
  });
});

describe('resolveConfig colorMap', () => {
  it('custom colorMap is used as-is', () => {
    const colorMap = { Active: '#00ff00', Blocked: '#ff0000' };
    const config = resolveConfig(minimalConfig({ colorMap }));

    expect(config.colorMap).toEqual(colorMap);
  });

  it('empty colorMap by default', () => {
    const config = resolveConfig(minimalConfig());
    expect(config.colorMap).toEqual({});
  });
});

describe('resolveConfig theme', () => {
  it("theme 'light' resolves to LIGHT_THEME", () => {
    const config = resolveConfig(minimalConfig({ theme: 'light' }));

    expect(config.theme.timelineBg).toBe(LIGHT_THEME.timelineBg);
    expect(config.theme.barDefaultColor).toBe(LIGHT_THEME.barDefaultColor);
    expect(config.theme.gridBg).toBe(LIGHT_THEME.gridBg);
    expect(config.theme.criticalPathColor).toBe(LIGHT_THEME.criticalPathColor);
  });

  it("theme 'dark' resolves to DARK_THEME", () => {
    const config = resolveConfig(minimalConfig({ theme: 'dark' }));

    expect(config.theme.timelineBg).toBe(DARK_THEME.timelineBg);
    expect(config.theme.barDefaultColor).toBe(DARK_THEME.barDefaultColor);
    expect(config.theme.gridBg).toBe(DARK_THEME.gridBg);
    expect(config.theme.criticalPathColor).toBe(DARK_THEME.criticalPathColor);
  });

  it('undefined theme defaults to light', () => {
    const config = resolveConfig(minimalConfig());

    expect(config.theme.timelineBg).toBe(LIGHT_THEME.timelineBg);
    expect(config.theme.barDefaultColor).toBe(LIGHT_THEME.barDefaultColor);
  });

  it('custom ThemeConfig merges over light theme', () => {
    const config = resolveConfig(minimalConfig({
      theme: {
        barDefaultColor: '#ff5500',
        fontSize: 16,
      },
    }));

    // Custom values applied
    expect(config.theme.barDefaultColor).toBe('#ff5500');
    expect(config.theme.fontSize).toBe(16);

    // Light theme defaults preserved for non-overridden properties
    expect(config.theme.timelineBg).toBe(LIGHT_THEME.timelineBg);
    expect(config.theme.gridBg).toBe(LIGHT_THEME.gridBg);
    expect(config.theme.barBorderRadius).toBe(LIGHT_THEME.barBorderRadius);
  });

  it('resolveConfig returns a new theme object (not the same reference)', () => {
    const config1 = resolveConfig(minimalConfig({ theme: 'light' }));
    const config2 = resolveConfig(minimalConfig({ theme: 'light' }));

    // They should be deeply equal but not the same object
    expect(config1.theme).toEqual(config2.theme);
    expect(config1.theme).not.toBe(config2.theme);
    expect(config1.theme).not.toBe(LIGHT_THEME);
  });
});
