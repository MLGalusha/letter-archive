import { Link } from "react-router-dom";
import "./Footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-lead">
            <h3 className="footer-headline">
              Every letter was once folded, sealed, and sent to someone who mattered.
            </h3>
            <p className="footer-sub">
              This archive preserves personal correspondence that might otherwise
              be forgotten — the ordinary language of people separated by
              distance, war, work, or simply the shape of daily life.
            </p>
          </div>

          <div className="footer-explore">
            <span className="footer-explore-label">Start exploring</span>
            <div className="footer-explore-links">
              <Link to="/collections" className="footer-explore-link">
                <span className="footer-explore-title">Collections</span>
                <span className="footer-explore-desc">Browse letter bundles by family, era, or theme</span>
              </Link>
              <Link to="/blog" className="footer-explore-link">
                <span className="footer-explore-title">The Journal</span>
                <span className="footer-explore-desc">Behind-the-scenes notes on the archive</span>
              </Link>
              <Link to="/about" className="footer-explore-link">
                <span className="footer-explore-title">About</span>
                <span className="footer-explore-desc">How this project works and why it exists</span>
              </Link>
            </div>
          </div>

          <div className="footer-support">
            <span className="footer-support-heading">Help build the archive</span>
            <p className="footer-support-desc">
              Donate family letters, help transcribe and verify pages, or contribute financially — every form of support grows the collection.
            </p>
            <Link to="/support" className="footer-support-cta">Get involved &rarr;</Link>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-brand">Voices That Remain</span>
          <span className="footer-dot">&middot;</span>
          <span className="footer-copy">&copy; {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
