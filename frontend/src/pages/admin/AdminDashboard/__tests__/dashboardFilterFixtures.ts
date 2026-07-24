import { vi } from "vitest";
import type { DashboardCommittedQuerySource } from "../dashboardQueryModel";
import type { DashboardFilterState } from "../dashboardFilterStateModel";
import type {
  DashboardFilterActions,
  DashboardFilterDrafts,
} from "../useDashboardFilters";
import type { DashboardFilterStats, DateMode } from "../types";

export const emptyDashboardFilterStats: DashboardFilterStats = {
  total: 0,
  published: 0,
  hidden: 0,
  flagged: 0,
  uploaded: 0,
  transcribing: 0,
  transcribed: 0,
  metadataExtracting: 0,
  metadataReady: 0,
  reviewed: 0,
  transcriptEmpty: 0,
  transcriptAiDraft: 0,
  transcriptEdited: 0,
  transcriptVerified: 0,
  metadataEmpty: 0,
  metadataAiDraft: 0,
  metadataEdited: 0,
  metadataVerified: 0,
  extraContentEmpty: 0,
  extraContentAiDraft: 0,
  extraContentEdited: 0,
  extraContentVerified: 0,
  missingSender: 0,
  missingRecipient: 0,
  missingDate: 0,
  hasExtras: 0,
  hasPhotos: 0,
  hasCover: 0,
  hasTelegram: 0,
  hasCard: 0,
  hasEphemera: 0,
  hasArticle: 0,
  hasDiary: 0,
  hasVoice: 0,
};

export function makeDashboardFilterState({
  query = {},
  dateMode = "specific",
}: {
  query?: Partial<DashboardCommittedQuerySource>;
  dateMode?: DateMode;
} = {}): DashboardFilterState {
  return {
    query: {
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
      ...query,
    },
    dateMode,
  };
}

export function makeDashboardFilterDrafts(
  overrides: Partial<DashboardFilterDrafts> = {},
): DashboardFilterDrafts {
  return {
    contentFilterView: "transcript",
    collectionInput: "",
    searchInput: "",
    ...overrides,
  };
}

export function makeDashboardFilterActions(
  overrides: Partial<DashboardFilterActions> = {},
): DashboardFilterActions {
  return {
    changeContentFilterView: vi.fn(),
    changeCollectionInput: vi.fn(),
    addCollectionFilter: vi.fn(),
    removeCollectionFilter: vi.fn(),
    clearCollectionFilters: vi.fn(),
    changeSearchInput: vi.fn(),
    clearSearch: vi.fn(),
    toggleVisibilityFilter: vi.fn(),
    clearVisibilityFilter: vi.fn(),
    toggleTranscriptFilter: vi.fn(),
    removeTranscriptFilter: vi.fn(),
    toggleMetadataFilter: vi.fn(),
    removeMetadataFilter: vi.fn(),
    toggleExtraContentFilter: vi.fn(),
    removeExtraContentFilter: vi.fn(),
    toggleWorkflowFilter: vi.fn(),
    removeWorkflowFilter: vi.fn(),
    toggleFlaggedFilter: vi.fn(),
    clearFlaggedFilter: vi.fn(),
    toggleMissingFilter: vi.fn(),
    removeMissingFilter: vi.fn(),
    toggleContentShapeFilter: vi.fn(),
    removeContentShapeFilter: vi.fn(),
    changeDateMode: vi.fn(),
    changeYear: vi.fn(),
    changeMonth: vi.fn(),
    changeDay: vi.fn(),
    changeDateFrom: vi.fn(),
    changeDateTo: vi.fn(),
    clearDateFilters: vi.fn(),
    replaceStoredFilters: vi.fn(),
    clearAllFilters: vi.fn(),
    ...overrides,
  };
}
