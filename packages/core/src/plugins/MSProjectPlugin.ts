// ─── MS Project Import/Export Plugin ────────────────────────────────────────
// Imports and exports Microsoft Project XML format (.xml). Supports:
//   - Task hierarchy via OutlineLevel
//   - Dependencies via PredecessorLink (FS/FF/SS/SF)
//   - Resource assignments
//   - Progress, milestones, summary tasks
//   - File upload via hidden <input> element

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttTask,
  GanttDependency,
  DependencyType,
  GanttState,
} from '../model/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MSProjectExportOptions {
  projectName?: string;
  author?: string;
  creationDate?: string;
  calendarName?: string;
}

export interface MSProjectImportResult {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MS_PROJECT_NS = 'http://schemas.microsoft.com/project';
const HOURS_PER_DAY = 8;
const TENTHS_PER_DAY = 4800; // MS Project lag unit: tenths of minutes per day
const MS_PER_DAY = 86_400_000;

/**
 * MS Project dependency type codes:
 *   0 = FF (Finish-to-Finish)
 *   1 = FS (Finish-to-Start)
 *   2 = SF (Start-to-Finish)
 *   3 = SS (Start-to-Start)
 */
const DEP_TYPE_MAP: Record<number, DependencyType> = {
  0: 'FF',
  1: 'FS',
  2: 'SF',
  3: 'SS',
};

const DEP_TYPE_REVERSE: Record<DependencyType, number> = {
  FF: 0,
  FS: 1,
  SF: 2,
  SS: 3,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD from an ISO datetime string like 2026-04-01T08:00:00 */
function extractDate(isoStr: string): string {
  if (!isoStr) return '';
  return isoStr.substring(0, 10);
}

/** Format a Date as ISO date string YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD to UTC Date */
function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Get text content of the first child element with a given tag name */
function getChildText(parent: Element, tagName: string): string {
  // Try namespace-aware lookup first, then local name fallback
  let el = parent.getElementsByTagNameNS(MS_PROJECT_NS, tagName)[0];
  if (!el) {
    el = parent.getElementsByTagName(tagName)[0];
  }
  return el?.textContent?.trim() ?? '';
}

/** Compute working days between two dates (excludes weekends) */
function workingDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start.getTime());
  while (current < end) {
    const dow = current.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return Math.max(count, 1);
}

/** Format a duration in working days as MS Project PT duration (e.g., PT80H0M0S) */
function formatDuration(workDays: number): string {
  const hours = workDays * HOURS_PER_DAY;
  return `PT${hours}H0M0S`;
}

/** Generate a unique string ID */
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Import Logic ───────────────────────────────────────────────────────────

export function importMSProjectXML(xmlString: string): MSProjectImportResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // Check for parse errors
  const parseError = doc.getElementsByTagName('parsererror');
  if (parseError.length > 0) {
    throw new Error(`MS Project XML parse error: ${parseError[0].textContent}`);
  }

  const root = doc.documentElement;

  // ── Parse Resources ──────────────────────────────────────────────────────
  const resourceMap = new Map<string, string>(); // UID → Name
  const resourceEls = root.getElementsByTagNameNS(MS_PROJECT_NS, 'Resource');
  const resourceElsFallback = resourceEls.length > 0 ? resourceEls : root.getElementsByTagName('Resource');

  for (let i = 0; i < resourceElsFallback.length; i++) {
    const el = resourceElsFallback[i];
    const uid = getChildText(el, 'UID');
    const name = getChildText(el, 'Name');
    if (uid && name) {
      resourceMap.set(uid, name);
    }
  }

  // ── Parse Assignments ────────────────────────────────────────────────────
  const taskResourceMap = new Map<string, string>(); // TaskUID → ResourceName
  const assignmentEls = root.getElementsByTagNameNS(MS_PROJECT_NS, 'Assignment');
  const assignmentElsFallback = assignmentEls.length > 0 ? assignmentEls : root.getElementsByTagName('Assignment');

  for (let i = 0; i < assignmentElsFallback.length; i++) {
    const el = assignmentElsFallback[i];
    const taskUID = getChildText(el, 'TaskUID');
    const resourceUID = getChildText(el, 'ResourceUID');
    if (taskUID && resourceUID) {
      const resourceName = resourceMap.get(resourceUID);
      if (resourceName) {
        taskResourceMap.set(taskUID, resourceName);
      }
    }
  }

