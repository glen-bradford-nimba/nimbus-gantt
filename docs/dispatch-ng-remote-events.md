# Dispatch: NG remote-events channel — host-pumped, transport-agnostic

**Author:** NG CC
**Date:** 2026-04-29
**Stacks on:** 0.185.36 (current shipped)
**Targets:** 0.185.37 (skeleton) → 0.185.38 (sequence + per-field patch) → 0.185.39 (middleware + diag)
**Reviewers:** DH CC, CN CC
**Out of scope (separate dispatch):** ContextMenuPlugin / right-click record actions

---

## Problem

Today, hosts update task data by re-fetching from their backend and calling
`handle.setData(tasks, deps)`. That works for self-initiated writes — DH
writes `WorkItem__c`, then re-fetches and repaints. It does **not** work for
writes initiated by other clients: User A edits a record on MF Prod, User B's
gantt on `/lightning/n/Delivery_Timeline` shows stale data until they refresh
the page. Same on cloudnimbusllc.com `/v12`.

The fix is server→client push. We do **not** want NG to know about Salesforce
Platform Events, CometD, websockets, or SSE — those are host-platform
concerns. We **do** want NG to expose one canonical inbound event shape so
both DH and CN translate their native transport into the same NG calls.

## Goal

A transport-agnostic event sink:

```ts
handle.pushRemoteEvent(event: RemoteEvent): void;
```

Hosts subscribe to whatever push channel their platform offers, translate
each message to a `RemoteEvent`, and pump it in. NG applies it to the store
with per-row merge semantics (no full re-layout, no scroll/selection loss).
Same call shape regardless of host.

## Event shape

```ts
type RemoteEvent =
  | { kind: 'task.upsert'; version: 1; tasks: TaskPatch[];          ts?: number; sequence?: string | number; channel?: string; source?: string }
  | { kind: 'task.delete'; version: 1; ids: string[];                ts?: number; sequence?: string | number; channel?: string; source?: string }
  | { kind: 'dep.upsert';  version: 1; deps: GanttDependency[];      ts?: number; sequence?: string | number; channel?: string; source?: string }
  | { kind: 'dep.delete';  version: 1; ids: string[];                ts?: number; sequence?: string | number; channel?: string; source?: string }
  | { kind: 'bulk.replace';version: 1; tasks: GanttTask[]; deps: GanttDependency[]; ts?: number; sequence?: string | number; channel?: string; source?: string }
  | { kind: 'host.custom'; version: 1; name: string; payload: unknown; ts?: number; sequence?: string | number; channel?: string; source?: string };

type TaskPatch = Partial<GanttTask> & { id: string };
```

### Field semantics

- **`kind`** — enumerates the merge semantics NG knows how to perform.
  `host.custom` is the escape hatch; NG ignores it for store mutation but
  routes it to plugins via the existing event bus, so host-specific plugins
  (presence, typing indicators, etc.) can ride the same channel.
- **`version`** — schema version. Lets us evolve shapes additively without
  breaking older hosts. Reject on unknown version with a `remote:dropped-version` diag.
- **`ts`** — host wall-clock at publish time. Optional. Used for stale-drop
  fallback when `sequence` is absent.
- **`sequence`** — host-supplied, monotonic per `(channel, source)`. NG
  prefers `sequence` for stale-drop when present; falls back to `ts`. On
  Salesforce this should be the Platform Event `replayId` (monotonic per
  channel, more reliable than `System.now()` which truncates to ms and skews
  under load). On CN it can be a websocket cursor or left `null`.
- **`channel`** — opaque host string identifying the logical event stream
  (e.g. `'gantt-updates'`, `'/event/WorkItemChange__e'`). NG keys
  `lastAppliedSequence` by `channel`. Default channel: `'default'`.
- **`source`** — opaque host string for diagnostics + self-echo filtering
  (`'dh-platform-event'`, `'cn-ws'`, etc.). NG never inspects beyond
  forwarding to `onRemoteEvent` and diag.

### Per-field patch semantics on `task.upsert`

`TaskPatch` is `Partial<GanttTask>` with `id` required. NG merges **only the
keys present** into the existing task; absent keys are preserved.

This is critical for hot-path traffic: drag-reorder fires many sortOrder
updates per second. A full-row replace would clobber an inline-edit
in-flight on another client (e.g., they're typing a new name when a
sort-rebase event arrives). Hosts should send the smallest patch that
captures their write.

