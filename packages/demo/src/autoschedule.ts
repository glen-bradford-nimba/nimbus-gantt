// AutoSchedule walkthrough demo — small dependency graph + Reschedule button.
// Proof point that 0.192.0's AutoSchedulePlugin works end-to-end against sample
// data, independent of any consumer integration timing.

import { NimbusGantt, AutoSchedulePlugin } from '@nimbus-gantt/core';
import type { GanttTask, GanttDependency } from '@nimbus-gantt/core';

const container = document.getElementById('gantt')!;
const resultEl = document.getElementById('result')!;
const slipBtn = document.getElementById('slip') as HTMLButtonElement;
const reBtn = document.getElementById('reschedule') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;

function d(base: Date, days: number): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

const TODAY = new Date(Date.UTC(2026, 4, 11));

function baselineTasks(): GanttTask[] {
  return [
    { id: 'A', name: 'A · Discovery',           startDate: d(TODAY,  0), endDate: d(TODAY, 13), status: 'Planning' },
    { id: 'B', name: 'B · Design',              startDate: d(TODAY, 15), endDate: d(TODAY, 24), status: 'Planning' },
    { id: 'C', name: 'C · Backend implementation', startDate: d(TODAY, 26), endDate: d(TODAY, 45), status: 'Development' },
    { id: 'D', name: 'D · Frontend implementation', startDate: d(TODAY, 26), endDate: d(TODAY, 40), status: 'Development' },
    { id: 'E', name: 'E · QA pass',             startDate: d(TODAY, 47), endDate: d(TODAY, 56), status: 'Testing' },
    { id: 'F', name: 'F · Launch',              startDate: d(TODAY, 58), endDate: d(TODAY, 60), status: 'Deployment' },
  ];
}

const dependencies: GanttDependency[] = [
  { id: 'dep-ab', source: 'A', target: 'B', type: 'FS', lag: 1 },
  { id: 'dep-bc', source: 'B', target: 'C', type: 'FS', lag: 1 },
  { id: 'dep-bd', source: 'B', target: 'D', type: 'FS', lag: 1 },
  { id: 'dep-ce', source: 'C', target: 'E', type: 'FS', lag: 1 },
  { id: 'dep-de', source: 'D', target: 'E', type: 'FS', lag: 1 },
  { id: 'dep-ef', source: 'E', target: 'F', type: 'FS', lag: 1 },
];

const colorMap: Record<string, string> = {
  Planning:   '#3b82f6',
  Development:'#22c55e',
  Testing:    '#a855f7',
  Deployment: '#f97316',
  Done:       '#6b7280',
};

let tasks = baselineTasks();

const gantt = new NimbusGantt(container, {
  tasks,
  dependencies,
  colorMap,
  zoomLevel: 'week',
  columns: [
    { field: 'name', header: 'Task', width: 220, tree: true },
    { field: 'startDate', header: 'Start', width: 100 },
    { field: 'endDate',   header: 'End',   width: 100 },
  ],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(gantt as any).use(AutoSchedulePlugin({ autoRun: false }));

function renderResult(headline: string, body: string, cls = ''): void {
  resultEl.className = cls;
  resultEl.textContent = headline + '\n\n' + body;
}

function snapshot(label: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = (gantt as any).getState?.() ?? { tasks: new Map() };
  const rows: string[] = [];
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const t = state.tasks.get?.(id);
    if (!t) continue;
    rows.push(`  ${id}: ${t.startDate} → ${t.endDate}`);
  }
  return `[${label}]\n${rows.join('\n')}`;
}

slipBtn.addEventListener('click', () => {
  // Move task A's end out by 7 days. Successors stay where they are (visible
  // gap) until Reschedule fires.
  tasks = tasks.map(t => t.id === 'A'
    ? { ...t, endDate: d(TODAY, 20) }
    : t);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gantt as any).setData?.(tasks, dependencies);
  renderResult(
    'A slipped — successors not yet rescheduled.',
    snapshot('after slip'),
  );
});

reBtn.addEventListener('click', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gantt as any).events?.emit?.('autoSchedule:run', (result: {
    scheduledTasks: Map<string, { startDate: string; endDate: string }>;
    violations: Array<{ taskId: string; message: string }>;
    projectStart: string;
    projectEnd: string;
  }) => {
    const moved: string[] = [];
    for (const [id, dates] of result.scheduledTasks) {
      moved.push(`  ${id}: ${dates.startDate} → ${dates.endDate}`);
    }
    const headline = `Scheduled ${result.scheduledTasks.size} tasks. Project ${result.projectStart} → ${result.projectEnd}.`;
    let body = moved.join('\n');
    if (result.violations.length) {
      body += '\n\nViolations:\n' + result.violations.map(v => `  ${v.taskId}: ${v.message}`).join('\n');
    }
    renderResult(headline, body);
  });
});

resetBtn.addEventListener('click', () => {
  tasks = baselineTasks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gantt as any).setData?.(tasks, dependencies);
  resultEl.className = 'empty';
  resultEl.textContent = 'Reset. Click "Reschedule" to run the plugin.';
});
