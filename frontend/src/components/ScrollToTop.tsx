import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { addAppScrollListener, appScrollTo, getAppScrollY } from '../utils/appScroll';

/**
 * Drives scroll behavior across route changes for the public site.
 *
 * Pre-#35, the document was the scroller, and the browser natively restored
 * scroll position on history POP navigations — so this component only had to
 * handle scrolling to top on PUSH. After moving to a container scroller
 * (#app-scroll), the browser no longer restores position on Back/Forward, and
 * users lost their prior list position. This component now tracks scroll
 * position per history entry and restores it manually on POP.
 *
 * Scroll position is keyed on `location.key` (a unique id per history entry)
 * rather than pathname so that visiting the same path twice keeps distinct
 * positions. The map is in-memory only and resets on full reload, which
 * matches browser behavior anyway.
 */
export default function ScrollToTop() {
  const location = useLocation();
  const navType = useNavigationType();
  const prevPathnameRef = useRef(location.pathname);
  const positionsRef = useRef<Map<string, number>>(new Map());

  // Continuously record the current entry's scroll position as the user
  // scrolls. When they navigate away and later POP back, the most recent
  // position is already in the map ready to restore.
  useEffect(() => {
    const key = location.key;
    const onScroll = () => {
      positionsRef.current.set(key, getAppScrollY());
    };
    return addAppScrollListener(onScroll);
  }, [location.key]);

  useEffect(() => {
    // Only scroll on actual pathname change. Query-param updates (e.g. the
    // archive search syncing ?q=... via setSearchParams({ replace: true }))
    // flip navType from POP → REPLACE without changing pathname; we must
    // NOT scroll in that case or typing into search yanks the page to top.
    const pathnameChanged = prevPathnameRef.current !== location.pathname;
    prevPathnameRef.current = location.pathname;

    if (!pathnameChanged) return;

    if (navType === 'POP') {
      // Back/forward: restore the saved position for this history entry, or
      // fall back to top if we never recorded one (e.g. first visit).
      const saved = positionsRef.current.get(location.key) ?? 0;
      appScrollTo(saved);
    } else {
      // PUSH/REPLACE with a new pathname: start at the top.
      appScrollTo(0);
    }
  }, [location.pathname, location.key, navType]);

  return null;
}
