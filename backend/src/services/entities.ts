import { eq, and, sql, desc, asc, or } from 'drizzle-orm';
import {
  db,
  canonicalPersons,
  canonicalPlaces,
  letterPersons,
  letterPlaces,
  entityReviewQueue,
  personRelationships,
  type CanonicalPerson,
  type CanonicalPlace,
  type LetterPerson,
  type LetterPlace,
  type EntityReviewItem,
  type NewCanonicalPerson,
  type NewCanonicalPlace,
  type NewLetterPerson,
  type NewLetterPlace,
  type PersonRole,
  type PlaceRole,
  type PlaceType,
  type PersonRelationship,
  type PersonRelationshipType,
} from '../db/index.js';

// ============================================================================
// MATCH THRESHOLDS
// ============================================================================

const MATCH_THRESHOLDS = {
  AUTO_LINK: 0.85, // >= 85% similarity: auto-link without review
  SUGGEST: 0.50, // >= 50% similarity: suggest for review
};

// ============================================================================
// FUZZY MATCHING
// ============================================================================

export interface MatchResult {
  entityId: string;
  canonicalName: string;
  matchedOn: 'canonical_name' | 'alias';
  similarity: number; // 0-100 scale
}

/**
 * Find matching persons using trigram similarity
 */
export async function findMatchingPersons(
  name: string,
  limit: number = 5
): Promise<MatchResult[]> {
  const results = await db.execute<{
    id: string;
    canonical_name: string;
    matched_on: string;
    similarity_score: number;
  }>(sql`
    SELECT
      id,
      canonical_name,
      'canonical_name' as matched_on,
      similarity(canonical_name, ${name}) as similarity_score
    FROM canonical_persons
    WHERE similarity(canonical_name, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}

    UNION ALL

    SELECT
      id,
      canonical_name,
      'alias' as matched_on,
      (SELECT MAX(similarity(alias, ${name})) FROM unnest(aliases) AS alias) as similarity_score
    FROM canonical_persons
    WHERE EXISTS (
      SELECT 1 FROM unnest(aliases) AS alias
      WHERE similarity(alias, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}
    )

    ORDER BY similarity_score DESC
    LIMIT ${limit}
  `);

  // Handle both postgres.js array result and drizzle wrapped result
  const rows = Array.isArray(results) ? results : (results as unknown as { rows?: unknown[] }).rows ?? [];

  return (rows as Array<{ id: string; canonical_name: string; matched_on: string; similarity_score: number }>).map((row) => ({
    entityId: row.id,
    canonicalName: row.canonical_name,
    matchedOn: row.matched_on as 'canonical_name' | 'alias',
    similarity: Math.round(row.similarity_score * 100),
  }));
}

/**
 * Find matching places using trigram similarity
 */
export async function findMatchingPlaces(
  name: string,
  limit: number = 5
): Promise<MatchResult[]> {
  const results = await db.execute<{
    id: string;
    canonical_name: string;
    matched_on: string;
    similarity_score: number;
  }>(sql`
    SELECT
      id,
      canonical_name,
      'canonical_name' as matched_on,
      similarity(canonical_name, ${name}) as similarity_score
    FROM canonical_places
    WHERE similarity(canonical_name, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}

    UNION ALL

    SELECT
      id,
      canonical_name,
      'alias' as matched_on,
      (SELECT MAX(similarity(alias, ${name})) FROM unnest(aliases) AS alias) as similarity_score
    FROM canonical_places
    WHERE EXISTS (
      SELECT 1 FROM unnest(aliases) AS alias
      WHERE similarity(alias, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}
    )

    ORDER BY similarity_score DESC
    LIMIT ${limit}
  `);

  // Handle both postgres.js array result and drizzle wrapped result
  const rows = Array.isArray(results) ? results : (results as unknown as { rows?: unknown[] }).rows ?? [];

  return (rows as Array<{ id: string; canonical_name: string; matched_on: string; similarity_score: number }>).map((row) => ({
    entityId: row.id,
    canonicalName: row.canonical_name,
    matchedOn: row.matched_on as 'canonical_name' | 'alias',
    similarity: Math.round(row.similarity_score * 100),
  }));
}

// ============================================================================
// CANONICAL PERSON CRUD
// ============================================================================

