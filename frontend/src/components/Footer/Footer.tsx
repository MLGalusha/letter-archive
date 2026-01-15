import { Link } from "react-router-dom";
import "./Footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-section">
          <h4>Letter Archive</h4>
          <p>Preserving personal letters from the past for future generations.</p>
        </div>
        <div className="footer-section">
          <h4>Explore</h4>
          <nav className="footer-nav">
            <Link to="/">Archive</Link>
            <Link to="/about">About</Link>
            <Link to="/contact">Contact</Link>
          </nav>
        </div>
        <div className="footer-section">
          <h4>Connect</h4>
          <p className="footer-text">Contribute letters or learn more about our mission.</p>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} Letter Archive. All rights reserved.</p>
      </div>
    </footer>
  );
}
