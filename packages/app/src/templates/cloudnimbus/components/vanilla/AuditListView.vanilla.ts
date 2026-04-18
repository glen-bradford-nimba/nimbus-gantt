/**
 * AuditListView.vanilla.ts — list-view audit of the gantt timeline.
 *
 * Port of cloudnimbusllc.com/src/components/gantt-demo/AuditListView.tsx
 * (~2,225 LOC, React + @hello-pangea/dnd) into vanilla DOM for the IIFE
 * bundle. Salesforce Locker Service consumes this — no React, no JSX, no
 * external drag-drop libs.
 *
 * 0.182 v0 scope (~30% of v9 surface, the visible + functional core):
 *   - Audit-view label header
 *   - 5 KPI pills (items, sized, needs-attention, dupes, ready/N)
 *   - Filter pill row (8 chips with counts)
 *   - Search input (substring on title/name/owner/mfRef/notes)
 *   - Sort dropdown (6 modes)
 *   - Per-bucket section dividers with rollup stats (count · h sized · h
 *     logged · N issues)
 *   - Per-row UI: drag handle (visual placeholder), chevron, name, title,
 *     progress, hours, date range, mfRef chip, audit-icon cluster
 *   - Row click → expand basic detail grid
 *
 * Deferred to 0.183 (per HQ scope-down 2026-04-18):
 *   - Drag-to-reorder (@hello-pangea/dnd doesn't port; would need
 *     sortablejs or HTML5 drag with custom visual feedback)
 *   - Inline edit form (12-field form + save/cancel callbacks)
 *   - Add-item modal (form + onAddItem callback)
 *   - Merge-dupes modal (side-by-side comparison)
 *   - Verify against DH (no /api/delivery-hub/work-items in nimbus-gantt
 *     consumer surface; SF would need its own Apex equivalent)
 *   - Submit pass (commits to proFormaPatches.ts via git — localhost-only)
 *   - Export menu (JSON/CSV/Markdown)
 *   - Proposal mode (filterProposalReady gate + banner)
 *
 * Data shape adaptation — v9 consumes ProFormaItem; we consume
 * NormalizedTask. Field bridge:
 *   v9 field          NormalizedTask         Notes
 *   ─────────────     ──────────────         ─────
 *   id                id
 *   title             title
 *   name              name
 *   group             priorityGroup          Bucket key (string)
 *   start, end        startDate, endDate     ISO YYYY-MM-DD
 *   hoursLow          estimatedHoursLow
 *   hoursHigh         estimatedHours
 *   hoursLogged       loggedHours
 *   owner             developerName
 *   stage             stage                  Direct
 *   sortOrder         sortOrder
 *   mfRef             — (no equivalent)      Empty string in display
 *   notes             — (no equivalent)      Empty
 *   category          derived from stage     done if DONE_STAGES[stage]
 *   dependencies      task.dependencies (if present, else [])
 *
 * Audit functions (computeAuditScore, findDupeCandidates, etc.) live in
 * cloudnimbusllc.com/src/lib/proFormaAudit.ts (not portable into nimbus-
 * gantt). v0 stubs everything to "no issues / no dupes" so filter pills
 * still render with sensible counts. Real audit logic ports in 0.183
 * alongside the helper file.
 */

import type { NormalizedTask } from '../../../../types';
import { DONE_STAGES } from '../../../../pipeline';
import { el, clear } from '../shared/el';

/* ── Bucket order + display labels (matches CLOUD_NIMBUS_PRIORITY_BUCKETS) ── */
const GROUP_ORDER = ['top-priority', 'active', 'follow-on', 'proposed', 'deferred'] as const;
type Group = typeof GROUP_ORDER[number];

const GROUP_LABELS: Record<Group, string> = {
  'top-priority': 'NOW',
  'active':       'NEXT',
  'follow-on':    'PLANNED',
  'proposed':     'PROPOSED',
  'deferred':     'HOLD',
};

const GROUP_COLORS: Record<Group, string> = {
  'top-priority': '#dc2626',
  'active':       '#d97706',
  'follow-on':    '#059669',
  'proposed':     '#2563eb',
  'deferred':     '#94a3b8',
};

const GROUP_BG: Record<Group, string> = {
  'top-priority': '#fef2f2',
  'active':       '#fffbeb',
  'follow-on':    '#ecfdf5',
  'proposed':     '#eff6ff',
  'deferred':     '#f8fafc',
};

/* ── Filter chips ──────────────────────────────────────────────────────── */
type FilterChip =
  | 'all' | 'needs-attention' | 'no-mf-ref' | 'no-mf-page'
  | 'no-owner' | 'no-dates' | 'no-hours' | 'dupes';

const FILTER_LABELS: Record<FilterChip, string> = {
  'all':              'All',
  'needs-attention':  'Needs attention',
  'dupes':            'Dupe candidates',
  'no-mf-ref':        'No mfRef',
  'no-mf-page':       'No docs page',
  'no-owner':         'No owner',
  'no-dates':         'No dates',
  'no-hours':         'Not sized',
};

