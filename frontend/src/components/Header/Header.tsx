import "./Header.css";
import { Link, NavLink, useLocation } from "react-router-dom";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHeaderDock } from "../../contexts/HeaderDockContext";
import useScrollDirection from "../../hooks/useScrollDirection";
import { prefetchCollections } from "../../api/collections";

function preloadCollectionsRoute() {
  void import("../../pages/CollectionsPage");
  prefetchCollections();
}

function preloadBlogRoute() {
  void import("../../pages/UpdatesPage");
}

function preloadAboutRoute() {
  void import("../../pages/AboutPage");
}

export default memo(function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { dock } = useHeaderDock();
  const hasDock = Boolean(dock.content) || Boolean(dock.showTitle);
  const isScrollReveal = dock.scrollReveal ?? false;
  const scrollVisible = useScrollDirection(isScrollReveal);
  const location = useLocation();

  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    preloadCollectionsRoute();
  }, []);

  // Measure active nav item and position the sliding indicator.
  // Uses a stable measure() callback driven by multiple triggers:
  //  - pathname / collectionsLink changes (synchronous via useLayoutEffect)
  //  - nav box resizing (ResizeObserver — handles window resize, orientation,
  //    dock expand/collapse, and any layout shift that changes nav width)
  //  - web fonts finishing loading (document.fonts.ready — Playfair Display
  //    swap-in changes .page-selector widths after first paint)
  const measureIndicator = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('.page-selector.active');
    if (!active) { setIndicator(null); return; }
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    setIndicator({
      left: activeRect.left - navRect.left + activeRect.width * 0.2,
      width: activeRect.width * 0.6,
    });
  }, []);

  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator, location.pathname, dock.collectionsLink]);

  // Re-measure whenever the nav's own box changes (resize, dock collapse,
  // font swap, orientation change, etc). This is the main fix for the
  // "indicator stuck between tabs" bug.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureIndicator());
    ro.observe(nav);
    // Also observe each page-selector so font-driven width changes on any
    // one of them trigger a re-measure even if the nav's total width didn't
    // change (e.g. active item grew, another shrank by the same amount).
    nav.querySelectorAll<HTMLElement>('.page-selector').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [measureIndicator, dock.collectionsLink]);

  // Belt-and-suspenders: re-measure after web fonts settle. Playfair Display
  // / any swapped font can change widths after the initial layout effect ran.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) measureIndicator();
    });
    return () => { cancelled = true; };
  }, [measureIndicator]);

  const headerClass = [
    "header",
    isScrollReveal && "header--scroll-reveal",
    isScrollReveal && !scrollVisible && "header--hidden",
  ].filter(Boolean).join(" ");

  return (
    <header className={headerClass}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="header-inner">
        <div className={`header-brand-slot${dock.active ? " has-active-dock" : ""}${dock.showTitle ? " show-title" : ""}`}>
          <Link to="/" className="main-title" onClick={() => setMenuOpen(false)}>
            <span className="main-title-label">A Letter Archive</span>
            <span className="main-title-name">Voices That Remain</span>
          </Link>
          {hasDock && (
            <div className={`header-dock${dock.active ? " is-active" : ""}${dock.visible ? " is-visible" : ""}`}>
              {dock.content}
            </div>
          )}
        </div>
        <button
          className="menu-toggle"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          Menu
        </button>
        <nav ref={navRef} className={`nav ${menuOpen ? "open" : ""}`}>
          <NavLink to="/" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onClick={() => setMenuOpen(false)} end>
            Home
          </NavLink>
          <NavLink
            to={dock.collectionsLink?.to ?? "/collections"}
            className={({ isActive }) => `page-selector${isActive || dock.collectionsLink ? " active" : ""}`}
            onMouseEnter={preloadCollectionsRoute}
            onFocus={preloadCollectionsRoute}
            onClick={() => setMenuOpen(false)}
          >
            {dock.collectionsLink?.label ?? "Collections"}
          </NavLink>
          <NavLink to="/blog" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onMouseEnter={preloadBlogRoute} onFocus={preloadBlogRoute} onClick={() => setMenuOpen(false)}>
            Journal
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onMouseEnter={preloadAboutRoute} onFocus={preloadAboutRoute} onClick={() => setMenuOpen(false)}>
            About
          </NavLink>
          <NavLink to="/support" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onClick={() => setMenuOpen(false)}>
            Support
          </NavLink>
          {indicator && (
            <span
              className="nav-indicator"
              style={{ left: indicator.left, width: indicator.width }}
            />
          )}
        </nav>
      </div>
    </header>
  );
});
