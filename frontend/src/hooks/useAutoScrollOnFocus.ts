import { useEffect, type RefObject } from "react";

/**
 * Keep `containerRef` pinned just under the sticky header whenever the user is
 * interacting with an input inside it.
 *
 * Fires on two events:
 *  - `focusin` → smooth-scroll into place (nice entry animation when clicking
 *    or tabbing into the input from elsewhere).
 *  - `input`   → after a short settle delay (matches debounced search + render),
 *    re-check position and snap the container back into place with an *instant*
 *    scroll if layout shifts have pushed it away. Instant (not smooth) so it
 *    feels like the input "stays put" while typing rather than a delayed drift.
 *
 * Bails out when the container is already within `threshold`px of the target.
 */
export function useAutoScrollOnFocus(
  containerRef: RefObject<HTMLElement | null>,
  options: { gap?: number; threshold?: number; inputSettleDelay?: number } = {},
) {
  const { gap = 12, threshold = 2, inputSettleDelay = 320 } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastFocusedAt = 0;
    let inputTimer: number | null = null;

    const getDelta = () => {
      const header = document.querySelector(".header") as HTMLElement | null;
      const headerHeight = header?.offsetHeight ?? 0;
      const rect = container.getBoundingClientRect();
      const desiredViewportTop = headerHeight + gap;
      return {
        delta: rect.top - desiredViewportTop,
        absoluteTop: Math.max(0, window.scrollY + rect.top - desiredViewportTop),
      };
    };

    const prefersReducedMotion = () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !target.isContentEditable) return;

      // Suppress echo focus events from React re-renders.
      const now = Date.now();
      if (now - lastFocusedAt < 400) return;
      lastFocusedAt = now;

      const { delta, absoluteTop } = getDelta();
      if (Math.abs(delta) <= threshold) return;

      window.scrollTo({
        top: absoluteTop,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !target.isContentEditable) return;

      // Wait for debounced search + re-render to settle, then re-pin.
      if (inputTimer !== null) window.clearTimeout(inputTimer);
      inputTimer = window.setTimeout(() => {
        inputTimer = null;
        const { delta, absoluteTop } = getDelta();
        if (Math.abs(delta) <= threshold) return;
        window.scrollTo({ top: absoluteTop, behavior: "auto" });
      }, inputSettleDelay);
    };

    container.addEventListener("focusin", handleFocusIn);
    container.addEventListener("input", handleInput);
    return () => {
      container.removeEventListener("focusin", handleFocusIn);
      container.removeEventListener("input", handleInput);
      if (inputTimer !== null) window.clearTimeout(inputTimer);
    };
  });
}
