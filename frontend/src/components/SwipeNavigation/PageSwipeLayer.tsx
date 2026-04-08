import { useMemo, useCallback, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useIsTouchDevice from '../../hooks/useIsTouchDevice';
import useSwipeNavigation from '../../hooks/useSwipeNavigation';

/**
 * Ordered list of top-level public pages that participate in
 * swipe-between-pages navigation. Matches the Header nav order.
 */
const PAGE_ORDER = ['/', '/collections', '/blog', '/about', '/support'];

interface Props {
  children: ReactNode;
}

/**
 * Wraps public page content and enables horizontal swipe navigation
 * between the five top-level pages on touch devices.
 *
 * Only active on exact top-level routes (not on detail pages like
 * /letter/:id or /collections/:code which have their own entity swipe).
 */
export default function PageSwipeLayer({ children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const isTouch = useIsTouchDevice();

  const pageIndex = PAGE_ORDER.indexOf(location.pathname);
  const isTopLevel = pageIndex !== -1;
  const enabled = isTouch && isTopLevel;

  const prevPath = useMemo(
    () => (isTopLevel ? PAGE_ORDER[(pageIndex - 1 + PAGE_ORDER.length) % PAGE_ORDER.length] : null),
    [pageIndex, isTopLevel],
  );
  const nextPath = useMemo(
    () => (isTopLevel ? PAGE_ORDER[(pageIndex + 1) % PAGE_ORDER.length] : null),
    [pageIndex, isTopLevel],
  );

  const onSwipeRight = useCallback(() => {
    if (prevPath) navigate(prevPath);
  }, [prevPath, navigate]);

  const onSwipeLeft = useCallback(() => {
    if (nextPath) navigate(nextPath);
  }, [nextPath, navigate]);

  const { ref, offset, isSwiping } = useSwipeNavigation({
    onSwipeLeft: enabled ? onSwipeLeft : undefined,
    onSwipeRight: enabled ? onSwipeRight : undefined,
    enabled,
  });

  if (!isTouch) {
    return <>{children}</>;
  }

  const style: CSSProperties | undefined = offset !== 0
    ? {
        transform: `translateX(${offset}px)`,
        transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
        willChange: isSwiping ? 'transform' : undefined,
      }
    : undefined;

  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}
