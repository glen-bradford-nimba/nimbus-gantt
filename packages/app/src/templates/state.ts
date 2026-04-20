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
      return {
        ...state,
        detailOpen: opening ? true : !state.detailOpen,
        selectedTaskId: opening ? event.taskId! : state.selectedTaskId,
        // When opening: use editMode payload (default 'view'). When closing
        // or toggling (no taskId): keep existing detailMode — v10 dblclick
        // sets editMode:true, plain click leaves it 'view'.
        detailMode: opening ? (event.editMode ? 'edit' : 'view') : state.detailMode,
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
