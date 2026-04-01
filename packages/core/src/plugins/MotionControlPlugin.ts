// ─── Motion Control Plugin ──────────────────────────────────────────────────
// Navigate the Gantt chart using phone accelerometer/gyroscope data.
// Supports two modes:
//   1. Direct mode — DeviceOrientation API on the same device (mobile browser)
//   2. Bridge mode — Phone connects via WebSocket, sends orientation data to
//      desktop browser which applies scroll/zoom transforms
//
// Works under LWS (DeviceOrientation API is a standard Web API).

import type {
  NimbusGanttPlugin,
  PluginHost,
  GanttState,
  ZoomLevel,
} from '../model/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MotionControlOptions {
  /** WebSocket URL for phone bridge. Default: auto-discover via location. */
  wsUrl?: string;
  /** Sensitivity 1-10. Default: 5. */
  sensitivity?: number;
  /** Tilt phone left/right to scroll horizontally. Default: true. */
  enableTilt?: boolean;
  /** Pan phone forward/back to scroll vertically. Default: true. */
  enablePan?: boolean;
  /** Twist phone (compass rotation) to zoom in/out. Default: true. */
  enableTwist?: boolean;
}

/** Message sent from phone to desktop over WebSocket. */
export interface OrientationMessage {
  type: 'orientation';
  alpha: number;  // compass heading (0-360)
  beta: number;   // front-back tilt (-180 to 180)
  gamma: number;  // left-right tilt (-90 to 90)
  timestamp: number;
}

/** Gesture message sent from phone to desktop over WebSocket. */
export interface GestureMessage {
  type: 'gesture';
  gesture: 'tap' | 'doubletap' | 'swipe-left' | 'swipe-right';
}

type BridgeMessage = OrientationMessage | GestureMessage;

// ─── Constants ─────────────────────────────────────────────────────────────

const DEAD_ZONE_DEGREES = 5;
const SMOOTHING_FACTOR = 0.15;   // raw weight in exponential smoothing
const SMOOTHING_RETAIN = 0.85;   // smoothed weight (1 - SMOOTHING_FACTOR)
const BASE_SCROLL_SPEED = 2;     // pixels per degree per frame at sensitivity 5
const ZOOM_THRESHOLD = 30;       // degrees of alpha change before zoom triggers

const ZOOM_ORDER: ZoomLevel[] = ['day', 'week', 'month', 'quarter'];

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Apply dead zone: values within ±threshold become zero. */
function applyDeadZone(value: number, threshold: number): number {
  if (Math.abs(value) < threshold) return 0;
  return value > 0 ? value - threshold : value + threshold;
}

