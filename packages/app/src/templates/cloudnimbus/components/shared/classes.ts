/**
 * shared/classes.ts — CSS class constants shared by React + vanilla slots.
 * These are the SINGLE source of truth for class names so both renderers
 * produce identical HTML.
 */

/* ── Root ───────────────────────────────────────────────────────────────── */
export const CLS_ROOT = 'nga-root flex flex-col h-full w-full bg-slate-50 overflow-hidden';

/* ── TitleBar ───────────────────────────────────────────────────────────── */
// Outer titlebar is a COLUMN flex — allows the view-pill row (when
// enabledViews.length > 1) to stack above the main controls row. When
// view pills are hidden (A1 reverted / single-view configurations), the
// column collapses visually to one row, matching v12 prod exactly.
export const CLS_TITLEBAR =
  'nga-titlebar bg-white border-b border-slate-200 px-3 py-1.5 flex flex-col gap-1.5 min-w-0 overflow-x-hidden';
// Each row inside the titlebar shares this class.
export const CLS_TITLEBAR_ROW =
  'flex items-center gap-2 flex-wrap min-w-0';
export const CLS_TITLE_BRAND = 'text-sm font-bold text-slate-900';
export const CLS_VERSION_PILL =
  'text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5';
export const CLS_SEP = 'text-slate-200';
export const CLS_TB_FILL = 'flex-1';
export const CLS_TB_SUMMARY = 'text-[10px] text-slate-500 font-mono';
export const CLS_PILL_BTN_BASE =
  'text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors cursor-pointer';
export const CLS_PILL_BTN_ACTIVE_VIOLET = 'bg-violet-600 text-white border-violet-600';
export const CLS_PILL_BTN_IDLE_VIOLET =
  'bg-white text-slate-500 border-slate-200 hover:border-violet-300';
export const CLS_PILL_BTN_ACTIVE_BLUE = 'bg-blue-600 text-white border-blue-600';
export const CLS_PILL_BTN_IDLE_BLUE =
  'bg-white text-slate-600 border-slate-200 hover:border-blue-300';
export const CLS_PILL_BTN_ACTIVE_SLATE = 'bg-slate-800 text-white border-slate-800';
export const CLS_PILL_BTN_IDLE_SLATE =
  'bg-white text-slate-500 border-slate-200 hover:border-slate-400';

/* ── FilterBar ──────────────────────────────────────────────────────────── */
export const CLS_FILTERBAR =
  'nga-filterbar bg-white border-b border-slate-100 px-3 py-1.5 min-w-0 overflow-x-hidden';
export const CLS_FILTERBAR_INNER = 'flex items-center gap-2 flex-wrap min-w-0';
export const CLS_FILTERBAR_LABEL =
  'text-[10px] font-bold text-slate-500 uppercase tracking-wide';
export const CLS_FILTER_BTN_BASE =
  'text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors';
export const CLS_SEARCH_WRAP = 'relative inline-flex items-center';
export const CLS_SEARCH_ICON =
  'absolute left-2 text-[10px] text-slate-400 pointer-events-none';
export const CLS_SEARCH_INPUT =
  'text-[10px] pl-6 pr-6 py-1 rounded-full border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none w-48';
export const CLS_SEARCH_CLEAR =
  'absolute right-2 text-[12px] text-slate-400 hover:text-slate-700';
export const CLS_LEGEND_CHIP = 'inline-flex items-center gap-1';
export const CLS_LEGEND_SWATCH = 'w-3 h-3 rounded';
export const CLS_LEGEND_TEXT = 'text-[9px] text-slate-600';
export const CLS_TEAM_PILL =
  'inline-flex items-center gap-1 text-[9px] font-semibold text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded px-2 py-0.5 transition-colors';
export const CLS_CAPACITY_TEXT = 'text-[9px] text-slate-400 font-mono';
export const CLS_AUTO_SCHED_BTN =
  'text-[9px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-2.5 py-1 rounded-full transition-colors';
export const CLS_COUNT_LABEL = 'text-[10px] text-slate-400';
export const CLS_RESET_LINK = 'text-[9px] text-rose-500 hover:text-rose-700 underline';

/* ── ZoomBar ────────────────────────────────────────────────────────────── */
export const CLS_ZOOMBAR = 'nga-zoombar flex items-center gap-2';

/* ── StatsPanel ─────────────────────────────────────────────────────────── */
export const CLS_STATS_PANEL =
  'nga-stats bg-white border-b border-slate-100 px-3 py-3';
export const CLS_STATS_GRID =
  'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2';
export const CLS_KPI_CARD_BASE =
  'bg-white rounded-xl border-2 px-3 py-2 shadow-sm';
export const CLS_KPI_LABEL =
  'text-[10px] font-bold uppercase tracking-wide opacity-70';