export async function createCanonicalPerson(
  data: Omit<NewCanonicalPerson, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const [person] = await db
    .insert(canonicalPersons)
    .values(data)
    .returning({ id: canonicalPersons.id });
  return person.id;
}

export async function getCanonicalPersonById(
  id: string
): Promise<CanonicalPerson | undefined> {
  return db.query.canonicalPersons.findFirst({
    where: eq(canonicalPersons.id, id),
  });
}

export async function getAllCanonicalPersons(): Promise<CanonicalPerson[]> {
  return db.query.canonicalPersons.findMany({
    orderBy: [asc(canonicalPersons.canonicalName)],
  });
}

export async function updateCanonicalPerson(
  id: string,
  data: Partial<Pick<CanonicalPerson, 'canonicalName' | 'aliases' | 'notes'>>
): Promise<void> {
  await db
    .update(canonicalPersons)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(canonicalPersons.id, id));
}

export async function mergePersons(keepId: string, mergeId: string): Promise<void> {
  const keepPerson = await getCanonicalPersonById(keepId);
  const mergePerson = await getCanonicalPersonById(mergeId);

  if (!keepPerson || !mergePerson) {
    throw new Error('Both persons must exist');
  }

  // Combine aliases
  const combinedAliases = [
    ...(keepPerson.aliases || []),
    mergePerson.canonicalName,
    ...(mergePerson.aliases || []),
  ].filter((v, i, a) => a.indexOf(v) === i); // Dedupe

  // Update kept person
  await updateCanonicalPerson(keepId, { aliases: combinedAliases });

  // Reassign all letter_persons from merged to kept
  await db
    .update(letterPersons)
    .set({ personId: keepId })
    .where(eq(letterPersons.personId, mergeId));

  // Reassign all relationships from merged to kept
  // Update relationships where merged is personA
  await db
    .update(personRelationships)
    .set({ personAId: keepId })
    .where(eq(personRelationships.personAId, mergeId));
  // Update relationships where merged is personB
  await db
    .update(personRelationships)
    .set({ personBId: keepId })
    .where(eq(personRelationships.personBId, mergeId));

  // Delete merged person (cascade will clean up any duplicate relationships)
  await db.delete(canonicalPersons).where(eq(canonicalPersons.id, mergeId));
}

// ============================================================================
// CANONICAL PLACE CRUD
// ============================================================================

export async function createCanonicalPlace(
  data: Omit<NewCanonicalPlace, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const [place] = await db
    .insert(canonicalPlaces)
    .values(data)
    .returning({ id: canonicalPlaces.id });
  return place.id;
}

export async function getCanonicalPlaceById(
  id: string
): Promise<CanonicalPlace | undefined> {
  return db.query.canonicalPlaces.findFirst({
    where: eq(canonicalPlaces.id, id),
  });
}

export async function getAllCanonicalPlaces(): Promise<CanonicalPlace[]> {
  return db.query.canonicalPlaces.findMany({
    orderBy: [asc(canonicalPlaces.canonicalName)],
  });
}

export async function updateCanonicalPlace(
  id: string,
  data: Partial<Pick<CanonicalPlace, 'canonicalName' | 'aliases' | 'placeType' | 'notes'>>
): Promise<void> {
  await db
    .update(canonicalPlaces)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(canonicalPlaces.id, id));
}

// ============================================================================
// LETTER-ENTITY JUNCTION CRUD
// ============================================================================

export async function createLetterPerson(
  data: Omit<NewLetterPerson, 'id' | 'createdAt'>
): Promise<string | undefined> {
  const [lp] = await db
    .insert(letterPersons)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: letterPersons.id });
  return lp?.id;
}

export async function createLetterPlace(
  data: Omit<NewLetterPlace, 'id' | 'createdAt'>
): Promise<string | undefined> {
  const [lp] = await db
    .insert(letterPlaces)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: letterPlaces.id });
  return lp?.id;
}

export async function getPersonsForLetter(
  letterId: string
): Promise<(LetterPerson & { person: CanonicalPerson })[]> {
  return db.query.letterPersons.findMany({
    where: eq(letterPersons.letterId, letterId),
    with: { person: true },
  });
}

