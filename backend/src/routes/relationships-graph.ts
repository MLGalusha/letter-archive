export interface RelationshipRow {
  id: string;
  personAId: string;
  personBId: string;
  relationshipType: string;
}

export interface PathEdge {
  id: string;
  type: string;
}

interface QueueItem {
  personId: string;
  path: string[];
  edges: PathEdge[];
}

export type RelationshipAdjacency = Map<
  string,
  Array<{ neighborId: string; edgeId: string; type: string }>
>;

export interface ShortestPathResult {
  personIds: string[];
  edges: PathEdge[];
}

export function buildRelationshipAdjacency(
  relationships: RelationshipRow[],
): RelationshipAdjacency {
  const adjacency: RelationshipAdjacency = new Map();

  for (const rel of relationships) {
    if (!adjacency.has(rel.personAId)) adjacency.set(rel.personAId, []);
    if (!adjacency.has(rel.personBId)) adjacency.set(rel.personBId, []);

    adjacency.get(rel.personAId)!.push({
      neighborId: rel.personBId,
      edgeId: rel.id,
      type: rel.relationshipType,
    });
    adjacency.get(rel.personBId)!.push({
      neighborId: rel.personAId,
      edgeId: rel.id,
      type: rel.relationshipType,
    });
  }

  return adjacency;
}

export function findShortestRelationshipPath(
  adjacency: RelationshipAdjacency,
  startId: string,
  targetId: string,
): ShortestPathResult | null {
  if (startId === targetId) {
    return { personIds: [startId], edges: [] };
  }

  const visited = new Set<string>([startId]);
  const queue: QueueItem[] = [{ personId: startId, path: [startId], edges: [] }];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    if (current.personId === targetId) {
      return { personIds: current.path, edges: current.edges };
    }

    const neighbors = adjacency.get(current.personId) ?? [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.neighborId)) continue;
      visited.add(neighbor.neighborId);
      queue.push({
        personId: neighbor.neighborId,
        path: [...current.path, neighbor.neighborId],
        edges: [...current.edges, { id: neighbor.edgeId, type: neighbor.type }],
      });
    }
  }

  return null;
}
