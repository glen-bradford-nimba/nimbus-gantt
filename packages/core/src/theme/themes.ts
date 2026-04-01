// ─── Default Themes & Config Resolution ─────────────────────────────────────
// Ships two built-in themes (light / dark) and a resolveConfig function that
// merges user-provided GanttConfig with sensible defaults.

import type {
  ResolvedTheme,
  ResolvedConfig,
  ColumnConfig,
  GanttConfig,
  ThemeConfig,
} from '../model/types';

// ─── Light Theme ───────────────────────────────────────────────────────────

export const LIGHT_THEME: ResolvedTheme = {
  timelineBg: '#ffffff',
  timelineGridColor: '#e5e7eb',
  timelineHeaderBg: '#f9fafb',
  timelineHeaderText: '#374151',
  timelineWeekendBg: 'rgba(0, 0, 0, 0.02)',
  todayLineColor: '#ef4444',
  todayBg: 'rgba(239, 68, 68, 0.06)',
  barDefaultColor: '#3b82f6',
  barBorderRadius: 4,
  barProgressOpacity: 0.3,
  barTextColor: '#ffffff',
  barSelectedBorder: '#1d4ed8',
  gridBg: '#ffffff',
  gridAltRowBg: '#f9fafb',
  gridBorderColor: '#e5e7eb',
  gridTextColor: '#111827',
  gridHeaderBg: '#f3f4f6',
  gridHeaderText: '#374151',
  gridHoverBg: '#f3f4f6',
  dependencyColor: '#9ca3af',
  dependencyWidth: 1.5,
  criticalPathColor: '#ef4444',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 12,
  selectionColor: 'rgba(59, 130, 246, 0.1)',
};

// ─── Dark Theme ────────────────────────────────────────────────────────────

export const DARK_THEME: ResolvedTheme = {
  timelineBg: '#1f2937',
  timelineGridColor: '#374151',
  timelineHeaderBg: '#111827',
  timelineHeaderText: '#d1d5db',
  timelineWeekendBg: 'rgba(255, 255, 255, 0.03)',
  todayLineColor: '#f87171',
  todayBg: 'rgba(248, 113, 113, 0.08)',
  barDefaultColor: '#60a5fa',
  barBorderRadius: 4,
  barProgressOpacity: 0.35,
  barTextColor: '#ffffff',
  barSelectedBorder: '#93bbfd',
  gridBg: '#1f2937',
  gridAltRowBg: '#111827',
  gridBorderColor: '#374151',
  gridTextColor: '#e5e7eb',
  gridHeaderBg: '#111827',
  gridHeaderText: '#d1d5db',
  gridHoverBg: '#374151',
  dependencyColor: '#6b7280',
  dependencyWidth: 1.5,
  criticalPathColor: '#f87171',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 12,
  selectionColor: 'rgba(96, 165, 250, 0.15)',
};

// ─── Default Columns ──────────────────────────────────────────────────────

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { field: 'name', header: 'Task', width: 200, tree: true },
  { field: 'assignee', header: 'Assignee', width: 100 },
];

// ─── Config Resolution ────────────────────────────────────────────────────

/**
 * Merge a user-provided GanttConfig with defaults to produce a fully
 * resolved configuration object. The theme can be specified as:
 *   - `'light'` (default) or `'dark'` — selects a built-in theme
 *   - A `ThemeConfig` object — merged over the light theme
 */
export function resolveConfig(userConfig: GanttConfig): ResolvedConfig {
  const baseTheme = resolveTheme(userConfig.theme);

  return {
    columns: userConfig.columns ?? DEFAULT_COLUMNS,
    zoomLevel: userConfig.zoomLevel ?? 'week',
    rowHeight: userConfig.rowHeight ?? 36,
    barHeight: userConfig.barHeight ?? 24,
    headerHeight: userConfig.headerHeight ?? 56,
    gridWidth: userConfig.gridWidth ?? 300,
    minBarWidth: userConfig.minBarWidth ?? 8,
    readOnly: userConfig.readOnly ?? false,
    fitToView: userConfig.fitToView ?? true,
    showToday: userConfig.showToday ?? true,
    showWeekends: userConfig.showWeekends ?? true,
    showProgress: userConfig.showProgress ?? true,
    snapToDays: userConfig.snapToDays ?? true,
    colorMap: userConfig.colorMap ?? {},
    theme: baseTheme,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────

function resolveTheme(
  theme: GanttConfig['theme'],
): ResolvedTheme {
  if (!theme || theme === 'light') {
    return { ...LIGHT_THEME };
  }

  if (theme === 'dark') {
    return { ...DARK_THEME };
  }

  // Custom ThemeConfig — merge over light theme
  return { ...LIGHT_THEME, ...theme };
}
