import { and, eq, gt, gte, isNotNull, isNull } from 'drizzle-orm';
import type {
  DiscoveredRelationship,
  EntityExtraction,
  ExtractedPerson,
  ExtractedPlace,
} from '../../ai/schemas/entityExtraction.js';
import {
  canonicalPersons,
  canonicalPlaces,
  db,
  entityReviewQueue,
  letterPersons,
  letterPlaces,
  letters,
  personRelationships,
  type Database,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  activeEntityExtractionAttemptConditions,
  clearedEntityExtractionOwnership,
  entityExtractionLeaseRenewalPatch,
  ownedEntityExtractionAttemptConditions,
  type EntityExtractionClaim,
} from '../letter/entity-extraction-job.js';
import { findMatchingPersons, findMatchingPlaces } from './matching.js';
import { SYSTEM_BACKFILL_RELATIONSHIP_OWNER } from './relationship-provenance.js';

const log = createLogger({ module: 'entity-processing' });

type EntityWriteDatabase = Pick<
  Database,
  'execute' | 'select' | 'insert' | 'update' | 'delete'
>;

export interface EntityExtractionCommitResult {
  peopleProcessed: number;
  placesProcessed: number;
  relationshipsCreated: number;
  errors: string[];
}

/**
 * Removes only replaceable AI-owned projections for one letter.
 *
 * NULL revisions and confirmed rows are human/system-owned. Non-null revision
 * zero is legacy AI output and is replaceable just like current revisions.
 */
export async function deleteReplaceableEntityProjection(
  database: Pick<Database, 'delete'>,
  letterId: string,
  options: { preservePromotableLegacyRows?: boolean } = {},
): Promise<void> {
  const preserveLegacy = options.preservePromotableLegacyRows === true;
  await database.delete(letterPersons).where(and(
    eq(letterPersons.letterId, letterId),
    preserveLegacy
      ? gt(letterPersons.entityExtractionRevision, 0)
      : isNotNull(letterPersons.entityExtractionRevision),
    isNull(letterPersons.confirmedAt),
  ));
  await database.delete(letterPlaces).where(and(
    eq(letterPlaces.letterId, letterId),
    preserveLegacy
      ? gt(letterPlaces.entityExtractionRevision, 0)
      : isNotNull(letterPlaces.entityExtractionRevision),
    isNull(letterPlaces.confirmedAt),
  ));
  await database.delete(personRelationships).where(and(
    eq(personRelationships.discoveredInLetterId, letterId),
    preserveLegacy
      ? gt(personRelationships.entityExtractionRevision, 0)
      : isNotNull(personRelationships.entityExtractionRevision),
    isNull(personRelationships.confirmedAt),
  ));
  await database.delete(entityReviewQueue).where(and(
    eq(entityReviewQueue.letterId, letterId),
    preserveLegacy
      ? gte(entityReviewQueue.entityExtractionRevision, 0)
      : isNotNull(entityReviewQueue.entityExtractionRevision),
    eq(entityReviewQueue.status, 'pending'),
  ));
}

/**
 * Signals that a cancelled, retried, or otherwise superseded producer reached
 * the commit boundary after its ownership token stopped being authoritative.
 */
export class EntityExtractionClaimLostError extends Error {
  constructor() {
    super('Entity extraction claim is no longer authoritative');
    this.name = 'EntityExtractionClaimLostError';
  }
}

/**
 * Signals that the exact extraction cannot materialize without overwriting an
 * untrusted row whose provenance is not owned by this run.
 */
export class EntityExtractionProjectionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntityExtractionProjectionConflictError';
  }
}

/**
 * Atomically replace the AI-owned entity projection for one letter.
 *
 * PostgreSQL keeps the previous committed rows visible while this transaction
 * runs. If any resolution or write fails, every delete/insert is rolled back
 * and the caller records failure against the exact run token.
 */
