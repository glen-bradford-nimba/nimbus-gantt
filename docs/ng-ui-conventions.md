# Nimbus-Gantt UI conventions — where behavior lives

**Status:** house rule, adopted 2026-06-05 (0.196.0). Applies to every button,
panel, modal, tooltip, and menu in the app/template layer.

## Why this exists
The product runs on two surfaces — **cloudnimbusllc.com (web)** and **Delivery
Hub (Salesforce/LWS)** — plus the demo. Glen's standing requirement: *"I want it
to look the same whether you're in Cloud Nimbus LLC or Salesforce."* The only
way to guarantee that is to be deliberate about **where a thing's UI is
rendered**. This doc names the rule so we stop re-litigating it per-button.

## The rule: there are exactly two kinds of action

### 1. In-app surface → **NG owns the UI** (self-styled, identical everywhere)
Anything that draws a modal / panel / tooltip / menu *inside* the app:
- **NG renders it**, with a **self-injected stylesheet** (scoped class prefix,
  e.g. `.ngm-*` / `.ngp-*` / the TooltipManager + ContextMenuPlugin pattern).
  It does **not** depend on the host's compiled `styles.css`, so it renders
  pixel-identical on web, Salesforce, and the demo.
- The **host supplies data in** and **gets a result out** — it does NOT build
  its own version of the surface.
- Results persist through the **existing contracts** (`onPatch` / `onItemEdit`
  for task data; a typed result callback otherwise) — not a new bespoke channel
  per feature.

Already following this pattern (the precedents this rule generalizes):
`TooltipManager`, `ContextMenuPlugin`, the **Pacing view** (`.ngp-*`), and as of
0.196.0 the **Auto-Schedule + Team modals** (`.ngm-*`).

### 2. Hand-off to the host's world → **host owns it** (NG only emits)
Anything that leaves the app — open a Salesforce record page, open a report,
navigate somewhere host-specific. There is **no shared UI to standardize**, so:
- NG **emits an intent** via a callback; the host decides the destination.
- Library never hardcodes URLs or navigates itself (see
  `feedback_host_owns_nav`).

Examples: `onItemClick` (open the work item), `onOpenReport` (open a report).

## Decision table

| Button / action | Kind | Who renders the UI | How the result flows |
|---|---|---|---|
| Tooltip (hover) | in-app | NG (`TooltipManager`, self-styled) | n/a (display) + host `tooltipRows` |
| Right-click menu | in-app | NG (`ContextMenuPlugin`, self-styled) | dispatch / `onItemClick` |
| Pacing view + drill-down | in-app | NG (`.ngp-*`) | `onItemClick` / `onItemHover` / `onOpenReport` |
| **Auto-Schedule** | in-app* | NG (`.ngm-*` modal) | applies via engine; **host override** `onAutoSchedule` |
| **Team / capacity** | in-app | NG (`.ngm-*` modal) | **host override** `onEditTeam`; emit `onTeamChange` |
| Open work item | hand-off | host | `onItemClick(taskId)` |
| Open report | hand-off | host | `onOpenReport({bucketKey, taskIds})` |

\* **Auto-Schedule allows a host override** (`onAutoSchedule`) because the
scheduler may legitimately run server-side (DH's capacity-aware ETA service).
When the host provides it, NG hands off and the host owns the run + persistence.
When it doesn't, NG runs its in-bundle scheduler so web/demo still work. This
is the **dual pattern**: NG-owned fallback + host override — the same shape as
the Pacing view (renders a preview standalone, host overrides with real data).

## The host-override + fallback pattern (the default for in-app actions)
```
on click:
  if (host provided the override callback) → call it, host owns the rest
  else → NG runs its built-in behavior (so it's never dead standalone)
```
This is why a feature is **never a `console.log` stub** and **never a per-host
fork**: there's always a working NG default, and always a clean host seam.

## What this rule forbids
- ❌ "DH pops its own modal" for an in-app surface — that's how CN and Salesforce
  drift visually. (Hand-offs are the only place the host renders.)
- ❌ Emit-only with no fallback — that's the "shipped but dark" trap
  (`feedback_verify_rollout_not_just_engine`); the surface is dead the moment no
  host is attached (demo/CN).
- ❌ A new bespoke persist channel per feature — reuse `onPatch`/`onItemEdit`.
- ❌ Relying on the host's compiled `styles.css` for an NG surface — inject the
  scoped stylesheet so it can't drift (`styles.css` is a pre-compiled artifact;
  new utility classes added in source won't be in the sheet hosts load).

## Adding a new button — the checklist
1. Is it an **in-app surface** or a **hand-off**? (table above)
2. In-app → render it in NG with a self-injected scoped stylesheet; add a
   **host-override callback** + a **working NG fallback**; persist via
   `onPatch`/`onItemEdit` or a typed result callback.
3. Hand-off → add one emit callback; the host owns the destination.
4. Wire the trigger through the existing dispatch seam (a UI-intent `AppEvent`
   intercepted in `IIFEApp.dispatch()`, like `PATCH` / `AUTOSCHEDULE_OPEN` /
   `TEAM_OPEN`) — don't add ad-hoc click wiring in the slot.
5. Update this table.

See also: `feedback_ng_expands_consumers_implement`,
`feedback_host_owns_nav`, `feedback_dont_couple_core_to_consumer_naming`,
`docs/dispatch-pacing-view-0195.md`.
