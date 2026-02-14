import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listCollections, type CollectionInfo } from '../api/collections';
import Footer from '../components/Footer/Footer';
import './CollectionsPage.css';

export default function CollectionsPage() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'letters-desc' | 'letters-asc' | 'title-asc'>('letters-desc');

  useEffect(() => {
    async function fetchCollections() {
      try {
        const data = await listCollections();
        // Filter to only show collections with published letters
        setCollections(data.filter((c) => (c.letterCount || 0) > 0));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load collections');
      } finally {
        setLoading(false);
      }
    }

    fetchCollections();
  }, []);

  const handleCollectionClick = (code: string) => {
    navigate(`/collections/${code}`);
  };

  const visibleCollections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = collections.filter((collection) => {
      if (!query) return true;
      return (
        (collection.title || '').toLowerCase().includes(query) ||
        collection.collectionCode.toLowerCase().includes(query) ||
        (collection.description || '').toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      if (sortMode === 'letters-desc') return (b.letterCount || 0) - (a.letterCount || 0);
      if (sortMode === 'letters-asc') return (a.letterCount || 0) - (b.letterCount || 0);
      return (a.title || a.collectionCode).localeCompare(b.title || b.collectionCode);
    });
  }, [collections, searchQuery, sortMode]);

  const totalLetters = useMemo(
    () => collections.reduce((sum, collection) => sum + (collection.letterCount || 0), 0),
    [collections],
  );

  const handleRandomCollection = () => {
    if (visibleCollections.length === 0) return;
    const index = Math.floor(Math.random() * visibleCollections.length);
    handleCollectionClick(visibleCollections[index].collectionCode);
  };

  return (
    <div className="body-layout">
      <div className="collections-browse-page">
        <h1>Letter Collections</h1>
        <p className="page-description">
          Browse letters organized by collection. Each collection represents a family
          correspondence or thematic grouping.
        </p>

        <div className="collections-summary">
          <div className="summary-pill">
            <span>Collections</span>
            <strong>{collections.length}</strong>
          </div>
          <div className="summary-pill">
            <span>Published Letters</span>
            <strong>{totalLetters}</strong>
          </div>
        </div>

        <div className="collection-controls">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, code, or description..."
            aria-label="Search collections"
          />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
            aria-label="Sort collections"
          >
            <option value="letters-desc">Most letters</option>
            <option value="letters-asc">Fewest letters</option>
            <option value="title-asc">Title A-Z</option>
          </select>
          <button onClick={handleRandomCollection} disabled={visibleCollections.length === 0}>
            Random Collection
          </button>
        </div>

        {loading && <p className="loading-message">Loading collections...</p>}
        {error && <p className="error-message">{error}</p>}

        <div className="public-collections-grid">
          {visibleCollections.map((collection) => (
            <div
              key={collection.id}
              className="public-collection-card"
              onClick={() => handleCollectionClick(collection.collectionCode)}
            >
              <div className="collection-card-code">{collection.collectionCode}</div>
              <h3>{collection.title || `Collection ${collection.collectionCode}`}</h3>
              {collection.description && (
                <p className="collection-card-description">{collection.description}</p>
              )}
              <span className="collection-letter-count">{collection.letterCount} letters</span>
            </div>
          ))}
        </div>

        {!loading && visibleCollections.length === 0 && !error && (
          <div className="no-results">
            <p>No matching collections found.</p>
            <p className="no-results-hint">Try a different search or sorting strategy.</p>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
