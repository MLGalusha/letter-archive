import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SEO from '../components/SEO';
import { getCollectionByCode, type CollectionWithLetters } from '../api/collections';
import { getImageUrl } from '../api/client';
import LetterCard from '../components/LetterCard/LetterCard';
import Breadcrumb from '../components/Breadcrumb';
import Footer from '../components/Footer/Footer';
import type { LetterImageType } from '../types/Letter';
import {
  applyCollectionFilters,
  buildCollectionFacets,
  pickCollectionHighlights,
} from './collection-detail-utils';
import { buildCollectionSeo } from '../utils/seo';
import {
  getLetterPeopleLine,
  getLetterPreviewText,
  getMediaLabel,
  getPrimaryImage,
  getPrimaryMediaType,
  buildLetterCardData,
} from '../utils/letterPreview';
import './CollectionDetailPage.css';

export default function CollectionDetailPage() {
  const navigate = useNavigate();
  const { collectionCode } = useParams<{ collectionCode: string }>();

  const [collection, setCollection] = useState<CollectionWithLetters | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selectedCorrespondent, setSelectedCorrespondent] = useState<string | null>(null);
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<LetterImageType | null>(null);
  const collectionLetters = collection?.letters ?? [];

  const topCorrespondents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const letter of collectionLetters) {
      const sender = letter.metadata.sender?.trim();
      const recipient = letter.metadata.recipient?.trim();
      if (sender) counts.set(sender, (counts.get(sender) || 0) + 1);
      if (recipient) counts.set(recipient, (counts.get(recipient) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [collectionLetters]);

  const dateRange = useMemo(() => {
    const values = collectionLetters
      .map((letter) => letter.metadata.date || letter.metadata.dateRaw)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);

    if (values.length === 0) return null;

    const sorted = [...values].sort();
    return { start: sorted[0], end: sorted[sorted.length - 1] };
  }, [collectionLetters]);

  const facets = useMemo(
    () => buildCollectionFacets(collectionLetters),
    [collectionLetters],
  );

  const filteredLetters = useMemo(
    () =>
      applyCollectionFilters(collectionLetters, {
        topic: selectedTopic,
        correspondent: selectedCorrespondent,
        threadKey: selectedThreadKey,
        format: selectedFormat,
      }),
    [collectionLetters, selectedCorrespondent, selectedFormat, selectedThreadKey, selectedTopic],
  );

  const hasActiveFilters = Boolean(
    selectedTopic || selectedCorrespondent || selectedThreadKey || selectedFormat,
  );

  const visualHighlights = useMemo(
    () => pickCollectionHighlights(hasActiveFilters ? filteredLetters : collectionLetters),
    [collectionLetters, filteredLetters, hasActiveFilters],
  );

  useEffect(() => {
    if (!collectionCode) return;

    async function fetchCollection() {
      try {
        const data = await getCollectionByCode(collectionCode!);
        setCollection(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Collection not found');
      } finally {
        setLoading(false);
      }
    }

    fetchCollection();
  }, [collectionCode]);

  useEffect(() => {
    if (selectedTopic && !facets.topics.some((topic) => topic.value === selectedTopic)) {
      setSelectedTopic(null);
    }
    if (
      selectedCorrespondent &&
      !facets.correspondents.some((correspondent) => correspondent.value === selectedCorrespondent)
    ) {
      setSelectedCorrespondent(null);
    }
    if (selectedThreadKey && !facets.threads.some((thread) => thread.key === selectedThreadKey)) {
      setSelectedThreadKey(null);
    }
    if (selectedFormat && !facets.formats.some((format) => format.value === selectedFormat)) {
      setSelectedFormat(null);
    }
  }, [facets, selectedCorrespondent, selectedFormat, selectedThreadKey, selectedTopic]);

  const handleLetterClick = (letterId: string) => {
    navigate(`/letter/${letterId}`);
  };

  const handleBack = () => {
    navigate('/collections');
  };

  const clearFilters = () => {
    setSelectedTopic(null);
    setSelectedCorrespondent(null);
    setSelectedThreadKey(null);
    setSelectedFormat(null);
  };

  if (loading) {
    return (
      <div className="body-layout">
        <div className="collection-detail-public">
          <p className="loading-message">Loading collection...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!collection || error) {
    return (
      <div className="body-layout">
        <div className="collection-detail-public">
          <button onClick={handleBack} className="back-link">
            &larr; All Collections
          </button>
          <h1>Collection Not Found</h1>
          <p className="error-text">
            {error || 'This collection does not exist or has no published letters.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const seo = buildCollectionSeo(collection, dateRange, topCorrespondents);

  return (
    <div className="body-layout">
      <SEO
        title={seo.title}
        description={seo.description}
        canonicalUrl={seo.canonicalPath}
        ogType={seo.ogType}
        jsonLd={seo.jsonLd}
      />
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Collections', href: '/collections' },
          { label: collection.title || collection.collectionCode },
        ]}
      />
      <div className="collection-detail-public">
        {/* Header */}
        <div className="cd-header">
          <div className="cd-header-top">
            <span className="cd-code-badge">{collection.collectionCode}</span>
            <span className="cd-letter-count">
              {collection.letterCount} item{collection.letterCount !== 1 ? 's' : ''}
            </span>
          </div>
          <h1>{collection.title || `Collection ${collection.collectionCode}`}</h1>
          {collection.description && (
            <p className="cd-description">{collection.description}</p>
          )}
        </div>

        {/* At-a-glance stats */}
        <div className="cd-stats-row">
          {dateRange && (
            <div className="cd-stat">
              <span className="cd-stat-label">Date span</span>
              <span className="cd-stat-value">{dateRange.start} &mdash; {dateRange.end}</span>
            </div>
          )}
          {topCorrespondents.length > 0 && (
            <div className="cd-stat">
              <span className="cd-stat-label">Voices</span>
              <span className="cd-stat-value">
                {topCorrespondents.map((p) => p.name).join(', ')}
              </span>
            </div>
          )}
        </div>

        {visualHighlights.length > 0 && (
          <section className="cd-visual-section">
            <div className="cd-section-header">
              <h2>Visual Highlights</h2>
              <p className="cd-section-hint">
                Start with the image-led pieces that give this collection its texture.
              </p>
            </div>
            <div className="cd-visual-grid">
              {visualHighlights.map((letter, index) => {
                const image = getPrimaryImage(letter);
                const mediaLabel = getMediaLabel(getPrimaryMediaType(letter));
                const peopleLine = getLetterPeopleLine(letter);
                const previewText = getLetterPreviewText(letter);
                const displayDate = letter.metadata.date || letter.metadata.dateRaw;
                const displayTitle = peopleLine || displayDate || letter.title;

                return (
                  <button
                    key={letter.id}
                    type="button"
                    className={`cd-visual-card ${index === 0 ? 'lead' : ''}`}
                    onClick={() => handleLetterClick(letter.id)}
                  >
                    {image ? (
                      <img
                        src={getImageUrl(image.imageUrl)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="cd-visual-fallback" aria-hidden="true">
                        {mediaLabel}
                      </div>
                    )}
                    <div className="cd-visual-overlay" />
                    <div className="cd-visual-content">
                      <div className="cd-visual-topline">
                        <span className="cd-visual-badge">{mediaLabel}</span>
                        {displayDate && (
                          <span className="cd-visual-date">{displayDate}</span>
                        )}
                      </div>
                      <h3>{displayTitle}</h3>
                      {previewText && <p>{previewText}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Story threads — the most engaging entry point */}
        {facets.threads.length > 0 && (
          <section className="cd-threads-section">
            <div className="cd-section-header">
              <h2>Story Threads</h2>
              <p className="cd-section-hint">Follow a conversation between two people</p>
            </div>
            <div className="cd-thread-grid">
              {facets.threads.map((thread) => (
                <button
                  key={thread.key}
                  type="button"
                  className={`cd-thread-card ${selectedThreadKey === thread.key ? 'active' : ''}`}
                  onClick={() =>
                    setSelectedThreadKey((current) => (current === thread.key ? null : thread.key))
                  }
                >
                  <div className="cd-thread-names">
                    {thread.sender} <span className="cd-thread-arrow">&rarr;</span> {thread.recipient}
                  </div>
                  <div className="cd-thread-meta">
                    {thread.count} letter{thread.count !== 1 ? 's' : ''}
                    {thread.latestDate && <> &middot; through {thread.latestDate}</>}
                  </div>
                  {thread.sampleHook && (
                    <p className="cd-thread-hook">&ldquo;{thread.sampleHook}&rdquo;</p>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Explore Paths — themes and people */}
        {(facets.formats.length > 0 || facets.topics.length > 0 || facets.correspondents.length > 0) && (
          <section className="cd-explore-section">
            <div className="cd-section-header">
              <h2>Explore by</h2>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="cd-clear-btn">
                  Clear filters
                </button>
              )}
            </div>

            <div className="cd-explore-groups">
              {facets.formats.length > 0 && (
                <div className="cd-explore-group">
                  <span className="cd-explore-label">Formats</span>
                  <div className="cd-chip-list">
                    {facets.formats.map((format) => (
                      <button
                        key={format.value}
                        type="button"
                        className={`cd-chip ${selectedFormat === format.value ? 'active' : ''}`}
                        onClick={() =>
                          setSelectedFormat((current) =>
                            current === format.value ? null : format.value,
                          )
                        }
                      >
                        {format.label} <small>{format.count}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {facets.topics.length > 0 && (
                <div className="cd-explore-group">
                  <span className="cd-explore-label">Themes</span>
                  <div className="cd-chip-list">
                    {facets.topics.map((topic) => (
                      <button
                        key={topic.value}
                        type="button"
                        className={`cd-chip ${selectedTopic === topic.value ? 'active' : ''}`}
                        onClick={() => setSelectedTopic((current) => (current === topic.value ? null : topic.value))}
                      >
                        {topic.value} <small>{topic.count}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {facets.correspondents.length > 0 && (
                <div className="cd-explore-group">
                  <span className="cd-explore-label">People</span>
                  <div className="cd-chip-list">
                    {facets.correspondents.map((correspondent) => (
                      <button
                        key={correspondent.value}
                        type="button"
                        className={`cd-chip ${selectedCorrespondent === correspondent.value ? 'active' : ''}`}
                        onClick={() =>
                          setSelectedCorrespondent((current) =>
                            current === correspondent.value ? null : correspondent.value,
                          )
                        }
                      >
                        {correspondent.value} <small>{correspondent.count}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Letters */}
        <div className="cd-letters-section">
          <div className="cd-section-header">
            <h2>Browse the Collection</h2>
            <p className="cd-section-hint">
              Move between letters, photographs, telegrams, and other surviving pieces.
            </p>
          </div>
          <p className="cd-letters-count">
            {hasActiveFilters
              ? `${filteredLetters.length} of ${collection.letters.length} items`
              : `${collection.letters.length} items`}
          </p>

          <div className="cd-letters-grid">
            {filteredLetters.map((letter) => (
              <LetterCard
                key={letter.id}
                card={buildLetterCardData(letter)}
                onClick={handleLetterClick}
              />
            ))}
          </div>

          {filteredLetters.length === 0 && (
            <div className="no-results">
              <p>No collection items match the current filters.</p>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="cd-clear-btn">
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
