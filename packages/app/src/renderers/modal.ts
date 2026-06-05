/**
 * modal.ts — the NG-owned modal primitive.
 *
 * Per docs/ng-ui-conventions.md: in-app surfaces are rendered by NG with a
 * self-injected, scoped stylesheet (`.ngm-*`) so they look pixel-identical on
 * cloudnimbusllc.com (web), Delivery Hub (Salesforce/LWS), and the demo —
 * with zero dependency on the host's compiled styles.css. Same mechanism as
 * TooltipManager / ContextMenuPlugin / the Pacing view.
 *
 * Usage:
 *   const m = openModal({ title: 'Auto-Schedule', width: 460 });
 *   m.body.appendChild(...);                 // fill the content
 *   m.setFooter([{ label: 'Cancel', onClick: () => m.close() },
 *                { label: 'Run', primary: true, onClick: run }]);
 *   // m.close() also fires opts.onClose once.
 */

const STYLE_ID = 'nga-modal-styles';

// Very high so it clears the gantt canvas + Salesforce Lightning chrome.
const Z = 2147483600;

const MODAL_CSS = `
.ngm-overlay{position:fixed;inset:0;z-index:${Z};display:flex;align-items:center;
  justify-content:center;background:rgba(15,23,42,.45);backdrop-filter:blur(1px);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
.ngm-panel{background:#fff;color:#0f172a;border-radius:14px;width:460px;
  max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);display:flex;
  flex-direction:column;box-shadow:0 20px 60px rgba(2,6,23,.45);overflow:hidden;
  animation:ngm-in .12s ease-out;}
@keyframes ngm-in{from{transform:translateY(6px) scale(.98);opacity:0}to{transform:none;opacity:1}}
.ngm-head{display:flex;align-items:center;gap:12px;padding:14px 16px;
  border-bottom:1px solid #e2e8f0;}
.ngm-title{font-size:15px;font-weight:800;letter-spacing:-.01em;flex:1;}
.ngm-x{appearance:none;border:0;background:transparent;cursor:pointer;
  font-size:18px;line-height:1;color:#64748b;padding:4px;border-radius:6px;}
.ngm-x:hover{background:#f1f5f9;color:#0f172a;}
.ngm-body{padding:16px;overflow:auto;font-size:13px;line-height:1.5;color:#334155;}
.ngm-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;
  border-top:1px solid #e2e8f0;background:#f8fafc;}
.ngm-btn{appearance:none;cursor:pointer;font-size:13px;font-weight:700;
  padding:8px 14px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;
  color:#334155;}
.ngm-btn:hover{background:#f1f5f9;}
.ngm-btn-primary{border-color:#4f46e5;background:#4f46e5;color:#fff;}
.ngm-btn-primary:hover{background:#4338ca;}
.ngm-btn:disabled{opacity:.5;cursor:not-allowed;}
.ngm-row{display:flex;align-items:center;gap:10px;padding:6px 0;}
.ngm-row label{font-weight:600;color:#0f172a;}
.ngm-num{width:84px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font-size:13px;}
.ngm-sel{border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff;}
.ngm-note{font-size:12px;color:#64748b;margin-top:10px;}
.ngm-stat{display:flex;gap:18px;flex-wrap:wrap;margin:4px 0 8px;}
.ngm-stat div{font-size:12px;color:#64748b;}
.ngm-stat b{display:block;font-size:18px;color:#0f172a;font-weight:800;}
.ngm-tbl{width:100%;border-collapse:collapse;font-size:13px;}
.ngm-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;
  color:#64748b;font-weight:800;padding:4px 6px;border-bottom:1px solid #e2e8f0;}
.ngm-tbl td{padding:4px 6px;border-bottom:1px solid #f1f5f9;}
.ngm-warn{color:#b91c1c;font-weight:700;}
`;

function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = MODAL_CSS;
  document.head.appendChild(s);
}

export interface FooterButton {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface ModalOptions {
  title: string;
  width?: number;
  onClose?: () => void;
}

export interface ModalHandle {
  /** Content container — append your fields/markup here. */
  body: HTMLElement;
  /** Replace the footer button row. */
  setFooter: (buttons: FooterButton[]) => void;
  /** Close the modal (fires onClose once) and clean up listeners. */
  close: () => void;
  /** The panel element, if you need to size/scroll it directly. */
  panel: HTMLElement;
}

export function openModal(opts: ModalOptions): ModalHandle {
  injectStyles();

  const overlay = document.createElement('div');
  overlay.className = 'ngm-overlay';
  const panel = document.createElement('div');
  panel.className = 'ngm-panel';
  if (opts.width) panel.style.width = opts.width + 'px';
  overlay.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'ngm-head';
  const title = document.createElement('div');
  title.className = 'ngm-title';
  title.textContent = opts.title;
  const x = document.createElement('button');
  x.className = 'ngm-x';
  x.setAttribute('aria-label', 'Close');
  x.textContent = '✕';
  head.appendChild(title);
  head.appendChild(x);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'ngm-body';
  panel.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'ngm-foot';
  panel.appendChild(foot);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    opts.onClose?.();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  x.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);

  function setFooter(buttons: FooterButton[]): void {
    foot.textContent = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'ngm-btn' + (b.primary ? ' ngm-btn-primary' : '');
      btn.textContent = b.label;
      if (b.disabled) btn.disabled = true;
      btn.addEventListener('click', b.onClick);
      foot.appendChild(btn);
    }
  }

  document.body.appendChild(overlay);
  return { body, setFooter, close, panel };
}
