/**
 * Single source of truth for the public site's scroll container.
 *
 * The public routes scroll inside a dedicated `#app-scroll` element rather
 * than the document itself. This keeps `html`/`body` at viewport size, which
 * fixes several long-standing iOS Safari bugs:
 *
 *   1. `position: fixed` elements drifting as the iOS address bar resizes the
 *      layout viewport on document scroll (#9)
 *   2. Momentum-scroll "tap to stop" consuming the first tap on floating
 *      buttons rendered on the document scroller (#33)
 *   3. Rubber-band overscroll interfering with header positioning
 *
 * This module exposes a small API that every scroll consumer uses instead of
 * touching `window` directly. If no container is registered (admin routes,
 * SSR, tests), everything falls back to `window` so behavior is unchanged.
 */

let scrollElement: HTMLElement | null = null;

/** Called once from App.tsx via a ref callback. */
export function setAppScrollElement(el: HTMLElement | null): void {
  scrollElement = el;
}

/** Returns the registered scroll container, or `null` if none is mounted. */
export function getAppScrollElement(): HTMLElement | null {
  return scrollElement;
}

/**
 * Returns the current vertical scroll position of the app scroller, or the
 * document scroll position if no container is registered.
 */
export function getAppScrollY(): number {
  return scrollElement ? scrollElement.scrollTop : window.scrollY;
}

/** Instant-set the scroll position. */
export function appScrollTo(y: number): void {
  if (scrollElement) {
    scrollElement.scrollTop = y;
  } else {
    window.scrollTo(0, y);
  }
}

/**
 * Attach a scroll listener to the app scroller (or window as fallback).
 * Returns a cleanup function — callers should invoke it in their effect
 * cleanup. Listener is passive by default.
 */
export function addAppScrollListener(
  listener: () => void,
  options: AddEventListenerOptions = { passive: true },
): () => void {
  const target: HTMLElement | Window = scrollElement ?? window;
  target.addEventListener("scroll", listener, options);
  return () => target.removeEventListener("scroll", listener, options);
}

/**
 * Returns the element to use as the `root` for an `IntersectionObserver`
 * when observing viewport-relative visibility. `null` tells the observer to
 * use the browser viewport, which is the correct default when there is no
 * app scroller.
 */
export function getAppScrollRootForIO(): Element | null {
  return scrollElement;
}

