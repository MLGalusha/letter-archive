import { describe, expect, it, vi } from "vitest";
import {
  buildDashboardLetterQuery,
  createDashboardCommittedQuery,
  type DashboardCommittedQuery,
} from "../dashboardQueryModel";
import type { SortColumn } from "../types";

function makeFilterSource() {
  return {
    collectionFilter: "003,019",
    visibilityFilter: "PUBLISHED" as const,
    searchQuery: "molly",
    yearFilter: 1886,
    monthFilter: 3,
    dayFilter: 14,
    dateFromFilter: "18860101",
    dateToFilter: "18861231",
    transcriptStatusFilters: ["EMPTY", "AI_DRAFT"],
    metadataStatusFilters: ["EDITED"],
    extraContentStatusFilters: ["VERIFIED"],
    workflowFilters: ["UPLOADED", "REVIEWED"],
    flaggedFilter: "FLAGGED" as const,
    missingFilters: ["sender", "date"],
    contentShapeFilters: ["extras", "photos"],

    // These controls are intentionally not part of committed request identity.
    dateMode: "range" as const,
    contentFilterView: "metadata" as const,
    collectionInput: "777",
    searchInput: "uncommitted search",
    hasDateFilter: true,
    setSearchQuery: vi.fn(),
    handleClearAllFilters: vi.fn(),
  };
}

function makeSortColumns(): SortColumn[] {
  return [
    { field: "letters", direction: "asc" },
    { field: "createdAt", direction: "desc" },
  ];
}

const expectedQuery: DashboardCommittedQuery = {
  collectionFilter: "003,019",
  visibilityFilter: "PUBLISHED",
  searchQuery: "molly",
  yearFilter: 1886,
  monthFilter: 3,
  dayFilter: 14,
  dateFromFilter: "18860101",
  dateToFilter: "18861231",
  transcriptStatusFilters: ["EMPTY", "AI_DRAFT"],
  metadataStatusFilters: ["EDITED"],
  extraContentStatusFilters: ["VERIFIED"],
  workflowFilters: ["UPLOADED", "REVIEWED"],
  flaggedFilter: "FLAGGED",
  missingFilters: ["sender", "date"],
  contentShapeFilters: ["extras", "photos"],
  sortColumns: [
    { field: "letters", direction: "asc" },
    { field: "createdAt", direction: "desc" },
  ],
};

function createQuery() {
  const filterSource = makeFilterSource();
  return createDashboardCommittedQuery(
    filterSource as Parameters<typeof createDashboardCommittedQuery>[0],
    makeSortColumns(),
  );
}

describe("dashboard committed query model", () => {
  it("projects exactly the committed filter and ordered sort values", () => {
    const query = createQuery();

    expect(query).toEqual(expectedQuery);
    expect(Object.keys(query).sort()).toEqual(Object.keys(expectedQuery).sort());
    expect(query).not.toHaveProperty("dateMode");
    expect(query).not.toHaveProperty("contentFilterView");
    expect(query).not.toHaveProperty("collectionInput");
    expect(query).not.toHaveProperty("searchInput");
    expect(query).not.toHaveProperty("hasDateFilter");
    expect(query).not.toHaveProperty("setSearchQuery");
    expect(query).not.toHaveProperty("handleClearAllFilters");
  });

  it("is JSON-round-trippable without changing request identity", () => {
    expect(JSON.parse(JSON.stringify(createQuery()))).toEqual(expectedQuery);
  });

  it("copies every array owned by the filter and sort controls", () => {
    const source = makeFilterSource();
    const sourceSort = makeSortColumns();
    const query = createDashboardCommittedQuery(
      source as Parameters<typeof createDashboardCommittedQuery>[0],
      sourceSort,
    );

    expect(query.transcriptStatusFilters).not.toBe(source.transcriptStatusFilters);
    expect(query.metadataStatusFilters).not.toBe(source.metadataStatusFilters);
    expect(query.extraContentStatusFilters).not.toBe(source.extraContentStatusFilters);
    expect(query.workflowFilters).not.toBe(source.workflowFilters);
    expect(query.missingFilters).not.toBe(source.missingFilters);
    expect(query.contentShapeFilters).not.toBe(source.contentShapeFilters);
    expect(query.sortColumns).not.toBe(sourceSort);

    source.transcriptStatusFilters.push("VERIFIED");
    source.metadataStatusFilters.push("EMPTY");
    source.extraContentStatusFilters.push("AI_DRAFT");
    source.workflowFilters.push("PUBLISHED");
    source.missingFilters.push("recipient");
    source.contentShapeFilters.push("voice");
    sourceSort.push({ field: "sender", direction: "asc" });

    expect(query).toEqual(expectedQuery);
  });

  it("serializes every committed value and preserves multi-sort priority", () => {
    expect(buildDashboardLetterQuery(createQuery(), {
      page: 3,
      limit: 25,
    })).toEqual({
      page: 3,
      limit: 25,
      collection: "003,019",
      visibility: "PUBLISHED",
      search: "molly",
      sort: "letters",
      sortOrder: "asc",
      sortRules: "letters:asc,createdAt:desc",
      year: 1886,
      month: 3,
      day: 14,
      dateFrom: "18860101",
      dateTo: "18861231",
      transcriptStatus: "EMPTY,AI_DRAFT",
      metadataStatus: "EDITED",
      extraContentStatus: "VERIFIED",
      workflow: "UPLOADED,REVIEWED",
      flagged: "true",
      missing: "sender,date",
      contentShape: "extras,photos",
    });
  });

  it("uses the dashboard default sort while omitting inactive filters", () => {
    const emptyQuery: DashboardCommittedQuery = {
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
      sortColumns: [],
    };

    expect(buildDashboardLetterQuery(emptyQuery)).toEqual({
      page: undefined,
      limit: undefined,
      collection: undefined,
      visibility: undefined,
      search: undefined,
      sort: "lastOpenedAt",
      sortOrder: "desc",
      sortRules: "lastOpenedAt:desc",
      year: undefined,
      month: undefined,
      day: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      transcriptStatus: undefined,
      metadataStatus: undefined,
      extraContentStatus: undefined,
      workflow: undefined,
      flagged: undefined,
      missing: undefined,
      contentShape: undefined,
    });
  });
});
