import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildDashboardLetterQuery,
  formatDateRaw,
  getCombinedTranscriptStatus,
  isServerSortField,
  loadPersistedState,
  loadSavedDashboardViews,
  savePersistedState,
  saveSavedDashboardViews,
} from "../utils";
import { DEFAULT_DASHBOARD_SORT } from "../constants";
import type { SavedDashboardView } from "../types";

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

  it("builds API query params from dashboard filters", () => {
    expect(buildDashboardLetterQuery({
      collectionFilter: "003",
      visibilityFilter: "PUBLISHED",
      searchQuery: "molly",
      sortColumns: [
        { field: "letters", direction: "asc" },
        { field: "createdAt", direction: "desc" },
      ],
      defaultSort: DEFAULT_DASHBOARD_SORT,
      yearFilter: 1886,
      monthFilter: null,
      dayFilter: null,
      dateFromFilter: null,
      dateToFilter: "18861231",
      transcriptStatusFilters: ["EMPTY", "AI_DRAFT"],
      metadataStatusFilters: [],
    })).toMatchObject({
      collection: "003",
      visibility: "PUBLISHED",
      search: "molly",
      sort: "createdAt",
      sortOrder: "desc",
      year: 1886,
      dateTo: "18861231",
      transcriptStatus: "EMPTY,AI_DRAFT",
    });
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

  it("persists and restores saved dashboard views", () => {
    const view: SavedDashboardView = {
      id: "view-1",
      name: "Needs transcript",
      createdAt: "2026-05-17T12:00:00.000Z",
      state: {
        visibilityFilter: "ALL" as const,
        collectionFilter: "all",
        searchQuery: "",
        sortColumns: [{ field: "lastOpenedAt" as const, direction: "desc" as const }],
        dateMode: "specific" as const,
        year: null,
        month: null,
        day: null,
        dateFrom: null,
        dateTo: null,
        transcriptStatusFilters: ["EMPTY"],
        metadataStatusFilters: [],
        visibleColumns: ["date", "collection", "visibility", "lastOpened"],
      },
    };

    saveSavedDashboardViews([view]);
    expect(loadSavedDashboardViews()).toEqual([view]);
  });

  it("ignores malformed saved dashboard views", () => {
    localStorage.setItem("adminDashboardSavedViews", JSON.stringify([
      { id: "missing-state", name: "Bad", createdAt: "2026-05-17T12:00:00.000Z" },
      {
        id: "valid",
        name: "Valid",
        createdAt: "2026-05-17T12:00:00.000Z",
        state: { visibleColumns: [] },
      },
    ]));

    expect(loadSavedDashboardViews()).toHaveLength(1);
    expect(loadSavedDashboardViews()[0]?.id).toBe("valid");
  });
});
