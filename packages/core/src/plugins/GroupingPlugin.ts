// ─── Grouping / Swimlane Plugin ─────────────────────────────────────────────
// Groups tasks by their `groupId` / `groupName` fields and renders collapsible
// swimlane headers spanning the full timeline width. Uses middleware to filter
// flatVisibleIds when groups are collapsed.

import type {
  NimbusGanttPlugin,
  PluginHost,
  Action,
  GanttState,
  TaskLayout,
  GanttTask,
} from '../model/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GroupInfo {
  groupId: string;
  groupName: string;
  taskIds: string[];
  collapsed: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const GROUP_HEADER_BG = 'rgba(100, 116, 139, 0.12)';     // Slate tint
const GROUP_HEADER_BG_HOVER = 'rgba(100, 116, 139, 0.18)';
const GROUP_HEADER_BORDER = 'rgba(100, 116, 139, 0.25)';
const GROUP_TEXT_COLOR = '#334155';
const BADGE_BG = 'rgba(100, 116, 139, 0.2)';
const BADGE_TEXT_COLOR = '#475569';
const BADGE_RADIUS = 8;
const BADGE_PADDING_X = 6;
const BADGE_PADDING_Y = 2;
const CHEVRON_SIZE = 5;
const CHEVRON_LEFT_MARGIN = 12;
const TEXT_LEFT_MARGIN = 28;
const BADGE_LEFT_GAP = 8;

// ─── Plugin Factory ─────────────────────────────────────────────────────────

