import { Link } from "react-router-dom";
import Footer from "../components/Footer/Footer";
import "./NotFoundPage.css";

export default function NotFoundPage() {
  return (
    <div className="body-layout">
      <div className="notfound-page">
        <div className="notfound-code">404</div>
        <h1 className="notfound-heading">Page not found</h1>
        <p className="notfound-message">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="notfound-actions">
          <Link to="/" className="btn-card notfound-btn">
            Back to Home
          </Link>
          <Link to="/collections" className="notfound-link">
            Browse Collections &rarr;
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}
