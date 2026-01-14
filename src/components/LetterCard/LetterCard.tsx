import "../ArchiveList/ArchiveList.css";

interface LetterCardProps {
  id: string;
  date?: string;
  location?: string;
  sender?: string;
  recipient?: string;
  description?: string;
  onClick: (id: string) => void;
}

export default function LetterCard({
  id,
  date,
  location,
  sender,
  recipient,
  description,
  onClick,
}: LetterCardProps) {
  // Extract tags from description or location for display
  const getTags = () => {
    const tags: string[] = [];

    // You can customize this logic to derive tags from the letter content
    if (description?.toLowerCase().includes("farm")) tags.push("Farming");
    if (description?.toLowerCase().includes("family")) tags.push("Family");
    if (description?.toLowerCase().includes("mine") || description?.toLowerCase().includes("work")) tags.push("Labor");
    if (description?.toLowerCase().includes("injury") || description?.toLowerCase().includes("health")) tags.push("Health");
    if (description?.toLowerCase().includes("cost") || description?.toLowerCase().includes("expense")) tags.push("Economy");
    if (description?.toLowerCase().includes("household") || description?.toLowerCase().includes("domestic")) tags.push("Domestic Life");
    if (description?.toLowerCase().includes("employment") || description?.toLowerCase().includes("job")) tags.push("Employment");
    if (description?.toLowerCase().includes("moving") || description?.toLowerCase().includes("travel")) tags.push("Migration");
    if (description?.toLowerCase().includes("bank") || description?.toLowerCase().includes("savings")) tags.push("Great Depression");
    if (description?.toLowerCase().includes("ration") || description?.toLowerCase().includes("war")) tags.push("Wartime");

    return tags.slice(0, 3); // Limit to 3 tags
  };

  const tags = getTags();

  return (
    <div className="letter-card" onClick={() => onClick(id)}>
      <div className="letter-date">{date || "Unknown Date"}</div>
      <div className="letter-location">{location || "Unknown Location"}</div>
      <div className="letter-people">
        {sender && recipient ? `${sender} → ${recipient}` : sender || recipient || "Unknown"}
      </div>
      {description && <div className="letter-summary">{description}</div>}
      {tags.length > 0 && (
        <div className="letter-tags">
          {tags.map((tag, index) => (
            <span key={index}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}