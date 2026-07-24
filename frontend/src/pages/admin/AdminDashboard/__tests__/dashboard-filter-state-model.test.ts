import { describe, expect, it } from "vitest";
import type { DashboardCommittedQuerySource } from "../dashboardQueryModel";
import {
  createDashboardFilterState,
  dashboardFilterReducer,
  type DashboardFilterAction,
  type DashboardFilterState,
} from "../dashboardFilterStateModel";
import type { PersistedState } from "../types";

function persistedState(
  overrides: Partial<PersistedState> = {},
): PersistedState {
  return {
    visibilityFilter: "ALL",
    collectionFilter: "all",
    searchQuery: "",
    sortColumns: [{ field: "lastOpenedAt", direction: "desc" }],
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

function reduce(
  state: DashboardFilterState,
  ...actions: DashboardFilterAction[]
): DashboardFilterState {
  return actions.reduce(dashboardFilterReducer, state);
}

const EMPTY_QUERY: DashboardCommittedQuerySource = {
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
};

describe("dashboard filter state model", () => {
  it("maps persisted filters into one committed query and owns every array", () => {
    const stored = persistedState({
      visibilityFilter: "PUBLISHED",
      collectionFilter: "003,019",
      searchQuery: "molly",
      dateMode: "specific",
      year: 1886,
      month: 3,
      day: 14,
      // Inactive-mode values must never leak into the committed query.
      dateFrom: "18860101",
      dateTo: "18861231",
      transcriptStatusFilters: ["EMPTY", "AI_DRAFT"],
      metadataStatusFilters: ["EDITED"],
      extraContentStatusFilters: ["VERIFIED"],
      workflowFilters: ["UPLOADED", "REVIEWED"],
      flaggedFilter: "FLAGGED",
      missingFilters: ["sender", "date"],
      contentShapeFilters: ["extras", "photos"],
    });

    const state = createDashboardFilterState(stored);

    expect(state).toEqual({
      dateMode: "specific",
      query: {
        collectionFilter: "003,019",
        visibilityFilter: "PUBLISHED",
        searchQuery: "molly",
        yearFilter: 1886,
        monthFilter: 3,
        dayFilter: 14,
        dateFromFilter: null,
        dateToFilter: null,
        transcriptStatusFilters: ["EMPTY", "AI_DRAFT"],
        metadataStatusFilters: ["EDITED"],
        extraContentStatusFilters: ["VERIFIED"],
        workflowFilters: ["UPLOADED", "REVIEWED"],
        flaggedFilter: "FLAGGED",
        missingFilters: ["sender", "date"],
        contentShapeFilters: ["extras", "photos"],
      },
    });
    expect(state.query).not.toHaveProperty("sortColumns");
    expect(state.query.transcriptStatusFilters).not.toBe(
      stored.transcriptStatusFilters,
    );
    expect(state.query.metadataStatusFilters).not.toBe(
      stored.metadataStatusFilters,
    );
    expect(state.query.extraContentStatusFilters).not.toBe(
      stored.extraContentStatusFilters,
    );
    expect(state.query.workflowFilters).not.toBe(stored.workflowFilters);
    expect(state.query.missingFilters).not.toBe(stored.missingFilters);
    expect(state.query.contentShapeFilters).not.toBe(
      stored.contentShapeFilters,
    );

    stored.transcriptStatusFilters.push("VERIFIED");
    stored.metadataStatusFilters.push("EMPTY");
    stored.extraContentStatusFilters.push("AI_DRAFT");
    stored.workflowFilters.push("TRANSCRIBING");
    stored.missingFilters.push("recipient");
    stored.contentShapeFilters.push("voice");

    expect(state.query.transcriptStatusFilters).toEqual([
      "EMPTY",
      "AI_DRAFT",
    ]);
    expect(state.query.metadataStatusFilters).toEqual(["EDITED"]);
    expect(state.query.extraContentStatusFilters).toEqual(["VERIFIED"]);
    expect(state.query.workflowFilters).toEqual(["UPLOADED", "REVIEWED"]);
    expect(state.query.missingFilters).toEqual(["sender", "date"]);
    expect(state.query.contentShapeFilters).toEqual(["extras", "photos"]);
  });

  it("distinguishes toggle intent from idempotent scalar removal", () => {
    const cases = [
      {
        label: "visibility",
        key: "visibilityFilter" as const,
        empty: "ALL",
        first: "PUBLISHED",
        second: "HIDDEN",
        toggleFirst: {
          type: "toggleVisibility",
          value: "PUBLISHED",
        } satisfies DashboardFilterAction,
        toggleSecond: {
          type: "toggleVisibility",
          value: "HIDDEN",
        } satisfies DashboardFilterAction,
        clear: { type: "clearVisibility" } satisfies DashboardFilterAction,
      },
      {
        label: "flagged",
        key: "flaggedFilter" as const,
        empty: "ALL",
        first: "FLAGGED",
        second: "UNFLAGGED",
        toggleFirst: {
          type: "toggleFlagged",
          value: "FLAGGED",
        } satisfies DashboardFilterAction,
        toggleSecond: {
          type: "toggleFlagged",
          value: "UNFLAGGED",
        } satisfies DashboardFilterAction,
        clear: { type: "clearFlagged" } satisfies DashboardFilterAction,
      },
    ];

    for (const testCase of cases) {
      const initial = createDashboardFilterState(persistedState());
      const selected = dashboardFilterReducer(
        initial,
        testCase.toggleFirst,
      );
      expect(
        selected.query[testCase.key],
        `${testCase.label}: first toggle selects`,
      ).toBe(testCase.first);

      const toggledOff = dashboardFilterReducer(
        selected,
        testCase.toggleFirst,
      );
      expect(
        toggledOff.query[testCase.key],
        `${testCase.label}: second toggle deselects`,
      ).toBe(testCase.empty);

      const replaced = dashboardFilterReducer(
        selected,
        testCase.toggleSecond,
      );
      expect(
        replaced.query[testCase.key],
        `${testCase.label}: different toggle replaces`,
      ).toBe(testCase.second);

      const cleared = dashboardFilterReducer(replaced, testCase.clear);
      expect(
        cleared.query[testCase.key],
        `${testCase.label}: clear removes`,
      ).toBe(testCase.empty);
      expect(
        dashboardFilterReducer(cleared, testCase.clear),
        `${testCase.label}: repeated clear is an identity no-op`,
      ).toBe(cleared);
    }
  });

  it("adds, removes, deduplicates, and clears collections in stable order", () => {
    const initial = createDashboardFilterState(persistedState({
      collectionFilter: "003,019",
    }));

    const added = dashboardFilterReducer(initial, {
      type: "addCollection",
      value: "007",
    });
    expect(added.query.collectionFilter).toBe("003,019,007");

    const duplicate = dashboardFilterReducer(added, {
      type: "addCollection",
      value: "019",
    });
    expect(duplicate).toBe(added);
    expect(duplicate.query).toBe(added.query);

    const invalid = dashboardFilterReducer(added, {
      type: "addCollection",
      value: "000",
    });
    expect(invalid).toBe(added);

    const removed = dashboardFilterReducer(added, {
      type: "removeCollection",
      value: "019",
    });
    expect(removed.query.collectionFilter).toBe("003,007");

    const absentRemoval = dashboardFilterReducer(removed, {
      type: "removeCollection",
      value: "999",
    });
    expect(absentRemoval).toBe(removed);
    expect(absentRemoval.query).toBe(removed.query);

    const cleared = dashboardFilterReducer(removed, {
      type: "clearCollections",
    });
    expect(cleared.query.collectionFilter).toBe("all");
    expect(dashboardFilterReducer(cleared, {
      type: "clearCollections",
    })).toBe(cleared);
  });

  it("commits a bounded search and clears it idempotently", () => {
    const initial = createDashboardFilterState(persistedState());
    const oversizedSearch = "x".repeat(520);
    const committed = dashboardFilterReducer(initial, {
      type: "commitSearch",
      value: oversizedSearch,
    });

    expect(committed.query.searchQuery).toBe(oversizedSearch.slice(0, 500));
    expect(dashboardFilterReducer(committed, {
      type: "commitSearch",
      value: oversizedSearch,
    })).toBe(committed);

    const cleared = dashboardFilterReducer(committed, {
      type: "clearSearch",
    });
    expect(cleared.query.searchQuery).toBe("");
    expect(dashboardFilterReducer(cleared, {
      type: "clearSearch",
    })).toBe(cleared);
  });

  it("owns date-mode exclusivity and accepts fields only for the active mode", () => {
    const initial = createDashboardFilterState(persistedState());
    const specific = reduce(
      initial,
      { type: "changeYear", value: 1886 },
      { type: "changeMonth", value: 3 },
      { type: "changeDay", value: 14 },
    );

    expect(specific).toEqual({
      dateMode: "specific",
      query: {
        ...EMPTY_QUERY,
        yearFilter: 1886,
        monthFilter: 3,
        dayFilter: 14,
      },
    });
    expect(dashboardFilterReducer(specific, {
      type: "changeDateFrom",
      value: "18860101",
    })).toBe(specific);
    expect(dashboardFilterReducer(specific, {
      type: "changeDateTo",
      value: "18861231",
    })).toBe(specific);

    const range = dashboardFilterReducer(specific, {
      type: "changeDateMode",
      value: "range",
    });
    expect(range.dateMode).toBe("range");
    expect(range.query).toEqual(EMPTY_QUERY);

    const datedRange = reduce(
      range,
      { type: "changeDateFrom", value: "18860101" },
      { type: "changeDateTo", value: "18861231" },
    );
    expect(datedRange.query.dateFromFilter).toBe("18860101");
    expect(datedRange.query.dateToFilter).toBe("18861231");
    expect(dashboardFilterReducer(datedRange, {
      type: "changeYear",
      value: 1947,
    })).toBe(datedRange);
    expect(dashboardFilterReducer(datedRange, {
      type: "changeMonth",
      value: 6,
    })).toBe(datedRange);
    expect(dashboardFilterReducer(datedRange, {
      type: "changeDay",
      value: 7,
    })).toBe(datedRange);

    const specificAgain = dashboardFilterReducer(datedRange, {
      type: "changeDateMode",
      value: "specific",
    });
    expect(specificAgain.dateMode).toBe("specific");
    expect(specificAgain.query).toEqual(EMPTY_QUERY);

    const cleared = dashboardFilterReducer(specific, {
      type: "clearDate",
    });
    expect(cleared.dateMode).toBe("specific");
    expect(cleared.query).toEqual(EMPTY_QUERY);
    expect(dashboardFilterReducer(cleared, {
      type: "clearDate",
    })).toBe(cleared);
  });

  it("preserves committed-query identity for date-mode-only changes", () => {
    const initial = createDashboardFilterState(persistedState());
    const range = dashboardFilterReducer(initial, {
      type: "changeDateMode",
      value: "range",
    });

    expect(range).not.toBe(initial);
    expect(range.dateMode).toBe("range");
    expect(range.query).toBe(initial.query);

    const unchanged = dashboardFilterReducer(range, {
      type: "changeDateMode",
      value: "range",
    });
    expect(unchanged).toBe(range);
    expect(unchanged.query).toBe(range.query);

    const specific = dashboardFilterReducer(range, {
      type: "changeDateMode",
      value: "specific",
    });
    expect(specific).not.toBe(range);
    expect(specific.query).toBe(range.query);
  });

  it("gives each multi-value filter explicit toggle and removal transitions", () => {
    const cases: Array<{
      label: string;
      key:
        | "transcriptStatusFilters"
        | "metadataStatusFilters"
        | "extraContentStatusFilters"
        | "workflowFilters"
        | "missingFilters"
        | "contentShapeFilters";
      toggle: DashboardFilterAction;
      remove: DashboardFilterAction;
      value: string;
    }> = [
      {
        label: "transcript status",
        key: "transcriptStatusFilters",
        toggle: { type: "toggleTranscriptStatus", value: "AI_DRAFT" },
        remove: { type: "removeTranscriptStatus", value: "AI_DRAFT" },
        value: "AI_DRAFT",
      },
      {
        label: "metadata status",
        key: "metadataStatusFilters",
        toggle: { type: "toggleMetadataStatus", value: "EDITED" },
        remove: { type: "removeMetadataStatus", value: "EDITED" },
        value: "EDITED",
      },
      {
        label: "extra-content status",
        key: "extraContentStatusFilters",
        toggle: {
          type: "toggleExtraContentStatus",
          value: "VERIFIED",
        },
        remove: {
          type: "removeExtraContentStatus",
          value: "VERIFIED",
        },
        value: "VERIFIED",
      },
      {
        label: "workflow",
        key: "workflowFilters",
        toggle: { type: "toggleWorkflow", value: "METADATA_DRAFTED" },
        remove: { type: "removeWorkflow", value: "METADATA_DRAFTED" },
        value: "METADATA_DRAFTED",
      },
      {
        label: "missing metadata",
        key: "missingFilters",
        toggle: { type: "toggleMissing", value: "sender" },
        remove: { type: "removeMissing", value: "sender" },
        value: "sender",
      },
      {
        label: "content shape",
        key: "contentShapeFilters",
        toggle: { type: "toggleContentShape", value: "photos" },
        remove: { type: "removeContentShape", value: "photos" },
        value: "photos",
      },
    ];

    for (const testCase of cases) {
      const initial = createDashboardFilterState(persistedState());
      const selected = dashboardFilterReducer(initial, testCase.toggle);

      expect(
        selected.query[testCase.key],
        `${testCase.label}: toggle adds`,
      ).toEqual([testCase.value]);
      expect(selected.query[testCase.key]).not.toBe(
        initial.query[testCase.key],
      );

      const toggledOff = dashboardFilterReducer(
        selected,
        testCase.toggle,
      );
      expect(
        toggledOff.query[testCase.key],
        `${testCase.label}: toggle removes`,
      ).toEqual([]);

      const removed = dashboardFilterReducer(selected, testCase.remove);
      expect(
        removed.query[testCase.key],
        `${testCase.label}: explicit removal removes`,
      ).toEqual([]);
      expect(
        dashboardFilterReducer(removed, testCase.remove),
        `${testCase.label}: repeated removal is an identity no-op`,
      ).toBe(removed);
    }
  });

  it("replaces stored filters atomically without retaining external arrays", () => {
    const initial = createDashboardFilterState(persistedState({
      visibilityFilter: "HIDDEN",
      searchQuery: "old search",
      transcriptStatusFilters: ["EMPTY"],
    }));
    const replacement = persistedState({
      visibilityFilter: "PUBLISHED",
      collectionFilter: "007,012",
      searchQuery: "saved search",
      dateMode: "range",
      // Inactive specific-date values must be discarded on replacement.
      year: 1947,
      month: 6,
      day: 7,
      dateFrom: "19470101",
      dateTo: "19471231",
      transcriptStatusFilters: ["VERIFIED"],
      metadataStatusFilters: ["AI_DRAFT"],
      extraContentStatusFilters: ["EDITED"],
      workflowFilters: ["REVIEWED"],
      flaggedFilter: "UNFLAGGED",
      missingFilters: ["recipient"],
      contentShapeFilters: ["telegram"],
    });

    const replaced = dashboardFilterReducer(initial, {
      type: "replaceStoredFilters",
      value: replacement,
    });

    expect(replaced).toEqual({
      dateMode: "range",
      query: {
        collectionFilter: "007,012",
        visibilityFilter: "PUBLISHED",
        searchQuery: "saved search",
        yearFilter: null,
        monthFilter: null,
        dayFilter: null,
        dateFromFilter: "19470101",
        dateToFilter: "19471231",
        transcriptStatusFilters: ["VERIFIED"],
        metadataStatusFilters: ["AI_DRAFT"],
        extraContentStatusFilters: ["EDITED"],
        workflowFilters: ["REVIEWED"],
        flaggedFilter: "UNFLAGGED",
        missingFilters: ["recipient"],
        contentShapeFilters: ["telegram"],
      },
    });
    expect(replaced.query.transcriptStatusFilters).not.toBe(
      replacement.transcriptStatusFilters,
    );
    expect(replaced.query.metadataStatusFilters).not.toBe(
      replacement.metadataStatusFilters,
    );
    expect(replaced.query.extraContentStatusFilters).not.toBe(
      replacement.extraContentStatusFilters,
    );
    expect(replaced.query.workflowFilters).not.toBe(
      replacement.workflowFilters,
    );
    expect(replaced.query.missingFilters).not.toBe(
      replacement.missingFilters,
    );
    expect(replaced.query.contentShapeFilters).not.toBe(
      replacement.contentShapeFilters,
    );

    expect(dashboardFilterReducer(replaced, {
      type: "replaceStoredFilters",
      value: replacement,
    })).toBe(replaced);

    replacement.transcriptStatusFilters.push("EMPTY");
    replacement.metadataStatusFilters.push("VERIFIED");
    replacement.extraContentStatusFilters.push("AI_DRAFT");
    replacement.workflowFilters.push("UPLOADED");
    replacement.missingFilters.push("date");
    replacement.contentShapeFilters.push("voice");

    expect(replaced.query.transcriptStatusFilters).toEqual(["VERIFIED"]);
    expect(replaced.query.metadataStatusFilters).toEqual(["AI_DRAFT"]);
    expect(replaced.query.extraContentStatusFilters).toEqual(["EDITED"]);
    expect(replaced.query.workflowFilters).toEqual(["REVIEWED"]);
    expect(replaced.query.missingFilters).toEqual(["recipient"]);
    expect(replaced.query.contentShapeFilters).toEqual(["telegram"]);
  });

  it("clears every committed filter and resets the stored date mode", () => {
    const initial = createDashboardFilterState(persistedState({
      visibilityFilter: "PUBLISHED",
      collectionFilter: "003,019",
      searchQuery: "molly",
      dateMode: "range",
      dateFrom: "18860101",
      dateTo: "18861231",
      transcriptStatusFilters: ["EMPTY"],
      metadataStatusFilters: ["AI_DRAFT"],
      extraContentStatusFilters: ["EDITED"],
      workflowFilters: ["METADATA_DRAFTED"],
      flaggedFilter: "FLAGGED",
      missingFilters: ["sender"],
      contentShapeFilters: ["photos"],
    }));

    const cleared = dashboardFilterReducer(initial, {
      type: "clearAllFilters",
    });

    expect(cleared).toEqual({
      dateMode: "specific",
      query: EMPTY_QUERY,
    });
    expect(dashboardFilterReducer(cleared, {
      type: "clearAllFilters",
    })).toBe(cleared);
    expect(dashboardFilterReducer(cleared, {
      type: "clearAllFilters",
    }).query).toBe(cleared.query);
  });
});
