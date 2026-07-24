import type { ContentStatus, WorkflowState } from "../../../types/Letter";
import type { DashboardCommittedQuerySource } from "./dashboardQueryModel";
import {
  normalizeDashboardSearchQuery,
  parseDashboardCollectionFilter,
} from "./dashboardStoredStateModel";
import type {
  ContentShapeFilter,
  DateMode,
  FlaggedFilter,
  MissingFilter,
  PersistedState,
  VisibilityFilter,
} from "./types";

export interface DashboardFilterState {
  readonly query: DashboardCommittedQuerySource;
  readonly dateMode: DateMode;
}

export interface DashboardDateFilterValue {
  readonly dateMode: DateMode;
  readonly yearFilter: number | null;
  readonly monthFilter: number | null;
  readonly dayFilter: number | null;
  readonly dateFromFilter: string | null;
  readonly dateToFilter: string | null;
}

export type DashboardFilterAction =
  | {
    type: "toggleVisibility";
    value: Exclude<VisibilityFilter, "ALL">;
  }
  | { type: "clearVisibility" }
  | { type: "addCollection"; value: string }
  | { type: "removeCollection"; value: string }
  | { type: "clearCollections" }
  | { type: "commitSearch"; value: string }
  | { type: "clearSearch" }
  | { type: "changeDateMode"; value: DateMode }
  | { type: "changeYear"; value: number | null }
  | { type: "changeMonth"; value: number | null }
  | { type: "changeDay"; value: number | null }
  | { type: "changeDateFrom"; value: string | null }
  | { type: "changeDateTo"; value: string | null }
  | { type: "clearDate" }
  | { type: "toggleTranscriptStatus"; value: ContentStatus }
  | { type: "removeTranscriptStatus"; value: ContentStatus }
  | { type: "toggleMetadataStatus"; value: ContentStatus }
  | { type: "removeMetadataStatus"; value: ContentStatus }
  | { type: "toggleExtraContentStatus"; value: ContentStatus }
  | { type: "removeExtraContentStatus"; value: ContentStatus }
  | { type: "toggleWorkflow"; value: WorkflowState }
  | { type: "removeWorkflow"; value: WorkflowState }
  | {
    type: "toggleFlagged";
    value: Exclude<FlaggedFilter, "ALL">;
  }
  | { type: "clearFlagged" }
  | { type: "toggleMissing"; value: MissingFilter }
  | { type: "removeMissing"; value: MissingFilter }
  | { type: "toggleContentShape"; value: ContentShapeFilter }
  | { type: "removeContentShape"; value: ContentShapeFilter }
  | { type: "replaceStoredFilters"; value: PersistedState }
  | { type: "clearAllFilters" };

function arraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function queriesEqual(
  left: DashboardCommittedQuerySource,
  right: DashboardCommittedQuerySource,
): boolean {
  return left.collectionFilter === right.collectionFilter
    && left.visibilityFilter === right.visibilityFilter
    && left.searchQuery === right.searchQuery
    && left.yearFilter === right.yearFilter
    && left.monthFilter === right.monthFilter
    && left.dayFilter === right.dayFilter
    && left.dateFromFilter === right.dateFromFilter
    && left.dateToFilter === right.dateToFilter
    && arraysEqual(
      left.transcriptStatusFilters,
      right.transcriptStatusFilters,
    )
    && arraysEqual(
      left.metadataStatusFilters,
      right.metadataStatusFilters,
    )
    && arraysEqual(
      left.extraContentStatusFilters,
      right.extraContentStatusFilters,
    )
    && arraysEqual(left.workflowFilters, right.workflowFilters)
    && left.flaggedFilter === right.flaggedFilter
    && arraysEqual(left.missingFilters, right.missingFilters)
    && arraysEqual(left.contentShapeFilters, right.contentShapeFilters);
}

function replaceState(
  state: DashboardFilterState,
  query: DashboardCommittedQuerySource,
  dateMode = state.dateMode,
): DashboardFilterState {
  if (dateMode === state.dateMode && queriesEqual(query, state.query)) {
    return state;
  }

  return {
    query: queriesEqual(query, state.query) ? state.query : query,
    dateMode,
  };
}

function replaceQueryField<
  Key extends keyof DashboardCommittedQuerySource,
