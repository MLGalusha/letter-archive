import { asc, eq, or, sql } from 'drizzle-orm';
import {
  db,
  personRelationships,
  type PersonRelationship,
  type PersonRelationshipType,
} from '../../db/index.js';

export interface PersonRelationshipWithNames extends PersonRelationship {
  personAName: string;
  personBName: string;
}

export async function getRelationshipsForPerson(
  personId: string,
): Promise<PersonRelationshipWithNames[]> {
  return db
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
    .innerJoin(sql`canonical_persons pa`, sql`pa.id = ${personRelationships.personAId}`)
    .innerJoin(sql`canonical_persons pb`, sql`pb.id = ${personRelationships.personBId}`)
    .where(
      or(
        eq(personRelationships.personAId, personId),
        eq(personRelationships.personBId, personId),
      ),
    )
    .orderBy(asc(sql`pa.canonical_name`), asc(sql`pb.canonical_name`));
}

export async function getAllRelationships(): Promise<PersonRelationshipWithNames[]> {
  return db
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
    .innerJoin(sql`canonical_persons pa`, sql`pa.id = ${personRelationships.personAId}`)
    .innerJoin(sql`canonical_persons pb`, sql`pb.id = ${personRelationships.personBId}`)
    .orderBy(asc(sql`pa.canonical_name`), asc(sql`pb.canonical_name`));
}

export async function createRelationship(data: {
  personAId: string;
  personBId: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence?: number;
}): Promise<string> {
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

export async function updateRelationship(
  id: string,
  data: {
    relationshipType?: PersonRelationshipType;
    notes?: string | null;
    confidence?: number;
  },
): Promise<void> {
  await db
    .update(personRelationships)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(personRelationships.id, id));
}

export async function deleteRelationship(id: string): Promise<void> {
  await db.delete(personRelationships).where(eq(personRelationships.id, id));
}

export async function getRelationshipById(
  id: string,
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
    .innerJoin(sql`canonical_persons pa`, sql`pa.id = ${personRelationships.personAId}`)
    .innerJoin(sql`canonical_persons pb`, sql`pb.id = ${personRelationships.personBId}`)
    .where(eq(personRelationships.id, id))
    .limit(1);

  return results[0];
}
