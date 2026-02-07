import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import LetterDisplay from "../components/LetterDisplay/LetterDisplay";
import { getLetterById } from "../api/letters";
import type { Letter } from "../types/Letter";

export default function LetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();
  const [letter, setLetter] = useState<Letter | null>(null);
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
        const data = await getLetterById(letterId!);
        setLetter(data);
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
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error || !letter) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <h1>{error || "Letter not found"}</h1>
        <button className="btn-secondary" onClick={() => navigate("/")}>Back to Home</button>
      </div>
    );
  }

  return (
    <div>
      <LetterDisplay letter={letter} />
    </div>
  );
}