>(
  state: DashboardFilterState,
  key: Key,
  value: DashboardCommittedQuerySource[Key],
): DashboardFilterState {
  if (state.query[key] === value) return state;
  return replaceState(state, {
    ...state.query,
    [key]: value,
  });
}

function toggleArrayValue<T>(
  values: readonly T[],
  value: T,
): readonly T[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

function removeArrayValue<T>(
  values: readonly T[],
  value: T,
): readonly T[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : values;
}

function collectionFilterFromCodes(codes: readonly string[]): string {
  return codes.length > 0 ? codes.join(",") : "all";
}

function normalizeCollectionCode(value: string): string | null {
  return parseDashboardCollectionFilter(value)[0] ?? null;
}

function createQueryFromStoredState(
  storedState: PersistedState,
): DashboardCommittedQuerySource {
  const collectionCodes = parseDashboardCollectionFilter(
    storedState.collectionFilter,
  );
  return {
    collectionFilter: collectionFilterFromCodes(collectionCodes),
    visibilityFilter: storedState.visibilityFilter,
    searchQuery: normalizeDashboardSearchQuery(storedState.searchQuery),
    yearFilter: storedState.dateMode === "specific"
      ? storedState.year
      : null,
    monthFilter: storedState.dateMode === "specific"
      ? storedState.month
      : null,
    dayFilter: storedState.dateMode === "specific"
      ? storedState.day
      : null,
    dateFromFilter: storedState.dateMode === "range"
      ? storedState.dateFrom
      : null,
    dateToFilter: storedState.dateMode === "range"
      ? storedState.dateTo
      : null,
    transcriptStatusFilters: [...storedState.transcriptStatusFilters],
    metadataStatusFilters: [...storedState.metadataStatusFilters],
    extraContentStatusFilters: [...storedState.extraContentStatusFilters],
    workflowFilters: [...storedState.workflowFilters],
    flaggedFilter: storedState.flaggedFilter,
    missingFilters: [...storedState.missingFilters],
    contentShapeFilters: [...storedState.contentShapeFilters],
  };
}

function createEmptyQuery(): DashboardCommittedQuerySource {
  return {
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
}

export function createDashboardFilterState(
  storedState: PersistedState,
): DashboardFilterState {
  return {
    query: createQueryFromStoredState(storedState),
    dateMode: storedState.dateMode,
  };
}

export function getDashboardCollectionFilters(
  state: DashboardFilterState,
): string[] {
  return parseDashboardCollectionFilter(state.query.collectionFilter);
}

export function getDashboardDateFilterValue(
  state: DashboardFilterState,
): DashboardDateFilterValue {
  return {
    dateMode: state.dateMode,
    yearFilter: state.query.yearFilter,
    monthFilter: state.query.monthFilter,
    dayFilter: state.query.dayFilter,
    dateFromFilter: state.query.dateFromFilter,
    dateToFilter: state.query.dateToFilter,
  };
}

export function hasDashboardDateFilter(
  state: DashboardFilterState,
): boolean {
  const query = state.query;
  return query.yearFilter !== null
    || query.monthFilter !== null
    || query.dayFilter !== null
    || query.dateFromFilter !== null
    || query.dateToFilter !== null;
}

export function dashboardFilterReducer(
  state: DashboardFilterState,
  action: DashboardFilterAction,
): DashboardFilterState {
  switch (action.type) {
    case "toggleVisibility":
      return replaceQueryField(
        state,
        "visibilityFilter",
        state.query.visibilityFilter === action.value
          ? "ALL"
          : action.value,
      );
    case "clearVisibility":
      return replaceQueryField(state, "visibilityFilter", "ALL");
    case "addCollection": {
      const code = normalizeCollectionCode(action.value);
      if (code === null) return state;
      const current = getDashboardCollectionFilters(state);
      if (current.includes(code)) return state;
      return replaceQueryField(
        state,
        "collectionFilter",
        collectionFilterFromCodes([...current, code]),
      );
    }
    case "removeCollection": {
      const code = normalizeCollectionCode(action.value);
      if (code === null) return state;
      const current = getDashboardCollectionFilters(state);
      if (!current.includes(code)) return state;
      return replaceQueryField(
        state,
        "collectionFilter",
        collectionFilterFromCodes(
          current.filter((currentCode) => currentCode !== code),
        ),
      );
    }
    case "clearCollections":
      return replaceQueryField(state, "collectionFilter", "all");
    case "commitSearch":
      return replaceQueryField(
        state,
        "searchQuery",
        normalizeDashboardSearchQuery(action.value),
      );
    case "clearSearch":
      return replaceQueryField(state, "searchQuery", "");
    case "changeDateMode": {
      if (action.value === state.dateMode) return state;
      if (action.value === "specific") {
        return replaceState(state, {
          ...state.query,
          dateFromFilter: null,
          dateToFilter: null,
        }, action.value);
      }
      return replaceState(state, {
        ...state.query,
        yearFilter: null,
        monthFilter: null,
        dayFilter: null,
      }, action.value);
    }
    case "changeYear":
      return state.dateMode === "specific"
        ? replaceQueryField(state, "yearFilter", action.value)
        : state;
    case "changeMonth":
      return state.dateMode === "specific"
        ? replaceQueryField(state, "monthFilter", action.value)
        : state;
    case "changeDay":
      return state.dateMode === "specific"
        ? replaceQueryField(state, "dayFilter", action.value)
        : state;
    case "changeDateFrom":
      return state.dateMode === "range"
        ? replaceQueryField(state, "dateFromFilter", action.value)
        : state;
    case "changeDateTo":
      return state.dateMode === "range"
        ? replaceQueryField(state, "dateToFilter", action.value)
        : state;
    case "clearDate":
      return replaceState(state, {
        ...state.query,
        yearFilter: null,
        monthFilter: null,
        dayFilter: null,
        dateFromFilter: null,
        dateToFilter: null,
      });
    case "toggleTranscriptStatus":
      return replaceQueryField(
        state,
        "transcriptStatusFilters",
        toggleArrayValue(
          state.query.transcriptStatusFilters,
          action.value,
        ),
      );
    case "removeTranscriptStatus":
      return replaceQueryField(
        state,
        "transcriptStatusFilters",
        removeArrayValue(
          state.query.transcriptStatusFilters,
          action.value,
        ),
      );
    case "toggleMetadataStatus":
      return replaceQueryField(
        state,
        "metadataStatusFilters",
        toggleArrayValue(
          state.query.metadataStatusFilters,
          action.value,
        ),
      );
    case "removeMetadataStatus":
      return replaceQueryField(
        state,
        "metadataStatusFilters",
        removeArrayValue(
          state.query.metadataStatusFilters,
          action.value,
        ),
      );
    case "toggleExtraContentStatus":
      return replaceQueryField(
        state,
        "extraContentStatusFilters",
        toggleArrayValue(
          state.query.extraContentStatusFilters,
          action.value,
        ),
      );
    case "removeExtraContentStatus":
      return replaceQueryField(
        state,
        "extraContentStatusFilters",
        removeArrayValue(
          state.query.extraContentStatusFilters,
          action.value,
        ),
      );
    case "toggleWorkflow":
      return replaceQueryField(
        state,
        "workflowFilters",
        toggleArrayValue(state.query.workflowFilters, action.value),
      );
    case "removeWorkflow":
      return replaceQueryField(
        state,
        "workflowFilters",
        removeArrayValue(state.query.workflowFilters, action.value),
      );
    case "toggleFlagged":
      return replaceQueryField(
        state,
        "flaggedFilter",
        state.query.flaggedFilter === action.value
          ? "ALL"
          : action.value,
      );
    case "clearFlagged":
      return replaceQueryField(state, "flaggedFilter", "ALL");
    case "toggleMissing":
      return replaceQueryField(
        state,
        "missingFilters",
        toggleArrayValue(state.query.missingFilters, action.value),
      );
    case "removeMissing":
      return replaceQueryField(
        state,
        "missingFilters",
        removeArrayValue(state.query.missingFilters, action.value),
      );
    case "toggleContentShape":
      return replaceQueryField(
        state,
        "contentShapeFilters",
        toggleArrayValue(
          state.query.contentShapeFilters,
          action.value,
        ),
      );
    case "removeContentShape":
      return replaceQueryField(
        state,
        "contentShapeFilters",
        removeArrayValue(
          state.query.contentShapeFilters,
          action.value,
        ),
      );
    case "replaceStoredFilters":
      return replaceState(
        state,
        createQueryFromStoredState(action.value),
        action.value.dateMode,
      );
    case "clearAllFilters":
      return replaceState(state, createEmptyQuery(), "specific");
  }
}
