// ─── DOM-Based Tree Grid ────────────────────────────────────────────────────
// Renders the left-side tree grid panel using real DOM elements for
// accessibility and keyboard navigation. Columns, indentation, expand/collapse,
// selection, hover, and resize are all handled here.

import type {
  GanttState,
  GanttTask,
  TaskTreeNode,
  ColumnConfig,
  ResolvedTheme,
} from '../model/types';

// ─── Style Injection ───────────────────────────────────────────────────────

const STYLE_ID = 'ng-tree-grid-styles';

function injectStyles(root: HTMLElement, theme: ResolvedTheme): void {
  // Remove any previous style element we created inside this root
  const existing = root.querySelector(`#${STYLE_ID}`);
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ng-grid {
      height: 100%;
      overflow: hidden;
      border-right: 1px solid ${theme.gridBorderColor};
      background: ${theme.gridBg};
      font-family: ${theme.fontFamily};
      font-size: ${theme.fontSize}px;
      color: ${theme.gridTextColor};
      display: flex;
      flex-direction: column;
      user-select: none;
      -webkit-user-select: none;
      box-sizing: border-box;
    }

    .ng-grid *, .ng-grid *::before, .ng-grid *::after {
      box-sizing: border-box;
    }

    .ng-grid table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    /* ── Header ──────────────────────────────────────────────────────────── */

    .ng-grid-header {
      flex-shrink: 0;
      overflow: hidden;
      background: ${theme.gridHeaderBg};
      color: ${theme.gridHeaderText};
      border-bottom: 1px solid ${theme.gridBorderColor};
      z-index: 2;
    }

    .ng-grid-th {
      position: relative;
      padding: 0 8px;
      text-align: left;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-right: 1px solid ${theme.gridBorderColor};
      vertical-align: middle;
    }

    .ng-grid-th:last-child {
      border-right: none;
    }

    /* ── Resize Handle ───────────────────────────────────────────────────── */

    .ng-resize-handle {
      position: absolute;
      top: 0;
      right: 0;
      width: 5px;
      height: 100%;
      cursor: col-resize;
      z-index: 3;
    }

    .ng-resize-handle:hover {
      background: ${theme.selectionColor};
    }

    /* ── Body ────────────────────────────────────────────────────────────── */

    .ng-grid-body {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .ng-grid-body-inner {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    }

    /* ── Rows ────────────────────────────────────────────────────────────── */

    .ng-grid-row {
      cursor: pointer;
      border-bottom: 1px solid ${theme.gridBorderColor};
    }

    .ng-grid-row:hover {
      background: ${theme.gridHoverBg};
    }

    .ng-row-alt {
      background: ${theme.gridAltRowBg};
    }

    .ng-row-alt:hover {
      background: ${theme.gridHoverBg};
    }

    .ng-row-selected {
      background: ${theme.selectionColor} !important;
    }

    .ng-group-row {
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    .ng-group-row .ng-grid-cell-text {
      opacity: 0.9;
    }

    .ng-group-row .ng-expand-icon {
      opacity: 0.75;
    }

    .ng-group-row:hover {
      filter: brightness(0.97);
    }

    /* ── Cells ───────────────────────────────────────────────────────────── */

    .ng-grid-cell {
      padding: 0 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
      border-right: 1px solid ${theme.gridBorderColor};
      line-height: 1;
    }

    .ng-grid-cell:last-child {
      border-right: none;
    }

    /* ── Tree Cell ───────────────────────────────────────────────────────── */

    .ng-tree-cell {
      display: flex;
      align-items: center;
      overflow: hidden;
    }

    .ng-tree-cell > .ng-grid-cell-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    /* ── Expand Icon ─────────────────────────────────────────────────────── */

    .ng-expand-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      cursor: pointer;
      font-size: 10px;
      opacity: 0.65;
      transition: transform 0.15s ease;
      margin-right: 4px;
    }

    .ng-expand-icon:hover {
      opacity: 1;
    }

    .ng-expand-icon.ng-expanded {
      transform: rotate(90deg);
    }

    .ng-expand-spacer {
      display: inline-block;
      width: 16px;
      flex-shrink: 0;
      margin-right: 4px;
    }
  `;

  root.insertBefore(style, root.firstChild);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function flattenVisible(nodes: TaskTreeNode[]): TaskTreeNode[] {
  const result: TaskTreeNode[] = [];
  function walk(list: TaskTreeNode[]): void {
    for (const node of list) {
      if (node.visible) {
        result.push(node);
      }
      if (node.expanded && node.children.length > 0) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

function getCellValue(task: GanttTask, col: ColumnConfig): string {
  if (col.renderer) {
    return col.renderer(task, col.field);
  }

  // Try direct property first, then metadata
  const raw =
    (task as unknown as Record<string, unknown>)[col.field] ??
    task.metadata?.[col.field] ??
    '';

  if (raw === null || raw === undefined) return '';
  return String(raw);
}

// ─── DomTreeGrid ───────────────────────────────────────────────────────────

export class DomTreeGrid {
  private container: HTMLElement;
  private rootEl: HTMLElement;
  private headerEl: HTMLElement;
  private bodyEl: HTMLElement;
  private bodyInner: HTMLElement;
  private headerColgroup: HTMLElement;
  private bodyColgroup: HTMLElement;
  private tbody: HTMLElement;
  private rows: Map<string, HTMLElement> = new Map();

  private clickHandler: ((taskId: string, event: MouseEvent) => void) | null = null;
  private dblClickHandler: ((taskId: string, event: MouseEvent) => void) | null = null;
  private expandHandler: ((taskId: string) => void) | null = null;
  private resizeHandler: ((field: string, width: number) => void) | null = null;

  // Track column widths for resize operations
  private columnWidths: number[] = [];
  private columns: ColumnConfig[] = [];

  // Tracks the current flat visible task IDs for efficient diffing
  private currentVisibleIds: string[] = [];

  // Bound listeners for cleanup
  private boundBodyClick: (e: MouseEvent) => void;
  private boundBodyDblClick: (e: MouseEvent) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // Build skeleton DOM
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'ng-grid';

    // ── Header ──
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'ng-grid-header';
    const headerTable = document.createElement('table');
    this.headerColgroup = document.createElement('colgroup');
    headerTable.appendChild(this.headerColgroup);
    const thead = document.createElement('thead');
    headerTable.appendChild(thead);
    this.headerEl.appendChild(headerTable);

    // ── Body ──
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'ng-grid-body';
    this.bodyInner = document.createElement('div');
    this.bodyInner.className = 'ng-grid-body-inner';
    const bodyTable = document.createElement('table');
    this.bodyColgroup = document.createElement('colgroup');
    bodyTable.appendChild(this.bodyColgroup);
    this.tbody = document.createElement('tbody');
    bodyTable.appendChild(this.tbody);
    this.bodyInner.appendChild(bodyTable);
    this.bodyEl.appendChild(this.bodyInner);

    this.rootEl.appendChild(this.headerEl);
    this.rootEl.appendChild(this.bodyEl);
    this.container.appendChild(this.rootEl);

    // ── Event delegation ──
    this.boundBodyClick = (e: MouseEvent) => this.handleBodyClick(e);
    this.boundBodyDblClick = (e: MouseEvent) => this.handleBodyDblClick(e);
    this.bodyEl.addEventListener('click', this.boundBodyClick);
    this.bodyEl.addEventListener('dblclick', this.boundBodyDblClick);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  render(state: GanttState, tree: TaskTreeNode[]): void {
    const { config } = state;
    const { columns, rowHeight } = config;
    const theme = config.theme;

    // Inject / update styles on first render or theme change
    injectStyles(this.rootEl, theme);

    // Update column config tracking
    this.columns = columns;
    this.columnWidths = columns.map((c) => c.width ?? 120);

    // Set header height to match config
    this.headerEl.style.height = `${config.headerHeight}px`;
    this.headerEl.style.lineHeight = `${config.headerHeight}px`;

    // ── Rebuild colgroups ──
    this.rebuildColgroups();

    // ── Rebuild header row ──
    this.rebuildHeader(columns, config.headerHeight);

    // ── Flatten visible nodes ──
    const visibleNodes = flattenVisible(tree);
    const newVisibleIds = visibleNodes.map((n) => n.task.id);

    // ── Diff-based row update ──
    this.updateRows(visibleNodes, newVisibleIds, state);

    this.currentVisibleIds = newVisibleIds;
  }

  setScrollY(scrollY: number): void {
    this.bodyInner.style.transform = `translateY(${-scrollY}px)`;
  }

  onRowClick(handler: (taskId: string, event: MouseEvent) => void): void {
    this.clickHandler = handler;
  }

  onRowDblClick(handler: (taskId: string, event: MouseEvent) => void): void {
    this.dblClickHandler = handler;
  }

  onExpandToggle(handler: (taskId: string) => void): void {
    this.expandHandler = handler;
  }

  onResizeColumn(handler: (field: string, width: number) => void): void {
    this.resizeHandler = handler;
  }

  highlight(taskId: string): void {
    const row = this.rows.get(taskId);
    if (row) {
      row.classList.add('ng-row-selected');
    }
  }

  clearHighlight(): void {
    for (const row of this.rows.values()) {
      row.classList.remove('ng-row-selected');
    }
  }

  destroy(): void {
    this.bodyEl.removeEventListener('click', this.boundBodyClick);
    this.bodyEl.removeEventListener('dblclick', this.boundBodyDblClick);
    this.rows.clear();
    this.currentVisibleIds = [];
    if (this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
  }

  // ─── Internal: Header ────────────────────────────────────────────────────

  private rebuildColgroups(): void {
    // Clear and recreate col elements for both header and body
    this.headerColgroup.innerHTML = '';
    this.bodyColgroup.innerHTML = '';

    for (const width of this.columnWidths) {
      const hCol = document.createElement('col');
      hCol.style.width = `${width}px`;
      this.headerColgroup.appendChild(hCol);

      const bCol = document.createElement('col');
      bCol.style.width = `${width}px`;
      this.bodyColgroup.appendChild(bCol);
    }
  }

  private rebuildHeader(columns: ColumnConfig[], headerHeight: number): void {
    const thead = this.headerEl.querySelector('thead')!;
    // Check if the header row already matches
    const existingTr = thead.querySelector('tr');
    if (existingTr && existingTr.children.length === columns.length) {
      // Update existing header cells in place
      for (let i = 0; i < columns.length; i++) {
        const th = existingTr.children[i] as HTMLElement;
        const textSpan = th.querySelector('.ng-th-text');
        if (textSpan && textSpan.textContent !== columns[i].header) {
          textSpan.textContent = columns[i].header;
        }
        th.setAttribute('data-field', columns[i].field);
      }
      return;
    }

    // Full rebuild
    thead.innerHTML = '';
    const tr = document.createElement('tr');
    tr.style.height = `${headerHeight}px`;

    columns.forEach((col, idx) => {
      const th = document.createElement('th');
      th.className = 'ng-grid-th';
      th.setAttribute('data-field', col.field);

      const textSpan = document.createElement('span');
      textSpan.className = 'ng-th-text';
      textSpan.textContent = col.header;
      th.appendChild(textSpan);

      const resizeHandle = document.createElement('span');
      resizeHandle.className = 'ng-resize-handle';
      th.appendChild(resizeHandle);

      this.attachResizeListener(resizeHandle, idx);

      tr.appendChild(th);
    });

    thead.appendChild(tr);
  }

  // ─── Internal: Column Resize ─────────────────────────────────────────────

  private attachResizeListener(handle: HTMLElement, colIndex: number): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = this.columnWidths[colIndex];
      const minWidth = this.columns[colIndex].minWidth ?? 40;

      const onMouseMove = (moveEvt: MouseEvent) => {
        const delta = moveEvt.clientX - startX;
        const newWidth = Math.max(minWidth, startWidth + delta);
        this.columnWidths[colIndex] = newWidth;

        // Update both colgroups
        const hCols = this.headerColgroup.children;
        const bCols = this.bodyColgroup.children;
        if (hCols[colIndex]) {
          (hCols[colIndex] as HTMLElement).style.width = `${newWidth}px`;
        }
        if (bCols[colIndex]) {
          (bCols[colIndex] as HTMLElement).style.width = `${newWidth}px`;
        }
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Notify consumer
        if (this.resizeHandler) {
          this.resizeHandler(
            this.columns[colIndex].field,
            this.columnWidths[colIndex],
          );
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ─── Internal: Diff-Based Row Update ─────────────────────────────────────

  private updateRows(
    visibleNodes: TaskTreeNode[],
    newVisibleIds: string[],
    state: GanttState,
  ): void {
    const { config } = state;
    const { rowHeight } = config;
    const newIdSet = new Set(newVisibleIds);
    const nodeMap = new Map<string, TaskTreeNode>();
    for (const node of visibleNodes) {
      nodeMap.set(node.task.id, node);
    }

    // Remove rows no longer visible
    for (const [id, rowEl] of this.rows) {
      if (!newIdSet.has(id)) {
        rowEl.remove();
        this.rows.delete(id);
      }
    }

    // Build or update rows in the correct order
    let prevRow: HTMLElement | null = null;
    for (let i = 0; i < visibleNodes.length; i++) {
      const node = visibleNodes[i];
      const taskId = node.task.id;
      let rowEl = this.rows.get(taskId);

      if (rowEl) {
        // Update existing row content
        this.updateRowContent(rowEl, node, i, state);
      } else {
        // Create new row
        rowEl = this.createRow(node, i, state);
        this.rows.set(taskId, rowEl);
      }

      // Ensure correct row height
      rowEl.style.height = `${rowHeight}px`;

      // Ensure correct DOM order
      if (prevRow) {
        if (prevRow.nextSibling !== rowEl) {
          this.tbody.insertBefore(rowEl, prevRow.nextSibling);
        }
      } else {
        if (this.tbody.firstChild !== rowEl) {
          this.tbody.insertBefore(rowEl, this.tbody.firstChild);
        }
      }

      prevRow = rowEl;
    }
  }

  private createRow(
    node: TaskTreeNode,
    rowIndex: number,
    state: GanttState,
  ): HTMLElement {
    const { config } = state;
    const { columns, rowHeight } = config;
    const tr = document.createElement('tr');
    tr.className = 'ng-grid-row';
    tr.setAttribute('data-task-id', node.task.id);
    tr.style.height = `${rowHeight}px`;

    // Group header rows — apply class + inline background so CSS and
    // attribute selectors can both target them. groupBg is set by
    // PriorityGroupingPlugin on tasks with status === 'group-header'.
    if (node.task.status === 'group-header') {
      tr.classList.add('ng-group-row');
      if (node.task.groupBg) {
        tr.style.background = node.task.groupBg;
      }
    } else {
      // Alternating row class (skip on group headers)
      if (rowIndex % 2 === 1) {
        tr.classList.add('ng-row-alt');
      }
    }

    // Selected class
    if (state.selectedIds.has(node.task.id)) {
      tr.classList.add('ng-row-selected');
    }

    // Build cells
    for (const col of columns) {
      const td = this.createCell(node, col, state);
      tr.appendChild(td);
    }

    return tr;
  }

  private createCell(
    node: TaskTreeNode,
    col: ColumnConfig,
    state: GanttState,
  ): HTMLElement {
    const td = document.createElement('td');
    td.className = 'ng-grid-cell';
    td.setAttribute('data-field', col.field);

    if (col.align === 'center') {
      td.style.textAlign = 'center';
    } else if (col.align === 'right') {
      td.style.textAlign = 'right';
    }

    if (col.tree) {
      // Tree cell with indentation and expand icon
      td.classList.add('ng-tree-cell');
      const indent = node.depth * 20 + 8;
      td.style.paddingLeft = `${indent}px`;

      if (node.children.length > 0) {
        const expandIcon = document.createElement('span');
        expandIcon.className = 'ng-expand-icon';
        if (node.expanded) {
          expandIcon.classList.add('ng-expanded');
        }
        expandIcon.innerHTML = '&#9654;'; // ▶ — rotation handled by CSS class
        expandIcon.setAttribute('data-expand', node.task.id);
        td.appendChild(expandIcon);
      } else {
        // Spacer to keep text aligned with siblings
        const spacer = document.createElement('span');
        spacer.className = 'ng-expand-spacer';
        td.appendChild(spacer);
      }

      // ── Drag handle (hamburger) for leaf rows (cloudnimbusllc.com patch) ──
      if (node.children.length === 0 && !node.task.groupBg) {
        const grip = document.createElement('span');
        grip.className = 'ng-drag-handle';
        grip.innerHTML = '&#9776;';
        td.appendChild(grip);
      }

      // ── Color dot before task name (uses task.color or colorMap) ──────────
      const taskColor = node.task.color ||
        (state.config.colorMap?.[node.task.status ?? '']) || '';
      if (taskColor && node.children.length === 0) {
        const dot = document.createElement('span');
        dot.className = 'ng-status-dot';
        dot.style.cssText =
          `display:inline-block;width:7px;height:7px;border-radius:50%;` +
          `background:${taskColor};margin-right:5px;flex-shrink:0;vertical-align:middle;`;
        td.appendChild(dot);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'ng-grid-cell-text';
      textSpan.textContent = getCellValue(node.task, col);
      td.appendChild(textSpan);
    } else if (col.field === '_drag' && node.children.length === 0 && !node.task.groupBg) {
      // ── Standalone _drag column: hamburger for leaf rows only ────────────
      const grip = document.createElement('span');
      grip.className = 'ng-drag-handle';
      grip.innerHTML = '&#9776;';
      td.appendChild(grip);
    } else {
      td.textContent = getCellValue(node.task, col);
    }

    return td;
  }

  private updateRowContent(
    rowEl: HTMLElement,
    node: TaskTreeNode,
    rowIndex: number,
    state: GanttState,
  ): void {
    const { config } = state;
    const { columns } = config;

    // Group header styling
    if (node.task.status === 'group-header') {
      rowEl.classList.add('ng-group-row');
      if (node.task.groupBg) {
        rowEl.style.background = node.task.groupBg;
      }
      rowEl.classList.remove('ng-row-alt');
    } else {
      rowEl.classList.remove('ng-group-row');
      rowEl.style.background = '';
      // Update alternating class
      if (rowIndex % 2 === 1) {
        rowEl.classList.add('ng-row-alt');
      } else {
        rowEl.classList.remove('ng-row-alt');
      }
    }

    // Update selected class
    if (state.selectedIds.has(node.task.id)) {
      rowEl.classList.add('ng-row-selected');
    } else {
      rowEl.classList.remove('ng-row-selected');
    }

    // Update cells
    const cells = rowEl.querySelectorAll('td.ng-grid-cell');
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const td = cells[i] as HTMLElement | undefined;

      if (!td) {
        // Column was added — append a new cell
        const newTd = this.createCell(node, col, state);
        rowEl.appendChild(newTd);
        continue;
      }

      if (col.tree) {
        // Update tree cell: indentation, expand icon state, text
        const indent = node.depth * 20 + 8;
        // Guard: only write if changed — avoids CSS layout thrash on every scroll tick
        const newPad = `${indent}px`;
        if (td.style.paddingLeft !== newPad) td.style.paddingLeft = newPad;

        const expandIcon = td.querySelector('.ng-expand-icon') as HTMLElement | null;
        const spacer = td.querySelector('.ng-expand-spacer') as HTMLElement | null;

        if (node.children.length > 0) {
          if (!expandIcon) {
            // Replace spacer with expand icon
            if (spacer) spacer.remove();
            const newIcon = document.createElement('span');
            newIcon.className = 'ng-expand-icon';
            if (node.expanded) {
              newIcon.classList.add('ng-expanded');
            }
            newIcon.innerHTML = '&#9654;';
            newIcon.setAttribute('data-expand', node.task.id);
            td.insertBefore(newIcon, td.firstChild);
          } else {
            // Update expand state
            if (node.expanded) {
              expandIcon.classList.add('ng-expanded');
            } else {
              expandIcon.classList.remove('ng-expanded');
            }
          }
        } else {
          if (expandIcon) {
            // Replace icon with spacer
            expandIcon.remove();
            const newSpacer = document.createElement('span');
            newSpacer.className = 'ng-expand-spacer';
            td.insertBefore(newSpacer, td.firstChild);
          }
        }

        // ── Update or create drag handle (cloudnimbusllc.com patch) ──────────
        const existingGrip = td.querySelector('.ng-drag-handle') as HTMLElement | null;
        if (node.children.length === 0 && !node.task.groupBg) {
          if (!existingGrip) {
            const grip = document.createElement('span');
            grip.className = 'ng-drag-handle';
            grip.innerHTML = '&#9776;';
            const dotOrText = td.querySelector('.ng-status-dot') || td.querySelector('.ng-grid-cell-text');
            dotOrText ? td.insertBefore(grip, dotOrText) : td.appendChild(grip);
          }
        } else if (existingGrip) {
          existingGrip.remove();
        }

        // ── Update or create color dot ──────────────────────────────────────
        const existingDot = td.querySelector('.ng-status-dot') as HTMLElement | null;
        const taskColor = node.task.color ||
          (state.config.colorMap?.[node.task.status ?? '']) || '';
        if (taskColor && node.children.length === 0) {
          if (existingDot) {
            existingDot.style.background = taskColor;
          } else {
            const dot = document.createElement('span');
            dot.className = 'ng-status-dot';
            dot.style.cssText =
              `display:inline-block;width:7px;height:7px;border-radius:50%;` +
              `background:${taskColor};margin-right:5px;flex-shrink:0;vertical-align:middle;`;
            const cellText = td.querySelector('.ng-grid-cell-text');
            cellText ? td.insertBefore(dot, cellText) : td.appendChild(dot);
          }
        } else if (existingDot) {
          existingDot.remove();
        }

        // Update text content
        const textSpan = td.querySelector('.ng-grid-cell-text');
        if (textSpan) {
          const newValue = getCellValue(node.task, col);
          if (textSpan.textContent !== newValue) {
            textSpan.textContent = newValue;
          }
        }
      } else if (col.field === '_drag') {
        // ── Update _drag column: show hamburger for leaf rows only ──────────
        const existingGrip = td.querySelector('.ng-drag-handle') as HTMLElement | null;
        if (node.children.length === 0 && !node.task.groupBg) {
          if (!existingGrip) {
            td.textContent = '';
            const grip = document.createElement('span');
            grip.className = 'ng-drag-handle';
            grip.innerHTML = '&#9776;';
            td.appendChild(grip);
          }
        } else if (existingGrip) {
          td.textContent = '';
        }
      } else {
        // Simple cell — just update text
        const newValue = getCellValue(node.task, col);
        if (td.textContent !== newValue) {
          td.textContent = newValue;
        }
      }
    }

    // Remove extra cells if columns were removed
    while (rowEl.children.length > columns.length) {
      rowEl.removeChild(rowEl.lastChild!);
    }
  }

  // ─── Internal: Event Handling ────────────────────────────────────────────

  private findTaskId(target: EventTarget | null): string | null {
    let el = target as HTMLElement | null;
    while (el && el !== this.bodyEl) {
      if (el.hasAttribute('data-task-id')) {
        return el.getAttribute('data-task-id');
      }
      el = el.parentElement;
    }
    return null;
  }

  private handleBodyClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    // Check for expand icon click first
    if (target.hasAttribute('data-expand') || target.closest('.ng-expand-icon')) {
      const expandEl = target.hasAttribute('data-expand')
        ? target
        : target.closest('.ng-expand-icon') as HTMLElement;
      if (expandEl && this.expandHandler) {
        const taskId = expandEl.getAttribute('data-expand');
        if (taskId) {
          e.stopPropagation();
          this.expandHandler(taskId);
          return;
        }
      }
    }

    // Row click
    const taskId = this.findTaskId(e.target);
    if (taskId && this.clickHandler) {
      this.clickHandler(taskId, e);
    }
  }

  private handleBodyDblClick(e: MouseEvent): void {
    const taskId = this.findTaskId(e.target);
    if (taskId && this.dblClickHandler) {
      this.dblClickHandler(taskId, e);
    }
  }
}
