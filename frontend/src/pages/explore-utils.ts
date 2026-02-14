import type { GraphEdge, GraphNode } from "../api/entities";

export interface GraphFilters {
  relationshipType: string;
  minConfidence: number;
}

export interface GraphInsights {
  totalPeople: number;
  totalConnections: number;
  averageConfidence: number;
  strongestType?: { type: string; count: number };
  connectorLeaders: Array<{ id: string; name: string; degree: number; letterCount: number }>;
  typeBreakdown: Array<{ type: string; count: number }>;
}

export function applyGraphFilters(
  nodes: GraphNode[],
  edges: GraphEdge[],
  filters: GraphFilters,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const visibleEdges = edges.filter((edge) => {
    if (filters.relationshipType !== "all" && edge.relationshipType !== filters.relationshipType) {
      return false;
    }
    return edge.confidence >= filters.minConfidence;
  });

  const visibleNodeIds = new Set<string>();
  for (const edge of visibleEdges) {
    visibleNodeIds.add(edge.source);
    visibleNodeIds.add(edge.target);
  }

  const visibleNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
  return { nodes: visibleNodes, edges: visibleEdges };
}

export function buildGraphInsights(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights {
  if (nodes.length === 0 || edges.length === 0) {
    return {
      totalPeople: nodes.length,
      totalConnections: edges.length,
      averageConfidence: 0,
      connectorLeaders: [],
      typeBreakdown: [],
    };
  }

  const degreeMap = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let confidenceSum = 0;

  for (const edge of edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    typeCounts.set(edge.relationshipType, (typeCounts.get(edge.relationshipType) ?? 0) + 1);
    confidenceSum += edge.confidence;
  }

  const typeBreakdown = Array.from(typeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const connectorLeaders = nodes
    .map((node) => ({
      id: node.id,
      name: node.name,
      degree: degreeMap.get(node.id) ?? 0,
      letterCount: node.letterCount,
    }))
    .filter((item) => item.degree > 0)
    .sort((a, b) => (b.degree === a.degree ? b.letterCount - a.letterCount : b.degree - a.degree))
    .slice(0, 8);

  return {
    totalPeople: nodes.length,
    totalConnections: edges.length,
    averageConfidence: Math.round(confidenceSum / edges.length),
    strongestType: typeBreakdown[0],
    connectorLeaders,
    typeBreakdown,
  };
}

