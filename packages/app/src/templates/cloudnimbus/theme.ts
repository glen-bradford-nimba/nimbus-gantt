/**
 * cloudnimbus/theme.ts — ThemeTokens for the cloudnimbus template.
 * Values extracted from v10-component-spec.md (Color Constants, Theme Tokens,
 * V3_MATCH_THEME).
 */
import type { ThemeTokens } from '../types';

export const cloudnimbusTheme: ThemeTokens = {
  // Brand
  primary:       '#2563eb', // blue-600
  primaryHover:  '#1d4ed8', // blue-700
  accent:        '#7c3aed', // violet-600

  // Surfaces
  bg:            '#f8fafc', // slate-50
  surface:       '#ffffff',
  surfaceAlt:    '#f1f5f9', // slate-100
  border:        '#e2e8f0', // slate-200
  borderSubtle:  '#f1f5f9', // slate-100

  // Text
  textPrimary:   '#0f172a', // slate-900
  textSecondary: '#475569', // slate-600
  textMuted:     '#94a3b8', // slate-400
  textInverse:   '#ffffff',

  // Semantic
  danger:        '#ef4444', // red-500
  warning:       '#f59e0b', // amber-500
  success:       '#10b981', // emerald-500
  info:          '#3b82f6', // blue-500

  // Typography
  fontFamily:      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMono:  "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
  fontSizeBase:    '12px',
  fontSizeSm:      '10px',
  fontSizeXs:      '9px',

  // Radii
  radiusSm:   '4px',
  radiusMd:   '6px',
  radiusLg:   '12px',
  radiusFull: '9999px',

  spacingUnit: '4px',

  // Gantt-specific (V3_MATCH_THEME verbatim)
  ganttGridColor:      '#e5e7eb',
  ganttHeaderBg:       '#f3f4f6',
  ganttWeekendBg:      'rgba(229,231,235,0.4)',
  ganttTodayLine:      '#ef4444',
  ganttTodayBg:        'rgba(239,68,68,0.08)',
  ganttBarDefault:     '#94a3b8',
  ganttBarTextColor:   '#ffffff',
  ganttRowHoverBg:     'rgba(59,130,246,0.04)',
  ganttSelectionRing:  '#3b82f6',
  ganttDependencyLine: '#3b82f6',
};