export async function getPlacesForLetter(
  letterId: string
): Promise<(LetterPlace & { place: CanonicalPlace })[]> {
  return db.query.letterPlaces.findMany({
    where: eq(letterPlaces.letterId, letterId),
    with: { place: true },
  });
}

export async function getLettersForPerson(
  personId: string
): Promise<{ letterId: string; role: PersonRole; context: string | null }[]> {
  const results = await db.query.letterPersons.findMany({
    where: eq(letterPersons.personId, personId),
  });
  return results.map((r) => ({
    letterId: r.letterId,
    role: r.role,
    context: r.context,
  }));
}

export async function getLettersForPlace(
  placeId: string
): Promise<{ letterId: string; role: PlaceRole; context: string | null }[]> {
  const results = await db.query.letterPlaces.findMany({
    where: eq(letterPlaces.placeId, placeId),
  });
  return results.map((r) => ({
    letterId: r.letterId,
    role: r.role,
    context: r.context,
  }));
}

// ============================================================================
// ENTITY STATS
// ============================================================================

export async function getAllPersonsWithCounts(): Promise<
  {
    id: string;
    canonicalName: string;
    aliases: string[] | null;
    letterCount: number;
  }[]
> {
  const results = await db
    .select({
      id: canonicalPersons.id,
      canonicalName: canonicalPersons.canonicalName,
      aliases: canonicalPersons.aliases,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPersons.letterId})`,
    })
    .from(canonicalPersons)
    .leftJoin(letterPersons, eq(canonicalPersons.id, letterPersons.personId))
    .groupBy(canonicalPersons.id, canonicalPersons.canonicalName, canonicalPersons.aliases)
    .orderBy(desc(sql`COUNT(DISTINCT ${letterPersons.letterId})`));

  return results.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    aliases: r.aliases,
    letterCount: Number(r.letterCount),
  }));
}

export async function getAllPlacesWithCounts(): Promise<
  {
    id: string;
    canonicalName: string;
    aliases: string[] | null;
    placeType: PlaceType | null;
    letterCount: number;
  }[]
> {
  const results = await db
    .select({
      id: canonicalPlaces.id,
      canonicalName: canonicalPlaces.canonicalName,
      aliases: canonicalPlaces.aliases,
      placeType: canonicalPlaces.placeType,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPlaces.letterId})`,
    })
    .from(canonicalPlaces)
    .leftJoin(letterPlaces, eq(canonicalPlaces.id, letterPlaces.placeId))
    .groupBy(
      canonicalPlaces.id,
      canonicalPlaces.canonicalName,
      canonicalPlaces.aliases,
      canonicalPlaces.placeType
    )
    .orderBy(desc(sql`COUNT(DISTINCT ${letterPlaces.letterId})`));

  return results.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    aliases: r.aliases,
    placeType: r.placeType,
    letterCount: Number(r.letterCount),
  }));
}

// ============================================================================
// REVIEW QUEUE
// ============================================================================

export async function addToReviewQueue(data: {
  entityType: 'person' | 'place';
  extractedText: string;
  letterId: string;
  suggestedEntityId?: string;
  context?: string;
  confidence: number;
}): Promise<void> {
  await db.insert(entityReviewQueue).values({
    entityType: data.entityType,
    extractedText: data.extractedText,
    letterId: data.letterId,
    suggestedEntityId: data.suggestedEntityId,
    context: data.context,
    confidence: data.confidence,
    status: 'pending',
  });
}

export async function getPendingReviewItems(
  entityType?: 'person' | 'place'
): Promise<EntityReviewItem[]> {
  const conditions = [eq(entityReviewQueue.status, 'pending')];
  if (entityType) {
    conditions.push(eq(entityReviewQueue.entityType, entityType));
  }

  return db.query.entityReviewQueue.findMany({
    where: and(...conditions),
    orderBy: [desc(entityReviewQueue.confidence)],
  });
}

export async function resolveReviewItem(
  id: string,
  resolution: {
    status: 'confirmed' | 'rejected' | 'new_entity';
    reviewedBy: string;
  }
): Promise<void> {
  await db
    .update(entityReviewQueue)
    .set({
      status: resolution.status,
      reviewedBy: resolution.reviewedBy,
      reviewedAt: new Date(),
    })
    .where(eq(entityReviewQueue.id, id));
}