/* ── Sort modes ────────────────────────────────────────────────────────── */
type SortKey = 'default' | 'hours-desc' | 'hours-asc' | 'owner' | 'last-activity' | 'audit-score';

const SORT_LABELS: Record<SortKey, string> = {
  'default':       'Sort: default',
  'hours-desc':    'Hours: high → low',
  'hours-asc':     'Hours: low → high',
  'owner':         'Owner',
  'last-activity': 'Last activity',
  'audit-score':   'Audit score',
};

/* ── Audit shape (stubbed; real audit logic ports in 0.183) ────────────── */
interface AuditFlags {
  hasMfRef: boolean;
  hasMfPage: boolean;
  hasOwner: boolean;
  hasDates: boolean;
  hasHours: boolean;
}

interface AuditIssue { severity: 'error' | 'warning' | 'info'; message: string; }

interface AuditResult {
  flags: AuditFlags;
  issues: AuditIssue[];
  score: number; // 0-100
}

/** Stub audit. Real implementation lives in cloudnimbusllc.com/src/lib/
 *  proFormaAudit.ts and ports in 0.183. v0 uses NormalizedTask field
 *  presence as the only signal — no severity scoring. */
function auditTask(task: NormalizedTask): AuditResult {
  const hasOwner = !!task.developerName;
  const hasDates = !!(task.startDate && task.endDate);
  const hasHours = !!(task.estimatedHours && task.estimatedHours > 0);
  const issues: AuditIssue[] = [];
  if (!hasOwner)  issues.push({ severity: 'warning', message: 'No owner assigned' });
  if (!hasDates)  issues.push({ severity: 'warning', message: 'No start/end dates' });
  if (!hasHours)  issues.push({ severity: 'warning', message: 'Not sized (no hours estimate)' });
  return {
    flags: {
      hasMfRef: false,   // NormalizedTask has no mfRef field
      hasMfPage: false,  // No docs-page lookup in v0
      hasOwner,
      hasDates,
      hasHours,
    },
    issues,
    score: hasOwner && hasDates && hasHours ? 100 : 50,
  };
}

/* ── KPIs (stubbed dupe count = 0; real dupe detection in 0.183) ───────── */
interface Kpis {
  totalItems:       number;
  totalSizedHours:  number;
  needsAttention:   number;
  dupeCount:        number;
  proposalReady:    number;
  proposalTotal:    number;
}

function computeKpis(tasks: NormalizedTask[], audits: Map<string, AuditResult>): Kpis {
  let totalSizedHours = 0;
  let needsAttention  = 0;
  let proposalReady   = 0;
  let proposalTotal   = 0;
  for (const t of tasks) {
    const h = t.estimatedHours || 0;
    totalSizedHours += h;
    const a = audits.get(t.id);
    if (a && a.issues.some((i) => i.severity === 'error' || i.severity === 'warning')) {
      needsAttention++;
    }
    // "Proposal ready" v0 stub: has owner + hours + dates AND not done.
    if (t.priorityGroup === 'proposed') {
      proposalTotal++;
      if (a && a.flags.hasOwner && a.flags.hasHours && a.flags.hasDates) {
        proposalReady++;
      }
    }
  }
  return {
    totalItems:      tasks.length,
    totalSizedHours: Math.round(totalSizedHours),
    needsAttention,
    dupeCount:       0,
    proposalReady,
    proposalTotal,
  };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */
function bucketOf(task: NormalizedTask): Group {
  // Safer than `as Group` — `priorityGroup` is `string | null | undefined`
  // per types.ts. Validate against the known set, fall back to `deferred`.
  const g = task.priorityGroup;
  if (g && (GROUP_ORDER as readonly string[]).indexOf(g) >= 0) return g as Group;
  return 'deferred';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[2] + '-' + m[3] : iso;
}

function fmtDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return '';
  return fmtDate(start) + ' → ' + fmtDate(end);
}

function progressOf(task: NormalizedTask): number | null {
  const high = task.estimatedHours || 0;
  const logged = task.loggedHours || 0;
  if (DONE_STAGES[task.stage || '']) return 100;
  if (!high) return null;
  return Math.min(100, Math.round((logged / high) * 100));
}

/* ── KPI pill builder ──────────────────────────────────────────────────── */
type KpiTone = 'slate' | 'emerald' | 'amber' | 'rose';

const KPI_TONES: Record<KpiTone, { bg: string; text: string }> = {
  slate:   { bg: '#f1f5f9', text: '#475569' },
  emerald: { bg: '#d1fae5', text: '#047857' },
  amber:   { bg: '#fef3c7', text: '#b45309' },
  rose:    { bg: '#ffe4e6', text: '#be123c' },
};

function kpiPill(label: string, value: string, tone: KpiTone): HTMLElement {
  const t = KPI_TONES[tone];
  const wrap = el('span', '');
  wrap.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:6px',
    'padding:3px 10px',
    'border-radius:9999px',
    'background:' + t.bg,
    'color:' + t.text,
    'font-size:11px',
    'font-weight:600',
    'white-space:nowrap',
  ].join(';');
  const v = el('span', '');
  v.style.cssText = 'font-weight:700';
  v.textContent = value;
  const l = el('span', '');
  l.style.cssText = 'opacity:0.85;font-weight:500';
  l.textContent = label;
  wrap.appendChild(v);
  wrap.appendChild(l);
  return wrap;
}