export const CLS_KPI_VALUE = 'text-xl font-bold font-mono mt-0.5';
export const CLS_KPI_HINT = 'text-[9px] text-slate-400 mt-0.5';

/* ── Sidebar (Priority Drag Sidebar) ────────────────────────────────────── */
export const CLS_SIDEBAR =
  'nga-sidebar h-full flex flex-col bg-white border-r border-slate-200 select-none';
export const CLS_SIDEBAR_HEADER =
  'px-3 py-2 border-b border-slate-200 flex-shrink-0';
export const CLS_SIDEBAR_LABEL_BIG =
  'text-[10px] font-bold text-slate-500 uppercase tracking-wide';
export const CLS_SIDEBAR_LABEL_SM = 'text-[9px] text-slate-400 mt-0.5';
export const CLS_SIDEBAR_RESET =
  'text-[9px] font-bold text-rose-500 hover:text-rose-700 uppercase px-2 py-1 rounded hover:bg-rose-50 transition-colors';
export const CLS_CAPACITY_INPUT =
  'w-14 text-[10px] font-mono bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-center';
export const CLS_SIDEBAR_AUTO_BTN =
  'w-full text-[10px] font-bold uppercase px-2 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors';
export const CLS_SIDEBAR_SCROLL = 'flex-1 overflow-y-auto';
export const CLS_BUCKET_HEADER =
  'px-3 py-1.5 flex items-center justify-between';
export const CLS_BUCKET_LABEL =
  'text-[9px] font-bold uppercase tracking-wider';
export const CLS_BUCKET_COUNT = 'text-[9px] text-slate-400 font-mono';
export const CLS_ITEM_ROW =
  'px-3 py-1.5 flex items-center gap-2 border-b border-slate-50 hover:bg-slate-50 transition-colors';
export const CLS_DRAG_HANDLE =
  'text-[11px] text-slate-300 flex-shrink-0 leading-none cursor-grab active:cursor-grabbing hover:text-slate-500 transition-colors px-0.5 py-1';
export const CLS_CAT_DOT = 'w-2 h-2 rounded-full flex-shrink-0';
export const CLS_ITEM_TITLE = 'text-[10px] text-slate-700 truncate flex-1 min-w-0';
export const CLS_ITEM_HOURS = 'text-[9px] text-slate-400 font-mono flex-shrink-0';
export const CLS_SIDEBAR_HEADER_ROW = 'flex items-center justify-between';
export const CLS_SIDEBAR_CTRLS = 'mt-2 space-y-1.5';
export const CLS_SIDEBAR_CAP_ROW = 'flex items-center gap-2';
export const CLS_SIDEBAR_CAP_LBL = 'text-[9px] text-slate-500';
export const CLS_SIDEBAR_CAP_SUF = 'text-[9px] text-slate-400';
export const CLS_SIDEBAR_RESULT =
  'text-[9px] text-slate-600 bg-blue-50 rounded px-2 py-1.5 border border-blue-200';
export const CLS_SIDEBAR_RESULT_TITLE = 'font-bold text-blue-800';
export const CLS_SIDEBAR_RESULT_SUB = 'text-blue-600 mt-0.5';
export const CLS_BUCKET_SECTION_BASE = 'border-b transition-colors';
export const CLS_BUCKET_EMPTY_TEXT = 'px-3 py-3 text-[10px] text-slate-400 italic';
export const CLS_BUCKET_EMPTY_INDICATOR_BASE = 'mx-2 my-1 h-0.5 rounded transition-all';
export const CLS_BUCKET_EMPTY_INDICATOR_ON = 'bg-blue-400 opacity-100';
export const CLS_BUCKET_EMPTY_INDICATOR_OFF = 'bg-transparent opacity-0';
export const CLS_BUCKET_INDICATOR = 'mx-2 h-0.5 bg-blue-500 rounded pointer-events-none';

/* ── ContentArea ────────────────────────────────────────────────────────── */
export const CLS_CONTENT_OUTER =
  'nga-content-outer flex-1 flex overflow-hidden min-w-0 min-h-0';
export const CLS_SIDEBAR_WRAP =
  'flex-shrink-0 border-r border-slate-200 bg-white overflow-y-auto overflow-x-hidden';
export const CLS_RESIZER =
  'w-1 flex-shrink-0 bg-slate-200 hover:bg-blue-400 cursor-col-resize transition-colors';
export const CLS_CONTENT = 'nga-content flex-1 relative min-w-0 min-h-0';
export const CLS_GANTT_FRAME = 'absolute inset-0 flex flex-col';
export const CLS_SCROLL_WRAP =
  'flex-shrink-0 bg-slate-50 border-b border-slate-100 px-3 py-1';
