import { useSiteSettings } from '../hooks/useSiteSettings';
import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getPersonPublic, type PublicPersonDetail } from '../api/entities';
import SEO from '../components/SEO';
import Breadcrumb from '../components/Breadcrumb';
import Footer from '../components/Footer/Footer';
import { buildPersonSeo } from '../utils/seo';
import './PersonPage.css';

export default function PersonPage() {
  const settings = useSiteSettings();
  const navigate = useNavigate();
  const { personId } = useParams<{ personId: string }>();

  const [result, setResult] = useState<{
    personId: string | undefined; data: PublicPersonDetail | null; error: string | null;
  } | null>(null);
  const current = result?.personId === personId ? result : null;
  const loading = !!personId && !current;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    if (!personId) return;
    const controller = new AbortController();

    async function fetchPerson() {
      try {
        const data = await getPersonPublic(personId!, controller.signal);
        if (!controller.signal.aborted) setResult({ personId, data, error: null });
      } catch (err) {
        if (!controller.signal.aborted) setResult({ personId, data: null,
          error: err instanceof Error ? err.message : 'Person not found' });
      }
    }

    fetchPerson();
    return () => controller.abort();
  }, [personId]);

  const handleBack = () => {
    navigate(-1);
  };

  if (loading) {
    return (
      <div className="body-layout">
        <div className="person-page">
          <p className="loading-message">Loading person...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!data || error) {
    return (
      <div className="body-layout">
        <div className="person-page">
          <button onClick={handleBack} className="back-link">
            &larr; Back
          </button>
          <h1>Person Not Found</h1>
          <p className="error-text">
            {error || 'This person does not exist.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const { person, relationships, stats, letters } = data;
  const seo = buildPersonSeo(data, settings?.site_title?.trim() || undefined);

  return (
    <div className="body-layout">
      <SEO
        title={seo.title}
        description={seo.description}
        canonicalUrl={seo.canonicalPath}
        jsonLd={seo.jsonLd}
      />
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: person.canonicalName },
        ]}
      />
      <div className="person-page">
        <div className="person-header">
          <h1>{person.canonicalName}</h1>
          {person.aliases.length > 0 && (
            <p className="aliases">Also known as: {person.aliases.join(', ')}</p>
          )}
        </div>

        {person.biography && (
          <section className="biography-section">
            <h2>Biography</h2>
            <div className="biography-text">
              {person.biography.split('\n\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </section>
        )}

        {relationships.length > 0 && (
          <section className="relationships-section">
            <h2>Relationships</h2>
            <ul className="relationships-list">
              {relationships.map((rel) => (
                <li key={rel.id}>
                  <Link to={`/people/${rel.relatedPersonId}`}>
                    {rel.relatedPersonName}
                  </Link>
                  <span className="relationship-type">
                    ({rel.relationshipType.replace(/-/g, ' ')})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="stats-section">
          <h2>Letter Statistics</h2>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-value">{stats.asSender}</span>
              <span className="stat-label">Letters Sent</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{stats.asRecipient}</span>
              <span className="stat-label">Letters Received</span>
            </div>
            <div className="stat-item">
              <span className="stat-value">{stats.asMentioned}</span>
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
            <p className="no-letters">No published letters involving this person.</p>
          ) : (
            <div className="letters-list">
              {letters.map((letter) => (
                <Link
                  key={letter.id}
                  to={`/letter/${letter.id}`}
                  className="letter-item"
                >
                  <div className="letter-meta">
                    <span className="letter-date">
                      {letter.letterDate || letter.dateRaw}
                    </span>
                    <span className={`letter-role role-${letter.role}`}>
                      {letter.role}
                    </span>
                  </div>
                  <div className="letter-parties">
                    {letter.sender && <span>From: {letter.sender}</span>}
                    {letter.recipient && <span>To: {letter.recipient}</span>}
                  </div>
                  {letter.hook && <p className="letter-hook">{letter.hook}</p>}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <Footer />
    </div>
  );
}
