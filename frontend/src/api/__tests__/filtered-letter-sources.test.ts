import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFilteredLetterSources,
  type AdminLetterQueryParams,
} from "../letters";

const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}));

vi.mock("../client", () => ({
  apiDelete: vi.fn(),
  apiGet: apiGetMock,
}));

interface ExpectedFilteredSource {
  letterId: string;
  primarySourceRevision: number;
}

function makePage(
  prefix: string,
  count: number,
  revisionOffset: number,
) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    primarySourceRevision: revisionOffset + index,
  }));
}

describe("filtered letter source enumeration", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it("paginates the exact canonical query and preserves every source revision", async () => {
    const firstPage = makePage("first", 100, 1000);
    const secondPage = makePage("second", 3, 2000);
    apiGetMock
      .mockResolvedValueOnce({
        letters: firstPage,
        pagination: { page: 1, limit: 100, total: 103, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        letters: secondPage,
        pagination: { page: 2, limit: 100, total: 103, totalPages: 2 },
      });

    const query = {
      collection: "003,019",
      visibility: "PUBLISHED",
      search: "molly",
      workflow: "TRANSCRIBED,REVIEWED",
      sort: "sender",
      sortOrder: "asc",
      sortRules: "sender:asc,updatedAt:desc",
      year: 1886,
      month: 3,
      day: 14,
      dateFrom: "18860101",
      dateTo: "18861231",
      transcriptStatus: "AI_DRAFT,EDITED",
      metadataStatus: "VERIFIED",
      extraContentStatus: "EMPTY",
      flagged: "false",
      missing: "sender,date",
      contentShape: "extras,photos",
    } satisfies Omit<AdminLetterQueryParams, "page" | "limit">;

    const sources = await getFilteredLetterSources(query);

    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiGetMock).toHaveBeenNthCalledWith(1, "/admin/letters", {
      ...query,
      page: 1,
      limit: 100,
    });
    expect(apiGetMock).toHaveBeenNthCalledWith(2, "/admin/letters", {
      ...query,
      page: 2,
      limit: 100,
    });

    const expectedSources: ExpectedFilteredSource[] = [
      ...firstPage,
      ...secondPage,
    ].map((letter) => ({
      letterId: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
    }));
    expect(sources).toHaveLength(expectedSources.length);
    expectedSources.forEach((source, index) => {
      expect(sources[index]).toEqual(source);
    });
  });
});
