// ─── Time Travel Debugging Plugin ──────────────────────────────────────────
// Records every state-mutating action as a lightweight snapshot and lets
// users scrub through project history like a video timeline. The first
// plugin to bring version-control-style debugging to a Gantt library.
//
// Features:
// - Automatic snapshot recording on all state mutations
// - Timeline scrubber bar with play/pause, speed control, step buttons
// - Color-coded snapshot dots by action type
// - Hover tooltips showing action descriptions and timestamps
// - "Return to Present" to exit time-travel mode

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

export interface HistorySnapshot {
  timestamp: number;
  action: string;
  tasks: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    progress: number;
    status?: string;
  }>;
  dependencies: Array<{ id: string; source: string; target: string }>;
}

export interface TimeTravelOptions {
  maxSnapshots?: number;
  autoRecord?: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_SNAPSHOTS = 500;
const SCRUBBER_HEIGHT = 40;
const PLAYHEAD_RADIUS = 7;
const DOT_RADIUS = 3;
const DOT_HOVER_RADIUS = 5;
const PLAY_INTERVAL_BASE = 500; // ms at 1x
const STYLE_ID = 'nimbus-gantt-timetravel-styles';

// Action type → dot color mapping
const ACTION_COLORS: Record<string, string> = {
  move: '#3B82F6',      // blue
  add: '#22C55E',       // green
  remove: '#EF4444',    // red
  resize: '#F97316',    // orange
  update: '#A78BFA',    // purple
  data: '#94A3B8',      // slate
};

// ─── CSS ───────────────────────────────────────────────────────────────────

const TIMETRAVEL_CSS = `
  .ng-timetravel {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: ${SCRUBBER_HEIGHT}px;
    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
    border-top: 1px solid #334155;
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 6px;
    z-index: 950;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    color: #94A3B8;
  }
  .ng-timetravel.ng-hidden {
    display: none;
  }
  .ng-timetravel-btn {
    background: #334155;
    border: 1px solid #475569;
    border-radius: 4px;
    color: #CBD5E1;
    cursor: pointer;
    padding: 2px 6px;
    font-size: 11px;
    line-height: 18px;
    transition: background 150ms ease, border-color 150ms ease;
    flex-shrink: 0;
  }
  .ng-timetravel-btn:hover {
    background: #475569;
    border-color: #64748B;
    color: #F1F5F9;
  }
  .ng-timetravel-btn.ng-active {
    background: #3B82F6;
    border-color: #60A5FA;
    color: #FFF;
  }
  .ng-timetravel-btn.ng-present {
    background: #065F46;
    border-color: #10B981;
    color: #A7F3D0;
  }
  .ng-timetravel-btn.ng-present:hover {
    background: #047857;
  }
  .ng-timetravel-track {
    flex: 1;
    height: 20px;
    position: relative;
    cursor: pointer;
    margin: 0 4px;
  }
  .ng-timetravel-rail {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 2px;
    background: #475569;
    transform: translateY(-50%);
    border-radius: 1px;
  }
  .ng-timetravel-playhead {
    position: absolute;
    top: 50%;
    width: ${PLAYHEAD_RADIUS * 2}px;
    height: ${PLAYHEAD_RADIUS * 2}px;
    background: #3B82F6;
    border: 2px solid #93C5FD;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    cursor: grab;
    z-index: 2;
    transition: background 100ms ease;
    box-shadow: 0 0 6px rgba(59, 130, 246, 0.5);
  }
  .ng-timetravel-playhead:hover {
    background: #60A5FA;
  }
  .ng-timetravel-playhead.ng-dragging {
    cursor: grabbing;
    background: #93C5FD;
  }
  .ng-timetravel-dot {
    position: absolute;
    top: 50%;
    width: ${DOT_RADIUS * 2}px;
    height: ${DOT_RADIUS * 2}px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    transition: width 100ms ease, height 100ms ease;
    pointer-events: all;
  }
  .ng-timetravel-dot:hover {
    width: ${DOT_HOVER_RADIUS * 2}px;
    height: ${DOT_HOVER_RADIUS * 2}px;
  }
  .ng-timetravel-tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #1E293B;
    border: 1px solid #475569;
    border-radius: 6px;
    padding: 6px 10px;
    white-space: nowrap;
    font-size: 11px;
    color: #E2E8F0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 150ms ease;
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    margin-bottom: 4px;
  }
  .ng-timetravel-dot:hover .ng-timetravel-tooltip {
    opacity: 1;
  }
  .ng-timetravel-counter {
    flex-shrink: 0;
    min-width: 60px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .ng-timetravel-speed {
    flex-shrink: 0;
    min-width: 28px;
    text-align: center;
  }
`;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Classify an action type for color-coding */
function classifyAction(actionType: string): string {
  if (actionType === 'TASK_MOVE') return 'move';
  if (actionType === 'TASK_RESIZE') return 'resize';
  if (actionType === 'ADD_TASK' || actionType === 'ADD_DEPENDENCY') return 'add';
  if (actionType === 'REMOVE_TASK' || actionType === 'REMOVE_DEPENDENCY') return 'remove';
  if (actionType === 'UPDATE_TASK') return 'update';
  return 'data';
}

/** Generate a human-readable description for an action */
function describeAction(action: Action, state: GanttState): string {
  switch (action.type) {
    case 'SET_DATA':
      return `Loaded ${action.tasks.length} tasks`;
    case 'TASK_MOVE': {
      const task = state.tasks.get(action.taskId);
      const name = task ? `'${task.name}'` : action.taskId;
      return `Moved ${name} to ${action.startDate} - ${action.endDate}`;
    }
    case 'TASK_RESIZE': {
      const task = state.tasks.get(action.taskId);
      const name = task ? `'${task.name}'` : action.taskId;
      return `Resized ${name} to ${action.startDate} - ${action.endDate}`;
    }
    case 'UPDATE_TASK': {
      const task = state.tasks.get(action.taskId);
      const name = task ? `'${task.name}'` : action.taskId;
      const fields = Object.keys(action.changes).join(', ');
      return `Updated ${name}: ${fields}`;
    }
    case 'ADD_TASK':
      return `Added task '${action.task.name}'`;
    case 'REMOVE_TASK': {
      const task = state.tasks.get(action.taskId);
      const name = task ? `'${task.name}'` : action.taskId;
      return `Removed task ${name}`;
    }
    case 'ADD_DEPENDENCY':
      return `Added dependency ${action.dependency.source} -> ${action.dependency.target}`;
    case 'REMOVE_DEPENDENCY':
      return `Removed dependency ${action.dependencyId}`;
    default:
      return action.type;
  }
}

/** Serialize current state into a lightweight snapshot */
function captureSnapshot(state: GanttState, actionDesc: string): HistorySnapshot {
  const tasks: HistorySnapshot['tasks'] = [];
  for (const t of state.tasks.values()) {
    tasks.push({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      progress: t.progress ?? 0,
      status: t.status,
    });
  }

  const dependencies: HistorySnapshot['dependencies'] = [];
  for (const d of state.dependencies.values()) {
    dependencies.push({ id: d.id, source: d.source, target: d.target });
  }

  return {
    timestamp: Date.now(),
    action: actionDesc,
    tasks,
    dependencies,
  };
}

/** Format a timestamp as HH:MM:SS */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TIMETRAVEL_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── Actions that trigger snapshot recording ───────────────────────────────

const RECORDED_ACTIONS = new Set<string>([
  'SET_DATA',
  'TASK_MOVE',
  'TASK_RESIZE',
  'UPDATE_TASK',
  'ADD_TASK',
  'REMOVE_TASK',
  'ADD_DEPENDENCY',
  'REMOVE_DEPENDENCY',
]);

// ─── Speed presets ─────────────────────────────────────────────────────────

const SPEED_PRESETS = [0.5, 1, 2, 4];

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function TimeTravelPlugin(options?: TimeTravelOptions): NimbusGanttPlugin {
  const maxSnapshots = options?.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
  const autoRecord = options?.autoRecord ?? true;

  let host: PluginHost | null = null;
  const snapshots: HistorySnapshot[] = [];
  let currentIndex = -1;
  let isTimeTraveling = false;
  let isPlaying = false;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  let speedIndex = 1; // index into SPEED_PRESETS (default 1x)
  const unsubs: (() => void)[] = [];

  // DOM references
  let wrapper: HTMLDivElement | null = null;
  let trackEl: HTMLDivElement | null = null;
  let playheadEl: HTMLDivElement | null = null;
  let counterEl: HTMLSpanElement | null = null;
  let playBtnEl: HTMLButtonElement | null = null;
  let speedEl: HTMLSpanElement | null = null;
  let dotsContainer: HTMLDivElement | null = null;
  let isDraggingPlayhead = false;

  // ── Snapshot Management ───────────────────────────────────────────────

  function recordSnapshot(actionDesc: string): void {
    if (!host || isTimeTraveling) return;

    const state = host.getState();
    const snapshot = captureSnapshot(state, actionDesc);

    // If we've time-traveled back and new actions occur, truncate forward history
    if (currentIndex < snapshots.length - 1) {
      snapshots.length = currentIndex + 1;
    }

    snapshots.push(snapshot);

    // Enforce FIFO cap
    if (snapshots.length > maxSnapshots) {
      snapshots.shift();
    }

    currentIndex = snapshots.length - 1;
  }

  function scrubTo(index: number): void {
    if (!host || snapshots.length === 0) return;

    const clamped = Math.max(0, Math.min(index, snapshots.length - 1));
    currentIndex = clamped;
    const snapshot = snapshots[clamped];

    // Restore state from snapshot
    isTimeTraveling = true;

    const tasks: GanttTask[] = snapshot.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      progress: t.progress,
      status: t.status,
    }));

    const dependencies: GanttDependency[] = snapshot.dependencies.map((d) => ({
      id: d.id,
      source: d.source,
      target: d.target,
    }));

    host.dispatch({ type: 'SET_DATA', tasks, dependencies });
    isTimeTraveling = false;

    updateUI();
  }

  function returnToPresent(): void {
    if (snapshots.length > 0) {
      scrubTo(snapshots.length - 1);
    }
    stopPlaying();
  }

  // ── Playback ──────────────────────────────────────────────────────────

  function startPlaying(): void {
    if (isPlaying || snapshots.length <= 1) return;
    isPlaying = true;

    const speed = SPEED_PRESETS[speedIndex];
    const interval = PLAY_INTERVAL_BASE / speed;

    playTimer = setInterval(() => {
      if (currentIndex >= snapshots.length - 1) {
        stopPlaying();
        return;
      }
      scrubTo(currentIndex + 1);
    }, interval);

    updateUI();
  }

  function stopPlaying(): void {
    isPlaying = false;
    if (playTimer !== null) {
      clearInterval(playTimer);
      playTimer = null;
    }
    updateUI();
  }

  function togglePlay(): void {
    if (isPlaying) {
      stopPlaying();
    } else {
      startPlaying();
    }
  }

  function cycleSpeed(): void {
    speedIndex = (speedIndex + 1) % SPEED_PRESETS.length;
    // If currently playing, restart with new speed
    if (isPlaying) {
      stopPlaying();
      startPlaying();
    }
    updateUI();
  }

  function stepBackward(): void {
    stopPlaying();
    if (currentIndex > 0) {
      scrubTo(currentIndex - 1);
    }
  }

  function stepForward(): void {
    stopPlaying();
    if (currentIndex < snapshots.length - 1) {
      scrubTo(currentIndex + 1);
    }
  }

  function clearHistory(): void {
    stopPlaying();
    snapshots.length = 0;
    currentIndex = -1;
    isTimeTraveling = false;
    updateUI();
  }

  // ── UI Updates ────────────────────────────────────────────────────────

  function updateUI(): void {
    if (!wrapper) return;

    // Counter
    if (counterEl) {
      const total = snapshots.length;
      const current = total > 0 ? currentIndex + 1 : 0;
      counterEl.textContent = `${current} / ${total}`;
    }

    // Play button
    if (playBtnEl) {
      playBtnEl.textContent = isPlaying ? '\u23F8' : '\u25B6';
      playBtnEl.classList.toggle('ng-active', isPlaying);
    }

    // Speed
    if (speedEl) {
      speedEl.textContent = `${SPEED_PRESETS[speedIndex]}x`;
    }

    // Playhead position
    updatePlayheadPosition();

    // Dots
    updateDots();
  }

  function updatePlayheadPosition(): void {
    if (!playheadEl || !trackEl || snapshots.length === 0) {
      if (playheadEl) playheadEl.style.display = 'none';
      return;
    }

    playheadEl.style.display = 'block';
    const pct = snapshots.length <= 1 ? 50 : (currentIndex / (snapshots.length - 1)) * 100;
    playheadEl.style.left = `${pct}%`;
  }

  function updateDots(): void {
    if (!dotsContainer || !trackEl) return;

    // Clear existing dots
    dotsContainer.innerHTML = '';

    if (snapshots.length === 0) return;

    // For large numbers of snapshots, subsample to avoid overwhelming the DOM
    const maxDots = 200;
    const step = snapshots.length > maxDots ? Math.ceil(snapshots.length / maxDots) : 1;

    for (let i = 0; i < snapshots.length; i += step) {
      const snapshot = snapshots[i];
      const pct = snapshots.length <= 1 ? 50 : (i / (snapshots.length - 1)) * 100;

      const actionClass = classifyAction(snapshot.action.split(' ')[0] === 'Loaded' ? 'SET_DATA' : inferActionType(snapshot.action));
      const color = ACTION_COLORS[actionClass] || ACTION_COLORS.data;

      const dot = document.createElement('div');
      dot.className = 'ng-timetravel-dot';
      dot.style.left = `${pct}%`;
      dot.style.background = color;

      // Tooltip
      const tooltip = document.createElement('div');
      tooltip.className = 'ng-timetravel-tooltip';
      tooltip.textContent = `${snapshot.action}\n${formatTime(snapshot.timestamp)}`;
      tooltip.style.whiteSpace = 'pre';
      dot.appendChild(tooltip);

      // Click to scrub
      const idx = i;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        stopPlaying();
        scrubTo(idx);
      });

      dotsContainer.appendChild(dot);
    }
  }

  /** Infer the original action type from the description text */
  function inferActionType(desc: string): string {
    if (desc.startsWith('Moved')) return 'TASK_MOVE';
    if (desc.startsWith('Resized')) return 'TASK_RESIZE';
    if (desc.startsWith('Added task')) return 'ADD_TASK';
    if (desc.startsWith('Added dependency')) return 'ADD_DEPENDENCY';
    if (desc.startsWith('Removed task')) return 'REMOVE_TASK';
    if (desc.startsWith('Removed dependency')) return 'REMOVE_DEPENDENCY';
    if (desc.startsWith('Updated')) return 'UPDATE_TASK';
    if (desc.startsWith('Loaded')) return 'SET_DATA';
    return 'SET_DATA';
  }

  // ── Track interaction (click to scrub) ────────────────────────────────

  function handleTrackClick(e: MouseEvent): void {
    if (!trackEl || snapshots.length <= 1) return;

    const rect = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const index = Math.round(pct * (snapshots.length - 1));

    stopPlaying();
    scrubTo(index);
  }

  // ── Playhead drag ─────────────────────────────────────────────────────

  function handlePlayheadMouseDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    isDraggingPlayhead = true;
    if (playheadEl) playheadEl.classList.add('ng-dragging');
    stopPlaying();
  }

  function handleDocumentMouseMove(e: MouseEvent): void {
    if (!isDraggingPlayhead || !trackEl || snapshots.length <= 1) return;

    const rect = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const index = Math.round(pct * (snapshots.length - 1));

    scrubTo(index);
  }

  function handleDocumentMouseUp(): void {
    if (isDraggingPlayhead) {
      isDraggingPlayhead = false;
      if (playheadEl) playheadEl.classList.remove('ng-dragging');
    }
  }

  // ── Plugin Interface ──────────────────────────────────────────────────

  return {
    name: 'TimeTravelPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      injectStyles();

      // Event handlers
      unsubs.push(
        gantt.on('timeTravel:record', () => {
          if (host) {
            const state = host.getState();
            recordSnapshot('Manual snapshot');
          }
        }),
        gantt.on('timeTravel:scrub', (...args: unknown[]) => {
          const index = args[0] as number;
          stopPlaying();
          scrubTo(index);
        }),
        gantt.on('timeTravel:play', () => startPlaying()),
        gantt.on('timeTravel:pause', () => stopPlaying()),
        gantt.on('timeTravel:present', () => returnToPresent()),
        gantt.on('timeTravel:clear', () => clearHistory()),
        gantt.on('timeTravel:history', (...args: unknown[]) => {
          // Return snapshots via callback if provided
          const callback = args[0] as ((snapshots: HistorySnapshot[]) => void) | undefined;
          if (typeof callback === 'function') {
            callback([...snapshots]);
          }
        }),
      );

      // Document-level mouse events for playhead drag
      if (typeof document !== 'undefined') {
        document.addEventListener('mousemove', handleDocumentMouseMove);
        document.addEventListener('mouseup', handleDocumentMouseUp);
      }
    },

    middleware(action: Action, next: (action: Action) => void): void {
      // Capture a description BEFORE the action is applied
      // (so we can reference the current task names for moves/resizes)
      let actionDesc = '';
      if (autoRecord && RECORDED_ACTIONS.has(action.type) && host && !isTimeTraveling) {
        actionDesc = describeAction(action, host.getState());
      }

      // Let the action propagate
      next(action);

      // Record snapshot AFTER the state has been updated
      if (autoRecord && RECORDED_ACTIONS.has(action.type) && !isTimeTraveling && actionDesc) {
        recordSnapshot(actionDesc);
      }
    },

    renderDOM(container: HTMLElement, state: GanttState): void {
      if (!wrapper) {
        // ── Build the scrubber bar DOM ──────────────────────────────
        wrapper = document.createElement('div');
        wrapper.className = 'ng-timetravel';

        // Step backward button
        const stepBackBtn = document.createElement('button');
        stepBackBtn.className = 'ng-timetravel-btn';
        stepBackBtn.textContent = '\u25C0';
        stepBackBtn.title = 'Step backward';
        stepBackBtn.addEventListener('click', () => stepBackward());
        wrapper.appendChild(stepBackBtn);

        // Play/pause button
        playBtnEl = document.createElement('button');
        playBtnEl.className = 'ng-timetravel-btn';
        playBtnEl.textContent = '\u25B6';
        playBtnEl.title = 'Play / Pause';
        playBtnEl.addEventListener('click', () => togglePlay());
        wrapper.appendChild(playBtnEl);

        // Step forward button
        const stepFwdBtn = document.createElement('button');
        stepFwdBtn.className = 'ng-timetravel-btn';
        stepFwdBtn.textContent = '\u25B6';
        stepFwdBtn.title = 'Step forward';
        stepFwdBtn.addEventListener('click', () => stepForward());
        wrapper.appendChild(stepFwdBtn);

        // Speed control
        speedEl = document.createElement('span');
        speedEl.className = 'ng-timetravel-speed ng-timetravel-btn';
        speedEl.textContent = `${SPEED_PRESETS[speedIndex]}x`;
        speedEl.title = 'Click to cycle speed';
        speedEl.addEventListener('click', () => cycleSpeed());
        wrapper.appendChild(speedEl);

        // Track (the horizontal timeline strip)
        trackEl = document.createElement('div');
        trackEl.className = 'ng-timetravel-track';
        trackEl.addEventListener('click', handleTrackClick);

        const rail = document.createElement('div');
        rail.className = 'ng-timetravel-rail';
        trackEl.appendChild(rail);

        // Dots container
        dotsContainer = document.createElement('div');
        dotsContainer.style.position = 'absolute';
        dotsContainer.style.inset = '0';
        trackEl.appendChild(dotsContainer);

        // Playhead
        playheadEl = document.createElement('div');
        playheadEl.className = 'ng-timetravel-playhead';
        playheadEl.addEventListener('mousedown', handlePlayheadMouseDown);
        trackEl.appendChild(playheadEl);

        wrapper.appendChild(trackEl);

        // Counter display
        counterEl = document.createElement('span');
        counterEl.className = 'ng-timetravel-counter';
        wrapper.appendChild(counterEl);

        // Return to Present button
        const presentBtn = document.createElement('button');
        presentBtn.className = 'ng-timetravel-btn ng-present';
        presentBtn.textContent = 'Present';
        presentBtn.title = 'Return to latest state';
        presentBtn.addEventListener('click', () => returnToPresent());
        wrapper.appendChild(presentBtn);

        container.appendChild(wrapper);
      }

      updateUI();
    },

    destroy(): void {
      stopPlaying();

      for (const unsub of unsubs) {
        unsub();
      }
      unsubs.length = 0;

      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', handleDocumentMouseMove);
        document.removeEventListener('mouseup', handleDocumentMouseUp);
      }

      if (wrapper) {
        wrapper.remove();
        wrapper = null;
      }

      trackEl = null;
      playheadEl = null;
      counterEl = null;
      playBtnEl = null;
      speedEl = null;
      dotsContainer = null;
      removeStyles();

      snapshots.length = 0;
      currentIndex = -1;
      isTimeTraveling = false;
      isPlaying = false;
      isDraggingPlayhead = false;
      host = null;
    },
  };
}
