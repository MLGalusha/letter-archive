import { describe, expect, it } from "vitest";
import type { PersonRelationship } from "../../../api/entities";
import {
  buildRelationshipInsights,
  filterRelationships,
} from "../relationships-utils";

function makeRelationship(
  overrides: Partial<PersonRelationship> = {},
): PersonRelationship {
  return {
    id: "rel-1",
    personAId: "a",
    personBId: "b",
    personAName: "Alice",
    personBName: "Bob",
    relationshipType: "friend",
    confidence: 82,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterRelationships", () => {
  it("filters by relationship type and confidence floor", () => {
    const rels = [
      makeRelationship({ id: "1", relationshipType: "friend", confidence: 85 }),
      makeRelationship({ id: "2", relationshipType: "friend", confidence: 60 }),
      makeRelationship({ id: "3", relationshipType: "sibling", confidence: 95 }),
    ];

    const filtered = filterRelationships(rels, {
      searchQuery: "",
      typeFilter: "friend",
      minConfidence: 70,
    });

    expect(filtered.map((r) => r.id)).toEqual(["1"]);
  });

  it("matches search query against names and relationship type", () => {
    const rels = [
      makeRelationship({ id: "1", personAName: "Mason", personBName: "Eli", relationshipType: "friend" }),
      makeRelationship({ id: "2", personAName: "Ari", personBName: "Nora", relationshipType: "business-associate" }),
    ];

    const byName = filterRelationships(rels, {
      searchQuery: "mason",
      typeFilter: "all",
      minConfidence: 0,
    });
    const byType = filterRelationships(rels, {
      searchQuery: "business",
      typeFilter: "all",
      minConfidence: 0,
    });

    expect(byName.map((r) => r.id)).toEqual(["1"]);
    expect(byType.map((r) => r.id)).toEqual(["2"]);
  });
});

describe("buildRelationshipInsights", () => {
  it("computes aggregate relationship metrics", () => {
    const rels = [
      makeRelationship({ id: "1", personAId: "a", personBId: "b", relationshipType: "friend", confidence: 80 }),
      makeRelationship({ id: "2", personAId: "b", personBId: "c", relationshipType: "friend", confidence: 68 }),
      makeRelationship({ id: "3", personAId: "a", personBId: "d", relationshipType: "sibling", confidence: 92 }),
    ];

    const insights = buildRelationshipInsights(rels);
    expect(insights.totalRelationships).toBe(3);
    expect(insights.uniquePeople).toBe(4);
    expect(insights.averageConfidence).toBe(80);
    expect(insights.lowConfidenceCount).toBe(1);
    expect(insights.topTypes[0]).toEqual({ type: "friend", count: 2 });
  });

  it("returns zeroed metrics for empty lists", () => {
    expect(buildRelationshipInsights([])).toEqual({
      totalRelationships: 0,
      uniquePeople: 0,
      averageConfidence: 0,
      lowConfidenceCount: 0,
      topTypes: [],
    });
  });
});

