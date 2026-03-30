import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { ApiError, getErrorMessage, getImageUrl } from '../../api/client';
import {
  adminListBlogPosts,
  adminPublishBlogPost,
  adminUnpublishBlogPost,
  adminDeleteBlogPost,
  adminGetContentPage,
  adminUpdateContentPage,
  adminGetFeaturedLetter,
  adminSetFeaturedLetter,
  adminClearFeaturedLetter,
  type BlogPost,
  type AdminFeaturedLetterResponse,
} from '../../api/admin/content';
import { searchArchiveShelf } from '../../api/letters';
import type { ArchiveShelfItem } from '../../types/Letter';
import { listCollections, type CollectionInfo } from '../../api/collections';
import { useSiteSettings } from '../../hooks/useSiteSettings';
import type { ContentBlock } from '../../content/blocks';
import { getDefaultBlocks } from '../../content/defaultBlocks';
import { resolveBlocks } from '../../content/blockMigration';
import BlockRenderer from '../../components/BlockRenderer/BlockRenderer';
import Editable from '../../components/BlockRenderer/Editable';
import { useToast } from '../../contexts/ToastContext';
import '../../components/BlockRenderer/BlockRenderer.css';
import './BlockEditorPage.css';
import './ContentPage.css';

type TabKey = 'journal' | 'homepage' | 'about' | 'support';

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

function formatSavedTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Saved';
  return `Saved ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
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

const PAGE_CONFIG: Record<string, { title: string; publicPath: string; className: string }> = {
  about: { title: 'About', publicPath: '/about', className: 'about-page' },
  support: { title: 'Support', publicPath: '/support', className: 'support-page' },
};

export default function ContentPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('journal');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'journal', label: 'Journal' },
    { key: 'homepage', label: 'Homepage' },
    { key: 'about', label: 'About' },
    { key: 'support', label: 'Support' },
  ];

  const isPageEditor = activeTab === 'about' || activeTab === 'support';

  return (
    <AdminLayout>
      <div className="pub-shell">
        <div className="pub-tabs-bar">
          <div className="pub-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`pub-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className={`pub-page ${isPageEditor ? 'pub-page--editor' : ''}`}>
          {activeTab === 'journal' && <JournalTab />}
          {activeTab === 'homepage' && <HomepageTab />}
          {activeTab === 'about' && <PageEditorTab slug="about" />}
          {activeTab === 'support' && <PageEditorTab slug="support" />}
        </div>
      </div>
    </AdminLayout>
  );
}

// ══════════════════════════════════════════════════════════
// Journal Tab
// ══════════════════════════════════════════════════════════

