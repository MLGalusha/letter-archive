import "./Header.css";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { useHeaderDock } from "../../contexts/HeaderDockContext";
import useScrollDirection from "../../hooks/useScrollDirection";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { dock } = useHeaderDock();
  const hasDock = Boolean(dock.content) || Boolean(dock.showTitle);
  const isScrollReveal = dock.scrollReveal ?? false;
  const scrollVisible = useScrollDirection(isScrollReveal);

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
            <span className="main-title-label">Editorial Archive</span>
            <span className="main-title-name">Letter Archive</span>
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
          <Link to="/support" className="header-cta" onClick={() => setMenuOpen(false)}>
            Support
          </Link>
        </nav>
      </div>
    </header>
  );
}
