// ─── Typed Pub/Sub Event Bus ────────────────────────────────────────────────
// Zero-dependency event system used internally by NimbusGantt and exposed to
// plugins via the PluginHost interface.

type EventHandler = (...args: unknown[]) => void;

export class EventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on(event: string, handler: EventHandler): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Remove a specific handler from an event.
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * Emit an event, calling all registered handlers with the provided arguments.
   */
  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    // Iterate over a snapshot so handlers can safely unsubscribe during emit
    for (const handler of [...handlers]) {
      handler(...args);
    }
  }
}