function JournalTab() {
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

  const handleTogglePublish = async (e: React.MouseEvent, post: BlogPost) => {
    e.stopPropagation();
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

  const handleDelete = async (e: React.MouseEvent, post: BlogPost) => {
    e.stopPropagation();
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
    return <div className="pub-loading">Loading journal entries...</div>;
  }

  return (
    <div className="pub-section">
      <div className="pub-section-header">
        <span className="pub-section-count">{total} journal entr{total !== 1 ? 'ies' : 'y'}</span>
        <Button
          variant="primary"
          size="sm"
          icon="plus"
          onClick={() => navigate('/admin/content/blog/new')}
        >
          New Entry
        </Button>
      </div>

      {error && <div className="pub-error">{error}</div>}

      {posts.length === 0 ? (
        <div className="pub-empty">
          <Icon name="file" size={36} />
          <p className="pub-empty-title">No journal entries yet</p>
          <p className="pub-empty-desc">
            Create your first journal entry to share updates with visitors.
          </p>
        </div>
      ) : (
        <div className="jn-list">
          {posts.map((post) => (
            <div
              key={post.id}
              className="jn-card"
              onClick={() => navigate(`/admin/content/blog/${post.id}`)}
            >
              <div className="jn-card-body">
                <div className="jn-card-top">
                  <h3 className="jn-card-title">{post.title}</h3>
                  <span className={`jn-status ${post.status}`}>
                    {post.status}
                  </span>
                </div>
                {post.excerpt && (
                  <p className="jn-card-excerpt">{post.excerpt}</p>
                )}
                <div className="jn-card-meta">
                  {post.category && <span className="jn-category">{post.category}</span>}
                  <span className="jn-author">{post.authorDisplayName || 'Unknown'}</span>
                  <span className="jn-date">
                    {post.publishedAt ? formatDate(post.publishedAt) : formatDate(post.createdAt)}
                  </span>
                </div>
              </div>
              <div className="jn-card-actions">
                <button
                  className="pub-icon-btn"
                  title={post.status === 'published' ? 'Unpublish' : 'Publish'}
                  disabled={actionLoading === post.id}
                  onClick={(e) => handleTogglePublish(e, post)}
                >
                  <Icon name={post.status === 'published' ? 'eye-off' : 'eye'} size={16} />
                </button>
                {post.status === 'draft' && (
                  <button
                    className="pub-icon-btn danger"
                    title="Delete"
                    disabled={actionLoading === post.id}
                    onClick={(e) => handleDelete(e, post)}
                  >
                    <Icon name="delete" size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Homepage Tab
// ══════════════════════════════════════════════════════════

interface HeroContent {
  kicker: string;
  heading: string;
  subtitle: string;
}

const DEFAULT_HERO: HeroContent = {
  kicker: 'Real Letters, Real Lives',
  heading:
    'Follow real lives through letters, telegrams, photographs, and the paper trail they left behind.',
  subtitle:
    'Search names, places, dates, and remembered phrases across the archive, or open a collection to stay inside one family, one romance, or one moment at a time.',
};

/* ── Letter Picker (search & select) ── */

function LetterPicker({
  onSelect,
  onClose,
}: {
  onSelect: (letterId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArchiveShelfItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchArchiveShelf({ search: query.trim(), limit: 8, verified: true });
        setResults(res.letters);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div className="fl-picker">
      <div className="fl-picker-header">
        <input
          ref={inputRef}
          className="fl-picker-input"
          type="text"
          placeholder="Search letters by name, date, or keyword..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="pub-icon-btn" onClick={onClose} title="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      {searching && <div className="fl-picker-status">Searching...</div>}
      {!searching && query.trim() && results.length === 0 && (
        <div className="fl-picker-status">No published letters found</div>
      )}
      {results.length > 0 && (
        <div className="fl-picker-results">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="fl-picker-item"
              onClick={() => onSelect(item.id)}
            >
              {item.imageUrl && (
                <img
                  className="fl-picker-thumb"
                  src={getImageUrl(item.imageUrl, { width: 80 })}
                  alt=""
                />
              )}
              <div className="fl-picker-info">
                <span className="fl-picker-people">
                  {[item.sender, item.recipient].filter(Boolean).join(' \u2192 ') || 'Unknown'}
                </span>
                {item.date && <span className="fl-picker-date">{item.date}</span>}
                {item.hook && <span className="fl-picker-hook">{item.hook}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HomepageTab() {
  const { showToast } = useToast();

  // ── Hero text content ──
  const [hero, setHero] = useState<HeroContent>(DEFAULT_HERO);
  const [heroLoading, setHeroLoading] = useState(true);
  const [heroSaving, setHeroSaving] = useState(false);
  const [heroUpdatedAt, setHeroUpdatedAt] = useState<string | null>(null);

  // ── Featured letter ──
  const [featured, setFeatured] = useState<AdminFeaturedLetterResponse | null>(null);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [featuredSaving, setFeaturedSaving] = useState(false);

  // Load hero text + featured letter in parallel
  useEffect(() => {
    (async () => {
      try {
        const page = await adminGetContentPage('home');
        const json = page.contentJson as { hero?: HeroContent };
        if (json?.hero) {
          setHero({
            kicker: json.hero.kicker || DEFAULT_HERO.kicker,
            heading: json.hero.heading || DEFAULT_HERO.heading,
            subtitle: json.hero.subtitle || DEFAULT_HERO.subtitle,
          });
        }
        setHeroUpdatedAt(page.updatedAt);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          showToast(getErrorMessage(err, 'Failed to load homepage content.'), 'error');
        }
      } finally {
        setHeroLoading(false);
      }
    })();

    (async () => {
      try {
        const data = await adminGetFeaturedLetter();
        setFeatured(data);
      } catch {
        // no featured letter available
      } finally {
        setFeaturedLoading(false);
      }
    })();
  }, [showToast]);

  const saveHero = async () => {
    setHeroSaving(true);
    try {
      const saved = await adminUpdateContentPage('home', {
        title: 'Homepage',
        contentJson: { hero },
      });
      setHeroUpdatedAt(saved.updatedAt);
      showToast('Homepage updated.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save homepage.'), 'error');
    } finally {
      setHeroSaving(false);
    }
  };

  const handleSelectFeatured = async (letterId: string) => {
    setFeaturedSaving(true);
    setPickerOpen(false);
    try {
      await adminSetFeaturedLetter(letterId);
      const data = await adminGetFeaturedLetter();
      setFeatured(data);
      showToast('Featured letter updated.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to set featured letter.'), 'error');
    } finally {
      setFeaturedSaving(false);
    }
  };

  const handleClearFeatured = async () => {
    setFeaturedSaving(true);
    try {
      await adminClearFeaturedLetter();
      // Re-fetch to get the new auto-pick
      const data = await adminGetFeaturedLetter();
      setFeatured(data);
      showToast('Featured letter reset to auto-selection.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to clear featured letter.'), 'error');
    } finally {
      setFeaturedSaving(false);
    }
  };

  const fl = featured?.letter;
  const flPeopleLine = fl
    ? [fl.sender, fl.recipient].filter(Boolean).join(' \u2192 ')
    : null;
  const flDate = fl?.letterDate || fl?.dateRaw || null;

  return (
    <div className="pub-section pub-homepage-tab">
      {/* ── Hero Section ── */}
      <div className="hp-hero-section">
        <div className="hp-hero-header">
          <h3 className="hp-section-title">Hero Section</h3>
          <div className="hp-hero-actions">
            {heroUpdatedAt && (
              <span className="hp-save-state">
                Updated {formatDateTime(heroUpdatedAt)}
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              icon="save"
              loading={heroSaving}
              disabled={heroLoading}
              onClick={() => void saveHero()}
            >
              Update
            </Button>
            <a
              className="hp-view-link"
              href="/"
              target="_blank"
              rel="noopener noreferrer"
            >
              View live &rarr;
            </a>
          </div>
        </div>

        {heroLoading ? (
          <div className="pub-loading">Loading...</div>
        ) : (
          <div className="hp-hero-preview">
            <div className="hp-hero-card">
              <Editable
                value={hero.kicker}
                editable
                onChange={(v) => setHero((h) => ({ ...h, kicker: v }))}
                tag="p"
                className="hp-kicker"
                placeholder="Kicker text"
              />
              <Editable
                value={hero.heading}
                editable
                multiline
                onChange={(v) => setHero((h) => ({ ...h, heading: v }))}
                tag="h1"
                className="hp-headline"
                placeholder="Main headline"
              />
              <Editable
                value={hero.subtitle}
                editable
                multiline
                onChange={(v) => setHero((h) => ({ ...h, subtitle: v }))}
                tag="p"
                className="hp-subtitle"
                placeholder="Subtitle text"
              />
              <div className="hp-hero-buttons-preview">
                <span className="hp-btn-preview hp-btn-preview--primary">Search the Archive</span>
                <span className="hp-btn-preview hp-btn-preview--secondary">Browse Collections</span>
                <span className="hp-btn-preview hp-btn-preview--text">Read the Journal &rarr;</span>
              </div>
            </div>

            {/* ── Featured Letter Card ── */}
            <div className="hp-featured-section">
              {featuredLoading ? (
                <div className="hp-hero-feature-placeholder">
                  <span>Featured Letter</span>
                  <p>Loading...</p>
                </div>
              ) : fl ? (
                <div className="fl-card">
                  {fl.imageUrl && (
                    <img
                      className="fl-card-image"
                      src={getImageUrl(fl.imageUrl, { width: 600 })}
                      alt=""
                    />
                  )}
                  <div className="fl-card-overlay" />
                  <div className="fl-card-label">
                    <span className="fl-card-label-title">Featured Letter</span>
                    <span className={`fl-card-source fl-card-source--${featured?.source}`}>
                      {featured?.source === 'manual' ? 'Manual' : 'Auto'}
                    </span>
                  </div>
                  <div className="fl-card-content">
                    {flPeopleLine && <div className="fl-card-people">{flPeopleLine}</div>}
                    {flDate && <div className="fl-card-date">{flDate}</div>}
                    {fl.hook && <p className="fl-card-hook">{fl.hook}</p>}
                  </div>
                  <div className="fl-card-actions">
                    <button
                      type="button"
                      className="fl-action-btn"
                      onClick={() => setPickerOpen(true)}
                      disabled={featuredSaving}
                    >
                      Change
                    </button>
                    {featured?.source === 'manual' && (
                      <button
                        type="button"
                        className="fl-action-btn fl-action-btn--secondary"
                        onClick={() => void handleClearFeatured()}
                        disabled={featuredSaving}
                      >
                        Auto-select
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="hp-hero-feature-placeholder">
                  <span>Featured Letter</span>
                  <p>No published letters available</p>
                  <button
                    type="button"
                    className="fl-action-btn"
                    style={{ marginTop: '0.5rem' }}
                    onClick={() => setPickerOpen(true)}
                  >
                    Choose one
                  </button>
                </div>
              )}

              {pickerOpen && (
                <LetterPicker
                  onSelect={(id) => void handleSelectFeatured(id)}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Page Editor Tab (About / Support) — embedded block editor
// ══════════════════════════════════════════════════════════

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function PageEditorTab({ slug }: { slug: string }) {
  const config = PAGE_CONFIG[slug];
  const { showToast } = useToast();
  const siteSettings = useSiteSettings();

  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<{ letters: number; collections: number } | null>(null);

  // ── Load ──
  const loadPage = useCallback(async () => {
    if (!config) return;
    try {
      setLoading(true);
      setError(null);
      const page = await adminGetContentPage(slug);
      setBlocks(resolveBlocks(slug, page.contentJson));
      setUpdatedAt(page.updatedAt);
      setSaveState('saved');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setBlocks(getDefaultBlocks(slug));
        setUpdatedAt(null);
        setSaveState('idle');
      } else {
        setError(getErrorMessage(err, 'Failed to load page.'));
      }
    } finally {
      setLoading(false);
    }
  }, [config, slug]);

  useEffect(() => { void loadPage(); }, [loadPage]);

  // Fetch live stats for about page
  useEffect(() => {
    if (slug !== 'about') return;
    listCollections()
      .then((collections: CollectionInfo[]) => {
        const visible = collections.filter((c) => (c.letterCount || 0) > 0);
        const letters = visible.reduce((sum, c) => sum + (c.letterCount || 0), 0);
        setLiveStats({ collections: visible.length, letters });
      })
      .catch(() => {});
  }, [slug]);

  // ── Save ──
  const persistPage = useCallback(async () => {
    if (!config) return;
    setSaveState('saving');
    try {
      const saved = await adminUpdateContentPage(slug, {
        title: config.title,
        contentJson: { blocks },
      });
      setUpdatedAt(saved.updatedAt);
      setSaveState('saved');
      showToast(`${config.title} page updated.`, 'success');
    } catch (err) {
      setSaveState('error');
      showToast(getErrorMessage(err, 'Failed to update.'), 'error');
    }
  }, [blocks, config, showToast, slug]);

  // ── Block change ──
  const handleBlockChange = useCallback((blockId: string, patch: Partial<ContentBlock>) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...patch } as ContentBlock : b)),
    );
  }, []);

  // ── Reset ──
  const handleReset = useCallback(() => {
    if (!window.confirm('Reset all text to defaults? Your current edits will be replaced.')) return;
    setBlocks(getDefaultBlocks(slug));
  }, [slug]);

  if (!config) return null;

  const saveLabel = saveState === 'saving'
    ? 'Updating\u2026'
    : saveState === 'error'
      ? 'Update failed'
      : updatedAt
        ? formatSavedTime(updatedAt)
        : '';

  if (loading) {
    return <div className="pub-loading">Loading {config.title.toLowerCase()} page...</div>;
  }

  return (
    <div className="pub-section pub-editor-tab">
      {/* ── Inline toolbar ── */}
      <div className="pe-toolbar">
        {saveLabel && (
          <span className={`pe-save-state ${saveState === 'error' ? 'pe-save-error' : ''}`}>
            {saveLabel}
          </span>
        )}
        <button type="button" className="pe-reset-btn" onClick={handleReset}>Reset</button>
        <Button
          variant="primary"
          size="sm"
          icon="save"
          loading={saveState === 'saving'}
          onClick={() => void persistPage()}
        >
          Update
        </Button>
        <a
          className="pe-view-link"
          href={config.publicPath}
          target="_blank"
          rel="noopener noreferrer"
        >
          View &rarr;
        </a>
      </div>

      {error && <div className="pub-error">{error}</div>}

      {/* ── Block editor (uses public page shell for accurate rendering) ── */}
      <div className="public-site-shell be-page-shell pe-shell">
        <div className="body-layout">
          <div
            className={config.className}
            style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
          >
            <BlockRenderer
              blocks={blocks}
              liveStats={liveStats}
              siteSettings={siteSettings}
              editable
              onBlockChange={handleBlockChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
