// ─── Context Menu Plugin (0.189.0) ─────────────────────────────────────────
// Zone-aware right-click menus. Listens for contextmenu (and
// pointerdown+button===2 as a fallback for LWS / Salesforce contexts that
// suppress contextmenu events on canvases). On every right-click, calls
// gantt.hitTestAt(clientX, clientY) to classify the pixel into a ZoneHit
// (bar, row-label, date-header, canvas-empty, bucket-header, below-rows,
// dependency, outside) and fires the host's onContextMenu callback.
//
// Three modes for menu rendering:
//   1. Host returns ContextMenuItem[] → NG renders a styled DOM menu.
//   2. Host returns void → NG renders the default menu for the zone
//      (sensible out-of-the-box behavior so the plugin is useful without
//      any host wiring).
//   3. Host calls e.preventDefault() in their own listener and renders
//      their own menu — they don't install ContextMenuPlugin at all.
//
// "✦ Ask Claude…" agent items: any MenuItem with `agentSuggested: true`
// and a `prompt` string is rendered with a ✦ glyph. Clicking routes to
// onAgentRequest(payload) instead of onClick — host owns the LLM call,
// NG just delivers the structured context (hit + snapshot + prompt).
//
// Substrate-light: no ZoneHit dependency on HistoryPlugin. Works on the
// barest mount that has only the engine + sample tasks.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  TaskLayout,
  ZoneHit,
  ContextMenuItem,
  ContextMenuPos,
  AgentMenuRequest,
  AgentSnapshot,
  GanttTask,
} from '../model/types';

// ─── Public Options ────────────────────────────────────────────────────────

export interface ContextMenuOptions {
  /** Host hook — fires for every right-click. Return value semantics:
   *    - non-empty array → NG renders the supplied menu (host override)
   *    - empty array `[]` → NG suppresses the menu entirely for this zone
   *    - `null` / `undefined` / `void` → NG falls through to its default
   *      menu for the zone */
  onContextMenu?: (hit: ZoneHit, pos: ContextMenuPos) => ContextMenuItem[] | void | null;

  /** Host hook for agent-suggested items. Fires when user clicks any
   *  MenuItem with agentSuggested:true. Host calls Claude (or any LLM)
   *  with the supplied context, then resolves by mutating state via
   *  gantt.agent.* or appending an annotation. Subject to agentRateLimit
   *  if configured — see that option. */
  onAgentRequest?: (payload: AgentMenuRequest) => void | Promise<void>;

  /** Fired when the user picks "Create work item here" from the
   *  canvas-empty default menu. Host inserts the new task via Apex /
   *  API / direct gantt.agent.addTask call. */
  onCreateTask?: (init: {
    startDate: string;
    endDate: string;
    parentId: string | null;
    bucket: string | null;
  }, pos: ContextMenuPos) => void;

  /** Fired when the user picks "Edit name" / "Change parent" / etc on
   *  a row-label or bar. Host opens its own editor; NG just signals.
   *  Actions: 'edit' | 'reparent' | 'change-bucket' | 'mark-complete'
   *  | 'delete' | 'collapse' | 'expand'. */
  onTaskAction?: (action: string, task: GanttTask, pos: ContextMenuPos) => void;

  /** Fired when the user picks something from the date-header default
   *  menu. Actions: 'scroll-here' | 'zoom-to' | 'add-milestone'. */
  onDateAction?: (action: string, date: Date, pos: ContextMenuPos) => void;

  /** Fired when the user picks an item from the dependency-arrow menu.
   *  Actions: 'delete' | 'change-type-fs' | 'change-type-ss' |
   *  'change-type-ff' | 'change-type-sf'. */
  onDependencyAction?: (action: string, depId: string, pos: ContextMenuPos) => void;

  /** Confirmation hook for destructive actions (delete task, delete
   *  dependency). NG calls this BEFORE firing onTaskAction('delete') or
   *  onDependencyAction('delete'); if it returns false (or rejects),
   *  the destructive action is suppressed.
   *
   *  Default: NG calls window.confirm() with a sensible message. Host
   *  passes a custom prompt (toast-with-undo, modal, etc.) by overriding
   *  this. Pass `() => true` to suppress all confirms (e.g. when the
   *  host's own modal already confirmed). */
  onConfirmDestructive?: (
    kind: 'task' | 'dependency',
    label: string,
  ) => boolean | Promise<boolean>;

