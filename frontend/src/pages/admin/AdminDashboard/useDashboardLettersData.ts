import { useCallback, useMemo, useState } from "react";
import { getAdminLetters } from "../../../api/letters";
import type { Letter } from "../../../types/Letter";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { SortColumn } from "./types";
import type { DashboardFilterControls } from "./useDashboardFilters";
import { buildDashboardLetterQuery, isServerSortField } from "./utils";

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
  transcriptEmpty: 0,
  transcriptAiDraft: 0,
  transcriptEdited: 0,
  transcriptVerified: 0,
  metadataEmpty: 0,
  metadataAiDraft: 0,
  metadataEdited: 0,
  metadataVerified: 0,
};

interface UseDashboardLettersDataOptions {
  filters: DashboardFilterControls;
  sortColumns: SortColumn[];
}

export function useDashboardLettersData({
  filters,
  sortColumns,
}: UseDashboardLettersDataOptions) {
  const {
    collectionFilter,
    visibilityFilter,
    searchQuery,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
  } = filters;

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
        collectionFilter,
        visibilityFilter,
        searchQuery,
        sortColumns,
        defaultSort: DEFAULT_DASHBOARD_SORT,
        yearFilter,
        monthFilter,
        dayFilter,
        dateFromFilter,
        dateToFilter,
        transcriptStatusFilters,
        metadataStatusFilters,
      }));
      setLetters(response.letters);
      setPagination(response.pagination);
      setStats({
        total: response.stats.total ?? 0,
        uploaded: response.stats.uploaded ?? 0,
        transcribed: response.stats.transcribed ?? 0,
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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load letters");
      console.error("Failed to fetch letters:", err);
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  }, [
    collectionFilter,
    dateFromFilter,
    dateToFilter,
    dayFilter,
    metadataStatusFilters,
    monthFilter,
    pagination.page,
    searchQuery,
    sortColumns,
    transcriptStatusFilters,
    visibilityFilter,
    yearFilter,
  ]);

  const filteredLetters = useMemo(() => {
    const clientSortColumns = sortColumns.filter(col => !isServerSortField(col.field));

    if (clientSortColumns.length === 0) {
      return letters;
    }

    return [...letters].sort((a, b) => {
      for (const { field, direction } of clientSortColumns) {
        let comparison = 0;

        switch (field) {
          case "letters":
            comparison = (a.lettersCount ?? a.images.filter(img => img.type === "letter").length)
              - (b.lettersCount ?? b.images.filter(img => img.type === "letter").length);
            break;
          case "extras":
            comparison = (a.extrasCount ?? a.images.filter(img => img.type !== "letter").length)
              - (b.extrasCount ?? b.images.filter(img => img.type !== "letter").length);
            break;
          case "photos":
            comparison = (a.photosCount ?? a.images.filter(img => img.type === "photo").length)
              - (b.photosCount ?? b.images.filter(img => img.type === "photo").length);
            break;
        }

        if (comparison !== 0) {
          return direction === "asc" ? comparison : -comparison;
        }
      }
      return 0;
    });
  }, [letters, sortColumns]);

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
