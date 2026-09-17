/**
 * Shared public scroll API. The document owns scrolling so Safari can render
 * content beneath its browser controls and collapse/expand its toolbar.
 */
export function getAppScrollY(): number {
  // Safari can report negative positions during top-edge overscroll.
  return Math.max(0, window.scrollY);
}

export function appScrollTo(y: number): void {
  window.scrollTo(0, y);
}

export function addAppScrollListener(
  listener: () => void,
  options: AddEventListenerOptions = { passive: true },
): () => void {
  window.addEventListener("scroll", listener, options);
  return () => window.removeEventListener("scroll", listener, options);
}

/** null observes the browser viewport, matching document scrolling. */
export function getAppScrollRootForIO(): null {
  return null;
}
