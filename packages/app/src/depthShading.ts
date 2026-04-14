/**
 * depthShading.ts — MutationObserver-based depth-shading engine.
 * Ported from deliverytimeline.resource (DeliveryTimeline v5).
 *
 * Colours each gantt row with a faint tint derived from its priority-group
 * bucket colour, growing lighter with each level of nesting depth.
 * Simultaneously paints a matching background-image gradient on the
 * .ng-scroll-content element so the canvas timeline area is also shaded.
 *
 * @param ganttContainer - the root element passed to NimbusGantt
 * @param depthMap       - id → depth (0 = root) from buildDepthMap()
 * @returns cleanup function to call when the gantt is destroyed
 */
export function startDepthShading(
  ganttContainer: HTMLElement,
  depthMap: Record<string, number>,
): () => void {
  const applied: Array<{ el: HTMLElement; val: string }> = [];
  let lastGrad = '';
  let isApplying = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function parseRgb(s: string): { r: number; g: number; b: number } | null {
    const m = s && s.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  }

  function run() {
    if (isApplying) return;
    isApplying = true;

    const scrollContent = ganttContainer.querySelector<HTMLElement>('.ng-scroll-content');
    if (scrollContent) {
      const existing = scrollContent.querySelector('[data-depth-stripes]');
      if (existing) existing.remove();
    }

    const rows = ganttContainer.querySelectorAll<HTMLElement>('.ng-grid-row');
    let bucketRgb: { r: number; g: number; b: number } | null = null;
    const stripes: Array<{ top: number; height: number; color: string }> = [];

    for (let ri = 0; ri < rows.length; ri++) {
      const el = rows[ri];
      if (el.classList.contains('ng-group-row')) {
        const bgRgb = parseRgb(el.style.background || '');
        if (bgRgb) stripes.push({ top: el.offsetTop, height: el.offsetHeight, color: `rgba(${bgRgb.r},${bgRgb.g},${bgRgb.b},0.18)` });
        bucketRgb = bgRgb;
        continue;
      }
      const tid = el.getAttribute('data-task-id') || '';
      const d   = depthMap[tid] !== undefined ? depthMap[tid] : 0;
      let target = '';
      if (bucketRgb) {
        const alpha = Math.max(0.03, 0.12 - d * 0.04);
        target = `rgba(${bucketRgb.r},${bucketRgb.g},${bucketRgb.b},${alpha})`;
        stripes.push({ top: el.offsetTop, height: el.offsetHeight, color: target });
      }

      /* Only write if changed */
      let found = false;
      for (let ai = 0; ai < applied.length; ai++) {
        if (applied[ai].el === el) {
          found = true;
          if (applied[ai].val !== target) {
            applied[ai].val = target;
            if (target) el.style.setProperty('background', target, 'important');
            else el.style.removeProperty('background');
          }
          break;
        }
      }
      if (!found) {
        applied.push({ el, val: target });
        if (target) el.style.setProperty('background', target, 'important');
      }
    }

    /* Canvas-side shading via background-image on .ng-scroll-content */
    if (scrollContent && stripes.length) {
      const liveCanvas = scrollContent.querySelector<HTMLCanvasElement>('canvas');
      if (liveCanvas) {
        const cw = liveCanvas.offsetWidth || liveCanvas.width;
        if (cw > 0) {
          scrollContent.style.backgroundSize = cw + 'px 100%';
          scrollContent.style.backgroundRepeat = 'no-repeat';
        }
      }
      const totalH = scrollContent.scrollHeight || 2000;
      const stops: string[] = [];
      let lastEnd = 0;
      for (let si = 0; si < stripes.length; si++) {
        const st = stripes[si];
        if (st.top > lastEnd) {
          stops.push('transparent ' + lastEnd + 'px', 'transparent ' + st.top + 'px');
        }
        stops.push(st.color + ' ' + st.top + 'px', st.color + ' ' + (st.top + st.height) + 'px');
        lastEnd = st.top + st.height;
      }
      if (lastEnd < totalH) stops.push('transparent ' + lastEnd + 'px', 'transparent ' + totalH + 'px');
      const grad = 'linear-gradient(to bottom,' + stops.join(',') + ')';
      if (grad !== lastGrad) { lastGrad = grad; scrollContent.style.backgroundImage = grad; }
    }

    isApplying = false;
  }

  const raf = requestAnimationFrame(run);

  const observer = new MutationObserver(() => {
    if (isApplying) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 50);
  });
  observer.observe(ganttContainer, { childList: true, subtree: true });

  return function cleanup() {
    cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    observer.disconnect();
    const sc = ganttContainer.querySelector<HTMLElement>('.ng-scroll-content');
    if (sc) {
      sc.style.backgroundImage = '';
      sc.style.backgroundSize = '';
      sc.style.backgroundRepeat = '';
    }
  };
}
