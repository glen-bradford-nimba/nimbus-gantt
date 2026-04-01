// ─── Dark Theme Plugin ─────────────────────────────────────────────────────
// Provides a complete dark color scheme with smooth CSS transitions and
// automatic detection of the user's OS-level dark mode preference via
// the `prefers-color-scheme: dark` media query.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  ResolvedTheme,
} from '../model/types';

// ─── Types ────────────────────────────────────────────────────────────────

interface DarkThemeOptions {
  /** When true (default), automatically follow OS prefers-color-scheme. */
  auto?: boolean;
}

// ─── Dark Theme Colors ───────────────────────────────────────────────────

const DARK_COLORS: Partial<ResolvedTheme> = {
  timelineBg: '#1a1a2e',
  timelineGridColor: '#2d2d44',
  timelineHeaderBg: '#16213e',
  timelineHeaderText: '#e2e8f0',
  timelineWeekendBg: 'rgba(255, 255, 255, 0.03)',
  todayLineColor: '#f87171',
  todayBg: 'rgba(248, 113, 113, 0.08)',
  barDefaultColor: '#60a5fa',
  barTextColor: '#ffffff',
  barSelectedBorder: '#93c5fd',
  gridBg: '#1a1a2e',
  gridAltRowBg: '#1e1e36',
  gridBorderColor: '#2d2d44',
  gridTextColor: '#e2e8f0',
  gridHeaderBg: '#16213e',
  gridHeaderText: '#e2e8f0',
  gridHoverBg: '#2a2a42',
  dependencyColor: '#64748b',
  criticalPathColor: '#f87171',
  selectionColor: 'rgba(96, 165, 250, 0.15)',
};

// ─── Transition CSS ──────────────────────────────────────────────────────

const TRANSITION_STYLE_ID = 'nimbus-gantt-dark-theme-transition';

function injectTransitionStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TRANSITION_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TRANSITION_STYLE_ID;
  style.textContent = `
    .nimbus-gantt,
    .nimbus-gantt .ng-grid-panel,
    .nimbus-gantt .ng-timeline-panel {
      transition: background-color 300ms ease, color 300ms ease, border-color 300ms ease;
    }
    .ng-grid,
    .ng-grid-header,
    .ng-grid-body,
    .ng-grid-row,
    .ng-grid-cell {
      transition: background-color 300ms ease, color 300ms ease, border-color 300ms ease;
    }
  `;
  document.head.appendChild(style);
}

function removeTransitionStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(TRANSITION_STYLE_ID);
  if (el) el.remove();
}

// ─── Plugin Factory ─────────────────────────────────────────────────────

export function DarkThemePlugin(options?: DarkThemeOptions): NimbusGanttPlugin {
  const autoDetect = options?.auto !== false; // default true

  let host: PluginHost | null = null;
  let isDark = false;
  let savedLightTheme: ResolvedTheme | null = null;
  let mediaQuery: MediaQueryList | null = null;
  let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null;
  let unsubRender: (() => void) | null = null;

  function applyDarkTheme(): void {
    if (!host || isDark) return;

    const state = host.getState();
    // Save the current (light) theme so we can restore it
    savedLightTheme = { ...state.config.theme };

    // Apply dark colors onto the resolved theme
    const darkTheme: ResolvedTheme = {
      ...state.config.theme,
      ...DARK_COLORS,
    };

    // Mutate the config theme in-place. The store holds a reference to
    // config.theme, so updating it will take effect on the next render.
    Object.assign(state.config.theme, darkTheme);

    isDark = true;

    // Force a re-render by dispatching a no-op scroll action
    triggerRerender();
  }

  function applyLightTheme(): void {
    if (!host || !isDark || !savedLightTheme) return;

    const state = host.getState();
    Object.assign(state.config.theme, savedLightTheme);

    isDark = false;
    triggerRerender();
  }

  function toggle(): void {
    if (isDark) {
      applyLightTheme();
    } else {
      applyDarkTheme();
    }
  }

  function triggerRerender(): void {
    if (!host) return;
    const state = host.getState();
    // Dispatch a SET_SCROLL to the current position to trigger a state change and re-render
    host.dispatch({ type: 'SET_SCROLL', x: state.scrollX, y: state.scrollY });
  }

  function handleMediaChange(e: MediaQueryListEvent): void {
    if (e.matches) {
      applyDarkTheme();
    } else {
      applyLightTheme();
    }
  }

  return {
    name: 'DarkThemePlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Inject transition CSS
      injectTransitionStyles();

      // Expose control methods via events
      gantt.on('theme:toggle', () => {
        toggle();
      });

      gantt.on('theme:dark', () => {
        applyDarkTheme();
      });

      gantt.on('theme:light', () => {
        applyLightTheme();
      });

      // Auto-detect OS dark mode preference
      if (autoDetect && typeof window !== 'undefined' && window.matchMedia) {
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        // Apply immediately if the user already prefers dark mode
        if (mediaQuery.matches) {
          // Wait for first render to apply, so the light theme is captured
          unsubRender = gantt.on('render', () => {
            if (unsubRender) {
              unsubRender();
              unsubRender = null;
            }
            if (mediaQuery && mediaQuery.matches && !isDark) {
              applyDarkTheme();
            }
          });
        }

        // Watch for changes
        mediaHandler = handleMediaChange;
        mediaQuery.addEventListener('change', mediaHandler);
      }
    },

    destroy(): void {
      // Clean up media query listener
      if (mediaQuery && mediaHandler) {
        mediaQuery.removeEventListener('change', mediaHandler);
      }
      if (unsubRender) {
        unsubRender();
      }

      // Restore light theme if currently dark
      if (isDark && host && savedLightTheme) {
        const state = host.getState();
        Object.assign(state.config.theme, savedLightTheme);
      }

      // Remove transition styles
      removeTransitionStyles();

      host = null;
      savedLightTheme = null;
      mediaQuery = null;
      mediaHandler = null;
      isDark = false;
    },
  };
}
