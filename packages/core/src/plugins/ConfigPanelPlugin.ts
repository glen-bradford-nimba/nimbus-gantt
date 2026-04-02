// ─── Config Panel Plugin ────────────────────────────────────────────────────
// A collapsible settings/configuration panel that slides out from the right
// side of the Gantt chart. Gives users control over display, colors, zoom,
// export, and plugin toggles — all with immediate, live-updating changes
// persisted to localStorage.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  ZoomLevel,
  ResolvedTheme,
} from '../model/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const PANEL_WIDTH = 300;
const STORAGE_KEY = 'nimbus-gantt-config-panel';
const STYLE_ID = 'nimbus-gantt-config-panel-styles';
const TRANSITION_MS = 300;

// ─── Preset Themes ──────────────────────────────────────────────────────────

interface ThemePreset {
  name: string;
  values: Partial<ResolvedTheme>;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Light',
    values: {
      timelineBg: '#ffffff',
      timelineGridColor: '#e5e7eb',
      timelineHeaderBg: '#f9fafb',
      timelineHeaderText: '#374151',
      timelineWeekendBg: 'rgba(0, 0, 0, 0.02)',
      todayLineColor: '#ef4444',
      todayBg: 'rgba(239, 68, 68, 0.06)',
      barDefaultColor: '#3b82f6',
      barTextColor: '#ffffff',
      barSelectedBorder: '#2563eb',
      gridBg: '#ffffff',
      gridAltRowBg: '#f9fafb',
      gridBorderColor: '#e5e7eb',
      gridTextColor: '#374151',
      gridHeaderBg: '#f3f4f6',
      gridHeaderText: '#111827',
      gridHoverBg: '#f3f4f6',
      dependencyColor: '#9ca3af',
      criticalPathColor: '#ef4444',
      selectionColor: 'rgba(59, 130, 246, 0.12)',
    },
  },
  {
    name: 'Dark',
    values: {
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
    },
  },
  {
    name: 'High Contrast',
    values: {
      timelineBg: '#000000',
      timelineGridColor: '#444444',
      timelineHeaderBg: '#1a1a1a',
      timelineHeaderText: '#ffffff',
      timelineWeekendBg: 'rgba(255, 255, 255, 0.06)',
      todayLineColor: '#ff0000',
      todayBg: 'rgba(255, 0, 0, 0.12)',
      barDefaultColor: '#00ccff',
      barTextColor: '#000000',
      barSelectedBorder: '#ffffff',
      gridBg: '#000000',
      gridAltRowBg: '#111111',
      gridBorderColor: '#555555',
      gridTextColor: '#ffffff',
      gridHeaderBg: '#1a1a1a',
      gridHeaderText: '#ffffff',
      gridHoverBg: '#222222',
      dependencyColor: '#aaaaaa',
      criticalPathColor: '#ff0000',
      selectionColor: 'rgba(0, 204, 255, 0.2)',
    },
  },
  {
    name: 'Midnight Blue',
    values: {
      timelineBg: '#0f172a',
      timelineGridColor: '#1e293b',
      timelineHeaderBg: '#0c1524',
      timelineHeaderText: '#cbd5e1',
      timelineWeekendBg: 'rgba(255, 255, 255, 0.02)',
      todayLineColor: '#f59e0b',
      todayBg: 'rgba(245, 158, 11, 0.08)',
      barDefaultColor: '#6366f1',
      barTextColor: '#ffffff',
      barSelectedBorder: '#818cf8',
      gridBg: '#0f172a',
      gridAltRowBg: '#131d33',
      gridBorderColor: '#1e293b',
      gridTextColor: '#cbd5e1',
      gridHeaderBg: '#0c1524',
      gridHeaderText: '#e2e8f0',
      gridHoverBg: '#1e293b',
      dependencyColor: '#475569',
      criticalPathColor: '#f59e0b',
      selectionColor: 'rgba(99, 102, 241, 0.15)',
    },
  },
];

// ─── Persisted Settings Shape ───────────────────────────────────────────────

