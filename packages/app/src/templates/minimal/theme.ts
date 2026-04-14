/**
 * minimal/theme.ts — neutral dark-on-light theme for the minimal template.
 */
import type { ThemeTokens } from '../types';

export const minimalTheme: ThemeTokens = {
  primary: '#334155', primaryHover: '#1e293b', accent: '#475569',
  bg: '#ffffff', surface: '#ffffff', surfaceAlt: '#f8fafc',
  border: '#e5e7eb', borderSubtle: '#f1f5f9',
  textPrimary: '#0f172a', textSecondary: '#475569', textMuted: '#94a3b8', textInverse: '#ffffff',
  danger: '#ef4444', warning: '#f59e0b', success: '#10b981', info: '#3b82f6',
  fontFamily: 'sans-serif', fontFamilyMono: 'monospace',
  fontSizeBase: '13px', fontSizeSm: '11px', fontSizeXs: '10px',
  radiusSm: '4px', radiusMd: '6px', radiusLg: '8px', radiusFull: '9999px',
  spacingUnit: '4px',
  ganttGridColor: '#e5e7eb', ganttHeaderBg: '#f3f4f6', ganttWeekendBg: 'rgba(0,0,0,0.03)',
  ganttTodayLine: '#ef4444', ganttTodayBg: 'rgba(239,68,68,0.08)',
  ganttBarDefault: '#94a3b8', ganttBarTextColor: '#ffffff',
  ganttRowHoverBg: 'rgba(0,0,0,0.03)', ganttSelectionRing: '#3b82f6',
  ganttDependencyLine: '#94a3b8',
};