export async function getReviewQueueStats(): Promise<{
  pending: { persons: number; places: number };
  resolved: { confirmed: number; rejected: number; newEntity: number };
}> {
  const results = await db
    .select({
      entityType: entityReviewQueue.entityType,
      status: entityReviewQueue.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(entityReviewQueue)
    .groupBy(entityReviewQueue.entityType, entityReviewQueue.status);

  const stats = {
    pending: { persons: 0, places: 0 },
    resolved: { confirmed: 0, rejected: 0, newEntity: 0 },
  };

  for (const r of results) {
    if (r.status === 'pending') {
      if (r.entityType === 'person') stats.pending.persons = Number(r.count);
      else stats.pending.places = Number(r.count);
    } else if (r.status === 'confirmed') {
      stats.resolved.confirmed += Number(r.count);
    } else if (r.status === 'rejected') {
      stats.resolved.rejected += Number(r.count);
    } else if (r.status === 'new_entity') {
      stats.resolved.newEntity += Number(r.count);
    }
  }

  return stats;
}

// ============================================================================
// ENTITY PROCESSING (for backfill and future extraction)
// ============================================================================

export interface ExtractedEntity {
  type: 'person' | 'place';
  name: string;
  role: string;
  context: string | null;
  relationship_to_sender: string | null;
  confidence: number;
}

/**
 * Infer place type from name patterns
 */
function inferPlaceType(name: string): PlaceType {
  const lowerName = name.toLowerCase();
  if (/\b(street|road|avenue|lane|drive|blvd|boulevard)\b/.test(lowerName)) return 'street';
  if (/\b(england|america|france|germany|usa|uk|united states|united kingdom)\b/.test(lowerName))
    return 'country';
  if (/\b(county|state|province|region)\b/.test(lowerName)) return 'region';
  if (/,/.test(name)) return 'city'; // "Manchester, England" pattern
  return 'other';
}

/**
 * Process a single extracted entity from metadataV2Json
 *
 * Flow:
 * 1. Search for matching canonical entity
 * 2. If high confidence match (>=85%): auto-link
 * 3. If medium confidence match (50-84%): add to review queue
 * 4. If no match (<50%): create new entity
 */
export async function processExtractedEntity(
  entity: ExtractedEntity,
  letterId: string
): Promise<void> {
  const isPersonEntity = entity.type === 'person';

  // Find matches
  const matches = isPersonEntity
    ? await findMatchingPersons(entity.name)
    : await findMatchingPlaces(entity.name);

  const bestMatch = matches[0];
  const aiConfidence = Math.round(entity.confidence * 100);

  if (bestMatch && bestMatch.similarity >= 85) {
    // HIGH CONFIDENCE: Auto-link to existing entity
    if (isPersonEntity) {
      await createLetterPerson({
        letterId,
        personId: bestMatch.entityId,
        role: entity.role as PersonRole,
        nameAsWritten: entity.name,
        relationshipToSender: entity.relationship_to_sender,
        context: entity.context,
        confidence: Math.min(aiConfidence, bestMatch.similarity),
      });
    } else {
      await createLetterPlace({
        letterId,
        placeId: bestMatch.entityId,
        role: entity.role as PlaceRole,
        nameAsWritten: entity.name,
        context: entity.context,
        confidence: Math.min(aiConfidence, bestMatch.similarity),
      });
    }
  } else if (bestMatch && bestMatch.similarity >= 50) {
    // MEDIUM CONFIDENCE: Add to review queue with suggestion
    await addToReviewQueue({
      entityType: entity.type,
      extractedText: entity.name,
      letterId,
      suggestedEntityId: bestMatch.entityId,
      context: entity.context ?? undefined,
      confidence: bestMatch.similarity,
    });
  } else {
    // NO MATCH: Create new entity directly
    const newEntityId = isPersonEntity
      ? await createCanonicalPerson({ canonicalName: entity.name })
      : await createCanonicalPlace({
          canonicalName: entity.name,
          placeType: inferPlaceType(entity.name),
        });

    if (isPersonEntity) {
      await createLetterPerson({
        letterId,
        personId: newEntityId,
        role: entity.role as PersonRole,
        nameAsWritten: entity.name,
        relationshipToSender: entity.relationship_to_sender,
        context: entity.context,
        confidence: aiConfidence,
      });
    } else {
      await createLetterPlace({
        letterId,
        placeId: newEntityId,
        role: entity.role as PlaceRole,
        nameAsWritten: entity.name,
        context: entity.context,
        confidence: aiConfidence,
      });
    }
  }
}

// ============================================================================
// PERSON RELATIONSHIPS
// ============================================================================

export interface PersonRelationshipWithNames extends PersonRelationship {
  personAName: string;
  personBName: string;
}

/**
 * Get all relationships for a specific person
 */
export async function getRelationshipsForPerson(
  personId: string
): Promise<PersonRelationshipWithNames[]> {
  // Get relationships where this person is either personA or personB
  const results = await db
    .select({
      id: personRelationships.id,
      personAId: personRelationships.personAId,
      personBId: personRelationships.personBId,
      relationshipType: personRelationships.relationshipType,
      notes: personRelationships.notes,
      discoveredInLetterId: personRelationships.discoveredInLetterId,
      confidence: personRelationships.confidence,
      confirmedBy: personRelationships.confirmedBy,
      confirmedAt: personRelationships.confirmedAt,
      createdAt: personRelationships.createdAt,
      updatedAt: personRelationships.updatedAt,
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
    .where(
      or(
        eq(personRelationships.personAId, personId),
        eq(personRelationships.personBId, personId)
      )
    )
    .orderBy(asc(sql`pa.canonical_name`), asc(sql`pb.canonical_name`));

  return results;
}

/**
 * Get all relationships (for admin view)
 */
export async function getAllRelationships(): Promise<PersonRelationshipWithNames[]> {
  const results = await db
    .select({
      id: personRelationships.id,
      personAId: personRelationships.personAId,
      personBId: personRelationships.personBId,
      relationshipType: personRelationships.relationshipType,
      notes: personRelationships.notes,
      discoveredInLetterId: personRelationships.discoveredInLetterId,
      confidence: personRelationships.confidence,
      confirmedBy: personRelationships.confirmedBy,
      confirmedAt: personRelationships.confirmedAt,
      createdAt: personRelationships.createdAt,
      updatedAt: personRelationships.updatedAt,
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
    .orderBy(asc(sql`pa.canonical_name`), asc(sql`pb.canonical_name`));

  return results;
}

/**
 * Create a relationship between two people
 * Ensures personAId < personBId for uniqueness (bidirectional)
 */
export async function createRelationship(data: {
  personAId: string;
  personBId: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence?: number;
}): Promise<string> {
  // Normalize: always store with smaller UUID first
  const [first, second] = [data.personAId, data.personBId].sort();

  const [rel] = await db
    .insert(personRelationships)
    .values({
      personAId: first,
      personBId: second,
      relationshipType: data.relationshipType,
      notes: data.notes,
      discoveredInLetterId: data.discoveredInLetterId,
      confidence: data.confidence ?? 100,
    })
    .returning({ id: personRelationships.id });

  return rel.id;
}

/**
 * Update a relationship
 */
export async function updateRelationship(
  id: string,
  data: {
    relationshipType?: PersonRelationshipType;
    notes?: string | null;
    confidence?: number;
  }
): Promise<void> {
  await db
    .update(personRelationships)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(personRelationships.id, id));
}

/**
 * Delete a relationship
 */
export async function deleteRelationship(id: string): Promise<void> {
  await db.delete(personRelationships).where(eq(personRelationships.id, id));
}

/**
 * Get relationship by ID
 */
export async function getRelationshipById(
  id: string
): Promise<PersonRelationshipWithNames | undefined> {
  const results = await db
    .select({
      id: personRelationships.id,
      personAId: personRelationships.personAId,
      personBId: personRelationships.personBId,
      relationshipType: personRelationships.relationshipType,
      notes: personRelationships.notes,
      discoveredInLetterId: personRelationships.discoveredInLetterId,
      confidence: personRelationships.confidence,
      confirmedBy: personRelationships.confirmedBy,
      confirmedAt: personRelationships.confirmedAt,
      createdAt: personRelationships.createdAt,
      updatedAt: personRelationships.updatedAt,
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
    .where(eq(personRelationships.id, id))
    .limit(1);

  return results[0];
}