export async function processEntityExtraction(
  extraction: EntityExtraction,
  letterId: string,
  claim: EntityExtractionClaim,
): Promise<EntityExtractionCommitResult> {
  const result = await db.transaction(async (tx) => {
    // This idempotent owned update both verifies the token and locks the letter
    // row. Refreshing from the database clock gives materialization a complete
    // lease window while the external heartbeat waits on this row lock.
    const owned = await tx
      .update(letters)
      .set(entityExtractionLeaseRenewalPatch())
      .where(and(...activeEntityExtractionAttemptConditions(letterId, claim)))
      .returning({ id: letters.id });

    if (owned.length === 0) {
      throw new EntityExtractionClaimLostError();
    }

    // Revision-0 links are rollout-era AI rows that this exact extraction can
    // safely promote after proving a matching entity. A source replacement,
    // by contrast, calls the helper's default mode and removes them because
    // they derive from bytes that are no longer authoritative.
    await deleteReplaceableEntityProjection(tx, letterId, {
      preservePromotableLegacyRows: true,
    });

    const resolvedPersonIds = new Map<string, string>();
    for (const person of extraction.people) {
      const personId = await processExtractedPerson(
        tx,
        person,
        letterId,
        claim.revision,
      );
      if (!personId) continue;

      resolvedPersonIds.set(person.name.toLowerCase(), personId);
      for (const alias of person.aliases) {
        resolvedPersonIds.set(alias.toLowerCase(), personId);
      }
    }

    for (const place of extraction.places) {
      await processExtractedPlace(tx, place, letterId, claim.revision);
    }

    let relationshipsCreated = 0;
    for (const relationship of extraction.relationships) {
      if (await processExtractedRelationship(
        tx,
        relationship,
        letterId,
        claim.revision,
        resolvedPersonIds,
      )) {
        relationshipsCreated += 1;
      }
    }

    // The verified entry update holds this letter row lock until commit, so
    // recovery and cancellation cannot cross the boundary. The heartbeat also
    // cannot renew through that lock; terminal publication therefore checks
    // the unchanged exact tuple without requiring the deadline to remain live
    // for the duration of database-only materialization.
    const committed = await tx
      .update(letters)
      .set({
        entityExtractionJson: extraction,
        entityExtractionStatus: 'SUCCESS',
        entityExtractionRevision: claim.revision,
        ...clearedEntityExtractionOwnership(),
        entityExtractionError: null,
        metadataConfirmationGuidance: null,
        metadataGuidanceRunId: null,
        updatedAt: new Date(),
      })
      .where(and(...ownedEntityExtractionAttemptConditions(letterId, claim)))
      .returning({ id: letters.id });

    if (committed.length === 0) {
      throw new EntityExtractionClaimLostError();
    }

    return {
      peopleProcessed: extraction.people.length,
      placesProcessed: extraction.places.length,
      relationshipsCreated,
      errors: [],
    };
  });

  log.info(
    { letterId, ...result },
    'Entity extraction projection committed',
  );
  return result;
}

async function processExtractedPerson(
  database: EntityWriteDatabase,
  person: ExtractedPerson,
  letterId: string,
  revision: number,
): Promise<string | null> {
  const bestMatch = (await findMatchingPersons(person.name, 5, database))[0];
  const confidence = Math.round(person.confidence * 100);
  const context = [
    person.emotional_significance,
    ...person.details.slice(0, 3).map((detail) => detail.detail),
  ].filter((value): value is string => Boolean(value)).join('; ') || null;

  if (bestMatch && bestMatch.similarity >= 85) {
    await insertLetterPerson(database, {
      letterId,
      personId: bestMatch.entityId,
      role: person.role,
      nameAsWritten: person.name,
      relationshipToSender: person.relationship_to_sender,
      context,
      confidence: Math.min(confidence, bestMatch.similarity),
      entityExtractionRevision: revision,
    });
    // Extraction never mutates aliases on an existing shared canonical row.
    return bestMatch.entityId;
  }

  if (bestMatch && bestMatch.similarity >= 50) {
    await insertReviewItem(database, {
      entityType: 'person',
      extractedText: person.name,
      letterId,
      suggestedEntityId: bestMatch.entityId,
      context: context ?? undefined,
      confidence: bestMatch.similarity,
      entityExtractionRevision: revision,
    });
    return null;
  }

  const [created] = await database
    .insert(canonicalPersons)
    .values({
      canonicalName: person.name,
      aliases: person.aliases.length > 0 ? person.aliases : undefined,
    })
    .returning({ id: canonicalPersons.id });

  await insertLetterPerson(database, {
    letterId,
    personId: created.id,
    role: person.role,
    nameAsWritten: person.name,
    relationshipToSender: person.relationship_to_sender,
    context,
    confidence,
    entityExtractionRevision: revision,
  });
  return created.id;
}

