/**
 * Collection-scoped entity queries.
 *
 * All queries join through letters.collectionId to scope results
 * to a single collection.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  db,
  canonicalPersons,
  letterPersons,
  letters,
  personRelationships,
} from '../../db/index.js';

// ============================================================================
// Types
// ============================================================================

export interface CollectionPerson {
  id: string;
  canonicalName: string;
  aliases: string[];
  biography: string | null;
  letterCount: number;
  senderCount: number;
  recipientCount: number;
  mentionedCount: number;
}

export interface CollectionLetterPersonJunction {
  letterId: string;
  dateRaw: string;
  letterDate: string | null;
  sender: string | null;
  recipient: string | null;
  summary: string | null;
  personId: string;
  personName: string;
  role: string;
  nameAsWritten: string | null;
  context: string | null;
  confidence: number;
}

export interface CollectionRelationship {
  id: string;
  personAId: string;
  personAName: string;
  personBId: string;
  personBName: string;
  relationshipType: string;
  notes: string | null;
  confidence: number;
}

export interface LetterMissingParticipant {
  letterId: string;
  dateRaw: string;
  letterDate: string | null;
  sender: string | null;
  recipient: string | null;
  summary: string | null;
  missingSender: boolean;
  missingRecipient: boolean;
}

export interface GenericPerson {
  id: string;
  canonicalName: string;
  aliases: string[];
  letterCount: number;
}

// Common generic entity patterns
const GENERIC_PATTERNS = [
  'the sender',
  'the recipient',
  'the writer',
  'the author',
  'a man',
  'a woman',
  'a friend',
  'your brother',
  'your sister',
  'your mother',
  'your father',
  'my brother',
  'my sister',
  'my mother',
  'my father',
  'someone',
  'unknown',
];

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all canonical persons associated with a collection,
 * with letter counts and role breakdowns.
 */
export async function getPersonsForCollection(
  collectionId: string,
): Promise<CollectionPerson[]> {
  const results = await db
    .select({
      id: canonicalPersons.id,
      canonicalName: canonicalPersons.canonicalName,
      aliases: canonicalPersons.aliases,
      biography: canonicalPersons.biography,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPersons.letterId})::int`,
      senderCount: sql<number>`COUNT(DISTINCT CASE WHEN ${letterPersons.role} = 'sender' THEN ${letterPersons.letterId} END)::int`,
      recipientCount: sql<number>`COUNT(DISTINCT CASE WHEN ${letterPersons.role} = 'recipient' THEN ${letterPersons.letterId} END)::int`,
      mentionedCount: sql<number>`COUNT(DISTINCT CASE WHEN ${letterPersons.role} = 'mentioned' THEN ${letterPersons.letterId} END)::int`,
    })
    .from(canonicalPersons)
    .innerJoin(letterPersons, eq(canonicalPersons.id, letterPersons.personId))
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .where(eq(letters.collectionId, collectionId))
    .groupBy(canonicalPersons.id, canonicalPersons.canonicalName, canonicalPersons.aliases, canonicalPersons.biography)
    .orderBy(sql`COUNT(DISTINCT ${letterPersons.letterId}) DESC`);

  return results.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    aliases: r.aliases || [],
    biography: r.biography,
    letterCount: r.letterCount,
    senderCount: r.senderCount,
    recipientCount: r.recipientCount,
    mentionedCount: r.mentionedCount,
  }));
}

/**
 * Get all letter-person junction data for a collection.
 * Includes letter metadata for context.
 */
export async function getLetterPersonJunctionsForCollection(
  collectionId: string,
): Promise<CollectionLetterPersonJunction[]> {
  return db
    .select({
      letterId: letters.id,
      dateRaw: letters.dateRaw,
      letterDate: letters.letterDate,
      sender: letters.sender,
      recipient: letters.recipient,
      summary: letters.summary,
      personId: letterPersons.personId,
      personName: canonicalPersons.canonicalName,
      role: letterPersons.role,
      nameAsWritten: letterPersons.nameAsWritten,
      context: letterPersons.context,
      confidence: letterPersons.confidence,
    })
    .from(letterPersons)
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .innerJoin(canonicalPersons, eq(letterPersons.personId, canonicalPersons.id))
    .where(eq(letters.collectionId, collectionId))
    .orderBy(letters.dateRaw, canonicalPersons.canonicalName);
}

/**
 * Get all relationships between persons in a collection.
 */
export async function getRelationshipsForCollection(
  collectionId: string,
): Promise<CollectionRelationship[]> {
  // Get person IDs in this collection first
  const personIds = db
    .selectDistinct({ personId: letterPersons.personId })
    .from(letterPersons)
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .where(eq(letters.collectionId, collectionId));

  return db
    .select({
      id: personRelationships.id,
      personAId: personRelationships.personAId,
      personAName: sql<string>`pa.canonical_name`,
      personBId: personRelationships.personBId,
      personBName: sql<string>`pb.canonical_name`,
      relationshipType: personRelationships.relationshipType,
      notes: personRelationships.notes,
      confidence: personRelationships.confidence,
    })
    .from(personRelationships)
    .innerJoin(sql`canonical_persons pa`, sql`pa.id = ${personRelationships.personAId}`)
    .innerJoin(sql`canonical_persons pb`, sql`pb.id = ${personRelationships.personBId}`)
    .where(
      and(
        sql`${personRelationships.personAId} IN (${personIds})`,
        sql`${personRelationships.personBId} IN (${personIds})`,
      ),
    )
    .orderBy(sql`pa.canonical_name`, sql`pb.canonical_name`);
}

/**
 * Get letters with missing sender or recipient fields
 * but that have existing junction data (so AI can infer).
 */
export async function getLettersWithMissingSenderRecipient(
  collectionId: string,
): Promise<LetterMissingParticipant[]> {
  const results = await db
    .select({
      letterId: letters.id,
      dateRaw: letters.dateRaw,
      letterDate: letters.letterDate,
      sender: letters.sender,
      recipient: letters.recipient,
      summary: letters.summary,
    })
    .from(letters)
    .where(
      and(
        eq(letters.collectionId, collectionId),
        or(isNull(letters.sender), isNull(letters.recipient)),
      ),
    )
    .orderBy(letters.dateRaw);

  return results.map((r) => ({
    letterId: r.letterId,
    dateRaw: r.dateRaw,
    letterDate: r.letterDate,
    sender: r.sender,
    recipient: r.recipient,
    summary: r.summary,
    missingSender: r.sender === null,
    missingRecipient: r.recipient === null,
  }));
}

/**
 * Get persons matching generic/placeholder patterns
 * that are associated with this collection.
 */
export async function getGenericPersonsForCollection(
  collectionId: string,
): Promise<GenericPerson[]> {
  // Build SQL conditions for generic patterns
  const patternConditions = GENERIC_PATTERNS.map(
    (p) => sql`LOWER(${canonicalPersons.canonicalName}) = ${p.toLowerCase()}`,
  );

  const results = await db
    .select({
      id: canonicalPersons.id,
      canonicalName: canonicalPersons.canonicalName,
      aliases: canonicalPersons.aliases,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPersons.letterId})::int`,
    })
    .from(canonicalPersons)
    .innerJoin(letterPersons, eq(canonicalPersons.id, letterPersons.personId))
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .where(
      and(
        eq(letters.collectionId, collectionId),
        or(...patternConditions),
      ),
    )
    .groupBy(canonicalPersons.id, canonicalPersons.canonicalName, canonicalPersons.aliases);

  return results.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    aliases: r.aliases || [],
    letterCount: r.letterCount,
  }));
}