export const CLS_SCROLL_SLIDER =
  'w-full h-1.5 appearance-none bg-slate-200 rounded-full cursor-pointer';
export const CLS_GANTT_INNER = 'flex-1 relative min-h-0';
export const CLS_LIST_WRAP = 'absolute inset-0 overflow-hidden';

/* ── DetailPanel ────────────────────────────────────────────────────────── */
export const CLS_DETAIL =
  'nga-detail fixed z-[9999] shadow-2xl rounded-xl border-2 overflow-hidden bg-white';
export const CLS_DETAIL_HEADER =
  'flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none';
export const CLS_DETAIL_BODY =
  'px-3 py-3 space-y-2 max-h-[400px] overflow-y-auto text-xs';
export const CLS_CATEGORY_PILL =
  'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0';

/* ── AuditPanel ─────────────────────────────────────────────────────────── */
export const CLS_AUDIT =
  'nga-audit bg-fuchsia-50/60 border-b border-fuchsia-200 px-3 py-2';
export const CLS_AUDIT_LABEL =
  'text-[10px] font-bold text-fuchsia-700 uppercase tracking-wide shrink-0';
export const CLS_AUDIT_STATUS_DIRTY =
  'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800';
export const CLS_AUDIT_STATUS_CLEAN =
  'text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
export const CLS_AUDIT_INPUT =
  'flex-1 min-w-[200px] text-[11px] px-2 py-1 border border-slate-300 rounded focus:outline-none focus:border-fuchsia-500';
export const CLS_AUDIT_SUBMIT =
  'text-[11px] font-bold px-3 py-1 rounded bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50 disabled:cursor-not-allowed';
export const CLS_AUDIT_RESET =
  'text-[11px] font-bold px-3 py-1 rounded bg-white text-slate-700 border border-slate-300 hover:border-rose-400 hover:text-rose-600';

/* ── HrsWkStrip ─────────────────────────────────────────────────────────── */
export const CLS_HRSWK =
  'nga-hrswkstrip bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex items-end gap-1 overflow-x-auto flex-shrink-0';
export const CLS_HRSWK_LABEL =
  'text-[9px] font-bold text-slate-400 uppercase tracking-wide mr-1 shrink-0 self-center';
export const CLS_HRSWK_COL = 'flex flex-col items-center gap-0.5 shrink-0 w-12';
/** Legacy thin (h-2) track — retained for backward compat with the React slot. */
export const CLS_HRSWK_TRACK =
  'w-full rounded-sm overflow-hidden bg-slate-200 h-2';

/* ── Bucket meta for sidebar (GROUP_META from spec) ─────────────────────── */
export const BUCKET_META: Record<string, { label: string; text: string; bg: string; border: string; activeBg: string }> = {
  'top-priority': { label: 'Now',      text: 'text-red-700',     bg: 'bg-red-50',        border: 'border-red-200',     activeBg: 'bg-red-100' },
  'active':       { label: 'Next',     text: 'text-amber-700',   bg: 'bg-amber-50',      border: 'border-amber-200',   activeBg: 'bg-amber-100' },
  'follow-on':    { label: 'Planned',  text: 'text-emerald-700', bg: 'bg-emerald-50',    border: 'border-emerald-200', activeBg: 'bg-emerald-100' },
  'proposed':     { label: 'Proposed', text: 'text-blue-700',    bg: 'bg-blue-50',       border: 'border-blue-200',    activeBg: 'bg-blue-100' },
  'deferred':     { label: 'Hold',     text: 'text-slate-400',   bg: 'bg-slate-50',      border: 'border-slate-200',   activeBg: 'bg-slate-100' },
};

/* ── CATEGORY_DOT — sidebar per-item colour ─────────────────────────────── */
export const CATEGORY_DOT: Record<string, string> = {
  'in-flight': '#10b981',
  'next-up':   '#3b82f6',
  'paused':    '#94a3b8',
  'backlog':   '#f59e0b',
  'expansion': '#a78bfa',
  'done':      '#cbd5e1',
};

export const STATS_TONE: Record<string, { border: string; label: string; value: string }> = {
  slate:   { border: 'border-slate-200',   label: 'text-slate-500',   value: 'text-slate-800' },
  emerald: { border: 'border-emerald-200', label: 'text-emerald-700', value: 'text-emerald-800' },
  blue:    { border: 'border-blue-200',    label: 'text-blue-700',    value: 'text-blue-800' },
  purple:  { border: 'border-purple-200',  label: 'text-purple-700',  value: 'text-purple-800' },
  amber:   { border: 'border-amber-200',   label: 'text-amber-700',   value: 'text-amber-800' },
  indigo:  { border: 'border-indigo-200',  label: 'text-indigo-700',  value: 'text-indigo-800' },
};