  // ── Parse Tasks ──────────────────────────────────────────────────────────
  const tasks: GanttTask[] = [];
  const dependencies: GanttDependency[] = [];
  const taskEls = root.getElementsByTagNameNS(MS_PROJECT_NS, 'Task');
  const taskElsFallback = taskEls.length > 0 ? taskEls : root.getElementsByTagName('Task');

  // Track the parent stack by OutlineLevel for hierarchy building
  // parentStack[depth] = taskId of the last task at that depth
  const parentStack: string[] = [];
  let depIdCounter = 1;

  for (let i = 0; i < taskElsFallback.length; i++) {
    const el = taskElsFallback[i];
    const uid = getChildText(el, 'UID');
    const name = getChildText(el, 'Name');
    const startStr = getChildText(el, 'Start');
    const finishStr = getChildText(el, 'Finish');
    const percentComplete = getChildText(el, 'PercentComplete');
    const isSummary = getChildText(el, 'Summary') === '1';
    const isMilestone = getChildText(el, 'Milestone') === '1';
    const outlineLevel = parseInt(getChildText(el, 'OutlineLevel') || '0', 10);

    // Skip UID=0 (project summary task) unless it has meaningful content
    if (uid === '0' && !name) continue;

    const taskId = `msp-${uid}`;
    const startDate = extractDate(startStr);
    const endDate = extractDate(finishStr);

    // Skip tasks without valid dates (unless milestone)
    if (!startDate && !isMilestone) continue;

    // Determine parent from OutlineLevel
    let parentId: string | undefined;
    if (outlineLevel > 0 && parentStack[outlineLevel - 1]) {
      parentId = parentStack[outlineLevel - 1];
    }

    // Update parent stack
    parentStack[outlineLevel] = taskId;
    // Clear deeper levels to prevent stale references
    parentStack.length = outlineLevel + 1;

    const task: GanttTask = {
      id: taskId,
      name: name || `Task ${uid}`,
      startDate: startDate || endDate,
      endDate: endDate || startDate,
      progress: percentComplete ? parseInt(percentComplete, 10) / 100 : 0,
      isMilestone,
      parentId,
      sortOrder: i,
    };

    // Assign resource if available
    const assignee = taskResourceMap.get(uid);
    if (assignee) {
      task.assignee = assignee;
    }

    // Mark summary tasks as non-milestone parent groups
    if (isSummary) {
      task.metadata = { ...task.metadata, isSummary: true };
    }

    tasks.push(task);

    // ── Parse PredecessorLink elements within this Task ───────────────────
    const predLinks = el.getElementsByTagNameNS(MS_PROJECT_NS, 'PredecessorLink');
    const predLinksFallback = predLinks.length > 0 ? predLinks : el.getElementsByTagName('PredecessorLink');

    for (let j = 0; j < predLinksFallback.length; j++) {
      const linkEl = predLinksFallback[j];
      const predecessorUID = getChildText(linkEl, 'PredecessorUID');
      const typeCode = parseInt(getChildText(linkEl, 'Type') || '1', 10);
      const linkLagStr = getChildText(linkEl, 'LinkLag');
      const linkLag = linkLagStr ? parseInt(linkLagStr, 10) : 0;

      if (!predecessorUID || predecessorUID === '0') continue;

      const dep: GanttDependency = {
        id: `msp-dep-${depIdCounter++}`,
        source: `msp-${predecessorUID}`,
        target: taskId,
        type: DEP_TYPE_MAP[typeCode] ?? 'FS',
        lag: linkLag !== 0 ? linkLag / TENTHS_PER_DAY : undefined,
      };

      dependencies.push(dep);
    }
  }

  return { tasks, dependencies };
}

// ─── Export Logic ───────────────────────────────────────────────────────────

