import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import LetterDisplay from "../components/LetterDisplay/LetterDisplay";
import Footer from "../components/Footer/Footer";
import { getAdjacentLetters, getLetterById, type AdjacentLettersResponse } from "../api/letters";
import type { Letter } from "../types/Letter";
import { buildLetterDiscoveryLinks } from "./letter-detail-utils";
import "./LetterDetailPage.css";

export default function LetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [adjacent, setAdjacent] = useState<AdjacentLettersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const discoveryLinks = useMemo(
    () => (letter ? buildLetterDiscoveryLinks(letter) : { persons: [], places: [] }),
    [letter],
  );

  useEffect(() => {
    if (!letterId) {
      setLoading(false);
      return;
    }

    async function fetchLetter() {
      setLoading(true);
      setError(null);
      try {
        const [data, adjacentData] = await Promise.all([
          getLetterById(letterId!),
          getAdjacentLetters(letterId!).catch(() => null),
        ]);
        setLetter(data);
        setAdjacent(adjacentData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Letter not found");
        console.error("Failed to fetch letter:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchLetter();
  }, [letterId]);

  if (loading) {
    return (
      <div className="body-layout">
        <div className="letter-detail-page">
          <p className="letter-loading">Loading letter...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (error || !letter) {
    return (
      <div className="body-layout">
        <div className="letter-detail-page">
          <h1>{error || "Letter not found"}</h1>
          <div className="letter-top-actions">
            <button className="detail-action-btn" onClick={() => navigate("/")}>Back to Home</button>
            <button className="detail-action-btn" onClick={() => navigate("/collections")}>Browse Collections</button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="body-layout">
      <div className="letter-detail-page">
        <div className="letter-top-actions">
          <button className="detail-action-btn" onClick={() => navigate(-1)}>
            Back
          </button>
          {letter.collectionCode && (
            <button
              className="detail-action-btn"
              onClick={() => navigate(`/collections/${letter.collectionCode}`)}
            >
              Collection {letter.collectionCode}
            </button>
          )}
          <button className="detail-action-btn" onClick={() => navigate("/explore")}>
            Explore Graph
          </button>
        </div>

        <section className="letter-discovery-panel">
          <div className="discovery-summary">
            <h1>{letter.metadata.date || letter.metadata.dateRaw || "Undated Letter"}</h1>
            {letter.metadata.hook && <p>{letter.metadata.hook}</p>}
            <div className="summary-meta">
              {letter.metadata.sender && <span>From: {letter.metadata.sender}</span>}
              {letter.metadata.recipient && <span>To: {letter.metadata.recipient}</span>}
              {letter.metadata.location && <span>Location: {letter.metadata.location}</span>}
            </div>
          </div>

          {adjacent && (
            <div className="adjacent-controls">
              <span>
                {adjacent.position != null
                  ? `Letter ${adjacent.position} of ${adjacent.total} in this collection`
                  : `${adjacent.total} letters in this collection`}
              </span>
              <div className="adjacent-buttons">
                <button
                  type="button"
                  className="detail-action-btn"
                  disabled={!adjacent.prev}
                  onClick={() => adjacent.prev && navigate(`/letter/${adjacent.prev}`)}
                >
                  Previous Letter
                </button>
                <button
                  type="button"
                  className="detail-action-btn"
                  disabled={!adjacent.next}
                  onClick={() => adjacent.next && navigate(`/letter/${adjacent.next}`)}
                >
                  Next Letter
                </button>
              </div>
            </div>
          )}

          {(discoveryLinks.persons.length > 0 || discoveryLinks.places.length > 0) && (
            <div className="discovery-links-grid">
              {discoveryLinks.persons.length > 0 && (
                <div className="discovery-link-group">
                  <h3>People In This Letter</h3>
                  <div className="discovery-link-list">
                    {discoveryLinks.persons.map((person) => (
                      <button
                        key={person.personId}
                        type="button"
                        className="discovery-link-btn"
                        onClick={() => navigate(`/people/${person.personId}`)}
                      >
                        <strong>{person.canonicalName}</strong>
                        <small>{person.roles.join(", ")}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {discoveryLinks.places.length > 0 && (
                <div className="discovery-link-group">
                  <h3>Places In This Letter</h3>
                  <div className="discovery-link-list">
                    {discoveryLinks.places.map((place) => (
                      <button
                        key={place.placeId}
                        type="button"
                        className="discovery-link-btn"
                        onClick={() => navigate(`/places/${place.placeId}`)}
                      >
                        <strong>{place.canonicalName}</strong>
                        <small>{place.roles.join(", ")}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <LetterDisplay letter={letter} />
      </div>
      <Footer />
    </div>
  );
}
