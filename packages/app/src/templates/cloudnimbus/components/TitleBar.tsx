/**
 * TitleBar.tsx — v10 title bar per v10-component-spec.md §1.
 * Brand + version pill + view-mode pills + sidebar/stats/audit toggles +
 * zoom pills + group-by toggle + summary.
 */
import { useEffect, useState } from 'react';
import type { SlotProps, ViewMode, ZoomLevel, GroupBy } from '../../types';
import { CLOUD_NIMBUS_VIEW_MODES } from '../defaults';
import {
  CLS_TITLEBAR, CLS_TITLEBAR_ROW, CLS_TITLE_BRAND, CLS_VERSION_PILL, CLS_SEP,
  CLS_TB_FILL, CLS_TB_SUMMARY,
  CLS_PILL_BTN_BASE,
  CLS_PILL_BTN_ACTIVE_VIOLET, CLS_PILL_BTN_IDLE_VIOLET,
  CLS_PILL_BTN_ACTIVE_BLUE, CLS_PILL_BTN_IDLE_BLUE,
  CLS_PILL_BTN_ACTIVE_SLATE, CLS_PILL_BTN_IDLE_SLATE,
} from './shared/classes';

const ZOOMS: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];
const GROUPS: GroupBy[] = ['priority', 'epic'];

function Sep() {
  return <span className={CLS_SEP}>|</span>;
}

/**
 * 0.185.10 — Fullscreen API button (React). Mirrors the vanilla TitleBar's
 * default fullscreen path. Uses browser Fullscreen API on the template root
 * element; subscribes to fullscreenchange so the label flips on Esc exit.
 *
 * 0.185.13 — LWS guard: every document.fullscreenElement read is wrapped
 * in try/catch. Salesforce Lightning Web Security blocks that property
 * on VF / Lightning Out surfaces ("Cannot access fullscreenElement"),
 * and the throw killed the whole TitleBar render on 0.185.10. Guarded
 * reads return null/false and the button degrades to a no-op (the useFs
 * probe returns null so the FallbackButton below is used instead).
 */
function readFullscreenElementSafe(): Element | null {
  if (typeof document === 'undefined') return null;
  try {
    const doc = document as Document & { webkitFullscreenElement?: Element; msFullscreenElement?: Element };
    return doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement || null;
  } catch (_e) {
    return null;
  }
}

function isFullscreenApiSupported(): boolean {
  if (typeof document === 'undefined') return false;
  // Probe: if reading fullscreenElement throws, LWS is blocking the whole
  // API surface; return false so the button falls back to local toggle.
  try { void (document as Document & { webkitFullscreenElement?: Element }).fullscreenElement; }
  catch (_e) { return false; }
  const anyEl = document.documentElement as unknown as { requestFullscreen?: unknown; webkitRequestFullscreen?: unknown };
  return !!(anyEl.requestFullscreen || anyEl.webkitRequestFullscreen);
}

function FullscreenApiButton() {
  const [isFs, setIsFs] = useState<boolean>(() => !!readFullscreenElementSafe());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setIsFs(!!readFullscreenElementSafe());
    try {
      document.addEventListener('fullscreenchange', onChange);
      document.addEventListener('webkitfullscreenchange', onChange);
      document.addEventListener('msfullscreenchange', onChange);
    } catch (_e) { /* LWS may block */ }
    return () => {
      try {
        document.removeEventListener('fullscreenchange', onChange);
        document.removeEventListener('webkitfullscreenchange', onChange);
        document.removeEventListener('msfullscreenchange', onChange);
      } catch (_e) { /* ok */ }
    };
  }, []);

  const onClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void>;
        msExitFullscreen?: () => Promise<void>;
      };
      const active = !!readFullscreenElementSafe();
      if (active) {
        if (doc.exitFullscreen)         await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        else if (doc.msExitFullscreen)     await doc.msExitFullscreen();
      } else {
        const btn = e.currentTarget;
        const target = (btn.closest('[data-nga-template-root]') as HTMLElement | null)
          || document.documentElement;
        const anyEl = target as unknown as {
          requestFullscreen?: () => Promise<void>;
          webkitRequestFullscreen?: () => Promise<void>;
          msRequestFullscreen?: () => Promise<void>;
        };
        if (anyEl.requestFullscreen)         await anyEl.requestFullscreen();
        else if (anyEl.webkitRequestFullscreen) await anyEl.webkitRequestFullscreen();
        else if (anyEl.msRequestFullscreen)     await anyEl.msRequestFullscreen();
      }
    } catch (err) {
      try { console.error('[NG fs-btn] Fullscreen API threw', err); } catch (_e) { /* ok */ }
    }
  };

  return (
    <button
      type="button"
      data-nga-fullscreen-api="1"
      className={CLS_PILL_BTN_BASE + ' bg-slate-700 text-white border-slate-700'}
      onClick={onClick}
    >
      {isFs ? '← Exit Full Screen' : 'Full Screen'}
    </button>
  );
}

