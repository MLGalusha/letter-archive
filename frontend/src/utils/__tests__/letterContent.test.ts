import { describe, expect, it } from "vitest";
import type { Letter } from "../../types/Letter";
import {
  getPrimaryImageType,
  hasPrimaryTranscriptContent,
  hasRelatedExtraContent,
  shouldShowPublicTranscript,
} from "../letterContent";

function buildLetter(overrides: Partial<Pick<Letter, "images" | "transcript">> = {}) {
  return {
    images: [],
    transcript: {
      pages: [],
      fullText: "",
      verified: false,
    },
    ...overrides,
  };
}

describe("letter content helpers", () => {
  it("treats standalone telegrams as primary transcript content", () => {
    const letter = buildLetter({
      images: [{ id: "img-1", type: "telegram", imageUrl: "/images/1" }],
      transcript: {
        pages: [{ pageNumber: 1, text: "STOP HELLO" }],
        fullText: "STOP HELLO",
        verified: false,
      },
    });

    expect(getPrimaryImageType(letter)).toBe("telegram");
    expect(hasPrimaryTranscriptContent(letter)).toBe(true);
    expect(hasRelatedExtraContent(letter)).toBe(false);
    expect(shouldShowPublicTranscript(letter)).toBe(true);
  });

  it("shows related extra content only for letter groups with attached extras", () => {
    const letter = buildLetter({
      images: [
        { id: "img-letter-1", type: "letter", imageUrl: "/images/letter-1" },
        { id: "img-letter-2", type: "letter", imageUrl: "/images/letter-2" },
        { id: "img-cover-1", type: "cover", imageUrl: "/images/cover-1" },
      ],
    });

    expect(hasPrimaryTranscriptContent(letter)).toBe(true);
    expect(hasRelatedExtraContent(letter)).toBe(true);
    expect(shouldShowPublicTranscript(letter)).toBe(true);
  });

  it("does not expose transcript UI for photo-only items", () => {
    const letter = buildLetter({
      images: [{ id: "img-photo-1", type: "photo", imageUrl: "/images/photo-1" }],
      transcript: {
        pages: [],
        fullText: "",
        verified: false,
      },
    });

    expect(hasPrimaryTranscriptContent(letter)).toBe(false);
    expect(hasRelatedExtraContent(letter)).toBe(false);
    expect(shouldShowPublicTranscript(letter)).toBe(false);
  });

  it("hides empty standalone non-letter transcripts on the public side", () => {
    const letter = buildLetter({
      images: [{ id: "img-article-1", type: "article", imageUrl: "/images/article-1" }],
    });

    expect(hasPrimaryTranscriptContent(letter)).toBe(true);
    expect(shouldShowPublicTranscript(letter)).toBe(false);
  });
});