  /** Token-bucket rate limit on agent (✦) item clicks. Without this,
   *  rapid misclicks could fire many onAgentRequest calls in flight to
   *  paid LLM endpoints. Default: 1 call per 2 seconds.
   *
   *  Pass `{ maxCalls: 10, windowMs: 60000 }` for "10 per minute," etc.
   *  Pass `false` to disable rate limiting entirely (host's risk). */
  agentRateLimit?: false | { maxCalls: number; windowMs: number };

  /** Disable the LWS pointerdown+button===2 fallback. Default: enabled. */
  disablePointerDownFallback?: boolean;

  /** Hide the ✦ Ask Claude default submenu. Default: shown when
   *  onAgentRequest is wired. */
  hideAgentSubmenu?: boolean;
}

// ─── Plugin ────────────────────────────────────────────────────────────────

const STYLE_ID = 'nimbus-gantt-ctxmenu-styles';
const ROOT_CLASS = 'ng-ctxmenu';

// ─── Rate limiting (token bucket for agent ✦ calls) ────────────────────────

const DEFAULT_AGENT_RATE_LIMIT = { maxCalls: 1, windowMs: 2000 };

function makeRateLimiter(limit: { maxCalls: number; windowMs: number } | false) {
  if (limit === false) return () => true;
  const cfg = limit ?? DEFAULT_AGENT_RATE_LIMIT;
  const window: number[] = [];
  return function allow(): boolean {
    const now = Date.now();
    const cutoff = now - cfg.windowMs;
    while (window.length > 0 && window[0] < cutoff) window.shift();
    if (window.length >= cfg.maxCalls) return false;
    window.push(now);
    return true;
  };
}

function diagPlugin(kind: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arr = (window as any).__nga_diag;
  if (!Array.isArray(arr)) return;
  arr.push({ t: Date.now(), kind, ...(data ?? {}) });
}