/** Clamp a number between min and max. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Plugin Factory ────────────────────────────────────────────────────────

export function MotionControlPlugin(options?: MotionControlOptions): NimbusGanttPlugin {
  const sensitivity = clamp(options?.sensitivity ?? 5, 1, 10);
  const enableTilt = options?.enableTilt !== false;
  const enablePan = options?.enablePan !== false;
  const enableTwist = options?.enableTwist !== false;
  const wsUrl = options?.wsUrl ?? null;

  // Sensitivity multiplier: maps 1-10 to 0.2-2.0
  const sensitivityMultiplier = sensitivity / 5;

  let host: PluginHost | null = null;
  let destroyed = false;

  // Smoothed orientation values
  let smoothedBeta = 0;   // vertical scroll
  let smoothedGamma = 0;  // horizontal scroll
  let smoothedAlpha = 0;  // zoom

  // Baseline alpha (set on first reading, used for relative zoom)
  let baselineAlpha: number | null = null;
  let lastZoomLevel: ZoomLevel | null = null;

  // Animation frame ID for the update loop
  let animFrameId: number | null = null;

  // DeviceOrientation handler (direct mode)
  let orientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;

  // WebSocket (bridge mode)
  let ws: WebSocket | null = null;
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Latest raw orientation values from either source
  let rawBeta = 0;
  let rawGamma = 0;
  let rawAlpha = 0;
  let hasOrientationData = false;

  // ── Orientation data ingestion ────────────────────────────────────────

  function ingestOrientation(alpha: number, beta: number, gamma: number): void {
    rawAlpha = alpha;
    rawBeta = beta;
    rawGamma = gamma;
    hasOrientationData = true;

    if (baselineAlpha === null) {
      baselineAlpha = alpha;
    }
  }

  // ── Direct mode: DeviceOrientation API ────────────────────────────────

  function setupDirectMode(): boolean {
    if (typeof window === 'undefined') return false;
    if (!('DeviceOrientationEvent' in window)) return false;

    orientationHandler = (e: DeviceOrientationEvent) => {
      if (destroyed) return;
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      ingestOrientation(e.alpha, e.beta, e.gamma);
    };

    window.addEventListener('deviceorientation', orientationHandler);
    return true;
  }

  function teardownDirectMode(): void {
    if (orientationHandler) {
      window.removeEventListener('deviceorientation', orientationHandler);
      orientationHandler = null;
    }
  }

  // ── Bridge mode: WebSocket connection ─────────────────────────────────

  function getWebSocketUrl(): string {
    if (wsUrl) return wsUrl;

    // Auto-discover: assume WebSocket server runs on same host, port 8765
    if (typeof window !== 'undefined' && window.location) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.hostname}:8765`;
    }
    return 'ws://localhost:8765';
  }

  function handleBridgeMessage(data: string): void {
    try {
      const msg: BridgeMessage = JSON.parse(data);

      if (msg.type === 'orientation') {
        ingestOrientation(msg.alpha, msg.beta, msg.gamma);
      } else if (msg.type === 'gesture') {
        handleGesture(msg.gesture);
      }
    } catch {
      // Silently ignore malformed messages
    }
  }

  function handleGesture(gesture: string): void {
    if (!host) return;
    const state = host.getState();

    switch (gesture) {
      case 'tap': {
        // Select the first visible task if none selected
        if (state.selectedIds.size === 0 && state.flatVisibleIds.length > 0) {
          host.dispatch({ type: 'SELECT_TASK', taskId: state.flatVisibleIds[0] });
        }
        break;
      }
      case 'doubletap': {
        // Reset scroll to origin
        host.dispatch({ type: 'SET_SCROLL', x: 0, y: 0 });
        baselineAlpha = null;
        break;
      }
      case 'swipe-left': {
        // Zoom out (coarser granularity)
        const currentIdx = ZOOM_ORDER.indexOf(state.zoomLevel);
        if (currentIdx < ZOOM_ORDER.length - 1) {
          host.dispatch({ type: 'SET_ZOOM', level: ZOOM_ORDER[currentIdx + 1] });
        }
        break;
      }
      case 'swipe-right': {
        // Zoom in (finer granularity)
        const currentIdx = ZOOM_ORDER.indexOf(state.zoomLevel);
        if (currentIdx > 0) {
          host.dispatch({ type: 'SET_ZOOM', level: ZOOM_ORDER[currentIdx - 1] });
        }
        break;
      }
      default:
        break;
    }
  }

  function connectWebSocket(): void {
    if (destroyed) return;
    if (typeof WebSocket === 'undefined') return;

    const url = getWebSocketUrl();

    try {
      ws = new WebSocket(url);

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          handleBridgeMessage(event.data);
        }
      };

      ws.onclose = () => {
        ws = null;
        // Attempt reconnect after 3 seconds
        if (!destroyed) {
          wsReconnectTimer = setTimeout(connectWebSocket, 3000);
        }
      };

      ws.onerror = () => {
        // Will trigger onclose, which handles reconnect
        if (ws) {
          ws.close();
        }
      };
    } catch {
      // WebSocket construction failed — retry later
      if (!destroyed) {
        wsReconnectTimer = setTimeout(connectWebSocket, 3000);
      }
    }
  }

  function teardownBridgeMode(): void {
    if (wsReconnectTimer !== null) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      ws = null;
    }
  }

  // ── Update loop: apply smoothed orientation to Gantt ──────────────────

  function updateLoop(): void {
    if (destroyed || !host) return;

    if (hasOrientationData) {
      // Exponential smoothing
      smoothedBeta = smoothedBeta * SMOOTHING_RETAIN + rawBeta * SMOOTHING_FACTOR;
      smoothedGamma = smoothedGamma * SMOOTHING_RETAIN + rawGamma * SMOOTHING_FACTOR;
      smoothedAlpha = smoothedAlpha * SMOOTHING_RETAIN + rawAlpha * SMOOTHING_FACTOR;

      const state = host.getState();
      const scrollSpeed = BASE_SCROLL_SPEED * sensitivityMultiplier;

      // Horizontal scroll from left-right tilt (gamma)
      if (enableTilt) {
        const gammaOffset = applyDeadZone(smoothedGamma, DEAD_ZONE_DEGREES);
        if (gammaOffset !== 0) {
          const deltaX = gammaOffset * scrollSpeed;
          const newX = Math.max(0, state.scrollX + deltaX);
          host.dispatch({ type: 'SET_SCROLL_X', x: newX });
        }
      }

      // Vertical scroll from front-back tilt (beta)
      if (enablePan) {
        const betaOffset = applyDeadZone(smoothedBeta, DEAD_ZONE_DEGREES);
        if (betaOffset !== 0) {
          const deltaY = betaOffset * scrollSpeed;
          const newY = Math.max(0, state.scrollY + deltaY);
          host.dispatch({ type: 'SET_SCROLL_Y', y: newY });
        }
      }

      // Zoom from compass rotation (alpha)
      if (enableTwist && baselineAlpha !== null) {
        const alphaDelta = smoothedAlpha - baselineAlpha;
        // Normalize to -180..180
        const normalizedDelta =
          ((alphaDelta + 540) % 360) - 180;

        const currentIdx = ZOOM_ORDER.indexOf(state.zoomLevel);

        if (normalizedDelta > ZOOM_THRESHOLD && currentIdx > 0) {
          // Twisted clockwise enough — zoom in
          const newLevel = ZOOM_ORDER[currentIdx - 1];
          if (lastZoomLevel !== newLevel) {
            host.dispatch({ type: 'SET_ZOOM', level: newLevel });
            lastZoomLevel = newLevel;
            // Reset baseline so further twist is required
            baselineAlpha = rawAlpha;
          }
        } else if (normalizedDelta < -ZOOM_THRESHOLD && currentIdx < ZOOM_ORDER.length - 1) {
          // Twisted counter-clockwise — zoom out
          const newLevel = ZOOM_ORDER[currentIdx + 1];
          if (lastZoomLevel !== newLevel) {
            host.dispatch({ type: 'SET_ZOOM', level: newLevel });
            lastZoomLevel = newLevel;
            baselineAlpha = rawAlpha;
          }
        }
      }
    }

    animFrameId = requestAnimationFrame(updateLoop);
  }

  // ── Plugin interface ──────────────────────────────────────────────────

  return {
    name: 'MotionControlPlugin',

    install(gantt: PluginHost): void {
      host = gantt;
      lastZoomLevel = gantt.getState().zoomLevel;

      // Try direct mode first (mobile browser with sensors)
      const hasDirect = setupDirectMode();

      // Also set up bridge mode for phone-to-desktop control
      // If direct mode works, bridge is a secondary input. If not, bridge is primary.
      if (!hasDirect || wsUrl) {
        connectWebSocket();
      }

      // Start the update loop
      animFrameId = requestAnimationFrame(updateLoop);
    },

    destroy(): void {
      destroyed = true;

      // Stop update loop
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }

      // Tear down both modes
      teardownDirectMode();
      teardownBridgeMode();

      host = null;
    },
  };
}