async function processExtractedPlace(
  database: EntityWriteDatabase,
  place: ExtractedPlace,
  letterId: string,
  revision: number,
): Promise<void> {
  const bestMatch = (await findMatchingPlaces(place.name, 5, database))[0];
  const confidence = Math.round(place.confidence * 100);
  const context = [
    place.why_mentioned,
    place.descriptive_details,
  ].filter((value): value is string => Boolean(value)).join('; ') || null;

  if (bestMatch && bestMatch.similarity >= 85) {
    await insertLetterPlace(database, {
      letterId,
      placeId: bestMatch.entityId,
      role: place.role,
      nameAsWritten: place.name,
      context,
      confidence: Math.min(confidence, bestMatch.similarity),
      entityExtractionRevision: revision,
    });
    // Extraction never mutates placeType on an existing shared canonical row.
    return;
  }

  if (bestMatch && bestMatch.similarity >= 50) {
    await insertReviewItem(database, {
      entityType: 'place',
      extractedText: place.name,
      letterId,
      suggestedEntityId: bestMatch.entityId,
      context: context ?? undefined,
      confidence: bestMatch.similarity,
      entityExtractionRevision: revision,
    });
    return;
  }

  const [created] = await database
    .insert(canonicalPlaces)
    .values({
      canonicalName: place.name,
      placeType: place.type,
    })
    .returning({ id: canonicalPlaces.id });

  await insertLetterPlace(database, {
    letterId,
    placeId: created.id,
    role: place.role,
    nameAsWritten: place.name,
    context,
    confidence,
    entityExtractionRevision: revision,
  });
}

async function processExtractedRelationship(
  database: EntityWriteDatabase,
  relationship: DiscoveredRelationship,
  letterId: string,
  revision: number,
  resolvedPersonIds: Map<string, string>,
): Promise<boolean> {
  let personAId = resolvedPersonIds.get(relationship.person_a.toLowerCase());
  let personBId = resolvedPersonIds.get(relationship.person_b.toLowerCase());

  if (!personAId) {
    const match = (await findMatchingPersons(relationship.person_a, 1, database))[0];
    if (match?.similarity >= 85) personAId = match.entityId;
  }
  if (!personBId) {
    const match = (await findMatchingPersons(relationship.person_b, 1, database))[0];
    if (match?.similarity >= 85) personBId = match.entityId;
  }
  if (!personAId || !personBId || personAId === personBId) return false;

  const [personA, personB] = [personAId, personBId].sort();
  const relationshipPatch = {
    relationshipType: relationship.relationship_type,
    notes: relationship.evidence,
    discoveredInLetterId: letterId,
    entityExtractionRevision: revision,
    confidence: Math.round(relationship.confidence * 100),
    confirmedBy: null,
    confirmedAt: null,
    updatedAt: new Date(),
  };
  const promoted = await database
    .update(personRelationships)
    .set(relationshipPatch)
    .where(and(
      eq(personRelationships.personAId, personA),
      eq(personRelationships.personBId, personB),
      eq(personRelationships.discoveredInLetterId, letterId),
      eq(personRelationships.entityExtractionRevision, 0),
      isNull(personRelationships.confirmedAt),
    ))
    .returning({ id: personRelationships.id });

  if (promoted.length > 0) return true;

  // Backfill rows are explicitly marked system-owned but remain unconfirmed.
  // An exact extraction may supersede one only by rewriting the entire content
  // and provenance tuple to this run.
  const adoptedBackfill = await database
    .update(personRelationships)
    .set(relationshipPatch)
    .where(and(
      eq(personRelationships.personAId, personA),
      eq(personRelationships.personBId, personB),
      eq(
        personRelationships.confirmedBy,
        SYSTEM_BACKFILL_RELATIONSHIP_OWNER,
      ),
      isNull(personRelationships.confirmedAt),
      isNull(personRelationships.entityExtractionRevision),
    ))
    .returning({ id: personRelationships.id });

  if (adoptedBackfill.length > 0) return true;

  const inserted = await database
    .insert(personRelationships)
    .values({
      personAId: personA,
      personBId: personB,
      ...relationshipPatch,
    })
    .onConflictDoNothing()
    .returning({ id: personRelationships.id });

  if (inserted.length > 0) return true;

  const existing = await database
    .select({
      id: personRelationships.id,
      discoveredInLetterId: personRelationships.discoveredInLetterId,
      entityExtractionRevision: personRelationships.entityExtractionRevision,
      confirmedAt: personRelationships.confirmedAt,
    })
    .from(personRelationships)
    .where(and(
      eq(personRelationships.personAId, personA),
      eq(personRelationships.personBId, personB),
    ))
    .limit(1);

  const conflict = existing[0];
  if (!conflict) {
    throw new EntityExtractionProjectionConflictError(
      `Relationship projection conflict disappeared for ${personA}/${personB}`,
    );
  }

  // A human-confirmed relationship is an explicit override. A duplicate exact
  // output from this transaction is already owned by the revision being
  // committed. Neither row is rewritten.
  if (
    conflict.confirmedAt != null
    || (
      conflict.discoveredInLetterId === letterId
      && conflict.entityExtractionRevision === revision
    )
  ) {
    return false;
  }

  // The pair is globally unique, so a relationship committed by another
  // letter may satisfy this discovery. Prove it against that letter's current
  // committed JSON before leaving its content and provenance untouched.
  if (
    conflict.discoveredInLetterId != null
    && conflict.entityExtractionRevision != null
  ) {
    const trusted = await database
      .select({ id: letters.id })
      .from(letters)
      .where(and(
        eq(letters.id, conflict.discoveredInLetterId),
        eq(
          letters.entityExtractionRevision,
          conflict.entityExtractionRevision,
        ),
        isNotNull(letters.entityExtractionJson),
      ))
      .limit(1);

    if (trusted.length > 0) return false;
  }

  throw new EntityExtractionProjectionConflictError(
    `Untrusted relationship projection blocks ${personA}/${personB}`,
  );
}

