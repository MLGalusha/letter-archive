import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ContentStatus, WorkflowState } from "../../../types/Letter";
import { normalizeDashboardSearchQuery } from "./dashboardStoredStateModel";
import {
  createDashboardFilterState,
  dashboardFilterReducer,
  type DashboardFilterState,
} from "./dashboardFilterStateModel";
import type {
  ContentFilterView,
  ContentShapeFilter,
  DateMode,
  FlaggedFilter,
  MissingFilter,
  PersistedState,
  VisibilityFilter,
} from "./types";

export interface DashboardFilterDrafts {
  readonly contentFilterView: ContentFilterView;
  readonly collectionInput: string;
  readonly searchInput: string;
}

export interface DashboardFilterActions {
  changeContentFilterView: (value: ContentFilterView) => void;
  changeCollectionInput: (value: string) => void;
  addCollectionFilter: () => void;
  removeCollectionFilter: (code: string) => void;
  clearCollectionFilters: () => void;
  changeSearchInput: (value: string) => void;
  clearSearch: () => void;
  toggleVisibilityFilter: (
    value: Exclude<VisibilityFilter, "ALL">,
  ) => void;
  clearVisibilityFilter: () => void;
  toggleTranscriptFilter: (value: ContentStatus) => void;
  removeTranscriptFilter: (value: ContentStatus) => void;
  toggleMetadataFilter: (value: ContentStatus) => void;
  removeMetadataFilter: (value: ContentStatus) => void;
  toggleExtraContentFilter: (value: ContentStatus) => void;
  removeExtraContentFilter: (value: ContentStatus) => void;
  toggleWorkflowFilter: (value: WorkflowState) => void;
  removeWorkflowFilter: (value: WorkflowState) => void;
  toggleFlaggedFilter: (
    value: Exclude<FlaggedFilter, "ALL">,
  ) => void;
  clearFlaggedFilter: () => void;
  toggleMissingFilter: (value: MissingFilter) => void;
  removeMissingFilter: (value: MissingFilter) => void;
  toggleContentShapeFilter: (value: ContentShapeFilter) => void;
  removeContentShapeFilter: (value: ContentShapeFilter) => void;
  changeDateMode: (value: DateMode) => void;
  changeYear: (value: number | null) => void;
  changeMonth: (value: number | null) => void;
  changeDay: (value: number | null) => void;
  changeDateFrom: (value: string | null) => void;
  changeDateTo: (value: string | null) => void;
  clearDateFilters: () => void;
  replaceStoredFilters: (state: PersistedState) => void;
  clearAllFilters: () => void;
}

export interface DashboardFilterController {
  readonly state: DashboardFilterState;
  readonly drafts: DashboardFilterDrafts;
  readonly actions: DashboardFilterActions;
}

export function useDashboardFilters(
  initialStoredState: PersistedState,
): DashboardFilterController {
  const [state, dispatch] = useReducer(
    dashboardFilterReducer,
    initialStoredState,
    createDashboardFilterState,
  );
  const [contentFilterView, setContentFilterView] =
    useState<ContentFilterView>("transcript");
  const [collectionInput, setCollectionInput] = useState("");
  const [searchInput, setSearchInput] = useState(
    initialStoredState.searchQuery,
  );
  const searchDebounceRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSearch = useCallback(() => {
    if (searchDebounceRef.current !== null) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    cancelPendingSearch();
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      dispatch({ type: "commitSearch", value: searchInput });
    }, 300);

    return cancelPendingSearch;
  }, [cancelPendingSearch, searchInput]);

  const actions = useMemo<DashboardFilterActions>(() => ({
    changeContentFilterView: (value) => setContentFilterView(value),
    changeCollectionInput: (value) => {
      setCollectionInput(value.replace(/\D/g, "").slice(0, 3));
    },
    addCollectionFilter: () => {
      const cleaned = collectionInput.replace(/\D/g, "").slice(0, 3);
      if (cleaned === "" || Number(cleaned) === 0) return;
      dispatch({ type: "addCollection", value: cleaned });
      setCollectionInput("");
    },
    removeCollectionFilter: (value) => {
      dispatch({ type: "removeCollection", value });
    },
    clearCollectionFilters: () => {
      dispatch({ type: "clearCollections" });
    },
    changeSearchInput: (value) => {
      setSearchInput(normalizeDashboardSearchQuery(value));
    },
    clearSearch: () => {
      cancelPendingSearch();
      setSearchInput("");
      dispatch({ type: "clearSearch" });
    },
    toggleVisibilityFilter: (value) => {
      dispatch({ type: "toggleVisibility", value });
    },
    clearVisibilityFilter: () => {
      dispatch({ type: "clearVisibility" });
    },
    toggleTranscriptFilter: (value) => {
      dispatch({ type: "toggleTranscriptStatus", value });
    },
    removeTranscriptFilter: (value) => {
      dispatch({ type: "removeTranscriptStatus", value });
    },
    toggleMetadataFilter: (value) => {
      dispatch({ type: "toggleMetadataStatus", value });
    },
    removeMetadataFilter: (value) => {
      dispatch({ type: "removeMetadataStatus", value });
    },
    toggleExtraContentFilter: (value) => {
      dispatch({ type: "toggleExtraContentStatus", value });
    },
    removeExtraContentFilter: (value) => {
      dispatch({ type: "removeExtraContentStatus", value });
    },
    toggleWorkflowFilter: (value) => {
      dispatch({ type: "toggleWorkflow", value });
    },
    removeWorkflowFilter: (value) => {
      dispatch({ type: "removeWorkflow", value });
    },
    toggleFlaggedFilter: (value) => {
      dispatch({ type: "toggleFlagged", value });
    },
    clearFlaggedFilter: () => {
      dispatch({ type: "clearFlagged" });
    },
    toggleMissingFilter: (value) => {
      dispatch({ type: "toggleMissing", value });
    },
    removeMissingFilter: (value) => {
      dispatch({ type: "removeMissing", value });
    },
    toggleContentShapeFilter: (value) => {
      dispatch({ type: "toggleContentShape", value });
    },
    removeContentShapeFilter: (value) => {
      dispatch({ type: "removeContentShape", value });
    },
    changeDateMode: (value) => {
      dispatch({ type: "changeDateMode", value });
    },
    changeYear: (value) => {
      dispatch({ type: "changeYear", value });
    },
    changeMonth: (value) => {
      dispatch({ type: "changeMonth", value });
    },
    changeDay: (value) => {
      dispatch({ type: "changeDay", value });
    },
    changeDateFrom: (value) => {
      dispatch({ type: "changeDateFrom", value });
    },
    changeDateTo: (value) => {
      dispatch({ type: "changeDateTo", value });
    },
    clearDateFilters: () => {
      dispatch({ type: "clearDate" });
    },
    replaceStoredFilters: (nextState) => {
      cancelPendingSearch();
      setCollectionInput("");
      setSearchInput(nextState.searchQuery);
      dispatch({ type: "replaceStoredFilters", value: nextState });
    },
    clearAllFilters: () => {
      cancelPendingSearch();
      setCollectionInput("");
      setSearchInput("");
      dispatch({ type: "clearAllFilters" });
    },
  }), [
    cancelPendingSearch,
    collectionInput,
  ]);

  return {
    state,
    drafts: {
      contentFilterView,
      collectionInput,
      searchInput,
    },
    actions,
  };
}
