import {
  StrictMode,
  type ReactNode,
} from "react";
import {
  act,
  renderHook,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DashboardCommittedQuerySource } from "../dashboardQueryModel";
import type { PersistedState } from "../types";
import { useDashboardFilters } from "../useDashboardFilters";

function strictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

function makePersistedState(
  overrides: Partial<PersistedState> = {},
): PersistedState {
  return {
    visibilityFilter: "PUBLISHED",
    collectionFilter: "003,019",
    searchQuery: "starting search",
    sortColumns: [{ field: "lastOpenedAt", direction: "desc" }],
    dateMode: "specific",
    year: 1886,
    month: 3,
    day: 14,
    dateFrom: null,
    dateTo: null,
    transcriptStatusFilters: ["AI_DRAFT"],
    metadataStatusFilters: ["EDITED"],
    extraContentStatusFilters: ["VERIFIED"],
    workflowFilters: ["METADATA_DRAFTED"],
    flaggedFilter: "FLAGGED",
    missingFilters: ["sender"],
    contentShapeFilters: ["photos"],
    ...overrides,
  };
}

function renderFilters(initialPersistedState = makePersistedState()) {
  return renderHook(
    () => useDashboardFilters(initialPersistedState),
    { wrapper: strictModeWrapper },
  );
}

function expectClearedQuery(query: DashboardCommittedQuerySource) {
  expect(query).toEqual({
    collectionFilter: "all",
    visibilityFilter: "ALL",
    searchQuery: "",
    yearFilter: null,
    monthFilter: null,
    dayFilter: null,
    dateFromFilter: null,
    dateToFilter: null,
    transcriptStatusFilters: [],
    metadataStatusFilters: [],
    extraContentStatusFilters: [],
    workflowFilters: [],
    flaggedFilter: "ALL",
    missingFilters: [],
    contentShapeFilters: [],
  });
}

describe("useDashboardFilters", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("exposes only explicit state, draft, and intent-action owners", () => {
    const { result } = renderFilters();

    expect(Object.keys(result.current).sort()).toEqual([
      "actions",
      "drafts",
      "state",
    ]);
    expect(result.current.state.query.searchQuery).toBe("starting search");
    expect(result.current.drafts).toEqual({
      searchInput: "starting search",
      collectionInput: "",
      contentFilterView: "transcript",
    });
  });

  it("commits a draft search after exactly 300 ms", () => {
    const { result } = renderFilters();
    const initialQuery = result.current.state.query;

    act(() => {
      result.current.actions.changeSearchInput("pending search");
    });

    expect(result.current.drafts.searchInput).toBe("pending search");
    expect(result.current.state.query).toBe(initialQuery);

    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(result.current.state.query).toBe(initialQuery);
    expect(result.current.state.query.searchQuery).toBe("starting search");

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.state.query).not.toBe(initialQuery);
    expect(result.current.state.query.searchQuery).toBe("pending search");
  });

  it("clears committed search immediately and cancels an older pending draft", () => {
    const { result } = renderFilters();

    act(() => {
      result.current.actions.changeSearchInput("stale pending search");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.actions.clearSearch();
    });

    const queryAfterClear = result.current.state.query;
    expect(result.current.drafts.searchInput).toBe("");
    expect(queryAfterClear.searchQuery).toBe("");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.state.query).toBe(queryAfterClear);
    expect(result.current.state.query.searchQuery).toBe("");
  });

  it("lets stored replacement win over a pending search and synchronizes its draft", () => {
    const { result } = renderFilters();
    const replacement = makePersistedState({
      visibilityFilter: "HIDDEN",
      collectionFilter: "777",
      searchQuery: "saved view search",
      dateMode: "range",
      year: null,
      month: null,
      day: null,
      dateFrom: "18860101",
      dateTo: "18861231",
    });

    act(() => {
      result.current.actions.changeSearchInput("stale pending search");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.actions.replaceStoredFilters(replacement);
    });

    const queryAfterReplacement = result.current.state.query;
    expect(result.current.drafts.searchInput).toBe("saved view search");
    expect(result.current.state.dateMode).toBe("range");
    expect(queryAfterReplacement).toMatchObject({
      visibilityFilter: "HIDDEN",
      collectionFilter: "777",
      searchQuery: "saved view search",
      yearFilter: null,
      monthFilter: null,
      dayFilter: null,
      dateFromFilter: "18860101",
      dateToFilter: "18861231",
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.state.query).toBe(queryAfterReplacement);
    expect(result.current.state.query.searchQuery).toBe("saved view search");
  });

  it("clears filters and pending drafts while preserving the content panel draft", () => {
    const { result } = renderFilters();

    act(() => {
      result.current.actions.changeCollectionInput("777");
      result.current.actions.changeContentFilterView("metadata");
      result.current.actions.changeSearchInput("stale pending search");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.actions.clearAllFilters();
    });

    const queryAfterClear = result.current.state.query;
    expect(result.current.state.dateMode).toBe("specific");
    expect(result.current.drafts).toEqual({
      searchInput: "",
      collectionInput: "",
      contentFilterView: "metadata",
    });
    expectClearedQuery(queryAfterClear);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.state.query).toBe(queryAfterClear);
    expectClearedQuery(result.current.state.query);
  });

  it("preserves committed query identity across draft-only changes", () => {
    const { result } = renderFilters();
    const initialQuery = result.current.state.query;

    act(() => {
      result.current.actions.changeSearchInput("uncommitted search");
      result.current.actions.changeCollectionInput("collection 777");
      result.current.actions.changeContentFilterView("extras");
    });

    expect(result.current.drafts).toEqual({
      searchInput: "uncommitted search",
      collectionInput: "777",
      contentFilterView: "extras",
    });
    expect(result.current.state.query).toBe(initialQuery);
  });

  it("changes an empty date mode without replacing committed query identity", () => {
    const { result } = renderFilters(makePersistedState({
      year: null,
      month: null,
      day: null,
    }));
    const initialQuery = result.current.state.query;

    act(() => {
      result.current.actions.changeDateMode("range");
    });

    expect(result.current.state.dateMode).toBe("range");
    expect(result.current.state.query).toBe(initialQuery);

    const queryAfterFirstChange = result.current.state.query;
    act(() => {
      result.current.actions.changeDateMode("range");
    });

    expect(result.current.state.query).toBe(queryAfterFirstChange);
  });
});