export function GroupingPlugin(): NimbusGanttPlugin {
  let host: PluginHost | null = null;
  const collapsedGroups = new Set<string>();

  // Computed group info — rebuilt on each state change
  let groups: GroupInfo[] = [];
  // Map from row index in the adjusted flatVisibleIds to group header info.
  // If a row index maps to a GroupInfo, that row is a group header.
  let groupHeaderRows = new Map<number, GroupInfo>();
  // The adjusted flat visible IDs (with group headers accounted for)
  let adjustedFlatIds: string[] = [];

  // Click handler for group headers (DOM overlay)
  let clickHandler: ((e: MouseEvent) => void) | null = null;
  let containerEl: HTMLElement | null = null;
  let unsubRender: (() => void) | null = null;

  // ─── Build groups from state ──────────────────────────────────────────

  function buildGroups(state: GanttState): void {
    const groupMap = new Map<string, GroupInfo>();
    const ungrouped: string[] = [];

    // Gather tasks by groupId, preserving flatVisibleIds order
    for (const taskId of state.flatVisibleIds) {
      const task = state.tasks.get(taskId);
      if (!task) continue;

      if (task.groupId) {
        let group = groupMap.get(task.groupId);
        if (!group) {
          group = {
            groupId: task.groupId,
            groupName: task.groupName || task.groupId,
            taskIds: [],
            collapsed: collapsedGroups.has(task.groupId),
          };
          groupMap.set(task.groupId, group);
        }
        group.taskIds.push(taskId);
      } else {
        ungrouped.push(taskId);
      }
    }

    groups = Array.from(groupMap.values());

    // Build the adjusted flat ID list with placeholder entries for group headers.
    // We use a special sentinel ID prefix for group header "rows".
    adjustedFlatIds = [];
    groupHeaderRows = new Map();

    // Ungrouped tasks first (no header)
    for (const id of ungrouped) {
      adjustedFlatIds.push(id);
    }

    // Then each group: header row + task rows (if not collapsed)
    for (const group of groups) {
      const headerRowIdx = adjustedFlatIds.length;
      const sentinelId = `__group_header__${group.groupId}`;
      adjustedFlatIds.push(sentinelId);
      groupHeaderRows.set(headerRowIdx, group);

      if (!group.collapsed) {
        for (const taskId of group.taskIds) {
          adjustedFlatIds.push(taskId);
        }
      }
    }
  }

  function toggleGroup(groupId: string): void {
    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
    } else {
      collapsedGroups.add(groupId);
    }

    // Force a re-render by dispatching a no-op scroll action.
    // The middleware will rebuild the flatVisibleIds on the next pass.
    if (host) {
      const state = host.getState();
      host.dispatch({ type: 'SET_SCROLL', x: state.scrollX, y: state.scrollY });
    }
  }

  return {
    name: 'GroupingPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Set up click detection for group headers after DOM is ready.
      unsubRender = gantt.on('render', () => {
        if (containerEl) return;

        const rootEl = document.querySelector('.nimbus-gantt');
        if (!rootEl) return;

        containerEl = rootEl.parentElement ?? (rootEl as HTMLElement);

        clickHandler = (e: MouseEvent) => {
          if (!host) return;
          const state = host.getState();
          const timelinePanel = rootEl.querySelector('.ng-timeline-panel');
          if (!timelinePanel) return;

          const rect = timelinePanel.getBoundingClientRect();
          const clickY = e.clientY - rect.top;
          const headerHeight = state.config.headerHeight;

          // Only handle clicks in the body area
          if (clickY < headerHeight) return;

          const bodyY = clickY - headerHeight + state.scrollY;
          const rowIndex = Math.floor(bodyY / state.config.rowHeight);

          // Check if this row is a group header
          const group = groupHeaderRows.get(rowIndex);
          if (group) {
            e.preventDefault();
            e.stopPropagation();
            toggleGroup(group.groupId);
          }
        };

        containerEl.addEventListener('click', clickHandler);
      });
    },

    middleware(action: Action, next: (action: Action) => void): void {
      // Let the action apply first
      next(action);

      // After the action is applied, rebuild groups and adjust flatVisibleIds.
      // We do this by intercepting any action that could change the visible task list.
      if (!host) return;

      const state = host.getState();

      // Check if any tasks have groupId — if not, nothing to do
      let hasGroups = false;
      for (const task of state.tasks.values()) {
        if (task.groupId) {
          hasGroups = true;
          break;
        }
      }

      if (!hasGroups) {
        groups = [];
        groupHeaderRows = new Map();
        adjustedFlatIds = [...state.flatVisibleIds];
        return;
      }

      buildGroups(state);

      // Now we need to filter the real flatVisibleIds to exclude tasks in
      // collapsed groups. We can't dispatch SET_DATA (that would loop), so
      // we modify flatVisibleIds by dispatching specific actions that rebuild
      // the tree. Instead, we'll filter at the middleware level by removing
      // tasks belonging to collapsed groups from the state's flatVisibleIds.
      //
      // The cleanest approach: after the action completes, check if any groups
      // are collapsed and remove those task IDs from flatVisibleIds.
      if (collapsedGroups.size > 0) {
        const collapsedTaskIds = new Set<string>();
        for (const group of groups) {
          if (group.collapsed) {
            for (const taskId of group.taskIds) {
              collapsedTaskIds.add(taskId);
            }
          }
        }

        // Filter the state's flatVisibleIds in-place is not ideal since
        // GanttState is treated as immutable. We work around this by noting
        // that the middleware runs before subscribers are notified, so
        // mutating the array reference on the state object is safe here
        // because the store will have already applied the action.
        if (collapsedTaskIds.size > 0) {
          const filtered = state.flatVisibleIds.filter(
            (id) => !collapsedTaskIds.has(id),
          );
          // Only mutate if there's actually a difference
          if (filtered.length !== state.flatVisibleIds.length) {
            // Replace the array contents. Since GanttState is a plain object
            // and the store exposes it directly, this works.
            state.flatVisibleIds.length = 0;
            for (const id of filtered) {
              state.flatVisibleIds.push(id);
            }
          }
        }
      }
    },

    renderCanvas(
      ctx: CanvasRenderingContext2D,
      state: GanttState,
      layouts: TaskLayout[],
    ): void {
      if (!host || groups.length === 0) return;

      const { config, scrollX, scrollY } = state;
      const { theme } = config;
      const headerHeight = config.headerHeight;
      const rowHeight = config.rowHeight;
      const canvasWidth = ctx.canvas.width / (window.devicePixelRatio || 1);
      const bodyHeight = ctx.canvas.height / (window.devicePixelRatio || 1) - headerHeight;

      ctx.save();

      // Clip to body area
      ctx.beginPath();
      ctx.rect(0, headerHeight, canvasWidth, bodyHeight);
      ctx.clip();

      // We need to figure out where the group headers would appear in the
      // visible row list. Since the middleware has already filtered collapsed
      // tasks from flatVisibleIds, we need to compute the visual row positions
      // for group headers.
      //
      // Strategy: walk through our adjustedFlatIds and map header sentinel IDs
      // to their visual row index. But since we mutated state.flatVisibleIds
      // to remove collapsed tasks, we need to recompute positions based on the
      // combined list of real tasks + header sentinels.

      // Rebuild the display order: ungrouped tasks, then for each group:
      // group header + (if expanded) group tasks.
      let rowIndex = 0;
      const ungrouped: string[] = [];
      for (const taskId of state.flatVisibleIds) {
        const task = state.tasks.get(taskId);
        if (task && !task.groupId) {
          ungrouped.push(taskId);
        }
      }
      rowIndex = ungrouped.length;

      for (const group of groups) {
        // Draw group header at this row index
        const y = headerHeight + rowIndex * rowHeight - scrollY;

        // Only draw if visible
        if (y + rowHeight >= headerHeight && y < headerHeight + bodyHeight) {
          // ── Header background ─────────────────────────────────────
          ctx.fillStyle = GROUP_HEADER_BG;
          ctx.fillRect(0, y, canvasWidth, rowHeight);

          // Bottom border
          ctx.beginPath();
          ctx.strokeStyle = GROUP_HEADER_BORDER;
          ctx.lineWidth = 1;
          ctx.moveTo(0, Math.round(y + rowHeight) + 0.5);
          ctx.lineTo(canvasWidth, Math.round(y + rowHeight) + 0.5);
          ctx.stroke();

          // ── Chevron (expand/collapse indicator) ───────────────────
          const chevronX = CHEVRON_LEFT_MARGIN;
          const chevronY = y + rowHeight / 2;

          ctx.save();
          ctx.beginPath();
          ctx.fillStyle = GROUP_TEXT_COLOR;

          if (group.collapsed) {
            // Right-pointing chevron (collapsed)
            ctx.moveTo(chevronX, chevronY - CHEVRON_SIZE);
            ctx.lineTo(chevronX + CHEVRON_SIZE, chevronY);
            ctx.lineTo(chevronX, chevronY + CHEVRON_SIZE);
          } else {
            // Down-pointing chevron (expanded)
            ctx.moveTo(chevronX - CHEVRON_SIZE / 2, chevronY - CHEVRON_SIZE / 2);
            ctx.lineTo(chevronX + CHEVRON_SIZE / 2, chevronY - CHEVRON_SIZE / 2);
            ctx.lineTo(chevronX, chevronY + CHEVRON_SIZE / 2);
          }

          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // ── Group name text ───────────────────────────────────────
          ctx.save();
          ctx.font = `600 ${theme.fontSize}px ${theme.fontFamily}`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = GROUP_TEXT_COLOR;

          const nameX = TEXT_LEFT_MARGIN;
          const nameY = y + rowHeight / 2;
          ctx.fillText(group.groupName, nameX, nameY);

          // Measure name width for badge placement
          const nameWidth = ctx.measureText(group.groupName).width;
          ctx.restore();

          // ── Task count badge ──────────────────────────────────────
          const badgeText = `${group.taskIds.length}`;
          ctx.save();
          ctx.font = `${theme.fontSize - 1}px ${theme.fontFamily}`;
          const badgeTextWidth = ctx.measureText(badgeText).width;
          const badgeW = badgeTextWidth + BADGE_PADDING_X * 2;
          const badgeH = theme.fontSize + BADGE_PADDING_Y * 2;
          const badgeX = nameX + nameWidth + BADGE_LEFT_GAP;
          const badgeY = nameY - badgeH / 2;

          // Badge background (rounded pill)
          ctx.beginPath();
          const br = BADGE_RADIUS;
          ctx.moveTo(badgeX + br, badgeY);
          ctx.lineTo(badgeX + badgeW - br, badgeY);
          ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + br, br);
          ctx.lineTo(badgeX + badgeW, badgeY + badgeH - br);
          ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - br, badgeY + badgeH, br);
          ctx.lineTo(badgeX + br, badgeY + badgeH);
          ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - br, br);
          ctx.lineTo(badgeX, badgeY + br);
          ctx.arcTo(badgeX, badgeY, badgeX + br, badgeY, br);
          ctx.closePath();

          ctx.fillStyle = BADGE_BG;
          ctx.fill();

          // Badge text
          ctx.fillStyle = BADGE_TEXT_COLOR;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';
          ctx.fillText(badgeText, badgeX + badgeW / 2, nameY);
          ctx.restore();
        }

        rowIndex += 1; // account for the header row itself

        // Skip over the visible tasks in this group
        if (!group.collapsed) {
          rowIndex += group.taskIds.length;
        }
      }

      ctx.restore();
    },

    destroy(): void {
      if (clickHandler && containerEl) {
        containerEl.removeEventListener('click', clickHandler);
      }
      if (unsubRender) {
        unsubRender();
      }
      host = null;
      containerEl = null;
      clickHandler = null;
      collapsedGroups.clear();
      groups = [];
      groupHeaderRows = new Map();
      adjustedFlatIds = [];
    },
  };
}
