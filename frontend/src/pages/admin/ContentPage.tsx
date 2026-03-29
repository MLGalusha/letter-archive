import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import { getAdminLetters } from '../../api/letters';
import {
  adminListBlogPosts,
  adminPublishBlogPost,
  adminUnpublishBlogPost,
  adminDeleteBlogPost,
  adminListContentPages,
  adminGetFeaturedLetter,
  adminSetFeaturedLetter,
  type BlogPost,
  type ContentPage as ContentPageType,
} from '../../api/admin/content';
import { resolveBlocks } from '../../content/blockMigration';
import type { ContentBlock } from '../../content/blocks';
import { useToast } from '../../contexts/ToastContext';
import './ContentPage.css';

type TabKey = 'blog' | 'pages' | 'featured';

// ── Helpers ──────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ══════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════

export default function ContentPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('blog');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'blog', label: 'Journal' },
    { key: 'pages', label: 'Pages' },
    { key: 'featured', label: 'Featured' },
  ];

  return (
    <AdminLayout>
      <div className="content-page">
        <div className="content-page-header">
          <div className="content-page-kicker">Administration</div>
          <h1 className="content-page-title">Content</h1>
          <p className="content-page-subtitle">
            Manage journal entries, static page content, and the featured letter.
          </p>
        </div>

        <div className="content-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`content-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'blog' && <BlogTab />}
        {activeTab === 'pages' && <PagesTab />}
        {activeTab === 'featured' && <FeaturedTab />}
      </div>
    </AdminLayout>
  );
}

// ══════════════════════════════════════════════════════════
// Blog Tab
// ══════════════════════════════════════════════════════════

