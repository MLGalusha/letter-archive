import { describe, expect, it } from "vitest";
import type { Letter } from "../../types/Letter";
import {
  computeCollectionStats,
  pickLetterHighlights,
  buildTimelineEntries,
  buildAtAGlanceFacets,
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
      images: [
        { id: "img-1", type: "letter", imageUrl: "/img/1" },
      ],
      metadata: {
        sender: "Alice",
        recipient: "Bob",
        dateRaw: "19320101",
        location: "New York",
        hook: "Discusses ration planning.",
        tags: ["war", "family"],
        primaryTopics: ["Wartime life"],
        verified: false,
      },
    }),
    makeLetter({
      id: "l2",
      images: [{ id: "img-3", type: "telegram", imageUrl: "/img/3" }],
      metadata: {
        sender: "Alice",
        recipient: "Bob",
        dateRaw: "19320210",
        location: "New York",
        hook: "Talks about local labor strike.",
        tags: ["labor"],
        primaryTopics: ["work"],
        verified: false,
      },
    }),
    makeLetter({
      id: "l3",
      images: [{ id: "img-4", type: "photo", imageUrl: "/img/4" }],
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

  it("computes collection stats from letter data", () => {
    const stats = computeCollectionStats(letters);

    expect(stats.dateSpan).not.toBeNull();
    expect(stats.dateSpan!.label).toContain("1932");
    expect(stats.writingFrequency).toBeTruthy();
    expect(stats.formatBreakdown).toContain("letter");
    expect(stats.formatBreakdown).toContain("photo");
  });

  it("picks up to 2 highlights: featured/pinned then photo", () => {
    const highlights = pickLetterHighlights(letters);

    expect(highlights).toHaveLength(2);
    expect(highlights[0].label).toBe("Featured");
    expect(highlights[0].letter.id).toBe("l2");
    expect(highlights[1].label).toBe("Photo");
    expect(highlights[1].letter.id).toBe("l3");
  });

  it("builds timeline entries sorted by date with sender/recipient", () => {
    const entries = buildTimelineEntries(letters);

    expect(entries).toHaveLength(3);
    expect(entries[0].letterId).toBe("l1");
    expect(entries[0].hookLine).toBe("Discusses ration planning.");
    expect(entries[0].sender).toBe("Alice");
    expect(entries[0].recipient).toBe("Bob");
    expect(entries[2].letterId).toBe("l3");
    expect(entries[2].mediaLabel).toBe("Photo");
    expect(entries[2].sender).toBe("Cara");
  });

  it("builds at-a-glance facets with topics, places, and people", () => {
    const facets = buildAtAGlanceFacets(letters);

    expect(facets.topics[0]).toEqual({ value: "family", count: 2 });
    expect(facets.people[0]).toEqual({ value: "Alice", count: 3 });
    expect(facets.places).toHaveLength(1);
    expect(facets.places[0]).toEqual({ value: "New York", count: 2 });
    expect(facets.formats.length).toBeGreaterThan(0);
  });

  it("handles empty letter arrays gracefully", () => {
    const stats = computeCollectionStats([]);
    expect(stats.dateSpan).toBeNull();
    expect(stats.writingFrequency).toBeNull();
    expect(stats.formatBreakdown).toBe("0 items");

    const highlights = pickLetterHighlights([]);
    expect(highlights).toEqual([]);

    const timeline = buildTimelineEntries([]);
    expect(timeline).toEqual([]);

    const facets = buildAtAGlanceFacets([]);
    expect(facets.topics).toEqual([]);
    expect(facets.places).toEqual([]);
    expect(facets.people).toEqual([]);
  });
});