async function insertLetterPerson(
  database: EntityWriteDatabase,
  data: typeof letterPersons.$inferInsert,
): Promise<void> {
  const promoted = await database
    .update(letterPersons)
    .set({
      nameAsWritten: data.nameAsWritten,
      relationshipToSender: data.relationshipToSender,
      context: data.context,
      confidence: data.confidence,
      entityExtractionRevision: data.entityExtractionRevision,
    })
    .where(and(
      eq(letterPersons.letterId, data.letterId),
      eq(letterPersons.personId, data.personId),
      eq(letterPersons.role, data.role),
      eq(letterPersons.entityExtractionRevision, 0),
      isNull(letterPersons.confirmedAt),
    ))
    .returning({ id: letterPersons.id });
  if (promoted.length > 0) return;

  const inserted = await database
    .insert(letterPersons)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: letterPersons.id });
  if (inserted.length > 0) return;

  const existing = await database
    .select({
      id: letterPersons.id,
      entityExtractionRevision: letterPersons.entityExtractionRevision,
      confirmedAt: letterPersons.confirmedAt,
    })
    .from(letterPersons)
    .where(and(
      eq(letterPersons.letterId, data.letterId),
      eq(letterPersons.personId, data.personId),
      eq(letterPersons.role, data.role),
    ))
    .limit(1);

  const conflict = existing[0];
  if (
    conflict?.confirmedAt != null
    || conflict?.entityExtractionRevision === data.entityExtractionRevision
  ) {
    return;
  }

  throw new EntityExtractionProjectionConflictError(
    `Untrusted person projection blocks ${data.letterId}/${data.personId}/${data.role}`,
  );
}

async function insertLetterPlace(
  database: EntityWriteDatabase,
  data: typeof letterPlaces.$inferInsert,
): Promise<void> {
  const promoted = await database
    .update(letterPlaces)
    .set({
      nameAsWritten: data.nameAsWritten,
      context: data.context,
      confidence: data.confidence,
      entityExtractionRevision: data.entityExtractionRevision,
    })
    .where(and(
      eq(letterPlaces.letterId, data.letterId),
      eq(letterPlaces.placeId, data.placeId),
      eq(letterPlaces.role, data.role),
      eq(letterPlaces.entityExtractionRevision, 0),
      isNull(letterPlaces.confirmedAt),
    ))
    .returning({ id: letterPlaces.id });
  if (promoted.length > 0) return;

  const inserted = await database
    .insert(letterPlaces)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: letterPlaces.id });
  if (inserted.length > 0) return;

  const existing = await database
    .select({
      id: letterPlaces.id,
      entityExtractionRevision: letterPlaces.entityExtractionRevision,
      confirmedAt: letterPlaces.confirmedAt,
    })
    .from(letterPlaces)
    .where(and(
      eq(letterPlaces.letterId, data.letterId),
      eq(letterPlaces.placeId, data.placeId),
      eq(letterPlaces.role, data.role),
    ))
    .limit(1);

  const conflict = existing[0];
  if (
    conflict?.confirmedAt != null
    || conflict?.entityExtractionRevision === data.entityExtractionRevision
  ) {
    return;
  }

  throw new EntityExtractionProjectionConflictError(
    `Untrusted place projection blocks ${data.letterId}/${data.placeId}/${data.role}`,
  );
}

async function insertReviewItem(
  database: EntityWriteDatabase,
  data: typeof entityReviewQueue.$inferInsert,
): Promise<void> {
  await database.insert(entityReviewQueue).values(data);
}
