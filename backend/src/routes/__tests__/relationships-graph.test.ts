import { describe, expect, it } from 'vitest';
import {
  buildRelationshipAdjacency,
  findShortestRelationshipPath,
} from '../relationships-graph.js';

describe('relationships-graph helpers', () => {
  it('builds bidirectional adjacency for each relationship', () => {
    const adjacency = buildRelationshipAdjacency([
      { id: 'r1', personAId: 'a', personBId: 'b', relationshipType: 'friend' },
    ]);

    expect(adjacency.get('a')).toEqual([{ neighborId: 'b', edgeId: 'r1', type: 'friend' }]);
    expect(adjacency.get('b')).toEqual([{ neighborId: 'a', edgeId: 'r1', type: 'friend' }]);
  });

  it('finds the shortest path between two people', () => {
    const adjacency = buildRelationshipAdjacency([
      { id: 'r1', personAId: 'a', personBId: 'b', relationshipType: 'friend' },
      { id: 'r2', personAId: 'b', personBId: 'c', relationshipType: 'sibling' },
      { id: 'r3', personAId: 'a', personBId: 'd', relationshipType: 'cousin' },
      { id: 'r4', personAId: 'd', personBId: 'c', relationshipType: 'cousin' },
    ]);

    const path = findShortestRelationshipPath(adjacency, 'a', 'c');
    expect(path).toEqual({
      personIds: ['a', 'b', 'c'],
      edges: [
        { id: 'r1', type: 'friend' },
        { id: 'r2', type: 'sibling' },
      ],
    });
  });

  it('returns null when no path exists', () => {
    const adjacency = buildRelationshipAdjacency([
      { id: 'r1', personAId: 'a', personBId: 'b', relationshipType: 'friend' },
      { id: 'r2', personAId: 'x', personBId: 'y', relationshipType: 'friend' },
    ]);

    expect(findShortestRelationshipPath(adjacency, 'a', 'y')).toBeNull();
  });
});
