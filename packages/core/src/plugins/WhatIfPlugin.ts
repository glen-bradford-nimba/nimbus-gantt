// ─── What-If Sandbox Plugin ─────────────────────────────────────────────────
// Fork the schedule, make hypothetical changes, compare side-by-side with
// reality. Supports multiple named scenarios, visual diffing with baseline
// ghost bars, and a summary panel showing project-level impact.
//
// Events:
//   whatif:enter   — enter sandbox mode (snapshot current state as baseline)
//   whatif:exit    — exit sandbox, restore baseline
//   whatif:save    — save current sandbox as a named scenario
//   whatif:load    — load a previously saved scenario by ID
//   whatif:compare — toggle comparison overlay (baseline vs sandbox)
//   whatif:list-scenarios  — list all saved scenarios (fires callback)
//   whatif:delete-scenario — delete a scenario by ID
//   whatif:discard — discard sandbox changes, reset to baseline

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  GanttDependency,
  TaskLayout,
  Action,
} from '../model/types';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface WhatIfScenario {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  changes: WhatIfChange[];
  result?: {
    projectFinish: string;
    criticalPathDelta: number; // days difference from baseline
    tasksAffected: number;
  };
}

export interface WhatIfChange {
  type:
    | 'move'
    | 'resize'
    | 'add'
    | 'remove'
    | 'reassign'
    | 'add-dependency'
    | 'remove-dependency';
  taskId?: string;
  before?: Partial<GanttTask>;
  after?: Partial<GanttTask>;
  dependencyId?: string;
  dependency?: { source: string; target: string; type?: string };
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const MAX_SCENARIOS = 10;
const STYLE_ID = 'nimbus-gantt-whatif-styles';

const GHOST_OPACITY = 0.25;
const GHOST_HEIGHT_RATIO = 0.6;
const ARROW_HEAD_SIZE = 6;

const IMPROVED_COLOR = '#38A169';   // Green — earlier finish
const WORSENED_COLOR = '#E53E3E';   // Red — later finish
const UNCHANGED_COLOR = '#A0AEC0';  // Gray

const BANNER_HEIGHT = 36;
const BANNER_BG = '#F6AD55';        // Orange
const BANNER_TEXT = '#1a202c';
const PANEL_WIDTH = 280;

// ─── CSS ───────────────────────────────────────────────────────────────────

const WHATIF_CSS = `
  .ng-whatif-banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: ${BANNER_HEIGHT}px;
    background: ${BANNER_BG};
    color: ${BANNER_TEXT};
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    font-weight: 600;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    user-select: none;
    transition: opacity 200ms ease;
  }
  .ng-whatif-banner.ng-hidden {
    opacity: 0;
    pointer-events: none;
    height: 0;
    overflow: hidden;
  }
  .ng-whatif-banner-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ng-whatif-badge {
    background: rgba(0, 0, 0, 0.15);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .ng-whatif-change-count {
    font-weight: 400;
    font-size: 12px;
    opacity: 0.8;
  }
  .ng-whatif-banner-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ng-whatif-btn {
    border: none;
    background: rgba(0, 0, 0, 0.1);
    color: ${BANNER_TEXT};
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 150ms ease;
  }
  .ng-whatif-btn:hover {
    background: rgba(0, 0, 0, 0.2);
  }
  .ng-whatif-btn--danger {
    background: rgba(229, 62, 62, 0.2);
    color: #9B2C2C;
  }
  .ng-whatif-btn--danger:hover {
    background: rgba(229, 62, 62, 0.35);
  }
  .ng-whatif-btn--primary {
    background: rgba(49, 130, 206, 0.2);
    color: #2B6CB0;
  }
  .ng-whatif-btn--primary:hover {
    background: rgba(49, 130, 206, 0.35);
  }

  .ng-whatif-save-input {
    display: none;
    align-items: center;
    gap: 4px;
  }
  .ng-whatif-save-input.ng-active {
    display: flex;
  }
  .ng-whatif-save-input input {
    width: 140px;
    padding: 3px 6px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 3px;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.9);
    color: #1a202c;
    outline: none;
  }
  .ng-whatif-save-input input:focus {
    border-color: #3182ce;
    box-shadow: 0 0 0 2px rgba(49, 130, 206, 0.3);
  }

  .ng-whatif-panel {
    position: absolute;
    top: ${BANNER_HEIGHT}px;
    left: 0;
    bottom: 0;
    width: ${PANEL_WIDTH}px;
    background: rgba(26, 32, 44, 0.97);
    border-right: 1px solid #2d3748;
    z-index: 950;
    transform: translateX(-100%);
    transition: transform 250ms ease;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #e2e8f0;
    padding: 16px;
  }
  .ng-whatif-panel.ng-open {
    transform: translateX(0);
  }
  .ng-whatif-panel-title {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ng-whatif-panel-close {
    border: none;
    background: none;
    color: #a0aec0;
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .ng-whatif-panel-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  .ng-whatif-scenario-card {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid #2d3748;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 150ms ease, background 150ms ease;
  }
  .ng-whatif-scenario-card:hover {
    border-color: #4a5568;
    background: rgba(255, 255, 255, 0.08);
  }
  .ng-whatif-scenario-name {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }
  .ng-whatif-scenario-meta {
    font-size: 11px;
    color: #a0aec0;
    display: flex;
    gap: 8px;
  }
  .ng-whatif-scenario-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .ng-whatif-scenario-btn {
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: #a0aec0;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
  }
  .ng-whatif-scenario-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #e2e8f0;
  }
  .ng-whatif-scenario-btn--delete:hover {
    background: rgba(229, 62, 62, 0.3);
    color: #fc8181;
  }
  .ng-whatif-empty {
    font-size: 12px;
    color: #718096;
    text-align: center;
    padding: 20px 0;
  }

  .ng-whatif-summary {
    position: absolute;
    top: ${BANNER_HEIGHT + 8}px;
    right: 12px;
    background: rgba(26, 32, 44, 0.95);
    border: 1px solid #2d3748;
    border-radius: 8px;
    padding: 12px 16px;
    z-index: 960;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    color: #e2e8f0;
    min-width: 240px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    transition: opacity 200ms ease, transform 200ms ease;
  }
  .ng-whatif-summary.ng-hidden {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-8px);
  }
  .ng-whatif-summary-title {
    font-weight: 700;
    font-size: 13px;
    margin-bottom: 8px;
  }
  .ng-whatif-summary-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .ng-whatif-summary-row:last-child {
    border-bottom: none;
  }
  .ng-whatif-summary-label {
    color: #a0aec0;
  }
  .ng-whatif-summary-value {
    font-weight: 600;
  }
  .ng-whatif-summary-value--improved {
    color: ${IMPROVED_COLOR};
  }
  .ng-whatif-summary-value--worsened {
    color: ${WORSENED_COLOR};
  }
  .ng-whatif-summary-value--unchanged {
    color: ${UNCHANGED_COLOR};
  }
`;

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDate(dateStr: string): string {
  const date = parseDate(dateStr);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function generateId(): string {
  return 'wi_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function cloneTask(task: GanttTask): GanttTask {
  return { ...task, metadata: task.metadata ? { ...task.metadata } : undefined };
}

function cloneDependency(dep: GanttDependency): GanttDependency {
  return { ...dep };
}

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = WHATIF_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── Baseline Snapshot ─────────────────────────────────────────────────────

interface BaselineSnapshot {
  tasks: Map<string, GanttTask>;
  dependencies: Map<string, GanttDependency>;
  projectFinish: string;
}

function snapshotBaseline(state: GanttState): BaselineSnapshot {
  const tasks = new Map<string, GanttTask>();
  for (const [id, task] of state.tasks) {
    tasks.set(id, cloneTask(task));
  }
  const dependencies = new Map<string, GanttDependency>();
  for (const [id, dep] of state.dependencies) {
    dependencies.set(id, cloneDependency(dep));
  }
  // Compute project finish as the latest end date
  let latest = '';
  for (const task of tasks.values()) {
    if (!latest || task.endDate > latest) {
      latest = task.endDate;
    }
  }
  return { tasks, dependencies, projectFinish: latest };
}

function computeProjectFinish(tasks: Map<string, GanttTask>): string {
  let latest = '';
  for (const task of tasks.values()) {
    if (!latest || task.endDate > latest) {
      latest = task.endDate;
    }
  }
  return latest;
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function WhatIfPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;

  // ── State ────────────────────────────────────────────────────────────────
  let sandboxActive = false;
  let compareActive = false;
  let panelOpen = false;
  let saveInputActive = false;

  let baseline: BaselineSnapshot | null = null;
  let changes: WhatIfChange[] = [];
  let scenarios: WhatIfScenario[] = [];

  const unsubs: (() => void)[] = [];

  // ── DOM references ───────────────────────────────────────────────────────
  let bannerEl: HTMLDivElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let summaryEl: HTMLDivElement | null = null;
  let changeCountEl: HTMLSpanElement | null = null;
  let saveInputContainer: HTMLDivElement | null = null;
  let saveInput: HTMLInputElement | null = null;
  let scenarioListEl: HTMLDivElement | null = null;

  // ── Sandbox Lifecycle ────────────────────────────────────────────────────

  function enterSandbox(): void {
    if (sandboxActive || !host) return;
    baseline = snapshotBaseline(host.getState());
    changes = [];
    sandboxActive = true;
    compareActive = false;
    updateBannerVisibility();
  }

  function exitSandbox(): void {
    if (!sandboxActive || !host || !baseline) return;
    // Restore baseline state
    host.dispatch({
      type: 'SET_DATA',
      tasks: Array.from(baseline.tasks.values()),
      dependencies: Array.from(baseline.dependencies.values()),
    });
    sandboxActive = false;
    compareActive = false;
    baseline = null;
    changes = [];
    updateBannerVisibility();
    hideSummary();
    closePanelEl();
  }

  function discardChanges(): void {
    if (!sandboxActive || !host || !baseline) return;
    // Reset to baseline but stay in sandbox mode
    host.dispatch({
      type: 'SET_DATA',
      tasks: Array.from(baseline.tasks.values()),
      dependencies: Array.from(baseline.dependencies.values()),
    });
    changes = [];
    compareActive = false;
    updateChangeCount();
    hideSummary();
  }

  // ── Scenario Management ──────────────────────────────────────────────────

  function saveScenario(name: string): void {
    if (!sandboxActive || !host || !baseline) return;
    if (scenarios.length >= MAX_SCENARIOS) {
      // Remove the oldest
      scenarios.shift();
    }

    const state = host.getState();
    const sandboxFinish = computeProjectFinish(state.tasks);
    const baselineFinishDate = parseDate(baseline.projectFinish);
    const sandboxFinishDate = parseDate(sandboxFinish);
    const delta = diffDays(baselineFinishDate, sandboxFinishDate);

    // Count affected tasks
    let tasksAffected = 0;
    for (const [id, baseTask] of baseline.tasks) {
      const currentTask = state.tasks.get(id);
      if (!currentTask) {
        tasksAffected++;
        continue;
      }
      if (
        currentTask.startDate !== baseTask.startDate ||
        currentTask.endDate !== baseTask.endDate ||
        currentTask.assignee !== baseTask.assignee
      ) {
        tasksAffected++;
      }
    }
    // Count added tasks
    for (const id of state.tasks.keys()) {
      if (!baseline.tasks.has(id)) {
        tasksAffected++;
      }
    }

    const scenario: WhatIfScenario = {
      id: generateId(),
      name,
      createdAt: Date.now(),
      changes: [...changes],
      result: {
        projectFinish: sandboxFinish,
        criticalPathDelta: delta,
        tasksAffected,
      },
    };
    scenarios.push(scenario);
    renderScenarioList();
  }

  function loadScenario(scenarioId: string): void {
    if (!host || !baseline) return;
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return;

    // Ensure we are in sandbox mode
    if (!sandboxActive) {
      enterSandbox();
    }

    // Restore baseline first
    host.dispatch({
      type: 'SET_DATA',
      tasks: Array.from(baseline.tasks.values()),
      dependencies: Array.from(baseline.dependencies.values()),
    });

    // Replay changes
    for (const change of scenario.changes) {
      applyChange(change);
    }

    changes = [...scenario.changes];
    updateChangeCount();
  }

  function deleteScenario(scenarioId: string): void {
    scenarios = scenarios.filter((s) => s.id !== scenarioId);
    renderScenarioList();
  }

  function applyChange(change: WhatIfChange): void {
    if (!host) return;
    switch (change.type) {
      case 'move':
      case 'resize':
        if (change.taskId && change.after) {
          if (change.after.startDate && change.after.endDate) {
            host.dispatch({
              type: change.type === 'move' ? 'TASK_MOVE' : 'TASK_RESIZE',
              taskId: change.taskId,
              startDate: change.after.startDate,
              endDate: change.after.endDate,
            });
          }
        }
        break;
      case 'add':
        if (change.after) {
          host.dispatch({
            type: 'ADD_TASK',
            task: change.after as GanttTask,
          });
        }
        break;
      case 'remove':
        if (change.taskId) {
          host.dispatch({ type: 'REMOVE_TASK', taskId: change.taskId });
        }
        break;
      case 'reassign':
        if (change.taskId && change.after) {
          host.dispatch({
            type: 'UPDATE_TASK',
            taskId: change.taskId,
            changes: change.after,
          });
        }
        break;
      case 'add-dependency':
        if (change.dependency) {
          host.dispatch({
            type: 'ADD_DEPENDENCY',
            dependency: {
              id: change.dependencyId || generateId(),
              source: change.dependency.source,
              target: change.dependency.target,
              type: (change.dependency.type as GanttDependency['type']) || 'FS',
            },
          });
        }
        break;
      case 'remove-dependency':
        if (change.dependencyId) {
          host.dispatch({
            type: 'REMOVE_DEPENDENCY',
            dependencyId: change.dependencyId,
          });
        }
        break;
    }
  }

  // ── Comparison ───────────────────────────────────────────────────────────

  function toggleCompare(): void {
    if (!sandboxActive) return;
    compareActive = !compareActive;
    if (compareActive) {
      showSummary();
    } else {
      hideSummary();
    }
  }

  function buildSummary(): {
    baselineFinish: string;
    sandboxFinish: string;
    deltaDays: number;
    tasksAffected: number;
  } {
    if (!host || !baseline) {
      return { baselineFinish: '', sandboxFinish: '', deltaDays: 0, tasksAffected: 0 };
    }
    const state = host.getState();
    const sandboxFinish = computeProjectFinish(state.tasks);
    const baselineFinishDate = parseDate(baseline.projectFinish);
    const sandboxFinishDate = parseDate(sandboxFinish);
    const deltaDays = diffDays(baselineFinishDate, sandboxFinishDate);

    let tasksAffected = 0;
    for (const [id, baseTask] of baseline.tasks) {
      const currentTask = state.tasks.get(id);
      if (!currentTask) {
        tasksAffected++;
        continue;
      }
      if (
        currentTask.startDate !== baseTask.startDate ||
        currentTask.endDate !== baseTask.endDate ||
        currentTask.assignee !== baseTask.assignee
      ) {
        tasksAffected++;
      }
    }
    for (const id of state.tasks.keys()) {
      if (!baseline.tasks.has(id)) tasksAffected++;
    }

    return { baselineFinish: baseline.projectFinish, sandboxFinish, deltaDays, tasksAffected };
  }

  // ── DOM Helpers ──────────────────────────────────────────────────────────

  function updateBannerVisibility(): void {
    if (bannerEl) {
      bannerEl.classList.toggle('ng-hidden', !sandboxActive);
    }
  }

  function updateChangeCount(): void {
    if (changeCountEl) {
      changeCountEl.textContent = `${changes.length} change${changes.length !== 1 ? 's' : ''} made`;
    }
  }

  function showSummary(): void {
    if (!summaryEl) return;
    const summary = buildSummary();

    let deltaClass = 'ng-whatif-summary-value--unchanged';
    let deltaText = 'No change';
    if (summary.deltaDays < 0) {
      deltaClass = 'ng-whatif-summary-value--improved';
      deltaText = `${Math.abs(summary.deltaDays)} day${Math.abs(summary.deltaDays) !== 1 ? 's' : ''} earlier`;
    } else if (summary.deltaDays > 0) {
      deltaClass = 'ng-whatif-summary-value--worsened';
      deltaText = `${summary.deltaDays} day${summary.deltaDays !== 1 ? 's' : ''} later`;
    }

    summaryEl.innerHTML = `
      <div class="ng-whatif-summary-title">Comparison Summary</div>
      <div class="ng-whatif-summary-row">
        <span class="ng-whatif-summary-label">Project finish</span>
        <span class="ng-whatif-summary-value">
          ${formatShortDate(summary.baselineFinish)} &rarr; ${formatShortDate(summary.sandboxFinish)}
        </span>
      </div>
      <div class="ng-whatif-summary-row">
        <span class="ng-whatif-summary-label">Schedule impact</span>
        <span class="ng-whatif-summary-value ${deltaClass}">${deltaText}</span>
      </div>
      <div class="ng-whatif-summary-row">
        <span class="ng-whatif-summary-label">Tasks affected</span>
        <span class="ng-whatif-summary-value">${summary.tasksAffected}</span>
      </div>
    `;
    summaryEl.classList.remove('ng-hidden');
  }

  function hideSummary(): void {
    if (summaryEl) {
      summaryEl.classList.add('ng-hidden');
    }
  }

  function togglePanel(): void {
    panelOpen = !panelOpen;
    if (panelEl) {
      panelEl.classList.toggle('ng-open', panelOpen);
    }
    if (panelOpen) {
      renderScenarioList();
    }
  }

  function closePanelEl(): void {
    panelOpen = false;
    if (panelEl) {
      panelEl.classList.remove('ng-open');
    }
  }

  function showSaveInput(): void {
    saveInputActive = true;
    if (saveInputContainer) {
      saveInputContainer.classList.add('ng-active');
      saveInput?.focus();
    }
  }

  function hideSaveInput(): void {
    saveInputActive = false;
    if (saveInputContainer) {
      saveInputContainer.classList.remove('ng-active');
    }
    if (saveInput) {
      saveInput.value = '';
    }
  }

  function handleSaveConfirm(): void {
    if (!saveInput) return;
    const name = saveInput.value.trim();
    if (!name) return;
    saveScenario(name);
    hideSaveInput();
  }

  function renderScenarioList(): void {
    if (!scenarioListEl) return;

    if (scenarios.length === 0) {
      scenarioListEl.innerHTML =
        '<div class="ng-whatif-empty">No saved scenarios yet</div>';
      return;
    }

    scenarioListEl.innerHTML = scenarios
      .map((s) => {
        const dateStr = new Date(s.createdAt).toLocaleDateString();
        const delta = s.result?.criticalPathDelta ?? 0;
        let impactLabel = 'No impact';
        if (delta < 0) impactLabel = `${Math.abs(delta)}d earlier`;
        else if (delta > 0) impactLabel = `${delta}d later`;

        return `
          <div class="ng-whatif-scenario-card" data-scenario-id="${s.id}">
            <div class="ng-whatif-scenario-name">${escapeHtml(s.name)}</div>
            <div class="ng-whatif-scenario-meta">
              <span>${dateStr}</span>
              <span>${s.changes.length} changes</span>
              <span>${impactLabel}</span>
            </div>
            <div class="ng-whatif-scenario-actions">
              <button class="ng-whatif-scenario-btn" data-action="load" data-id="${s.id}">Load</button>
              <button class="ng-whatif-scenario-btn" data-action="compare" data-id="${s.id}">Compare</button>
              <button class="ng-whatif-scenario-btn ng-whatif-scenario-btn--delete" data-action="delete" data-id="${s.id}">Delete</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function handleScenarioAction(e: Event): void {
    const target = e.target as HTMLElement;
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');
    if (!action || !id) return;

    switch (action) {
      case 'load':
        loadScenario(id);
        closePanelEl();
        break;
      case 'compare':
        loadScenario(id);
        compareActive = true;
        showSummary();
        closePanelEl();
        break;
      case 'delete':
        deleteScenario(id);
        break;
    }
  }

  // ── Action → Change Tracking ─────────────────────────────────────────────

  function recordChange(action: Action, stateBefore: GanttState): void {
    switch (action.type) {
      case 'TASK_MOVE': {
        const beforeTask = stateBefore.tasks.get(action.taskId);
        if (beforeTask) {
          changes.push({
            type: 'move',
            taskId: action.taskId,
            before: { startDate: beforeTask.startDate, endDate: beforeTask.endDate },
            after: { startDate: action.startDate, endDate: action.endDate },
          });
        }
        break;
      }
      case 'TASK_RESIZE': {
        const beforeTask = stateBefore.tasks.get(action.taskId);
        if (beforeTask) {
          changes.push({
            type: 'resize',
            taskId: action.taskId,
            before: { startDate: beforeTask.startDate, endDate: beforeTask.endDate },
            after: { startDate: action.startDate, endDate: action.endDate },
          });
        }
        break;
      }
      case 'ADD_TASK':
        changes.push({
          type: 'add',
          taskId: action.task.id,
          after: { ...action.task },
        });
        break;
      case 'REMOVE_TASK':
        changes.push({
          type: 'remove',
          taskId: action.taskId,
          before: stateBefore.tasks.get(action.taskId)
            ? { ...stateBefore.tasks.get(action.taskId)! }
            : undefined,
        });
        break;
      case 'UPDATE_TASK': {
        const beforeTask = stateBefore.tasks.get(action.taskId);
        if (beforeTask) {
          changes.push({
            type: 'reassign',
            taskId: action.taskId,
            before: { ...beforeTask },
            after: action.changes,
          });
        }
        break;
      }
      case 'ADD_DEPENDENCY':
        changes.push({
          type: 'add-dependency',
          dependencyId: action.dependency.id,
          dependency: {
            source: action.dependency.source,
            target: action.dependency.target,
            type: action.dependency.type,
          },
        });
        break;
      case 'REMOVE_DEPENDENCY':
        changes.push({
          type: 'remove-dependency',
          dependencyId: action.dependencyId,
        });
        break;
    }
    updateChangeCount();
  }

  // ── Rounded Rect Helper ──────────────────────────────────────────────────

  function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Plugin Object
  // ════════════════════════════════════════════════════════════════════════

  return {
    name: 'WhatIfPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      injectStyles();

      unsubs.push(gantt.on('whatif:enter', () => enterSandbox()));
      unsubs.push(gantt.on('whatif:exit', () => exitSandbox()));
      unsubs.push(gantt.on('whatif:compare', () => toggleCompare()));
      unsubs.push(gantt.on('whatif:discard', () => discardChanges()));
      unsubs.push(
        gantt.on('whatif:save', (...args: unknown[]) => {
          const name = typeof args[0] === 'string' ? args[0] : undefined;
          if (name) {
            saveScenario(name);
          } else {
            showSaveInput();
          }
        }),
      );
      unsubs.push(
        gantt.on('whatif:load', (...args: unknown[]) => {
          const id = typeof args[0] === 'string' ? args[0] : undefined;
          if (id) {
            loadScenario(id);
          } else {
            togglePanel();
          }
        }),
      );
      unsubs.push(
        gantt.on('whatif:list-scenarios', (...args: unknown[]) => {
          const callback = typeof args[0] === 'function' ? args[0] : undefined;
          if (callback) {
            callback([...scenarios]);
          } else {
            togglePanel();
          }
        }),
      );
      unsubs.push(
        gantt.on('whatif:delete-scenario', (...args: unknown[]) => {
          const id = typeof args[0] === 'string' ? args[0] : undefined;
          if (id) deleteScenario(id);
        }),
      );
    },

    middleware(action: Action, next: (action: Action) => void): void {
      if (!sandboxActive) {
        next(action);
        return;
      }

      // Track mutating actions as WhatIfChanges
      const trackedTypes: Action['type'][] = [
        'TASK_MOVE',
        'TASK_RESIZE',
        'ADD_TASK',
        'REMOVE_TASK',
        'UPDATE_TASK',
        'ADD_DEPENDENCY',
        'REMOVE_DEPENDENCY',
      ];

      if (trackedTypes.includes(action.type) && host) {
        const stateBefore = host.getState();
        recordChange(action, stateBefore);
      }

      next(action);
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!sandboxActive || !host) return;

      const { theme, headerHeight, barHeight } = state.config;
      const scrollX = state.scrollX;
      const scrollY = state.scrollY;
      const bodyTop = headerHeight;
      const timeScale = host.getTimeScale();
      const radius = theme.barBorderRadius;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bodyTop, ctx.canvas.width, ctx.canvas.height - bodyTop);
      ctx.clip();
      ctx.translate(-scrollX, 0);

      // ── Draw dashed borders on modified tasks ────────────────────────
      if (baseline) {
        const modifiedTaskIds = new Set<string>();
        for (const layout of layouts) {
          const baseTask = baseline.tasks.get(layout.taskId);
          const currentTask = state.tasks.get(layout.taskId);
          if (!baseTask && currentTask) {
            // Added task
            modifiedTaskIds.add(layout.taskId);
          } else if (baseTask && currentTask) {
            if (
              baseTask.startDate !== currentTask.startDate ||
              baseTask.endDate !== currentTask.endDate ||
              baseTask.assignee !== currentTask.assignee
            ) {
              modifiedTaskIds.add(layout.taskId);
            }
          }
        }

        for (const layout of layouts) {
          if (!modifiedTaskIds.has(layout.taskId)) continue;

          const barX = layout.x;
          const barY = layout.barY - scrollY;
          const barW = layout.width;
          const barH = layout.barHeight;

          if (barY + barH < bodyTop || barY > ctx.canvas.height) continue;

          // Dashed border
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = '#F6AD55';
          ctx.lineWidth = 2;
          drawRoundedRect(ctx, barX, barY, barW, barH, radius);
          ctx.stroke();
          ctx.restore();
        }
      }

      // ── Comparison overlay: baseline ghost bars + arrows ─────────────
      if (compareActive && baseline) {
        const ghostH = barHeight * GHOST_HEIGHT_RATIO;

        for (const layout of layouts) {
          if (layout.isMilestone) continue;

          const baseTask = baseline.tasks.get(layout.taskId);
          if (!baseTask) continue; // Task was added in sandbox

          const currentTask = state.tasks.get(layout.taskId);
          if (!currentTask) continue;

          const baseStart = parseDate(baseTask.startDate);
          const baseEnd = parseDate(baseTask.endDate);
          const curStart = parseDate(currentTask.startDate);
          const curEnd = parseDate(currentTask.endDate);

          const startDelta = diffDays(baseStart, curStart);
          const endDelta = diffDays(baseEnd, curEnd);

          // Skip unchanged tasks
          if (startDelta === 0 && endDelta === 0) continue;

          // Determine color: green = improved (earlier), red = worsened
          let tintColor = UNCHANGED_COLOR;
          if (endDelta < 0) {
            tintColor = IMPROVED_COLOR;
          } else if (endDelta > 0) {
            tintColor = WORSENED_COLOR;
          }

          // ── Ghost bar at baseline position ──────────────────────────
          const ghostX = timeScale.dateToX(baseStart);
          const ghostEndX = timeScale.dateToX(baseEnd);
          const ghostW = Math.max(ghostEndX - ghostX, 2);
          const barY = layout.barY - scrollY;
          const ghostY = barY + barHeight + 2;

          ctx.save();
          ctx.globalAlpha = GHOST_OPACITY;
          ctx.fillStyle = tintColor;
          drawRoundedRect(ctx, ghostX, ghostY, ghostW, ghostH, radius);
          ctx.fill();

          // Ghost border
          ctx.globalAlpha = GHOST_OPACITY * 2;
          ctx.strokeStyle = tintColor;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();

          // ── Arrow from baseline to sandbox position ─────────────────
          const ghostCenterX = ghostX + ghostW / 2;
          const ghostCenterY = ghostY + ghostH / 2;
          const barCenterX = layout.x + layout.width / 2;
          const barCenterY = barY + barHeight / 2;

          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = tintColor;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2]);

          ctx.beginPath();
          ctx.moveTo(ghostCenterX, ghostCenterY);
          ctx.lineTo(barCenterX, barCenterY);
          ctx.stroke();

          // Arrow head pointing to current position
          const angle = Math.atan2(barCenterY - ghostCenterY, barCenterX - ghostCenterX);
          const headX = barCenterX;
          const headY = barCenterY;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(headX, headY);
          ctx.lineTo(
            headX - ARROW_HEAD_SIZE * Math.cos(angle - Math.PI / 6),
            headY - ARROW_HEAD_SIZE * Math.sin(angle - Math.PI / 6),
          );
          ctx.lineTo(
            headX - ARROW_HEAD_SIZE * Math.cos(angle + Math.PI / 6),
            headY - ARROW_HEAD_SIZE * Math.sin(angle + Math.PI / 6),
          );
          ctx.closePath();
          ctx.fillStyle = tintColor;
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    },

    renderDOM(container: HTMLElement, _state: GanttState): void {
      // ── Banner ───────────────────────────────────────────────────────
      if (!bannerEl) {
        bannerEl = document.createElement('div');
        bannerEl.className = 'ng-whatif-banner ng-hidden';

        // Left section
        const left = document.createElement('div');
        left.className = 'ng-whatif-banner-left';

        const badge = document.createElement('span');
        badge.className = 'ng-whatif-badge';
        badge.textContent = 'What-If Mode';
        left.appendChild(badge);

        const subtitle = document.createElement('span');
        subtitle.textContent = 'Changes are hypothetical';
        subtitle.style.fontSize = '12px';
        subtitle.style.opacity = '0.7';
        left.appendChild(subtitle);

        const sep = document.createElement('span');
        sep.textContent = '\u00B7';
        sep.style.opacity = '0.4';
        left.appendChild(sep);

        changeCountEl = document.createElement('span');
        changeCountEl.className = 'ng-whatif-change-count';
        changeCountEl.textContent = '0 changes made';
        left.appendChild(changeCountEl);

        bannerEl.appendChild(left);

        // Right section
        const right = document.createElement('div');
        right.className = 'ng-whatif-banner-right';

        // Save input (hidden by default)
        saveInputContainer = document.createElement('div');
        saveInputContainer.className = 'ng-whatif-save-input';
        saveInput = document.createElement('input');
        saveInput.type = 'text';
        saveInput.placeholder = 'Scenario name...';
        saveInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleSaveConfirm();
          if (e.key === 'Escape') hideSaveInput();
        });
        const saveConfirmBtn = document.createElement('button');
        saveConfirmBtn.className = 'ng-whatif-btn ng-whatif-btn--primary';
        saveConfirmBtn.textContent = 'Save';
        saveConfirmBtn.addEventListener('click', handleSaveConfirm);
        const saveCancelBtn = document.createElement('button');
        saveCancelBtn.className = 'ng-whatif-btn';
        saveCancelBtn.textContent = 'Cancel';
        saveCancelBtn.addEventListener('click', () => hideSaveInput());
        saveInputContainer.appendChild(saveInput);
        saveInputContainer.appendChild(saveConfirmBtn);
        saveInputContainer.appendChild(saveCancelBtn);
        right.appendChild(saveInputContainer);

        // Scenario list button
        const scenariosBtn = document.createElement('button');
        scenariosBtn.className = 'ng-whatif-btn';
        scenariosBtn.textContent = 'Scenarios';
        scenariosBtn.addEventListener('click', () => togglePanel());
        right.appendChild(scenariosBtn);

        // Compare button
        const compareBtn = document.createElement('button');
        compareBtn.className = 'ng-whatif-btn ng-whatif-btn--primary';
        compareBtn.textContent = 'Compare with Baseline';
        compareBtn.addEventListener('click', () => toggleCompare());
        right.appendChild(compareBtn);

        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.className = 'ng-whatif-btn';
        saveBtn.textContent = 'Save Scenario';
        saveBtn.addEventListener('click', () => showSaveInput());
        right.appendChild(saveBtn);

        // Discard button
        const discardBtn = document.createElement('button');
        discardBtn.className = 'ng-whatif-btn ng-whatif-btn--danger';
        discardBtn.textContent = 'Discard';
        discardBtn.addEventListener('click', () => discardChanges());
        right.appendChild(discardBtn);

        // Exit button
        const exitBtn = document.createElement('button');
        exitBtn.className = 'ng-whatif-btn ng-whatif-btn--danger';
        exitBtn.textContent = 'Exit';
        exitBtn.addEventListener('click', () => exitSandbox());
        right.appendChild(exitBtn);

        bannerEl.appendChild(right);
        container.appendChild(bannerEl);
      }

      // ── Summary panel ────────────────────────────────────────────────
      if (!summaryEl) {
        summaryEl = document.createElement('div');
        summaryEl.className = 'ng-whatif-summary ng-hidden';
        container.appendChild(summaryEl);
      }

      // ── Scenario slide-out panel ─────────────────────────────────────
      if (!panelEl) {
        panelEl = document.createElement('div');
        panelEl.className = 'ng-whatif-panel';

        const titleRow = document.createElement('div');
        titleRow.className = 'ng-whatif-panel-title';
        const titleText = document.createElement('span');
        titleText.textContent = 'Saved Scenarios';
        titleRow.appendChild(titleText);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ng-whatif-panel-close';
        closeBtn.textContent = '\u00D7';
        closeBtn.addEventListener('click', () => closePanelEl());
        titleRow.appendChild(closeBtn);

        panelEl.appendChild(titleRow);

        scenarioListEl = document.createElement('div');
        scenarioListEl.addEventListener('click', handleScenarioAction);
        panelEl.appendChild(scenarioListEl);

        container.appendChild(panelEl);
        renderScenarioList();
      }

      // Update banner visibility in case state changed externally
      updateBannerVisibility();
      if (compareActive) {
        showSummary();
      }
    },

    destroy(): void {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;

      if (bannerEl) { bannerEl.remove(); bannerEl = null; }
      if (panelEl) { panelEl.remove(); panelEl = null; }
      if (summaryEl) { summaryEl.remove(); summaryEl = null; }

      changeCountEl = null;
      saveInputContainer = null;
      saveInput = null;
      scenarioListEl = null;

      removeStyles();

      sandboxActive = false;
      compareActive = false;
      panelOpen = false;
      saveInputActive = false;
      baseline = null;
      changes = [];
      scenarios = [];
      host = null;
    },
  };
}
