// ─── Scroll Manager ─────────────────────────────────────────────────────────
// Synchronizes scroll between the tree grid and canvas timeline by wrapping
// the timeline panel in a scrollable container with native scrollbars.
// Coalesces scroll events via requestAnimationFrame for smooth performance.

export class ScrollManager {
  private wrapper: HTMLDivElement;
  private content: HTMLDivElement;
  private onScrollCallback: (scrollX: number, scrollY: number) => void;

  private rafId: number | null = null;
  private pendingScroll = false;

  private boundOnScroll: () => void;

  constructor(
    canvasContainer: HTMLElement,
    onScroll: (scrollX: number, scrollY: number) => void,
  ) {
    this.onScrollCallback = onScroll;

    // Create the scrollable wrapper that replaces the canvas container's
    // direct content. All existing children are moved inside.
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'ng-scroll-wrapper';
    this.wrapper.style.cssText =
      'position: absolute; inset: 0; overflow: auto; will-change: scroll-position;';

    // Inner content div — its dimensions create the scrollbar range.
    this.content = document.createElement('div');
    this.content.className = 'ng-scroll-content';
    this.content.style.cssText = 'position: relative; min-width: 100%; min-height: 100%;';

    // Move existing children (e.g. the canvas) into the content div.
    // Make them position: sticky so they don't physically scroll —
    // the canvas re-renders with scroll offsets instead.
    while (canvasContainer.firstChild) {
      const child = canvasContainer.firstChild as HTMLElement;
      if (child.style) {
        child.style.position = 'sticky';
        child.style.top = '0';
        child.style.left = '0';
        child.style.zIndex = '1';
      }
      this.content.appendChild(child);
    }

    this.wrapper.appendChild(this.content);
    canvasContainer.appendChild(this.wrapper);

    // Listen for scroll events
    this.boundOnScroll = this.handleScroll.bind(this);
    this.wrapper.addEventListener('scroll', this.boundOnScroll, { passive: true });
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Programmatically set the scroll position.
   */
  setScrollPosition(x: number, y: number): void {
    this.wrapper.scrollLeft = x;
    this.wrapper.scrollTop = y;
  }

  /**
   * Get the current scroll position.
   */
  getScrollPosition(): { x: number; y: number } {
    return {
      x: this.wrapper.scrollLeft,
      y: this.wrapper.scrollTop,
    };
  }

  /**
   * Set the total scrollable content size. This controls the extent of
   * the scrollbar range (like setting a virtual canvas size).
   */
  setContentSize(width: number, height: number): void {
    this.content.style.width = `${width}px`;
    this.content.style.height = `${height}px`;
  }

  /**
   * Update the viewport size (the visible window). This is the wrapper's
   * own dimensions — typically set automatically via CSS, but exposed for
   * programmatic control when needed.
   */
  setViewportSize(width: number, height: number): void {
    this.wrapper.style.width = `${width}px`;
    this.wrapper.style.height = `${height}px`;
  }

  /**
   * Scroll to a specific horizontal position.
   */
  scrollToX(x: number): void {
    this.wrapper.scrollLeft = x;
  }

  /**
   * Scroll to a specific vertical position.
   */
  scrollToY(y: number): void {
    this.wrapper.scrollTop = y;
  }

  /**
   * Remove event listeners and clean up.
   */
  destroy(): void {
    this.wrapper.removeEventListener('scroll', this.boundOnScroll);

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private handleScroll(): void {
    if (this.pendingScroll) return;

    this.pendingScroll = true;
    this.rafId = requestAnimationFrame(() => {
      this.pendingScroll = false;
      this.rafId = null;
      this.onScrollCallback(this.wrapper.scrollLeft, this.wrapper.scrollTop);
    });
  }
}
