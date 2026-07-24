import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_DASHBOARD_SORT,
} from "../constants";
import {
  dateRawToDisplay,
  displayToDateRaw,
  formatDashboardDateTime,
  formatDateRaw,
  getDashboardDateButtonText,
  getCombinedTranscriptStatus,
  loadPersistedState,
  loadSavedDashboardViews,
  savePersistedState,
  saveSavedDashboardViews,
} from "../utils";
import { isServerSortField } from "../dashboardQueryModel";
import type { SavedDashboardView } from "../types";

describe("admin dashboard utils", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("detects server-sortable fields", () => {
    expect(isServerSortField("createdAt")).toBe(true);
    expect(isServerSortField("letters")).toBe(true);
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

  it("formats dashboard timestamps for compact table display", () => {
    expect(formatDashboardDateTime("2026-03-30T21:14:00Z")).toEqual(
      expect.stringContaining("30"),
    );
  });

  it("parses and labels dashboard date filters", () => {
    expect(displayToDateRaw("03/14/1886")).toBe("18860314");
    expect(displayToDateRaw("3/4/1886")).toBe("18860304");
    expect(displayToDateRaw("not a date")).toBeNull();
    expect(dateRawToDisplay("18860314")).toBe("03/14/1886");

    expect(getDashboardDateButtonText({
      dateMode: "specific",
      yearFilter: 1886,
      monthFilter: 3,
      dayFilter: 14,
      dateFromFilter: null,
      dateToFilter: null,
    })).toBe("1886 Mar 14");

    expect(getDashboardDateButtonText({
      dateMode: "range",
      yearFilter: null,
      monthFilter: null,
      dayFilter: null,
      dateFromFilter: "18860314",
      dateToFilter: null,
    })).toBe("03/14/1886 - ...");
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
      extraContentStatusFilters: [],
      workflowFilters: [],
      flaggedFilter: "ALL" as const,
      missingFilters: [],
      contentShapeFilters: [],
    };

    savePersistedState(state);
    expect(loadPersistedState()).toMatchObject(state);
  });

  it("returns complete defaults when local storage is invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem("adminDashboardState", "not-json");

    expect(loadPersistedState()).toMatchObject({
      visibilityFilter: "ALL",
      collectionFilter: "all",
      sortColumns: [{ ...DEFAULT_DASHBOARD_SORT }],
    });
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
        extraContentStatusFilters: [],
        workflowFilters: ["UPLOADED"],
        flaggedFilter: "FLAGGED",
        missingFilters: [],
        contentShapeFilters: [],
        visibleColumns: ["date", "collection", "visibility", "lastOpened"],
        columnOrder: [
          "date",
          "collection",
          "visibility",
          "lastOpened",
          ...DEFAULT_COLUMN_ORDER.filter((column) => ![
            "date",
            "collection",
            "visibility",
            "lastOpened",
          ].includes(column)),
        ],
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