```ts
// Drag reorder — minimal patch, won't clobber concurrent name edit
{ kind: 'task.upsert', version: 1, tasks: [{ id: 'wi-1', parentId: 'wi-7', sortOrder: 3 }] }

// Status change — just the field that changed
{ kind: 'task.upsert', version: 1, tasks: [{ id: 'wi-1', status: 'Complete' }] }

// New record — full row, id is the stable key
{ kind: 'task.upsert', version: 1, tasks: [{ id: 'wi-99', name: '...', startDate: '...', endDate: '...', /*...*/ }] }
```

Future possibility: if drag-reorder traffic on `task.upsert` proves heavy
enough to warrant a tighter shape, we add `task.move` as a typed convenience
in 0.186.x with `{ id, parentId?, sortOrder? }`. Not in scope for the
initial ship.

## Reducer semantics

| kind             | merge behavior                                                                                                          |
|------------------|-------------------------------------------------------------------------------------------------------------------------|
| `task.upsert`    | For each `TaskPatch`: if id exists, merge present keys only. If id missing, treat as insert (full row required).        |
| `task.delete`    | Remove by id. Clear selection if selected. Orphans float to root unless a follow-up `task.upsert` rewrites `parentId`.  |
| `dep.upsert`     | Merge by `id` into dependency map. Full-row replace acceptable since `GanttDependency` is small/atomic.                 |
| `dep.delete`     | Remove by id.                                                                                                           |
| `bulk.replace`   | Equivalent to `setData(tasks, deps)`. Resets `lastAppliedSequence` for the channel.                                     |
| `host.custom`    | No store mutation. Emits on internal event bus as `remote:custom` with `{ name, payload }` for plugin consumption.      |

All operations preserve scroll position, selection, expansion state, and
in-flight drag/edit gestures. Layout dirty-flagged per row, not full
re-layout.

All operations are idempotent — replaying the same event produces no visible
change, which is a hard requirement for reconnect-from-cursor patterns.

## Stale-drop

NG keeps `lastAppliedSequence: Map<channel, sequence>` and
`lastAppliedTs: Map<channel, number>` per channel.

Drop rules per incoming event:

1. If `event.sequence != null` and `event.sequence <= lastAppliedSequence[channel]` → drop (`remote:dropped-stale`).
2. Else if `event.sequence == null` and `event.ts != null` and `event.ts < lastAppliedTs[channel]` → drop (`remote:dropped-stale`).
3. Else apply, then update both maps.

`bulk.replace` resets the channel's `lastAppliedSequence` to its own value
(or 0 if absent). This handles the "host lost its cursor, falling back to
full reload" path — see Reconnect.

## Reconnect contract

Three modes, host picks based on what it knows:

1. **Replay from tip** — host reconnects with no cursor knowledge, only
   wants events from now forward. Subscribe with platform-native "tip"
   semantics (CometD `-2`, websocket fresh subscription). NG state stays
   as-is. May briefly show stale data until the next event arrives — host
   should optionally call `bulk.replace` once to backfill.
2. **Replay from cursor** — host has a cursor (from
   `handle.getLastAppliedSequence(channel)` checkpointed before disconnect).
   Subscribe with `replayId + 1` (CometD) or equivalent. Replay events flow
   in as normal `pushRemoteEvent` calls; idempotency guarantees handle
   duplicates.
3. **Bulk replace fallback** — host lost its cursor (cold reload, retention
   expired, server restart). Re-fetch full snapshot, push as
   `{ kind: 'bulk.replace', ... }`. NG resets channel state.

NG provides:

```ts
handle.getLastAppliedSequence(channel?: string): string | number | null;
handle.getLastAppliedTs(channel?: string): number | null;
```

Host checkpoints however it wants (in-memory across reconnect, sessionStorage, etc.).

## Self-echo handling — `onRemoteEvent` middleware

```ts
mount(container, {
  onRemoteEvent?(event: RemoteEvent): RemoteEventResult | void;
});

type RemoteEventResult =
  | { drop: true }                    // ignore this event
  | { replace: RemoteEvent }          // mutate before applying
  | void;                             // apply as-is
```

Host can return:
- `{ drop: true }` → NG skips the event. Diag: `remote:dropped-host`.
- `{ replace: e2 }` → NG applies `e2` instead. Useful for sanitization (e.g.
  Apex picklist `'Finish-Start'` → `'FS'` per the
  `feedback_sanitize_host_inputs` pattern).
- `void` / nothing → apply as-is.

### Recommended self-echo pattern: `clientNonce`

