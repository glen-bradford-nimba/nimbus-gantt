/**
 * dragReparent.ts — Drag-to-reparent engine for the NimbusGantt grid.
 * Ported from deliverytimeline.resource (DeliveryTimeline v5).
 *
 * Attaches mousedown/mousemove/mouseup listeners to the gantt container.
 * Fires onPatch callbacks when the user drops a task on a new row
 * (priority-group change, parent change, sortOrder change).
 *
 * @param ganttContainer - the root element passed to NimbusGantt
 * @param allTasks       - the raw NormalizedTask array (not mapped)
 * @param depthMap       - id → depth from buildDepthMap()
 * @param onPatch        - callback receiving { id, priorityGroup?, parentId?, sortOrder? }
 * @returns cleanup function to call when the gantt is destroyed
 */
import type { NormalizedTask, TaskPatch } from './types';

interface InsertionPoint {
  parentId: string | null;
  depth: number;
  targetBucket: string;
  targetSortOrder: number;
  insertBeforeRow: HTMLElement | null;
  /** 0.185.6 — when non-null, the drop is interpreted as "make this row the
   *  new parent of the dragged task" (drop-onto-row nesting gesture). When
   *  null, the drop is sibling-reorder and `insertBeforeRow` positions the
   *  spacer. Mutually exclusive with `insertBeforeRow`. */
  nestIntoRow: HTMLElement | null;
  /** 0.185.7 — when true, the drop is interpreted as explicit deparent.
   *  Triggered by dropping on a bucket header (`.ng-group-row`). Emits
   *  `newParentId: null` in the onItemReorder payload so DH can distinguish
   *  "move to root of this bucket" from "no parent change." Mutually
   *  exclusive with nestIntoRow + insertBeforeRow. */
  deparent: boolean;
}

