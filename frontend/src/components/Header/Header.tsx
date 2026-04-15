import "./Header.css";
import { Link, NavLink, useLocation } from "react-router-dom";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHeaderDock } from "../../contexts/HeaderDockContext";
import useHeaderScroll from "../../hooks/useHeaderScroll";
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
  const { state, registerSlot } = useHeaderDock();
  const { visible, atTop } = useHeaderScroll();
  const location = useLocation();

  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const maxHeaderHeightRef = useRef(0);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Publish the header's real height to --header-height on the closest site shell
  // so body-layout top padding matches when a dock (e.g. the collection scrubber)
  // is expanded. --header-height is registered as a <length> and has a CSS
  // transition, so consumers animate smoothly when it changes.
  //
  // Growth-only per page: once we've measured the fully-expanded height while at
  // top, we keep it. This prevents the scroll-to-top grid-row transition from
  // stepping the value through intermediate sizes (which would restart the
  // CSS transition on every tick and cause visible snap). Reset when the dock
  // content is removed (navigation to a page with no dock).
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const shell = el.closest<HTMLElement>(".public-site-shell, .public-letter-shell");
    if (!shell) return;

    if (!state.hasContent) {
      maxHeaderHeightRef.current = 0;
      shell.style.removeProperty("--header-height");
      return;
    }

    const update = () => {
      if (!atTop) return;
      const h = el.offsetHeight;
      if (h > maxHeaderHeightRef.current) {
        maxHeaderHeightRef.current = h;
        shell.style.setProperty("--header-height", `${h}px`);
      }
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [atTop, state.hasContent]);

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
  }, [measureIndicator, location.pathname, state.collectionsLink]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureIndicator());
    ro.observe(nav);
    nav.querySelectorAll<HTMLElement>('.page-selector').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [measureIndicator, state.collectionsLink]);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) measureIndicator();
    });
    return () => { cancelled = true; };
  }, [measureIndicator]);

  const hidden = !visible;
  const dockCollapsed = state.hasContent && !atTop;

  const headerClass = [
    "header",
    state.transparent && "header--transparent",
    hidden && "header--hidden",
    state.hasContent && "header--has-dock",
    dockCollapsed && "header--dock-collapsed",
  ].filter(Boolean).join(" ");

  return (
    <header ref={headerRef} className={headerClass}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="header-inner">
        <div className={`header-brand-slot${state.hasContent ? " has-active-dock" : ""}`}>
          <Link to="/" className="main-title" onClick={() => setMenuOpen(false)}>
            <span className="main-title-label">A Letter Archive</span>
            <span className="main-title-name">Voices That Remain</span>
          </Link>
          <div className="header-dock-region">
            <div ref={registerSlot} className="header-dock-slot" />
          </div>
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
            to={state.collectionsLink?.to ?? "/collections"}
            className={({ isActive }) => `page-selector${isActive || state.collectionsLink ? " active" : ""}`}
            onMouseEnter={preloadCollectionsRoute}
            onFocus={preloadCollectionsRoute}
            onClick={() => setMenuOpen(false)}
          >
            {state.collectionsLink?.label ?? "Collections"}
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