NG cannot know what counts as "self" — DH and CN tag differently, and
`actorId === userId` is insufficient (same user with the gantt open in two
tabs would drop the other tab's writes against itself).

**Recommended pattern (DH-validated, propose for CN to mirror):**

1. LWC/app generates a per-mount UUID at `connectedCallback`: `clientNonce = crypto.randomUUID()`.
2. On every DML write, the host stuffs `clientNonce` into a write-only field
   that the trigger reads (`ClientNonceTxt__c` on the SObject in DH; equivalent
   request header / body field on CN).
3. The Platform Event publisher / WS publisher includes the nonce in the
   outbound event.
4. In `onRemoteEvent`, the host filters:
   ```ts
   onRemoteEvent: (e) => {
     if ((e as any).clientNonce === this._clientNonce) return { drop: true };
   }
   ```

This correctly handles multi-tab same-user (different nonces per mount) and
cross-user writes (no match, applies normally).

`clientNonce` is **not** a known NG field — it travels in `host.custom` or
as an extra key on the event payload that NG ignores. Host inspects it in
`onRemoteEvent`. Documenting the pattern here so DH and CN converge on the
same shape rather than reinventing.

## Bounded queue

NG maintains an internal queue of incoming events with default size 1000.
On overflow, oldest-drop with one `remote:queue-overflow` diag. Configurable:

```ts
mount(container, {
  remoteEventQueueSize?: number;  // default 1000, min 100, max 100000
});
```

Don't let a misbehaving subscriber OOM the page.

## Diag emitters

New `__nga_diag` event kinds:

| kind                       | when                                              | payload                                          |
|----------------------------|---------------------------------------------------|--------------------------------------------------|
| `remote:received`          | after `pushRemoteEvent`, before any drop checks   | `{ kind, channel, sequence, ts, source }`        |
| `remote:dropped-stale`     | sequence/ts older than last applied               | `{ kind, channel, sequence, lastApplied }`       |
| `remote:dropped-host`      | `onRemoteEvent` returned `{ drop: true }`         | `{ kind, channel, source }`                      |
| `remote:dropped-version`   | unknown `version`                                  | `{ kind, version }`                              |
| `remote:applied`           | after store mutation                              | `{ kind, channel, sequence, taskCount, depCount }` |
| `remote:bulk-replace`      | bulk.replace applied                              | `{ channel, taskCount, depCount }`               |
| `remote:custom`            | host.custom routed to event bus                   | `{ name, channel }`                              |
| `remote:queue-overflow`    | queue size hit                                    | `{ size, dropped }`                              |
| `remote:replay-mode`       | host called `getLastAppliedSequence`              | `{ channel, value }`                             |

Gated behind `window.__nga_diag.enable('remote')` like existing diag flags.
Cowork can verify multi-tab convergence by capturing both clients' diag
streams and asserting matching `remote:applied` sequences.

## Backward compatibility

Fully additive. Hosts that don't call `pushRemoteEvent` see zero behavior
change. `setData` continues to work exactly as it does in 0.185.36. The new
channel and the existing `setData` path can coexist — `setData` is
equivalent to `bulk.replace` semantically, and we may quietly route it
through the same reducer in a future minor.

## Ship order

1. **0.185.37 — skeleton.** `pushRemoteEvent` + `task.upsert` (with
   per-field patch) + `task.delete` + `bulk.replace` + bounded queue.
   Channel keying. No `sequence` yet — `ts`-only stale drop. No
   `onRemoteEvent`. Smallest surface that proves the loop end-to-end. CN
   wires SSE first against this; DH waits.
2. **0.185.38 — durability.** `sequence` field + `getLastAppliedSequence` +
   `dep.upsert` / `dep.delete`. DH wires Platform Events with `replayId`.
3. **0.185.39 — extensibility.** `onRemoteEvent` middleware + `host.custom`
   + full diag emitter set. Hosts implement `clientNonce` self-echo
   filtering on this version.

CN wires first (faster iteration loop, no Salesforce deploy ceremony) and
shakes out the contract. DH inherits and validates the Platform Events path
on a known-stable shape.

## Test plan

- **Single-tab self-write loop.** App writes locally, calls
  `pushRemoteEvent` from its own subscriber. Verify no flicker, no scroll
  jump, in-flight selection preserved.
- **Two-tab convergence.** Same user, two tabs. Edit in tab A → tab B
  reflects within publisher latency. `clientNonce` filter drops tab A's own
  echo.
- **Two-user convergence.** User X edits, user Y's gantt updates. No
  filtering needed.
- **Drag-reorder hot path.** User A drags 50 rows in 5 seconds. User B's
  gantt absorbs the per-row patches without dropping their own in-progress
  inline edit.
- **Stale-drop.** Inject out-of-order events (sequence N+1 then N) →
  second is dropped, diag fires.
- **Reconnect-from-cursor.** Disconnect mid-edit, reconnect with
  `replayId+1`, verify replayed events apply idempotently with no visual
  glitch.
- **Bulk-replace fallback.** Inject `bulk.replace` mid-session, verify
  scroll/selection/expansion preserved (matches current `setData` behavior).
- **Queue overflow.** Push 2000 events synchronously → first 1000 dropped,
  one diag fires, no OOM, app responsive.

## DH-side integration sketch

> **Naming note (per DH CC review 2026-04-29):** Initial draft used
> `Gantt_Update__e`. DH already has a `GanttRemoteEvent__e` Platform Event
> reserved for the phone-as-remote-control companion channel
> (`SessionIdTxt__c` / `ActionTxt__c` / `ValueTxt__c`) — different purpose,
> not DML. To keep the phone-remote channel distinct from the data-change
> channel, this dispatch uses `WorkItemChange__e`. CN can pick whatever name
> fits its transport; only the per-event `channel` string needs to be
> consistent within a host.
>
> Bonus context: `DeliveryWorkItemTriggerHandler` already calls
> `EventBus.publish(events)` on after-* triggers ("powers real-time board
> refresh, not user notifications"). The new channel is incremental on
> existing governor budget, not net-new publishing contention.

```js
// LWC connectedCallback
import { subscribe, unsubscribe, onError } from 'lightning/empApi';

connectedCallback() {
  this._clientNonce = crypto.randomUUID();
  this._mountConfig.onRemoteEvent = (e) => {
    if (e?.clientNonce === this._clientNonce) return { drop: true };
  };
  // ... mount NG ...

  subscribe('/event/WorkItemChange__e', -1, (msg) => {
    const event = this._translatePlatformEvent(msg);  // ~30 lines
    this._mountHandle.pushRemoteEvent(event);
  }).then(sub => this._subscription = sub);
}

disconnectedCallback() {
  if (this._subscription) unsubscribe(this._subscription);
}
```

Apex side:
- New Platform Event: `WorkItemChange__e` with fields `{ Kind__c, TaskIdsJson__c,
  TaskPatchesJson__c, DepsJson__c, ClientNonce__c, ReplayId (system) }`.
- `WorkItemTriggerHandler.afterInsert/afterUpdate/afterDelete` publishes
  events bundled per transaction.
- `WorkItem__c.ClientNonceTxt__c` (write-only-from-LWC, trigger reads to
  populate event field).

DH CC: per Glen's note, this is shovel-ready since `lightning/empApi` is
already wired (PR #723 used it for real-time chat) and
`WorkItemTriggerHandler.after*` is the publisher home. Adapter is ~30 lines.

## CN-side integration sketch

```ts
const clientNonce = crypto.randomUUID();
const handle = NimbusGanttApp.mount(container, {
  // ... existing config
  onRemoteEvent: (e) => {
    if ((e as any).clientNonce === clientNonce) return { drop: true };
  },
});

const es = new EventSource(`/api/gantt/stream?cursor=${lastCursor ?? 'tip'}`);
es.onmessage = (msg) => {
  const event = JSON.parse(msg.data);  // already in RemoteEvent shape from API
  handle.pushRemoteEvent(event);
};
es.onerror = () => {
  // reconnect with handle.getLastAppliedSequence('default') as cursor
};

// On every CN-side mutation request:
fetch('/api/gantt/task', {
  method: 'PATCH',
  headers: { 'X-Client-Nonce': clientNonce },
  body: JSON.stringify(patch),
});
```

## Open questions for CN CC review

1. Does CN have a server-push channel today, or is this greenfield? If
   greenfield, SSE or websocket? SSE is cheaper to stand up; websocket if
   bidirectional traffic is anticipated.
2. CN authoritative server clock for `ts`, or is monotonic cursor available?
   (Affects whether 0.185.37 ts-only stale-drop is enough or 0.185.38
   sequence is needed before CN can wire.)
3. Reconnect semantics on CN side — does the API tier retain a replay log,
   or does CN always fall back to `bulk.replace` on reconnect? (Either is
   fine; affects which mode we exercise first.)

## Non-goals

- ContextMenuPlugin / right-click record actions — separate dispatch.
  Independent workstream (transport vs. interaction); bundling slows both.
- AutoSchedulePlugin integration — events flow into the dependency map; the
  plugin reads from there as it does today, no new wiring.
- Conflict resolution / OT / CRDT — last-write-wins. DML is authoritative,
  hosts handle their own conflict UX (Apex error toasts, etc.).
- Optimistic UI for local writes — hosts already do this; the remote channel
  is purely for *other* clients' writes plus reconciliation of stale local
  state.
