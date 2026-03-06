import { and, eq } from 'drizzle-orm';
import {
  db,
  personRelationships,
  type PersonRelationshipType,
  type PersonRole,
  type PlaceRole,
  type PlaceType,
} from '../../db/index.js';
import type {
  EntityExtraction,
  ExtractedPerson,
  ExtractedPlace,
  DiscoveredRelationship,
} from '../../ai/schemas/entityExtraction.js';
import { createLogger } from '../../utils/logger.js';
import { findMatchingPersons, findMatchingPlaces } from './matching.js';
import { createLetterPerson, createLetterPlace } from './junctions.js';
import {
  createCanonicalPerson,
  getCanonicalPersonById,
  updateCanonicalPerson,
} from './persons.js';
import {
  createCanonicalPlace,
  getCanonicalPlaceById,
  updateCanonicalPlace,
} from './places.js';
import { addToReviewQueue } from './review-queue.js';
import { createRelationship } from './relationships.js';

const log = createLogger({ module: 'entity-processing' });

export interface ExtractedEntity {
  type: 'person' | 'place';
  name: string;
  role: string;
  context: string | null;
  relationship_to_sender: string | null;
  confidence: number;
}

function inferPlaceType(name: string): PlaceType {
  const lowerName = name.toLowerCase();
  if (/\b(street|road|avenue|lane|drive|blvd|boulevard)\b/.test(lowerName)) return 'street';
  if (/\b(england|america|france|germany|usa|uk|united states|united kingdom)\b/.test(lowerName)) {
    return 'country';
  }
  if (/\b(county|state|province|region)\b/.test(lowerName)) return 'region';
  if (/,/.test(name)) return 'city';
  return 'other';
}

