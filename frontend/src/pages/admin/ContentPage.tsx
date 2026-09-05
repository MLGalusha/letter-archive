import { useState, useEffect, useCallback, useRef, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
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
  type BlogPost,
  type AdminFeaturedLetterResponse,
} from '../../api/admin/content';
import { getLetterById, searchArchiveShelf, type ArchiveSearchResponse } from '../../api/letters';
import type { ArchiveShelfItem, LetterImage } from '../../types/Letter';
import { listCollections, type CollectionInfo } from '../../api/collections';
import { useSiteSettings } from '../../hooks/useSiteSettings';
import type { ContentBlock } from '../../content/blocks';
import { getDefaultBlocks } from '../../content/defaultBlocks';
import { resolveBlocks } from '../../content/blockMigration';
import BlockRenderer from '../../components/BlockRenderer/BlockRenderer';
import Editable from '../../components/BlockRenderer/Editable';
import { useToast } from '../../contexts/ToastContext';
import LetterCard from '../../components/LetterCard/LetterCard';
import { ARCHIVE_FORMAT_LABELS, ARCHIVE_FORMAT_ORDER } from '../../components/SearchBar/searchBarUtils';
import {
  COLLECTION_PICKER_DEFAULT_SORT,
  COLLECTION_PICKER_DEFAULT_SORT_ORDER,
  COLLECTION_PICKER_SORT_OPTIONS,
  getCollectionPickerSortLabel,
  type CollectionPickerFormat,
  type CollectionPickerSortField,
  type CollectionPickerSortOption,
} from './adminCollectionPicker';
import '../../components/BlockRenderer/BlockRenderer.css';
import './BlockEditorPage.css';
import '../HomePage.css';
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

function formatDateParts(yearText: string, monthText: string, dayText: string): string | null {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatFeaturedLetterDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  if (/[A-Za-z]/.test(trimmed)) return trimmed;

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    return formatDateParts(compactMatch[1], compactMatch[2], compactMatch[3]) || trimmed;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return formatDateParts(isoMatch[1], isoMatch[2], isoMatch[3]) || trimmed;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return formatDateParts(slashMatch[3], slashMatch[1], slashMatch[2]) || trimmed;
  }

  return trimmed;
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

