import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isAuthenticated } from "../../../api/auth";
import { getAdminLetters } from "../../../api/letters";
import type { AdminLetterSummary } from "../../../types/Letter";
import {
  buildDashboardLetterQuery,
  type DashboardCommittedQuery,
} from "./dashboardQueryModel";

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
  hasCard: 0,
  hasEphemera: 0,
  hasArticle: 0,
  hasDiary: 0,
  hasVoice: 0,
};

interface UseDashboardLettersDataOptions {
  query: DashboardCommittedQuery;
}

export function useDashboardLettersData({
  query,
}: UseDashboardLettersDataOptions) {
  const [letters, setLetters] = useState<AdminLetterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [stats, setStats] = useState(DEFAULT_STATS);
  const currentQueryRef = useRef<DashboardCommittedQuery | null>(query);
  const currentRequestRef = useRef<object | null>(null);
  const currentPageRef = useRef(DEFAULT_PAGINATION.page);

  useLayoutEffect(() => {
    currentQueryRef.current = query;
    currentRequestRef.current = null;
    currentPageRef.current = 1;

    return () => {
      currentQueryRef.current = null;
      currentRequestRef.current = null;
    };
  }, [query]);

  const fetchLetters = useCallback(async (
    showLoading = false,
    page?: number,
  ) => {
    const requestQuery = currentQueryRef.current;
    if (!requestQuery) return;

    const request = {};
    const requestPage = page ?? currentPageRef.current;
    currentRequestRef.current = request;
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const response = await getAdminLetters(buildDashboardLetterQuery(
        requestQuery,
        { page: requestPage, limit: 50 },
      ));
      if (
        currentQueryRef.current !== requestQuery
        || currentRequestRef.current !== request
      ) {
        return;
      }

      currentPageRef.current = response.pagination.page;
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
        hasCard: response.stats.contentShape?.card ?? 0,
        hasEphemera: response.stats.contentShape?.ephemera ?? 0,
        hasArticle: response.stats.contentShape?.article ?? 0,
        hasDiary: response.stats.contentShape?.diary ?? 0,
        hasVoice: response.stats.contentShape?.voice ?? 0,
      });
    } catch (err) {
      if (
        currentQueryRef.current !== requestQuery
        || currentRequestRef.current !== request
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load letters");
      console.error("Failed to fetch letters:", err);
    } finally {
      if (
        currentQueryRef.current === requestQuery
        && currentRequestRef.current === request
      ) {
        setLoading(false);
        setIsInitialLoad(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) return;
    void fetchLetters(true, 1);
  }, [fetchLetters, query]);

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
