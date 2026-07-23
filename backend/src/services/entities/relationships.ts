import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import {
  db,
  letters,
  personRelationships,
  type RelationshipType,
  type PersonRelationship,
  type PersonRelationshipType,
} from '../../db/index.js';
import { mapMetadataRelationshipToPersonRelationship } from './participant-sync.js';
import { publicCatalogueLetterTypeSql } from '../public-catalogue-unit.js';
import { publicEntityProjectionSql } from './public-projection.js';
import { SYSTEM_BACKFILL_RELATIONSHIP_OWNER } from './relationship-provenance.js';

export interface PersonRelationshipWithNames extends PersonRelationship {
  personAName: string;
  personBName: string;
  discoveredLetterVisibility?: string | null;
  discoveredLetterMetadataPublished?: boolean | null;
  discoveredLetterIsPublicCatalogueRoot?: boolean;
  discoveredRelationshipTrusted?: boolean;
  relatedPersonHasPublicMetadata?: boolean;
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
      entityExtractionRevision: personRelationships.entityExtractionRevision,
      confidence: personRelationships.confidence,
      confirmedBy: personRelationships.confirmedBy,
      confirmedAt: personRelationships.confirmedAt,
      createdAt: personRelationships.createdAt,
      updatedAt: personRelationships.updatedAt,
      personAName: sql<string>`pa.canonical_name`,
      personBName: sql<string>`pb.canonical_name`,
      discoveredLetterVisibility: sql<string | null>`discovered_letter.visibility`,
      discoveredLetterMetadataPublished: sql<boolean | null>`discovered_letter.metadata_published`,
      discoveredLetterIsPublicCatalogueRoot: sql<boolean>`COALESCE(
        ${publicCatalogueLetterTypeSql(sql`discovered_letter.type`)},
        FALSE
      )`,
      discoveredRelationshipTrusted: sql<boolean>`COALESCE(
        ${publicEntityProjectionSql(
          personRelationships.confirmedAt,
          personRelationships.entityExtractionRevision,
          sql`discovered_letter.entity_extraction_revision`,
          sql`discovered_letter.entity_extraction_json`,
        )},
        FALSE
      )`,
      relatedPersonHasPublicMetadata: sql<boolean>`EXISTS (
        SELECT 1
        FROM letter_persons public_related_link
        INNER JOIN letters public_related_letter
          ON public_related_letter.id = public_related_link.letter_id
        WHERE public_related_link.person_id = CASE
          WHEN ${personRelationships.personAId} = ${personId}
            THEN ${personRelationships.personBId}
          ELSE ${personRelationships.personAId}
        END
          AND public_related_letter.visibility = 'PUBLISHED'
          AND public_related_letter.metadata_published = TRUE
          AND ${publicCatalogueLetterTypeSql(sql`public_related_letter.type`)}
          AND ${publicEntityProjectionSql(
            sql`public_related_link.confirmed_at`,
            sql`public_related_link.entity_extraction_revision`,
            sql`public_related_letter.entity_extraction_revision`,
            sql`public_related_letter.entity_extraction_json`,
          )}
      )`,
    })
    .from(personRelationships)
    .innerJoin(sql`canonical_persons pa`, sql`pa.id = ${personRelationships.personAId}`)
    .innerJoin(sql`canonical_persons pb`, sql`pb.id = ${personRelationships.personBId}`)
    .leftJoin(
      sql`letters discovered_letter`,
      sql`discovered_letter.id = ${personRelationships.discoveredInLetterId}`,
    )
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
      entityExtractionRevision: personRelationships.entityExtractionRevision,
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
  entityExtractionRevision?: number | null;
  confidence?: number;
  confirmedBy?: string;
  confirmedAt?: Date;
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
      entityExtractionRevision: data.entityExtractionRevision,
      confidence: data.confidence ?? 100,
      confirmedBy: data.confirmedBy,
      confirmedAt: data.confirmedAt,
    })
    .returning({ id: personRelationships.id });

  return rel.id;
}

export async function updateRelationship(
  id: string,
  data: {
    relationshipType?: PersonRelationshipType;
    notes?: string | null;
    entityExtractionRevision?: number | null;
    confidence?: number;
    confirmedBy?: string;
    confirmedAt?: Date;
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
      entityExtractionRevision: personRelationships.entityExtractionRevision,
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

export interface BackfillRelationshipsResult {
  scannedLetters: number;
  created: number;
  updated: number;
  skipped: number;
}

export async function backfillRelationshipsFromLetters(): Promise<BackfillRelationshipsResult> {
  const rows = await db
    .select({
      letterId: letters.id,
      senderRecipientRelationship: letters.senderRecipientRelationship,
      senderPersonId: sql<string | null>`sender_links.person_id`,
      recipientPersonId: sql<string | null>`recipient_links.person_id`,
    })
    .from(letters)
    .leftJoin(
      sql`letter_persons sender_links`,
      sql`sender_links.letter_id = ${letters.id} AND sender_links.role = 'sender'`,
    )
    .leftJoin(
      sql`letter_persons recipient_links`,
      sql`recipient_links.letter_id = ${letters.id} AND recipient_links.role = 'recipient'`,
    )
    .where(
      and(
        sql`${letters.senderRecipientRelationship} IS NOT NULL`,
        ne(letters.senderRecipientRelationship, 'unknown'),
      ),
    );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.senderPersonId || !row.recipientPersonId || row.senderPersonId === row.recipientPersonId) {
      skipped++;
      continue;
    }

    const relationshipType = mapMetadataRelationshipToPersonRelationship(
      row.senderRecipientRelationship as RelationshipType | null,
    );
    const [personAId, personBId] = [row.senderPersonId, row.recipientPersonId].sort();

    const existing = await db.query.personRelationships.findFirst({
      where: and(
        eq(personRelationships.personAId, personAId),
        eq(personRelationships.personBId, personBId),
      ),
    });

    if (!existing) {
      const inserted = await db
        .insert(personRelationships)
        .values({
          personAId,
          personBId,
          relationshipType,
          discoveredInLetterId: row.letterId,
          confidence: 90,
          confirmedBy: SYSTEM_BACKFILL_RELATIONSHIP_OWNER,
        })
        .onConflictDoNothing()
        .returning({ id: personRelationships.id });
      if (inserted.length > 0) {
        created++;
      } else {
        skipped++;
      }
      continue;
    }

    if (
      existing.relationshipType === 'unknown'
      && relationshipType !== 'unknown'
      && existing.confirmedBy === SYSTEM_BACKFILL_RELATIONSHIP_OWNER
      && existing.confirmedAt == null
      && existing.entityExtractionRevision == null
    ) {
      const changed = await db
        .update(personRelationships)
        .set({
          relationshipType,
          discoveredInLetterId: existing.discoveredInLetterId || row.letterId,
          confidence: Math.max(existing.confidence, 90),
          updatedAt: new Date(),
        })
        .where(and(
          eq(personRelationships.id, existing.id),
          eq(
            personRelationships.confirmedBy,
            SYSTEM_BACKFILL_RELATIONSHIP_OWNER,
          ),
          isNull(personRelationships.confirmedAt),
          isNull(personRelationships.entityExtractionRevision),
          eq(personRelationships.relationshipType, 'unknown'),
        ))
        .returning({ id: personRelationships.id });
      if (changed.length > 0) {
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    skipped++;
  }

  return {
    scannedLetters: rows.length,
    created,
    updated,
    skipped,
  };
}
