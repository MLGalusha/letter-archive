import { useLayoutEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

const MOBILE_QUERY = "(max-width: 768px)";
const VIEWPORT_GUTTER = 12;
const TOOLBAR_GAP = 8;

export default function useFixedToolbarPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const isMobile = typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;
      if (!anchor || isMobile) {
        setStyle(undefined);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const toolbar = anchor.closest(".edit-toolbar");
      const toolbarRect = toolbar?.getBoundingClientRect();
      setStyle({
        position: "fixed",
        top: "auto",
        bottom: `${Math.max(
          VIEWPORT_GUTTER,
          window.innerHeight - (toolbarRect?.top ?? rect.top) + TOOLBAR_GAP,
        )}px`,
        right: `${Math.max(VIEWPORT_GUTTER, window.innerWidth - rect.right)}px`,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open]);

  return style;
}
