import "./LayoutSandbox.css";

import { useState } from "react";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="header">
      <div className="logo">Archive</div>

      <button
        className="menu-toggle"
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        ☰
      </button>

      <nav className={`nav ${menuOpen ? "open" : ""}`}>
        <button>Home</button>
        <button>Browse</button>
        <button>About</button>
      </nav>
    </header>
  );
}
