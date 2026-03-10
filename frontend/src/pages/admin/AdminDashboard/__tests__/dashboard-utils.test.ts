import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Letter } from "../../../../types/Letter";
import {
  checkNeedsSync,
  formatDateRaw,
  getCombinedTranscriptStatus,
  isServerSortField,
  loadPersistedState,
  savePersistedState,
} from "../utils";

function makeLetter(overrides: Partial<Letter["metadata"]> = {}): Letter {
  return {
    id: "letter-1",
    title: "Test Letter",
    collectionCode: "001",
    images: [],
    transcript: { pages: [], fullText: "", verified: false },
    metadata: {
      sender: "Alice",
      recipient: "Bob",
      description: "Alice wrote to Bob about travel.",
      hook: "Alice and Bob reconnect.",
      dateRaw: "18860314",
      verified: false,
      ...overrides,
    },
    status: "uploaded",
    workflowState: "UPLOADED",
    visibility: "HIDDEN",
    transcriptStatus: "AI_DRAFT",
    metadataContentStatus: "AI_DRAFT",
    extraContentStatus: "EMPTY",
    flagged: false,
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

describe("admin dashboard utils", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("detects server-sortable fields", () => {
    expect(isServerSortField("createdAt")).toBe(true);
    expect(isServerSortField("letters")).toBe(false);
  });

  it("flags potential identity sync mismatch", () => {
    expect(checkNeedsSync(makeLetter())).toBe(false);

    const mismatched = makeLetter({
      description: "Unknown sender wrote this.",
      hook: "No recipient named.",
    });
    expect(checkNeedsSync(mismatched)).toBe(true);
  });

  it("combines transcript statuses for letter+extras correctly", () => {
    expect(getCombinedTranscriptStatus("VERIFIED", "VERIFIED", true, true)).toBe("VERIFIED");
    expect(getCombinedTranscriptStatus("EDITED", "VERIFIED", true, true)).toBe("EDITED");
    expect(getCombinedTranscriptStatus("AI_DRAFT", "EMPTY", true, false)).toBe("AI_DRAFT");
    expect(getCombinedTranscriptStatus("EMPTY", "EMPTY", false, false)).toBe("EMPTY");
  });

  it("formats YYYYMMDD dateRaw safely", () => {
    expect(formatDateRaw("18860314")).toBe("03/14/1886");
    expect(formatDateRaw(undefined)).toBe("—");
    expect(formatDateRaw("188603")).toBe("—");
  });

  it("persists and restores dashboard state", () => {
    const state = {
      visibilityFilter: "PUBLISHED" as const,
      collectionFilter: "001",
      searchQuery: "molly",
      sortColumns: [{ field: "createdAt" as const, direction: "desc" as const }],
      dateMode: "specific" as const,
      year: 1886,
      month: 3,
      day: 14,
      dateFrom: null,
      dateTo: null,
      transcriptStatusFilters: [],
      metadataStatusFilters: [],
    };

    savePersistedState(state);
    expect(loadPersistedState()).toMatchObject(state);
  });

  it("returns empty object when local storage is invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    localStorage.setItem("adminDashboardState", "not-json");

    expect(loadPersistedState()).toEqual({});
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
