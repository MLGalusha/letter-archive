import { Link } from "react-router-dom";
import SEO from "../components/SEO";
import Footer from "../components/Footer/Footer";
import { buildNotFoundSeo } from "../utils/seo";
import "./NotFoundPage.css";

export default function NotFoundPage() {
  const seo = buildNotFoundSeo();

  return (
    <div className="body-layout">
      <SEO
        title={seo.title}
        description={seo.description}
        canonicalUrl={seo.canonicalPath}
        robots={seo.robots}
      />
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
