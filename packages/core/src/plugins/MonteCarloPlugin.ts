// ─── Monte Carlo Simulation Plugin ─────────────────────────────────────────
// Runs thousands of randomized schedule scenarios to predict project finish
// date probability. The first Gantt library plugin to bring Monte Carlo
// simulation directly into the chart visualization.
//
// Algorithm:
// 1. For each iteration, randomize every task's duration using the chosen
//    distribution (triangular by default, with optimism bias).
// 2. Forward-schedule via topological sort to compute project finish date.
// 3. After all iterations: compute percentiles, mean, std dev, per-task
//    risk metrics, and critical path frequency.
//
// Visualization:
// - Canvas overlay: histogram of finish dates, percentile lines, confidence cone
// - DOM overlay: summary box with key predictions

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

export interface SimulationConfig {
  iterations?: number;
  variability?: number;
  distribution?: 'uniform' | 'normal' | 'triangular';
  confidenceLevels?: number[];
}

export interface SimulationResult {
  iterations: number;
  finishDates: Date[];
  percentiles: Map<number, Date>;
  meanFinishDate: Date;
  medianFinishDate: Date;
  earliestFinish: Date;
  latestFinish: Date;
  standardDeviation: number;
  taskRisk: Map<string, { meanDuration: number; stdDev: number; delayProbability: number }>;
  criticalPathFrequency: Map<string, number>;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const HISTOGRAM_MAX_HEIGHT = 60;
const HISTOGRAM_BAR_WIDTH_MIN = 2;
const PERCENTILE_DASH = [6, 4];
const STYLE_ID = 'nimbus-gantt-montecarlo-styles';

const PERCENTILE_COLORS: Record<number, string> = {
  0.5: '#22C55E',   // green
  0.75: '#EAB308',  // yellow
  0.9: '#F97316',   // orange
  0.95: '#EF4444',  // red
};

const CONFIDENCE_CONE_OPACITY = 0.08;
const SUMMARY_BOX_WIDTH = 240;
const SUMMARY_BOX_PADDING = 12;

// ─── CSS ───────────────────────────────────────────────────────────────────

const MONTECARLO_CSS = `
  .ng-montecarlo-summary {
    position: absolute;
    top: 64px;
    right: 12px;
    width: ${SUMMARY_BOX_WIDTH}px;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
    border: 1px solid #334155;
    border-radius: 8px;
    padding: ${SUMMARY_BOX_PADDING}px;
    z-index: 900;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    color: #CBD5E1;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    transition: opacity 200ms ease, transform 200ms ease;
    user-select: none;
  }
  .ng-montecarlo-summary.ng-hidden {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.95) translateY(-4px);
  }
  .ng-montecarlo-title {
    font-size: 13px;
    font-weight: 600;
    color: #F1F5F9;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ng-montecarlo-title::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #3B82F6;
    border-radius: 50%;
    animation: ng-mc-pulse 2s infinite;
  }
  @keyframes ng-mc-pulse {
    0%, 100% { opacity: 0.5; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.2); }
  }
  .ng-montecarlo-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px solid rgba(51, 65, 85, 0.5);
  }
  .ng-montecarlo-row:last-child {
    border-bottom: none;
  }
  .ng-montecarlo-label {
    color: #94A3B8;
  }
  .ng-montecarlo-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .ng-montecarlo-risk {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid #334155;
    font-size: 11px;
    color: #F97316;
  }
  .ng-montecarlo-close {
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: none;
    color: #64748B;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 4px;
  }
  .ng-montecarlo-close:hover {
    color: #CBD5E1;
  }
`;

// ─── Date Helpers ──────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function formatDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatDateFull(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ─── Distribution Samplers ─────────────────────────────────────────────────

function sampleTriangular(min: number, mode: number, max: number): number {
  const u = Math.random();
  const fc = (mode - min) / (max - min);
  if (u < fc) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  } else {
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }
}

function sampleNormal(mean: number, stddev: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0.5, mean + z * stddev);
}

function sampleUniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ─── Forward Scheduling (Lightweight) ──────────────────────────────────────

/**
 * Lightweight forward-pass scheduler optimized for simulation speed.
 * Uses typed arrays for duration storage. Returns project finish day offset.
 */
function simulateSchedule(
  taskIds: string[],
  taskIdIndex: Map<string, number>,
  baseDurations: Float64Array,
  randomDurations: Float64Array,
  baseStarts: Float64Array,
  adjList: Int32Array[],       // successor indices for each task
  predList: Int32Array[],      // predecessor indices for each task
  inDegrees: Int32Array,       // original in-degrees
): number {
  const n = taskIds.length;
  if (n === 0) return 0;

  const earlyStart = new Float64Array(n);
  const earlyFinish = new Float64Array(n);
  const workingDegree = new Int32Array(inDegrees);

  // Initialize queue with root tasks (in-degree 0)
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (workingDegree[i] === 0) {
      queue.push(i);
      earlyStart[i] = baseStarts[i];
      earlyFinish[i] = baseStarts[i] + randomDurations[i];
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const ef = earlyFinish[current];

    const succs = adjList[current];
    for (let s = 0; s < succs.length; s++) {
      const target = succs[s];

      // ES = max(all predecessor EFs)
      if (ef > earlyStart[target]) {
        earlyStart[target] = ef;
        earlyFinish[target] = ef + randomDurations[target];
      }

      workingDegree[target]--;
      if (workingDegree[target] === 0) {
        queue.push(target);
      }
    }
  }

  // Handle disconnected tasks (no predecessors in the DAG)
  for (let i = 0; i < n; i++) {
    if (earlyFinish[i] === 0 && randomDurations[i] > 0) {
      earlyStart[i] = baseStarts[i];
      earlyFinish[i] = baseStarts[i] + randomDurations[i];
    }
  }

  // Project finish = max of all early finishes
  let maxFinish = 0;
  for (let i = 0; i < n; i++) {
    if (earlyFinish[i] > maxFinish) {
      maxFinish = earlyFinish[i];
    }
  }

  return maxFinish;
}

/**
 * Identify critical path tasks for a single simulation run.
 * A task is on the critical path if it has zero float.
 */
function findCriticalTasks(
  n: number,
  randomDurations: Float64Array,
  baseStarts: Float64Array,
  adjList: Int32Array[],
  predList: Int32Array[],
  inDegrees: Int32Array,
): Set<number> {
  const earlyStart = new Float64Array(n);
  const earlyFinish = new Float64Array(n);
  const lateStart = new Float64Array(n);
  const lateFinish = new Float64Array(n);
  const workingDegree = new Int32Array(inDegrees);
  const topoOrder: number[] = [];

  // Forward pass
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (workingDegree[i] === 0) {
      queue.push(i);
      earlyStart[i] = baseStarts[i];
      earlyFinish[i] = baseStarts[i] + randomDurations[i];
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    topoOrder.push(current);
    const ef = earlyFinish[current];

    for (const target of adjList[current]) {
      if (ef > earlyStart[target]) {
        earlyStart[target] = ef;
        earlyFinish[target] = ef + randomDurations[target];
      }
      workingDegree[target]--;
      if (workingDegree[target] === 0) {
        queue.push(target);
      }
    }
  }

  // Handle disconnected
  for (let i = 0; i < n; i++) {
    if (earlyFinish[i] === 0 && randomDurations[i] > 0) {
      earlyStart[i] = baseStarts[i];
      earlyFinish[i] = baseStarts[i] + randomDurations[i];
      topoOrder.push(i);
    }
  }

  // Project finish
  let projectFinish = 0;
  for (let i = 0; i < n; i++) {
    if (earlyFinish[i] > projectFinish) projectFinish = earlyFinish[i];
  }

  // Backward pass
  // Initialize leaf tasks
  for (let i = 0; i < n; i++) {
    if (adjList[i].length === 0) {
      lateFinish[i] = projectFinish;
      lateStart[i] = projectFinish - randomDurations[i];
    } else {
      lateFinish[i] = Infinity;
      lateStart[i] = Infinity;
    }
  }

  // Reverse topological order
  for (let t = topoOrder.length - 1; t >= 0; t--) {
    const current = topoOrder[t];
    if (lateFinish[current] === Infinity) {
      // Compute from successors
      let minSuccLS = Infinity;
      for (const succ of adjList[current]) {
        if (lateStart[succ] < minSuccLS) minSuccLS = lateStart[succ];
      }
      if (minSuccLS === Infinity) {
        lateFinish[current] = projectFinish;
      } else {
        lateFinish[current] = minSuccLS;
      }
      lateStart[current] = lateFinish[current] - randomDurations[current];
    }
  }

  // Identify critical (float < 0.5 day tolerance)
  const critical = new Set<number>();
  for (let i = 0; i < n; i++) {
    const totalFloat = lateStart[i] - earlyStart[i];
    if (Math.abs(totalFloat) < 0.5) {
      critical.add(i);
    }
  }

  return critical;
}

