import { describe, expect, it } from "vitest";
import type { ContentStatus, WorkflowState } from "../../../../types/Letter";
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_DASHBOARD_SORT,
  DEFAULT_VISIBLE_COLUMNS,
  MAX_DASHBOARD_SEARCH_LENGTH,
  MAX_DASHBOARD_SORT_RULES,
  MAX_SAVED_DASHBOARD_VIEWS,
  SERVER_SORT_FIELDS,
} from "../constants";
import type { DashboardCommittedQuery } from "../dashboardQueryModel";
import {
  createDashboardStoredState,
  createDashboardViewState,
  decodeDashboardColumnState,
  decodeDashboardStoredState,
  decodeDashboardViewState,
  decodeSavedDashboardViews,
} from "../dashboardStoredStateModel";
import type {
  ColumnId,
  DashboardViewState,
  PersistedState,
  SortColumn,
} from "../types";

function defaultStoredState(
  overrides: Partial<PersistedState> = {},
): PersistedState {
  return {
    visibilityFilter: "ALL",
    collectionFilter: "all",
    searchQuery: "",
    sortColumns: [{ ...DEFAULT_DASHBOARD_SORT }],
    dateMode: "specific",
    year: null,
    month: null,
    day: null,
    dateFrom: null,
    dateTo: null,
    transcriptStatusFilters: [],
    metadataStatusFilters: [],
    extraContentStatusFilters: [],
    workflowFilters: [],
    flaggedFilter: "ALL",
    missingFilters: [],
    contentShapeFilters: [],
    ...overrides,
  };
}

