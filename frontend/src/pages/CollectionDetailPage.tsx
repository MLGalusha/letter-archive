import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCollectionByCode, type CollectionWithLetters } from '../api/collections';
import LetterCard from '../components/LetterCard/LetterCard';
import Breadcrumb from '../components/Breadcrumb';
import Footer from '../components/Footer/Footer';
import {
  applyCollectionFilters,
  buildCollectionFacets,
} from './collection-detail-utils';
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
      }),
    [collectionLetters, selectedCorrespondent, selectedThreadKey, selectedTopic],
  );

  const hasActiveFilters = Boolean(
    selectedTopic || selectedCorrespondent || selectedThreadKey,
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
  }, [facets, selectedCorrespondent, selectedThreadKey, selectedTopic]);

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

  return (
    <div className="body-layout">
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Collections', href: '/collections' },
          { label: collection.title || collection.collectionCode },
        ]}
      />
      <div className="collection-detail-public">
        <div className="collection-header-info">
          <span className="collection-code-display">{collection.collectionCode}</span>
          <h1>{collection.title || `Collection ${collection.collectionCode}`}</h1>
        </div>

        {collection.description && (
          <p className="collection-description-text">{collection.description}</p>
        )}

        <p className="letter-count-text">{collection.letterCount} letters in this collection</p>

        <div className="collection-insight-grid">
          <div className="insight-card">
            <span>Date Span</span>
            <strong>
              {dateRange ? `${dateRange.start} → ${dateRange.end}` : 'Unknown'}
            </strong>
          </div>
          <div className="insight-card">
            <span>Top Correspondents</span>
            <strong>{topCorrespondents.length > 0 ? topCorrespondents.length : 0}</strong>
          </div>
        </div>

        {topCorrespondents.length > 0 && (
          <div className="top-correspondents">
            <h3>Frequent Names in This Collection</h3>
            <ul>
              {topCorrespondents.map((person) => (
                <li key={person.name}>
                  <span>{person.name}</span>
                  <small>{person.count} mentions</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="collection-explorer">
          <div className="collection-explorer-header">
            <h3>Explore Paths</h3>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="clear-filters-btn">
                Clear Filters
              </button>
            )}
          </div>

          {facets.topics.length > 0 && (
            <div className="explorer-group">
              <span className="explorer-label">Themes</span>
              <div className="chip-list">
                {facets.topics.map((topic) => (
                  <button
                    key={topic.value}
                    type="button"
                    className={`filter-chip ${selectedTopic === topic.value ? 'active' : ''}`}
                    onClick={() => setSelectedTopic((current) => (current === topic.value ? null : topic.value))}
                  >
                    {topic.value} <small>{topic.count}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {facets.correspondents.length > 0 && (
            <div className="explorer-group">
              <span className="explorer-label">People</span>
              <div className="chip-list">
                {facets.correspondents.map((correspondent) => (
                  <button
                    key={correspondent.value}
                    type="button"
                    className={`filter-chip ${selectedCorrespondent === correspondent.value ? 'active' : ''}`}
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

          {facets.threads.length > 0 && (
            <div className="explorer-group">
              <span className="explorer-label">Story Threads</span>
              <div className="thread-list">
                {facets.threads.map((thread) => (
                  <button
                    key={thread.key}
                    type="button"
                    className={`thread-card ${selectedThreadKey === thread.key ? 'active' : ''}`}
                    onClick={() =>
                      setSelectedThreadKey((current) => (current === thread.key ? null : thread.key))
                    }
                  >
                    <strong>{thread.sender} → {thread.recipient}</strong>
                    <span>{thread.count} letters</span>
                    {thread.latestDate && <small>Latest: {thread.latestDate}</small>}
                    {thread.sampleHook && <p>{thread.sampleHook}</p>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <p className="filtered-count-text">
          Showing {filteredLetters.length} of {collection.letters.length} letters
        </p>

        <div className="letter-grid">
          {filteredLetters.map((letter) => (
            <LetterCard
              key={letter.id}
              id={letter.id}
              date={letter.metadata.date}
              location={letter.metadata.location}
              sender={letter.metadata.sender}
              recipient={letter.metadata.recipient}
              hook={letter.metadata.hook}
              onClick={handleLetterClick}
            />
          ))}
        </div>

        {filteredLetters.length === 0 && (
          <div className="no-results">
            <p>No letters match the current filters.</p>
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="clear-filters-inline">
                Reset filters
              </button>
            )}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