// ─── Core Simulation ───────────────────────────────────────────────────────

function runSimulation(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
  config: Required<SimulationConfig>,
): SimulationResult {
  const { iterations, variability, distribution, confidenceLevels } = config;

  // ── Index tasks for typed-array access ────────────────────────────────
  const taskIds: string[] = [];
  const taskIdIndex = new Map<string, number>();

  for (const id of tasks.keys()) {
    taskIdIndex.set(id, taskIds.length);
    taskIds.push(id);
  }

  const n = taskIds.length;

  if (n === 0) {
    return {
      iterations,
      finishDates: [],
      percentiles: new Map(),
      meanFinishDate: new Date(),
      medianFinishDate: new Date(),
      earliestFinish: new Date(),
      latestFinish: new Date(),
      standardDeviation: 0,
      taskRisk: new Map(),
      criticalPathFrequency: new Map(),
    };
  }

  // ── Pre-compute durations and graph structure ─────────────────────────
  const baseDurations = new Float64Array(n);
  const baseStarts = new Float64Array(n);

  // Find project-wide earliest start for relative day calculations
  let projectEarliestMs = Infinity;
  for (const t of tasks.values()) {
    const ms = parseDate(t.startDate).getTime();
    if (ms < projectEarliestMs) projectEarliestMs = ms;
  }
  const projectOrigin = new Date(projectEarliestMs);

  for (let i = 0; i < n; i++) {
    const task = tasks.get(taskIds[i])!;
    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    baseDurations[i] = Math.max(diffDays(start, end), 1);
    baseStarts[i] = diffDays(projectOrigin, start);
  }

  // Build adjacency and predecessor lists (only FS dependencies)
  const adjListArrays: number[][] = Array.from({ length: n }, () => []);
  const predListArrays: number[][] = Array.from({ length: n }, () => []);
  const inDegreesRaw = new Int32Array(n);

  for (const dep of dependencies.values()) {
    const type = dep.type || 'FS';
    if (type !== 'FS') continue;

    const si = taskIdIndex.get(dep.source);
    const ti = taskIdIndex.get(dep.target);
    if (si === undefined || ti === undefined) continue;

    adjListArrays[si].push(ti);
    predListArrays[ti].push(si);
    inDegreesRaw[ti]++;
  }

  // Convert to typed arrays for performance
  const adjList: Int32Array[] = adjListArrays.map((a) => new Int32Array(a));
  const predList: Int32Array[] = predListArrays.map((a) => new Int32Array(a));

  // ── Run simulations ───────────────────────────────────────────────────
  const finishDays = new Float64Array(iterations);
  const randomDurations = new Float64Array(n);

  // Per-task accumulators
  const taskDurationSums = new Float64Array(n);
  const taskDurationSqSums = new Float64Array(n);
  const taskDelayCount = new Float64Array(n);
  const criticalCount = new Float64Array(n);

  // Sample critical path every Nth iteration (full CPM is more expensive)
  const cpSampleInterval = Math.max(1, Math.floor(iterations / 100));

  for (let iter = 0; iter < iterations; iter++) {
    // Randomize durations
    for (let i = 0; i < n; i++) {
      const dur = baseDurations[i];
      let sampled: number;

      switch (distribution) {
        case 'triangular': {
          const min = dur * (1 - variability);
          const mode = dur;
          const max = dur * (1 + variability * 1.5);
          sampled = sampleTriangular(min, mode, max);
          break;
        }
        case 'normal': {
          sampled = sampleNormal(dur, dur * variability);
          break;
        }
        case 'uniform': {
          sampled = sampleUniform(dur * (1 - variability), dur * (1 + variability));
          break;
        }
      }

      // Minimum duration of 0.5 days
      randomDurations[i] = Math.max(0.5, sampled);
      taskDurationSums[i] += randomDurations[i];
      taskDurationSqSums[i] += randomDurations[i] * randomDurations[i];

      if (randomDurations[i] > baseDurations[i]) {
        taskDelayCount[i]++;
      }
    }

    // Forward schedule
    finishDays[iter] = simulateSchedule(
      taskIds, taskIdIndex, baseDurations, randomDurations,
      baseStarts, adjList, predList, inDegreesRaw,
    );

    // Sample critical path periodically
    if (iter % cpSampleInterval === 0) {
      const critical = findCriticalTasks(
        n, randomDurations, baseStarts,
        adjList, predList, inDegreesRaw,
      );
      for (const idx of critical) {
        criticalCount[idx]++;
      }
    }
  }

  // ── Compute results ───────────────────────────────────────────────────
  // Sort finish days for percentile computation
  const sortedFinish = Array.from(finishDays).sort((a, b) => a - b);

  // Convert day offsets to actual dates
  const finishDates = sortedFinish.map((d) => addDays(projectOrigin, d));

  // Percentiles
  const percentiles = new Map<number, Date>();
  for (const level of confidenceLevels) {
    const idx = Math.min(
      Math.floor(level * sortedFinish.length),
      sortedFinish.length - 1,
    );
    percentiles.set(level, addDays(projectOrigin, sortedFinish[idx]));
  }

  // Mean
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += sortedFinish[i];
  }
  const meanDay = sum / iterations;
  const meanFinishDate = addDays(projectOrigin, meanDay);

  // Median
  const medianIdx = Math.floor(iterations / 2);
  const medianFinishDate = addDays(projectOrigin, sortedFinish[medianIdx]);

  // Std dev
  let sqDiffSum = 0;
  for (let i = 0; i < iterations; i++) {
    const diff = sortedFinish[i] - meanDay;
    sqDiffSum += diff * diff;
  }
  const standardDeviation = Math.sqrt(sqDiffSum / iterations);

  // Earliest / latest
  const earliestFinish = addDays(projectOrigin, sortedFinish[0]);
  const latestFinish = addDays(projectOrigin, sortedFinish[sortedFinish.length - 1]);

  // Per-task risk
  const taskRisk = new Map<string, { meanDuration: number; stdDev: number; delayProbability: number }>();
  for (let i = 0; i < n; i++) {
    const meanDur = taskDurationSums[i] / iterations;
    const variance = (taskDurationSqSums[i] / iterations) - (meanDur * meanDur);
    taskRisk.set(taskIds[i], {
      meanDuration: meanDur,
      stdDev: Math.sqrt(Math.max(0, variance)),
      delayProbability: taskDelayCount[i] / iterations,
    });
  }

  // Critical path frequency (normalized by number of samples)
  const cpSamples = Math.floor(iterations / cpSampleInterval);
  const criticalPathFrequency = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (criticalCount[i] > 0) {
      criticalPathFrequency.set(taskIds[i], criticalCount[i] / cpSamples);
    }
  }

  return {
    iterations,
    finishDates,
    percentiles,
    meanFinishDate,
    medianFinishDate,
    earliestFinish,
    latestFinish,
    standardDeviation,
    taskRisk,
    criticalPathFrequency,
  };
}

