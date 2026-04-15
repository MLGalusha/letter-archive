import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHeaderDock, EMPTY_DOCK_STATE } from "../../contexts/HeaderDockContext";

/**
 * Declarative wrapper a page uses to inject content (typically <HeaderScrubber />)
 * into the header, without the content living in the header's React tree.
 *
 * - Children are rendered via `createPortal` into the slot `<Header>` exposes.
 *   They stay mounted as long as the page that declares this component stays
 *   mounted, so switching tabs on the scrubber never remounts the scrubber
 *   even when the header re-renders.
 * - Layout-affecting flags (`transparent`, `collectionsLink`, hasContent) are
 *   pushed to context so the header can class itself accordingly. Those writes
 *   happen in an effect and don't touch the portaled children.
 */

interface HeaderDockProps {
  children?: ReactNode;
  /** Letter-detail: transparent header background so content scrolls under it. */
  transparent?: boolean;
  /** Override the "Collections" nav link label + target. */
  collectionsLink?: { label: string; to: string };
}

export default function HeaderDock({
  children,
  transparent = false,
  collectionsLink,
}: HeaderDockProps) {
  const { slotEl, setState } = useHeaderDock();
  const hasContent = children != null && children !== false;

  useEffect(() => {
    setState({
      hasContent,
      transparent,
      collectionsLink,
    });
    return () => {
      setState(EMPTY_DOCK_STATE);
    };
  }, [hasContent, transparent, collectionsLink, setState]);

  if (!slotEl || !hasContent) return null;
  return createPortal(children, slotEl);
}
