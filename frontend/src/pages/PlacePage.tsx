import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getPlacePublic, type PublicPlaceDetail } from '../api/entities';
import Breadcrumb from '../components/Breadcrumb';
import Footer from '../components/Footer/Footer';
import './PlacePage.css';

export default function PlacePage() {
  const navigate = useNavigate();
  const { placeId } = useParams<{ placeId: string }>();

  const [data, setData] = useState<PublicPlaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!placeId) return;

    async function fetchPlace() {
      try {
        const result = await getPlacePublic(placeId!);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Place not found');
      } finally {
        setLoading(false);
      }
    }

    fetchPlace();
  }, [placeId]);

  const handleBack = () => {
    navigate(-1);
  };

  const handleLetterClick = (letterId: string) => {
    navigate(`/letter/${letterId}`);
  };

  if (loading) {
    return (
      <div className="body-layout">
        <div className="place-page">
          <p className="loading-message">Loading place...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!data || error) {
    return (
      <div className="body-layout">
        <div className="place-page">
          <button onClick={handleBack} className="back-link">
            &larr; Back
          </button>
          <h1>Place Not Found</h1>
          <p className="error-text">
            {error || 'This place does not exist.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const { place, stats, letters } = data;

  return (
    <div className="body-layout">
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Places', href: '/explore' },
          { label: place.canonicalName },
        ]}
      />
      <div className="place-page">
        <div className="place-header">
          <div className="place-title-row">
            <h1>{place.canonicalName}</h1>
            {place.placeType && (
              <span className="place-type-badge">{place.placeType}</span>
            )}
          </div>
          {place.aliases.length > 0 && (
            <p className="aliases">Also known as: {place.aliases.join(', ')}</p>
          )}
        </div>

        {place.themes && place.themes.length > 0 && (
          <section className="notes-section">
            <h2>Common Themes</h2>
            <ul className="themes-list">
              {place.themes.map((theme, index) => (
                <li key={`${theme}-${index}`}>{theme}</li>
              ))}
            </ul>
          </section>
        )}

        {place.notes && (
          <section className="notes-section">
            <h2>Description</h2>
            <div className="notes-text">
              {place.notes.split('\n\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </section>
        )}

        <section className="stats-section">
          <h2>Letter Statistics</h2>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-value">{stats.writtenFrom}</span>
              <span className="stat-label">Written From</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{stats.destination}</span>
              <span className="stat-label">Destination</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{stats.mentioned}</span>
              <span className="stat-label">Mentioned In</span>
            </div>
            <div className="stat-item stat-total">
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">Total Appearances</span>
            </div>
          </div>
        </section>

        <section className="letters-section">
          <h2>Letters ({letters.length})</h2>
          {letters.length === 0 ? (
            <p className="no-letters">No published letters mentioning this place.</p>
          ) : (
            <div className="letters-list">
              {letters.map((letter) => (
                <div
                  key={letter.id}
                  className="letter-item"
                  onClick={() => handleLetterClick(letter.id)}
                >
                  <div className="letter-meta">
                    <span className="letter-date">
                      {letter.letterDate || letter.dateRaw}
                    </span>
                    {letter.role && (
                      <span className={`letter-role role-${letter.role.replace('_', '-')}`}>
                        {letter.role.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div className="letter-parties">
                    {letter.sender && <span>From: {letter.sender}</span>}
                    {letter.recipient && <span>To: {letter.recipient}</span>}
                  </div>
                  {letter.hook && <p className="letter-hook">{letter.hook}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <Footer />
    </div>
  );
}
