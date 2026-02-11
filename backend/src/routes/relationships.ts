import { Router } from 'express';
import { eq, and, or, isNull, sql, asc } from 'drizzle-orm';
import {
  db,
  personRelationships,
  canonicalPersons,
  letterPersons,
  letters,
} from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'public-relationships' });
const router = Router();

/**
 * GET /relationships - Get all relationships for public view
 *
 * Returns a graph-ready format with nodes (people) and edges (relationships)
 */
router.get('/relationships', async (_req, res, next) => {
  try {
    log.debug('Fetching all relationships');

    // Get all relationships with person names
    const relationships = await db
      .select({
        id: personRelationships.id,
        personAId: personRelationships.personAId,
        personBId: personRelationships.personBId,
        relationshipType: personRelationships.relationshipType,
        confidence: personRelationships.confidence,
        personAName: sql<string>`pa.canonical_name`,
        personBName: sql<string>`pb.canonical_name`,
      })
      .from(personRelationships)
      .innerJoin(
        sql`canonical_persons pa`,
        sql`pa.id = ${personRelationships.personAId}`
      )
      .innerJoin(
        sql`canonical_persons pb`,
        sql`pb.id = ${personRelationships.personBId}`
      )
      .orderBy(asc(sql`pa.canonical_name`));

    // Get all people who have relationships
    const personIds = new Set<string>();
    relationships.forEach((r) => {
      personIds.add(r.personAId);
      personIds.add(r.personBId);
    });

    // Get letter counts for each person
    const letterCounts = await db
      .select({
        personId: letterPersons.personId,
        count: sql<number>`COUNT(DISTINCT ${letterPersons.letterId})`,
      })
      .from(letterPersons)
      .innerJoin(letters, eq(letterPersons.letterId, letters.id))
      .where(
        and(
          eq(letters.visibility, 'PUBLISHED'),
          isNull(letters.deletedAt)
        )
      )
      .groupBy(letterPersons.personId);

    const letterCountMap = new Map<string, number>();
    letterCounts.forEach((lc) => {
      letterCountMap.set(lc.personId, Number(lc.count));
    });

    // Build nodes array
    const nodes = Array.from(personIds).map((id) => {
      const rel = relationships.find((r) => r.personAId === id || r.personBId === id);
      const name = rel
        ? rel.personAId === id
          ? rel.personAName
          : rel.personBName
        : '';
      return {
        id,
        name,
        letterCount: letterCountMap.get(id) || 0,
      };
    });

    // Build edges array
    const edges = relationships.map((r) => ({
      id: r.id,
      source: r.personAId,
      target: r.personBId,
      relationshipType: r.relationshipType,
      confidence: r.confidence,
    }));

    res.json({ nodes, edges });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /relationships/collection/:collectionId - Get relationships for a specific collection
 *
 * Returns only people and relationships that appear in letters of this collection
 */
router.get('/relationships/collection/:collectionId', async (req, res, next) => {
  try {
    const { collectionId } = req.params;
    log.debug({ collectionId }, 'Fetching relationships for collection');

    // Get all people who appear in letters from this collection
    const collectionPeople = await db
      .select({
        personId: letterPersons.personId,
        personName: canonicalPersons.canonicalName,
        letterCount: sql<number>`COUNT(DISTINCT ${letterPersons.letterId})`,
      })
      .from(letterPersons)
      .innerJoin(letters, eq(letterPersons.letterId, letters.id))
      .innerJoin(canonicalPersons, eq(letterPersons.personId, canonicalPersons.id))
      .where(
        and(
          eq(letters.collectionId, collectionId),
          eq(letters.visibility, 'PUBLISHED'),
          isNull(letters.deletedAt)
        )
      )
      .groupBy(letterPersons.personId, canonicalPersons.canonicalName);

    const personIds = collectionPeople.map((p) => p.personId);

    if (personIds.length === 0) {
      res.json({ nodes: [], edges: [] });
      return;
    }

    // Build nodes
    const nodes = collectionPeople.map((p) => ({
      id: p.personId,
      name: p.personName,
      letterCount: Number(p.letterCount),
    }));

    // Get relationships between these people
    const relationships = await db
      .select({
        id: personRelationships.id,
        personAId: personRelationships.personAId,
        personBId: personRelationships.personBId,
        relationshipType: personRelationships.relationshipType,
        confidence: personRelationships.confidence,
      })
      .from(personRelationships)
      .where(
        and(
          sql`${personRelationships.personAId} = ANY(${sql.raw(`ARRAY[${personIds.map((id) => `'${id}'::uuid`).join(',')}]`)})`,
          sql`${personRelationships.personBId} = ANY(${sql.raw(`ARRAY[${personIds.map((id) => `'${id}'::uuid`).join(',')}]`)})`
        )
      );

    const edges = relationships.map((r) => ({
      id: r.id,
      source: r.personAId,
      target: r.personBId,
      relationshipType: r.relationshipType,
      confidence: r.confidence,
    }));

    res.json({ nodes, edges });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /relationships/path/:personAId/:personBId - Find connection path between two people
 *
 * Uses BFS to find the shortest path through the relationship graph
 */
router.get('/relationships/path/:personAId/:personBId', async (req, res, next) => {
  try {
    const { personAId, personBId } = req.params;
    log.debug({ personAId, personBId }, 'Finding connection path');

    if (personAId === personBId) {
      res.json({ path: [personAId], edges: [] });
      return;
    }

    // Get all relationships
    const allRelationships = await db
      .select({
        id: personRelationships.id,
        personAId: personRelationships.personAId,
        personBId: personRelationships.personBId,
        relationshipType: personRelationships.relationshipType,
      })
      .from(personRelationships);

    // Build adjacency list
    const adjacencyList = new Map<string, { neighborId: string; edgeId: string; type: string }[]>();

    for (const rel of allRelationships) {
      if (!adjacencyList.has(rel.personAId)) {
        adjacencyList.set(rel.personAId, []);
      }
      if (!adjacencyList.has(rel.personBId)) {
        adjacencyList.set(rel.personBId, []);
      }
      adjacencyList.get(rel.personAId)!.push({
        neighborId: rel.personBId,
        edgeId: rel.id,
        type: rel.relationshipType,
      });
      adjacencyList.get(rel.personBId)!.push({
        neighborId: rel.personAId,
        edgeId: rel.id,
        type: rel.relationshipType,
      });
    }

    // BFS to find shortest path
    const visited = new Set<string>();
    const queue: { personId: string; path: string[]; edges: { id: string; type: string }[] }[] = [
      { personId: personAId, path: [personAId], edges: [] },
    ];
    visited.add(personAId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.personId === personBId) {
        // Found the target - get person names for the path
        const personNames = await db
          .select({
            id: canonicalPersons.id,
            name: canonicalPersons.canonicalName,
          })
          .from(canonicalPersons)
          .where(
            sql`${canonicalPersons.id} = ANY(${sql.raw(`ARRAY[${current.path.map((id) => `'${id}'::uuid`).join(',')}]`)})`
          );

        const nameMap = new Map(personNames.map((p) => [p.id, p.name]));

        res.json({
          path: current.path.map((id) => ({
            id,
            name: nameMap.get(id) || 'Unknown',
          })),
          edges: current.edges,
        });
        return;
      }

      const neighbors = adjacencyList.get(current.personId) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.neighborId)) {
          visited.add(neighbor.neighborId);
          queue.push({
            personId: neighbor.neighborId,
            path: [...current.path, neighbor.neighborId],
            edges: [...current.edges, { id: neighbor.edgeId, type: neighbor.type }],
          });
        }
      }
    }

    // No path found
    res.json({ path: [], edges: [], message: 'No connection found between these people' });
  } catch (error) {
    next(error);
  }
});

export default router;