describe("dashboard stored-state model", () => {
  it("decodes partial persisted state into one complete owned state", () => {
    const decoded = decodeDashboardStoredState({
      visibilityFilter: "PUBLISHED",
      collectionFilter: "003,019",
      searchQuery: "molly",
      year: 1886,
    });

    expect(decoded).toEqual(defaultStoredState({
      visibilityFilter: "PUBLISHED",
      collectionFilter: "003,019",
      searchQuery: "molly",
      year: 1886,
    }));

    const anotherDefault = decodeDashboardStoredState(undefined);
    expect(anotherDefault).toEqual(defaultStoredState());
    expect(anotherDefault.sortColumns).not.toBe(decoded.sortColumns);
    expect(anotherDefault.transcriptStatusFilters).not.toBe(
      decoded.transcriptStatusFilters,
    );
    expect(anotherDefault.workflowFilters).not.toBe(decoded.workflowFilters);
  });

  it("normalizes hostile JSON-valid fields, enums, arrays, sorts, and dates", () => {
    const decoded = decodeDashboardStoredState({
      visibilityFilter: "PRIVATE",
      collectionFilter: "abc,001,001,000,019x",
      searchQuery: { nested: "not a string" },
      sortColumns: [
        { field: "sender", direction: "sideways" },
        { field: "not-a-sort-field", direction: "asc" },
        { field: "createdAt", direction: "desc" },
        null,
        "lastOpenedAt:asc",
      ],
      dateMode: "between",
      year: 1886.5,
      month: 13,
      day: 0,
      dateFrom: "18860101",
      dateTo: "not-a-dashboard-date",
      transcriptStatusFilters: ["EMPTY", "BOGUS", "EMPTY", 7],
      metadataStatusFilters: "VERIFIED",
      extraContentStatusFilters: [null, "VERIFIED", "VERIFIED"],
      workflowFilters: ["UPLOADED", "NOT_A_WORKFLOW", "UPLOADED"],
      flaggedFilter: true,
      missingFilters: ["sender", "something-else", "sender"],
      contentShapeFilters: ["photos", "unknown-shape", "voice", "photos"],
    });

    expect(decoded).toEqual(defaultStoredState({
      collectionFilter: "001,019",
      sortColumns: [{ field: "createdAt", direction: "desc" }],
      transcriptStatusFilters: ["EMPTY"],
      extraContentStatusFilters: ["VERIFIED"],
      workflowFilters: ["UPLOADED"],
      missingFilters: ["sender"],
      contentShapeFilters: ["photos", "voice"],
    }));
  });

  it("keeps only the active date mode's valid fields", () => {
    expect(decodeDashboardStoredState({
      dateMode: "range",
      year: 1886,
      month: 3,
      day: 14,
      dateFrom: "18860101",
      dateTo: "18861301",
    })).toEqual(defaultStoredState({
      dateMode: "range",
      dateFrom: "18860101",
    }));
  });

  it("caps otherwise valid sort rules at the server contract limit", () => {
    const sortColumns = SERVER_SORT_FIELDS
      .slice(0, MAX_DASHBOARD_SORT_RULES + 1)
      .map((field) => ({ field, direction: "asc" }));

    expect(decodeDashboardStoredState({ sortColumns }).sortColumns).toEqual(
      sortColumns.slice(0, MAX_DASHBOARD_SORT_RULES),
    );
  });

  it("bounds stored searches before they can enter a request URL", () => {
    const searchQuery = "x".repeat(MAX_DASHBOARD_SEARCH_LENGTH + 20);

    expect(
      decodeDashboardStoredState({ searchQuery }).searchQuery,
    ).toBe(searchQuery.slice(0, MAX_DASHBOARD_SEARCH_LENGTH));
  });

  it("decodes standalone column storage through the same column contract", () => {
    expect(decodeDashboardColumnState({
      visible: "sender",
      known: DEFAULT_COLUMN_ORDER,
      order: ["date", "date", "not-a-column"],
    })).toEqual({
      visibleColumns: [],
      columnOrder: [
        "date",
        ...DEFAULT_COLUMN_ORDER.filter((column) => column !== "date"),
      ],
    });
  });

  it("normalizes a partial legacy saved-view state before it reaches controls", () => {
    const decoded = decodeDashboardViewState({
      visibilityFilter: "HIDDEN",
      collectionFilter: "012",
      searchQuery: "jimmie",
      sortColumns: [{ field: "sender", direction: "asc" }],
      dateMode: "specific",
      year: 1947,
      transcriptStatusFilters: ["VERIFIED"],
      metadataStatusFilters: ["AI_DRAFT"],
      visibleColumns: ["recipient", "not-a-column", "visibility", "recipient"],
    });

    expect(decoded).toEqual({
      ...defaultStoredState({
        visibilityFilter: "HIDDEN",
        collectionFilter: "012",
        searchQuery: "jimmie",
        sortColumns: [{ field: "sender", direction: "asc" }],
        year: 1947,
        transcriptStatusFilters: ["VERIFIED"],
        metadataStatusFilters: ["AI_DRAFT"],
      }),
      visibleColumns: ["recipient", "visibility"],
      columnOrder: DEFAULT_COLUMN_ORDER,
    });
  });

  it("isolates malformed and null saved-view siblings instead of dropping valid views", () => {
    const decoded = decodeSavedDashboardViews([
      {
        id: "legacy-view",
        name: "Legacy cleanup",
        createdAt: "2026-01-01T00:00:00.000Z",
        state: {
          visibilityFilter: "PUBLISHED",
          visibleColumns: ["sender"],
        },
      },
      null,
      {
        id: "null-state",
        name: "Broken",
        createdAt: "2026-01-02T00:00:00.000Z",
        state: null,
      },
      {
        name: "Missing identity",
        createdAt: "2026-01-03T00:00:00.000Z",
        state: { visibleColumns: [] },
      },
      {
        id: "minimal-view",
        name: "Minimal cleanup",
        createdAt: "2026-01-04T00:00:00.000Z",
        state: { visibleColumns: [] },
      },
    ]);

    expect(decoded.map((view) => view.id)).toEqual([
      "legacy-view",
      "minimal-view",
    ]);
    expect(decoded[0]?.state).toEqual({
      ...defaultStoredState({ visibilityFilter: "PUBLISHED" }),
      visibleColumns: ["sender"],
      columnOrder: DEFAULT_COLUMN_ORDER,
    });
    expect(decoded[1]?.state).toEqual({
      ...defaultStoredState(),
      visibleColumns: [],
      columnOrder: DEFAULT_COLUMN_ORDER,
    });
  });

  it("rejects empty and duplicate saved-view identities and enforces the view cap", () => {
    const records = Array.from(
      { length: MAX_SAVED_DASHBOARD_VIEWS + 1 },
      (_, index) => ({
        id: `view-${index}`,
        name: `View ${index}`,
        createdAt: "2026-01-01T00:00:00.000Z",
        state: {},
      }),
    );

    const decoded = decodeSavedDashboardViews([
      { ...records[0], id: "" },
      { ...records[0], name: "   " },
      records[0],
      { ...records[0], name: "Duplicate" },
      ...records.slice(1),
    ]);

    expect(decoded).toHaveLength(MAX_SAVED_DASHBOARD_VIEWS);
    expect(decoded.map((view) => view.id)).toEqual(
      records
        .slice(0, MAX_SAVED_DASHBOARD_VIEWS)
        .map((view) => view.id),
    );
  });

  it("captures query, date mode, and columns with exact parity and no array aliases", () => {
    const transcriptStatusFilters: ContentStatus[] = ["EMPTY", "AI_DRAFT"];
    const metadataStatusFilters: ContentStatus[] = ["EDITED"];
    const extraContentStatusFilters: ContentStatus[] = ["VERIFIED"];
    const workflowFilters: WorkflowState[] = ["UPLOADED", "REVIEWED"];
    const missingFilters: PersistedState["missingFilters"] = ["sender", "date"];
    const contentShapeFilters: PersistedState["contentShapeFilters"] = [
      "extras",
      "photos",
    ];
    const sortColumns: SortColumn[] = [
      { field: "letters", direction: "asc" },
      { field: "createdAt", direction: "desc" },
    ];
    const query: DashboardCommittedQuery = {
      collectionFilter: "003,019",
      visibilityFilter: "PUBLISHED",
      searchQuery: "molly",
      yearFilter: null,
      monthFilter: null,
      dayFilter: null,
      dateFromFilter: "18860101",
      dateToFilter: "18861231",
      transcriptStatusFilters,
      metadataStatusFilters,
      extraContentStatusFilters,
      workflowFilters,
      flaggedFilter: "FLAGGED",
      missingFilters,
      contentShapeFilters,
      sortColumns,
    };

    const storedState = createDashboardStoredState(query, "range");

    expect(storedState).toEqual({
      visibilityFilter: "PUBLISHED",
      collectionFilter: "003,019",
      searchQuery: "molly",
      sortColumns,
      dateMode: "range",
      year: null,
      month: null,
      day: null,
      dateFrom: "18860101",
      dateTo: "18861231",
      transcriptStatusFilters,
      metadataStatusFilters,
      extraContentStatusFilters,
      workflowFilters,
      flaggedFilter: "FLAGGED",
      missingFilters,
      contentShapeFilters,
    });
    expect(storedState.sortColumns).not.toBe(sortColumns);
    expect(storedState.transcriptStatusFilters).not.toBe(
      transcriptStatusFilters,
    );
    expect(storedState.workflowFilters).not.toBe(workflowFilters);

    const visibleColumns = new Set<ColumnId>(["sender", "date"]);
    const columnOrder: ColumnId[] = [...DEFAULT_COLUMN_ORDER];
    const viewState = createDashboardViewState({
      storedState,
      visibleColumns,
      columnOrder,
    });

    expect(viewState).toEqual<DashboardViewState>({
      ...storedState,
      visibleColumns: ["sender", "date"],
      columnOrder,
    });
    expect(viewState.sortColumns).not.toBe(storedState.sortColumns);
    expect(viewState.transcriptStatusFilters).not.toBe(
      storedState.transcriptStatusFilters,
    );
    expect(viewState.visibleColumns).not.toBe(visibleColumns);
    expect(viewState.columnOrder).not.toBe(columnOrder);

    transcriptStatusFilters.push("VERIFIED");
    workflowFilters.push("TRANSCRIBED");
    sortColumns.push({ field: "sender", direction: "asc" });
    visibleColumns.add("recipient");
    columnOrder.reverse();

    expect(storedState.transcriptStatusFilters).toEqual(["EMPTY", "AI_DRAFT"]);
    expect(storedState.workflowFilters).toEqual(["UPLOADED", "REVIEWED"]);
    expect(storedState.sortColumns).toEqual([
      { field: "letters", direction: "asc" },
      { field: "createdAt", direction: "desc" },
    ]);
    expect(viewState.visibleColumns).toEqual(["sender", "date"]);
    expect(viewState.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("defaults missing saved-view columns to current Dashboard column defaults", () => {
    const decoded = decodeDashboardViewState({});

    expect(decoded.visibleColumns).toEqual(Array.from(DEFAULT_VISIBLE_COLUMNS));
    expect(decoded.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });
});