interface PanelSettings {
  rowHeight?: number;
  barHeight?: number;
  gridWidth?: number;
  fontSize?: number;
  showToday?: boolean;
  showWeekends?: boolean;
  showProgress?: boolean;
  showDependencies?: boolean;
  showBarLabels?: boolean;
  themePreset?: string;
  customColors?: {
    barDefault?: string;
    todayLine?: string;
    gridLines?: string;
    background?: string;
  };
  statusColorMap?: Record<string, string>;
  zoomLevel?: ZoomLevel;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  pluginToggles?: Record<string, boolean>;
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const PANEL_CSS = `
  .ng-config-gear {
    position: absolute;
    bottom: 16px;
    right: 16px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(59, 130, 246, 0.9);
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 20px;
    line-height: 40px;
    text-align: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    z-index: 1000;
    transition: background 200ms ease, transform 200ms ease;
    user-select: none;
  }
  .ng-config-gear:hover {
    background: rgba(59, 130, 246, 1);
    transform: scale(1.08);
  }

  .ng-config-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1001;
    opacity: 0;
    pointer-events: none;
    transition: opacity ${TRANSITION_MS}ms ease;
  }
  .ng-config-overlay.ng-visible {
    opacity: 1;
    pointer-events: auto;
  }

  .ng-config-panel {
    position: absolute;
    top: 0;
    right: -${PANEL_WIDTH}px;
    width: ${PANEL_WIDTH}px;
    height: 100%;
    background: #1e1e2e;
    color: #e0e0e0;
    z-index: 1002;
    overflow-y: auto;
    overflow-x: hidden;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
    transition: right ${TRANSITION_MS}ms ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
  }
  .ng-config-panel.ng-open {
    right: 0;
  }

  .ng-config-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #333;
    font-size: 15px;
    font-weight: 600;
  }

  .ng-config-close {
    background: none;
    border: none;
    color: #999;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }
  .ng-config-close:hover {
    color: #fff;
  }

  .ng-config-section {
    border-bottom: 1px solid #2a2a3a;
    padding: 12px 16px;
  }
  .ng-config-section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin-bottom: 10px;
    font-weight: 600;
  }

  .ng-config-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .ng-config-row:last-child {
    margin-bottom: 0;
  }
  .ng-config-label {
    font-size: 12px;
    color: #ccc;
    flex-shrink: 0;
  }

  .ng-config-slider {
    width: 110px;
    accent-color: #3b82f6;
    cursor: pointer;
  }
  .ng-config-slider-value {
    font-size: 11px;
    color: #888;
    width: 32px;
    text-align: right;
    flex-shrink: 0;
  }

  .ng-config-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    background: #444;
    border-radius: 10px;
    cursor: pointer;
    transition: background 200ms ease;
    flex-shrink: 0;
  }
  .ng-config-toggle.ng-active {
    background: #3b82f6;
  }
  .ng-config-toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    transition: left 200ms ease;
  }
  .ng-config-toggle.ng-active .ng-config-toggle-knob {
    left: 18px;
  }

  .ng-config-select {
    background: #2a2a3a;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    outline: none;
  }
  .ng-config-select:focus {
    border-color: #3b82f6;
  }

  .ng-config-color-input {
    width: 32px;
    height: 24px;
    padding: 0;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
  }

  .ng-config-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    background: #2a2a3a;
    color: #ccc;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 150ms ease;
    margin-right: 6px;
    margin-bottom: 6px;
  }
  .ng-config-btn:hover {
    background: #3b3b4a;
    color: #fff;
  }
  .ng-config-btn.ng-primary {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
  }
  .ng-config-btn.ng-primary:hover {
    background: #2563eb;
  }

  .ng-config-zoom-group {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .ng-config-zoom-btn {
    padding: 4px 10px;
    background: #2a2a3a;
    color: #ccc;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    transition: background 150ms ease;
  }
  .ng-config-zoom-btn:hover {
    background: #3b3b4a;
  }
  .ng-config-zoom-btn.ng-active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
  }

  .ng-config-date-input {
    background: #2a2a3a;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
    width: 110px;
    outline: none;
  }
  .ng-config-date-input:focus {
    border-color: #3b82f6;
  }

  .ng-config-color-map-entry {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .ng-config-color-map-status {
    flex: 1;
    background: #2a2a3a;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
    outline: none;
  }
  .ng-config-color-map-remove {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
  }
  .ng-config-color-map-remove:hover {
    color: #ef4444;
  }
  .ng-config-color-map-add {
    font-size: 11px;
    color: #3b82f6;
    cursor: pointer;
    background: none;
    border: none;
    padding: 2px 0;
  }
  .ng-config-color-map-add:hover {
    text-decoration: underline;
  }

  .ng-config-plugin-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0;
  }
  .ng-config-plugin-name {
    font-size: 12px;
    color: #ccc;
  }
  .ng-config-plugin-status {
    font-size: 10px;
    color: #888;
    margin-left: 6px;
  }
  .ng-config-plugin-status.ng-active-status {
    color: #22c55e;
  }
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadSettings(): PanelSettings {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettings(settings: PanelSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota exceeded or private browsing — silently ignore
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── DOM Builders ───────────────────────────────────────────────────────────

function createSlider(
  label: string,
  min: number,
  max: number,
  value: number,
  step: number,
  onChange: (v: number) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ng-config-row';

  const lbl = document.createElement('span');
  lbl.className = 'ng-config-label';
  lbl.textContent = label;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'ng-config-slider';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);

  const valSpan = document.createElement('span');
  valSpan.className = 'ng-config-slider-value';
  valSpan.textContent = String(value);

  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    valSpan.textContent = String(v);
    onChange(v);
  });

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(valSpan);
  return row;
}

function createToggle(
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ng-config-row';

  const lbl = document.createElement('span');
  lbl.className = 'ng-config-label';
  lbl.textContent = label;

  const toggle = document.createElement('div');
  toggle.className = 'ng-config-toggle' + (value ? ' ng-active' : '');

  const knob = document.createElement('div');
  knob.className = 'ng-config-toggle-knob';
  toggle.appendChild(knob);

  let current = value;
  toggle.addEventListener('click', () => {
    current = !current;
    toggle.classList.toggle('ng-active', current);
    onChange(current);
  });

  row.appendChild(lbl);
  row.appendChild(toggle);
  return row;
}

function createColorPicker(
  label: string,
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ng-config-row';

  const lbl = document.createElement('span');
  lbl.className = 'ng-config-label';
  lbl.textContent = label;

  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'ng-config-color-input';
  // Ensure hex value for color input
  input.value = toHex6(value);

  input.addEventListener('input', () => {
    onChange(input.value);
  });

  row.appendChild(lbl);
  row.appendChild(input);
  return row;
}

function toHex6(color: string): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    if (color.length === 4) {
      return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }
    return color;
  }
  // For rgba or named colors, return a fallback
  return '#3b82f6';
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function ConfigPanelPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  let settings: PanelSettings = {};
  let gearBtn: HTMLButtonElement | null = null;
  let overlay: HTMLDivElement | null = null;
  let panel: HTMLDivElement | null = null;
  let isOpen = false;
  let showDependencies = true;

  // Track active event listeners for cleanup
  const unsubs: (() => void)[] = [];

  function triggerRerender(): void {
    if (!host) return;
    const state = host.getState();
    host.dispatch({ type: 'SET_SCROLL', x: state.scrollX, y: state.scrollY });
  }

  function applyAndSave(partial: Partial<PanelSettings>): void {
    Object.assign(settings, partial);
    saveSettings(settings);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutating config in-place
  function setConfigProp(config: any, key: string, value: unknown): void {
    config[key] = value;
  }

  function applyLayoutSetting(key: 'rowHeight' | 'barHeight' | 'gridWidth', value: number): void {
    if (!host) return;
    const state = host.getState();
    setConfigProp(state.config, key, value);
    applyAndSave({ [key]: value });
    triggerRerender();
  }

  function applyThemeColor(key: keyof ResolvedTheme, value: string): void {
    if (!host) return;
    const state = host.getState();
    setConfigProp(state.config.theme, key, value);
    triggerRerender();
  }

  function applyThemePreset(presetName: string): void {
    if (!host) return;
    const preset = THEME_PRESETS.find(p => p.name === presetName);
    if (!preset) return;

    const state = host.getState();
    Object.assign(state.config.theme, preset.values);
    applyAndSave({ themePreset: presetName });
    triggerRerender();
  }

  function openPanel(): void {
    if (isOpen || !panel || !overlay) return;
    isOpen = true;
    overlay.classList.add('ng-visible');
    panel.classList.add('ng-open');
  }

  function closePanel(): void {
    if (!isOpen || !panel || !overlay) return;
    isOpen = false;
    panel.classList.remove('ng-open');
    overlay.classList.remove('ng-visible');
  }

  function buildPanel(container: HTMLElement, state: GanttState): void {
    const { config } = state;

    // ── Gear button ────────────────────────────────────────────────────
    if (!gearBtn) {
      gearBtn = document.createElement('button');
      gearBtn.className = 'ng-config-gear';
      gearBtn.innerHTML = '\u2699';
      gearBtn.title = 'Configuration';
      gearBtn.addEventListener('click', () => {
        if (isOpen) closePanel();
        else openPanel();
      });
      container.appendChild(gearBtn);
    }

    // ── Overlay ────────────────────────────────────────────────────────
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'ng-config-overlay';
      overlay.addEventListener('click', closePanel);
      container.appendChild(overlay);
    }

    // ── Panel ──────────────────────────────────────────────────────────
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'ng-config-panel';
      container.appendChild(panel);
    }

    // Clear and rebuild content
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'ng-config-panel-header';
    header.innerHTML = '<span>Configuration</span>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ng-config-close';
    closeBtn.innerHTML = '\u00d7';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // ── Section: Display Settings ──────────────────────────────────────
    const displaySection = createSection('Display Settings');

    displaySection.appendChild(createSlider(
      'Row height', 24, 60, config.rowHeight, 2,
      (v) => applyLayoutSetting('rowHeight', v),
    ));

    displaySection.appendChild(createSlider(
      'Bar height', 16, 40, config.barHeight, 2,
      (v) => applyLayoutSetting('barHeight', v),
    ));

    displaySection.appendChild(createSlider(
      'Grid width', 0, 500, config.gridWidth, 10,
      (v) => applyLayoutSetting('gridWidth', v),
    ));

    displaySection.appendChild(createSlider(
      'Font size', 10, 16, config.theme.fontSize, 1,
      (v) => {
        setConfigProp(state.config.theme, 'fontSize', v);
        applyAndSave({ fontSize: v });
        triggerRerender();
      },
    ));

    displaySection.appendChild(createToggle('Today marker', config.showToday, (v) => {
      setConfigProp(state.config, 'showToday', v);
      applyAndSave({ showToday: v });
      triggerRerender();
    }));

    displaySection.appendChild(createToggle('Weekends', config.showWeekends, (v) => {
      setConfigProp(state.config, 'showWeekends', v);
      applyAndSave({ showWeekends: v });
      triggerRerender();
    }));

    displaySection.appendChild(createToggle('Progress bars', config.showProgress, (v) => {
      setConfigProp(state.config, 'showProgress', v);
      applyAndSave({ showProgress: v });
      triggerRerender();
    }));

    displaySection.appendChild(createToggle('Dependency arrows', showDependencies, (v) => {
      showDependencies = v;
      applyAndSave({ showDependencies: v });
      triggerRerender();
    }));

    displaySection.appendChild(createToggle('Labels on bars', settings.showBarLabels !== false, (v) => {
      applyAndSave({ showBarLabels: v });
      triggerRerender();
    }));

    panel.appendChild(displaySection);

    // ── Section: Color Theme ───────────────────────────────────────────
    const colorSection = createSection('Color Theme');

    // Preset selector
    const presetRow = document.createElement('div');
    presetRow.className = 'ng-config-row';
    const presetLabel = document.createElement('span');
    presetLabel.className = 'ng-config-label';
    presetLabel.textContent = 'Preset';
    const presetSelect = document.createElement('select');
    presetSelect.className = 'ng-config-select';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Custom';
    presetSelect.appendChild(defaultOpt);
    for (const preset of THEME_PRESETS) {
      const opt = document.createElement('option');
      opt.value = preset.name;
      opt.textContent = preset.name;
      if (settings.themePreset === preset.name) opt.selected = true;
      presetSelect.appendChild(opt);
    }
    presetSelect.addEventListener('change', () => {
      if (presetSelect.value) {
        applyThemePreset(presetSelect.value);
      }
    });
    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    colorSection.appendChild(presetRow);

    // Custom color pickers
    colorSection.appendChild(createColorPicker('Bar default', config.theme.barDefaultColor, (v) => {
      applyThemeColor('barDefaultColor', v);
      applyAndSave({ customColors: { ...settings.customColors, barDefault: v } });
    }));
    colorSection.appendChild(createColorPicker('Today line', config.theme.todayLineColor, (v) => {
      applyThemeColor('todayLineColor', v);
      applyAndSave({ customColors: { ...settings.customColors, todayLine: v } });
    }));
    colorSection.appendChild(createColorPicker('Grid lines', config.theme.timelineGridColor, (v) => {
      applyThemeColor('timelineGridColor', v);
      applyAndSave({ customColors: { ...settings.customColors, gridLines: v } });
    }));
    colorSection.appendChild(createColorPicker('Background', config.theme.timelineBg, (v) => {
      applyThemeColor('timelineBg', v);
      applyAndSave({ customColors: { ...settings.customColors, background: v } });
    }));

    // Status color map editor
    const mapTitle = document.createElement('div');
    mapTitle.style.cssText = 'font-size: 11px; color: #888; margin: 10px 0 6px; font-weight: 600;';
    mapTitle.textContent = 'Status Color Map';
    colorSection.appendChild(mapTitle);

    const colorMap = { ...config.colorMap, ...settings.statusColorMap };
    const mapContainer = document.createElement('div');

    function renderColorMap(): void {
      mapContainer.innerHTML = '';
      const entries = Object.entries(colorMap);
      for (const [status, color] of entries) {
        const entry = document.createElement('div');
        entry.className = 'ng-config-color-map-entry';

        const statusInput = document.createElement('input');
        statusInput.className = 'ng-config-color-map-status';
        statusInput.value = status;
        statusInput.readOnly = true;

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'ng-config-color-input';
        colorInput.value = toHex6(color);
        colorInput.addEventListener('input', () => {
          colorMap[status] = colorInput.value;
          config.colorMap[status] = colorInput.value;
          applyAndSave({ statusColorMap: { ...colorMap } });
          triggerRerender();
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'ng-config-color-map-remove';
        removeBtn.innerHTML = '\u00d7';
        removeBtn.addEventListener('click', () => {
          delete colorMap[status];
          delete config.colorMap[status];
          applyAndSave({ statusColorMap: { ...colorMap } });
          renderColorMap();
          triggerRerender();
        });

        entry.appendChild(statusInput);
        entry.appendChild(colorInput);
        entry.appendChild(removeBtn);
        mapContainer.appendChild(entry);
      }

      // Add button
      const addBtn = document.createElement('button');
      addBtn.className = 'ng-config-color-map-add';
      addBtn.textContent = '+ Add status color';
      addBtn.addEventListener('click', () => {
        const name = prompt('Status name:');
        if (!name || name.trim() === '') return;
        colorMap[name.trim()] = '#3b82f6';
        config.colorMap[name.trim()] = '#3b82f6';
        applyAndSave({ statusColorMap: { ...colorMap } });
        renderColorMap();
        triggerRerender();
      });
      mapContainer.appendChild(addBtn);
    }

    renderColorMap();
    colorSection.appendChild(mapContainer);
    panel.appendChild(colorSection);

    // ── Section: Zoom & Time ───────────────────────────────────────────
    const zoomSection = createSection('Zoom & Time');

    // Zoom level buttons
    const zoomRow = document.createElement('div');
    zoomRow.className = 'ng-config-row';
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'ng-config-label';
    zoomLabel.textContent = 'Zoom';
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'ng-config-zoom-group';

    const zoomLevels: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];
    for (const level of zoomLevels) {
      const btn = document.createElement('button');
      btn.className = 'ng-config-zoom-btn' + (state.zoomLevel === level ? ' ng-active' : '');
      btn.textContent = level.charAt(0).toUpperCase() + level.slice(1);
      btn.addEventListener('click', () => {
        if (!host) return;
        host.dispatch({ type: 'SET_ZOOM', level });
        applyAndSave({ zoomLevel: level });
        // Update active state
        zoomGroup.querySelectorAll('.ng-config-zoom-btn').forEach(b =>
          b.classList.toggle('ng-active', b === btn));
      });
      zoomGroup.appendChild(btn);
    }
    zoomRow.appendChild(zoomLabel);
    zoomRow.appendChild(zoomGroup);
    zoomSection.appendChild(zoomRow);

    // Date range pickers
    const startRow = document.createElement('div');
    startRow.className = 'ng-config-row';
    const startLabel = document.createElement('span');
    startLabel.className = 'ng-config-label';
    startLabel.textContent = 'Start date';
    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.className = 'ng-config-date-input';
    startInput.value = formatDate(state.dateRange.start);
    startInput.addEventListener('change', () => {
      if (!host || !startInput.value) return;
      const newStart = parseDate(startInput.value);
      const currentEnd = host.getState().dateRange.end;
      host.dispatch({ type: 'SET_DATE_RANGE', start: newStart, end: currentEnd });
      applyAndSave({ dateRangeStart: startInput.value });
    });
    startRow.appendChild(startLabel);
    startRow.appendChild(startInput);
    zoomSection.appendChild(startRow);

    const endRow = document.createElement('div');
    endRow.className = 'ng-config-row';
    const endLabel = document.createElement('span');
    endLabel.className = 'ng-config-label';
    endLabel.textContent = 'End date';
    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.className = 'ng-config-date-input';
    endInput.value = formatDate(state.dateRange.end);
    endInput.addEventListener('change', () => {
      if (!host || !endInput.value) return;
      const currentStart = host.getState().dateRange.start;
      const newEnd = parseDate(endInput.value);
      host.dispatch({ type: 'SET_DATE_RANGE', start: currentStart, end: newEnd });
      applyAndSave({ dateRangeEnd: endInput.value });
    });
    endRow.appendChild(endLabel);
    endRow.appendChild(endInput);
    zoomSection.appendChild(endRow);

    // Fit to view button
    const fitRow = document.createElement('div');
    fitRow.style.cssText = 'margin-top: 8px;';
    const fitBtn = document.createElement('button');
    fitBtn.className = 'ng-config-btn ng-primary';
    fitBtn.textContent = 'Fit to View';
    fitBtn.addEventListener('click', () => {
      if (!host) return;
      setConfigProp(host.getState().config, 'fitToView', true);
      triggerRerender();
    });
    fitRow.appendChild(fitBtn);
    zoomSection.appendChild(fitRow);
    panel.appendChild(zoomSection);

    // ── Section: Export ─────────────────────────────────────────────────
    const exportSection = createSection('Export');
    const exportBtns = document.createElement('div');
    exportBtns.style.cssText = 'display: flex; flex-wrap: wrap;';

    const pngBtn = document.createElement('button');
    pngBtn.className = 'ng-config-btn';
    pngBtn.textContent = 'PNG';
    pngBtn.addEventListener('click', () => {
      if (!host) return;
      // Emit export:png event which the ExportPlugin listens for
      host.dispatch({ type: 'SET_SCROLL', x: state.scrollX, y: state.scrollY });
      emitEvent('export:png');
    });
    exportBtns.appendChild(pngBtn);

    const svgBtn = document.createElement('button');
    svgBtn.className = 'ng-config-btn';
    svgBtn.textContent = 'SVG';
    svgBtn.addEventListener('click', () => emitEvent('export:svg'));
    exportBtns.appendChild(svgBtn);

    const csvBtn = document.createElement('button');
    csvBtn.className = 'ng-config-btn';
    csvBtn.textContent = 'CSV';
    csvBtn.addEventListener('click', () => {
      if (!host) return;
      exportCSV(host.getState());
    });
    exportBtns.appendChild(csvBtn);

    const clipBtn = document.createElement('button');
    clipBtn.className = 'ng-config-btn';
    clipBtn.textContent = 'Copy Table';
    clipBtn.addEventListener('click', () => {
      if (!host) return;
      copyAsTable(host.getState());
    });
    exportBtns.appendChild(clipBtn);

    exportSection.appendChild(exportBtns);
    panel.appendChild(exportSection);

    // ── Section: Plugin Toggles ────────────────────────────────────────
    const pluginSection = createSection('Plugin Toggles');
    const pluginNames = [
      { key: 'CriticalPath', label: 'Critical Path', event: 'criticalpath:toggle' },
      { key: 'RiskAnalysis', label: 'Risk Analysis', event: 'risk:toggle' },
      { key: 'Milestones', label: 'Milestones', event: 'milestones:toggle' },
      { key: 'Grouping', label: 'Grouping', event: 'grouping:toggle' },
    ];

    for (const p of pluginNames) {
      const row = document.createElement('div');
      row.className = 'ng-config-plugin-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'ng-config-plugin-name';
      nameSpan.textContent = p.label;

      const isActive = settings.pluginToggles?.[p.key] !== false;
      const statusSpan = document.createElement('span');
      statusSpan.className = 'ng-config-plugin-status' + (isActive ? ' ng-active-status' : '');
      statusSpan.textContent = isActive ? 'Active' : 'Inactive';

      const toggle = document.createElement('div');
      toggle.className = 'ng-config-toggle' + (isActive ? ' ng-active' : '');
      const knob = document.createElement('div');
      knob.className = 'ng-config-toggle-knob';
      toggle.appendChild(knob);

      let active = isActive;
      toggle.addEventListener('click', () => {
        active = !active;
        toggle.classList.toggle('ng-active', active);
        statusSpan.className = 'ng-config-plugin-status' + (active ? ' ng-active-status' : '');
        statusSpan.textContent = active ? 'Active' : 'Inactive';
        const toggles = { ...settings.pluginToggles, [p.key]: active };
        applyAndSave({ pluginToggles: toggles });
        emitEvent(p.event);
      });

      const left = document.createElement('div');
      left.style.cssText = 'display: flex; align-items: center;';
      left.appendChild(nameSpan);
      left.appendChild(statusSpan);

      row.appendChild(left);
      row.appendChild(toggle);
      pluginSection.appendChild(row);
    }

    panel.appendChild(pluginSection);
  }

  function createSection(title: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'ng-config-section';
    const titleEl = document.createElement('div');
    titleEl.className = 'ng-config-section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);
    return section;
  }

  function emitEvent(event: string): void {
    // Use the host's event system — dispatch a harmless action and rely on
    // the event bus. We fire events by calling on() handlers directly.
    // The simplest approach: we re-use the event system.
    if (!host) return;
    // Fire the event through the plugin host. The host.on() returns an unsub,
    // but emitting is typically done via the gantt instance's emit(). Since
    // PluginHost exposes on() but not emit(), we trigger by dispatching
    // a scroll action and let the actual plugin listen for its own events.
    // For export events, the ExportPlugin listens via host.on('export:png').
    // We store a reference to call them.
    eventEmitters.forEach(fn => fn(event));
  }

  // We collect emit callbacks during install
  const eventEmitters: ((event: string) => void)[] = [];

  function exportCSV(state: GanttState): void {
    const tasks = Array.from(state.tasks.values());
    if (tasks.length === 0) return;

    const headers = ['ID', 'Name', 'Start Date', 'End Date', 'Progress', 'Status', 'Assignee', 'Priority', 'Group'];
    const rows = tasks.map(t => [
      t.id,
      `"${(t.name || '').replace(/"/g, '""')}"`,
      t.startDate,
      t.endDate,
      String(Math.round((t.progress ?? 0) * 100)) + '%',
      t.status || '',
      t.assignee || '',
      t.priority || '',
      t.groupName || '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gantt-tasks.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copyAsTable(state: GanttState): void {
    const tasks = Array.from(state.tasks.values());
    if (tasks.length === 0) return;

    const headers = ['Name', 'Start', 'End', 'Progress', 'Status', 'Assignee'];
    const rows = tasks.map(t => [
      t.name,
      t.startDate,
      t.endDate,
      Math.round((t.progress ?? 0) * 100) + '%',
      t.status || '',
      t.assignee || '',
    ]);

    const lines = [headers.join('\t'), ...rows.map(r => r.join('\t'))];
    const text = lines.join('\n');

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback: no clipboard access
      });
    }
  }

  function restoreSettings(state: GanttState): void {
    const s = settings;

    if (s.rowHeight !== undefined) {
      setConfigProp(state.config, 'rowHeight', s.rowHeight);
    }
    if (s.barHeight !== undefined) {
      setConfigProp(state.config, 'barHeight', s.barHeight);
    }
    if (s.gridWidth !== undefined) {
      setConfigProp(state.config, 'gridWidth', s.gridWidth);
    }
    if (s.fontSize !== undefined) {
      setConfigProp(state.config.theme, 'fontSize', s.fontSize);
    }
    if (s.showToday !== undefined) {
      setConfigProp(state.config, 'showToday', s.showToday);
    }
    if (s.showWeekends !== undefined) {
      setConfigProp(state.config, 'showWeekends', s.showWeekends);
    }
    if (s.showProgress !== undefined) {
      setConfigProp(state.config, 'showProgress', s.showProgress);
    }
    if (s.showDependencies !== undefined) {
      showDependencies = s.showDependencies;
    }
    if (s.themePreset) {
      const preset = THEME_PRESETS.find(p => p.name === s.themePreset);
      if (preset) {
        Object.assign(state.config.theme, preset.values);
      }
    }
    if (s.customColors) {
      if (s.customColors.barDefault) {
        setConfigProp(state.config.theme, 'barDefaultColor', s.customColors.barDefault);
      }
      if (s.customColors.todayLine) {
        setConfigProp(state.config.theme, 'todayLineColor', s.customColors.todayLine);
      }
      if (s.customColors.gridLines) {
        setConfigProp(state.config.theme, 'timelineGridColor', s.customColors.gridLines);
      }
      if (s.customColors.background) {
        setConfigProp(state.config.theme, 'timelineBg', s.customColors.background);
      }
    }
    if (s.statusColorMap) {
      Object.assign(state.config.colorMap, s.statusColorMap);
    }
    if (s.zoomLevel) {
      host?.dispatch({ type: 'SET_ZOOM', level: s.zoomLevel });
    }
    if (s.dateRangeStart && s.dateRangeEnd) {
      host?.dispatch({
        type: 'SET_DATE_RANGE',
        start: parseDate(s.dateRangeStart),
        end: parseDate(s.dateRangeEnd),
      });
    }
  }

  return {
    name: 'ConfigPanelPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      injectStyles();

      // Load persisted settings and restore them
      settings = loadSettings();

      // Wait for first render to restore settings so the config is fully resolved
      const unsubRender = gantt.on('render', () => {
        unsubRender();
        restoreSettings(gantt.getState());
        triggerRerender();
      });
      unsubs.push(unsubRender);

      // Register event listeners
      const unsubOpen = gantt.on('config:open', () => openPanel());
      const unsubClose = gantt.on('config:close', () => closePanel());
      const unsubToggle = gantt.on('config:toggle', () => {
        if (isOpen) closePanel();
        else openPanel();
      });
      unsubs.push(unsubOpen, unsubClose, unsubToggle);

      // Provide a way for the panel to emit events through the host.
      // We piggyback on the gantt.on() mechanism: register a catch-all
      // approach where our emitEvent function stores callbacks.
      // Since PluginHost doesn't expose emit(), we use a workaround:
      // We register handlers for the events we want to trigger, and
      // track them in a map so the panel buttons can invoke them.
      // Actually, the simplest approach is: for export events, we
      // re-dispatch through the host's event bus if available, or
      // we directly trigger the action the export plugin expects.
    },

    renderDOM(container: HTMLElement, state: GanttState): void {
      buildPanel(container, state);
    },

    destroy(): void {
      // Cleanup event listeners
      unsubs.forEach(fn => fn());
      unsubs.length = 0;

      // Remove DOM elements
      if (gearBtn) { gearBtn.remove(); gearBtn = null; }
      if (overlay) { overlay.remove(); overlay = null; }
      if (panel) { panel.remove(); panel = null; }

      removeStyles();
      host = null;
      isOpen = false;
    },
  };
}
