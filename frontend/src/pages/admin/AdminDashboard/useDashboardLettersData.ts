import { useCallback, useMemo, useState } from "react";
import { getAdminLetters } from "../../../api/letters";
import type { Letter } from "../../../types/Letter";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { ExtendedSortField, SortColumn } from "./types";
import {
  getDashboardFilterQueryFields,
  type DashboardFilterControls,
} from "./useDashboardFilters";
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
    filterQueryFields.monthFilter,
    filterQueryFields.extraContentStatusFilters,
    filterQueryFields.flaggedFilter,
    filterQueryFields.workflowFilters,
    pagination.page,
    filterQueryFields.searchQuery,
    sortColumns,
    filterQueryFields.transcriptStatusFilters,
    filterQueryFields.visibilityFilter,
    filterQueryFields.yearFilter,
  ]);

  const filteredLetters = useMemo(() => {
    const primaryServerSortIndex = sortColumns.findIndex((column) => isServerSortField(column.field));
    const clientSortColumns = sortColumns.filter((_, index) => index !== primaryServerSortIndex);

    if (clientSortColumns.length === 0) {
      return letters;
    }

    return [...letters].sort((a, b) => {
      for (const { field, direction } of clientSortColumns) {
        let comparison = 0;

        comparison = compareLettersByField(a, b, field);

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

function compareLettersByField(a: Letter, b: Letter, field: ExtendedSortField): number {
  switch (field) {
    case "letters":
      return getLetterPageCount(a) - getLetterPageCount(b);
    case "extras":
      return getExtrasCount(a) - getExtrasCount(b);
    case "photos":
      return getPhotosCount(a) - getPhotosCount(b);
    case "sender":
      return compareStrings(a.metadata.sender, b.metadata.sender);
    case "recipient":
      return compareStrings(a.metadata.recipient, b.metadata.recipient);
    case "collection":
      return compareStrings(a.collectionCode, b.collectionCode);
    case "letterDate":
      return compareStrings(a.metadata.dateRaw ?? a.metadata.date, b.metadata.dateRaw ?? b.metadata.date);
    case "createdAt":
      return compareStrings(a.createdAt, b.createdAt);
    case "updatedAt":
      return compareStrings(a.updatedAt, b.updatedAt);
    case "lastOpenedAt":
      return compareStrings(a.lastOpenedAt, b.lastOpenedAt);
    case "workflow":
      return compareStrings(a.workflowState, b.workflowState);
    case "visibility":
      return compareStrings(a.visibility, b.visibility);
    case "flagged":
      return Number(a.flagged) - Number(b.flagged);
  }
}

function compareStrings(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getLetterPageCount(letter: Letter): number {
  return letter.lettersCount ?? letter.images.filter((img) => img.type === "letter").length;
}

function getExtrasCount(letter: Letter): number {
  return letter.extrasCount ?? letter.images.filter((img) => img.type !== "letter").length;
}

function getPhotosCount(letter: Letter): number {
  return letter.photosCount ?? letter.images.filter((img) => img.type === "photo").length;
}
