import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SEO from '../components/SEO';
import { listUpdates, type UpdatePost } from '../api/client';
import Footer from '../components/Footer/Footer';
import './UpdatesPage.css';

const PAGE_SIZE = 12;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function UpdatesPage() {
  const navigate = useNavigate();
  const [updates, setUpdates] = useState<UpdatePost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUpdates() {
      try {
        const data = await listUpdates({ limit: PAGE_SIZE, offset: 0 });
        setUpdates(data.updates);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load updates');
      } finally {
        setLoading(false);
      }
    }

    fetchUpdates();
  }, []);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await listUpdates({ limit: PAGE_SIZE, offset: updates.length });
      setUpdates((prev) => [...prev, ...data.updates]);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more updates');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleUpdateClick = (slug: string) => {
    navigate(`/updates/${slug}`);
  };

  return (
    <div className="body-layout">
      <SEO
        title="Updates"
        description="Follow the progress of Letter Archive. Project updates, new collections, and behind-the-scenes notes on preserving personal correspondence."
        canonicalUrl="/updates"
      />
      <div className="updates-page">
        <header className="updates-hero">
          <p className="updates-kicker">Updates</p>
          <h1 className="updates-headline">Building the Archive</h1>
          <p className="updates-subtitle">
            Notes on our progress — new collections, project milestones,
            and the stories behind the letters we preserve.
          </p>
        </header>

        {loading && <p className="loading-message">Loading updates...</p>}
        {error && <p className="error-message">{error}</p>}

        {!loading && updates.length === 0 && !error && (
          <div className="no-results">
            <p>No updates yet. Check back soon.</p>
          </div>
        )}

        {updates.length > 0 && (
          <div className="updates-grid">
            {updates.map((update) => (
              <article
                key={update.id}
                className="update-card"
                onClick={() => handleUpdateClick(update.slug)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleUpdateClick(update.slug);
                  }
                }}
              >
                {update.heroImageUrl && (
                  <div className="update-card-image">
                    <img
                      src={update.heroImageUrl}
                      alt={update.heroImageAlt || update.title}
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="update-card-body">
                  <div className="update-card-meta">
                    {update.category && (
                      <span className="update-category-badge">{update.category}</span>
                    )}
                    <span className="update-date">
                      {formatDate(update.publishedAt || update.createdAt)}
                    </span>
                  </div>
                  <h2 className="update-card-title">{update.title}</h2>
                  {update.excerpt && (
                    <p className="update-card-excerpt">{update.excerpt}</p>
                  )}
                  <div className="update-card-footer">
                    {update.authorDisplayName && (
                      <span className="update-author">{update.authorDisplayName}</span>
                    )}
                    <span className="update-card-cta">Read more &rarr;</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {updates.length < total && (
          <div className="updates-load-more">
            <button
              className="btn-card"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading...' : 'Load more updates'}
            </button>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
