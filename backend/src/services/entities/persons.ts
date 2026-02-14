import { eq, desc, sql, or } from 'drizzle-orm';
import {
  db,
  canonicalPersons,
  letterPersons,
  personRelationships,
  type CanonicalPerson,
  type NewCanonicalPerson,
} from '../../db/index.js';

export async function createCanonicalPerson(
  data: Omit<NewCanonicalPerson, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const [person] = await db
    .insert(canonicalPersons)
    .values(data)
    .returning({ id: canonicalPersons.id });
  return person.id;
}

export async function getCanonicalPersonById(
  id: string,
): Promise<CanonicalPerson | undefined> {
  return db.query.canonicalPersons.findFirst({
    where: eq(canonicalPersons.id, id),
  });
}

export async function getAllCanonicalPersons(): Promise<CanonicalPerson[]> {
  return db.query.canonicalPersons.findMany({
    orderBy: [sql`${canonicalPersons.canonicalName} asc`],
  });
}

export async function updateCanonicalPerson(
  id: string,
  data: Partial<Pick<CanonicalPerson, 'canonicalName' | 'aliases' | 'notes'>>,
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

  const combinedAliases = [
    ...(keepPerson.aliases || []),
    mergePerson.canonicalName,
    ...(mergePerson.aliases || []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  await updateCanonicalPerson(keepId, { aliases: combinedAliases });

  await db
    .update(letterPersons)
    .set({ personId: keepId })
    .where(eq(letterPersons.personId, mergeId));

  await db
    .update(personRelationships)
    .set({ personAId: keepId })
    .where(eq(personRelationships.personAId, mergeId));

  await db
    .update(personRelationships)
    .set({ personBId: keepId })
    .where(eq(personRelationships.personBId, mergeId));

  await db.delete(canonicalPersons).where(eq(canonicalPersons.id, mergeId));
}

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

export interface DuplicateSuggestion {
  entityAId: string;
  entityAName: string;
  entityALetterCount: number;
  entityAAliases: string[];
  entityBId: string;
  entityBName: string;
  entityBLetterCount: number;
  entityBAliases: string[];
  similarity: number;
}

function getRows<T>(results: unknown): T[] {
  if (Array.isArray(results)) {
    return results as T[];
  }
  return ((results as { rows?: T[] }).rows ?? []) as T[];
}

export async function findPotentialDuplicatePersons(
  limit: number = 20,
): Promise<DuplicateSuggestion[]> {
  const results = await db.execute<{
    entity_a_id: string;
    entity_a_name: string;
    entity_a_letter_count: number;
    entity_a_aliases: string[] | null;
    entity_b_id: string;
    entity_b_name: string;
    entity_b_letter_count: number;
    entity_b_aliases: string[] | null;
    similarity_score: number;
  }>(sql`
    WITH person_letter_counts AS (
      SELECT
        cp.id,
        cp.canonical_name,
        cp.aliases,
        COUNT(DISTINCT lp.letter_id) as letter_count
      FROM canonical_persons cp
      LEFT JOIN letter_persons lp ON cp.id = lp.person_id
      GROUP BY cp.id, cp.canonical_name, cp.aliases
    )
    SELECT
      a.id as entity_a_id,
      a.canonical_name as entity_a_name,
      a.letter_count::int as entity_a_letter_count,
      a.aliases as entity_a_aliases,
      b.id as entity_b_id,
      b.canonical_name as entity_b_name,
      b.letter_count::int as entity_b_letter_count,
      b.aliases as entity_b_aliases,
      similarity(a.canonical_name, b.canonical_name) as similarity_score
    FROM person_letter_counts a
    CROSS JOIN person_letter_counts b
    WHERE a.id < b.id
      AND similarity(a.canonical_name, b.canonical_name) >= 0.50
      AND similarity(a.canonical_name, b.canonical_name) < 1.0
    ORDER BY similarity_score DESC
    LIMIT ${limit}
  `);

  return getRows<{
    entity_a_id: string;
    entity_a_name: string;
    entity_a_letter_count: number;
    entity_a_aliases: string[] | null;
    entity_b_id: string;
    entity_b_name: string;
    entity_b_letter_count: number;
    entity_b_aliases: string[] | null;
    similarity_score: number;
  }>(results).map((row) => ({
    entityAId: row.entity_a_id,
    entityAName: row.entity_a_name,
    entityALetterCount: Number(row.entity_a_letter_count),
    entityAAliases: row.entity_a_aliases || [],
    entityBId: row.entity_b_id,
    entityBName: row.entity_b_name,
    entityBLetterCount: Number(row.entity_b_letter_count),
    entityBAliases: row.entity_b_aliases || [],
    similarity: Math.round(row.similarity_score * 100),
  }));
}

export async function bulkMergePersons(
  keepId: string,
  mergeIds: string[],
): Promise<void> {
  const keepPerson = await getCanonicalPersonById(keepId);
  if (!keepPerson) {
    throw new Error('Master person not found');
  }

  const idsToMerge = mergeIds.filter((id) => id !== keepId);
  if (idsToMerge.length === 0) {
    throw new Error('No persons to merge');
  }

  for (const mergeId of idsToMerge) {
    const mergePerson = await getCanonicalPersonById(mergeId);
    if (mergePerson) {
      await mergePersons(keepId, mergeId);
    }
  }
}

export interface PersonDetailsForMerge {
  id: string;
  canonicalName: string;
  aliases: string[];
  notes: string | null;
  letterCount: number;
  senderCount: number;
  recipientCount: number;
  mentionedCount: number;
  relationshipCount: number;
  biography: string | null;
  biographyStatus: string | null;
}

export async function getPersonDetailsForMerge(
  id: string,
): Promise<PersonDetailsForMerge | null> {
  const person = await getCanonicalPersonById(id);
  if (!person) return null;

  const roleCountsResult = await db
    .select({
      role: letterPersons.role,
      count: sql<number>`COUNT(*)`,
    })
    .from(letterPersons)
    .where(eq(letterPersons.personId, id))
    .groupBy(letterPersons.role);

  const roleCounts = {
    sender: 0,
    recipient: 0,
    mentioned: 0,
  };

  for (const r of roleCountsResult) {
    if (r.role === 'sender') roleCounts.sender = Number(r.count);
    else if (r.role === 'recipient') roleCounts.recipient = Number(r.count);
    else if (r.role === 'mentioned') roleCounts.mentioned = Number(r.count);
  }

  const relationshipsResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(personRelationships)
    .where(
      or(
        eq(personRelationships.personAId, id),
        eq(personRelationships.personBId, id),
      ),
    );

  const relationshipCount = Number(relationshipsResult[0]?.count || 0);

  return {
    id: person.id,
    canonicalName: person.canonicalName,
    aliases: person.aliases || [],
    notes: person.notes,
    letterCount: roleCounts.sender + roleCounts.recipient + roleCounts.mentioned,
    senderCount: roleCounts.sender,
    recipientCount: roleCounts.recipient,
    mentionedCount: roleCounts.mentioned,
    relationshipCount,
    biography: person.biography,
    biographyStatus: person.biographyStatus,
  };
}
