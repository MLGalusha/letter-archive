import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SEO from '../components/SEO';
import { listBlogPosts, type BlogPost } from '../api/client';
import Footer from '../components/Footer/Footer';
import './UpdatesPage.css';

const PAGE_SIZE = 12;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BlogPage() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBlogPosts() {
      try {
        const data = await listBlogPosts({ limit: PAGE_SIZE, offset: 0 });
        setPosts(data.posts);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load blog posts');
      } finally {
        setLoading(false);
      }
    }

    fetchBlogPosts();
  }, []);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await listBlogPosts({ limit: PAGE_SIZE, offset: posts.length });
      setPosts((prev) => [...prev, ...data.posts]);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more blog posts');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleBlogPostClick = (slug: string) => {
    navigate(`/blog/${slug}`);
  };

  return (
    <div className="body-layout">
      <SEO
        title="Blog"
        description="Read field notes, collection highlights, and essays from Letter Archive as the project grows."
        canonicalUrl="/blog"
      />
      <div className="updates-page">
        <header className="updates-hero">
          <p className="updates-kicker">Blog</p>
          <h1 className="updates-headline">Stories from the Archive</h1>
          <p className="updates-subtitle">
            Essays, project notes, collection highlights, and the occasional oddity
            uncovered while preserving personal correspondence.
          </p>
        </header>

        {loading && <p className="loading-message">Loading blog posts...</p>}
        {error && <p className="error-message">{error}</p>}

        {!loading && posts.length === 0 && !error && (
          <div className="no-results">
            <p>No blog posts yet. Check back soon.</p>
          </div>
        )}

        {posts.length > 0 && (
          <div className="updates-grid">
            {posts.map((post) => (
              <article
                key={post.id}
                className="update-card"
                onClick={() => handleBlogPostClick(post.slug)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleBlogPostClick(post.slug);
                  }
                }}
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
                  {post.excerpt && (
                    <p className="update-card-excerpt">{post.excerpt}</p>
                  )}
                  <div className="update-card-footer">
                    {post.authorDisplayName && (
                      <span className="update-author">{post.authorDisplayName}</span>
                    )}
                    <span className="update-card-cta">Read more &rarr;</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {posts.length < total && (
          <div className="updates-load-more">
            <button
              className="btn-card"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading...' : 'Load more posts'}
            </button>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