/* ── Audit icon cluster (mini) ─────────────────────────────────────────── */
function auditIcons(audit: AuditResult): HTMLElement {
  const wrap = el('span', '');
  wrap.style.cssText = 'display:inline-flex;gap:4px;font-size:11px;opacity:0.75;';
  function icon(glyph: string, ok: boolean, title: string): HTMLElement {
    const s = el('span', '');
    s.style.cssText = 'color:' + (ok ? '#10b981' : '#94a3b8');
    s.textContent = glyph;
    s.title = title;
    return s;
  }
  wrap.appendChild(icon('\u{1F464}', audit.flags.hasOwner, 'Owner'));
  wrap.appendChild(icon('\u{1F4C5}', audit.flags.hasDates, 'Dates'));
  wrap.appendChild(icon('\u{231B}',  audit.flags.hasHours, 'Hours estimated'));
  return wrap;
}

/* ── Public API ────────────────────────────────────────────────────────── */
export interface AuditListOptions {
  /** Optional click handler when the user clicks a row's title. v0
   *  doesn't dispatch row-clicks back to a parent state machine; consumers
   *  wanting in-app cross-view navigation can wire this. */
  onTaskClick?: (taskId: string) => void;
  /** Label prefix for the per-row progress % display. Default 'Budget
   *  Used' — the displayed % is `loggedHours / estimatedHours`, which
   *  is a budget tracker, not a true completion tracker. Pass an empty
   *  string to suppress the prefix entirely. */
  progressLabel?: string;
  /** When true (default), the per-row record-ID chip is hidden.
   *  Salesforce consumers fall through `task.name || task.id` to a raw
   *  18-char SF record ID (`a0D0300000...`), which should never reach
   *  end users (roadmap DM-2: names-not-IDs). Pass `false` from
   *  dev/debug contexts only. */
  hideRecordIds?: boolean;
}

/**
 * Render the audit list view into `host`. Returns a cleanup function that
 * the caller invokes when the view-mode switches away (rebuildView in
 * IIFEApp.ts handles this — the host's innerHTML is cleared on rebuild,
 * which detaches DOM listeners; this cleanup is a no-op currently but is
 * the right signature for future event-listener teardown).
 */
