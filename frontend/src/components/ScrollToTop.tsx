import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { appScrollTo } from '../utils/appScroll';

export default function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    // Only scroll on actual pathname change. Query-param updates (e.g. the
    // archive search syncing ?q=... via setSearchParams({ replace: true }))
    // flip navType from POP → REPLACE without changing pathname; we must
    // NOT scroll in that case or typing into search yanks the page to top.
    const pathnameChanged = prevPathnameRef.current !== pathname;
    prevPathnameRef.current = pathname;

    if (!pathnameChanged) return;
    // Don't scroll on back/forward (POP) so browser restores prior position.
    if (navType === 'POP') return;

    appScrollTo(0);
  }, [pathname, navType]);

  return null;
}
