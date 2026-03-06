import { memo, useMemo } from "react";
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
  const tags = useMemo(() => {
    const result: string[] = [];
    const lower = hook?.toLowerCase();
    if (!lower) return result;

    if (lower.includes("farm")) result.push("Farming");
    if (lower.includes("family")) result.push("Family");
    if (lower.includes("mine") || lower.includes("work")) result.push("Labor");
    if (lower.includes("injury") || lower.includes("health")) result.push("Health");
    if (lower.includes("cost") || lower.includes("expense")) result.push("Economy");
    if (lower.includes("household") || lower.includes("domestic")) result.push("Domestic Life");
    if (lower.includes("employment") || lower.includes("job")) result.push("Employment");
    if (lower.includes("moving") || lower.includes("travel")) result.push("Migration");
    if (lower.includes("bank") || lower.includes("savings")) result.push("Great Depression");
    if (lower.includes("ration") || lower.includes("war")) result.push("Wartime");

    return result.slice(0, 3);
  }, [hook]);

  const label = [sender, recipient].filter(Boolean).join(" to ") || "Unknown";

  return (
    <div
      className="letter-card"
      onClick={() => onClick(id)}
      role="button"
      tabIndex={0}
      aria-label={`Letter from ${label}, ${date || "unknown date"}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(id); } }}
    >
      <div className="letter-date">{date || "Unknown Date"}</div>
      <div className="letter-location">{location || "Unknown Location"}</div>
      <div className="letter-people">
        {sender && recipient ? `${sender} → ${recipient}` : sender || recipient || "Unknown"}
      </div>
      {hook && <div className="letter-summary">{hook}</div>}
      {tags.length > 0 && (
        <div className="letter-tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(LetterCard);