import { useEffect, type RefObject } from "react";

/**
 * When an input inside `containerRef` receives focus, smooth-scroll the container
 * so its top sits just below the sticky header. This gives typing/filtering a stable
 * vertical anchor (the input stays put, the grid below reflows out of sight) and
 * plays nicely with mobile soft keyboards.
 *
 * Bails out if:
 *  - the container is already near the target position (within `threshold`px)
 *  - the user is already focused inside the container (typing → retyping)
 *  - prefers-reduced-motion is on and we'd be making a tiny adjustment
 */
export function useAutoScrollOnFocus(
  containerRef: RefObject<HTMLElement | null>,
  options: { gap?: number; threshold?: number } = {},
) {
  const { gap = 12, threshold = 2 } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastFocusedAt = 0;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !target.isContentEditable) return;

      // If a focus event fires again within a short window (e.g. React re-render
      // or focus bouncing), don't re-scroll.
      const now = Date.now();
      if (now - lastFocusedAt < 400) return;
      lastFocusedAt = now;

      const header = document.querySelector(".header") as HTMLElement | null;
      const headerHeight = header?.offsetHeight ?? 0;
      const rect = container.getBoundingClientRect();
      const desiredViewportTop = headerHeight + gap;
      const delta = rect.top - desiredViewportTop;

      if (Math.abs(delta) <= threshold) return;

      const absoluteTop = Math.max(0, window.scrollY + rect.top - desiredViewportTop);
      const prefersReducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      window.scrollTo({
        top: absoluteTop,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    };

    container.addEventListener("focusin", handleFocusIn);
    return () => container.removeEventListener("focusin", handleFocusIn);
  }, [containerRef, gap, threshold]);
}
