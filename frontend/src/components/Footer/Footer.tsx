import { Link } from "react-router-dom";
import "./Footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <h3 className="footer-title">Letter Archive</h3>
        <p className="footer-tagline">
          Preserving personal letters from the past for future generations.
        </p>
        <nav className="footer-nav">
          <Link to="/">Home</Link>
          <span className="footer-dot" aria-hidden="true">&middot;</span>
          <Link to="/collections">Collections</Link>
          <span className="footer-dot" aria-hidden="true">&middot;</span>
          <Link to="/blog">Blog</Link>
          <span className="footer-dot" aria-hidden="true">&middot;</span>
          <Link to="/about">About</Link>
          <span className="footer-dot" aria-hidden="true">&middot;</span>
          <Link to="/support">Support</Link>
        </nav>
        <p className="footer-copyright">
          &copy; {new Date().getFullYear()} Letter Archive
        </p>
      </div>
    </footer>
  );
}
