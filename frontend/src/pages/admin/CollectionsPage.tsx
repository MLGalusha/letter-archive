import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminCollections, type AdminCollectionInfo } from '../../api/collections';
import './CollectionsPage.css';

export default function CollectionsPage() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<AdminCollectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isAuth = sessionStorage.getItem('adminAuth');
    if (!isAuth) {
      navigate('/admin-login');
      return;
    }

    async function fetchCollections() {
      try {
        const data = await getAdminCollections();
        setCollections(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load collections');
      } finally {
        setLoading(false);
      }
    }

    fetchCollections();
  }, [navigate]);

  const handleRowClick = (code: string) => {
    navigate(`/admin/collections/${code}`);
  };

  const handleBack = () => {
    navigate('/admin');
  };

  if (loading) {
    return (
      <div className="admin-collections-page">
        <header className="admin-header">
          <h1>Collections</h1>
          <button onClick={handleBack} className="back-button">
            Back to Dashboard
          </button>
        </header>
        <div className="admin-content">
          <p>Loading collections...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-collections-page">
      <header className="admin-header">
        <h1>Collections</h1>
        <button onClick={handleBack} className="back-button">
          Back to Dashboard
        </button>
      </header>

      <div className="admin-content">
        {error && <p className="error-message">{error}</p>}

        <div className="collections-grid">
          {collections.map((collection) => (
            <div
              key={collection.id}
              className="collection-card"
              onClick={() => handleRowClick(collection.collectionCode)}
            >
              <div className="collection-card-header">
                <span className="collection-code">{collection.collectionCode}</span>
                <span className="collection-count">{collection.letterCount} letters</span>
              </div>
              <h3 className="collection-title">
                {collection.title || `Collection ${collection.collectionCode}`}
              </h3>
              {collection.description && (
                <p className="collection-description">{collection.description}</p>
              )}
              <div className="collection-stats">
                <span className="stat published">{collection.publishedCount} published</span>
                <span className="stat draft">{collection.draftCount} draft</span>
              </div>
            </div>
          ))}
        </div>

        {collections.length === 0 && !error && (
          <div className="empty-state">
            <p>No collections found.</p>
            <p className="empty-hint">Upload letters to create collections.</p>
          </div>
        )}
      </div>
    </div>
  );
}
