import { memo } from "react";
import "../ArchiveList/ArchiveList.css";

interface LetterCardProps {
  id: string;
  date?: string;
  location?: string;
  sender?: string;
  recipient?: string;
  hook?: string;
  onClick: (id: string) => void;
}

function LetterCard({
  id,
  date,
  location,
  sender,
  recipient,
  hook,
  onClick,
}: LetterCardProps) {
  const people = sender && recipient
    ? `${sender} to ${recipient}`
    : sender || recipient || null;

  const label = people || "Unknown";

  return (
    <div
      className="letter-card"
      onClick={() => onClick(id)}
      role="button"
      tabIndex={0}
      aria-label={`Letter from ${label}, ${date || "unknown date"}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(id); } }}
    >
      {hook && <div className="letter-hook">{hook}</div>}
      <div className="letter-card-footer">
        {people && <span className="letter-byline">{people}</span>}
        <span className="letter-when">
          {date || "Unknown date"}
          {location && location !== "Unknown Location" && ` \u00b7 ${location}`}
        </span>
      </div>
    </div>
  );
}

export default memo(LetterCard);
