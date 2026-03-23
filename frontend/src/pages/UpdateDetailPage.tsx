import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import SEO from '../components/SEO';
import { getBlogPost, type BlogPost } from '../api/client';
import Footer from '../components/Footer/Footer';
import './UpdateDetailPage.css';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BlogDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    async function fetchBlogPost() {
      try {
        const data = await getBlogPost(slug!);
        setPost(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Blog post not found');
      } finally {
        setLoading(false);
      }
    }

    fetchBlogPost();
  }, [slug]);

  if (loading) {
    return (
      <div className="body-layout">
        <div className="update-detail">
          <p className="loading-message">Loading blog post...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!post || error) {
    return (
      <div className="body-layout">
        <div className="update-detail">
          <Link to="/blog" className="update-back-link">
            &larr; All Blog Posts
          </Link>
          <h1>Blog Post Not Found</h1>
          <p className="error-text">
            {error || 'This blog post does not exist or is no longer published.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const seoTitle = post.seoTitle || post.title;
  const seoDescription = post.seoDescription || post.excerpt || `Read "${post.title}" on Letter Archive.`;
  const publishedDate = post.publishedAt || post.createdAt;

  return (
    <div className="body-layout">
      <SEO
        title={seoTitle}
        description={seoDescription}
        canonicalUrl={`/blog/${post.slug}`}
        ogType="article"
        ogImage={post.heroImageUrl || undefined}
      />
      <article className="update-detail">
        <Link to="/blog" className="update-back-link">
          &larr; All Blog Posts
        </Link>

        {post.heroImageUrl && (
          <div className="update-hero-image">
            <img
              src={post.heroImageUrl}
              alt={post.heroImageAlt || post.title}
            />
          </div>
        )}

        <header className="update-header">
          <div className="update-meta">
            {post.category && (
              <span className="update-detail-category">{post.category}</span>
            )}
            <time dateTime={publishedDate}>{formatDate(publishedDate)}</time>
          </div>
          <h1 className="update-title">{post.title}</h1>
          {(post.authorDisplayName || post.authorRole) && (
            <p className="update-byline">
              {post.authorDisplayName}
              {post.authorRole && (
                <span className="update-byline-role"> &middot; {post.authorRole}</span>
              )}
            </p>
          )}
        </header>

        <div className="markdown-content">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {post.bodyMarkdown}
          </ReactMarkdown>
        </div>

        {post.ctaLabel && post.ctaUrl && (
          <div className="update-cta">
            <a
              href={post.ctaUrl}
              className="btn-card update-cta-btn"
              target={post.ctaUrl.startsWith('http') ? '_blank' : undefined}
              rel={post.ctaUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {post.ctaLabel}
            </a>
          </div>
        )}

        <div className="update-footer-nav">
          <Link to="/blog" className="update-back-link">
            &larr; Back to all blog posts
          </Link>
        </div>
      </article>
      <Footer />
    </div>
  );
}
