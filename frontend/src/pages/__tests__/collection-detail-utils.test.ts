import { describe, expect, it } from "vitest";
import type { Letter } from "../../types/Letter";
import {
  computeCollectionStats,
  pickLetterHighlights,
  buildCorrespondents,
  buildExtraContentGallery,
} from "../collection-detail-utils";

function makeLetter(overrides: Partial<Letter>): Letter {
  return {
    id: overrides.id || "l1",
    title: overrides.title || "Letter",
    primarySourceRevision: overrides.primarySourceRevision ?? 0,
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
    transcriptPublished: overrides.transcriptPublished ?? false,
    metadataPublished: overrides.metadataPublished ?? false,
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

  it("computes collection stats with date span and format breakdown", () => {
    const stats = computeCollectionStats(letters);

    expect(stats.dateSpan).not.toBeNull();
    expect(stats.dateSpan!.label).toContain("1932");
    expect(stats.formatBreakdown).toContain("letter");
    expect(stats.formatBreakdown).toContain("\u00B7");
    expect(stats.formatBreakdown).toContain("photo");
  });

  it("counts attached extra content formats in the header breakdown", () => {
    const lettersWithAttachedExtras: Letter[] = [
      makeLetter({
        id: "grouped-letter",
        images: [
          { id: "img-letter", type: "letter", imageUrl: "/img/letter" },
          { id: "img-cover", type: "cover", imageUrl: "/img/cover" },
          { id: "img-telegram", type: "telegram", imageUrl: "/img/telegram" },
        ],
        metadata: {
          dateRaw: "19320415",
          verified: false,
        },
      }),
    ];

    const stats = computeCollectionStats(lettersWithAttachedExtras);

    expect(stats.formatBreakdown).toBe("1 letter · 1 telegram · 1 cover");
  });

  it("picks 1 featured highlight, preferring items with images", () => {
    const highlights = pickLetterHighlights(letters);

    expect(highlights).toHaveLength(1);
    expect(highlights[0].label).toBe("Featured");
    expect(highlights[0].letter.images.length).toBeGreaterThan(0);
  });

  it("builds extra content gallery from photos and covers", () => {
    const gallery = buildExtraContentGallery(letters);

    expect(gallery.length).toBeGreaterThan(0);
    expect(gallery[0].mediaType).toBe("photo");
    expect(gallery[0].letterId).toBe("l3");
    // Standalone photo letter should have a hook
    expect(gallery[0].hook).toBeTruthy();
  });

  it("includes extra content images from letter-type items without hook", () => {
    const letterWithExtra = makeLetter({
      id: "l-with-extra",
      images: [
        { id: "img-letter", type: "letter", imageUrl: "/img/letter-page" },
        { id: "img-cover", type: "cover", imageUrl: "/img/cover-extra" },
      ],
      metadata: {
        sender: "Alice",
        recipient: "Bob",
        dateRaw: "19320401",
        hook: "Discusses the new house.",
        verified: false,
      },
    });

    const gallery = buildExtraContentGallery([letterWithExtra]);

    expect(gallery).toHaveLength(1);
    expect(gallery[0].mediaType).toBe("cover");
    expect(gallery[0].hook).toBe(""); // hook omitted — it describes the letter, not the cover
  });

  it("builds correspondents with sent/received counts", () => {
    const correspondents = buildCorrespondents(letters);

    expect(correspondents.length).toBeGreaterThan(0);
    const alice = correspondents.find((c) => c.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice!.sentCount).toBe(2);
    expect(alice!.receivedCount).toBe(1);
    expect(alice!.totalLetters).toBe(3);
  });

  it("handles empty letter arrays gracefully", () => {
    const stats = computeCollectionStats([]);
    expect(stats.dateSpan).toBeNull();
    expect(stats.formatBreakdown).toBe("0 items");

    const highlights = pickLetterHighlights([]);
    expect(highlights).toEqual([]);

    const correspondents = buildCorrespondents([]);
    expect(correspondents).toEqual([]);
  });
});
