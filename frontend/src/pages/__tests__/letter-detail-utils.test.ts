import { describe, expect, it } from "vitest";
import type { Letter } from "../../types/Letter";
import { buildLetterDiscoveryLinks } from "../letter-detail-utils";

function buildLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: overrides.id || "l1",
    title: overrides.title || "Letter",
    images: overrides.images || [],
    transcript: overrides.transcript || { pages: [], fullText: "", verified: false },
    metadata: overrides.metadata || { verified: false },
    status: overrides.status || "published",
    workflowState: overrides.workflowState || "REVIEWED",
    visibility: overrides.visibility || "PUBLISHED",
    transcriptStatus: overrides.transcriptStatus || "VERIFIED",
    metadataContentStatus: overrides.metadataContentStatus || "VERIFIED",
    extraContentStatus: overrides.extraContentStatus || "EMPTY",
    createdAt: overrides.createdAt || "2024-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2024-01-02T00:00:00.000Z",
    linkedPersons: overrides.linkedPersons,
    linkedPlaces: overrides.linkedPlaces,
  };
}

describe("buildLetterDiscoveryLinks", () => {
  it("deduplicates linked people and merges roles", () => {
    const letter = buildLetter({
      linkedPersons: [
        { id: "1", personId: "p1", canonicalName: "Alice", role: "sender", confidence: 90 },
        { id: "2", personId: "p1", canonicalName: "Alice", role: "mentioned", confidence: 80 },
        { id: "3", personId: "p2", canonicalName: "Bob", role: "recipient", confidence: 88 },
      ],
    });

    const links = buildLetterDiscoveryLinks(letter);
    expect(links.persons).toEqual([
      { personId: "p1", canonicalName: "Alice", roles: ["sender", "mentioned"] },
      { personId: "p2", canonicalName: "Bob", roles: ["recipient"] },
    ]);
  });

  it("deduplicates linked places and merges roles", () => {
    const letter = buildLetter({
      linkedPlaces: [
        { id: "1", placeId: "pl1", canonicalName: "Chicago", role: "written_from", confidence: 90 },
        { id: "2", placeId: "pl1", canonicalName: "Chicago", role: "mentioned", confidence: 70 },
        { id: "3", placeId: "pl2", canonicalName: "London", role: "destination", confidence: 88 },
      ],
    });

    const links = buildLetterDiscoveryLinks(letter);
    expect(links.places).toEqual([
      { placeId: "pl1", canonicalName: "Chicago", roles: ["written_from", "mentioned"] },
      { placeId: "pl2", canonicalName: "London", roles: ["destination"] },
    ]);
  });
});
