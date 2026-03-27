import { Link } from "react-router-dom";
import "./Footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-lead">
          <p className="footer-kicker">Letter Archive</p>
          <h3 className="footer-title">Personal correspondence, preserved with editorial care.</h3>
          <p className="footer-tagline">
            A reading room for letters, collections, and the quiet details history usually misses.
          </p>
        </div>
        <p className="footer-note">
          Browse the archive, follow a collection, or read the project journal.
        </p>
        <nav className="footer-nav" aria-label="Footer">
          <Link to="/">Home</Link>
          <Link to="/collections">Collections</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/about">About</Link>
          <Link to="/support">Support</Link>
        </nav>
        <p className="footer-copyright">
          &copy; {new Date().getFullYear()} Letter Archive
        </p>
      </div>
    </footer>
  );
}
