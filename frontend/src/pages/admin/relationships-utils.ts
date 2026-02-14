import type { PersonRelationship } from "../../api/entities";

export interface RelationshipFilters {
  searchQuery: string;
  typeFilter: string;
  minConfidence: number;
}

export interface RelationshipInsights {
  totalRelationships: number;
  uniquePeople: number;
  averageConfidence: number;
  lowConfidenceCount: number;
  topTypes: Array<{ type: string; count: number }>;
}

const LOW_CONFIDENCE_THRESHOLD = 70;

export function filterRelationships(
  relationships: PersonRelationship[],
  filters: RelationshipFilters,
): PersonRelationship[] {
  const query = filters.searchQuery.trim().toLowerCase();

  return relationships.filter((rel) => {
    if (filters.typeFilter !== "all" && rel.relationshipType !== filters.typeFilter) {
      return false;
    }

    if (rel.confidence < filters.minConfidence) {
      return false;
    }

    if (!query) {
      return true;
    }

    return (
      rel.personAName.toLowerCase().includes(query) ||
      rel.personBName.toLowerCase().includes(query) ||
      rel.relationshipType.toLowerCase().includes(query)
    );
  });
}

export function buildRelationshipInsights(
  relationships: PersonRelationship[],
): RelationshipInsights {
  if (relationships.length === 0) {
    return {
      totalRelationships: 0,
      uniquePeople: 0,
      averageConfidence: 0,
      lowConfidenceCount: 0,
      topTypes: [],
    };
  }

  const people = new Set<string>();
  const countsByType = new Map<string, number>();
  let confidenceTotal = 0;
  let lowConfidenceCount = 0;

  for (const rel of relationships) {
    people.add(rel.personAId);
    people.add(rel.personBId);
    confidenceTotal += rel.confidence;
    if (rel.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceCount += 1;
    }
    countsByType.set(rel.relationshipType, (countsByType.get(rel.relationshipType) ?? 0) + 1);
  }

  const topTypes = Array.from(countsByType.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return {
    totalRelationships: relationships.length,
    uniquePeople: people.size,
    averageConfidence: Math.round(confidenceTotal / relationships.length),
    lowConfidenceCount,
    topTypes,
  };
}

