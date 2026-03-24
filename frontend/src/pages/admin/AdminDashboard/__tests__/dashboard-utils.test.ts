import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  formatDateRaw,
  getCombinedTranscriptStatus,
  isServerSortField,
  loadPersistedState,
  savePersistedState,
} from "../utils";

describe("admin dashboard utils", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("detects server-sortable fields", () => {
    expect(isServerSortField("createdAt")).toBe(true);
    expect(isServerSortField("letters")).toBe(false);
  });

  it("combines transcript statuses for letter+extras correctly", () => {
    expect(getCombinedTranscriptStatus("VERIFIED", "VERIFIED", true, true)).toBe("VERIFIED");
    expect(getCombinedTranscriptStatus("EDITED", "VERIFIED", true, true)).toBe("EDITED");
    expect(getCombinedTranscriptStatus("AI_DRAFT", "EMPTY", true, false)).toBe("AI_DRAFT");
    expect(getCombinedTranscriptStatus("EMPTY", "EMPTY", false, false)).toBe("EMPTY");
  });

  it("formats YYYYMMDD dateRaw safely", () => {
    expect(formatDateRaw("18860314")).toBe("03/14/1886");
    expect(formatDateRaw(undefined)).toBe("—");
    expect(formatDateRaw("188603")).toBe("—");
  });

  it("persists and restores dashboard state", () => {
    const state = {
      visibilityFilter: "PUBLISHED" as const,
      collectionFilter: "001",
      searchQuery: "molly",
      sortColumns: [{ field: "createdAt" as const, direction: "desc" as const }],
      dateMode: "specific" as const,
      year: 1886,
      month: 3,
      day: 14,
      dateFrom: null,
      dateTo: null,
      transcriptStatusFilters: [],
      metadataStatusFilters: [],
    };

    savePersistedState(state);
    expect(loadPersistedState()).toMatchObject(state);
  });

  it("returns empty object when local storage is invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem("adminDashboardState", "not-json");

    expect(loadPersistedState()).toEqual({});
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