export function exportMSProjectXML(
  state: GanttState,
  options: MSProjectExportOptions = {},
): string {
  const {
    projectName = 'Nimbus Gantt Export',
    author = 'Nimbus Gantt',
    creationDate = new Date().toISOString().substring(0, 19),
    calendarName = 'Standard',
  } = options;

  // ── Build task hierarchy depth map ───────────────────────────────────────
  const taskArray = Array.from(state.tasks.values());
  const depArray = Array.from(state.dependencies.values());

  // Compute depth for each task based on parentId chain
  function getDepth(task: GanttTask): number {
    let depth = 1;
    let current: GanttTask | undefined = task;
    while (current?.parentId) {
      depth++;
      current = state.tasks.get(current.parentId);
    }
    return depth;
  }

  // Build outline numbers
  const childCounters = new Map<string, number>(); // parentId → next child index
  const outlineNumbers = new Map<string, string>();

  for (const task of taskArray) {
    const parentKey = task.parentId ?? '__root__';
    const counter = (childCounters.get(parentKey) ?? 0) + 1;
    childCounters.set(parentKey, counter);

    if (!task.parentId) {
      outlineNumbers.set(task.id, String(counter));
    } else {
      const parentOutline = outlineNumbers.get(task.parentId) ?? '0';
      outlineNumbers.set(task.id, `${parentOutline}.${counter}`);
    }
  }

  // Determine which tasks have children (are summary tasks)
  const parentIds = new Set<string>();
  for (const task of taskArray) {
    if (task.parentId) parentIds.add(task.parentId);
  }

  // Build UID map: taskId → sequential UID (starting from 1)
  const uidMap = new Map<string, number>();
  taskArray.forEach((task, index) => {
    uidMap.set(task.id, index + 1);
  });

  // ── Build dependency lookup: targetTaskId → predecessor dependencies ────
  const depsByTarget = new Map<string, GanttDependency[]>();
  for (const dep of depArray) {
    const list = depsByTarget.get(dep.target) ?? [];
    list.push(dep);
    depsByTarget.set(dep.target, list);
  }

  // ── Collect unique assignees as resources ───────────────────────────────
  const assignees = new Set<string>();
  for (const task of taskArray) {
    if (task.assignee) assignees.add(task.assignee);
  }
  const resourceList = Array.from(assignees);
  const resourceUidMap = new Map<string, number>();
  resourceList.forEach((name, index) => {
    resourceUidMap.set(name, index + 1);
  });

  // ── Generate XML ────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Project xmlns="http://schemas.microsoft.com/project">');
  lines.push(`  <Name>${xmlEscape(projectName)}</Name>`);
  lines.push(`  <Author>${xmlEscape(author)}</Author>`);
  lines.push(`  <CreationDate>${creationDate}</CreationDate>`);
  lines.push(`  <CalendarUID>1</CalendarUID>`);
  lines.push('  <Calendars>');
  lines.push('    <Calendar>');
  lines.push('      <UID>1</UID>');
  lines.push(`      <Name>${xmlEscape(calendarName)}</Name>`);
  lines.push('      <IsBaseCalendar>1</IsBaseCalendar>');
  lines.push('    </Calendar>');
  lines.push('  </Calendars>');

  // ── Tasks ────────────────────────────────────────────────────────────────
  lines.push('  <Tasks>');

  for (const task of taskArray) {
    const uid = uidMap.get(task.id) ?? 0;
    const depth = getDepth(task);
    const outlineNumber = outlineNumbers.get(task.id) ?? '1';
    const isSummary = parentIds.has(task.id);
    const isMilestone = task.isMilestone ?? false;

    const start = parseDate(task.startDate);
    const end = parseDate(task.endDate);
    const workDays = workingDaysBetween(start, end);
    const duration = formatDuration(workDays);
    const percentComplete = Math.round((task.progress ?? 0) * 100);

    lines.push('    <Task>');
    lines.push(`      <UID>${uid}</UID>`);
    lines.push(`      <ID>${uid}</ID>`);
    lines.push(`      <Name>${xmlEscape(task.name)}</Name>`);
    lines.push(`      <Start>${task.startDate}T08:00:00</Start>`);
    lines.push(`      <Finish>${task.endDate}T17:00:00</Finish>`);
    lines.push(`      <Duration>${duration}</Duration>`);
    lines.push(`      <PercentComplete>${percentComplete}</PercentComplete>`);
    lines.push(`      <Summary>${isSummary ? '1' : '0'}</Summary>`);
    lines.push(`      <Milestone>${isMilestone ? '1' : '0'}</Milestone>`);
    lines.push(`      <OutlineLevel>${depth}</OutlineLevel>`);
    lines.push(`      <OutlineNumber>${outlineNumber}</OutlineNumber>`);

    // Predecessor links
    const predecessors = depsByTarget.get(task.id);
    if (predecessors) {
      for (const dep of predecessors) {
        const predUID = uidMap.get(dep.source) ?? 0;
        if (predUID === 0) continue;
        const typeCode = DEP_TYPE_REVERSE[dep.type ?? 'FS'] ?? 1;
        const lagTenths = Math.round((dep.lag ?? 0) * TENTHS_PER_DAY);

        lines.push('      <PredecessorLink>');
        lines.push(`        <PredecessorUID>${predUID}</PredecessorUID>`);
        lines.push(`        <Type>${typeCode}</Type>`);
        lines.push(`        <LinkLag>${lagTenths}</LinkLag>`);
        lines.push('      </PredecessorLink>');
      }
    }

    lines.push('    </Task>');
  }

  lines.push('  </Tasks>');

  // ── Resources ────────────────────────────────────────────────────────────
  lines.push('  <Resources>');
  for (const name of resourceList) {
    const resUid = resourceUidMap.get(name) ?? 0;
    lines.push('    <Resource>');
    lines.push(`      <UID>${resUid}</UID>`);
    lines.push(`      <Name>${xmlEscape(name)}</Name>`);
    lines.push('    </Resource>');
  }
  lines.push('  </Resources>');

  // ── Assignments ──────────────────────────────────────────────────────────
  lines.push('  <Assignments>');
  let assignmentUid = 1;
  for (const task of taskArray) {
    if (!task.assignee) continue;
    const taskUid = uidMap.get(task.id) ?? 0;
    const resUid = resourceUidMap.get(task.assignee) ?? 0;
    if (taskUid === 0 || resUid === 0) continue;

    lines.push('    <Assignment>');
    lines.push(`      <UID>${assignmentUid++}</UID>`);
    lines.push(`      <TaskUID>${taskUid}</TaskUID>`);
    lines.push(`      <ResourceUID>${resUid}</ResourceUID>`);
    lines.push('    </Assignment>');
  }
  lines.push('  </Assignments>');

  lines.push('</Project>');

  return lines.join('\n');
}

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function MSProjectPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  let fileInput: HTMLInputElement | null = null;
  const unsubscribers: Array<() => void> = [];

  function handleFileUpload(): void {
    if (!host) return;

    // Create hidden file input
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.xml';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', () => {
        const file = fileInput?.files?.[0];
        if (!file || !host) return;

        const reader = new FileReader();
        reader.onload = (e) => {
          const xmlString = e.target?.result as string;
          if (!xmlString || !host) return;

          try {
            const result = importMSProjectXML(xmlString);
            host.dispatch({
              type: 'SET_DATA',
              tasks: result.tasks,
              dependencies: result.dependencies,
            });
          } catch (err) {
            console.error('[MSProjectPlugin] Import failed:', err);
          }
        };
        reader.readAsText(file);

        // Reset so the same file can be re-selected
        if (fileInput) fileInput.value = '';
      });
    }

    fileInput.click();
  }

  return {
    name: 'MSProjectPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // msproject:import — accepts XML string, dispatches SET_DATA
      unsubscribers.push(
        gantt.on('msproject:import', (...args: unknown[]) => {
          const xmlString = args[0] as string;
          if (!xmlString || typeof xmlString !== 'string') {
            console.error('[MSProjectPlugin] msproject:import requires an XML string argument');
            return;
          }

          try {
            const result = importMSProjectXML(xmlString);
            gantt.dispatch({
              type: 'SET_DATA',
              tasks: result.tasks,
              dependencies: result.dependencies,
            });
          } catch (err) {
            console.error('[MSProjectPlugin] Import failed:', err);
          }
        }),
      );

      // msproject:export — returns XML string via callback
      unsubscribers.push(
        gantt.on('msproject:export', (...args: unknown[]) => {
          const options = (args[0] as MSProjectExportOptions) ?? {};
          const callback = args[1] as ((xml: string) => void) | undefined;

          const state = gantt.getState();
          const xml = exportMSProjectXML(state, options);

          if (callback) {
            callback(xml);
          }
        }),
      );

      // msproject:upload — opens file picker for .xml import
      unsubscribers.push(
        gantt.on('msproject:upload', () => {
          handleFileUpload();
        }),
      );

      // msproject:download — exports and triggers browser download
      unsubscribers.push(
        gantt.on('msproject:download', (...args: unknown[]) => {
          const options = (args[0] as MSProjectExportOptions) ?? {};
          const filename = (args[1] as string) ?? 'project-export.xml';

          const state = gantt.getState();
          const xml = exportMSProjectXML(state, options);

          const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }),
      );
    },

    destroy(): void {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;

      if (fileInput) {
        fileInput.remove();
        fileInput = null;
      }

      host = null;
    },
  };
}
