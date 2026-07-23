import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '../components/SEO';
import { listBlogPosts, getImageUrl, type BlogPost } from '../api/client';
import Footer from '../components/Footer/Footer';
import { buildBlogIndexSeo, stripMarkdown, truncateText } from '../utils/seo';
import { saveJournalSort, loadJournalSort } from '../utils/searchPersistence';
import { formatDate } from '../utils/dateFormatting';
import './UpdatesPage.css';

const PAGE_SIZE = 12;

type SortField = 'date' | 'title' | 'author';
type SortOrder = 'asc' | 'desc';

const SORT_OPTIONS: { field: SortField; label: string; defaultOrder: SortOrder }[] = [
  { field: 'date', label: 'Date', defaultOrder: 'desc' },
  { field: 'title', label: 'Title', defaultOrder: 'asc' },
  { field: 'author', label: 'Author', defaultOrder: 'asc' },
];

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

  const savedSort = loadJournalSort();
  const [sortField, setSortField] = useState<SortField>(
    (savedSort?.field as SortField) || 'date',
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    (savedSort?.order as SortOrder) || 'desc',
  );
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortOpen) return;
    const close = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sortOpen]);

  useEffect(() => {
    saveJournalSort(sortField, sortOrder);
  }, [sortField, sortOrder]);

  useEffect(() => {
    async function fetchBlogPosts() {
      setLoading(true);
      try {
        const data = await listBlogPosts({
          limit: PAGE_SIZE,
          offset: (currentPage - 1) * PAGE_SIZE,
          sort: sortField,
          sortOrder,
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
  }, [currentPage, sortField, sortOrder]);

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
          <div className="updates-hero-bottom">
            <div className="updates-sort" ref={sortRef} onKeyDown={(e) => { if (e.key === 'Escape') setSortOpen(false); }}>
              <button
                type="button"
                className="sort-trigger"
                onClick={() => setSortOpen((o) => !o)}
                aria-expanded={sortOpen}
                aria-label="Sort journal entries"
              >
                <span>{SORT_OPTIONS.find((o) => o.field === sortField)!.label}</span>
                <span className="sort-indicators">
                  <span className="sort-arrow">{sortOrder === 'asc' ? '\u2191' : '\u2193'}</span>
                  <svg className={`sort-chevron${sortOpen ? ' sort-chevron--open' : ''}`} width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
                    <path d="M0 0l4 5 4-5z" fill="currentColor" />
                  </svg>
                </span>
              </button>
              <ul
                className={`sort-menu${sortOpen ? '' : ' sort-menu--hidden'}`}
                role="listbox"
              >
                {SORT_OPTIONS.map((opt) => {
                  const isActive = sortField === opt.field;
                  return (
                    <li
                      key={opt.field}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={0}
                      className={`sort-option${isActive ? ' sort-option--active' : ''}`}
                      onClick={() => {
                        if (isActive) {
                          setSortOrder((o) => o === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortField(opt.field);
                          setSortOrder(opt.defaultOrder);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (isActive) {
                            setSortOrder((o) => o === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortField(opt.field);
                            setSortOrder(opt.defaultOrder);
                          }
                        }
                      }}
                    >
                      <span>{opt.label}</span>
                      {isActive && <span className="sort-arrow">{sortOrder === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </header>

        {loading && <p className="loading-message">Loading journal entries...</p>}
        {error && <p className="error-message">{error}</p>}

        {!loading && posts.length === 0 && !error && (
          <div className="no-results">
            <p>No journal entries yet. Check back soon.</p>
          </div>
        )}

        {!loading && posts.length > 0 && (
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
                      src={getImageUrl(post.heroImageUrl)}
                      alt={post.heroImageAlt || post.title}
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="update-card-body">
                  <h2 className="update-card-title">{post.title}</h2>
                  <span className="update-date">
                    {formatDate(post.publishedAt || post.createdAt)}
                  </span>
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
