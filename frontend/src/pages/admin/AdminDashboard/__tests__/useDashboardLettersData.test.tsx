import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminLettersResponse } from "../../../../api/letters";
import { makeAdminLetterSummary } from "../../../../test/adminLetterSummary";
import type { DashboardCommittedQuery } from "../dashboardQueryModel";
import { useDashboardLettersData } from "../useDashboardLettersData";

const getAdminLettersMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../api/auth", () => ({
  isAuthenticated: () => true,
}));

vi.mock("../../../../api/letters", async () => {
  const actual = await vi.importActual<typeof import("../../../../api/letters")>(
    "../../../../api/letters",
  );
  return {
    ...actual,
    getAdminLetters: getAdminLettersMock,
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function makeQuery(
  overrides: Partial<DashboardCommittedQuery> = {},
): DashboardCommittedQuery {
  return {
    collectionFilter: "101,205",
    visibilityFilter: "HIDDEN",
    searchQuery: "Mason",
    sortColumns: [
      { field: "sender", direction: "asc" },
      { field: "updatedAt", direction: "desc" },
    ],
    yearFilter: 1944,
    monthFilter: 6,
    dayFilter: 12,
    dateFromFilter: "19440101",
    dateToFilter: "19441231",
    transcriptStatusFilters: ["AI_DRAFT", "EDITED"],
    metadataStatusFilters: ["VERIFIED"],
    extraContentStatusFilters: ["EMPTY"],
    workflowFilters: ["UPLOADED", "TRANSCRIBED"],
    flaggedFilter: "UNFLAGGED",
    missingFilters: ["sender", "date"],
    contentShapeFilters: ["cover", "photos"],
    ...overrides,
  };
}

function makeApiStats(seed: number): AdminLettersResponse["stats"] {
  return {
    total: seed,
    uploaded: seed + 1,
    transcribing: seed + 2,
    transcribed: seed + 3,
    metadataExtracting: seed + 4,
    metadataReady: seed + 5,
    reviewed: seed + 6,
    published: seed + 7,
    hidden: seed + 8,
    flagged: seed + 9,
    transcript: {
      empty: seed + 10,
      aiDraft: seed + 11,
      edited: seed + 12,
      verified: seed + 13,
    },
    metadata: {
      empty: seed + 14,
      aiDraft: seed + 15,
      edited: seed + 16,
      verified: seed + 17,
    },
    extraContent: {
      empty: seed + 18,
      aiDraft: seed + 19,
      edited: seed + 20,
      verified: seed + 21,
    },
    missing: {
      sender: seed + 22,
      recipient: seed + 23,
      date: seed + 24,
    },
    contentShape: {
      extras: seed + 25,
      photos: seed + 26,
      cover: seed + 27,
      telegram: seed + 28,
      card: seed + 29,
      ephemera: seed + 30,
      article: seed + 31,
      diary: seed + 32,
      voice: seed + 33,
    },
  };
}

function makeResponse(
  label: string,
  page: number,
  seed: number,
): AdminLettersResponse {
  return {
    letters: [makeAdminLetterSummary({
      id: `${label}-letter`,
      title: `${label} letter`,
      collectionCode: "001",
      metadata: { dateRaw: "20260101" },
      transcriptStatus: "EMPTY",
      metadataContentStatus: "EMPTY",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })],
    pagination: {
      page,
      limit: 50,
      total: seed * 10,
      totalPages: seed,
    },
    stats: makeApiStats(seed),
  };
}

function expectedDashboardStats(stats: AdminLettersResponse["stats"]) {
  return {
    total: stats.total,
    uploaded: stats.uploaded,
    transcribing: stats.transcribing ?? 0,
    transcribed: stats.transcribed,
    metadataExtracting: stats.metadataExtracting ?? 0,
    metadataReady: stats.metadataReady,
    reviewed: stats.reviewed,
    published: stats.published,
    hidden: stats.hidden,
    flagged: stats.flagged,
    transcriptEmpty: stats.transcript.empty,
    transcriptAiDraft: stats.transcript.aiDraft,
    transcriptEdited: stats.transcript.edited,
    transcriptVerified: stats.transcript.verified,
    metadataEmpty: stats.metadata.empty,
    metadataAiDraft: stats.metadata.aiDraft,
    metadataEdited: stats.metadata.edited,
    metadataVerified: stats.metadata.verified,
    extraContentEmpty: stats.extraContent?.empty ?? 0,
    extraContentAiDraft: stats.extraContent?.aiDraft ?? 0,
    extraContentEdited: stats.extraContent?.edited ?? 0,
    extraContentVerified: stats.extraContent?.verified ?? 0,
    missingSender: stats.missing?.sender ?? 0,
    missingRecipient: stats.missing?.recipient ?? 0,
    missingDate: stats.missing?.date ?? 0,
    hasExtras: stats.contentShape?.extras ?? 0,
    hasPhotos: stats.contentShape?.photos ?? 0,
    hasCover: stats.contentShape?.cover ?? 0,
    hasTelegram: stats.contentShape?.telegram ?? 0,
    hasCard: stats.contentShape?.card ?? 0,
    hasEphemera: stats.contentShape?.ephemera ?? 0,
    hasArticle: stats.contentShape?.article ?? 0,
    hasDiary: stats.contentShape?.diary ?? 0,
    hasVoice: stats.contentShape?.voice ?? 0,
  };
}

function observableState(current: ReturnType<typeof useDashboardLettersData>) {
  return {
    letters: current.letters.map((letter) => letter.id),
    filteredLetters: current.filteredLetters.map((letter) => letter.id),
    loading: current.loading,
    isInitialLoad: current.isInitialLoad,
    error: current.error,
    pagination: { ...current.pagination },
    stats: { ...current.stats },
  };
}

async function resolveRequest(
  request: Deferred<AdminLettersResponse>,
  response: AdminLettersResponse,
) {
  await act(async () => {
    request.resolve(response);
    await request.promise;
  });
}

async function rejectRequest(
  request: Deferred<AdminLettersResponse>,
  error: Error,
) {
  await act(async () => {
    request.reject(error);
    await request.promise.catch(() => undefined);
  });
}

describe("useDashboardLettersData", () => {
  beforeEach(() => {
    getAdminLettersMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("owns the initial page-one request and serializes the complete committed query", async () => {
    const query = makeQuery();
    const response = makeResponse("initial", 1, 3);
    getAdminLettersMock.mockResolvedValueOnce(response);

    const { result } = renderHook(() => useDashboardLettersData({ query }));

    await waitFor(() => {
      expect(getAdminLettersMock).toHaveBeenCalledTimes(1);
    });
    expect(getAdminLettersMock).toHaveBeenLastCalledWith({
      page: 1,
      limit: 50,
      collection: "101,205",
      visibility: "HIDDEN",
      search: "Mason",
      sort: "sender",
      sortOrder: "asc",
      sortRules: "sender:asc,updatedAt:desc",
      year: 1944,
      month: 6,
      day: 12,
      dateFrom: "19440101",
      dateTo: "19441231",
      transcriptStatus: "AI_DRAFT,EDITED",
      metadataStatus: "VERIFIED",
      extraContentStatus: "EMPTY",
      workflow: "UPLOADED,TRANSCRIBED",
      flagged: "false",
      missing: "sender,date",
      contentShape: "cover,photos",
    });

    await waitFor(() => {
      expect(result.current.letters.map((letter) => letter.id)).toEqual([
        "initial-letter",
      ]);
    });
    expect(result.current.filteredLetters).toBe(result.current.letters);
    expect(result.current.pagination).toEqual(response.pagination);
    expect(result.current.stats).toEqual(expectedDashboardStats(response.stats));
    expect(result.current.loading).toBe(false);
    expect(result.current.isInitialLoad).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("uses the committed query for page navigation and defaults refreshes to the current page", async () => {
    const query = makeQuery();
    getAdminLettersMock.mockResolvedValueOnce(makeResponse("initial", 1, 2));
    const { result } = renderHook(() => useDashboardLettersData({ query }));

    await waitFor(() => {
      expect(result.current.letters[0]?.id).toBe("initial-letter");
    });

    const pageRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock.mockReturnValueOnce(pageRequest.promise);
    let pagePromise!: Promise<void>;
    act(() => {
      pagePromise = result.current.fetchLetters(true, 4);
    });

    expect(result.current.loading).toBe(true);
    expect(getAdminLettersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 4,
        limit: 50,
        search: "Mason",
        sortRules: "sender:asc,updatedAt:desc",
      }),
    );

    await act(async () => {
      pageRequest.resolve(makeResponse("page-four", 4, 5));
      await pagePromise;
    });
    expect(result.current.pagination.page).toBe(4);
    expect(result.current.letters[0]?.id).toBe("page-four-letter");

    const refreshRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock.mockReturnValueOnce(refreshRequest.promise);
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.fetchLetters();
    });

    expect(result.current.loading).toBe(false);
    expect(getAdminLettersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 4,
        limit: 50,
        search: "Mason",
      }),
    );

    await act(async () => {
      refreshRequest.resolve(makeResponse("refreshed-page-four", 4, 6));
      await refreshPromise;
    });
    expect(result.current.letters[0]?.id).toBe("refreshed-page-four-letter");
  });

  it("automatically resets fetching to page one when the committed query changes", async () => {
    const initialQuery = makeQuery();
    const changedQuery = makeQuery({
      visibilityFilter: "PUBLISHED",
      searchQuery: "Galusha",
    });
    getAdminLettersMock
      .mockResolvedValueOnce(makeResponse("initial", 1, 2))
      .mockResolvedValueOnce(makeResponse("page-five", 5, 6));

    const { result, rerender } = renderHook(
      ({ query }) => useDashboardLettersData({ query }),
      { initialProps: { query: initialQuery } },
    );
    await waitFor(() => {
      expect(result.current.letters[0]?.id).toBe("initial-letter");
    });

    await act(async () => {
      await result.current.fetchLetters(true, 5);
    });
    expect(result.current.pagination.page).toBe(5);

    const changedRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock.mockReturnValueOnce(changedRequest.promise);
    rerender({ query: changedQuery });

    await waitFor(() => {
      expect(getAdminLettersMock).toHaveBeenCalledTimes(3);
    });
    expect(getAdminLettersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 50,
        visibility: "PUBLISHED",
        search: "Galusha",
      }),
    );
    expect(result.current.loading).toBe(true);

    await resolveRequest(
      changedRequest,
      makeResponse("changed-query-page-one", 1, 7),
    );
    expect(result.current.pagination.page).toBe(1);
    expect(result.current.letters[0]?.id).toBe(
      "changed-query-page-one-letter",
    );
  });

  it("keeps the refresh boundary current when a mutation retained it before a query change", async () => {
    const initialQuery = makeQuery({ searchQuery: "before-mutation" });
    const currentQuery = makeQuery({ searchQuery: "current-query" });
    getAdminLettersMock.mockResolvedValueOnce(makeResponse("initial", 1, 2));

    const { result, rerender } = renderHook(
      ({ query }) => useDashboardLettersData({ query }),
      { initialProps: { query: initialQuery } },
    );
    await waitFor(() => {
      expect(result.current.letters[0]?.id).toBe("initial-letter");
    });
    const retainedMutationRefresh = result.current.fetchLetters;

    getAdminLettersMock.mockResolvedValueOnce(
      makeResponse("current-query", 1, 3),
    );
    rerender({ query: currentQuery });
    await waitFor(() => {
      expect(result.current.letters[0]?.id).toBe("current-query-letter");
    });
    expect(result.current.fetchLetters).toBe(retainedMutationRefresh);

    const postMutationRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock.mockReturnValueOnce(postMutationRequest.promise);
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = retainedMutationRefresh();
    });

    expect(getAdminLettersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 50,
        search: "current-query",
      }),
    );

    await act(async () => {
      postMutationRequest.resolve(
        makeResponse("post-mutation-current-query", 1, 4),
      );
      await refreshPromise;
    });
    expect(result.current.letters[0]?.id).toBe(
      "post-mutation-current-query-letter",
    );
  });

  it("ignores an older query success that resolves after the current query", async () => {
    const olderRequest = deferred<AdminLettersResponse>();
    const currentRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);

    const { result, rerender } = renderHook(
      ({ query }) => useDashboardLettersData({ query }),
      { initialProps: { query: makeQuery({ searchQuery: "older" }) } },
    );
    await waitFor(() => {
      expect(getAdminLettersMock).toHaveBeenCalledTimes(1);
    });

    rerender({ query: makeQuery({ searchQuery: "current" }) });
    await waitFor(() => {
      expect(getAdminLettersMock).toHaveBeenCalledTimes(2);
    });

    await resolveRequest(
      currentRequest,
      makeResponse("current-query", 1, 8),
    );
    const currentState = observableState(result.current);

    await resolveRequest(
      olderRequest,
      makeResponse("stale-query", 9, 99),
    );
    expect(observableState(result.current)).toEqual(currentState);
  });

  it("ignores an older page response after a new query starts", async () => {
    getAdminLettersMock.mockResolvedValueOnce(makeResponse("initial", 1, 2));
    const initialQuery = makeQuery({ searchQuery: "initial" });
    const { result, rerender } = renderHook(
      ({ query }) => useDashboardLettersData({ query }),
      { initialProps: { query: initialQuery } },
    );
    await waitFor(() => {
      expect(result.current.letters[0]?.id).toBe("initial-letter");
    });

    const olderPageRequest = deferred<AdminLettersResponse>();
    const currentQueryRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock
      .mockReturnValueOnce(olderPageRequest.promise)
      .mockReturnValueOnce(currentQueryRequest.promise);

    let olderPagePromise!: Promise<void>;
    act(() => {
      olderPagePromise = result.current.fetchLetters(true, 4);
    });
    rerender({ query: makeQuery({ searchQuery: "current" }) });
    await waitFor(() => {
      expect(getAdminLettersMock).toHaveBeenCalledTimes(3);
    });

    await resolveRequest(
      currentQueryRequest,
      makeResponse("current-query", 1, 9),
    );
    const currentState = observableState(result.current);

    await act(async () => {
      olderPageRequest.resolve(makeResponse("stale-page", 4, 40));
      await olderPagePromise;
    });
    expect(observableState(result.current)).toEqual(currentState);
  });

  it("keeps the current request loading when an older same-query request fails", async () => {
    getAdminLettersMock.mockResolvedValueOnce(makeResponse("initial", 1, 2));
    const query = makeQuery();
    const { result } = renderHook(() => useDashboardLettersData({ query }));
    await waitFor(() => {
      expect(result.current.letters[0]?.id).toBe("initial-letter");
    });
    const baseline = observableState(result.current);

    const olderRequest = deferred<AdminLettersResponse>();
    const currentRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);

    act(() => {
      void result.current.fetchLetters(true, 2);
      void result.current.fetchLetters(true, 3);
    });
    await waitFor(() => {
      expect(getAdminLettersMock).toHaveBeenCalledTimes(3);
    });

    await rejectRequest(olderRequest, new Error("stale failure"));
    expect(observableState(result.current)).toEqual({
      ...baseline,
      loading: true,
      error: null,
    });

    await resolveRequest(
      currentRequest,
      makeResponse("current-page", 3, 10),
    );
    expect(result.current.letters[0]?.id).toBe("current-page-letter");
    expect(result.current.pagination.page).toBe(3);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not let a stale same-query success overwrite a newer failure", async () => {
    getAdminLettersMock.mockResolvedValueOnce(makeResponse("baseline", 1, 2));
    const query = makeQuery();
    const { result } = renderHook(() => useDashboardLettersData({ query }));
    await waitFor(() => {
      expect(result.current.letters[0]?.id).toBe("baseline-letter");
    });

    const olderRequest = deferred<AdminLettersResponse>();
    const currentRequest = deferred<AdminLettersResponse>();
    getAdminLettersMock
      .mockReturnValueOnce(olderRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);

    act(() => {
      void result.current.fetchLetters(true, 2);
      void result.current.fetchLetters(true, 3);
    });
    await rejectRequest(currentRequest, new Error("current failure"));

    expect(result.current.error).toBe("current failure");
    expect(result.current.loading).toBe(false);
    const failedCurrentState = observableState(result.current);

    await resolveRequest(
      olderRequest,
      makeResponse("stale-success", 2, 88),
    );
    expect(observableState(result.current)).toEqual(failedCurrentState);
  });

  it("keeps a request failure inert after the data owner unmounts", async () => {
    const request = deferred<AdminLettersResponse>();
    getAdminLettersMock.mockReturnValueOnce(request.promise);
    const { unmount } = renderHook(() => useDashboardLettersData({
      query: makeQuery(),
    }));

    await waitFor(() => {
      expect(getAdminLettersMock).toHaveBeenCalledTimes(1);
    });
    unmount();
    await rejectRequest(request, new Error("failed after navigation"));

    expect(console.error).not.toHaveBeenCalled();
  });
});
