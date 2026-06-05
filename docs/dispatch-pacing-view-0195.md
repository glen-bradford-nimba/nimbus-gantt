# Dispatch → DH (+ MF, CN): 0.195.0 — Pacing/Forecast subtab + the DH→NG contract

**Cut:** 0.195.0 (branch `feat/0.195.0-pacing-view`)
**Decided 2026-06-05 across NG / DH / MF:** **DH is the forecast brain, NG is
the forecast screen.** The accurate engine (dated actuals, $ at rate, client
scoping, approval-governance, estimate-vs-actual grading) lives in DH because
the data lives in Salesforce. NG renders.

This cut ships the **screen**: a new `pacing` view-mode subtab in the NG app,
alongside Gantt / List / Treemap / Bubbles / Calendar / Flow. Because it reads
the **same task state the Gantt draws**, editing the board updates it live.

## What's in 0.195.0 (NG side)
- New `pacing` subtab (`packages/app/src/renderers/pacing.ts`), wired in
  `IIFEApp.ts` + `defaults.ts` + `ViewMode`. **APP-bundle** change, md5
  `3581a020128deebdc6b3657853333bda`.
- Interactive, dependency-free SVG/DOM:
  - **Bucket selector** — Week / Month / Quarter.
  - **Stacked bars** — Actual (logged, past) + Forecast (future) + optional
    Target (estimate) line; series toggles in the legend.
  - **Click a bucket → drill-down panel** listing the work items that compose
    it, each with its hours-in-that-period, sorted by contribution. Click an
    item → `onOpenItem` (reuses the existing `onItemClick` contract). A bucket
    "Open report ↗" → `onOpenReport` (host owns navigation — no URLs in NG).
  - **Summary cards** — Logged / Estimated / Remaining / Projected final /
    Pacing % / Active items / **Unscheduled** (estimate-but-no-dates, the
    board-sizing signal MF is fixing).
- **Standalone fallback:** with no host data, NG draws a **forecast-only
  preview** by spreading each task's *remaining* hours (`estimate − logged`)
  across its scheduled span. This is preview math, not the authoritative
  engine — it's what makes the subtab demoable now and gives instant
  drag-feedback before DH recomputes. The header labels itself "preview".

## The DH→NG contract (this is what we're reviewing)
DH computes a render-ready `PacingData` and hands it to NG; NG draws it
verbatim (and marks it authoritative). Shape (exported from
`renderers/pacing.ts`):

```ts
interface PacingBucketItem {
  id: string; name: string;
  hours: number;            // hours landing in THIS bucket
  pctOfItem?: number;       // this bucket ÷ the item's spread total (0–100)
  estimatedHours?: number; loggedHours?: number; remainingHours?: number;
  budgetUsedPct?: number;   // logged ÷ est (0–100+)
  startDate?: string; endDate?: string;
  assignee?: string; status?: string; group?: string;   // for breakout meta + tooltips
}
interface PacingBucket {
  key: string;        // '2026-06' | '2026-Q2' | 'W2026-06-01'
  label: string;      // 'Jun 26'
  startMs?: number;    // bucket start (omit → NG parses from key)
  actual: number;     // logged hours in this period  (DH-only: dated WorkLogs)
  forecast: number;   // projected remaining hours landing here
  target: number;     // planned/estimate hours for this period
  isPast: boolean; isCurrent: boolean;
  items: PacingBucketItem[];   // composition for the rich drill-down
}
interface PacingData {
  buckets: PacingBucket[];
  bucket: 'week'|'month'|'quarter';
  summary: { estimatedHours; loggedHours; remainingHours; projectedFinalHours;
             pacingPct; activeItems; unscheduledHours };
  rate?: number;      // $/hr → NG shows the $ measure
  currency?: string;  scopeLabel?: string;  // e.g. client name
  authoritative?: boolean;
}
```

**Client-facing cuts NG renders (all client-side once it has the data):**
Range (Next 3 / Next 6 / Rest-of-yr / This-Qtr / YTD / All / **Custom
start→end**) · Bucket (Week/Month/Quarter) · Measure (Hours / **$** when a
rate is present) · Mode (Per-period / **Cumulative** burn-up) · Series toggles
(Actual / Forecast / Target). Drill-down breakout columns: This-period · **%
of item** · Est · Logged · Remaining · % used, with a meta line
(group · assignee · status · dates).

**Interaction hooks (DH wires these — host owns nav + tooltips):**
- `onOpenItem(taskId)` — drill-down row click → navigate to the work item.
- `onItemHover(taskId|null, {x,y})` — row mousemove/leave → host renders a
  tooltip/mouseover (DH's richer detail).
- `onOpenReport({bucketKey, taskIds})` — per-bucket "Open report ↗".
- `rate` (or `config.rate`) — blended $/hr to enable the $ measure before full
  `pacingData`.
NG never navigates itself (no URLs) — it emits, DH routes.

**Why this split is right:** only DH can produce `actual` (dated WorkLogs),
`rate`/`$`, `scopeLabel` (client scoping), and the grading history. NG owns
the *interaction* (buckets, drill-down, toggles, the Gantt-aligned rendering).
Same definition both places → the Home dashboard card, the email, and this
subtab can't disagree.

### DH action items
1. **Expose a `getPacing(...)` result shaped as `PacingData`** — reuse PR #872's
   engine (accurate actuals + remaining-spread + $ + scope + grading); just
   serialize to this shape. Bucket the *remaining* spread on
   `EstimatedStartDevDate__c`/`EstimatedEndDevDate__c` so it aligns 1:1 with
   the Gantt bars (same fields the timeline renders on).
2. **Pass it to the NG mount.** The thread-through option (`mountConfig.pacingData`
   + `onOpenReport` + `onPacingBucketChange`) is **not yet wired** — NG ships the
   renderer + fallback first so you can see/shape it. Once you confirm the
   contract, I add the one option pass-through (small, additive) and re-cut.
3. **Bucket switching:** when NG owns the data (fallback) it re-buckets locally;
   when DH owns it, NG fires `onPacingBucketChange(bucket)` and you recompute +
   re-pass. (Or pre-compute all three granularities.)

## Verification
- `npx vite build` (app) clean; `npx vitest run` 155/155; pacing present in the
  app iife. Pre-existing repo tsc errors are unrelated (pacing.ts is clean).
- **Rendered/visual** verification is a Cowork/visual job (Node has no DOM):
  switch to the Pacing pill, confirm bars + bucket selector + click-to-drill.

## Adoption
APP-bundle re-copy: `nimbus-gantt-app.iife.js` → `nimbusganttapp.resource`,
md5 `3581a020128deebdc6b3657853333bda`. Core unchanged from 0.194.1.
