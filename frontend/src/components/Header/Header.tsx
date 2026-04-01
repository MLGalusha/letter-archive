import "./Header.css";
import { Link, NavLink } from "react-router-dom";
import { memo, useEffect, useState } from "react";
import { useHeaderDock } from "../../contexts/HeaderDockContext";
import useScrollDirection from "../../hooks/useScrollDirection";
import { prefetchCollections } from "../../api/collections";

function preloadCollectionsRoute() {
  void import("../../pages/CollectionsPage");
  prefetchCollections();
}

export default memo(function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { dock } = useHeaderDock();
  const hasDock = Boolean(dock.content) || Boolean(dock.showTitle);
  const isScrollReveal = dock.scrollReveal ?? false;
  const scrollVisible = useScrollDirection(isScrollReveal);

  useEffect(() => {
    preloadCollectionsRoute();
  }, []);

  const headerClass = [
    "header",
    isScrollReveal && "header--scroll-reveal",
    isScrollReveal && !scrollVisible && "header--hidden",
  ].filter(Boolean).join(" ");

  return (
    <header className={headerClass}>
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
        <nav className={`nav ${menuOpen ? "open" : ""}`}>
          <NavLink to="/" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onClick={() => setMenuOpen(false)} end>
            Home
          </NavLink>
          <NavLink
            to={dock.collectionsLink?.to ?? "/collections"}
            className={({ isActive }) => `page-selector${isActive ? " active" : ""}`}
            onMouseEnter={preloadCollectionsRoute}
            onFocus={preloadCollectionsRoute}
            onClick={() => setMenuOpen(false)}
          >
            {dock.collectionsLink?.label ?? "Collections"}
          </NavLink>
          <NavLink to="/blog" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onClick={() => setMenuOpen(false)}>
            Journal
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onClick={() => setMenuOpen(false)}>
            About
          </NavLink>
          <NavLink to="/support" className={({ isActive }) => `page-selector${isActive ? " active" : ""}`} onClick={() => setMenuOpen(false)}>
            Support
          </NavLink>
        </nav>
      </div>
    </header>
  );
});
