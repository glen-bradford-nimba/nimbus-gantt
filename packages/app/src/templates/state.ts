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
  auditPanelOpen: true, // v9 parity — Audit strip defaults to open
  fullscreen: false,
  selectedTaskId: null,
  pendingPatchCount: 0,
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
    case 'TOGGLE_DETAIL':
      return {
        ...state,
        detailOpen: event.taskId !== undefined ? true : !state.detailOpen,
        selectedTaskId: event.taskId !== undefined ? event.taskId : state.selectedTaskId,
      };
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
    default:
      return state;
  }
}
