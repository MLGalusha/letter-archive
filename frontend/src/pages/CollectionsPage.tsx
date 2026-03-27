import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SEO from '../components/SEO';
import { listCollections, type CollectionInfo } from '../api/collections';
import Footer from '../components/Footer/Footer';
import { useAsync } from '../hooks/useAsync';
import './CollectionsPage.css';

export default function CollectionsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'letters-desc' | 'letters-asc' | 'title-asc'>('letters-desc');
  const { data, loading, error } = useAsync(async () => {
    const collections = await listCollections();
    return collections.filter((collection) => (collection.letterCount || 0) > 0);
  }, []);
  const collections: CollectionInfo[] = data ?? [];

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
      <SEO
        title="Collections"
        description="Browse collections of personal letters and historical correspondence. Each collection holds a bundle of letters -- a family's exchange, a wartime correspondence, a love story told across distance."
        canonicalUrl="/collections"
      />
      <div className="collections-browse-page">
        <div className="collections-hero">
          <p className="collections-kicker">Collection Shelf</p>
          <h1>Collections</h1>
          <p className="collections-hero-sub">
            Each collection holds a bundle of letters — a family's correspondence, a wartime exchange,
            a love story told across distance. Pick one and step inside.
          </p>
          <div className="collections-summary">
            <span className="summary-stat">
              <strong>{collections.length}</strong> collection{collections.length !== 1 ? 's' : ''}
            </span>
            <span className="summary-divider">/</span>
            <span className="summary-stat">
              <strong>{totalLetters}</strong> letters
            </span>
          </div>
        </div>

        <div className="collection-controls-shell">
          <div className="collection-controls">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search collections..."
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
              Surprise me
            </button>
          </div>
        </div>

        {loading && <p className="loading-message">Loading collections...</p>}
        {error && <p className="error-message">{error}</p>}

        <div className="public-collections-grid">
          {visibleCollections.map((collection) => (
            <Link
              key={collection.id}
              to={`/collections/${collection.collectionCode}`}
              className="public-collection-card"
            >
              <div className="collection-card-top">
                <span className="collection-card-code">{collection.collectionCode}</span>
                <span className="collection-card-count">
                  {collection.letterCount} letter{collection.letterCount !== 1 ? 's' : ''}
                </span>
              </div>
              <h3>{collection.title || `Collection ${collection.collectionCode}`}</h3>
              {collection.description && (
                <p className="collection-card-description">{collection.description}</p>
              )}
              <span className="collection-card-cta">Read the letters &rarr;</span>
            </Link>
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
