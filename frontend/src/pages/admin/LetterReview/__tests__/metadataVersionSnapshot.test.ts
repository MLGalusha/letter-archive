import { describe, expect, it } from "vitest";
import type { Letter } from "../../../../types/Letter";
import {
  createMetadataVersionSnapshot,
  hasMetadataVersionPatch,
} from "../metadataVersionSnapshot";

function authoritativeLetter(
  metadata: Partial<Letter["metadata"]> = {},
): Pick<Letter, "metadata"> {
  return {
    metadata: {
      verified: false,
      ...metadata,
    },
  };
}

describe("createMetadataVersionSnapshot", () => {
  it("recognizes only committed metadata fields as version work", () => {
    expect(hasMetadataVersionPatch({})).toBe(false);
    expect(hasMetadataVersionPatch({ hook: null })).toBe(true);
  });

  it("applies patch precedence while mapping DTO aliases into all nine stored fields", () => {
    const snapshot = createMetadataVersionSnapshot(
      {
        recipient: null,
        extractedDate: "1944-06-06",
        hook: "Edited hook",
        primaryTopics: ["war/military"],
      },
      authoritativeLetter({
        sender: "Authoritative sender",
        recipient: "Authoritative recipient",
        extractedDate: "1944-06-05",
        location: "Portsmouth",
        hook: "Authoritative hook",
        description: "Authoritative summary",
        emotionalTone: "hopeful",
        senderRecipientRelationship: "friend",
        primaryTopics: ["travel/journey"],
      }),
    );

    expect(snapshot).toEqual({
      sender: "Authoritative sender",
      recipient: null,
      extractedDate: "1944-06-06",
      locationWritten: "Portsmouth",
      hook: "Edited hook",
      summary: "Authoritative summary",
      emotionalTone: "hopeful",
      senderRecipientRelationship: "friend",
      primaryTopics: ["war/military"],
    });
  });

  it("normalizes every missing DTO value to an explicit JSON null", () => {
    const snapshot = createMetadataVersionSnapshot(
      {},
      authoritativeLetter(),
    );

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual({
      sender: null,
      recipient: null,
      extractedDate: null,
      locationWritten: null,
      hook: null,
      summary: null,
      emotionalTone: null,
      senderRecipientRelationship: null,
      primaryTopics: null,
    });
  });

  it("preserves authoritative empty strings instead of converting them to null", () => {
    const snapshot = createMetadataVersionSnapshot(
      { hook: "Edited hook" },
      authoritativeLetter({
        sender: "",
        recipient: "",
        location: "",
        hook: "",
        description: "",
      }),
    );

    expect(snapshot).toMatchObject({
      sender: "",
      recipient: "",
      locationWritten: "",
      hook: "Edited hook",
      summary: "",
    });
  });

  it("owns the topics array selected by the committed patch", () => {
    const topics = ["family/marriage"];
    const snapshot = createMetadataVersionSnapshot(
      { primaryTopics: topics },
      authoritativeLetter({
        primaryTopics: ["travel/journey"],
      }),
    );

    expect(snapshot.primaryTopics).toEqual(["family/marriage"]);
    expect(snapshot.primaryTopics).not.toBe(topics);

    topics.push("war/military");
    expect(snapshot.primaryTopics).toEqual(["family/marriage"]);
  });
});
