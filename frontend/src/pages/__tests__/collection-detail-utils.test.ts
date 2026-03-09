import { describe, expect, it } from "vitest";
import type { Letter } from "../../types/Letter";
import {
  applyCollectionFilters,
  buildCollectionFacets,
  getThreadKey,
} from "../collection-detail-utils";

function makeLetter(overrides: Partial<Letter>): Letter {
  return {
    id: overrides.id || "l1",
    title: overrides.title || "Letter",
    images: overrides.images || [],
    transcript: overrides.transcript || { pages: [], fullText: "", verified: false },
    metadata: {
      sender: "Alice",
      recipient: "Bob",
      dateRaw: "19320101",
      hook: "Discusses family finances.",
      tags: [],
      verified: false,
      ...overrides.metadata,
    },
    status: overrides.status || "published",
    workflowState: overrides.workflowState || "REVIEWED",
    visibility: overrides.visibility || "PUBLISHED",
    transcriptStatus: overrides.transcriptStatus || "VERIFIED",
    metadataContentStatus: overrides.metadataContentStatus || "VERIFIED",
    extraContentStatus: overrides.extraContentStatus || "EMPTY",
    flagged: overrides.flagged ?? false,
    createdAt: overrides.createdAt || "2024-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2024-01-02T00:00:00.000Z",
  };
}

describe("collection detail utils", () => {
  const letters: Letter[] = [
    makeLetter({
      id: "l1",
      metadata: {
        sender: "Alice",
        recipient: "Bob",
        dateRaw: "19320101",
        hook: "Discusses ration planning.",
        tags: ["war", "family"],
        primaryTopics: ["Wartime life"],
        verified: false,
      },
    }),
    makeLetter({
      id: "l2",
      metadata: {
        sender: "Alice",
        recipient: "Bob",
        dateRaw: "19320210",
        hook: "Talks about local labor strike.",
        tags: ["labor"],
        primaryTopics: ["work"],
        verified: false,
      },
    }),
    makeLetter({
      id: "l3",
      metadata: {
        sender: "Cara",
        recipient: "Alice",
        dateRaw: "19320311",
        hook: "Mentions family travel plans.",
        tags: ["family", "travel"],
        verified: false,
      },
    }),
  ];

  it("builds top facets and thread summaries", () => {
    const facets = buildCollectionFacets(letters);

    expect(facets.topics[0]).toEqual({ value: "family", count: 2 });
    expect(facets.correspondents[0]).toEqual({ value: "Alice", count: 3 });
    expect(facets.threads[0].key).toBe("Alice -> Bob");
    expect(facets.threads[0].count).toBe(2);
    expect(facets.threads[0].latestDate).toBe("19320210");
  });

  it("filters letters by topic, correspondent, and thread", () => {
    expect(
      applyCollectionFilters(letters, { topic: "family", correspondent: null, threadKey: null }).map(
        (letter) => letter.id,
      ),
    ).toEqual(["l1", "l3"]);

    expect(
      applyCollectionFilters(letters, { topic: null, correspondent: "alice", threadKey: null }).map(
        (letter) => letter.id,
      ),
    ).toEqual(["l1", "l2", "l3"]);

    expect(
      applyCollectionFilters(letters, {
        topic: null,
        correspondent: null,
        threadKey: getThreadKey("Alice", "Bob"),
      }).map((letter) => letter.id),
    ).toEqual(["l1", "l2"]);
  });

  it("builds stable thread keys with unknown fallbacks", () => {
    expect(getThreadKey(null, undefined)).toBe("Unknown sender -> Unknown recipient");
  });
});
