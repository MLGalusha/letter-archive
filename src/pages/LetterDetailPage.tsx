import { useParams, useNavigate } from "react-router-dom";
import LetterDisplay from "../components/LetterDisplay/LetterDisplay";
import { getLetterById } from "../data/mockLetters";

export default function LetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>();
  const navigate = useNavigate();

  if (!letterId) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <h1>Letter not found</h1>
        <button onClick={() => navigate("/")}>Back to Home</button>
      </div>
    );
  }

  const letter = getLetterById(letterId);

  if (!letter) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <h1>Letter not found</h1>
        <button onClick={() => navigate("/")}>Back to Home</button>
      </div>
    );
  }

  return (
    <div>
      <LetterDisplay letter={letter} />
    </div>
  );
}