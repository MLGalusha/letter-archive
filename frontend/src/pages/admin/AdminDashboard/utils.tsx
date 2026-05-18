import type { ContentStatus } from "../../../types/Letter";
import type { AdminLetterQueryParams } from "../../../api/letters";
import { MONTH_OPTIONS, SAVED_VIEWS_STORAGE_KEY, SERVER_SORT_FIELDS, STORAGE_KEY } from "./constants";
import type {
  DateMode,
  ExtendedSortField,
  FlaggedFilter,
  PersistedState,
  SavedDashboardView,
  ServerSortField,
  SortColumn,
  VisibilityFilter,
} from "./types";

export function isServerSortField(
  field: ExtendedSortField,
): field is ServerSortField {
  return (SERVER_SORT_FIELDS as readonly string[]).includes(field);
}

interface DashboardLetterQueryOptions {
  page?: number;
  limit?: number;
  collectionFilter: string;
  visibilityFilter: VisibilityFilter;
  searchQuery: string;
  sortColumns: SortColumn[];
  defaultSort: SortColumn;
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  dateFromFilter: string | null;
  dateToFilter: string | null;
  transcriptStatusFilters: ContentStatus[];
  metadataStatusFilters: ContentStatus[];
  extraContentStatusFilters: ContentStatus[];
  workflowFilters: string[];
  flaggedFilter: FlaggedFilter;
}

export function buildDashboardLetterQuery({
  page,
  limit,
  collectionFilter,
  visibilityFilter,
  searchQuery,
  sortColumns,
  defaultSort,
  yearFilter,
  monthFilter,
  dayFilter,
  dateFromFilter,
  dateToFilter,
  transcriptStatusFilters,
  metadataStatusFilters,
  extraContentStatusFilters,
  workflowFilters,
  flaggedFilter,
}: DashboardLetterQueryOptions): AdminLetterQueryParams {
  const serverSort = [...sortColumns]
    .reverse()
    .find((col): col is SortColumn & { field: ServerSortField } => isServerSortField(col.field));
  const fallbackSortField = isServerSortField(defaultSort.field) ? defaultSort.field : undefined;

  return {
    page,
    limit,
    collection: collectionFilter === "all" ? undefined : collectionFilter,
    visibility: visibilityFilter !== "ALL" ? visibilityFilter : undefined,
    search: searchQuery || undefined,
    sort: serverSort ? serverSort.field : fallbackSortField,
    sortOrder: serverSort ? serverSort.direction : fallbackSortField ? defaultSort.direction : undefined,
    year: yearFilter ?? undefined,
    month: monthFilter ?? undefined,
    day: dayFilter ?? undefined,
    dateFrom: dateFromFilter ?? undefined,
    dateTo: dateToFilter ?? undefined,
    transcriptStatus: transcriptStatusFilters.length > 0 ? transcriptStatusFilters.join(",") : undefined,
    metadataStatus: metadataStatusFilters.length > 0 ? metadataStatusFilters.join(",") : undefined,
    extraContentStatus: extraContentStatusFilters.length > 0 ? extraContentStatusFilters.join(",") : undefined,
    workflow: workflowFilters.length > 0 ? workflowFilters.join(",") : undefined,
    flagged: flaggedFilter === "FLAGGED" ? "true" : flaggedFilter === "UNFLAGGED" ? "false" : undefined,
  };
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

export function formatDashboardDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function displayToDateRaw(display: string): string | null {
  if (!display) return null;
  const parts = display.split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  if (year.length !== 4 || !/^\d+$/.test(year)) return null;
  const m = Number(month);
  const d = Number(day);
  if (Number.isNaN(m) || Number.isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
}

export function dateRawToDisplay(dateRaw: string | null): string {
  if (!dateRaw || dateRaw.length < 8) return "";
  const year = dateRaw.slice(0, 4);
  const month = dateRaw.slice(4, 6);
  const day = dateRaw.slice(6, 8);
  return `${month}/${day}/${year}`;
}

export function getDashboardDateButtonText({
  dateMode,
  yearFilter,
  monthFilter,
  dayFilter,
  dateFromFilter,
  dateToFilter,
}: {
  dateMode: DateMode;
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  dateFromFilter: string | null;
  dateToFilter: string | null;
}) {
  if (dateMode === "specific") {
    const parts = [];
    if (yearFilter) parts.push(yearFilter);
    if (monthFilter) parts.push(MONTH_OPTIONS[monthFilter - 1]?.label);
    if (dayFilter) parts.push(dayFilter);
    return parts.length > 0 ? parts.join(" ") : "Date";
  }

  if (dateFromFilter || dateToFilter) {
    const from = dateFromFilter ? dateRawToDisplay(dateFromFilter) : "...";
    const to = dateToFilter ? dateRawToDisplay(dateToFilter) : "...";
    return `${from} - ${to}`;
  }

  return "Date";
}

export function loadPersistedState(): Partial<PersistedState> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PersistedState>;
      // Filter out any unknown sort fields that may be stale in localStorage
      if (parsed.sortColumns) {
        const validFields = new Set([...SERVER_SORT_FIELDS, 'letters', 'extras', 'photos']);
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

export function loadSavedDashboardViews(): SavedDashboardView[] {
  try {
    const saved = localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((view): view is SavedDashboardView =>
      typeof view?.id === "string" &&
      typeof view?.name === "string" &&
      typeof view?.createdAt === "string" &&
      typeof view?.state === "object" &&
      Array.isArray(view.state.visibleColumns),
    );
  } catch (error) {
    console.warn("Failed to load saved dashboard views:", error);
    return [];
  }
}

export function saveSavedDashboardViews(views: SavedDashboardView[]): void {
  try {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch (error) {
    console.warn("Failed to save dashboard views:", error);
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
