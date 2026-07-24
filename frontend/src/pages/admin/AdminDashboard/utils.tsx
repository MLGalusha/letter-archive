import type { ContentStatus } from "../../../types/Letter";
import {
  MONTH_OPTIONS,
  SAVED_VIEWS_STORAGE_KEY,
  STORAGE_KEY,
} from "./constants";
import {
  decodeDashboardStoredState,
  decodeSavedDashboardViews,
} from "./dashboardStoredStateModel";
import type {
  DateMode,
  PersistedState,
  SavedDashboardView,
} from "./types";

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

export function loadPersistedState(): PersistedState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved
      ? decodeDashboardStoredState(JSON.parse(saved))
      : decodeDashboardStoredState(undefined);
  } catch (error) {
    console.warn("Failed to load persisted state:", error);
    return decodeDashboardStoredState(undefined);
  }
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
    return parseSavedDashboardViews(saved);
  } catch (error) {
    console.warn("Failed to load saved dashboard views:", error);
    return [];
  }
}

export function parseSavedDashboardViews(
  serializedViews: string | null,
): SavedDashboardView[] {
  if (!serializedViews) return [];
  try {
    return decodeSavedDashboardViews(JSON.parse(serializedViews));
  } catch (error) {
    console.warn("Failed to parse saved dashboard views:", error);
    return [];
  }
}

export function saveSavedDashboardViews(views: SavedDashboardView[]): boolean {
  try {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views));
    return true;
  } catch (error) {
    console.warn("Failed to save dashboard views:", error);
    return false;
  }
}