export function startDragReparent(
  ganttContainer: HTMLElement,
  allTasks: NormalizedTask[],
  depthMap: Record<string, number>,
  onPatch: (patch: TaskPatch) => void,
): () => void {
  const DRAG_THRESHOLD = 6;
  const LEAF_STEP = 10;
  const INDENT_BASE = 6;

  const taskById: Record<string, NormalizedTask> = {};
  allTasks.forEach(t => { taskById[t.id] = t; });

  let dragTaskId: string | null = null;
  let dragSourceGroup: string | null = null;
  let dragRow: HTMLElement | null = null;
  let startY = 0, startX = 0, dragStartX = 0, dragStartDepth = 0;
  let hasMoved = false, didDrag = false;
  let ghost: HTMLElement | null = null;
  let spacer: HTMLElement | null = null;
  let pendingIP: InsertionPoint | null = null;
  let autoScrollVel = 0;
  let autoScrollRAF: number | null = null;

  function getSortOrder(id: string): number {
    const t = taskById[id];
    return t ? (Number(t.sortOrder) || 0) : 0;
  }

  function getGroup(id: string): string | null {
    const t = taskById[id];
    return t ? (t.priorityGroup || null) : null;
  }

  function getGroupAtY(clientY: number): string | null {
    const gRows = Array.prototype.slice.call(ganttContainer.querySelectorAll('.ng-group-row')) as HTMLElement[];
    let cur: string | null = null;
    gRows.forEach(row => {
      const rect = row.getBoundingClientRect();
      if (rect.top <= clientY) {
        const tid = row.getAttribute('data-task-id');
        if (tid) {
          if (tid.indexOf('__bucket_header__') === 0) cur = tid.slice('__bucket_header__'.length);
          else if (tid.indexOf('group-') === 0) cur = tid.slice(6);
        }
      }
    });
    return cur;
  }

  function getInsertionPoint(clientY: number, clientX: number): InsertionPoint {
    const allRows = Array.prototype.slice.call(
      ganttContainer.querySelectorAll('.ng-grid-row:not(.ng-group-row)')
    ) as HTMLElement[];
    const vis = allRows.filter(r => r !== dragRow && r !== spacer);

    // 0.185.7 — deparent detection: when the cursor is over a group-header
    // row (bucket header), the drop becomes an explicit deparent. Emits
    // `newParentId: null` so the task becomes a root-level child of the
    // target bucket. Only meaningful when the dragged task currently HAS
    // a parent; otherwise this degrades to a within-bucket reorder.
    const groupRows = Array.prototype.slice.call(
      ganttContainer.querySelectorAll('.ng-group-row')
    ) as HTMLElement[];
    let overGroupRow: HTMLElement | null = null;
    for (const gr of groupRows) {
      const rect = gr.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) { overGroupRow = gr; break; }
    }
    if (overGroupRow) {
      // Resolve the bucket from the group-header's data-task-id.
      const tid = overGroupRow.getAttribute('data-task-id') || '';
      let bucket = '';
      if (tid.indexOf('__bucket_header__') === 0) bucket = tid.slice('__bucket_header__'.length);
      else if (tid.indexOf('group-') === 0) bucket = tid.slice(6);
      const bucketFinal = bucket || dragSourceGroup || '';
      return {
        parentId: null,
        depth: 0,
        targetBucket: bucketFinal,
        // Put the deparented task at the top of the bucket (before any
        // existing root-level tasks). Index-based value matches the
        // sparse-int convention used elsewhere.
        targetSortOrder: 500,
        insertBeforeRow: null,
        nestIntoRow: null,
        deparent: true,
      };
    }

    // 0.185.6 — drop-onto-row nest detection. When the cursor sits inside
    // the middle 50% of a row's body (top 25% = insert-above, bottom 25%
    // = insert-below, middle = nest-under), interpret the drop as "make
    // this row the new parent of the dragged task." The existing
    // horizontal-drag depth gesture is preserved for power users; this
    // adds a more discoverable gesture without removing the old one.
    let nestIntoRow: HTMLElement | null = null;
    for (const row of vis) {
      const rect = row.getBoundingClientRect();
      const nestTop = rect.top + rect.height * 0.25;
      const nestBottom = rect.top + rect.height * 0.75;
      if (clientY >= nestTop && clientY <= nestBottom) {
        nestIntoRow = row;
        break;
      }
    }

    const targetBucket = getGroupAtY(clientY) || dragSourceGroup || '';

    if (nestIntoRow) {
      // Don't allow nesting a row into itself or into its own descendant
      // (would orphan the subtree). Cheap check: walk the target's ancestor
      // chain; if it contains the dragged task, reject the nest gesture
      // and fall through to sibling-reorder semantics.
      const targetId = nestIntoRow.getAttribute('data-task-id');
      let cycleDetected = false;
      if (targetId && dragTaskId) {
        let cur: string | null = targetId;
        while (cur) {
          if (cur === dragTaskId) { cycleDetected = true; break; }
          const t = taskById[cur];
          cur = t ? ((t.parentWorkItemId as string | null) || null) : null;
        }
      }
      if (!cycleDetected && targetId) {
        // New sortOrder: end of target's existing children + 1000, so the
        // dragged task appears as the last child of the target.
        let maxChildSort = 0;
        Object.keys(depthMap).forEach((id) => {
          const t = taskById[id];
          if (t && (t.parentWorkItemId as string | null) === targetId) {
            const s = getSortOrder(id);
            if (s > maxChildSort) maxChildSort = s;
          }
        });
        const nestDepth = (depthMap[targetId] || 0) + 1;
        return {
          parentId: targetId,
          depth: nestDepth,
          targetBucket,
          targetSortOrder: maxChildSort + 1000,
          insertBeforeRow: null,
          nestIntoRow,
          deparent: false,
        };
      }
      // Fall through: cycle or missing target → treat as sibling reorder.
    }

    let rowAbove: HTMLElement | null = null;
    let rowBelow: HTMLElement | null = null;
    for (let i = 0; i < vis.length; i++) {
      const rect = vis[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) { rowBelow = vis[i]; break; }
      rowAbove = vis[i];
    }
    const aboveId = rowAbove ? rowAbove.getAttribute('data-task-id') : null;
    const belowId = rowBelow ? rowBelow.getAttribute('data-task-id') : null;
    const aboveDepth = aboveId != null ? (depthMap[aboveId] || 0) : -1;
    const aboveHasExpand = !!(rowAbove && rowAbove.querySelector('.ng-expand-icon'));
    const maxDepth = rowAbove == null ? 0 : (aboveHasExpand ? aboveDepth + 1 : aboveDepth);
    const depthDelta = Math.round((clientX - dragStartX) / 25);
    const desiredDepth = Math.max(0, Math.min(maxDepth, dragStartDepth + depthDelta));
    let parentId: string | null = null;
    if (desiredDepth > 0) {
      let curId: string | null = aboveId;
      while (curId) {
        const d = depthMap[curId] || 0;
        if (d === desiredDepth - 1) { parentId = curId; break; }
        const it = taskById[curId];
        curId = it ? (it.parentWorkItemId as string | null) : null;
      }
    }
    const sortAbove = aboveId ? getSortOrder(aboveId) : 0;
    const sortBelow = belowId ? getSortOrder(belowId) : sortAbove + 2;
    // When both neighbours share the same sortOrder (common when all tasks start at 0)
    // fall back to an index-based value so drops are distinguishable.
    const aboveIdx = rowAbove ? vis.indexOf(rowAbove) : -1;
    const targetSort = (sortAbove !== sortBelow)
      ? (sortAbove + sortBelow) / 2
      : (aboveIdx >= 0 ? (aboveIdx + 1) * 1000 : 500);
    return { parentId, depth: desiredDepth, targetBucket, targetSortOrder: targetSort, insertBeforeRow: rowBelow, nestIntoRow: null, deparent: false };
  }

  function cleanupDrag() {
    if (ghost) { ghost.remove(); ghost = null; }
    if (spacer) { spacer.remove(); spacer = null; }
    if (dragRow) { dragRow.style.opacity = ''; dragRow.style.outline = ''; }
    document.body.style.cursor = '';
    // 0.185.5 — clear any cross-group target highlight applied during drag.
    ganttContainer.querySelectorAll<HTMLElement>('.ng-group-row.ng-drop-target').forEach((row) => {
      row.classList.remove('ng-drop-target');
      row.style.boxShadow = '';
    });
    // 0.185.6 — clear any nest-target row highlight.
    ganttContainer.querySelectorAll<HTMLElement>('.ng-nest-target').forEach((row) => {
      row.classList.remove('ng-nest-target');
      row.style.boxShadow = '';
      row.style.background = '';
    });
    // 0.185.7 — clear any deparent-target group-row highlight.
    ganttContainer.querySelectorAll<HTMLElement>('.ng-deparent-target').forEach((row) => {
      row.classList.remove('ng-deparent-target');
      row.style.boxShadow = '';
    });
    dragTaskId = null; dragSourceGroup = null; dragRow = null; hasMoved = false; pendingIP = null;
  }

  function findScrollEl(): HTMLElement | null {
    return ganttContainer.querySelector<HTMLElement>('.ng-scroll-wrapper');
  }

  function tickAutoScroll() {
    const el = findScrollEl();
    if (!el || !dragTaskId || autoScrollVel === 0) { autoScrollRAF = null; return; }
    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + autoScrollVel));
    autoScrollRAF = requestAnimationFrame(tickAutoScroll);
  }

  function onMouseDown(e: MouseEvent) {
    const row = (e.target as Element).closest<HTMLElement>('.ng-grid-row:not(.ng-group-row)');
    if (!row) return;
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea') return;
    const taskId = row.getAttribute('data-task-id');
    if (!taskId) return;
    // Fall back to the visual bucket header above the row when priorityGroup isn't set on the task
    const grp = getGroup(taskId) || getGroupAtY(e.clientY) || '';
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    dragTaskId = taskId; dragSourceGroup = grp; dragRow = row;
    startY = e.clientY; startX = e.clientX; dragStartX = e.clientX;
    dragStartDepth = depthMap[taskId] || 0;
    hasMoved = false; didDrag = false; pendingIP = null;
    document.body.style.cursor = 'grabbing';
    row.style.outline = '2px solid #3b82f6';
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragTaskId || !dragRow) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!hasMoved && (Math.abs(dy) > DRAG_THRESHOLD || Math.abs(dx) > DRAG_THRESHOLD)) {
      hasMoved = true; didDrag = true;

      /* Ghost */
      const firstCell = dragRow.querySelector<HTMLElement>('td');
      ghost = document.createElement('div');
      ghost.style.cssText = 'position:fixed;z-index:10000;pointer-events:none;left:' + (e.clientX - 16) + 'px;top:' + (e.clientY - 18) + 'px;background:#dbeafe;border:2px solid #2563eb;border-radius:8px;box-shadow:0 16px 40px rgba(37,99,235,0.4);padding:6px 12px;font-size:12px;font-weight:700;color:#1d4ed8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grabbing;transform:rotate(-1.5deg) scale(1.04);display:flex;align-items:center;gap:8px;max-width:320px';
      ghost.innerHTML = '<span style="opacity:.6;font-size:14px">⠇</span><span style="overflow:hidden;text-overflow:ellipsis">' + (firstCell ? firstCell.innerText.replace(/\s+/g, ' ').slice(0, 60) : '') + '</span>';
      document.body.appendChild(ghost);

      /* Spacer */
      const tbody = dragRow.parentElement;
      if (tbody) {
        spacer = document.createElement('tr');
        spacer.setAttribute('data-drag-spacer', '1');
        spacer.style.pointerEvents = 'none';
        const numCols = dragRow.querySelectorAll('td').length || 6;
        const td = document.createElement('td');
        td.setAttribute('colspan', String(numCols));
        td.style.cssText = 'padding:0;height:34px;background:rgba(59,130,246,0.07);border-top:2px solid #3b82f6;border-bottom:2px solid rgba(59,130,246,0.3)';
        const span = document.createElement('span');
        span.style.cssText = 'display:flex;align-items:center;height:100%;padding-left:10px;font-size:10px;font-weight:700;color:#3b82f6;letter-spacing:.05em;opacity:.7';
        span.textContent = '↓ drop here';
        td.appendChild(span); spacer.appendChild(td);
        tbody.insertBefore(spacer, dragRow.nextSibling);
      }
      dragRow.style.opacity = '0.25'; dragRow.style.outline = '';
    }
    if (!hasMoved) return;
    if (ghost) { ghost.style.left = (e.clientX - 12) + 'px'; ghost.style.top = (e.clientY - 14) + 'px'; }

    /* Auto-scroll */
    const scrollEl = findScrollEl();
    if (scrollEl) {
      const sr = scrollEl.getBoundingClientRect(), EDGE = 60, MAX = 18;
      let v = 0;
      if (e.clientY < sr.top + EDGE) v = -Math.ceil(MAX * Math.min(1, (sr.top + EDGE - e.clientY) / EDGE));
      else if (e.clientY > sr.bottom - EDGE) v = Math.ceil(MAX * Math.min(1, (e.clientY - (sr.bottom - EDGE)) / EDGE));
      autoScrollVel = v;
      if (v !== 0 && autoScrollRAF == null) autoScrollRAF = requestAnimationFrame(tickAutoScroll);
    }

    const ip = getInsertionPoint(e.clientY, e.clientX);
    pendingIP = ip;
    if (spacer) {
      const tb = dragRow ? dragRow.parentElement : null;
      if (ip.nestIntoRow || ip.deparent) {
        // 0.185.6/7 — nesting or deparenting: hide the spacer because the
        // drop target is a row (nest) or a bucket header (deparent), not
        // a gap between rows.
        if (tb && spacer.parentElement === tb) spacer.remove();
      } else if (tb) {
        if (ip.insertBeforeRow && ip.insertBeforeRow !== spacer) tb.insertBefore(spacer, ip.insertBeforeRow);
        else if (!ip.insertBeforeRow) tb.appendChild(spacer);
        const indent = INDENT_BASE + ip.depth * LEAF_STEP;
        const lbl = spacer.querySelector<HTMLElement>('td span');
        if (lbl) lbl.style.paddingLeft = (indent + 8) + 'px';
      }
    }
    // 0.185.5 — cross-group target highlight. When the drop target bucket
    // differs from the source bucket, highlight the target bucket header
    // so the user sees where the drop will land. Toggle on per-move; the
    // bucket DOM is the `.ng-group-row` with a matching data-task-id.
    // 0.185.7 — skip this when explicit deparent is active (its own
    // amber highlight takes precedence; avoids double-highlighting).
    updateBucketHighlight(ip.deparent ? null : ip.targetBucket);
    // 0.185.6 — nest-target row highlight. When the cursor is in a row's
    // middle zone (nest gesture), highlight that row to show "this will
    // become the parent." Distinct from the cross-group bucket highlight.
    updateNestHighlight(ip.nestIntoRow);
    // 0.185.7 — deparent highlight. When cursor is over a bucket header
    // (drop there = move to root of bucket), show an amber inset shadow
    // on that header. Distinct from blue cross-group and green nest.
    updateDeparentHighlight(ip.deparent ? getGroupRowForBucket(ip.targetBucket) : null);
  }

  function getGroupRowForBucket(bucket: string): HTMLElement | null {
    if (!bucket) return null;
    const rows = ganttContainer.querySelectorAll<HTMLElement>('.ng-group-row');
    for (const row of Array.from(rows)) {
      const tid = row.getAttribute('data-task-id') || '';
      if (tid === `__bucket_header__${bucket}` || tid === `group-${bucket}`) return row;
    }
    return null;
  }

  function updateDeparentHighlight(target: HTMLElement | null): void {
    ganttContainer.querySelectorAll<HTMLElement>('.ng-deparent-target').forEach((row) => {
      row.classList.remove('ng-deparent-target');
      row.style.boxShadow = '';
    });
    if (!target) return;
    target.classList.add('ng-deparent-target');
    target.style.boxShadow = 'inset 0 0 0 3px #f59e0b';
  }

  function updateNestHighlight(target: HTMLElement | null): void {
    const prev = ganttContainer.querySelectorAll<HTMLElement>('.ng-nest-target');
    prev.forEach((row) => {
      row.classList.remove('ng-nest-target');
      row.style.boxShadow = '';
      row.style.background = '';
    });
    if (!target) return;
    target.classList.add('ng-nest-target');
    // Inset green shadow distinguishes nest from blue cross-group highlight.
    target.style.boxShadow = 'inset 0 0 0 2px #10b981';
    target.style.background = 'rgba(16,185,129,0.08)';
  }

  function updateBucketHighlight(targetBucket: string | null): void {
    const allGroupRows = ganttContainer.querySelectorAll<HTMLElement>('.ng-group-row');
    allGroupRows.forEach((row) => {
      row.classList.remove('ng-drop-target');
      row.style.boxShadow = '';
    });
    if (!targetBucket || targetBucket === dragSourceGroup) return;
    // Bucket headers have data-task-id like `__bucket_header__<bucket>` or
    // `group-<bucket>`. Match either.
    const target = Array.from(allGroupRows).find((row) => {
      const tid = row.getAttribute('data-task-id') || '';
      if (tid === `__bucket_header__${targetBucket}`) return true;
      if (tid === `group-${targetBucket}`) return true;
      return false;
    });
    if (target) {
      target.classList.add('ng-drop-target');
      target.style.boxShadow = 'inset 0 0 0 2px #3b82f6';
    }
  }

  function onMouseUp(e: MouseEvent) {
    void e;
    autoScrollVel = 0;
    if (autoScrollRAF != null) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
    const savedId = dragTaskId, savedGroup = dragSourceGroup, savedMoved = hasMoved, ip = pendingIP;
    cleanupDrag();
    if (!savedId) return;
    if (!savedMoved) return; /* single-click handled by onTaskClick */
    if (!ip) return;

    /* Dispatch patches */
    if (ip.targetBucket && ip.targetBucket !== savedGroup) {
      onPatch({ id: savedId, priorityGroup: ip.targetBucket });
    }
    const currentParent = taskById[savedId] ? taskById[savedId].parentWorkItemId : undefined;
    if (ip.parentId !== currentParent) {
      onPatch({ id: savedId, parentId: ip.parentId || null });
    }
    onPatch({ id: savedId, sortOrder: ip.targetSortOrder });

    /* Suppress didDrag side-effect */
    void didDrag;
  }

  ganttContainer.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);

  return function cleanup() {
    ganttContainer.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    cleanupDrag();
  };
}
