import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import SEO from '../components/SEO';
import { getUpdate, type UpdatePost } from '../api/client';
import Footer from '../components/Footer/Footer';
import './UpdateDetailPage.css';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function UpdateDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [update, setUpdate] = useState<UpdatePost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    async function fetchUpdate() {
      try {
        const data = await getUpdate(slug!);
        setUpdate(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update not found');
      } finally {
        setLoading(false);
      }
    }

    fetchUpdate();
  }, [slug]);

  if (loading) {
    return (
      <div className="body-layout">
        <div className="update-detail">
          <p className="loading-message">Loading update...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!update || error) {
    return (
      <div className="body-layout">
        <div className="update-detail">
          <Link to="/updates" className="update-back-link">
            &larr; All Updates
          </Link>
          <h1>Update Not Found</h1>
          <p className="error-text">
            {error || 'This update does not exist or is no longer published.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const seoTitle = update.seoTitle || update.title;
  const seoDescription = update.seoDescription || update.excerpt || `Read "${update.title}" on Letter Archive.`;
  const publishedDate = update.publishedAt || update.createdAt;

  return (
    <div className="body-layout">
      <SEO
        title={seoTitle}
        description={seoDescription}
        canonicalUrl={`/updates/${update.slug}`}
        ogType="article"
        ogImage={update.heroImageUrl || undefined}
      />
      <article className="update-detail">
        <Link to="/updates" className="update-back-link">
          &larr; All Updates
        </Link>

        {update.heroImageUrl && (
          <div className="update-hero-image">
            <img
              src={update.heroImageUrl}
              alt={update.heroImageAlt || update.title}
            />
          </div>
        )}

        <header className="update-header">
          <div className="update-meta">
            {update.category && (
              <span className="update-detail-category">{update.category}</span>
            )}
            <time dateTime={publishedDate}>{formatDate(publishedDate)}</time>
          </div>
          <h1 className="update-title">{update.title}</h1>
          {(update.authorDisplayName || update.authorRole) && (
            <p className="update-byline">
              {update.authorDisplayName}
              {update.authorRole && (
                <span className="update-byline-role"> &middot; {update.authorRole}</span>
              )}
            </p>
          )}
        </header>

        <div className="markdown-content">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {update.bodyMarkdown}
          </ReactMarkdown>
        </div>

        {update.ctaLabel && update.ctaUrl && (
          <div className="update-cta">
            <a
              href={update.ctaUrl}
              className="btn-card update-cta-btn"
              target={update.ctaUrl.startsWith('http') ? '_blank' : undefined}
              rel={update.ctaUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {update.ctaLabel}
            </a>
          </div>
        )}

        <div className="update-footer-nav">
          <Link to="/updates" className="update-back-link">
            &larr; Back to all updates
          </Link>
        </div>
      </article>
      <Footer />
    </div>
  );
}
