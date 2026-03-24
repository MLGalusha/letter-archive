import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import SEO from "../components/SEO";
import LetterDisplay from "../components/LetterDisplay/LetterDisplay";
import { getAdjacentLetters, getLetterById, type AdjacentLettersResponse } from "../api/letters";
import type { Letter } from "../types/Letter";
import { buildLetterSeo } from "../utils/seo";
import "./LetterDetailPage.css";

export default function LetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const [letter, setLetter] = useState<Letter | null>(null);
  const [adjacent, setAdjacent] = useState<AdjacentLettersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const seo = useMemo(() => {
    return letter ? buildLetterSeo(letter) : null;
  }, [letter]);

  if (loading) {
    return (
      <div className="letter-detail-page">
        <p className="letter-loading">Loading letter...</p>
      </div>
    );
  }

  if (error || !letter) {
    return (
      <div className="letter-detail-page letter-detail-error">
        <h1>{error || "Letter not found"}</h1>
        <div className="letter-top-actions">
          <button className="detail-action-btn" onClick={() => navigate("/")}>Back to Home</button>
          <button className="detail-action-btn" onClick={() => navigate("/collections")}>Browse Collections</button>
        </div>
      </div>
    );
  }

  return (
    <div className="letter-detail-page">
      {seo && (
        <SEO
          title={seo.title}
          description={seo.description}
          ogImage={seo.ogImage}
          imageAlt={seo.imageAlt}
          ogType={seo.ogType}
          canonicalUrl={seo.canonicalPath}
          modifiedTime={seo.modifiedTime}
          jsonLd={seo.jsonLd}
        />
      )}
      <div className="letter-detail-header">
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
      </div>

      <LetterDisplay letter={letter} />
    </div>
  );
}