function BlogTab() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchBlogPosts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminListBlogPosts({ limit: 100, offset: 0 });
      setPosts(data.posts);
      setTotal(data.total);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load journal entries.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlogPosts();
  }, [fetchBlogPosts]);

  const handleTogglePublish = async (post: BlogPost) => {
    setActionLoading(post.id);
    try {
      if (post.status === 'published') {
        await adminUnpublishBlogPost(post.id);
        showToast('Journal entry unpublished.', 'success');
      } else {
        await adminPublishBlogPost(post.id);
        showToast('Journal entry published.', 'success');
      }
      await fetchBlogPosts();
    } catch (err) {
      showToast(getErrorMessage(err, 'Action failed.'), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (post: BlogPost) => {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    setActionLoading(post.id);
    try {
      await adminDeleteBlogPost(post.id);
      showToast('Journal entry deleted.', 'success');
      await fetchBlogPosts();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to delete.'), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div className="content-loading">Loading journal entries...</div>;
  }

  return (
    <div className="content-section">
      <div className="content-section-header">
        <span className="content-section-count">{total} journal entr{total !== 1 ? 'ies' : 'y'}</span>
        <Button
          variant="primary"
          size="sm"
          icon="plus"
          onClick={() => navigate('/admin/content/blog/new')}
        >
          New Journal Entry
        </Button>
      </div>

      {error && <div className="content-error">{error}</div>}

      {posts.length === 0 ? (
        <div className="content-empty">
          <div className="content-empty-icon">
            <Icon name="file" size={40} />
          </div>
          <p className="content-empty-title">No journal entries yet</p>
          <p className="content-empty-desc">
            Create your first journal entry to share updates with visitors.
          </p>
        </div>
      ) : (
        <div className="updates-table-wrap">
          <table className="updates-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Category</th>
                <th>Author</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr
                  key={post.id}
                  className="updates-row"
                  onClick={() => navigate(`/admin/content/blog/${post.id}`)}
                >
                  <td className="updates-title-cell">
                    <span className="updates-title-text">{post.title}</span>
                    {post.excerpt && (
                      <span className="updates-excerpt">{post.excerpt}</span>
                    )}
                  </td>
                  <td>
                    <span className={`updates-status-badge ${post.status}`}>
                      {post.status}
                    </span>
                  </td>
                  <td className="updates-category-cell">
                    {post.category || <span className="text-muted">--</span>}
                  </td>
                  <td className="updates-author-cell">
                    {post.authorDisplayName || <span className="text-muted">--</span>}
                  </td>
                  <td className="updates-date-cell">
                    {post.publishedAt
                      ? formatDate(post.publishedAt)
                      : formatDate(post.createdAt)}
                  </td>
                  <td className="updates-actions-cell" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="updates-action-btn"
                      title={post.status === 'published' ? 'Unpublish' : 'Publish'}
                      disabled={actionLoading === post.id}
                      onClick={() => handleTogglePublish(post)}
                    >
                      <Icon name={post.status === 'published' ? 'eye-off' : 'eye'} size={16} />
                    </button>
                    {post.status === 'draft' && (
                      <button
                        className="updates-action-btn danger"
                        title="Delete"
                        disabled={actionLoading === post.id}
                        onClick={() => handleDelete(post)}
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Pages Tab
// ══════════════════════════════════════════════════════════

const PAGE_SLUGS = ['about', 'support'] as const;
const PAGE_META: Record<string, { title: string; kicker: string; description: string; publicPath: string }> = {
  about: {
    title: 'About',
    kicker: 'Page Editor',
    description: 'Shape the archive story, explain the preservation process, and invite visitors to explore.',
    publicPath: '/about',
  },
  support: {
    title: 'Support',
    kicker: 'Page Editor',
    description: 'Tune the fundraising story, clarify contribution paths, and make every contact route feel intentional.',
    publicPath: '/support',
  },
};

function getHeroText(blocks: ContentBlock[]): { heading: string; subtitle: string } {
  const hero = blocks.find((b) => b.type === 'hero');
  if (hero && hero.type === 'hero') return { heading: hero.heading, subtitle: hero.subtitle };
  return { heading: '', subtitle: '' };
}

function PagesTab() {
  const navigate = useNavigate();
  const [pages, setPages] = useState<ContentPageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminListContentPages();
      setPages(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load pages.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  if (loading) {
    return <div className="content-loading">Loading pages...</div>;
  }

  const pagesBySlug = new Map(pages.map((p) => [p.slug, p]));

  return (
    <div className="content-section">
      {error && <div className="content-error">{error}</div>}

      <div className="pages-overview-grid">
        {PAGE_SLUGS.map((slug) => {
          const dbPage = pagesBySlug.get(slug);
          const meta = PAGE_META[slug];
          const blocks = resolveBlocks(slug, dbPage?.contentJson);
          const hero = getHeroText(blocks);

          return (
            <article key={slug} className={`page-overview-card page-overview-card--${slug}`}>
              <div className="page-overview-top">
                <div>
                  <span className="page-overview-kicker">{meta.kicker}</span>
                  <h3 className="page-overview-title">{meta.title}</h3>
                </div>
                <span className="page-overview-route">{meta.publicPath}</span>
              </div>

              <p className="page-overview-description">{meta.description}</p>

              <div className="page-overview-preview">
                <strong>{hero.heading || meta.title}</strong>
                <p>{hero.subtitle}</p>
              </div>

              <div className="page-overview-metrics">
                <div>
                  <span>Blocks</span>
                  <strong>{blocks.length}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{dbPage ? formatDateTime(dbPage.updatedAt) : 'Defaults'}</strong>
                </div>
              </div>

              <div className="page-overview-actions">
                <Button
                  variant="primary"
                  size="sm"
                  icon="edit"
                  onClick={() => navigate(`/admin/content/pages/${slug}`)}
                >
                  Edit {meta.title}
                </Button>
                <button
                  type="button"
                  className="page-overview-secondary"
                  onClick={() => window.open(meta.publicPath, '_blank', 'noopener,noreferrer')}
                >
                  View live page
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Featured Tab
// ══════════════════════════════════════════════════════════

interface LetterSearchResult {
  id: string;
  sender: string | null;
  recipient: string | null;
  letterDate: string | null;
  collectionCode: string;
}

function FeaturedTab() {
  const { showToast } = useToast();
  const [featuredData, setFeaturedData] = useState<{
    letter_id: string | null;
    letter?: any;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LetterSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchFeatured = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminGetFeaturedLetter();
      setFeaturedData(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load featured letter.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatured();
  }, [fetchFeatured]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await getAdminLetters({
          search: searchQuery.trim(),
          limit: 10,
          page: 1,
        });
        setSearchResults(
          data.letters.map((l: any) => ({
            id: l.id,
            sender: l.sender,
            recipient: l.recipient,
            letterDate: l.letterDate || null,
            collectionCode: l.collectionCode || '',
          })),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSetFeatured = async (letterId: string) => {
    setSaving(true);
    try {
      await adminSetFeaturedLetter(letterId);
      showToast('Featured letter updated.', 'success');
      setSearchQuery('');
      setSearchResults([]);
      await fetchFeatured();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to set featured letter.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClearFeatured = async () => {
    if (!window.confirm('Clear the featured letter? The homepage will not show a featured section.')) {
      return;
    }
    setSaving(true);
    try {
      // Set to empty string to clear
      await adminSetFeaturedLetter('');
      showToast('Featured letter cleared.', 'success');
      await fetchFeatured();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to clear featured letter.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="content-loading">Loading featured letter...</div>;
  }

  const featured = featuredData?.letter;

  return (
    <div className="content-section">
      {error && <div className="content-error">{error}</div>}

      {/* Current featured letter */}
      <div className="featured-current">
        <h3 className="featured-section-title">Current Featured Letter</h3>
        {featured ? (
          <div className="featured-letter-card">
            <div className="featured-letter-info">
              <div className="featured-letter-id">
                <Link to={`/admin/letters/${featuredData?.letter_id}`}>
                  {featuredData?.letter_id?.slice(0, 12)}...
                </Link>
              </div>
              {featured.sender && (
                <div className="featured-letter-detail">
                  <strong>From:</strong> {featured.sender}
                </div>
              )}
              {featured.recipient && (
                <div className="featured-letter-detail">
                  <strong>To:</strong> {featured.recipient}
                </div>
              )}
              {featured.letterDate && (
                <div className="featured-letter-detail">
                  <strong>Date:</strong> {featured.letterDate}
                </div>
              )}
              {featured.hook && (
                <div className="featured-letter-hook">{featured.hook}</div>
              )}
            </div>
            <Button
              variant="danger"
              size="sm"
              loading={saving}
              onClick={handleClearFeatured}
            >
              Clear Featured
            </Button>
          </div>
        ) : (
          <div className="featured-empty">
            <p>No featured letter set. The homepage featured section will be hidden.</p>
          </div>
        )}
      </div>

      {/* Search to pick a new featured letter */}
      <div className="featured-picker">
        <h3 className="featured-section-title">Select Featured Letter</h3>
        <p className="featured-picker-desc">
          Search by letter ID, sender, or recipient to find a letter.
        </p>

        <input
          type="text"
          className="featured-search-input"
          placeholder="Search letters..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {searching && (
          <div className="featured-searching">Searching...</div>
        )}

        {searchResults.length > 0 && (
          <div className="featured-results">
            {searchResults.map((letter) => (
              <div key={letter.id} className="featured-result-row">
                <div className="featured-result-info">
                  <span className="featured-result-id">{letter.id.slice(0, 12)}...</span>
                  <span className="featured-result-meta">
                    {letter.sender || '?'} &rarr; {letter.recipient || '?'}
                    {letter.collectionCode && ` (${letter.collectionCode})`}
                  </span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  loading={saving}
                  onClick={() => handleSetFeatured(letter.id)}
                >
                  Set Featured
                </Button>
              </div>
            ))}
          </div>
        )}

        {searchQuery.trim() && !searching && searchResults.length === 0 && (
          <div className="featured-no-results">No letters found.</div>
        )}
      </div>
    </div>
  );
}
