import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCollectionByCode, type CollectionWithLetters } from '../api/collections';
import LetterCard from '../components/LetterCard/LetterCard';
import Breadcrumb from '../components/Breadcrumb';
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

  const topCorrespondents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const letter of collection.letters) {
      const sender = letter.metadata.sender?.trim();
      const recipient = letter.metadata.recipient?.trim();
      if (sender) counts.set(sender, (counts.get(sender) || 0) + 1);
      if (recipient) counts.set(recipient, (counts.get(recipient) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [collection.letters]);

  const dateRange = useMemo(() => {
    const values = collection.letters
      .map((letter) => letter.metadata.date || letter.metadata.dateRaw)
      .filter(Boolean) as string[];

    if (values.length === 0) return null;

    const sorted = [...values].sort();
    return { start: sorted[0], end: sorted[sorted.length - 1] };
  }, [collection.letters]);

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