export async function processExtractedEntity(
  entity: ExtractedEntity,
  letterId: string,
): Promise<void> {
  const isPersonEntity = entity.type === 'person';

  const matches = isPersonEntity
    ? await findMatchingPersons(entity.name)
    : await findMatchingPlaces(entity.name);

  const bestMatch = matches[0];
  const aiConfidence = Math.round(entity.confidence * 100);

  if (bestMatch && bestMatch.similarity >= 85) {
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
    await addToReviewQueue({
      entityType: entity.type,
      extractedText: entity.name,
      letterId,
      suggestedEntityId: bestMatch.entityId,
      context: entity.context ?? undefined,
      confidence: bestMatch.similarity,
    });
  } else {
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

export async function processEntityExtraction(
  extraction: EntityExtraction,
  letterId: string,
): Promise<{
  peopleProcessed: number;
  placesProcessed: number;
  relationshipsCreated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let peopleProcessed = 0;
  let placesProcessed = 0;
  let relationshipsCreated = 0;

  const resolvedPersonIds = new Map<string, string>();

  for (const person of extraction.people) {
    try {
      const personId = await processExtractedPerson(person, letterId);
      if (personId) {
        resolvedPersonIds.set(person.name.toLowerCase(), personId);
        for (const alias of person.aliases) {
          resolvedPersonIds.set(alias.toLowerCase(), personId);
        }
      }
      peopleProcessed++;
    } catch (err) {
      const msg = `Failed to process person "${person.name}": ${err instanceof Error ? err.message : String(err)}`;
      log.error({ letterId, personName: person.name, err }, msg);
      errors.push(msg);
    }
  }

  for (const place of extraction.places) {
    try {
      await processExtractedPlace(place, letterId);
      placesProcessed++;
    } catch (err) {
      const msg = `Failed to process place "${place.name}": ${err instanceof Error ? err.message : String(err)}`;
      log.error({ letterId, placeName: place.name, err }, msg);
      errors.push(msg);
    }
  }

  for (const rel of extraction.relationships) {
    try {
      const created = await autoCreateRelationship(rel, letterId, resolvedPersonIds);
      if (created) relationshipsCreated++;
    } catch (err) {
      const msg = `Failed to create relationship "${rel.person_a}" <-> "${rel.person_b}": ${err instanceof Error ? err.message : String(err)}`;
      log.error({ letterId, personA: rel.person_a, personB: rel.person_b, err }, msg);
      errors.push(msg);
    }
  }

  log.info(
    { letterId, peopleProcessed, placesProcessed, relationshipsCreated, errorCount: errors.length },
    'Entity extraction processing completed',
  );

  return { peopleProcessed, placesProcessed, relationshipsCreated, errors };
}

async function processExtractedPerson(
  person: ExtractedPerson,
  letterId: string,
): Promise<string | null> {
  const matches = await findMatchingPersons(person.name);
  const bestMatch = matches[0];
  const aiConfidence = Math.round(person.confidence * 100);

  const contextParts: string[] = [];
  if (person.emotional_significance) contextParts.push(person.emotional_significance);
  for (const detail of person.details.slice(0, 3)) {
    contextParts.push(detail.detail);
  }
  const richContext = contextParts.join('; ') || null;

  if (bestMatch && bestMatch.similarity >= 85) {
    await createLetterPerson({
      letterId,
      personId: bestMatch.entityId,
      role: person.role as PersonRole,
      nameAsWritten: person.name,
      relationshipToSender: person.relationship_to_sender,
      context: richContext,
      confidence: Math.min(aiConfidence, bestMatch.similarity),
    });

    if (person.aliases.length > 0) {
      const existing = await getCanonicalPersonById(bestMatch.entityId);
      if (existing) {
        const existingAliases = new Set((existing.aliases || []).map((a) => a.toLowerCase()));
        const newAliases = person.aliases.filter((a) => !existingAliases.has(a.toLowerCase()));
        if (newAliases.length > 0) {
          await updateCanonicalPerson(bestMatch.entityId, {
            aliases: [...(existing.aliases || []), ...newAliases],
          });
        }
      }
    }

    return bestMatch.entityId;
  }

  if (bestMatch && bestMatch.similarity >= 50) {
    await addToReviewQueue({
      entityType: 'person',
      extractedText: person.name,
      letterId,
      suggestedEntityId: bestMatch.entityId,
      context: richContext ?? undefined,
      confidence: bestMatch.similarity,
    });
    return null;
  }

  const newPersonId = await createCanonicalPerson({
    canonicalName: person.name,
    aliases: person.aliases.length > 0 ? person.aliases : undefined,
  });

  await createLetterPerson({
    letterId,
    personId: newPersonId,
    role: person.role as PersonRole,
    nameAsWritten: person.name,
    relationshipToSender: person.relationship_to_sender,
    context: richContext,
    confidence: aiConfidence,
  });

  return newPersonId;
}

async function processExtractedPlace(
  place: ExtractedPlace,
  letterId: string,
): Promise<void> {
  const matches = await findMatchingPlaces(place.name);
  const bestMatch = matches[0];
  const aiConfidence = Math.round(place.confidence * 100);

  const contextParts: string[] = [];
  if (place.why_mentioned) contextParts.push(place.why_mentioned);
  if (place.descriptive_details) contextParts.push(place.descriptive_details);
  const richContext = contextParts.join('; ') || undefined;

  if (bestMatch && bestMatch.similarity >= 85) {
    await createLetterPlace({
      letterId,
      placeId: bestMatch.entityId,
      role: place.role as PlaceRole,
      nameAsWritten: place.name,
      context: richContext,
      confidence: Math.min(aiConfidence, bestMatch.similarity),
    });

    const existing = await getCanonicalPlaceById(bestMatch.entityId);
    if (existing && !existing.placeType && place.type !== 'other') {
      await updateCanonicalPlace(bestMatch.entityId, {
        placeType: place.type as PlaceType,
      });
    }
    return;
  }

  if (bestMatch && bestMatch.similarity >= 50) {
    await addToReviewQueue({
      entityType: 'place',
      extractedText: place.name,
      letterId,
      suggestedEntityId: bestMatch.entityId,
      context: richContext,
      confidence: bestMatch.similarity,
    });
    return;
  }

  const newPlaceId = await createCanonicalPlace({
    canonicalName: place.name,
    placeType: place.type as PlaceType,
  });

  await createLetterPlace({
    letterId,
    placeId: newPlaceId,
    role: place.role as PlaceRole,
    nameAsWritten: place.name,
    context: richContext,
    confidence: aiConfidence,
  });
}

async function autoCreateRelationship(
  rel: DiscoveredRelationship,
  letterId: string,
  resolvedPersonIds: Map<string, string>,
): Promise<boolean> {
  let personAId = resolvedPersonIds.get(rel.person_a.toLowerCase());
  let personBId = resolvedPersonIds.get(rel.person_b.toLowerCase());

  if (!personAId) {
    const matches = await findMatchingPersons(rel.person_a, 1);
    if (matches[0] && matches[0].similarity >= 85) {
      personAId = matches[0].entityId;
    }
  }

  if (!personBId) {
    const matches = await findMatchingPersons(rel.person_b, 1);
    if (matches[0] && matches[0].similarity >= 85) {
      personBId = matches[0].entityId;
    }
  }

  if (!personAId || !personBId) {
    log.debug(
      { personA: rel.person_a, personB: rel.person_b, resolvedA: !!personAId, resolvedB: !!personBId },
      'Skipping relationship: one or both persons unresolved',
    );
    return false;
  }

  if (personAId === personBId) {
    return false;
  }

  const [first, second] = [personAId, personBId].sort();
  const existing = await db
    .select({ id: personRelationships.id })
    .from(personRelationships)
    .where(and(eq(personRelationships.personAId, first), eq(personRelationships.personBId, second)))
    .limit(1);

  if (existing.length > 0) {
    log.debug({ personA: rel.person_a, personB: rel.person_b }, 'Relationship already exists, skipping');
    return false;
  }

  const aiConfidence = Math.round(rel.confidence * 100);
  await createRelationship({
    personAId,
    personBId,
    relationshipType: rel.relationship_type as PersonRelationshipType,
    notes: rel.evidence,
    discoveredInLetterId: letterId,
    confidence: aiConfidence,
  });

  return true;
}
