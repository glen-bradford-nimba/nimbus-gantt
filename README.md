# Nimbus Gantt

**High-performance, framework-agnostic Gantt chart library**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#)
[![Bundle Size](https://img.shields.io/badge/gzipped-~28KB-orange.svg)](#build-outputs)

---

## Why Nimbus Gantt?

- **MIT licensed** -- the only production-quality open-source Gantt chart
- **Zero runtime dependencies** -- nothing to audit, nothing to break
- **Canvas + DOM hybrid** -- 60fps canvas timeline with an accessible DOM tree grid
- **Works everywhere** -- standard web apps, React, and Salesforce LWC
- **Plugin architecture** -- 26 plugins, use only what you need
- **TypeScript-first** -- strict mode, full type declarations shipped

## Quick Start

```bash
npm install @nimbus-gantt/core
```

```typescript
import { NimbusGantt } from '@nimbus-gantt/core';

const gantt = new NimbusGantt(document.getElementById('gantt'), {
  tasks: [
    { id: '1', name: 'Design',      startDate: '2026-01-06', endDate: '2026-01-17', progress: 1.0 },
    { id: '2', name: 'Development', startDate: '2026-01-20', endDate: '2026-02-14', progress: 0.4 },
    { id: '3', name: 'Testing',     startDate: '2026-02-17', endDate: '2026-02-28', progress: 0 },
  ],
  dependencies: [
    { id: 'd1', source: '1', target: '2', type: 'FS' },
    { id: 'd2', source: '2', target: '3', type: 'FS' },
  ],
  onTaskClick: (task) => console.log('Clicked:', task.name),
});
```

## Features

### Core
- Collapsible tree grid with custom columns
- Day / week / month / quarter zoom levels
- Drag to move, resize, and adjust progress
- Dependency arrows (FS, FF, SS, SF with lag)
- Today marker and weekend shading

### Analysis
- **Critical Path (CPM)** -- highlight the longest chain of dependent tasks
- **Monte Carlo simulation** -- probabilistic schedule forecasting
- **Risk scoring** -- automated project health assessment with recommendations
- **Project narrative** -- auto-generated plain-language project summary

### Interaction
- Undo / redo (Ctrl+Z / Ctrl+Y)
- Full keyboard navigation (arrows, Enter, Delete, Home, End, +/- zoom)
- What-if sandbox -- explore schedule changes without committing
- Time-travel -- step through project history snapshots

### Visualization
- Dark mode (one-line toggle)
- Resource heatmap overlay
- Mini-map for large projects
- Network graph (PERT/precedence diagram)
- Milestone diamonds
- Timeline notes and annotations

### Export & Import
- PNG and SVG export
- MS Project XML import/export

### Advanced
- Auto-scheduling with resource leveling
- Working calendar (holidays, non-working days, custom hours)
- Split tasks (interrupted work)
- Sonification (audible schedule representation)
- Phone accelerometer navigation

## Plugins

| Plugin | Description |
|--------|-------------|
| `UndoRedoPlugin` | Ctrl+Z / Ctrl+Y action history |
| `KeyboardPlugin` | Arrow keys, Enter, Delete, Home/End, zoom with +/- |
| `MilestonePlugin` | Zero-duration diamond markers |
| `GroupingPlugin` | Swimlane grouping by `groupId` |
| `CriticalPathPlugin` | CPM analysis, highlights critical path |
| `BaselinePlugin` | Shows original-plan bars behind current schedule |
| `VirtualScrollPlugin` | Virtual rendering for 1000+ task datasets |
| `ExportPlugin` | Export to PNG or SVG |
| `DarkThemePlugin` | One-call dark mode toggle |
| `WorkCalendarPlugin` | Non-working days, holidays, custom work hours |
| `TelemetryPlugin` | Opt-in usage analytics with batch reporting |
| `MotionControlPlugin` | Phone accelerometer/gyroscope navigation |
| `MSProjectPlugin` | Import/export MS Project XML |
| `SplitTaskPlugin` | Render interrupted/split tasks |
| `ResourceLevelingPlugin` | Auto-level resources to resolve conflicts |
| `RiskAnalysisPlugin` | Risk scoring, health assessment, recommendations |
| `NetworkGraphPlugin` | PERT / precedence network diagram |
| `ConfigPanelPlugin` | Runtime configuration UI panel |
| `HeatmapViewPlugin` | Resource utilization heatmap overlay |
| `MiniMapPlugin` | Birds-eye mini-map for large schedules |
| `TimelineNotesPlugin` | Annotations and notes on the timeline |
| `TimeTravelPlugin` | Step through historical snapshots of the schedule |
| `MonteCarloPlugin` | Probabilistic schedule simulation |
| `NarrativePlugin` | Auto-generated plain-language project summary |
| `WhatIfPlugin` | Sandbox mode for exploring schedule changes |
| `SonificationPlugin` | Audio representation of the schedule |

```typescript
import { NimbusGantt, CriticalPathPlugin, UndoRedoPlugin } from '@nimbus-gantt/core';

const gantt = new NimbusGantt(container, config);
gantt.use(CriticalPathPlugin());
gantt.use(UndoRedoPlugin());
```

## API Reference

### Constructor

```typescript
const gantt = new NimbusGantt(container: HTMLElement, config: GanttConfig);
```

### Configuration (`GanttConfig`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tasks` | `GanttTask[]` | *required* | Task data |
| `dependencies` | `GanttDependency[]` | `[]` | Dependency links |
| `columns` | `ColumnConfig[]` | name column | Tree grid columns |
| `zoomLevel` | `'day' \| 'week' \| 'month' \| 'quarter'` | `'week'` | Initial zoom |
| `rowHeight` | `number` | `36` | Row height in pixels |
| `barHeight` | `number` | `24` | Bar height in pixels |
| `headerHeight` | `number` | `56` | Header height in pixels |
| `gridWidth` | `number` | `300` | Tree grid width (0 to hide) |
| `readOnly` | `boolean` | `false` | Disable drag interactions |
| `showToday` | `boolean` | `true` | Show today marker line |
| `showWeekends` | `boolean` | `true` | Shade weekend columns |
| `showProgress` | `boolean` | `true` | Render progress fill |
| `snapToDays` | `boolean` | `true` | Snap drag to day boundaries |
| `colorMap` | `Record<string, string>` | `{}` | Status-to-color mapping |
| `theme` | `'light' \| 'dark' \| ThemeConfig` | `'light'` | Theme |

### Methods

```typescript
gantt.setData(tasks, dependencies?)   // Replace all data
gantt.updateTask(taskId, changes)     // Partial update a task
gantt.addTask(task)                   // Add a task
gantt.removeTask(taskId)              // Remove a task
gantt.setZoom('month')                // Change zoom level
gantt.scrollToDate('2026-03-01')      // Center viewport on a date
gantt.scrollToTask('task-42')         // Scroll to a specific task
gantt.expandAll()                     // Expand all tree nodes
gantt.collapseAll()                   // Collapse all tree nodes
gantt.use(plugin)                     // Install a plugin
gantt.destroy()                       // Tear down and clean up
```

### Event Callbacks

All callbacks are optional and support async (return `void | Promise<void>`).

```typescript
const gantt = new NimbusGantt(container, {
  tasks,
  onTaskClick:          (task) => { /* ... */ },
  onTaskDblClick:       (task) => { /* ... */ },
  onTaskMove:           (task, startDate, endDate) => { /* ... */ },
  onTaskResize:         (task, startDate, endDate) => { /* ... */ },
  onTaskProgressChange: (task, progress) => { /* ... */ },
  onDependencyCreate:   (sourceId, targetId, type) => { /* ... */ },
  onDependencyClick:    (dependency) => { /* ... */ },
  onViewChange:         (zoomLevel, startDate, endDate) => { /* ... */ },
  onTaskSelect:         (taskIds) => { /* ... */ },
});
```

## Data Format

### `GanttTask`

```typescript
interface GanttTask {
  id: string;
  name: string;
  startDate: string;        // "YYYY-MM-DD"
  endDate: string;          // "YYYY-MM-DD"
  progress?: number;        // 0.0 - 1.0
  status?: string;          // Maps to colorMap key
  priority?: string;
  parentId?: string;        // For tree hierarchy
  groupId?: string;         // For swimlane grouping
  groupName?: string;
  assignee?: string;
  sortOrder?: number;
  isMilestone?: boolean;
  isCompleted?: boolean;
  color?: string;           // Override color (hex)
  metadata?: Record<string, unknown>;
}
```

### `GanttDependency`

```typescript
interface GanttDependency {
  id: string;
  source: string;           // Predecessor task ID
  target: string;           // Successor task ID
  type?: 'FS' | 'FF' | 'SS' | 'SF';  // Default: 'FS'
  lag?: number;             // Days offset
}
```

## Salesforce LWC Integration

The IIFE build can be loaded as a Static Resource in Salesforce.

```javascript
// myGanttComponent.js
import { LightningElement } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import NIMBUS_GANTT from '@salesforce/resourceUrl/NimbusGantt';

export default class MyGanttComponent extends LightningElement {
  gantt;

  async renderedCallback() {
    if (this.gantt) return;

    await loadScript(this, NIMBUS_GANTT + '/nimbus-gantt.iife.js');

    const container = this.template.querySelector('.gantt-container');
    this.gantt = new window.NimbusGantt(container, {
      tasks: this.tasks,
      dependencies: this.dependencies,
      readOnly: false,
      onTaskMove: (task, start, end) => {
        // Call Apex to persist the change
      },
    });
  }

  disconnectedCallback() {
    if (this.gantt) {
      this.gantt.destroy();
    }
  }
}
```

LWS (Lightning Web Security) compatible -- no `eval()`, no CDN loading, no `window.top` access.

## React Integration

```bash
npm install @nimbus-gantt/core @nimbus-gantt/react
```

```tsx
import { NimbusGanttChart } from '@nimbus-gantt/react';
import { CriticalPathPlugin, DarkThemePlugin } from '@nimbus-gantt/core';

function ProjectTimeline({ tasks, dependencies }) {
  return (
    <NimbusGanttChart
      tasks={tasks}
      dependencies={dependencies}
      zoomLevel="week"
      height={600}
      plugins={[CriticalPathPlugin(), DarkThemePlugin()]}
      onTaskClick={(task) => console.log(task.name)}
      onTaskMove={async (task, start, end) => {
        await api.updateTask(task.id, { start, end });
      }}
    />
  );
}
```

## Build Outputs

Vite produces three formats from `packages/core`:

| Format | File | Size | Gzipped |
|--------|------|------|---------|
| ESM | `nimbus-gantt.es.js` | ~142 KB | ~28 KB |
| UMD | `nimbus-gantt.umd.js` | ~95 KB | ~28 KB |
| IIFE | `nimbus-gantt.iife.js` | ~95 KB | ~28 KB |

## Development

```bash
# Install dependencies
npm install

# Build the core library
npm run build

# Run the interactive demo (Vite dev server)
npm run dev

# Run unit tests
npm run test

# Lint
npm run lint
```

### Repository Structure

```
packages/
  core/                # The library (@nimbus-gantt/core)
  demo/                # Interactive dev playground (Vite)
  react-adapter/       # React wrapper (@nimbus-gantt/react)
  salesforce-adapter/  # LWC adapter for Salesforce
```

## License

MIT -- [Cloud Nimbus LLC](https://cloudnimbusllc.com)

GitHub: [github.com/glen-bradford-nimba/nimbus-gantt](https://github.com/glen-bradford-nimba/nimbus-gantt)
