import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../../api/entities";
import { applyGraphFilters, buildGraphInsights } from "../explore-utils";

const nodes: GraphNode[] = [
  { id: "a", name: "Alice", letterCount: 10 },
  { id: "b", name: "Bob", letterCount: 7 },
  { id: "c", name: "Cara", letterCount: 5 },
];

const edges: GraphEdge[] = [
  { id: "e1", source: "a", target: "b", relationshipType: "friend", confidence: 88 },
  { id: "e2", source: "b", target: "c", relationshipType: "sibling", confidence: 62 },
];

describe("applyGraphFilters", () => {
  it("filters by relationship type and confidence", () => {
    const filtered = applyGraphFilters(nodes, edges, {
      relationshipType: "friend",
      minConfidence: 70,
    });

    expect(filtered.edges.map((edge) => edge.id)).toEqual(["e1"]);
    expect(filtered.nodes.map((node) => node.id).sort()).toEqual(["a", "b"]);
  });

  it("returns empty node list when no edges match", () => {
    const filtered = applyGraphFilters(nodes, edges, {
      relationshipType: "in-law",
      minConfidence: 90,
    });
    expect(filtered.nodes).toEqual([]);
    expect(filtered.edges).toEqual([]);
  });
});

describe("buildGraphInsights", () => {
  it("computes graph totals and connector leaders", () => {
    const insights = buildGraphInsights(nodes, edges);

    expect(insights.totalPeople).toBe(3);
    expect(insights.totalConnections).toBe(2);
    expect(insights.averageConfidence).toBe(75);
    expect(insights.strongestType).toEqual({ type: "friend", count: 1 });
    expect(insights.connectorLeaders[0]).toMatchObject({ id: "b", degree: 2 });
  });

  it("returns zero-confidence insights for empty graph", () => {
    const insights = buildGraphInsights([], []);
    expect(insights.averageConfidence).toBe(0);
    expect(insights.connectorLeaders).toEqual([]);
    expect(insights.typeBreakdown).toEqual([]);
  });
});