const HOURS_PER_MONTH = 170; // 80 Glen + 50 Mahi + 40 Antima

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function TitleBar({ config, state, dispatch, data }: SlotProps) {
  const s = data.stats;
  const estLow  = s.estLow || 0;
  const estHigh = s.est    || 0;
  const hrsStr  = estLow < estHigh
    ? estLow + '-' + estHigh + 'h'
    : estHigh + 'h';
  const moLow  = estLow  > 0 ? fmt1(estLow  / HOURS_PER_MONTH) : null;
  const moHigh = estHigh > 0 ? fmt1(estHigh / HOURS_PER_MONTH) : null;
  const moStr  = moLow && moHigh && moLow !== moHigh
    ? moLow + '-' + moHigh + ' mo'
    : moHigh ? moHigh + ' mo' : null;
  const summary = s.scheduled + ' scheduled · ' + hrsStr + (moStr ? ' · ' + moStr : '');

  // Only render view pills for views enabled in the template config (config.views).
  // When only 1 view is available (default: gantt-only), hide the entire section
  // to avoid showing a button that does nothing.
  const enabledViews = CLOUD_NIMBUS_VIEW_MODES.filter(
    (v) => !config.views || config.views.includes(v.id),
  );

  return (
    <div className={CLS_TITLEBAR} data-slot="TitleBar">
      {/* Row 1 — view pills, shown only when the template enables >1 view.
          Collapses entirely when hidden, so single-view configs (A1
          reverted / minimal template) look identical to v12 prod. */}
      {enabledViews.length > 1 && (
        <div className={CLS_TITLEBAR_ROW} data-nga-titlebar-row="views">
          {enabledViews.map((v) => {
            const on = state.viewMode === v.id;
            return (
              <button
                key={v.id}
                type="button"
                className={
                  CLS_PILL_BTN_BASE + ' ' +
                  (on ? CLS_PILL_BTN_ACTIVE_VIOLET : CLS_PILL_BTN_IDLE_VIOLET)
                }
                onClick={() => dispatch({ type: 'SET_VIEW', mode: v.id as ViewMode })}
              >
                <span className="mr-1">{v.icon}</span>{v.label}
              </button>
            );
          })}
        </div>
      )}
      {/* Row 2 — everything else (brand + version + toggles + zoom +
          group + summary + right-side controls). */}
      <div className={CLS_TITLEBAR_ROW} data-nga-titlebar-row="main">
      <span className={CLS_TITLE_BRAND}>{config.title || 'Pro Forma Timeline'}</span>
      <span className={CLS_VERSION_PILL}>{config.version || 'v10 · Nimbus Gantt'}</span>
      <Sep />
      <button
        type="button"
        className={
          CLS_PILL_BTN_BASE + ' ' +
          (state.sidebarOpen ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE)
        }
        onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
      >
        Sidebar
      </button>
      <button
        type="button"
        className={
          CLS_PILL_BTN_BASE + ' ' +
          (state.statsOpen ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE)
        }
        onClick={() => dispatch({ type: 'TOGGLE_STATS' })}
      >
        Stats
      </button>
      {config.features.auditPanel && (
        <button
          type="button"
          className={
            CLS_PILL_BTN_BASE + ' ' +
            (state.auditPanelOpen ? CLS_PILL_BTN_ACTIVE_BLUE : CLS_PILL_BTN_IDLE_BLUE)
          }
          onClick={() => dispatch({ type: 'TOGGLE_AUDIT_PANEL' })}
        >
          Audit
        </button>
      )}
      <Sep />
      {ZOOMS.map((z) => {
        const on = state.zoom === z;
        return (
          <button
            key={z}
            type="button"
            className={
              CLS_PILL_BTN_BASE + ' ' +
              (on ? CLS_PILL_BTN_ACTIVE_SLATE : CLS_PILL_BTN_IDLE_SLATE)
            }
            onClick={() => dispatch({ type: 'SET_ZOOM', zoom: z })}
          >
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        );
      })}
      {config.features.groupByToggle && (
        <>
          <Sep />
          <span className="text-[10px] text-slate-400 font-medium tracking-wide mr-0.5">Group:</span>
          {GROUPS.map((g) => {
            const on = state.groupBy === g;
            return (
              <button
                key={g}
                type="button"
                className={
                  CLS_PILL_BTN_BASE + ' ' +
                  (on ? CLS_PILL_BTN_ACTIVE_SLATE : CLS_PILL_BTN_IDLE_SLATE)
                }
                onClick={() => dispatch({ type: 'SET_GROUP_BY', groupBy: g })}
              >
                {g === 'priority' ? 'Priority' : 'Epics'}
              </button>
            );
          })}
        </>
      )}
      <div className={CLS_TB_FILL} />
      <span className={CLS_TB_SUMMARY}>{summary}</span>
      {config.apiDocsUrl ? (
        <a
          href={config.apiDocsUrl}
          title="API docs — how to automate submits"
          className="text-[10px] text-slate-500 hover:text-fuchsia-600 underline decoration-dotted shrink-0"
          data-nga-api-docs="1"
        >
          API docs
        </a>
      ) : null}
      {(() => {
        // 0.185.10 — Precedence:
        //   1. fullscreenUrl (legacy URL-nav, hide if already on target)
        //   2. onExitFullscreen (legacy host-exit for VF-wrapped surfaces)
        //   3. Fullscreen API (default) — real fullscreen on the template
        //      root, no navigation, Esc exits, state tracked via
        //      fullscreenchange listener.
        const fsUrl = config.fullscreenUrl;
        const onCurrentFsUrl = !!(fsUrl && typeof location !== 'undefined' && location.pathname === fsUrl);
        if (onCurrentFsUrl) return null;
        if (fsUrl) {
          return (
            <button
              type="button"
              data-nga-fullscreen-url="1"
              className={CLS_PILL_BTN_BASE + ' bg-slate-700 text-white border-slate-700'}
              onClick={() => { window.location.href = fsUrl; }}
            >
              Full Screen
            </button>
          );
        }
        if (config.mode === 'fullscreen' && typeof config.onExitFullscreen === 'function') {
          return (
            <button
              type="button"
              data-nga-fullscreen-exit="1"
              className={CLS_PILL_BTN_BASE + ' bg-slate-700 text-white border-slate-700'}
              onClick={() => config.onExitFullscreen!()}
            >
              ← Exit Full Screen
            </button>
          );
        }
        // Fullscreen API path — default for SF embedded surface and any
        // consumer not opting into URL-nav or host-exit.
        return (
          <FullscreenApiButton />
        );
      })()}
      </div>
      {/* 0.185.5 — Status color legend. Mirror of the vanilla TitleBar
          legend so users can decode bar colors in both React and IIFE
          mount paths. */}
      <div
        className="flex items-center gap-3 px-3 py-1 text-[10px] text-slate-500 border-t border-slate-100"
        data-slot-part="status-legend"
      >
        <span className="text-[9px] text-slate-400 uppercase tracking-wide">Status</span>
        {[
          { label: 'In Flight', color: '#10b981' },
          { label: 'Next Up',   color: '#3b82f6' },
          { label: 'Backlog',   color: '#f59e0b' },
          { label: 'Blocked',   color: '#ef4444' },
          { label: 'Paused',    color: '#94a3b8' },
          { label: 'Done',      color: '#cbd5e1' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: item.color }}
            />
            <span>{item.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
