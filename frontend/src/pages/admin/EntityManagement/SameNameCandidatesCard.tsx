interface SameNameCandidateBase {
  id: string;
  canonicalName: string;
  letterCount: number;
}

interface SameNameCandidatesCardProps<T extends SameNameCandidateBase> {
  title: string;
  note: string;
  candidates: T[];
  renderMeta: (candidate: T) => string;
  onSelect: (candidateId: string) => void;
}

export default function SameNameCandidatesCard<T extends SameNameCandidateBase>({
  title,
  note,
  candidates,
  renderMeta,
  onSelect,
}: SameNameCandidatesCardProps<T>) {
  if (candidates.length === 0) return null;

  return (
    <div className="detail-section disambiguation-section">
      <h3>{title}</h3>
      <p className="disambiguation-note">{note}</p>
      <div className="same-name-list">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className="same-name-item"
            onClick={() => onSelect(candidate.id)}
          >
            <span className="same-name-title">{candidate.canonicalName}</span>
            <span className="same-name-meta">{renderMeta(candidate)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
