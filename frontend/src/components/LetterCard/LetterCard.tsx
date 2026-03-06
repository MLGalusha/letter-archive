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

export default function LetterCard({
  id,
  date,
  location,
  sender,
  recipient,
  hook,
  onClick,
}: LetterCardProps) {
  // Extract tags from hook or location for display
  const getTags = () => {
    const tags: string[] = [];

    // You can customize this logic to derive tags from the letter content
    if (hook?.toLowerCase().includes("farm")) tags.push("Farming");
    if (hook?.toLowerCase().includes("family")) tags.push("Family");
    if (hook?.toLowerCase().includes("mine") || hook?.toLowerCase().includes("work")) tags.push("Labor");
    if (hook?.toLowerCase().includes("injury") || hook?.toLowerCase().includes("health")) tags.push("Health");
    if (hook?.toLowerCase().includes("cost") || hook?.toLowerCase().includes("expense")) tags.push("Economy");
    if (hook?.toLowerCase().includes("household") || hook?.toLowerCase().includes("domestic")) tags.push("Domestic Life");
    if (hook?.toLowerCase().includes("employment") || hook?.toLowerCase().includes("job")) tags.push("Employment");
    if (hook?.toLowerCase().includes("moving") || hook?.toLowerCase().includes("travel")) tags.push("Migration");
    if (hook?.toLowerCase().includes("bank") || hook?.toLowerCase().includes("savings")) tags.push("Great Depression");
    if (hook?.toLowerCase().includes("ration") || hook?.toLowerCase().includes("war")) tags.push("Wartime");

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