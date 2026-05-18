import { useCallback, useState } from "react";
import { getAdminLetters } from "../../../api/letters";
import type { Letter } from "../../../types/Letter";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { SortColumn } from "./types";
import {
  getDashboardFilterQueryFields,
  type DashboardFilterControls,
} from "./useDashboardFilters";
import { buildDashboardLetterQuery } from "./utils";

const DEFAULT_PAGINATION = {
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 0,
};

const DEFAULT_STATS = {
  total: 0,
  uploaded: 0,
  transcribed: 0,
  metadataReady: 0,
  reviewed: 0,
  published: 0,
  hidden: 0,
  flagged: 0,
  transcribing: 0,
  metadataExtracting: 0,
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
};

interface UseDashboardLettersDataOptions {
  filters: DashboardFilterControls;
  sortColumns: SortColumn[];
}

export function useDashboardLettersData({
  filters,
  sortColumns,
}: UseDashboardLettersDataOptions) {
  const filterQueryFields = getDashboardFilterQueryFields(filters);

  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [stats, setStats] = useState(DEFAULT_STATS);

  const fetchLetters = useCallback(async (showLoading = false, page = pagination.page) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await getAdminLetters(buildDashboardLetterQuery({
        page,
        limit: 50,
        ...filterQueryFields,
        sortColumns,
        defaultSort: DEFAULT_DASHBOARD_SORT,
      }));
      setLetters(response.letters);
      setPagination(response.pagination);
      setStats({
        total: response.stats.total ?? 0,
        uploaded: response.stats.uploaded ?? 0,
        transcribing: response.stats.transcribing ?? 0,
        transcribed: response.stats.transcribed ?? 0,
        metadataExtracting: response.stats.metadataExtracting ?? 0,
        metadataReady: response.stats.metadataReady ?? 0,
        reviewed: response.stats.reviewed ?? 0,
        published: response.stats.published ?? 0,
        hidden: response.stats.hidden ?? 0,
        flagged: response.stats.flagged ?? 0,
        transcriptEmpty: response.stats.transcript?.empty ?? 0,
        transcriptAiDraft: response.stats.transcript?.aiDraft ?? 0,
        transcriptEdited: response.stats.transcript?.edited ?? 0,
        transcriptVerified: response.stats.transcript?.verified ?? 0,
        metadataEmpty: response.stats.metadata?.empty ?? 0,
        metadataAiDraft: response.stats.metadata?.aiDraft ?? 0,
        metadataEdited: response.stats.metadata?.edited ?? 0,
        metadataVerified: response.stats.metadata?.verified ?? 0,
        extraContentEmpty: response.stats.extraContent?.empty ?? 0,
        extraContentAiDraft: response.stats.extraContent?.aiDraft ?? 0,
        extraContentEdited: response.stats.extraContent?.edited ?? 0,
        extraContentVerified: response.stats.extraContent?.verified ?? 0,
        missingSender: response.stats.missing?.sender ?? 0,
        missingRecipient: response.stats.missing?.recipient ?? 0,
        missingDate: response.stats.missing?.date ?? 0,
        hasExtras: response.stats.contentShape?.extras ?? 0,
        hasPhotos: response.stats.contentShape?.photos ?? 0,
        hasCover: response.stats.contentShape?.cover ?? 0,
        hasTelegram: response.stats.contentShape?.telegram ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load letters");
      console.error("Failed to fetch letters:", err);
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  }, [
    filterQueryFields.collectionFilter,
    filterQueryFields.dateFromFilter,
    filterQueryFields.dateToFilter,
    filterQueryFields.dayFilter,
    filterQueryFields.metadataStatusFilters,
    filterQueryFields.missingFilters,
    filterQueryFields.monthFilter,
    filterQueryFields.extraContentStatusFilters,
    filterQueryFields.contentShapeFilters,
    filterQueryFields.flaggedFilter,
    filterQueryFields.workflowFilters,
    pagination.page,
    filterQueryFields.searchQuery,
    sortColumns,
    filterQueryFields.transcriptStatusFilters,
    filterQueryFields.visibilityFilter,
    filterQueryFields.yearFilter,
  ]);

  const filteredLetters = letters;

  return {
    letters,
    setLetters,
    filteredLetters,
    loading,
    isInitialLoad,
    error,
    pagination,
    stats,
    fetchLetters,
  };
}