const HOMEPAGE_PICKER_LIMIT = 48;
const EMPTY_PICKER_RESULTS: ArchiveSearchResponse = {
  letters: [],
  page: 1,
  limit: HOMEPAGE_PICKER_LIMIT,
  total: 0,
  facets: {
    formats: [],
    collections: [],
    correspondents: [],
    places: [],
    years: [],
    topics: [],
    tones: [],
    relationships: [],
  },
};

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
  const [featuredImages, setFeaturedImages] = useState<LetterImage[]>([]);
  const [featuredPageIndex, setFeaturedPageIndex] = useState(0);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerFormat, setPickerFormat] = useState<CollectionPickerFormat>('all');
  const [pickerSort, setPickerSort] = useState<CollectionPickerSortField>(COLLECTION_PICKER_DEFAULT_SORT);
  const [pickerSortOrder, setPickerSortOrder] = useState<'asc' | 'desc'>(COLLECTION_PICKER_DEFAULT_SORT_ORDER);
  const [showPickerFilters, setShowPickerFilters] = useState(false);
  const [showPickerSort, setShowPickerSort] = useState(false);
  const [pickerResults, setPickerResults] = useState<ArchiveSearchResponse>(EMPTY_PICKER_RESULTS);
  const [pickerSearching, setPickerSearching] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerLayerRef = useRef<HTMLDivElement | null>(null);
  const pickerInputRef = useRef<HTMLInputElement | null>(null);
  const pickerRequestVersionRef = useRef(0);

  const pickerFormatOptions = useMemo(() => {
    const options: Array<{ value: CollectionPickerFormat; label: string; count: number }> = [
      {
        value: 'all' as const,
        label: 'All items',
        count: pickerResults.total,
      },
    ];

    for (const mediaType of ARCHIVE_FORMAT_ORDER) {
      const facet = pickerResults.facets.formats.find((item) => item.value === mediaType);
      if (!facet?.count) continue;
      options.push({
        value: mediaType,
        label: ARCHIVE_FORMAT_LABELS[mediaType],
        count: facet.count,
      });
    }

    return options;
  }, [pickerResults.facets.formats, pickerResults.total]);

  const pickerSortLabel = useMemo(
    () => getCollectionPickerSortLabel(pickerSort, pickerSortOrder),
    [pickerSort, pickerSortOrder],
  );

  const pickerActiveFilterCount = pickerFormat === 'all' ? 0 : 1;
  const pickerActiveFormat = pickerFormatOptions.find((option) => option.value === pickerFormat) || null;

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

  useEffect(() => {
    const letterId = featured?.letter?.id;
    if (!letterId) {
      setFeaturedImages([]);
      setFeaturedPageIndex(0);
      return;
    }

    let cancelled = false;
    setFeaturedImages([]);
    setFeaturedPageIndex(0);

    getLetterById(letterId)
      .then((letter) => {
        if (cancelled) return;
        setFeaturedImages(letter.images || []);
      })
      .catch(() => {
        if (cancelled) return;
        setFeaturedImages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [featured?.letter?.id]);

  const resetPickerControls = useCallback(() => {
    setPickerSearch('');
    setPickerFormat('all');
    setPickerSort(COLLECTION_PICKER_DEFAULT_SORT);
    setPickerSortOrder(COLLECTION_PICKER_DEFAULT_SORT_ORDER);
    setShowPickerFilters(false);
    setShowPickerSort(false);
    setPickerError(null);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setShowPickerFilters(false);
    setShowPickerSort(false);
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;

    pickerInputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (pickerLayerRef.current?.contains(event.target as Node)) return;
      closePicker();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (showPickerFilters) {
        setShowPickerFilters(false);
        return;
      }

      if (showPickerSort) {
        setShowPickerSort(false);
        return;
      }

      closePicker();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closePicker, pickerOpen, showPickerFilters, showPickerSort]);

  useEffect(() => {
    if (!pickerOpen) return;

    let cancelled = false;
    const requestVersion = ++pickerRequestVersionRef.current;
    const timer = window.setTimeout(() => {
      setPickerSearching(true);
      setPickerError(null);
      searchArchiveShelf({
        limit: HOMEPAGE_PICKER_LIMIT,
        search: pickerSearch.trim() || undefined,
        format: pickerFormat === 'all' ? undefined : [pickerFormat],
        sort: pickerSort,
        sortOrder: pickerSortOrder,
      })
        .then((response) => {
          if (cancelled || requestVersion !== pickerRequestVersionRef.current) return;
          setPickerResults(response);
        })
        .catch((err) => {
          if (cancelled || requestVersion !== pickerRequestVersionRef.current) return;
          setPickerResults(EMPTY_PICKER_RESULTS);
          setPickerError(getErrorMessage(err, 'Failed to load published letters.'));
        })
        .finally(() => {
          if (cancelled || requestVersion !== pickerRequestVersionRef.current) return;
          setPickerSearching(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pickerFormat, pickerOpen, pickerSearch, pickerSort, pickerSortOrder]);

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
    closePicker();
    resetPickerControls();
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

  const handleTogglePicker = () => {
    if (pickerOpen) {
      closePicker();
      return;
    }

    resetPickerControls();
    setPickerResults(EMPTY_PICKER_RESULTS);
    setPickerOpen(true);
  };

  const handlePickerSortChange = (option: CollectionPickerSortOption) => {
    if (pickerSort === option.value) {
      setPickerSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
    } else {
      setPickerSort(option.value);
      setPickerSortOrder(option.defaultOrder);
    }
    setShowPickerSort(false);
  };

  const pickerResultsLabel = (() => {
    if (pickerSearching && pickerResults.total === 0) return 'Loading published letters...';
    if (pickerResults.total === 0) {
      return pickerSearch.trim() || pickerFormat !== 'all'
        ? 'No published letters match the current search or filter'
        : 'No published letters available';
    }

    if (pickerResults.total > pickerResults.letters.length) {
      return `${pickerResults.letters.length} of ${pickerResults.total} letters showing`;
    }

    return `${pickerResults.total} ${pickerResults.total === 1 ? 'letter' : 'letters'} ready to browse`;
  })();

  const fl = featured?.letter;
  const hasMultipleFeaturedPages = featuredImages.length > 1;
  const flPeopleLine = fl
    ? [fl.sender, fl.recipient].filter(Boolean).join(' \u2192 ')
    : null;
  const flDate = formatFeaturedLetterDate(fl?.letterDate || fl?.dateRaw);
  const handleFeaturedPrevPage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setFeaturedPageIndex((current) => (current === 0 ? featuredImages.length - 1 : current - 1));
  };
  const handleFeaturedNextPage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setFeaturedPageIndex((current) => (current === featuredImages.length - 1 ? 0 : current + 1));
  };

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
          <div className="hp-home-highlight-panel" ref={pickerLayerRef}>
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
                  <div className="letter-card home-hero-feature-card home-hero-feature-card--placeholder hp-home-feature-card hp-home-feature-card--placeholder">
                    <span className="home-hero-feature-placeholder-label">Featured Letter</span>
                    <p>Loading a featured letter from collection 009...</p>
                  </div>
                ) : fl ? (
                  <div
                    className={`letter-card home-hero-feature-card hp-home-feature-card letter-card--${fl.imageType || 'letter'}`}
                  >
                    {featuredImages.length > 0 ? (
                      featuredImages.map((image, index) => (
                        <img
                          key={image.id}
                          className="letter-card-image"
                          src={getImageUrl(image.imageUrl, { width: 1200 })}
                          alt=""
                          loading={index === 0 ? 'eager' : 'lazy'}
                          decoding="async"
                          style={{ opacity: index === featuredPageIndex ? 1 : 0 }}
                        />
                      ))
                    ) : fl.imageUrl ? (
                      <img
                        className="letter-card-image"
                        src={getImageUrl(fl.imageUrl, { width: 1200 })}
                        alt=""
                      />
                    ) : (
                      <div className="letter-card-fallback" aria-hidden="true">
                        <span>{flDate || 'Featured letter'}</span>
                      </div>
                    )}
                    <div className="letter-card-overlay" />
                    <div className="home-hero-feature-label">
                      <span className="home-hero-feature-title">Featured Letter</span>
                      <span className="home-hero-feature-collection">Collection {fl.collectionCode || '009'}</span>
                    </div>
                    <div className="hp-home-feature-controls">
                      {hasMultipleFeaturedPages && (
                        <span className="hp-home-feature-page-counter">
                          {featuredPageIndex + 1}/{featuredImages.length}
                        </span>
                      )}
                      <button
                        type="button"
                        className="fl-action-btn hp-home-feature-change"
                        onClick={handleTogglePicker}
                        disabled={featuredSaving || featuredLoading}
                      >
                        {pickerOpen ? 'Close' : 'Change'}
                      </button>
                    </div>
                    <div className="letter-card-content">
                      {flPeopleLine && <div className="letter-card-meta">{flPeopleLine}</div>}
                      {flDate && <div className="letter-card-date">{flDate}</div>}
                      {fl.hook && <p className="letter-hook">{fl.hook}</p>}
                    </div>
                    {hasMultipleFeaturedPages && (
                      <>
                        <button
                          type="button"
                          className="home-hero-zone home-hero-zone--prev"
                          onClick={handleFeaturedPrevPage}
                          aria-label="Previous page"
                        />
                        <button
                          type="button"
                          className="home-hero-zone home-hero-zone--next"
                          onClick={handleFeaturedNextPage}
                          aria-label="Next page"
                        />
                      </>
                    )}
                  </div>
                ) : (
                  <div className="letter-card home-hero-feature-card home-hero-feature-card--placeholder hp-home-feature-card hp-home-feature-card--placeholder">
                    <span className="home-hero-feature-placeholder-label">Featured Letter</span>
                    <p>No published letters available.</p>
                    <div className="hp-home-feature-controls">
                      <button
                        type="button"
                        className="fl-action-btn hp-home-feature-change hp-home-feature-change--placeholder"
                        onClick={handleTogglePicker}
                        disabled={featuredSaving}
                      >
                        {pickerOpen ? 'Close' : 'Change'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {pickerOpen && (
              <div className="fl-picker-overlay" role="dialog" aria-label="Select homepage featured letter">
                <div className="fl-picker-toolbar">
                  <label className="fl-picker-search-shell">
                    <svg className="fl-picker-search-icon" viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="8.75" cy="8.75" r="5.5" />
                      <path d="m12.5 12.5 4.25 4.25" />
                    </svg>
                    <input
                      ref={pickerInputRef}
                      type="search"
                      className="fl-picker-search"
                      placeholder="Search sender, recipient, date, hook..."
                      value={pickerSearch}
                      onChange={(event) => setPickerSearch(event.target.value)}
                    />
                  </label>

                  <div className="fl-picker-toolbar-actions">
                    <div className="fl-picker-dropdown">
                      <button
                        type="button"
                        className={`fl-picker-control${showPickerFilters ? ' is-active' : ''}`}
                        aria-expanded={showPickerFilters}
                        aria-haspopup="menu"
                        onClick={() => {
                          setShowPickerFilters((current) => {
                            const next = !current;
                            if (next) setShowPickerSort(false);
                            return next;
                          });
                        }}
                      >
                        <svg viewBox="0 0 14 14" aria-hidden="true">
                          <path d="M1.5 2.5h11L8 7.5v4l-2 1.5V7.5z" />
                        </svg>
                        <span>Filter</span>
                        {pickerActiveFilterCount > 0 && (
                          <span className="fl-picker-control-count">{pickerActiveFilterCount}</span>
                        )}
                      </button>
                      {showPickerFilters && (
                        <div className="fl-picker-menu fl-picker-menu--filters" role="menu">
                          <div className="fl-picker-menu-header">
                            <span className="fl-picker-menu-kicker">Media Type</span>
                            <button
                              type="button"
                              className="fl-picker-menu-reset"
                              onClick={() => setPickerFormat('all')}
                              disabled={pickerFormat === 'all'}
                            >
                              Reset
                            </button>
                          </div>
                          <div className="fl-picker-filter-list">
                            {pickerFormatOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`fl-picker-filter-chip${option.value === pickerFormat ? ' is-active' : ''}`}
                                onClick={() => {
                                  setPickerFormat(option.value);
                                  setShowPickerFilters(false);
                                }}
                              >
                                <span>{option.label}</span>
                                <span className="fl-picker-filter-count">{option.count}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="fl-picker-dropdown">
                      <button
                        type="button"
                        className={`fl-picker-control${showPickerSort ? ' is-active' : ''}`}
                        aria-expanded={showPickerSort}
                        aria-haspopup="menu"
                        onClick={() => {
                          setShowPickerSort((current) => {
                            const next = !current;
                            if (next) setShowPickerFilters(false);
                            return next;
                          });
                        }}
                      >
                        <span>Sort</span>
                        <span className="fl-picker-control-value">{pickerSortLabel}</span>
                      </button>
                      {showPickerSort && (
                        <div className="fl-picker-menu fl-picker-menu--sort" role="menu">
                          {COLLECTION_PICKER_SORT_OPTIONS.map((option) => {
                            const isActive = option.value === pickerSort;
                            const optionOrder = isActive ? pickerSortOrder : option.defaultOrder;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`fl-picker-sort-option${isActive ? ' is-active' : ''}`}
                                onClick={() => handlePickerSortChange(option)}
                              >
                                <span className="fl-picker-sort-copy">
                                  <span className="fl-picker-sort-title">{option.label}</span>
                                  <span className="fl-picker-sort-meta">
                                    {getCollectionPickerSortLabel(option.value, optionOrder)}
                                  </span>
                                </span>
                                <span className="fl-picker-sort-arrow" aria-hidden="true">
                                  {optionOrder === 'asc' ? '↑' : '↓'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="fl-picker-toolbar-footer">
                  <p className="fl-picker-results-label">{pickerResultsLabel}</p>
                  {pickerActiveFormat && pickerActiveFormat.value !== 'all' && (
                    <button
                      type="button"
                      className="fl-picker-inline-clear"
                      onClick={() => setPickerFormat('all')}
                    >
                      Showing {pickerActiveFormat.label.toLowerCase()}
                    </button>
                  )}
                </div>

                {pickerError && <div className="fl-picker-status fl-picker-status--error">{pickerError}</div>}

                <div className="letter-grid fl-picker-grid">
                  {pickerResults.letters.map((item: ArchiveShelfItem) => (
                    <div
                      key={item.id}
                      className={`fl-picker-card${item.id === featured?.letter_id ? ' fl-picker-card--selected' : ''}`}
                    >
                      <LetterCard
                        selection
                        card={item}
                        onClick={(id) => void handleSelectFeatured(id)}
                      />
                    </div>
                  ))}
                  {!pickerSearching && !pickerError && pickerResults.letters.length === 0 && (
                    <p className="fl-picker-empty">No published letters match the current search or filter.</p>
                  )}
                </div>
              </div>
            )}
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
      {error && <div className="pub-error">{error}</div>}

      {/* ── Block editor (uses public page shell for accurate rendering) ── */}
      <div className="public-site-shell be-page-shell pe-shell">
        <div className="body-layout">
          <div className="hp-hero-header">
            <h3 className="hp-section-title">{config.title} Page</h3>
            <div className="hp-hero-actions">
              {saveLabel && (
                <span className={`hp-save-state ${saveState === 'error' ? 'pe-save-error' : ''}`}>
                  {saveLabel}
                </span>
              )}
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
                className="hp-view-link"
                href={config.publicPath}
                target="_blank"
                rel="noopener noreferrer"
              >
                View live &rarr;
              </a>
            </div>
          </div>
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
