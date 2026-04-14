/**
 * pipeline.ts — Task building, filtering, stats, and depth-map computation.
 * Ported from deliverytimeline.resource (DeliveryTimeline v5).
 */

import type { NormalizedTask, MappedTask, PriorityBucket } from './types';

/* ── Priority buckets (matches CLOUD_NIMBUS_PRIORITY_BUCKETS) ──────────── */
export const DEFAULT_PRIORITY_BUCKETS: PriorityBucket[] = [
  { id: 'top-priority', label: 'NOW',      color: '#dc2626', bgTint: '#ef4444', order: 0 },
  { id: 'active',       label: 'NEXT',     color: '#d97706', bgTint: '#f59e0b', order: 1 },
  { id: 'follow-on',   label: 'PLANNED',  color: '#059669', bgTint: '#10b981', order: 2 },
  { id: 'proposed',    label: 'PROPOSED', color: '#2563eb', bgTint: '#3b82f6', order: 3 },
  { id: 'deferred',    label: 'HOLD',     color: '#94a3b8', bgTint: '#94a3b8', order: 4 },
];

/* ── Group bar colors ───────────────────────────────────────────────────── */
export const GROUP_BAR: Record<string, string> = {
  'top-priority': '#f87171',
  'active':       '#fbbf24',
  'follow-on':    '#34d399',
  'proposed':     '#60a5fa',
  'deferred':     '#cbd5e1',
};

/* ── Stage colors ───────────────────────────────────────────────────────── */
export const STAGE_COLORS: Record<string, string> = {
  'Backlog':                '#64748b',
  'Scoping In Progress':    '#64748b',
  'Ready for Sizing':       '#3b82f6',
  'Ready for Development':  '#22c55e',
  'In Development':         '#22c55e',
  'Ready for QA':           '#a855f7',
  'QA In Progress':         '#a855f7',
  'Ready for Client UAT':   '#14b8a6',
  'In Client UAT':          '#14b8a6',
  'Ready for UAT Sign-off': '#14b8a6',
  'Ready for Deployment':   '#f97316',
  'Deploying':              '#f97316',
  'Done':                   '#9ca3af',
  'Deployed to Prod':       '#9ca3af',
  'Cancelled':              '#cbd5e1',
  'Paused':                 '#94a3b8',
  'On Hold':                '#94a3b8',
  'Blocked':                '#ef4444',
};

export const DONE_STAGES: Record<string, boolean> = {
  'Done': true,
  'Deployed to Prod': true,
  'Cancelled': true,
};

/* ── Stage → category bar color (matches v8 CATEGORY_COLORS) ───────────── */
// Leaf (non-parent) tasks are coloured by their workflow stage, grouped into
// the same four visual categories the cloudnimbusllc.com v8 page uses.
export const STAGE_TO_CATEGORY_COLOR: Record<string, string> = {
  // In Flight — active development (green)
  'In Development':          '#10b981',
  'QA In Progress':          '#10b981',
  'In Client UAT':           '#10b981',
  'Deploying':               '#10b981',
  // Next Up — ready/queued (blue)
  'Ready for Development':   '#3b82f6',
  'Ready for QA':            '#3b82f6',
  'Ready for Client UAT':    '#3b82f6',
  'Ready for UAT Sign-off':  '#3b82f6',
  'Ready for Deployment':    '#3b82f6',
  'Ready for Sizing':        '#3b82f6',
  'Scoping In Progress':     '#3b82f6',
  // Backlog (amber)
  'Backlog':                 '#f59e0b',
  // Paused / Blocked
  'Paused':                  '#94a3b8',
  'On Hold':                 '#94a3b8',
  'Blocked':                 '#ef4444',
  // Done (muted slate)
  'Done':                    '#cbd5e1',
  'Deployed to Prod':        '#cbd5e1',
  'Cancelled':               '#cbd5e1',
};

/* ── Date utilities ─────────────────────────────────────────────────────── */
function pad(n: number): string { return n < 10 ? '0' + n : String(n); }

