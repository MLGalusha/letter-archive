import "./Header.css";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Load dark mode preference from localStorage
  useEffect(() => {
    const savedMode = localStorage.getItem("darkMode");
    const prefersDark = savedMode === "true";
    setDarkMode(prefersDark);
    if (prefersDark) {
      document.body.classList.add("dark");
    }
  }, []);

  // Toggle dark mode
  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem("darkMode", String(newMode));

    if (newMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  };

  return (
    <header className="header">
      <Link to="/" className="main-title">
        Letter Archive
      </Link>
      <button
        className="menu-toggle"
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        ☰
      </button>
      <nav className={`nav ${menuOpen ? "open" : ""}`}>
        <Link to="/" className="page-selector" onClick={() => setMenuOpen(false)}>
          Home
        </Link>
        <Link to="/collections" className="page-selector" onClick={() => setMenuOpen(false)}>
          Collections
        </Link>
        <Link to="/blog" className="page-selector" onClick={() => setMenuOpen(false)}>
          Blog
        </Link>
        <Link to="/about" className="page-selector" onClick={() => setMenuOpen(false)}>
          About
        </Link>
        <Link to="/support" className="page-selector" onClick={() => setMenuOpen(false)}>
          Support
        </Link>
        <button className="page-selector dark-mode-toggle" onClick={toggleDarkMode}>
          {darkMode ? "☀" : "☾"}
        </button>
      </nav>
    </header>
  );
}
