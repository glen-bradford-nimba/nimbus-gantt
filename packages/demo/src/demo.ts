// ─── Nimbus Gantt Demo ──────────────────────────────────────────────────────
// Wires up the sample data, toolbar controls, and info panel for the demo page.

import { NimbusGantt } from '@nimbus-gantt/core';
import { sampleTasks, sampleDependencies, sampleColorMap } from './sample-data';
import type { GanttTask, ZoomLevel } from '@nimbus-gantt/core';

// ─── DOM References ────────────────────────────────────────────────────────

const container = document.getElementById('gantt-container')!;
const infoPanel = document.getElementById('task-info')!;

// ─── Status color helper ───────────────────────────────────────────────────

function statusColor(status?: string): string {
  return sampleColorMap[status || ''] || '#94a3b8';
}

function statusBg(status?: string): string {
  const hex = statusColor(status);
  // Return a very light background variant
  return hex + '18';
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

// ─── Initialize Gantt ──────────────────────────────────────────────────────

const gantt = new NimbusGantt(container, {
  tasks: sampleTasks,
  dependencies: sampleDependencies,
  colorMap: sampleColorMap,
  zoomLevel: 'week',
  columns: [
    { field: 'name', header: 'Task', width: 220, tree: true },
    { field: 'assignee', header: 'Assignee', width: 110 },
    { field: 'status', header: 'Status', width: 90 },
  ],
  onTaskClick: (task: GanttTask) => {
    showTaskInfo(task);
  },
});

// ─── Task Info Panel ───────────────────────────────────────────────────────

function showTaskInfo(task: GanttTask): void {
  const progress = Math.round((task.progress || 0) * 100);
  const color = statusColor(task.status);

  infoPanel.innerHTML = `
    <button class="info-close" id="info-close" aria-label="Close">&times;</button>
    <div class="info-header">
      <h3>${escapeHtml(task.name)}</h3>
      ${task.groupName ? `<div class="info-group">${escapeHtml(task.groupName)}</div>` : ''}
    </div>
    <div class="info-body">
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-status" style="background: ${statusBg(task.status)}; color: ${color};">
          <span class="info-status-dot" style="background: ${color};"></span>
          ${escapeHtml(task.status || 'None')}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Assignee</span>
        <span class="info-value">${escapeHtml(task.assignee || 'Unassigned')}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Start</span>
        <span class="info-value">${formatDate(task.startDate)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">End</span>
        <span class="info-value">${formatDate(task.endDate)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Progress</span>
        <span style="display: flex; align-items: center; gap: 8px;">
          <span class="info-value">${progress}%</span>
          <span class="info-progress-bar">
            <span class="info-progress-fill" style="width: ${progress}%; background: ${color};"></span>
          </span>
        </span>
      </div>
      ${task.isMilestone ? `
      <div class="info-row">
        <span class="info-label">Type</span>
        <span class="info-value">Milestone</span>
      </div>
      ` : ''}
    </div>
  `;

  infoPanel.classList.add('visible');

  // Wire close button
  document.getElementById('info-close')?.addEventListener('click', () => {
    infoPanel.classList.remove('visible');
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Close info panel on outside click ─────────────────────────────────────

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!infoPanel.contains(target) && !target.closest('#gantt-container')) {
    infoPanel.classList.remove('visible');
  }
});

// ─── Toolbar: Zoom Controls ────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelector('[data-zoom].active')?.classList.remove('active');
    btn.classList.add('active');
    gantt.setZoom(btn.dataset.zoom as ZoomLevel);
  });
});

// ─── Toolbar: Today ────────────────────────────────────────────────────────

document.getElementById('btn-today')!.addEventListener('click', () => {
  gantt.scrollToDate(new Date());
});

// ─── Toolbar: Expand / Collapse ────────────────────────────────────────────

document.getElementById('btn-expand')!.addEventListener('click', () => {
  gantt.expandAll();
});

document.getElementById('btn-collapse')!.addEventListener('click', () => {
  gantt.collapseAll();
});