// ─── Inject / Remove Styles ───────────────────────────────────────────────

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = MONTECARLO_CSS;
  document.head.appendChild(style);
}

function removeStyles(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function MonteCarloPlugin(config?: SimulationConfig): NimbusGanttPlugin {
  const resolved: Required<SimulationConfig> = {
    iterations: config?.iterations ?? 1000,
    variability: config?.variability ?? 0.3,
    distribution: config?.distribution ?? 'triangular',
    confidenceLevels: config?.confidenceLevels ?? [0.5, 0.75, 0.9, 0.95],
  };

  let host: PluginHost | null = null;
  let result: SimulationResult | null = null;
  let overlayVisible = true;
  const unsubs: (() => void)[] = [];

  // DOM references
  let summaryBox: HTMLDivElement | null = null;

  function run(overrides?: Partial<SimulationConfig>): void {
    if (!host) return;

    const cfg: Required<SimulationConfig> = {
      iterations: overrides?.iterations ?? resolved.iterations,
      variability: overrides?.variability ?? resolved.variability,
      distribution: overrides?.distribution ?? resolved.distribution,
      confidenceLevels: overrides?.confidenceLevels ?? resolved.confidenceLevels,
    };

    const state = host.getState();
    result = runSimulation(state.tasks, state.dependencies, cfg);
    updateSummaryBox();
  }

  function toggleOverlay(): void {
    overlayVisible = !overlayVisible;
    if (summaryBox) {
      summaryBox.classList.toggle('ng-hidden', !overlayVisible);
    }
  }

  function updateConfig(newConfig: Partial<SimulationConfig>): void {
    if (newConfig.iterations !== undefined) resolved.iterations = newConfig.iterations;
    if (newConfig.variability !== undefined) resolved.variability = newConfig.variability;
    if (newConfig.distribution !== undefined) resolved.distribution = newConfig.distribution;
    if (newConfig.confidenceLevels !== undefined) resolved.confidenceLevels = newConfig.confidenceLevels;
  }

  // ── Summary Box ───────────────────────────────────────────────────────

  function updateSummaryBox(): void {
    if (!summaryBox || !result) return;

    // Find highest risk task
    let highestRiskId = '';
    let highestRiskFreq = 0;
    for (const [id, freq] of result.criticalPathFrequency) {
      if (freq > highestRiskFreq) {
        highestRiskFreq = freq;
        highestRiskId = id;
      }
    }

    let highestRiskName = highestRiskId;
    if (host) {
      const task = host.getState().tasks.get(highestRiskId);
      if (task) highestRiskName = task.name;
    }

    // Build rows
    let html = `
      <div class="ng-montecarlo-title">Finish Date Prediction</div>
      <button class="ng-montecarlo-close" title="Toggle overlay">\u2715</button>
    `;

    for (const level of resolved.confidenceLevels) {
      const date = result.percentiles.get(level);
      if (!date) continue;
      const pct = Math.round(level * 100);
      const color = PERCENTILE_COLORS[level] || '#94A3B8';
      html += `
        <div class="ng-montecarlo-row">
          <span class="ng-montecarlo-label">${pct}% chance by:</span>
          <span class="ng-montecarlo-value" style="color:${color}">${formatDateFull(date)}</span>
        </div>
      `;
    }

    html += `
      <div class="ng-montecarlo-row">
        <span class="ng-montecarlo-label">Most likely:</span>
        <span class="ng-montecarlo-value">${formatDateFull(result.medianFinishDate)}</span>
      </div>
      <div class="ng-montecarlo-row">
        <span class="ng-montecarlo-label">Std deviation:</span>
        <span class="ng-montecarlo-value">${result.standardDeviation.toFixed(1)} days</span>
      </div>
    `;

    if (highestRiskId && highestRiskFreq > 0) {
      const pctStr = Math.round(highestRiskFreq * 100);
      html += `
        <div class="ng-montecarlo-risk">
          Highest risk: ${highestRiskName} (on critical path ${pctStr}% of runs)
        </div>
      `;
    }

    summaryBox.innerHTML = html;

    // Attach close button handler
    const closeBtn = summaryBox.querySelector('.ng-montecarlo-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => toggleOverlay());
    }
  }

  // ── Canvas Rendering ──────────────────────────────────────────────────

  function renderHistogram(
    ctx: CanvasRenderingContext2D,
    state: GanttState,
  ): void {
    if (!result || !host || result.finishDates.length === 0) return;

    const timeScale = host.getTimeScale();
    const { headerHeight } = state.config;
    const scrollX = state.scrollX;
    const canvasWidth = ctx.canvas.width / (window.devicePixelRatio || 1);
    const canvasHeight = ctx.canvas.height / (window.devicePixelRatio || 1);
    const bodyTop = headerHeight;
    const bodyHeight = canvasHeight - bodyTop;

    const earliest = result.earliestFinish;
    const latest = result.latestFinish;
    const rangeDays = Math.max(diffDays(earliest, latest), 1);

    // ── Build histogram bins ────────────────────────────────────────────
    const colWidth = timeScale.getColumnWidth();
    const binWidthPx = Math.max(colWidth, HISTOGRAM_BAR_WIDTH_MIN);
    const numBins = Math.max(Math.ceil(rangeDays), 1);
    const bins = new Uint32Array(numBins);

    for (const date of result.finishDates) {
      const day = diffDays(earliest, date);
      const bin = Math.min(Math.max(Math.floor(day), 0), numBins - 1);
      bins[bin]++;
    }

    // Find max bin for normalization
    let maxBin = 0;
    for (let i = 0; i < numBins; i++) {
      if (bins[i] > maxBin) maxBin = bins[i];
    }
    if (maxBin === 0) return;

    ctx.save();

    // Clip to body area
    ctx.beginPath();
    ctx.rect(0, bodyTop, canvasWidth, bodyHeight);
    ctx.clip();
    ctx.translate(-scrollX, 0);

    // ── Draw confidence cone (P10 to P90) ───────────────────────────────
    const p10Date = result.finishDates[Math.floor(result.finishDates.length * 0.1)];
    const p90Date = result.finishDates[Math.floor(result.finishDates.length * 0.9)];

    if (p10Date && p90Date) {
      const coneLeftX = timeScale.dateToX(p10Date);
      const coneRightX = timeScale.dateToX(p90Date);

      const gradient = ctx.createLinearGradient(coneLeftX, 0, coneRightX, 0);
      gradient.addColorStop(0, 'rgba(34, 197, 94, 0.0)');
      gradient.addColorStop(0.3, 'rgba(234, 179, 8, 0.12)');
      gradient.addColorStop(0.7, 'rgba(249, 115, 22, 0.12)');
      gradient.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

      ctx.fillStyle = gradient;
      ctx.globalAlpha = CONFIDENCE_CONE_OPACITY * 5;
      ctx.fillRect(coneLeftX, bodyTop, coneRightX - coneLeftX, bodyHeight);
      ctx.globalAlpha = 1;
    }

    // ── Draw histogram bars ─────────────────────────────────────────────
    const histBottom = canvasHeight - 8;

    for (let i = 0; i < numBins; i++) {
      if (bins[i] === 0) continue;

      const date = addDays(earliest, i);
      const x = timeScale.dateToX(date);
      const barH = (bins[i] / maxBin) * HISTOGRAM_MAX_HEIGHT;

      // Color gradient: green (early) -> yellow -> red (late)
      const t = numBins > 1 ? i / (numBins - 1) : 0.5;
      let r: number, g: number, b: number;
      if (t < 0.5) {
        // green to yellow
        const s = t * 2;
        r = Math.round(34 + (234 - 34) * s);
        g = Math.round(197 + (179 - 197) * s);
        b = Math.round(94 + (8 - 94) * s);
      } else {
        // yellow to red
        const s = (t - 0.5) * 2;
        r = Math.round(234 + (239 - 234) * s);
        g = Math.round(179 + (68 - 179) * s);
        b = Math.round(8 + (68 - 8) * s);
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
      ctx.fillRect(x, histBottom - barH, Math.max(binWidthPx - 1, 1), barH);
    }

    // ── Draw percentile lines ───────────────────────────────────────────
    ctx.setLineDash(PERCENTILE_DASH);
    ctx.lineWidth = 1.5;

    for (const [level, date] of result.percentiles) {
      const x = timeScale.dateToX(date);
      const color = PERCENTILE_COLORS[level] || '#94A3B8';
      const label = `P${Math.round(level * 100)}`;

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, bodyTop);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();

      // Label at top
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = `600 10px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Background pill for label
      const textWidth = ctx.measureText(`${label}: ${formatDate(date)}`).width;
      const labelText = `${label}: ${formatDate(date)}`;
      const pillW = textWidth + 8;
      const pillH = 16;
      const pillX = x - pillW / 2;
      const pillY = bodyTop + 4;

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.moveTo(pillX + 3, pillY);
      ctx.lineTo(pillX + pillW - 3, pillY);
      ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + 3, 3);
      ctx.lineTo(pillX + pillW, pillY + pillH - 3);
      ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - 3, pillY + pillH, 3);
      ctx.lineTo(pillX + 3, pillY + pillH);
      ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - 3, 3);
      ctx.lineTo(pillX, pillY + 3);
      ctx.arcTo(pillX, pillY, pillX + 3, pillY, 3);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillText(labelText, x, pillY + 3);

      ctx.setLineDash(PERCENTILE_DASH);
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Plugin Interface ──────────────────────────────────────────────────

  return {
    name: 'MonteCarloPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      injectStyles();

      unsubs.push(
        gantt.on('montecarlo:run', (...args: unknown[]) => {
          const overrides = args[0] as Partial<SimulationConfig> | undefined;
          run(overrides);
        }),
        gantt.on('montecarlo:result', (...args: unknown[]) => {
          const callback = args[0] as ((r: SimulationResult | null) => void) | undefined;
          if (typeof callback === 'function') {
            callback(result);
          }
        }),
        gantt.on('montecarlo:toggle-overlay', () => toggleOverlay()),
        gantt.on('montecarlo:configure', (...args: unknown[]) => {
          const newConfig = args[0] as Partial<SimulationConfig> | undefined;
          if (newConfig) updateConfig(newConfig);
        }),
      );

      // Run initial simulation after data is available
      unsubs.push(
        gantt.on('stateChange', () => {
          // Auto-run on first state change that has tasks
          if (!result && host) {
            const state = host.getState();
            if (state.tasks.size > 0) {
              run();
            }
          }
        }),
      );
    },

    middleware(action: Action, next: (action: Action) => void): void {
      next(action);

      // Re-run simulation when data changes significantly
      const rerunActions = new Set<string>([
        'SET_DATA', 'TASK_MOVE', 'TASK_RESIZE', 'ADD_TASK',
        'REMOVE_TASK', 'ADD_DEPENDENCY', 'REMOVE_DEPENDENCY',
      ]);

      if (rerunActions.has(action.type) && host) {
        run();
      }
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      _layouts: TaskLayout[],
    ): void {
      if (!overlayVisible || !result) return;
      renderHistogram(ctx, state);
    },

    renderDOM(container: HTMLElement, state: GanttState): void {
      if (!summaryBox) {
        summaryBox = document.createElement('div');
        summaryBox.className = 'ng-montecarlo-summary' + (overlayVisible ? '' : ' ng-hidden');
        container.appendChild(summaryBox);
      }

      if (result) {
        updateSummaryBox();
      }
    },

    destroy(): void {
      for (const unsub of unsubs) {
        unsub();
      }
      unsubs.length = 0;

      if (summaryBox) {
        summaryBox.remove();
        summaryBox = null;
      }

      removeStyles();
      result = null;
      host = null;
    },
  };
}
