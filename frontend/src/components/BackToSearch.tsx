import { useCallback, useEffect, type RefObject } from "react";
import "./BackToSearch.css";

interface BackToSearchProps {
  /** When true, the button is shown. Drive this from useStickyDock.stickyDockActive. */
  visible: boolean;
  /** Ref to the element containing the search bar. We scroll to its top and focus an input inside it. */
  targetRef: RefObject<HTMLElement | null> | RefObject<HTMLDivElement | null>;
  /** Override label (default: "Search"). */
  label?: string;
  /** Enable the `/` keyboard shortcut on desktop (default: true). */
  enableKeyboardShortcut?: boolean;
}

const SCROLL_GAP = 12;

export default function BackToSearch({
  visible,
  targetRef,
  label = "Search",
  enableKeyboardShortcut = true,
}: BackToSearchProps) {
  const jumpToSearch = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;

    const isTouch = typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;
    const header = document.querySelector(".header") as HTMLElement | null;
    const headerHeight = header?.offsetHeight ?? 0;
    const targetTop = window.scrollY + target.getBoundingClientRect().top - headerHeight - SCROLL_GAP;
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Always perform an explicit scroll so the button still works when the input
    // is already focused or focus events are otherwise suppressed.
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });

    // Desktop: also focus the input after the scroll so typing can continue.
    if (!isTouch) {
      const input = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[type="search"], input[type="text"], input:not([type]), textarea',
      );
      window.setTimeout(() => {
        input?.focus({ preventScroll: true });
      }, prefersReducedMotion ? 0 : 160);
      return;
    }
  }, [targetRef]);

  // Desktop keyboard shortcut: `/` jumps to search (unless user is already typing).
  useEffect(() => {
    if (!enableKeyboardShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || active?.isContentEditable) return;
      event.preventDefault();
      jumpToSearch();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableKeyboardShortcut, jumpToSearch]);

  const handleClick = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      jumpToSearch();
    },
    [jumpToSearch],
  );

  return (
    <button
      type="button"
      className={`back-to-search${visible ? " back-to-search--visible" : ""}`}
      onPointerDown={handleClick}
      aria-label={`Jump to ${label.toLowerCase()}`}
      tabIndex={visible ? 0 : -1}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