export function renderAuditListView(
  host: HTMLElement,
  tasks: NormalizedTask[],
  options?: AuditListOptions,
): () => void {
  // ── Local state (closure variables — manual re-render via render()) ────
  let search = '';
  let filterChip: FilterChip = 'all';
  let sortKey: SortKey = 'default';
  const collapsedBuckets = new Set<Group>();
  const expandedIds = new Set<string>();
  // Per-row % prefix; 'Budget Used' is the 0.182 default (hours logged /
  // hours estimated — tracks budget consumption, not completion).
  const progressLabel = options?.progressLabel ?? 'Budget Used';
  // Default-hide record IDs (CHANGE 4 from 2026-04-18 HQ). SF consumers
  // fall through task.name || task.id to the 18-char SF record ID which
  // should never reach end users.
  const hideRecordIds = options?.hideRecordIds ?? true;

  // Compute audits once per task list; re-compute on data change. Tasks
  // change only when consumer calls renderAuditListView again with new
  // data, so we capture into a stable Map keyed by task.id.
  const audits = new Map<string, AuditResult>();
  for (const t of tasks) audits.set(t.id, auditTask(t));

  const dupeIds = new Set<string>(); // 0.183: real dupe detection

  // ── Filtering (re-computed on every render) ────────────────────────────
  function getFilteredTasks(): NormalizedTask[] {
    let result = tasks;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) => {
        const hay = [
          t.title || '',
          t.name || '',
          t.developerName || '',
          (t.stage || ''),
          // mfRef + notes have no equivalent on NormalizedTask; skip.
        ].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    if (filterChip !== 'all') {
      result = result.filter((t) => {
        const a = audits.get(t.id);
        if (!a) return false;
        switch (filterChip) {
          case 'needs-attention':
            return a.issues.some((i) => i.severity === 'error' || i.severity === 'warning');
          case 'no-mf-ref':  return !a.flags.hasMfRef;
          case 'no-mf-page': return !a.flags.hasMfPage;
          case 'no-owner':   return !a.flags.hasOwner;
          case 'no-dates':   return !a.flags.hasDates;
          case 'no-hours':   return !a.flags.hasHours;
          case 'dupes':      return dupeIds.has(t.id);
          default:           return true;
        }
      });
    }
    return result;
  }

  // ── Sorting (in-place per bucket) ──────────────────────────────────────
  function sortTasks(arr: NormalizedTask[]): NormalizedTask[] {
    if (sortKey === 'default') {
      return arr.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }
    const out = arr.slice();
    if (sortKey === 'hours-desc') {
      out.sort((a, b) => (b.estimatedHours || 0) - (a.estimatedHours || 0));
    } else if (sortKey === 'hours-asc') {
      out.sort((a, b) => (a.estimatedHours || 0) - (b.estimatedHours || 0));
    } else if (sortKey === 'owner') {
      out.sort((a, b) => (a.developerName || '').localeCompare(b.developerName || ''));
    } else if (sortKey === 'last-activity') {
      // v0: NormalizedTask has no lastActivity. Fall back to endDate desc.
      out.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
    } else if (sortKey === 'audit-score') {
      out.sort((a, b) => (audits.get(a.id)?.score || 0) - (audits.get(b.id)?.score || 0));
    }
    return out;
  }

  // ── Per-bucket grouping + stats ────────────────────────────────────────
  function groupByBucket(filtered: NormalizedTask[]): Map<Group, NormalizedTask[]> {
    const m = new Map<Group, NormalizedTask[]>();
    for (const g of GROUP_ORDER) m.set(g, []);
    for (const t of filtered) {
      const b = bucketOf(t);
      m.get(b)!.push(t);
    }
    for (const g of GROUP_ORDER) {
      m.set(g, sortTasks(m.get(g)!));
    }
    return m;
  }

  function bucketStats(bucketTasks: NormalizedTask[]): {
    count: number; hours: number; logged: number; issues: number;
  } {
    let hours = 0, logged = 0, issues = 0;
    for (const t of bucketTasks) {
      hours  += t.estimatedHours || 0;
      logged += t.loggedHours || 0;
      const a = audits.get(t.id);
      if (a && a.issues.some((i) => i.severity === 'error' || i.severity === 'warning')) {
        issues++;
      }
    }
    return { count: bucketTasks.length, hours: Math.round(hours), logged: Math.round(logged), issues };
  }

  // ── Filter chip counts (always over the unfiltered task list) ──────────
  function filterCounts(): Record<FilterChip, number> {
    const counts: Record<FilterChip, number> = {
      'all': tasks.length, 'needs-attention': 0, 'no-mf-ref': 0, 'no-mf-page': 0,
      'no-owner': 0, 'no-dates': 0, 'no-hours': 0, 'dupes': 0,
    };
    for (const t of tasks) {
      const a = audits.get(t.id);
      if (!a) continue;
      if (a.issues.some((i) => i.severity === 'error' || i.severity === 'warning')) counts['needs-attention']++;
      if (!a.flags.hasMfRef)  counts['no-mf-ref']++;
      if (!a.flags.hasMfPage) counts['no-mf-page']++;
      if (!a.flags.hasOwner)  counts['no-owner']++;
      if (!a.flags.hasDates)  counts['no-dates']++;
      if (!a.flags.hasHours)  counts['no-hours']++;
      if (dupeIds.has(t.id))  counts['dupes']++;
    }
    return counts;
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  // Architecture: stable-header + reactive-body.
  // The shell (host styling, header with KPI bar / audit label / search
  // input / sort select / filter pill row) is built ONCE during the
  // initial mount. Subsequent state changes (filter chip click, sort
  // change, search keystroke, expand/collapse, bucket collapse) ONLY
  // re-render the body section, leaving the header DOM nodes intact.
  // Critically, this preserves search-input focus + caret position
  // through every keystroke — a full clear+rebuild would teardown the
  // input element on every char (mid-string cursor jump regression).
  // The filter pill row's active-state styling updates in-place via
  // updateFilterPillStyles() rather than rebuilding the buttons.

  // References captured during shell mount, mutated by reactive paths.
  let bodyEl: HTMLElement | null = null;
  let clearLink: HTMLElement | null = null;
  const filterPillBtns = new Map<FilterChip, HTMLElement>();
  const filterPillCnts = new Map<FilterChip, HTMLElement>();

  function applyFilterPillStyles(chip: FilterChip): void {
    const btn = filterPillBtns.get(chip);
    const cnt = filterPillCnts.get(chip);
    if (!btn || !cnt) return;
    const isActive = chip === filterChip;
    btn.style.cssText = [
      'padding:4px 10px',
      'border-radius:9999px',
      'border:1px solid ' + (isActive ? '#3b82f6' : '#e2e8f0'),
      'background:' + (isActive ? '#3b82f6' : '#ffffff'),
      'color:' + (isActive ? '#ffffff' : '#475569'),
      'font-size:11px',
      'font-weight:600',
      'cursor:pointer',
      'display:inline-flex',
      'align-items:center',
      'gap:5px',
    ].join(';');
    cnt.style.cssText = [
      'padding:0 6px',
      'border-radius:9999px',
      'background:' + (isActive ? 'rgba(255,255,255,0.25)' : '#f1f5f9'),
      'color:' + (isActive ? '#ffffff' : '#64748b'),
      'font-size:10px',
      'font-weight:700',
    ].join(';');
  }

  function updateFilterPillStyles(): void {
    (Object.keys(FILTER_LABELS) as FilterChip[]).forEach((chip) => {
      applyFilterPillStyles(chip);
    });
  }

  function updateClearLinkVisibility(): void {
    if (!clearLink) return;
    const anyFilter = filterChip !== 'all' || search.trim() !== '' || sortKey !== 'default';
    clearLink.style.display = anyFilter ? '' : 'none';
  }

  function resetAllFilters(): void {
    search = ''; filterChip = 'all'; sortKey = 'default';
    // Resync stable header inputs to the cleared state.
    const searchInput = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (searchInput) searchInput.value = '';
    const sortSel = host.querySelector<HTMLSelectElement>('select[data-nga-audit-sort]');
    if (sortSel) sortSel.value = 'default';
    updateFilterPillStyles();
    updateClearLinkVisibility();
    renderBody();
  }

  // ── Body render (re-runs on every state change that affects rows) ──────
  function renderBody(): void {
    if (!bodyEl) return;
    clear(bodyEl);

    const grouped = groupByBucket(getFilteredTasks());

    for (const g of GROUP_ORDER) {
      const bucketTasks = grouped.get(g)!;
      // Hide empty buckets entirely (v0 simplification — v9 sometimes
      // shows them for filter-context, but our filter-chip counts already
      // signal "filter has matches in other buckets" via the pill count).
      if (bucketTasks.length === 0) continue;

      const stats = bucketStats(bucketTasks);
      const isCollapsed = collapsedBuckets.has(g);

      const section = el('section', '');
      section.style.cssText = [
        'border-radius:12px',
        'border:2px solid ' + GROUP_COLORS[g] + '40',
        'background:' + GROUP_BG[g],
        'overflow:hidden',
      ].join(';');

      const bucketHdr = el('div', '');
      bucketHdr.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:10px',
        'padding:10px 14px',
        'background:#ffffff',
        'border-bottom:1px solid ' + GROUP_COLORS[g] + '30',
        'cursor:pointer',
        'user-select:none',
      ].join(';');
      const chevron = el('span', '');
      chevron.style.cssText = 'font-size:12px;color:' + GROUP_COLORS[g];
      chevron.textContent = isCollapsed ? '\u25B6' : '\u25BC';
      bucketHdr.appendChild(chevron);
      const bucketLabel = el('span', '');
      bucketLabel.style.cssText = [
        'font-size:13px',
        'font-weight:700',
        'letter-spacing:0.05em',
        'color:' + GROUP_COLORS[g],
        'text-transform:uppercase',
      ].join(';');
      bucketLabel.textContent = GROUP_LABELS[g];
      bucketHdr.appendChild(bucketLabel);
      const bucketStatsEl = el('span', '');
      bucketStatsEl.style.cssText = 'font-size:11px;color:#64748b;font-weight:500';
      const statsParts = [
        stats.count + ' item' + (stats.count === 1 ? '' : 's'),
        stats.hours + 'h sized',
      ];
      if (stats.logged > 0) statsParts.push(stats.logged + 'h logged');
      if (stats.issues > 0) statsParts.push(stats.issues + ' needs attention');
      bucketStatsEl.textContent = statsParts.join(' \u00B7 ');
      bucketHdr.appendChild(bucketStatsEl);
      bucketHdr.addEventListener('click', () => {
        if (isCollapsed) collapsedBuckets.delete(g);
        else collapsedBuckets.add(g);
        renderBody();
      });
      section.appendChild(bucketHdr);

      if (!isCollapsed) {
        const body = el('div', '');
        body.style.cssText = 'background:#ffffff';
        for (const t of bucketTasks) {
          body.appendChild(renderRow(t));
        }
        section.appendChild(body);
      }
      bodyEl.appendChild(section);
    }

    // Empty state — no rows pass the filter.
    if (Array.from(grouped.values()).every((arr) => arr.length === 0)) {
      const empty = el('div', '');
      empty.style.cssText = [
        'padding:48px 24px',
        'text-align:center',
        'color:#64748b',
        'font-size:13px',
      ].join(';');
      const emptyTitle = el('div', '');
      emptyTitle.style.cssText = 'font-size:16px;font-weight:600;color:#475569;margin-bottom:8px';
      emptyTitle.textContent = tasks.length === 0 ? 'No tasks to audit' : 'No tasks match the current filter';
      empty.appendChild(emptyTitle);
      if (tasks.length > 0 && (filterChip !== 'all' || search.trim() !== '')) {
        const clearBtn = el('button', '');
        clearBtn.style.cssText = [
          'margin-top:12px',
          'padding:6px 14px',
          'background:#3b82f6',
          'color:#ffffff',
          'border:none',
          'border-radius:8px',
          'font-size:12px',
          'font-weight:600',
          'cursor:pointer',
        ].join(';');
        clearBtn.textContent = 'Clear filters';
        clearBtn.addEventListener('click', () => resetAllFilters());
        empty.appendChild(clearBtn);
      }
      bodyEl.appendChild(empty);
    }
  }

  // ── Shell mount (one-time — header + empty body container) ─────────────
  function mountShell(): void {
    clear(host);
    host.style.cssText = [
      'height:100%',
      'width:100%',
      'overflow:auto',
      'background:#f8fafc',
      'color:#0f172a',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
    ].join(';');

    const kpis = computeKpis(tasks, audits);

    // ── Header (stable across re-renders) ───────────────────────────────
    const header = el('div', '');
    header.style.cssText = [
      'background:#ffffff',
      'border-bottom:1px solid #e2e8f0',
      'box-shadow:0 1px 2px rgba(0,0,0,0.04)',
    ].join(';');
    const headerInner = el('div', '');
    headerInner.style.cssText = [
      'padding:12px 16px',
      'display:flex',
      'flex-wrap:wrap',
      'align-items:center',
      'gap:12px',
    ].join(';');

    const labelWrap = el('div', '');
    labelWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-right:8px';
    const label = el('span', '');
    label.style.cssText = 'font-size:14px;font-weight:700;color:#0f172a';
    label.textContent = 'Audit view';
    const sep = el('span', '');
    sep.style.cssText = 'color:#94a3b8;font-size:12px';
    sep.textContent = '\u00B7';
    labelWrap.appendChild(label);
    labelWrap.appendChild(sep);
    headerInner.appendChild(labelWrap);

    // KPI pills — computed from the (immutable for a render lifetime)
    // tasks + audits Map. Stable across filter changes; no in-place
    // updates needed.
    const kpiWrap = el('div', '');
    kpiWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center';
    kpiWrap.appendChild(kpiPill('items', String(kpis.totalItems), 'slate'));
    kpiWrap.appendChild(kpiPill('h sized', String(kpis.totalSizedHours), 'slate'));
    kpiWrap.appendChild(kpiPill('needs attention', String(kpis.needsAttention),
      kpis.needsAttention > 0 ? 'amber' : 'emerald'));
    kpiWrap.appendChild(kpiPill('dupes', String(kpis.dupeCount),
      kpis.dupeCount > 0 ? 'rose' : 'emerald'));
    if (kpis.proposalTotal > 0) {
      const ready = kpis.proposalReady;
      const total = kpis.proposalTotal;
      const tone: KpiTone = ready === total ? 'emerald' : ready > total / 2 ? 'amber' : 'rose';
      kpiWrap.appendChild(kpiPill('ready / ' + total, String(ready), tone));
    }
    headerInner.appendChild(kpiWrap);

    const spacer = el('div', '');
    spacer.style.cssText = 'flex:1;min-width:8px';
    headerInner.appendChild(spacer);

    // Search input — stable; only its value mutates. Caret position +
    // focus persist naturally because the element is never destroyed.
    const searchInput = el('input', '') as HTMLInputElement;
    searchInput.type = 'search';
    searchInput.placeholder = 'Search title / owner / stage\u2026';
    searchInput.value = search;
    searchInput.style.cssText = [
      'min-width:200px',
      'max-width:320px',
      'padding:6px 12px',
      'border-radius:8px',
      'border:1px solid #cbd5e1',
      'font-size:13px',
      'background:#ffffff',
      'outline:none',
    ].join(';');
    searchInput.addEventListener('input', (e) => {
      search = (e.target as HTMLInputElement).value;
      renderBody();
      updateClearLinkVisibility();
    });
    headerInner.appendChild(searchInput);

    // Sort select — stable; value mutates on change.
    const sortSel = el('select', '') as HTMLSelectElement;
    sortSel.setAttribute('data-nga-audit-sort', '1');
    sortSel.style.cssText = [
      'padding:6px 10px',
      'border-radius:8px',
      'border:1px solid #cbd5e1',
      'font-size:12px',
      'background:#ffffff',
      'outline:none',
    ].join(';');
    (Object.keys(SORT_LABELS) as SortKey[]).forEach((k) => {
      const opt = el('option', '') as HTMLOptionElement;
      opt.value = k;
      opt.textContent = SORT_LABELS[k];
      if (k === sortKey) opt.selected = true;
      sortSel.appendChild(opt);
    });
    sortSel.addEventListener('change', (e) => {
      sortKey = (e.target as HTMLSelectElement).value as SortKey;
      renderBody();
      updateClearLinkVisibility();
    });
    headerInner.appendChild(sortSel);

    header.appendChild(headerInner);

    // ── Filter pill row (stable; active state updates in-place) ─────────
    const filterRow = el('div', '');
    filterRow.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:6px',
      'padding:10px 16px',
      'border-bottom:1px solid #f1f5f9',
      'background:#ffffff',
    ].join(';');

    const counts = filterCounts();
    (Object.keys(FILTER_LABELS) as FilterChip[]).forEach((chip) => {
      const btn = el('button', '');
      const lbl = el('span', '');
      lbl.textContent = FILTER_LABELS[chip];
      btn.appendChild(lbl);
      const cnt = el('span', '');
      cnt.textContent = String(counts[chip]);
      btn.appendChild(cnt);
      btn.addEventListener('click', () => {
        filterChip = chip;
        updateFilterPillStyles();
        updateClearLinkVisibility();
        renderBody();
      });
      filterRow.appendChild(btn);
      filterPillBtns.set(chip, btn);
      filterPillCnts.set(chip, cnt);
      // Apply initial styles (will be re-applied by updateFilterPillStyles
      // when the active chip changes).
      applyFilterPillStyles(chip);
    });

    // Clear-filters link — kept in DOM, toggled via display: '' / 'none'.
    // Renamed from the earlier `clear` (which shadowed the imported
    // `clear` helper from el.ts — tracked B2 in reviewer agent's report).
    clearLink = el('button', '');
    clearLink.style.cssText = [
      'padding:4px 10px',
      'background:transparent',
      'border:none',
      'color:#dc2626',
      'font-size:11px',
      'font-weight:600',
      'cursor:pointer',
      'text-decoration:underline',
      'text-decoration-style:dotted',
    ].join(';');
    clearLink.textContent = 'Clear filters';
    clearLink.addEventListener('click', () => resetAllFilters());
    filterRow.appendChild(clearLink);
    updateClearLinkVisibility();

    header.appendChild(filterRow);
    host.appendChild(header);

    // ── Body container (children rebuilt by renderBody on every change) ──
    bodyEl = el('div', '');
    bodyEl.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:14px';
    host.appendChild(bodyEl);
  }

  // ── Per-row rendering ──────────────────────────────────────────────────
  function renderRow(task: NormalizedTask): HTMLElement {
    // Map is populated for every task at function entry; non-null assert
    // is safe (M2 fix from reviewer — drops the redundant `|| auditTask`
    // fallback that would otherwise silently re-compute on every render).
    const audit = audits.get(task.id)!;
    const isExpanded = expandedIds.has(task.id);
    const hasErrors   = audit.issues.some((i) => i.severity === 'error');
    const hasWarnings = audit.issues.some((i) => i.severity === 'warning');

    const row = el('div', '');
    row.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'border-bottom:1px solid #f1f5f9',
      'background:#ffffff',
      'transition:background-color 0.1s',
    ].join(';');
    row.addEventListener('mouseenter', () => {
      row.style.backgroundColor = hasErrors
        ? 'rgba(244,63,94,0.04)'
        : hasWarnings
          ? 'rgba(245,158,11,0.04)'
          : 'rgba(59,130,246,0.04)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.backgroundColor = '#ffffff';
    });

    // Top line — drag handle + chevron + name + title + hours + dates + mfRef + audit icons
    const top = el('div', '');
    top.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:10px',
      'padding:8px 14px',
      'cursor:pointer',
    ].join(';');

    // Drag handle (visual only — drag-to-reorder ports in 0.183)
    const drag = el('span', '');
    drag.style.cssText = [
      'color:#cbd5e1',
      'font-size:14px',
      'cursor:grab',
      'user-select:none',
      'flex-shrink:0',
    ].join(';');
    drag.textContent = '\u2807'; // ⠇ vertical dots
    drag.title = 'Drag to reorder (coming in 0.183)';
    top.appendChild(drag);

    // Chevron
    const chev = el('span', '');
    chev.style.cssText = 'color:#64748b;font-size:11px;flex-shrink:0;width:12px;text-align:center';
    chev.textContent = isExpanded ? '\u25BC' : '\u25B6';
    top.appendChild(chev);

    // Name (id) — monospace chip. Hidden by default per CHANGE 4 — the
    // fallback `task.name || task.id` resolves to the raw 18-char SF
    // record ID (`a0D0300000...`) for Salesforce consumers, which
    // should never reach end users. Dev/debug contexts can set
    // `hideRecordIds: false` in AuditListOptions / TemplateConfig.
    if (!hideRecordIds) {
      const name = el('code', '');
      name.style.cssText = [
        'font-family:SF Mono,Cascadia Code,Consolas,monospace',
        'font-size:11px',
        'color:#64748b',
        'flex-shrink:0',
        'min-width:80px',
        'max-width:140px',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'white-space:nowrap',
      ].join(';');
      name.textContent = task.name || task.id;
      top.appendChild(name);
    }

    // Title — flex-grow
    const title = el('span', '');
    title.style.cssText = [
      'flex:1',
      'min-width:0',
      'font-size:13px',
      'color:#0f172a',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'white-space:nowrap',
    ].join(';');
    title.textContent = task.title;
    if (options?.onTaskClick) {
      title.style.cursor = 'pointer';
      title.style.textDecoration = 'underline';
      title.style.textDecorationStyle = 'dotted';
      title.style.textDecorationColor = '#94a3b8';
      title.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onTaskClick!(task.id);
      });
    }
    top.appendChild(title);

    // Progress % — prefixed with the configurable `progressLabel`
    // (default 'Budget Used' per 0.182 relabel). The % value is computed
    // as `loggedHours / estimatedHours` (see progressOf), which tracks
    // BUDGET consumption rather than work completion. Prefix is set to
    // empty string by consumers who want the bare % back.
    const pct = progressOf(task);
    if (pct !== null) {
      const pctWrap = el('span', '');
      pctWrap.style.cssText = [
        'flex-shrink:0',
        'font-size:11px',
        'color:' + (pct === 100 ? '#10b981' : pct > 50 ? '#d97706' : '#64748b'),
        'font-weight:600',
        'text-align:right',
        'white-space:nowrap',
      ].join(';');
      const prefixLabel = progressLabel.trim();
      pctWrap.textContent = prefixLabel ? prefixLabel + ' ' + pct + '%' : pct + '%';
      pctWrap.title = 'Budget Used — hours logged / hours estimated';
      top.appendChild(pctWrap);
    }

    // Hours (logged / high)
    const hoursTxt = el('span', '');
    hoursTxt.style.cssText = [
      'font-family:SF Mono,Cascadia Code,Consolas,monospace',
      'font-size:11px',
      'color:' + (audit.flags.hasHours ? '#475569' : '#dc2626'),
      'flex-shrink:0',
      'min-width:64px',
      'text-align:right',
    ].join(';');
    if (audit.flags.hasHours) {
      const high = task.estimatedHours || 0;
      const logged = task.loggedHours || 0;
      hoursTxt.textContent = logged > 0 ? logged + 'h / ' + high + 'h' : high + 'h';
    } else {
      hoursTxt.textContent = '— h';
    }
    top.appendChild(hoursTxt);

    // Dates
    const dates = el('span', '');
    dates.style.cssText = [
      'font-family:SF Mono,Cascadia Code,Consolas,monospace',
      'font-size:11px',
      'color:' + (audit.flags.hasDates ? '#475569' : '#dc2626'),
      'flex-shrink:0',
      'min-width:104px',
      'text-align:right',
    ].join(';');
    dates.textContent = audit.flags.hasDates ? fmtDateRange(task.startDate, task.endDate) : '— → —';
    top.appendChild(dates);

    // Audit icons
    top.appendChild(auditIcons(audit));

    // Expand on click anywhere in the top row (except title with a click handler)
    top.addEventListener('click', () => {
      if (isExpanded) expandedIds.delete(task.id);
      else expandedIds.add(task.id);
      renderBody();
    });

    row.appendChild(top);

    // Expanded detail
    if (isExpanded) {
      const detail = el('div', '');
      detail.style.cssText = [
        'padding:12px 14px 14px 50px',
        'background:#f8fafc',
        'border-top:1px solid #f1f5f9',
        'font-size:12px',
        'color:#475569',
      ].join(';');
      const grid = el('div', '');
      grid.style.cssText = [
        'display:grid',
        'grid-template-columns:repeat(auto-fit,minmax(180px,1fr))',
        'gap:8px 16px',
      ].join(';');

      function field(label: string, value: string): void {
        const f = el('div', '');
        f.style.cssText = 'display:flex;flex-direction:column;gap:2px';
        const l = el('span', '');
        l.style.cssText = 'font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;font-weight:600';
        l.textContent = label;
        const v = el('span', '');
        v.style.cssText = 'font-size:12px;color:#0f172a';
        v.textContent = value || '—';
        f.appendChild(l);
        f.appendChild(v);
        grid.appendChild(f);
      }

      field('Stage',     task.stage || '');
      field('Owner',     task.developerName || '');
      field('Priority group', task.priorityGroup || '');
      field('Start',     task.startDate || '');
      field('End',       task.endDate || '');
      field('Estimated', String(task.estimatedHours || 0) + ' h');
      field('Logged',    String(task.loggedHours || 0) + ' h');
      if (task.entityName) field('Entity', task.entityName);

      detail.appendChild(grid);

      // Audit issues block
      if (audit.issues.length > 0) {
        const issuesWrap = el('div', '');
        issuesWrap.style.cssText = [
          'margin-top:10px',
          'padding:8px 10px',
          'background:#ffffff',
          'border:1px solid #e2e8f0',
          'border-radius:6px',
          'display:flex',
          'flex-direction:column',
          'gap:4px',
        ].join(';');
        const issuesTitle = el('div', '');
        issuesTitle.style.cssText = 'font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px';
        issuesTitle.textContent = 'Audit issues';
        issuesWrap.appendChild(issuesTitle);
        for (const issue of audit.issues) {
          const issueRow = el('div', '');
          issueRow.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:6px',
            'font-size:11px',
            'color:' + (issue.severity === 'error' ? '#dc2626' : issue.severity === 'warning' ? '#d97706' : '#64748b'),
          ].join(';');
          const dot = el('span', '');
          dot.style.cssText = 'flex-shrink:0;width:6px;height:6px;border-radius:50%;background:currentColor';
          issueRow.appendChild(dot);
          const msg = el('span', '');
          msg.textContent = issue.message;
          issueRow.appendChild(msg);
          issuesWrap.appendChild(issueRow);
        }
        detail.appendChild(issuesWrap);
      }

      row.appendChild(detail);
    }

    return row;
  }

  // ── Initial paint + cleanup ────────────────────────────────────────────
  // mountShell() builds the stable header + empty body container ONCE.
  // renderBody() populates the body. Subsequent state changes call
  // renderBody() directly (filter/sort/search/expand/bucket-toggle); the
  // shell is never re-cleared, so search-input focus + caret persist
  // through every keystroke.
  mountShell();
  renderBody();

  return function cleanup(): void {
    // host.innerHTML = '' is the actual teardown (rebuildView in IIFEApp.ts
    // does this on view switch). This is a no-op signature placeholder for
    // future event-listener teardown if we add window/document listeners.
  };
}
