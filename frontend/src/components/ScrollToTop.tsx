import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { addAppScrollListener, appScrollTo, getAppScrollY } from '../utils/appScroll';

/** One owner for SPA history restoration, including pages that load asynchronously. */
export default function ScrollToTop() {
  const location = useLocation();
  const navType = useNavigationType();
  const prevPathnameRef = useRef(location.pathname);
  const positionsRef = useRef<Map<string, number>>(new Map());
  const restoringRef = useRef(false);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useEffect(() => {
    const key = location.key;
    const onScroll = () => {
      // Modal body locking temporarily resets window.scrollY to zero.
      if (!restoringRef.current && document.body.style.position !== 'fixed') {
        positionsRef.current.set(key, getAppScrollY());
      }
    };
    return addAppScrollListener(onScroll);
  }, [location.key]);

  useLayoutEffect(() => {
    const pathnameChanged = prevPathnameRef.current !== location.pathname;
    prevPathnameRef.current = location.pathname;
    // Search updates replace the history key without leaving the page.
    if (!pathnameChanged) {
      positionsRef.current.set(location.key, getAppScrollY());
      return;
    }

    const target = navType === 'POP' ? positionsRef.current.get(location.key) ?? 0 : 0;
    restoringRef.current = true;
    const stop = () => {
      restoringRef.current = false;
      observer.disconnect();
      clearTimeout(timeout);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
    const restore = () => {
      appScrollTo(target);
      // A lazy route or archive request may not have supplied enough content
      // yet. Retry on content growth, not on every animation frame.
      if (Math.abs(getAppScrollY() - target) <= 1) stop();
    };
    const observer = new ResizeObserver(restore);
    observer.observe(document.body);
    const timeout = setTimeout(stop, 5000);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    restore();
    return stop;
  }, [location.pathname, location.key, navType]);

  return null;
}
