import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '../components/SEO';
import { listBlogPosts, type BlogPost } from '../api/client';
import Footer from '../components/Footer/Footer';
import { buildBlogIndexSeo, stripMarkdown, truncateText } from '../utils/seo';
import './UpdatesPage.css';

const PAGE_SIZE = 12;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BlogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPageParam = Number(searchParams.get('page') || '1');
  const currentPage =
    Number.isFinite(currentPageParam) && currentPageParam > 0
      ? Math.floor(currentPageParam)
      : 1;
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const blogIndexSeo = buildBlogIndexSeo(currentPage);

  useEffect(() => {
    async function fetchBlogPosts() {
      setLoading(true);
      try {
        const data = await listBlogPosts({
          limit: PAGE_SIZE,
          offset: (currentPage - 1) * PAGE_SIZE,
        });
        setPosts(data.posts);
        setTotal(data.total);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load journal entries');
      } finally {
        setLoading(false);
      }
    }

    fetchBlogPosts();
  }, [currentPage]);

  useEffect(() => {
    if (!loading && total > 0 && currentPage > totalPages) {
      setSearchParams(totalPages > 1 ? { page: String(totalPages) } : {});
    }
  }, [currentPage, loading, setSearchParams, total, totalPages]);

  return (
    <div className="body-layout">
      <SEO
        title={blogIndexSeo.title}
        description={blogIndexSeo.description}
        canonicalUrl={blogIndexSeo.canonicalPath}
        jsonLd={blogIndexSeo.jsonLd}
      />
      <div className="updates-page">
        <header className="updates-hero">
          <p className="updates-kicker">Journal</p>
          <h1 className="updates-headline">Stories from the Archive</h1>
          <p className="updates-subtitle">
            Essays, project notes, collection highlights, and the occasional oddity
            uncovered while preserving personal correspondence.
          </p>
        </header>

        {loading && <p className="loading-message">Loading journal entries...</p>}
        {error && <p className="error-message">{error}</p>}

        {!loading && posts.length === 0 && !error && (
          <div className="no-results">
            <p>No journal entries yet. Check back soon.</p>
          </div>
        )}

        {posts.length > 0 && (
          <div className="updates-grid">
            {posts.map((post) => (
              <Link
                key={post.id}
                to={`/blog/${post.slug}`}
                className="update-card"
              >
                {post.heroImageUrl && (
                  <div className="update-card-image">
                    <img
                      src={post.heroImageUrl}
                      alt={post.heroImageAlt || post.title}
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="update-card-body">
                  <div className="update-card-meta">
                    {post.category && (
                      <span className="update-category-badge">{post.category}</span>
                    )}
                    <span className="update-date">
                      {formatDate(post.publishedAt || post.createdAt)}
                    </span>
                  </div>
                  <h2 className="update-card-title">{post.title}</h2>
                  <p className="update-card-excerpt">
                    {post.excerpt || truncateText(stripMarkdown(post.bodyMarkdown), 150)}
                  </p>
                  <div className="update-card-footer">
                    {post.authorDisplayName && (
                      <span className="update-author">{post.authorDisplayName}</span>
                    )}
                    <span className="update-card-cta">Read more &rarr;</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="updates-load-more">
            {currentPage > 1 ? (
              <Link
                className="btn-card"
                to={currentPage === 2 ? '/blog' : `/blog?page=${currentPage - 1}`}
              >
                Newer posts
              </Link>
            ) : (
              <span />
            )}
            <span className="updates-pagination-label">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link className="btn-card" to={`/blog?page=${currentPage + 1}`}>
                Older posts
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
