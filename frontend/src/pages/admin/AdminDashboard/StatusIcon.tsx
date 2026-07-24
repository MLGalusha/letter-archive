import type { ContentStatus } from "../../../types/Letter";

interface StatusIconProps {
  status: ContentStatus;
  type: "T" | "M";
}

export function StatusIcon({ status, type }: StatusIconProps) {
  const title = type === "T" ? "Transcript" : "Metadata";

  switch (status) {
    case "EMPTY":
      return (
        <span className="status-icon status-empty" title={`${title}: Empty`}>
          —
        </span>
      );
    case "AI_DRAFT":
      return (
        <span className="status-icon status-draft" title={`${title}: Draft`}>
          Draft
        </span>
      );
    case "EDITED":
      return (
        <span
          className={`status-icon status-edited status-edited-${type === "T" ? "transcript" : "metadata"}`}
          title={`${title}: Edited`}
        >
          Edited
        </span>
      );
    case "VERIFIED":
      return (
        <span className="status-icon status-verified" title={`${title}: Verified`}>
          ✓
        </span>
      );
    default:
      return <span className="status-icon">—</span>;
  }
}