export function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function addMonths(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function darkenColor(hex: string, f: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const ch = (s: number) => Math.max(0, Math.round(parseInt(h.substring(s, s + 2), 16) * (1 - f)));
  const x2 = (n: number) => { const s = n.toString(16); return s.length < 2 ? '0' + s : s; };
  return '#' + x2(ch(0)) + x2(ch(2)) + x2(ch(4));
}

export function isBucketId(id: string): boolean {
  return !!(id && (id.indexOf('__bucket_header__') === 0 || id.indexOf('group-') === 0));
}

/* ══════════════════════════════════════════════════════════════════════════
   DEPTH MAP  (mirrors proForma parentId graph — uses parentWorkItemId)
══════════════════════════════════════════════════════════════════════════ */
export function buildDepthMap(tasks: NormalizedTask[]): Record<string, number> {
  const byId: Record<string, NormalizedTask> = {};
  const dm: Record<string, number> = {};
  tasks.forEach(t => { byId[t.id] = t; });

  function depth(id: string): number {
    if (dm[id] !== undefined) return dm[id];
    const t = byId[id];
    if (!t || !t.parentWorkItemId || !byId[t.parentWorkItemId]) { dm[id] = 0; return 0; }
    dm[id] = 1 + depth(t.parentWorkItemId as string);
    return dm[id];
  }

  tasks.forEach(t => { depth(t.id); });
  return dm;
}

/* ══════════════════════════════════════════════════════════════════════════
   TASK PIPELINE  (mirrors v5 nimbusGanttTasks memo chain)
══════════════════════════════════════════════════════════════════════════ */
export function buildTasks(tasks: NormalizedTask[]): MappedTask[] {
  const today = todayISO();
  const fallback = addMonths(today, -1);

  // Build an id→task lookup for root-group resolution
  const byId: Record<string, NormalizedTask> = {};
  tasks.forEach(t => { byId[t.id] = t; });

  /** Walk up through parentWorkItemId until we hit a top-level item and return its priorityGroup */
  function resolveRootGroup(id: string, visited: Record<string, boolean> = {}): string | null {
    if (visited[id]) return null;
    visited[id] = true;
    const t = byId[id];
    if (!t) return null;
    if (!t.parentWorkItemId || !byId[t.parentWorkItemId as string]) return t.priorityGroup || null;
    return resolveRootGroup(t.parentWorkItemId as string, visited);
  }

  /* Pass 1: basic map */
  const mapped: MappedTask[] = tasks.map(t => {
    const hrs    = t.estimatedHours ? Math.round(Number(t.estimatedHours)) : 0;
    const logged = t.loggedHours    ? Number(t.loggedHours) : 0;
    const pct    = hrs > 0 ? Math.round(logged / hrs * 100) : 0;
    const hLabel = hrs > 0 ? (logged > 0 ? hrs + 'h (' + pct + '%)' : hrs + 'h') : '';
    const gid    = t.parentWorkItemId ? null : (t.priorityGroup || null);
    // Top-level items get their priority-group bar color.
    // Children (leaves) get the v8 category color derived from workflow stage.
    // Nested parents (items with parentWorkItemId that are ALSO parents) will be
    // recoloured in pass 3 to use their root group's GROUP_BAR color.
    const col    = gid ? (GROUP_BAR[gid] || '#94a3b8') : (STAGE_TO_CATEGORY_COLOR[t.stage || ''] || STAGE_COLORS[t.stage || ''] || '#94a3b8');
    const start  = t.startDate || fallback;
    const end    = t.endDate   || addDays(start, 14);
    return {
      id: t.id,
      title: t.title || t.name || t.id,
      name: hrs > 0 ? (logged > 0 ? hrs + 'h (' + pct + '%)' : hrs + 'h') : '',
      hoursLabel: hLabel,
      startDate: start,
      endDate: end,
      progress: hrs > 0 ? Math.min(logged / hrs, 1) : 0,
      status: t.stage || '',
      color: col,
      groupId: gid,
      parentId: t.parentWorkItemId || undefined,
      sortOrder: Number(t.sortOrder) || 0,
      isInactive: !!t.isInactive,
      metadata: { hoursHigh: hrs, hoursLogged: logged },
    };
  });

  /* Pass 2: detect parents */
  const parentIds: Record<string, boolean> = {};
  const childCounts: Record<string, number> = {};
  mapped.forEach(t => {
    if (t.parentId) {
      parentIds[t.parentId] = true;
      childCounts[t.parentId] = (childCounts[t.parentId] || 0) + 1;
    }
  });

  /* Pass 3: expand parent date spans from descendants */
  function descDates(pid: string, vis: Record<string, boolean> = {}): { s: string[]; e: string[] } {
    if (vis[pid]) return { s: [], e: [] };
    vis[pid] = true;
    const r: { s: string[]; e: string[] } = { s: [], e: [] };
    mapped.forEach(t => {
      if (t.parentId !== pid) return;
      if (t.startDate) r.s.push(t.startDate);
      if (t.endDate)   r.e.push(t.endDate);
      if (parentIds[t.id]) {
        const sub = descDates(t.id, vis);
        r.s = r.s.concat(sub.s);
        r.e = r.e.concat(sub.e);
      }
    });
    return r;
  }

  return mapped.map(t => {
    if (!parentIds[t.id]) return t;
    const count = childCounts[t.id] || 0;
    const dd = descDates(t.id);
    const allS = [t.startDate].concat(dd.s).filter(Boolean).sort() as string[];
    const allE = [t.endDate].concat(dd.e).filter(Boolean).sort() as string[];

    // All parent bars (at any depth) use their root bucket's GROUP_BAR color, darkened.
    // This matches v8: isParent → darkenColor(GROUP_BAR_COLORS[rootGroup], depth*0.15 + 0.25).
    // We simplify to a flat 0.25 darkening since depth info isn't tracked separately.
    const rootGroup = resolveRootGroup(t.id);
    const parentBaseColor = rootGroup ? (GROUP_BAR[rootGroup] || '#94a3b8') : (t.color || '#64748b');

    return {
      id: t.id,
      title: t.title,
      name: t.name + (count > 0 ? ' · ' + count + ' items' : ''),
      hoursLabel: t.hoursLabel,
      startDate: allS.length ? allS[0] : t.startDate,
      endDate: allE.length ? allE[allE.length - 1] : t.endDate,
      progress: t.progress,
      status: t.status,
      // Darken the root bucket's bar color — all parent bars share the same hue family
      color: darkenColor(parentBaseColor, 0.25),
      groupId: t.groupId,
      parentId: t.parentId,
      sortOrder: t.sortOrder,
      isInactive: t.isInactive,
      metadata: t.metadata,
      isParent: true,
    };
  });
}

/* Epic-mode: use top-level parentWorkItemId as groupId instead of priorityGroup */
export function buildTasksEpic(tasks: NormalizedTask[]): NormalizedTask[] {
  const epicIds: Record<string, boolean> = {};
  tasks.forEach(t => { if (!t.parentWorkItemId) epicIds[t.id] = true; });

  const taskById: Record<string, NormalizedTask> = {};
  tasks.forEach(t => { taskById[t.id] = t; });

  function getEpic(id: string, visited: Record<string, boolean> = {}): string {
    if (visited[id]) return id;
    visited[id] = true;
    if (epicIds[id]) return id;
    const t = taskById[id];
    if (!t || !t.parentWorkItemId) return id;
    return getEpic(t.parentWorkItemId as string, visited);
  }

  return tasks.map(t => {
    const epic = getEpic(t.id);
    return {
      ...t,
      parentWorkItemId: t.id === epic ? null : t.parentWorkItemId,
      _epicGroupId: epicIds[t.id] ? t.id : null,
    } as NormalizedTask;
  });
}

const PROPOSAL_STAGES: Record<string, boolean> = {
  'Backlog': true, 'Scoping In Progress': true, 'Ready for Sizing': true,
  'Ready for Development': true,
};

/* ── Filter — matches v8 filter options exactly ─────────────────────────── */
export function applyFilter(
  tasks: NormalizedTask[],
  filter: 'all' | 'active' | 'proposal' | 'done' | 'real' | 'workstreams',
  q: string,
): NormalizedTask[] {
  let r = tasks;
  if (filter === 'active') {
    r = r.filter(t => !DONE_STAGES[t.stage || ''] && !t.isInactive);
  } else if (filter === 'proposal') {
    r = r.filter(t => PROPOSAL_STAGES[t.stage || ''] || t.priorityGroup === 'proposed');
  } else if (filter === 'done') {
    r = r.filter(t => !!DONE_STAGES[t.stage || '']);
  } else if (filter === 'real') {
    r = r.filter(t => !!(t.id && t.id.indexOf('T-') === 0));
  } else if (filter === 'workstreams') {
    r = r.filter(t => !!(t.id && t.id.indexOf('WS-') === 0));
  }
  if (q) {
    const ql = q.toLowerCase();
    r = r.filter(t => t.title && t.title.toLowerCase().indexOf(ql) !== -1);
  }
  return r;
}

/* ── Stats ──────────────────────────────────────────────────────────────── */
export interface TaskStats {
  total: number;
  scheduled: number;
  /** Tasks missing startDate or endDate */
  needDates: number;
  est: number;
  /** Lower bound of estimate envelope — equals est when no task has estimatedHoursLow */
  estLow: number;
  logged: number;
  counts: Record<string, number>;
  /** Per-category counts derived from stage (In Flight, Next Up, Backlog, Paused, Blocked, Done) */
  categoryCounts: Record<string, number>;
}

/** Map stage → v8 category label */
function stageToCategory(stage: string): string {
  const s = stage || '';
  if (STAGE_TO_CATEGORY_COLOR[s] === '#10b981') return 'In Flight';
  if (STAGE_TO_CATEGORY_COLOR[s] === '#3b82f6') return 'Next Up';
  if (STAGE_TO_CATEGORY_COLOR[s] === '#f59e0b') return 'Backlog';
  if (STAGE_TO_CATEGORY_COLOR[s] === '#ef4444') return 'Blocked';
  if (STAGE_TO_CATEGORY_COLOR[s] === '#cbd5e1') return 'Done';
  if (STAGE_TO_CATEGORY_COLOR[s] === '#94a3b8') return 'Paused';
  return 'Paused'; // default for unrecognized stages
}

export function computeStats(tasks: NormalizedTask[]): TaskStats {
  const active = tasks.filter(t => !t.isInactive);
  const est    = active.reduce((s, t) => s + (Number(t.estimatedHours)    || 0), 0);
  const estLow = active.reduce((s, t) => s + (Number(t.estimatedHoursLow ?? t.estimatedHours) || 0), 0);
  const logged = active.reduce((s, t) => s + (Number(t.loggedHours)       || 0), 0);
  const sched     = active.filter(t => t.startDate && t.endDate).length;
  const needDates = active.filter(t => !t.startDate || !t.endDate).length;
  const counts: Record<string, number> = {
    'top-priority': 0, 'active': 0, 'follow-on': 0, 'proposed': 0, 'deferred': 0,
  };
  const categoryCounts: Record<string, number> = {
    'In Flight': 0, 'Next Up': 0, 'Backlog': 0, 'Paused': 0, 'Blocked': 0, 'Done': 0,
  };
  active.forEach(t => {
    if (t.priorityGroup && Object.prototype.hasOwnProperty.call(counts, t.priorityGroup)) {
      counts[t.priorityGroup]++;
    }
    const cat = stageToCategory(t.stage || '');
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  return { total: active.length, scheduled: sched, needDates, est: Math.round(est), estLow: Math.round(estLow), logged: Math.round(logged * 10) / 10, counts, categoryCounts };
}
