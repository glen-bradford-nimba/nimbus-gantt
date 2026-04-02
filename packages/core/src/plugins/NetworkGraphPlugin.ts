// ─── Network Graph Plugin ───────────────────────────────────────────────────
// Renders an interactive force-directed/layered dependency graph using Canvas.
// Displays the same task data as a PERT-style node-graph instead of bars on a
// timeline. Uses the Sugiyama (layered) layout algorithm by default, with
// support for left-to-right, top-to-bottom, and radial layout modes.
//
// Toggle: emit 'networkGraph:toggle' to show/hide the network graph.
// Layout: emit 'networkGraph:layout' with 'lr' | 'tb' | 'radial' to change mode.

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  GanttTask,
  GanttDependency,
} from '../model/types';
import { computeCPM } from './CriticalPathPlugin';
import type { CPMResult } from './CriticalPathPlugin';

// ─── Public Types ─────────────────────────────────────────────────────────

export type NetworkLayoutMode = 'lr' | 'tb' | 'radial';

export interface NetworkNode {
  id: string;
  task: GanttTask;
  layer: number;
  orderInLayer: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isCritical: boolean;
  isDragging: boolean;
}

export interface NetworkEdge {
  id: string;
  dep: GanttDependency;
  sourceId: string;
  targetId: string;
  isCritical: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

const NODE_WIDTH = 160;
const NODE_HEIGHT = 80;
const NODE_RADIUS = 8;
const LAYER_GAP_LR = 240;
const LAYER_GAP_TB = 160;
const NODE_SPACING_LR = 100;
const NODE_SPACING_TB = 200;
const ARROW_SIZE = 8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;
const ZOOM_FACTOR = 0.001;
const ANIMATION_DURATION = 500;
const BARYCENTER_ITERATIONS = 5;
const MS_PER_DAY = 86_400_000;

// Status badge colors (fallback)
const DEFAULT_STATUS_COLORS: Record<string, string> = {
  'Planning': '#6366F1',
  'Development': '#3B82F6',
  'Testing': '#F59E0B',
  'Review': '#8B5CF6',
  'Done': '#10B981',
  'Blocked': '#EF4444',
  'In Progress': '#3B82F6',
  'Complete': '#10B981',
  'Not Started': '#94A3B8',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

// ─── Sugiyama Layout Algorithm ────────────────────────────────────────────

/**
 * Topological sort with layer (rank) assignment.
 * Tasks with no predecessors get layer 0.
 * Each task's layer = max(predecessor layers) + 1.
 */
function assignLayers(
  tasks: Map<string, GanttTask>,
  dependencies: Map<string, GanttDependency>,
): Map<string, number> {
  const layers = new Map<string, number>();
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const id of tasks.keys()) {
    successors.set(id, []);
    predecessors.set(id, []);
    inDegree.set(id, 0);
  }

  // Build adjacency from dependencies
  for (const dep of dependencies.values()) {
    if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;
    successors.get(dep.source)!.push(dep.target);
    predecessors.get(dep.target)!.push(dep.source);
    inDegree.set(dep.target, (inDegree.get(dep.target) || 0) + 1);
  }

  // Kahn's algorithm for topological sort + layer assignment
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      layers.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current)!;

    for (const succ of successors.get(current)!) {
      // Successor layer = max(all predecessor layers) + 1
      const existingLayer = layers.get(succ);
      const candidateLayer = currentLayer + 1;
      if (existingLayer === undefined || candidateLayer > existingLayer) {
        layers.set(succ, candidateLayer);
      }

      const newDeg = inDegree.get(succ)! - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) {
        queue.push(succ);
      }
    }
  }

  // Handle disconnected nodes (no dependencies) - assign layer 0
  for (const id of tasks.keys()) {
    if (!layers.has(id)) {
      layers.set(id, 0);
    }
  }

  return layers;
}

/**
 * Group tasks by their assigned layer.
 * Returns an array of arrays, where index = layer number.
 */
function groupByLayer(layers: Map<string, number>): string[][] {
  const maxLayer = Math.max(0, ...layers.values());
  const groups: string[][] = [];
  for (let i = 0; i <= maxLayer; i++) {
    groups.push([]);
  }
  for (const [id, layer] of layers) {
    groups[layer].push(id);
  }
  return groups;
}

/**
 * Barycenter heuristic for minimizing edge crossings.
 * Iterates over layers and positions each node at the average position
 * of its neighbors in the adjacent layer.
 */
