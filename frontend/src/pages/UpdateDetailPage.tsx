import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import SEO from '../components/SEO';
import { getBlogPost, getImageUrl, type BlogPost } from '../api/client';
import Footer from '../components/Footer/Footer';
import { buildBlogPostSeo, stripMarkdown, truncateText } from '../utils/seo';
import { formatDate } from '../utils/dateFormatting';
import './UpdateDetailPage.css';

const MARKDOWN_COMPONENTS: import('react-markdown').Components = {
  img({ alt, src, title }) {
    if (!src) return null;
    const resolvedSrc = (src.startsWith('/images/') || src.startsWith('/blog-images/'))
      ? getImageUrl(src)
      : src;
    return (
      <img
        className="markdown-inline-image"
        src={resolvedSrc}
        alt={alt || ''}
        title={title || undefined}
        loading="lazy"
      />
    );
  },
  a({ href, children, ...props }) {
    let resolvedHref = href || '';
    if (resolvedHref && !/^(https?:\/\/|mailto:|tel:|\/|#)/.test(resolvedHref)) {
      resolvedHref = `https://${resolvedHref}`;
    }
    const isExternal = /^https?:\/\//.test(resolvedHref);
    return (
      <a
        href={resolvedHref}
        {...props}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="markdown-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export default function BlogDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchBlogPost() {
      try {
        const data = await getBlogPost(slug!);
        if (!cancelled) setPost(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Journal entry not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBlogPost();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div className="body-layout">
        <div className="update-detail">
          <p className="loading-message">Loading journal entry...</p>
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
            &larr; All Journal Entries
          </Link>
          <h1>Journal Entry Not Found</h1>
          <p className="error-text">
            {error || 'This journal entry does not exist or is no longer published.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const seo = buildBlogPostSeo(post);
  const deck = post.excerpt || truncateText(stripMarkdown(post.bodyMarkdown), 280);
  const publishedDate = post.publishedAt || post.createdAt;

  return (
    <div className="body-layout">
      <SEO
        title={seo.title}
        description={seo.description}
        canonicalUrl={seo.canonicalPath}
        ogType={seo.ogType}
        ogImage={seo.ogImage}
        imageAlt={seo.imageAlt}
        publishedTime={seo.publishedTime}
        modifiedTime={seo.modifiedTime}
        jsonLd={seo.jsonLd}
      />
      <article className="update-detail">
        {post.heroImageUrl && (
          <div className="update-hero-image">
            <img
              src={getImageUrl(post.heroImageUrl)}
              alt={post.heroImageAlt || post.title}
            />
          </div>
        )}

        <header className="update-header">
          <h1 className="update-title">{post.title}</h1>
          {post.authorDisplayName && (
            <p className="update-byline">Written by {post.authorDisplayName}</p>
          )}
          <time className="update-date" dateTime={publishedDate}>{formatDate(publishedDate)}</time>
          {deck && <p className="update-dek">{deck}</p>}
        </header>

        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
            components={MARKDOWN_COMPONENTS}
          >
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

      </article>
      <Footer />
    </div>
  );
}
