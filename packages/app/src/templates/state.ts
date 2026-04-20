/**
 * templates/state.ts — AppState reducer (AppEvent → new AppState).
 */
import type { AppState, AppEvent } from './types';

export const INITIAL_STATE: AppState = {
  viewMode: 'gantt',
  filter: 'active',
  search: '',
  zoom: 'week',
  groupBy: 'priority',
  hideCompleted: true,
  sidebarOpen: false,
  statsOpen: false,
  detailOpen: false,
  detailMode: 'view',
  auditPanelOpen: true, // v9 parity — Audit strip defaults to open
  fullscreen: false,
  selectedTaskId: null,
  pendingPatchCount: 0,
  adminOpen: false,
  advisorOpen: false,
  featureOverrides: {},
  openDetailTaskIds: [],
};

export function reduceAppState(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case 'SET_VIEW':       return { ...state, viewMode: event.mode };
    case 'SET_FILTER':     return { ...state, filter: event.id };
    case 'SET_SEARCH':     return { ...state, search: event.q };
    case 'SET_ZOOM':       return { ...state, zoom: event.zoom };
    case 'SET_GROUP_BY':   return { ...state, groupBy: event.groupBy };
    case 'TOGGLE_HIDE_COMPLETED':
      return { ...state, hideCompleted: !state.hideCompleted };
    case 'TOGGLE_SIDEBAR': return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'TOGGLE_STATS':   return { ...state, statsOpen: !state.statsOpen };
    case 'TOGGLE_DETAIL': {
      const opening = event.taskId !== undefined;
      // 0.185.18 — multi-instance: opening with a taskId appends to
      // openDetailTaskIds (or moves it to the end if already open, so
      // repeat-click brings the panel to the top of the stack). Closing
      // with no taskId clears all open panels (keeps legacy "× clears
      // the detail" semantics when the host hasn't wired per-panel
      // closes). Per-panel close goes through CLOSE_DETAIL.
      if (opening) {
        const tid = event.taskId!;
        const existing = state.openDetailTaskIds.filter((id) => id !== tid);
        return {
          ...state,
          detailOpen: true,
          selectedTaskId: tid,
          detailMode: event.editMode ? 'edit' : 'view',
          openDetailTaskIds: [...existing, tid],
        };
      }
      // Legacy no-arg toggle: close all panels.
      return {
        ...state,
        detailOpen: !state.detailOpen,
        detailMode: state.detailMode,
        openDetailTaskIds: state.detailOpen ? [] : state.openDetailTaskIds,
      };
    }
    case 'CLOSE_DETAIL': {
      // 0.185.18 — remove a single panel by taskId, leave others open.
      const next = state.openDetailTaskIds.filter((id) => id !== event.taskId);
      const nextSelected = next.length > 0 ? next[next.length - 1] : null;
      return {
        ...state,
        openDetailTaskIds: next,
        detailOpen: next.length > 0,
        selectedTaskId: nextSelected,
      };
    }
    case 'SET_DETAIL_MODE':
      return { ...state, detailMode: event.mode };
    case 'TOGGLE_AUDIT_PANEL':
      return { ...state, auditPanelOpen: !state.auditPanelOpen };
    case 'TOGGLE_FULLSCREEN':
      return { ...state, fullscreen: !state.fullscreen };
    case 'SELECT_TASK':
      return { ...state, selectedTaskId: event.taskId };
    case 'PATCH':
      return { ...state, pendingPatchCount: state.pendingPatchCount + 1 };
    case 'RESET_PATCHES':
      return { ...state, pendingPatchCount: 0 };
    case 'TOGGLE_ADMIN':
      return { ...state, adminOpen: !state.adminOpen };
    case 'TOGGLE_ADVISOR':
      return { ...state, advisorOpen: !state.advisorOpen };
    case 'TOGGLE_FEATURE': {
      const current = state.featureOverrides[event.key];
      // First toggle: flip the tplConfig default (unknown → false, since we
      // don't see the default here). Subsequent toggles flip the override.
      // Consumers merge overrides ON TOP of tplConfig.features, so an
      // override of `false` masks a true default and vice versa.
      return {
        ...state,
        featureOverrides: {
          ...state.featureOverrides,
          [event.key]: current === undefined ? false : !current,
        },
      };
    }
    default:
      return state;
  }
}