export function ContextMenuPlugin(opts: ContextMenuOptions = {}): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gantt: any = null;
  let rootEl: HTMLElement | null = null;
  let menuEl: HTMLElement | null = null;
  let ctxHandler: ((e: Event) => void) | null = null;
  let pdHandler: ((e: PointerEvent) => void) | null = null;
  let docDismissHandler: ((e: Event) => void) | null = null;

  const allowAgentCall = makeRateLimiter(
    opts.agentRateLimit === undefined ? DEFAULT_AGENT_RATE_LIMIT : opts.agentRateLimit,
  );

  async function confirmDestructive(kind: 'task' | 'dependency', label: string): Promise<boolean> {
    if (opts.onConfirmDestructive) {
      try {
        const r = await opts.onConfirmDestructive(kind, label);
        return !!r;
      } catch { return false; }
    }
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const msg = kind === 'task'
        ? `Delete task "${label}"?`
        : `Delete dependency "${label}"?`;
      try { return window.confirm(msg); } catch { return false; }
    }
    // No confirm UI available → default to destructive-allowed (host's
    // call to opt out via onConfirmDestructive=()=>false).
    return true;
  }

  function injectStyles(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${ROOT_CLASS} {
        position: fixed;
        z-index: 999999;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
        padding: 4px 0;
        min-width: 180px;
        max-width: 320px;
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        color: #1e293b;
        user-select: none;
      }
      .${ROOT_CLASS}-item {
        padding: 6px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }
      .${ROOT_CLASS}-item:hover { background: #f1f5f9; }
      .${ROOT_CLASS}-item[aria-disabled="true"] { color: #94a3b8; cursor: default; }
      .${ROOT_CLASS}-item[aria-disabled="true"]:hover { background: transparent; }
      .${ROOT_CLASS}-icon { width: 16px; text-align: center; font-size: 12px; }
      .${ROOT_CLASS}-label { flex: 1; }
      .${ROOT_CLASS}-shortcut { color: #94a3b8; font-size: 11px; margin-left: auto; }
      .${ROOT_CLASS}-arrow { color: #94a3b8; }
      .${ROOT_CLASS}-divider { border-top: 1px solid #e2e8f0; margin: 4px 0; }
      .${ROOT_CLASS}-agent-glyph { color: #8b5cf6; font-weight: 600; }
      .${ROOT_CLASS}-submenu { position: relative; }
    `;
    document.head.appendChild(style);
  }

  function dismissMenu(): void {
    if (menuEl) {
      try { menuEl.remove(); } catch { /* ignore */ }
      menuEl = null;
    }
    if (docDismissHandler && typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', docDismissHandler, true);
      document.removeEventListener('keydown', docDismissHandler as (e: Event) => void, true);
      docDismissHandler = null;
    }
  }

  function renderMenu(items: ContextMenuItem[], pos: ContextMenuPos, hit: ZoneHit): void {
    if (typeof document === 'undefined') return;
    if (items.length === 0) return;
    dismissMenu();
    injectStyles();

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.setAttribute('role', 'menu');
    root.style.left = `${pos.x}px`;
    root.style.top = `${pos.y}px`;
    // Prevent the global pointerdown dismiss from firing on the menu itself.
    root.addEventListener('pointerdown', (e) => { e.stopPropagation(); });

    for (const item of items) {
      if (item.divider) {
        const div = document.createElement('div');
        div.className = `${ROOT_CLASS}-divider`;
        root.appendChild(div);
        continue;
      }
      const el = document.createElement('div');
      el.className = `${ROOT_CLASS}-item`;
      if (item.disabled) el.setAttribute('aria-disabled', 'true');
      const icon = document.createElement('span');
      icon.className = `${ROOT_CLASS}-icon`;
      if (item.agentSuggested) icon.classList.add(`${ROOT_CLASS}-agent-glyph`);
      icon.textContent = item.icon ?? (item.agentSuggested ? '✦' : '');
      el.appendChild(icon);
      const label = document.createElement('span');
      label.className = `${ROOT_CLASS}-label`;
      label.textContent = item.label;
      el.appendChild(label);
      if (item.shortcut) {
        const sc = document.createElement('span');
        sc.className = `${ROOT_CLASS}-shortcut`;
        sc.textContent = item.shortcut;
        el.appendChild(sc);
      }
      if (item.children && item.children.length > 0) {
        const arrow = document.createElement('span');
        arrow.className = `${ROOT_CLASS}-arrow`;
        arrow.textContent = '▸';
        el.appendChild(arrow);
        // Submenu renders as a nested fly-out on hover — minimal
        // implementation: open a second menu to the right of this item.
        let subEl: HTMLElement | null = null;
        el.addEventListener('mouseenter', () => {
          if (subEl) return;
          const r = el.getBoundingClientRect();
          subEl = document.createElement('div');
          subEl.className = ROOT_CLASS;
          subEl.style.left = `${r.right + 2}px`;
          subEl.style.top = `${r.top}px`;
          for (const child of item.children!) {
            const childEl = makeItemEl(child, hit);
            subEl.appendChild(childEl);
          }
          document.body.appendChild(subEl);
        });
        el.addEventListener('mouseleave', () => {
          if (subEl) { try { subEl.remove(); } catch { /* ignore */ } subEl = null; }
        });
      } else if (!item.disabled) {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          handleItemClick(item, hit, pos);
        });
      }
      root.appendChild(el);
    }

    document.body.appendChild(root);
    menuEl = root;

    // Auto-dismiss on outside pointerdown or Escape.
    docDismissHandler = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      dismissMenu();
    };
    document.addEventListener('pointerdown', docDismissHandler, true);
    document.addEventListener('keydown', docDismissHandler as (e: Event) => void, true);

    // Reposition into viewport if menu overflows right or bottom edge.
    requestAnimationFrame(() => {
      if (!menuEl) return;
      const r = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = r.left;
      let top = r.top;
      if (r.right > vw) left = Math.max(4, vw - r.width - 4);
      if (r.bottom > vh) top = Math.max(4, vh - r.height - 4);
      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;
    });
  }

  function makeItemEl(item: ContextMenuItem, hit: ZoneHit): HTMLElement {
    if (item.divider) {
      const div = document.createElement('div');
      div.className = `${ROOT_CLASS}-divider`;
      return div;
    }
    const el = document.createElement('div');
    el.className = `${ROOT_CLASS}-item`;
    if (item.disabled) el.setAttribute('aria-disabled', 'true');
    const icon = document.createElement('span');
    icon.className = `${ROOT_CLASS}-icon`;
    if (item.agentSuggested) icon.classList.add(`${ROOT_CLASS}-agent-glyph`);
    icon.textContent = item.icon ?? (item.agentSuggested ? '✦' : '');
    el.appendChild(icon);
    const label = document.createElement('span');
    label.className = `${ROOT_CLASS}-label`;
    label.textContent = item.label;
    el.appendChild(label);
    if (!item.disabled) {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handleItemClick(item, hit, { x: 0, y: 0 });
      });
    }
    return el;
  }

  function handleItemClick(item: ContextMenuItem, hit: ZoneHit, pos: ContextMenuPos): void {
    dismissMenu();
    if (item.agentSuggested && item.prompt && opts.onAgentRequest && gantt?.agent) {
      // Rate limit before invoking the host's agent endpoint.
      if (!allowAgentCall()) {
        diagPlugin('ctxmenu:agent-rate-limited', { itemId: item.id });
        return;
      }
      const payload: AgentMenuRequest = {
        hit,
        pos,
        prompt: item.prompt,
        snapshot: gantt.agent.getSnapshot() as AgentSnapshot,
      };
      try {
        const r = opts.onAgentRequest(payload);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {/* host handles */});
        }
      } catch { /* host handles */ }
      return;
    }
    if (item.onClick) {
      try {
        const r = item.onClick();
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {/* host handles */});
        }
      } catch { /* host handles */ }
    }
  }

  /** Wraps a destructive action with a confirm gate. */
  function withConfirm(
    kind: 'task' | 'dependency',
    label: string,
    fire: () => void,
  ): () => Promise<void> {
    return async () => {
      const ok = await confirmDestructive(kind, label);
      if (ok) fire();
      else diagPlugin('ctxmenu:destructive-cancelled', { kind, label });
    };
  }

  // ─── Default menus per zone ─────────────────────────────────────────────

  function defaultMenu(hit: ZoneHit, pos: ContextMenuPos): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    const hasAgent = !!opts.onAgentRequest && !opts.hideAgentSubmenu;

    switch (hit.zone) {
      case 'bar': {
        items.push(
          { id: 'edit', label: 'Edit task…', icon: '✎', onClick: () => opts.onTaskAction?.('edit', hit.task, pos) },
          { id: 'reparent', label: 'Change parent…', icon: '↳', onClick: () => opts.onTaskAction?.('reparent', hit.task, pos) },
          { id: 'change-bucket', label: 'Change bucket…', icon: '◧', onClick: () => opts.onTaskAction?.('change-bucket', hit.task, pos) },
          { id: 'mark-complete', label: 'Mark complete', icon: '✓', onClick: () => opts.onTaskAction?.('mark-complete', hit.task, pos) },
          { id: 'div1', label: '', divider: true },
          {
            id: 'delete', label: 'Delete', icon: '×',
            onClick: withConfirm('task', hit.task.name || hit.task.id, () => opts.onTaskAction?.('delete', hit.task, pos)),
          },
        );
        if (hasAgent) {
          items.push(
            { id: 'div-agent', label: '', divider: true },
            {
              id: 'agent-why', label: 'Ask Claude: why is this scheduled here?',
              agentSuggested: true,
              prompt: `Explain why task "${hit.task.name}" (id ${hit.task.id}) is scheduled from ${hit.task.startDate} to ${hit.task.endDate} given current dependencies, parent context, and bucket assignment.`,
            },
            {
              id: 'agent-blocks', label: 'Ask Claude: what blocks this?',
              agentSuggested: true,
              prompt: `What dependencies, capacity constraints, or upstream blockers are gating task "${hit.task.name}" (id ${hit.task.id})? Walk the dependency graph and list the critical path.`,
            },
            {
              id: 'agent-resched', label: 'Ask Claude: reschedule with critical-path optimization',
              agentSuggested: true,
              prompt: `Suggest a new schedule for task "${hit.task.name}" (id ${hit.task.id}) that optimizes the critical path. Stage hypotheses via gantt.agent if possible.`,
            },
          );
        }
        return items;
      }

      case 'row-label': {
        items.push(
          { id: 'edit', label: 'Edit name…', icon: '✎', onClick: () => opts.onTaskAction?.('edit', hit.task, pos) },
          { id: 'reparent', label: 'Change parent…', icon: '↳', onClick: () => opts.onTaskAction?.('reparent', hit.task, pos) },
          { id: 'change-bucket', label: 'Change bucket…', icon: '◧', onClick: () => opts.onTaskAction?.('change-bucket', hit.task, pos) },
          { id: 'mark-complete', label: 'Mark complete', icon: '✓', onClick: () => opts.onTaskAction?.('mark-complete', hit.task, pos) },
          { id: 'div1', label: '', divider: true },
          {
            id: 'delete', label: 'Delete', icon: '×',
            onClick: withConfirm('task', hit.task.name || hit.task.id, () => opts.onTaskAction?.('delete', hit.task, pos)),
          },
        );
        if (hasAgent) {
          items.push(
            { id: 'div-agent', label: '', divider: true },
            {
              id: 'agent-summarize', label: 'Ask Claude: summarize this task',
              agentSuggested: true,
              prompt: `Summarize task "${hit.task.name}" (id ${hit.task.id}) including its current status, parent, dependencies, and recent history if available.`,
            },
          );
        }
        return items;
      }

      case 'date-header': {
        const iso = hit.date.toISOString().slice(0, 10);
        items.push(
          { id: 'scroll-here', label: `Scroll to ${iso}`, icon: '↔', onClick: () => opts.onDateAction?.('scroll-here', hit.date, pos) },
          { id: 'zoom-to', label: 'Zoom to this range', icon: '⊕', onClick: () => opts.onDateAction?.('zoom-to', hit.date, pos) },
          { id: 'add-milestone', label: `Add milestone on ${iso}`, icon: '◆', onClick: () => opts.onDateAction?.('add-milestone', hit.date, pos) },
        );
        if (hasAgent) {
          items.push(
            { id: 'div-agent', label: '', divider: true },
            {
              id: 'agent-summary', label: `Ask Claude: what's happening around ${iso}?`,
              agentSuggested: true,
              prompt: `Summarize tasks, milestones, and dependencies that intersect ${iso}. Note any clusters, conflicts, or capacity hotspots.`,
            },
          );
        }
        return items;
      }

      case 'canvas-empty': {
        const iso = hit.date.toISOString().slice(0, 10);
        const startDate = iso;
        const endDate = (() => {
          const d = new Date(hit.date);
          d.setUTCDate(d.getUTCDate() + 5);
          return d.toISOString().slice(0, 10);
        })();
        items.push(
          {
            id: 'create-task',
            label: `Create work item starting ${iso}`,
            icon: '＋',
            onClick: () => opts.onCreateTask?.({
              startDate,
              endDate,
              parentId: hit.nearestTask?.parentId ?? null,
              bucket: hit.bucketId,
            }, pos),
          },
          {
            id: 'create-milestone',
            label: `Insert milestone on ${iso}`,
            icon: '◆',
            onClick: () => opts.onCreateTask?.({
              startDate: iso,
              endDate: iso,
              parentId: hit.nearestTask?.parentId ?? null,
              bucket: hit.bucketId,
            }, pos),
          },
        );
        if (hasAgent) {
          items.push(
            { id: 'div-agent', label: '', divider: true },
            {
              id: 'agent-suggest', label: 'Ask Claude: suggest a task here',
              agentSuggested: true,
              prompt: `Given the project context and the dates around ${iso}${hit.bucketId ? ` in bucket "${hit.bucketId}"` : ''}, suggest a sensible work item to insert. Consider open dependencies, capacity, and priority.`,
            },
          );
        }
        return items;
      }

      case 'bucket-header': {
        const label = hit.bucketTask.name || hit.bucketId || '(bucket)';
        items.push(
          { id: 'add-to-bucket', label: `Add task to ${label}`, icon: '＋', onClick: () => opts.onCreateTask?.({
            startDate: new Date().toISOString().slice(0, 10),
            endDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
            parentId: hit.bucketTask.id,
            bucket: hit.bucketId,
          }, pos) },
          { id: 'collapse', label: `Collapse all in ${label}`, icon: '⊟', onClick: () => opts.onTaskAction?.('collapse', hit.bucketTask, pos) },
          { id: 'expand', label: `Expand all in ${label}`, icon: '⊞', onClick: () => opts.onTaskAction?.('expand', hit.bucketTask, pos) },
        );
        if (hasAgent) {
          items.push(
            { id: 'div-agent', label: '', divider: true },
            {
              id: 'agent-rebalance', label: `Ask Claude: rebalance ${label}`,
              agentSuggested: true,
              prompt: `Review the tasks in bucket "${label}" for capacity, sequencing, and priority alignment. Suggest moves to/from adjacent buckets and reordering within.`,
            },
          );
        }
        return items;
      }

      case 'below-rows': {
        const iso = hit.date.toISOString().slice(0, 10);
        items.push(
          { id: 'create-end', label: `Add new task at end (starts ${iso})`, icon: '＋', onClick: () => opts.onCreateTask?.({
            startDate: iso,
            endDate: new Date(hit.date.getTime() + 5 * 86400000).toISOString().slice(0, 10),
            parentId: null,
            bucket: null,
          }, pos) },
        );
        return items;
      }

      case 'dependency': {
        items.push(
          {
            id: 'change-fs', label: 'Change type → Finish-to-Start (FS)', icon: '→',
            onClick: () => opts.onDependencyAction?.('change-type-fs', hit.depId, pos),
          },
          {
            id: 'change-ss', label: 'Change type → Start-to-Start (SS)', icon: '↦',
            onClick: () => opts.onDependencyAction?.('change-type-ss', hit.depId, pos),
          },
          {
            id: 'change-ff', label: 'Change type → Finish-to-Finish (FF)', icon: '↤',
            onClick: () => opts.onDependencyAction?.('change-type-ff', hit.depId, pos),
          },
          {
            id: 'change-sf', label: 'Change type → Start-to-Finish (SF)', icon: '↔',
            onClick: () => opts.onDependencyAction?.('change-type-sf', hit.depId, pos),
          },
          { id: 'div1', label: '', divider: true },
          {
            id: 'delete', label: 'Delete dependency', icon: '×',
            onClick: withConfirm('dependency', hit.depId, () => opts.onDependencyAction?.('delete', hit.depId, pos)),
          },
        );
        if (hasAgent) {
          items.push(
            { id: 'div-agent', label: '', divider: true },
            {
              id: 'agent-explain-dep', label: 'Ask Claude: is this dependency necessary?',
              agentSuggested: true,
              prompt: `Evaluate dependency ${hit.depId}. Is it logically required, or could the predecessor and successor run in parallel? Consider data flow, resource contention, and external constraints.`,
            },
          );
        }
        return items;
      }
      case 'outside':
      default:
        return [];
    }
  }

  // ─── Event handling ─────────────────────────────────────────────────────

  function onContextMenuEvent(ev: MouseEvent | PointerEvent): void {
    if (!gantt || !rootEl) return;
    // Only trap right-click. PointerEvent with button !== 2 is mouse-down
    // chained from drag/select; ignore.
    if ((ev as PointerEvent).button !== undefined && (ev as PointerEvent).button !== 2) return;

    const hit = gantt.hitTestAt(ev.clientX, ev.clientY) as ZoneHit;
    if (hit.zone === 'outside') return;

    ev.preventDefault();
    ev.stopPropagation();

    const pos: ContextMenuPos = { x: ev.clientX, y: ev.clientY };

    let items: ContextMenuItem[] | void | null = null;
    if (opts.onContextMenu) {
      try {
        items = opts.onContextMenu(hit, pos);
      } catch { items = null; }
    }
    const menuItems = (items && Array.isArray(items) && items.length > 0)
      ? items
      : defaultMenu(hit, pos);

    if (menuItems.length > 0) {
      renderMenu(menuItems, pos, hit);
    }
  }

  return {
    name: 'ContextMenuPlugin',

    install(pluginHost: PluginHost): void {
      host = pluginHost;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gantt = (pluginHost as any).__gantt ?? null;
      // The gantt root element is on the gantt instance — we walk via
      // its container. Public PluginHost contract doesn't expose it, so
      // we scrape from gantt itself.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rootEl = (gantt && (gantt as any).rootEl) ?? null;
      // Fallback: install on document body if rootEl unavailable.
      const targetEl: HTMLElement | Document =
        rootEl ?? (typeof document !== 'undefined' ? document : (null as unknown as Document));
      if (!targetEl) return;

      ctxHandler = (e: Event) => onContextMenuEvent(e as MouseEvent);
      targetEl.addEventListener('contextmenu', ctxHandler);

      if (!opts.disablePointerDownFallback) {
        pdHandler = (e: PointerEvent) => {
          if (e.button === 2) onContextMenuEvent(e);
        };
        targetEl.addEventListener('pointerdown', pdHandler as EventListener);
      }
    },

    destroy(): void {
      dismissMenu();
      const targetEl: HTMLElement | Document | null =
        rootEl ?? (typeof document !== 'undefined' ? document : null);
      if (targetEl) {
        if (ctxHandler) targetEl.removeEventListener('contextmenu', ctxHandler);
        if (pdHandler) targetEl.removeEventListener('pointerdown', pdHandler as EventListener);
      }
      ctxHandler = null;
      pdHandler = null;
      host = null;
      gantt = null;
      rootEl = null;
    },
  };
}
