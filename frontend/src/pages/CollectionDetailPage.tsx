import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCollectionByCode, type CollectionWithLetters } from '../api/collections';
import LetterCard from '../components/LetterCard/LetterCard';
import Footer from '../components/Footer/Footer';
import './CollectionDetailPage.css';

export default function CollectionDetailPage() {
  const navigate = useNavigate();
  const { collectionCode } = useParams<{ collectionCode: string }>();

  const [collection, setCollection] = useState<CollectionWithLetters | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleLetterClick = (letterId: string) => {
    navigate(`/letter/${letterId}`);
  };

  const handleBack = () => {
    navigate('/collections');
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
      <div className="collection-detail-public">
        <button onClick={handleBack} className="back-link">
          &larr; All Collections
        </button>

        <div className="collection-header-info">
          <span className="collection-code-display">{collection.collectionCode}</span>
          <h1>{collection.title || `Collection ${collection.collectionCode}`}</h1>
        </div>

        {collection.description && (
          <p className="collection-description-text">{collection.description}</p>
        )}

        <p className="letter-count-text">{collection.letterCount} letters in this collection</p>

        <div className="letter-grid">
          {collection.letters.map((letter) => (
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

        {collection.letters.length === 0 && (
          <div className="no-results">
            <p>No published letters in this collection yet.</p>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
