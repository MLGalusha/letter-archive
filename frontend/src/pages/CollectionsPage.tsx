import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listCollections, type CollectionInfo } from '../api/collections';
import Footer from '../components/Footer/Footer';
import './CollectionsPage.css';

export default function CollectionsPage() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="body-layout">
      <div className="collections-browse-page">
        <h1>Letter Collections</h1>
        <p className="page-description">
          Browse letters organized by collection. Each collection represents a family
          correspondence or thematic grouping.
        </p>

        {loading && <p className="loading-message">Loading collections...</p>}
        {error && <p className="error-message">{error}</p>}

        <div className="public-collections-grid">
          {collections.map((collection) => (
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

        {!loading && collections.length === 0 && !error && (
          <div className="no-results">
            <p>No collections available yet.</p>
            <p className="no-results-hint">Check back later for published letters.</p>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