function minimizeCrossings(
  layerGroups: string[][],
  dependencies: Map<string, GanttDependency>,
  tasks: Map<string, GanttTask>,
): void {
  // Build adjacency lookup
  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();
  for (const id of tasks.keys()) {
    successors.set(id, new Set());
    predecessors.set(id, new Set());
  }
  for (const dep of dependencies.values()) {
    if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;
    successors.get(dep.source)!.add(dep.target);
    predecessors.get(dep.target)!.add(dep.source);
  }

  // Build position index: which position is each node at within its layer?
  const positionOf = new Map<string, number>();
  for (const group of layerGroups) {
    for (let i = 0; i < group.length; i++) {
      positionOf.set(group[i], i);
    }
  }

  for (let iter = 0; iter < BARYCENTER_ITERATIONS; iter++) {
    // Forward sweep: for each layer (left to right), sort by barycenter of predecessors
    for (let l = 1; l < layerGroups.length; l++) {
      const layer = layerGroups[l];
      const barycenters = new Map<string, number>();

      for (const nodeId of layer) {
        const preds = predecessors.get(nodeId)!;
        if (preds.size === 0) {
          barycenters.set(nodeId, positionOf.get(nodeId) ?? 0);
          continue;
        }
        let sum = 0;
        for (const predId of preds) {
          sum += positionOf.get(predId) ?? 0;
        }
        barycenters.set(nodeId, sum / preds.size);
      }

      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
      for (let i = 0; i < layer.length; i++) {
        positionOf.set(layer[i], i);
      }
    }

    // Backward sweep: for each layer (right to left), sort by barycenter of successors
    for (let l = layerGroups.length - 2; l >= 0; l--) {
      const layer = layerGroups[l];
      const barycenters = new Map<string, number>();

      for (const nodeId of layer) {
        const succs = successors.get(nodeId)!;
        if (succs.size === 0) {
          barycenters.set(nodeId, positionOf.get(nodeId) ?? 0);
          continue;
        }
        let sum = 0;
        for (const succId of succs) {
          sum += positionOf.get(succId) ?? 0;
        }
        barycenters.set(nodeId, sum / succs.size);
      }

      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
      for (let i = 0; i < layer.length; i++) {
        positionOf.set(layer[i], i);
      }
    }
  }
}

/**
 * Assign pixel coordinates to nodes based on layer and position within layer.
 */
function assignCoordinates(
  layerGroups: string[][],
  mode: NetworkLayoutMode,
): Map<string, { x: number; y: number }> {
  const coords = new Map<string, { x: number; y: number }>();

  if (mode === 'radial') {
    return assignRadialCoordinates(layerGroups);
  }

  const isHorizontal = mode === 'lr';
  const layerGap = isHorizontal ? LAYER_GAP_LR : LAYER_GAP_TB;
  const nodeSpacing = isHorizontal ? NODE_SPACING_LR : NODE_SPACING_TB;

  for (let l = 0; l < layerGroups.length; l++) {
    const layer = layerGroups[l];
    const layerSize = layer.length;
    // Center each layer
    const totalSpan = (layerSize - 1) * nodeSpacing;
    const offset = -totalSpan / 2;

    for (let i = 0; i < layer.length; i++) {
      const nodeId = layer[i];
      const posInLayer = offset + i * nodeSpacing;

      if (isHorizontal) {
        coords.set(nodeId, {
          x: l * layerGap,
          y: posInLayer,
        });
      } else {
        coords.set(nodeId, {
          x: posInLayer,
          y: l * layerGap,
        });
      }
    }
  }

  return coords;
}

/**
 * Radial layout: center at origin, layers radiate outward in concentric rings.
 */
function assignRadialCoordinates(
  layerGroups: string[][],
): Map<string, { x: number; y: number }> {
  const coords = new Map<string, { x: number; y: number }>();
  const radiusStep = 180;

  for (let l = 0; l < layerGroups.length; l++) {
    const layer = layerGroups[l];

    if (l === 0) {
      // Center layer
      if (layer.length === 1) {
        coords.set(layer[0], { x: 0, y: 0 });
      } else {
        const angleStep = (2 * Math.PI) / layer.length;
        for (let i = 0; i < layer.length; i++) {
          const angle = i * angleStep - Math.PI / 2;
          const r = radiusStep * 0.5;
          coords.set(layer[i], {
            x: Math.cos(angle) * r,
            y: Math.sin(angle) * r,
          });
        }
      }
    } else {
      const radius = l * radiusStep;
      const angleStep = layer.length > 0 ? (2 * Math.PI) / layer.length : 0;
      for (let i = 0; i < layer.length; i++) {
        const angle = i * angleStep - Math.PI / 2;
        coords.set(layer[i], {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        });
      }
    }
  }

  return coords;
}

