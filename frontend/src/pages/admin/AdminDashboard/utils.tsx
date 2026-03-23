import type { ContentStatus } from "../../../types/Letter";
import { SERVER_SORT_FIELDS, STORAGE_KEY } from "./constants";
import type {
  ExtendedSortField,
  PersistedState,
  ServerSortField,
} from "./types";

export function isServerSortField(
  field: ExtendedSortField,
): field is ServerSortField {
  return (SERVER_SORT_FIELDS as readonly string[]).includes(field);
}

// Combine transcript + extra content status into a single status.
// Only considers sections that actually exist (have corresponding images).
export function getCombinedTranscriptStatus(
  transcriptStatus: ContentStatus,
  extraContentStatus: ContentStatus,
  hasLetterPages: boolean,
  hasExtras: boolean,
): ContentStatus {
  const statuses: ContentStatus[] = [];
  if (hasLetterPages) statuses.push(transcriptStatus);
  if (hasExtras) statuses.push(extraContentStatus);

  if (statuses.length === 0) return "EMPTY";
  if (statuses.length === 1) return statuses[0];
  if (statuses.every((status) => status === "VERIFIED")) return "VERIFIED";
  if (
    statuses.some((status) => status === "EDITED" || status === "VERIFIED") &&
    statuses.every((status) => status !== "EMPTY")
  ) {
    return "EDITED";
  }
  if (statuses.some((status) => status === "AI_DRAFT")) return "AI_DRAFT";
  return "EMPTY";
}

// Parse dateRaw into formatted MM/DD/YYYY string
export function formatDateRaw(dateRaw: string | undefined): string {
  if (!dateRaw || dateRaw.length !== 8) return "—";

  const year = dateRaw.slice(0, 4);
  const month = dateRaw.slice(4, 6);
  const day = dateRaw.slice(6, 8);
  return `${month}/${day}/${year}`;
}

export function loadPersistedState(): Partial<PersistedState> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PersistedState>;
      // Filter out any unknown sort fields that may be stale in localStorage
      if (parsed.sortColumns) {
        const validFields = new Set([...SERVER_SORT_FIELDS, 'letters', 'extras']);
        parsed.sortColumns = parsed.sortColumns.filter(
          sc => validFields.has(sc.field)
        );
      }
      return parsed;
    }
  } catch (error) {
    console.warn("Failed to load persisted state:", error);
  }
  return {};
}

export function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to save persisted state:", error);
  }
}

// Status icon component for two-track workflow.
export function StatusIcon({
  status,
  type,
}: {
  status: ContentStatus;
  type: "T" | "M";
}) {
  const titleMap = { T: "Transcript", M: "Metadata" };
  const title = titleMap[type];

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
        <span className={`status-icon status-edited status-edited-${type === "T" ? "transcript" : "metadata"}`} title={`${title}: Edited`}>
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
