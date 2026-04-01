# Nimbus Gantt

Standalone, MIT-licensed TypeScript Gantt chart library. Zero runtime dependencies. Canvas + DOM hybrid rendering for high performance (1000+ tasks at 60fps). Built by Cloud Nimbus LLC.

## Quick Commands

```bash
# Build the core library
cd packages/core && npx vite build

# Run the interactive demo
npx vite --config packages/demo/vite.config.ts

# Run unit tests
npx vitest

# Lint
npm run lint
```

## Repository Structure

Monorepo with npm workspaces (`packages/*`):

```
packages/
  core/               # The library itself (@nimbus-gantt/core)
  demo/               # Interactive dev playground (Vite)
  react-adapter/      # React wrapper (@nimbus-gantt/react)
  salesforce-adapter/ # LWC adapter for Delivery Hub (deliveryNimbusGantt)
```

## Architecture

`NimbusGantt` is the public entry point and orchestrator. It wires together:

| Module | Location | Purpose |
|--------|----------|---------|
| **GanttStore** | `store/GanttStore.ts` | Immutable state management with Redux-style actions and middleware |
| **CanvasRenderer** | `render/CanvasRenderer.ts` | Draws timeline bars, headers, grid lines, progress fills on `<canvas>` |
| **DomTreeGrid** | `render/DomTreeGrid.ts` | Left-side tree grid with expand/collapse, built with plain DOM |
| **DragManager** | `interaction/DragManager.ts` | Handles bar move, resize, progress drag, and link creation |
| **ScrollManager** | `interaction/ScrollManager.ts` | Synchronized horizontal/vertical scroll for canvas + grid |
| **HitTest** | `interaction/HitTest.ts` | Maps pixel coordinates to task bars, resize handles, progress handles |
| **DependencyRenderer** | `render/DependencyRenderer.ts` | Draws FS/FF/SS/SF dependency arrows between bars |
| **TooltipManager** | `render/TooltipManager.ts` | Hover tooltips with custom renderer support |
| **TimeScale** | `layout/TimeScale.ts` | Date-to-pixel mapping for day/week/month/quarter zoom levels |
| **LayoutEngine** | `layout/LayoutEngine.ts` | Computes `TaskLayout` positions from state + time scale |
| **TaskTree** | `model/TaskTree.ts` | Builds hierarchical tree from flat task array using `parentId` |
| **EventBus** | `events/EventBus.ts` | Internal pub/sub for lifecycle and interaction events |
| **themes** | `theme/themes.ts` | Light/dark theme definitions and config resolution |
| **types** | `model/types.ts` | All public interfaces: GanttTask, GanttDependency, GanttConfig, NimbusGanttPlugin, etc. |

## Plugin System

Plugins are factory functions that return a `NimbusGanttPlugin` object. Install via:

```typescript
const gantt = new NimbusGantt(container, config);
gantt.use(KeyboardPlugin());
gantt.use(CriticalPathPlugin());
```

Plugin interface (`NimbusGanttPlugin`):
- `name: string`
- `install(gantt: PluginHost): void` — called once, receives API for state/dispatch/events
- `middleware?(action, next)` — intercept and transform actions before the store processes them
- `renderCanvas?(ctx, state, layouts)` — draw on the canvas after the main render pass
- `renderDOM?(container, state)` — inject DOM elements into the Gantt root
- `destroy?()` — cleanup on gantt.destroy()

### Built-in Plugins (12)

| Plugin | What it does |
|--------|-------------|
| `UndoRedoPlugin` | Ctrl+Z / Ctrl+Y action history |
| `KeyboardPlugin` | Arrow key navigation, Enter/Delete/Home/End, zoom with +/- |
| `MilestonePlugin` | Renders zero-duration diamond markers |
| `GroupingPlugin` | Swimlane grouping by `groupId`/`groupName` |
| `CriticalPathPlugin` | CPM analysis, highlights critical path bars/dependencies |
| `BaselinePlugin` | Shows baseline (original plan) bars behind current bars |
| `VirtualScrollPlugin` | Virtual rendering for 1000+ task datasets |
| `ExportPlugin` | Export Gantt to PNG/SVG |
| `DarkThemePlugin` | One-call dark mode toggle |
| `WorkCalendarPlugin` | Non-working days, holidays, custom work hours |
| `TelemetryPlugin` | Opt-in usage analytics with batch reporting |
| `MotionControlPlugin` | Phone accelerometer/gyroscope navigation (direct + WebSocket bridge) |

## Build Outputs

Vite builds three formats from `packages/core`:

- **ESM** (`nimbus-gantt.es.js`) ~142KB
- **UMD** (`nimbus-gantt.umd.js`) ~95KB
- **IIFE** (`nimbus-gantt.iife.js`) ~95KB

All formats gzip to under 28KB.

## NPM Packages

- `@nimbus-gantt/core` — the library
- `@nimbus-gantt/react` — React adapter (thin wrapper)

## Data Contract

The `GanttTask` and `GanttDependency` interfaces are designed to map 1:1 with Delivery Hub's Apex DTOs from `DeliveryGanttController.cls`:

```typescript
interface GanttTask {
  id: string;
  name: string;
  startDate: string;    // ISO YYYY-MM-DD
  endDate: string;
  progress?: number;    // 0.0 - 1.0
  status?: string;      // maps to colorMap key
  parentId?: string;    // tree hierarchy
  groupId?: string;     // swimlane grouping
  assignee?: string;
  isMilestone?: boolean;
  // ... more optional fields
}

interface GanttDependency {
  id: string;
  source: string;       // predecessor task ID
  target: string;       // successor task ID
  type?: 'FS' | 'FF' | 'SS' | 'SF';
  lag?: number;         // days offset
}
```

## Salesforce Integration

The IIFE build is loaded as a Salesforce Static Resource. The LWC adapter lives at `packages/salesforce-adapter/deliveryNimbusGantt/`. Delivery Hub (at `C:\Projects\Delivery-Hub`) consumes this library via that static resource.

### LWS (Lightning Web Security) Constraints

All confirmed safe:
- No `eval()` or `new Function()`
- No CDN script loading
- No `window.top` or `window.parent` access
- DeviceOrientation API is supported under LWS
- Canvas 2D API is fully supported

## Testing

```bash
# Run all unit tests
npx vitest

# Watch mode
npx vitest --watch

# Visual regression tests use Playwright (not yet configured)
```

Test files live alongside source or in a `__tests__` directory. Framework: Vitest.

## Key Conventions

- Plugin files are factory functions (not classes) in `packages/core/src/plugins/`
- State is immutable — mutations go through `store.dispatch(action)`
- All scroll/zoom changes flow through the action system so plugins can intercept them
- Exponential smoothing is used for sensor/motion input (0.85/0.15 split)
- Dead zones prevent jittery response from small sensor movements
- TypeScript strict mode throughout

## Related Projects

- **Delivery Hub** (`C:\Projects\Delivery-Hub`) — Salesforce managed package that consumes Nimbus Gantt. Namespace: `delivery`.
- **cloudnimbusllc.com** — Marketing site with architecture docs and walkthroughs

## Vision

- 3D WebGL renderer as an alternative to Canvas2D
- Phone accelerometer navigation for hands-free Gantt exploration (MotionControlPlugin)
- Telemetry feeding back into Delivery Hub's activity tracking system
- AI-powered scheduling suggestions based on CPM analysis