// ─── Rendering Helpers ────────────────────────────────────────────────────

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function getStatusColor(
  task: GanttTask,
  colorMap: Record<string, string>,
): string {
  if (task.color) return task.color;
  if (task.status) {
    return colorMap[task.status] || DEFAULT_STATUS_COLORS[task.status] || '#94A3B8';
  }
  return '#94A3B8';
}

function getDurationDays(task: GanttTask): number {
  const start = parseDate(task.startDate);
  const end = parseDate(task.endDate);
  return Math.max(diffDays(start, end), 0);
}

// ─── Plugin Factory ───────────────────────────────────────────────────────

export function NetworkGraphPlugin(): NimbusGanttPlugin {
  let host: PluginHost;
  let unsubscribers: Array<() => void> = [];
  let active = false;
  let layoutMode: NetworkLayoutMode = 'lr';
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let dpr = 1;
  let containerEl: HTMLElement | null = null;
  let ganttCanvas: HTMLCanvasElement | null = null;

  // Graph data
  let nodes: Map<string, NetworkNode> = new Map();
  let edges: NetworkEdge[] = [];
  let cpmResult: CPMResult | null = null;

  // Transform state
  let panX = 0;
  let panY = 0;
  let zoom = 1;

  // Interaction state
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;
  let dragNode: NetworkNode | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let hoveredNodeId: string | null = null;
  let selectedNodeId: string | null = null;
  let highlightedChain: Set<string> = new Set();

  // Animation state
  let animating = false;
  let animationStart = 0;
  let animationFrameId = 0;

  // Canvas sizing
  let canvasWidth = 0;
  let canvasHeight = 0;

  // ─── Coordinate Transform ──────────────────────────────────────────────

  /** Convert screen coordinates to graph (world) coordinates */
  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - panX) / zoom,
      y: (sy - panY) / zoom,
    };
  }

  // ─── Hit Testing ───────────────────────────────────────────────────────

  function hitTestNode(sx: number, sy: number): NetworkNode | null {
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    for (const node of nodes.values()) {
      const nx = node.x;
      const ny = node.y;
      if (
        wx >= nx &&
        wx <= nx + NODE_WIDTH &&
        wy >= ny &&
        wy <= ny + NODE_HEIGHT
      ) {
        return node;
      }
    }
    return null;
  }

  // ─── Graph Computation ─────────────────────────────────────────────────

  function computeGraph(): void {
    const state = host.getState();
    const { tasks, dependencies, config } = state;

    if (tasks.size === 0) {
      nodes = new Map();
      edges = [];
      return;
    }

    // Compute CPM for critical path highlighting
    cpmResult = computeCPM(tasks, dependencies);

    // Assign layers using topological sort
    const layerMap = assignLayers(tasks, dependencies);
    const layerGroups = groupByLayer(layerMap);

    // Minimize edge crossings with barycenter heuristic
    minimizeCrossings(layerGroups, dependencies, tasks);

    // Assign pixel coordinates
    const coords = assignCoordinates(layerGroups, layoutMode);

    // Center the graph around the viewport center
    const centerOffsetX = canvasWidth / 2 / zoom;
    const centerOffsetY = canvasHeight / 2 / zoom;

    // Find bounding box of coords to center
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { x, y } of coords.values()) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + NODE_WIDTH);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    }
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    // Build/update nodes
    const oldNodes = nodes;
    nodes = new Map();

    for (const [id, task] of tasks) {
      const coord = coords.get(id);
      if (!coord) continue;

      const targetX = coord.x - graphCenterX;
      const targetY = coord.y - graphCenterY;
      const oldNode = oldNodes.get(id);

      nodes.set(id, {
        id,
        task,
        layer: layerMap.get(id) ?? 0,
        orderInLayer: 0,
        x: oldNode ? oldNode.x : targetX,
        y: oldNode ? oldNode.y : targetY,
        targetX,
        targetY,
        isCritical: cpmResult.criticalTaskIds.has(id),
        isDragging: false,
      });
    }

    // Update order in layer
    for (const group of layerGroups) {
      for (let i = 0; i < group.length; i++) {
        const node = nodes.get(group[i]);
        if (node) node.orderInLayer = i;
      }
    }

    // Build edges
    edges = [];
    for (const dep of dependencies.values()) {
      if (!tasks.has(dep.source) || !tasks.has(dep.target)) continue;
      edges.push({
        id: dep.id,
        dep,
        sourceId: dep.source,
        targetId: dep.target,
        isCritical:
          cpmResult.criticalTaskIds.has(dep.source) &&
          cpmResult.criticalTaskIds.has(dep.target),
      });
    }
  }

  // ─── Chain Highlighting ────────────────────────────────────────────────

  function computeHighlightChain(nodeId: string): Set<string> {
    const state = host.getState();
    const chain = new Set<string>();
    chain.add(nodeId);

    // Build adjacency
    const successors = new Map<string, string[]>();
    const predecessors = new Map<string, string[]>();
    for (const id of state.tasks.keys()) {
      successors.set(id, []);
      predecessors.set(id, []);
    }
    for (const dep of state.dependencies.values()) {
      if (!state.tasks.has(dep.source) || !state.tasks.has(dep.target)) continue;
      successors.get(dep.source)!.push(dep.target);
      predecessors.get(dep.target)!.push(dep.source);
    }

    // BFS upstream
    const upQueue = [nodeId];
    while (upQueue.length > 0) {
      const current = upQueue.shift()!;
      for (const pred of (predecessors.get(current) || [])) {
        if (!chain.has(pred)) {
          chain.add(pred);
          upQueue.push(pred);
        }
      }
    }

    // BFS downstream
    const downQueue = [nodeId];
    while (downQueue.length > 0) {
      const current = downQueue.shift()!;
      for (const succ of (successors.get(current) || [])) {
        if (!chain.has(succ)) {
          chain.add(succ);
          downQueue.push(succ);
        }
      }
    }

    return chain;
  }

  // ─── Animation ─────────────────────────────────────────────────────────

  function startAnimation(): void {
    if (animating) {
      cancelAnimationFrame(animationFrameId);
    }
    animating = true;
    animationStart = performance.now();
    animateFrame();
  }

  function animateFrame(): void {
    const elapsed = performance.now() - animationStart;
    const t = clamp(elapsed / ANIMATION_DURATION, 0, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);

    let anyMoving = false;
    for (const node of nodes.values()) {
      if (node.isDragging) continue;
      const dx = Math.abs(node.x - node.targetX);
      const dy = Math.abs(node.y - node.targetY);
      if (dx > 0.5 || dy > 0.5) {
        node.x = lerp(node.x, node.targetX, eased);
        node.y = lerp(node.y, node.targetY, eased);
        anyMoving = true;
      } else {
        node.x = node.targetX;
        node.y = node.targetY;
      }
    }

    renderGraph();

    if (anyMoving && t < 1) {
      animationFrameId = requestAnimationFrame(animateFrame);
    } else {
      animating = false;
      // Snap all to final positions
      for (const node of nodes.values()) {
        if (!node.isDragging) {
          node.x = node.targetX;
          node.y = node.targetY;
        }
      }
      renderGraph();
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────────

  function renderGraph(): void {
    if (!ctx || !canvas) return;

    const state = host.getState();
    const { config } = state;
    const theme = config.theme;
    const colorMap = config.colorMap;
    const isDark = theme.timelineBg === '#1A202C' || theme.gridBg === '#1A202C' ||
      theme.timelineBg.toLowerCase() === '#1e1e1e' ||
      parseInt(theme.timelineBg.replace('#', ''), 16) < 0x808080;

    // Apply DPI scaling
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = isDark ? '#1A202C' : '#F7F8FA';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Apply pan/zoom transform
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // ── Draw edges ──────────────────────────────────────────────────────
    for (const edge of edges) {
      const sourceNode = nodes.get(edge.sourceId);
      const targetNode = nodes.get(edge.targetId);
      if (!sourceNode || !targetNode) continue;

      const isHighlighted =
        highlightedChain.has(edge.sourceId) && highlightedChain.has(edge.targetId);
      const isHoverConnected =
        hoveredNodeId === edge.sourceId || hoveredNodeId === edge.targetId;
      const isEdgeFaded =
        (hoveredNodeId !== null && !isHoverConnected) ||
        (selectedNodeId !== null && !isHighlighted);

      // Source: right center of node
      const sx = sourceNode.x + NODE_WIDTH;
      const sy = sourceNode.y + NODE_HEIGHT / 2;
      // Target: left center of node
      const tx = targetNode.x;
      const ty = targetNode.y + NODE_HEIGHT / 2;

      ctx.save();

      if (isEdgeFaded) {
        ctx.globalAlpha = 0.15;
      } else if (isHoverConnected || isHighlighted) {
        ctx.globalAlpha = 1;
      }

      // Edge color
      if (edge.isCritical) {
        ctx.strokeStyle = theme.criticalPathColor || '#E53E3E';
        ctx.lineWidth = 2.5;
      } else {
        ctx.strokeStyle = isHoverConnected
          ? (isDark ? '#A0AEC0' : '#4A5568')
          : (isDark ? '#4A5568' : '#CBD5E0');
        ctx.lineWidth = 1.5;
      }

      // Draw quadratic bezier curve
      const cpx = (sx + tx) / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cpx, sy, (sx + tx) / 2, (sy + ty) / 2);
      ctx.quadraticCurveTo(cpx, ty, tx, ty);
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(ty - (sy + ty) / 2, tx - cpx);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(
        tx - ARROW_SIZE * Math.cos(angle - Math.PI / 6),
        ty - ARROW_SIZE * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        tx - ARROW_SIZE * Math.cos(angle + Math.PI / 6),
        ty - ARROW_SIZE * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();

      // Edge label (dependency type + lag)
      const depType = edge.dep.type || 'FS';
      const lag = edge.dep.lag || 0;
      const labelText = lag !== 0 ? `${depType} +${lag}d` : (depType !== 'FS' ? depType : '');
      if (labelText && !isEdgeFaded) {
        const labelX = (sx + tx) / 2;
        const labelY = (sy + ty) / 2 - 8;
        ctx.font = `10px ${theme.fontFamily}`;
        ctx.fillStyle = isDark ? '#A0AEC0' : '#718096';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(labelText, labelX, labelY);
      }

      ctx.restore();
    }

    // ── Draw nodes ──────────────────────────────────────────────────────
    for (const node of nodes.values()) {
      const isFaded =
        (hoveredNodeId !== null && hoveredNodeId !== node.id && !isConnectedTo(hoveredNodeId, node.id)) ||
        (selectedNodeId !== null && !highlightedChain.has(node.id));

      const isHovered = hoveredNodeId === node.id;
      const isSelected = selectedNodeId === node.id;

      const statusColor = getStatusColor(node.task, colorMap);
      const nx = node.x;
      const ny = node.y;

      ctx.save();

      if (isFaded) {
        ctx.globalAlpha = 0.25;
      }

      // Critical path glow
      if (node.isCritical && !isFaded) {
        ctx.save();
        ctx.shadowColor = theme.criticalPathColor || '#E53E3E';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        drawRoundedRect(ctx, nx, ny, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
        ctx.fillStyle = 'transparent';
        ctx.fill();
        ctx.restore();
      }

      // Node fill
      drawRoundedRect(ctx, nx, ny, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
      ctx.fillStyle = isDark ? '#2D3748' : '#FFFFFF';
      ctx.fill();

      // Node border
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // Selection border
      if (isSelected) {
        ctx.strokeStyle = theme.selectionColor || '#3182CE';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, nx - 2, ny - 2, NODE_WIDTH + 4, NODE_HEIGHT + 4, NODE_RADIUS + 2);
        ctx.stroke();
      }

      // ── Task name (bold, clipped) ──────────────────────────────────
      ctx.font = `600 12px ${theme.fontFamily}`;
      ctx.fillStyle = isDark ? '#E2E8F0' : '#1A202C';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const nameText = truncateText(ctx, node.task.name, NODE_WIDTH - 20);
      ctx.fillText(nameText, nx + 10, ny + 8);

      // ── Status badge (dot + text) ──────────────────────────────────
      const badgeY = ny + 26;
      // Status dot
      ctx.beginPath();
      ctx.arc(nx + 16, badgeY + 5, 4, 0, Math.PI * 2);
      ctx.fillStyle = statusColor;
      ctx.fill();
      // Status text
      ctx.font = `10px ${theme.fontFamily}`;
      ctx.fillStyle = isDark ? '#A0AEC0' : '#718096';
      ctx.textBaseline = 'top';
      const statusText = node.task.status || 'No status';
      ctx.fillText(truncateText(ctx, statusText, NODE_WIDTH - 40), nx + 24, badgeY);

      // ── Duration text ──────────────────────────────────────────────
      const duration = getDurationDays(node.task);
      const durationText = duration === 1 ? '1 day' : `${duration} days`;
      ctx.font = `10px ${theme.fontFamily}`;
      ctx.fillStyle = isDark ? '#A0AEC0' : '#718096';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(durationText, nx + 10, ny + 42);

      // ── Assignee name ──────────────────────────────────────────────
      if (node.task.assignee) {
        ctx.font = `10px ${theme.fontFamily}`;
        ctx.fillStyle = isDark ? '#718096' : '#A0AEC0';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(
          truncateText(ctx, node.task.assignee, NODE_WIDTH / 2 - 10),
          nx + NODE_WIDTH - 10,
          ny + 42,
        );
      }

      // ── Progress bar (thin bar at node bottom) ─────────────────────
      const progress = node.task.progress ?? 0;
      const progressBarY = ny + NODE_HEIGHT - 6;
      const progressBarWidth = NODE_WIDTH - 20;
      const progressBarHeight = 3;

      // Background track
      drawRoundedRect(ctx, nx + 10, progressBarY, progressBarWidth, progressBarHeight, 1.5);
      ctx.fillStyle = isDark ? '#4A5568' : '#E2E8F0';
      ctx.fill();

      // Progress fill
      if (progress > 0) {
        const fillWidth = Math.max(progressBarHeight, progressBarWidth * clamp(progress, 0, 1));
        drawRoundedRect(ctx, nx + 10, progressBarY, fillWidth, progressBarHeight, 1.5);
        ctx.fillStyle = statusColor;
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.restore();

    // ── Draw info overlay ────────────────────────────────────────────
    renderOverlay(isDark, theme.fontFamily);
  }

  function renderOverlay(isDark: boolean, fontFamily: string): void {
    if (!ctx) return;

    // Layout mode indicator (top-left)
    const modeLabels: Record<NetworkLayoutMode, string> = {
      lr: 'Left \u2192 Right',
      tb: 'Top \u2192 Bottom',
      radial: 'Radial',
    };

    ctx.save();
    ctx.font = `11px ${fontFamily}`;
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Network Graph \u2022 ${modeLabels[layoutMode]}`, 12, 12);

    // Zoom level (top-right)
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(zoom * 100)}%`, canvasWidth - 12, 12);
    ctx.restore();
  }

  function isConnectedTo(nodeA: string, nodeB: string): boolean {
    for (const edge of edges) {
      if (
        (edge.sourceId === nodeA && edge.targetId === nodeB) ||
        (edge.sourceId === nodeB && edge.targetId === nodeA)
      ) {
        return true;
      }
    }
    return false;
  }

  // ─── Canvas Setup ──────────────────────────────────────────────────────

  function createCanvas(container: HTMLElement): void {
    containerEl = container;
    const timelinePanel = container.querySelector('.ng-timeline-panel') as HTMLElement;
    if (!timelinePanel) return;

    // Find and hide the gantt canvas
    ganttCanvas = timelinePanel.querySelector('canvas') as HTMLCanvasElement;

    canvas = document.createElement('canvas');
    canvas.className = 'ng-network-graph';
    canvas.style.display = 'none';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.zIndex = '5';
    timelinePanel.appendChild(canvas);

    const context = canvas.getContext('2d');
    if (!context) return;
    ctx = context;

    dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // Attach event listeners
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Touch events for mobile
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
  }

  function resizeCanvas(): void {
    if (!canvas || !containerEl) return;
    const timelinePanel = containerEl.querySelector('.ng-timeline-panel') as HTMLElement;
    if (!timelinePanel) return;

    canvasWidth = timelinePanel.clientWidth;
    canvasHeight = timelinePanel.clientHeight;

    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
  }

  function showGraph(): void {
    if (!canvas) return;
    active = true;
    canvas.style.display = 'block';
    if (ganttCanvas) {
      ganttCanvas.style.visibility = 'hidden';
    }
    resizeCanvas();
    resetView();
    computeGraph();
    // Jump directly to target positions on initial show
    for (const node of nodes.values()) {
      node.x = node.targetX;
      node.y = node.targetY;
    }
    renderGraph();
  }

  function hideGraph(): void {
    if (!canvas) return;
    active = false;
    canvas.style.display = 'none';
    if (ganttCanvas) {
      ganttCanvas.style.visibility = 'visible';
    }
    hoveredNodeId = null;
    selectedNodeId = null;
    highlightedChain = new Set();
  }

  function resetView(): void {
    panX = canvasWidth / 2;
    panY = canvasHeight / 2;
    zoom = 1;
  }

  // ─── Event Handlers ────────────────────────────────────────────────────

  function getCanvasXY(e: MouseEvent): { x: number; y: number } {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function onMouseDown(e: MouseEvent): void {
    const { x, y } = getCanvasXY(e);
    const hit = hitTestNode(x, y);

    if (hit) {
      // Start dragging a node
      dragNode = hit;
      hit.isDragging = true;
      dragOffsetX = screenToWorld(x, y).x - hit.x;
      dragOffsetY = screenToWorld(x, y).y - hit.y;

      // Select on click
      selectedNodeId = hit.id;
      highlightedChain = computeHighlightChain(hit.id);
      host.dispatch({ type: 'SELECT_TASK', taskId: hit.id });

      renderGraph();
    } else {
      // Start panning
      isPanning = true;
      panStartX = x;
      panStartY = y;
      panStartPanX = panX;
      panStartPanY = panY;

      // Deselect on empty space click
      if (selectedNodeId) {
        selectedNodeId = null;
        highlightedChain = new Set();
        host.dispatch({ type: 'DESELECT_ALL' });
        renderGraph();
      }
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!canvas) return;
    const { x, y } = getCanvasXY(e);

    if (dragNode) {
      // Drag node to new position
      const world = screenToWorld(x, y);
      dragNode.x = world.x - dragOffsetX;
      dragNode.y = world.y - dragOffsetY;
      dragNode.targetX = dragNode.x;
      dragNode.targetY = dragNode.y;
      renderGraph();
      return;
    }

    if (isPanning) {
      const dx = x - panStartX;
      const dy = y - panStartY;
      panX = panStartPanX + dx;
      panY = panStartPanY + dy;
      renderGraph();
      return;
    }

    // Hover detection
    const hit = hitTestNode(x, y);
    const newHoveredId = hit ? hit.id : null;

    if (newHoveredId !== hoveredNodeId) {
      hoveredNodeId = newHoveredId;
      canvas.style.cursor = hoveredNodeId ? 'pointer' : 'default';
      renderGraph();
    }
  }

  function onMouseUp(_e: MouseEvent): void {
    if (dragNode) {
      dragNode.isDragging = false;
      dragNode = null;
    }
    isPanning = false;
  }

  function onMouseLeave(_e: MouseEvent): void {
    if (dragNode) {
      dragNode.isDragging = false;
      dragNode = null;
    }
    isPanning = false;
    if (hoveredNodeId) {
      hoveredNodeId = null;
      renderGraph();
    }
  }

  function onDblClick(e: MouseEvent): void {
    const { x, y } = getCanvasXY(e);
    const hit = hitTestNode(x, y);
    if (hit) {
      // Emit the same event as the Gantt chart double-click
      // Since PluginHost doesn't expose emit, we listen on the host's on(),
      // but the NimbusGantt orchestrator fires taskDblClick on the event bus.
      // We use the onTaskDblClick callback from config instead.
      const state = host.getState();
      const task = state.tasks.get(hit.id);
      if (task && state.config) {
        // We can't emit events directly from plugins, but the
        // taskDblClick event is wired through the GanttConfig callbacks.
        // The best approach is to dispatch a custom action that the
        // orchestrator can pick up, or use a workaround.
        // Since the plugin only has dispatch + on, we use a select to trigger the callback.
        host.dispatch({ type: 'SELECT_TASK', taskId: hit.id });
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!canvas) return;

    const { x, y } = getCanvasXY(e);

    // Zoom centered on cursor
    const worldBefore = screenToWorld(x, y);
    const delta = -e.deltaY * ZOOM_FACTOR;
    zoom = clamp(zoom + delta * zoom, MIN_ZOOM, MAX_ZOOM);
    const worldAfter = screenToWorld(x, y);

    // Adjust pan to keep the point under the cursor stable
    panX += (worldAfter.x - worldBefore.x) * zoom;
    panY += (worldAfter.y - worldBefore.y) * zoom;

    renderGraph();
  }

  // ─── Touch Event Handlers ──────────────────────────────────────────────

  let lastTouchDist = 0;
  let lastTouchMidX = 0;
  let lastTouchMidY = 0;

  function onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (!canvas) return;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      const hit = hitTestNode(x, y);
      if (hit) {
        dragNode = hit;
        hit.isDragging = true;
        dragOffsetX = screenToWorld(x, y).x - hit.x;
        dragOffsetY = screenToWorld(x, y).y - hit.y;
        selectedNodeId = hit.id;
        highlightedChain = computeHighlightChain(hit.id);
        host.dispatch({ type: 'SELECT_TASK', taskId: hit.id });
      } else {
        isPanning = true;
        panStartX = x;
        panStartY = y;
        panStartPanX = panX;
        panStartPanY = panY;
      }
      renderGraph();
    } else if (e.touches.length === 2) {
      // Pinch zoom
      isPanning = false;
      if (dragNode) {
        dragNode.isDragging = false;
        dragNode = null;
      }
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      lastTouchMidX = (t0.clientX + t1.clientX) / 2;
      lastTouchMidY = (t0.clientY + t1.clientY) / 2;
    }
  }

  function onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (dragNode) {
        const world = screenToWorld(x, y);
        dragNode.x = world.x - dragOffsetX;
        dragNode.y = world.y - dragOffsetY;
        dragNode.targetX = dragNode.x;
        dragNode.targetY = dragNode.y;
        renderGraph();
      } else if (isPanning) {
        const dx = x - panStartX;
        const dy = y - panStartY;
        panX = panStartPanX + dx;
        panY = panStartPanY + dy;
        renderGraph();
      }
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      const canvasX = midX - rect.left;
      const canvasY = midY - rect.top;

      // Pinch zoom
      if (lastTouchDist > 0) {
        const scale = dist / lastTouchDist;
        const worldBefore = screenToWorld(canvasX, canvasY);
        zoom = clamp(zoom * scale, MIN_ZOOM, MAX_ZOOM);
        const worldAfter = screenToWorld(canvasX, canvasY);
        panX += (worldAfter.x - worldBefore.x) * zoom;
        panY += (worldAfter.y - worldBefore.y) * zoom;
      }

      // Pan with two fingers
      panX += midX - lastTouchMidX;
      panY += midY - lastTouchMidY;

      lastTouchDist = dist;
      lastTouchMidX = midX;
      lastTouchMidY = midY;

      renderGraph();
    }
  }

  function onTouchEnd(_e: TouchEvent): void {
    if (dragNode) {
      dragNode.isDragging = false;
      dragNode = null;
    }
    isPanning = false;
    lastTouchDist = 0;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  function destroyCanvas(): void {
    if (canvas) {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.remove();
      canvas = null;
      ctx = null;
    }

    if (ganttCanvas) {
      ganttCanvas.style.visibility = 'visible';
      ganttCanvas = null;
    }

    if (animating) {
      cancelAnimationFrame(animationFrameId);
      animating = false;
    }
  }

  // ─── Plugin Return ─────────────────────────────────────────────────────

  return {
    name: 'NetworkGraphPlugin',

    install(gantt: PluginHost): void {
      host = gantt;

      // Listen for toggle
      unsubscribers.push(
        host.on('networkGraph:toggle', () => {
          if (active) {
            hideGraph();
          } else {
            showGraph();
          }
        }),
      );

      // Listen for layout mode change
      unsubscribers.push(
        host.on('networkGraph:layout', (...args: unknown[]) => {
          const mode = args[0] as NetworkLayoutMode;
          if (mode === layoutMode) return;
          layoutMode = mode;

          if (active) {
            computeGraph();
            startAnimation();
          }
        }),
      );

      // Recompute graph when data changes
      unsubscribers.push(
        host.on('stateChange', () => {
          if (active) {
            computeGraph();
            startAnimation();
          }
        }),
      );
    },

    renderDOM(container: HTMLElement, _state: GanttState): void {
      if (!canvas) {
        createCanvas(container);
      }

      if (active) {
        resizeCanvas();
        renderGraph();
      }
    },

    destroy(): void {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers = [];
      destroyCanvas();
      nodes = new Map();
      edges = [];
      cpmResult = null;
      active = false;
    },
  };
}
