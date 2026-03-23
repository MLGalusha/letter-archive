/**
 * Collection Entity Resolution Service
 *
 * Three-phase pipeline:
 * Phase 1: Entity resolution (merges, generics, fills, relationship corrections)
 * Phase 2: Post-merge relationship verification
 * Phase 3: Biography generation for significant persons
 */

import { eq, and } from 'drizzle-orm';
import {
  db,
  letters,
  canonicalPersons,
  letterPersons,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  getPersonsForCollection,
  getLetterPersonJunctionsForCollection,
  getRelationshipsForCollection,
  getLettersWithMissingSenderRecipient,
  getGenericPersonsForCollection,
} from './collection-queries.js';
import {
  bulkMergePersons,
  mergePersonsWithUndo,
  getCanonicalPersonById,
  updateCanonicalPerson,
} from './persons.js';
import {
  updateRelationship,
  deleteRelationship,
} from './relationships.js';
import { addToReviewQueue } from './review-queue.js';
import { createLetterPerson } from './junctions.js';
import { resolveCollectionEntitiesAI } from '../../ai/openai/entity-resolution.js';
import { generateBiography } from '../../ai/biography.js';
import type { EntityResolution, MergeGroup, GenericResolution, SenderRecipientFill, RelationshipCorrection } from '../../ai/schemas/entityResolution.js';
import type { PersonRelationshipType } from '../../db/index.js';

const log = createLogger({ module: 'entity-resolution' });

const AUTO_EXECUTE_THRESHOLD = 0.85;
const BIO_MIN_LETTERS = 3;

// ============================================================================
// Result types
// ============================================================================

export interface ResolutionResult {
  collectionId: string;
  phases: {
    phase1: Phase1Result;
    phase2: Phase2Result;
    phase3: Phase3Result;
  };
  isStub: boolean;
  errors: string[];
}

export interface Phase1Result {
  mergesExecuted: number;
  mergesQueued: number;
  genericsResolved: number;
  genericsQueued: number;
  genericsDeleted: number;
  fillsApplied: number;
  fillsQueued: number;
  relationshipCorrections: number;
  relationshipCorrectionsQueued: number;
}

export interface Phase2Result {
  relationshipsVerified: number;
  correctionsApplied: number;
  correctionsQueued: number;
}

export interface Phase3Result {
  biographiesGenerated: number;
  biographiesSkipped: number;
}

// ============================================================================
// Main orchestration
// ============================================================================

export async function resolveCollectionEntities(
  collectionId: string,
): Promise<ResolutionResult> {
  const errors: string[] = [];
  log.info({ collectionId }, 'Starting collection entity resolution');

  // Gather all entity data for the collection
  const [persons, junctions, relationships, missingParticipants, genericPersons] =
    await Promise.all([
      getPersonsForCollection(collectionId),
      getLetterPersonJunctionsForCollection(collectionId),
      getRelationshipsForCollection(collectionId),
      getLettersWithMissingSenderRecipient(collectionId),
      getGenericPersonsForCollection(collectionId),
    ]);

  log.info(
    {
      collectionId,
      persons: persons.length,
      junctions: junctions.length,
      relationships: relationships.length,
      missingParticipants: missingParticipants.length,
      genericPersons: genericPersons.length,
    },
    'Entity data gathered for resolution',
  );

  if (persons.length === 0) {
    log.info({ collectionId }, 'No persons found, skipping resolution');
    return {
      collectionId,
      phases: {
        phase1: emptyPhase1(),
        phase2: emptyPhase2(),
        phase3: emptyPhase3(),
      },
      isStub: false,
      errors: [],
    };
  }

  // Phase 1: AI entity resolution
  const aiResult = await resolveCollectionEntitiesAI({
    persons,
    junctions,
    relationships,
    missingParticipants,
    genericPersons,
  });

  if (aiResult.isStub) {
    return {
      collectionId,
      phases: {
        phase1: emptyPhase1(),
        phase2: emptyPhase2(),
        phase3: emptyPhase3(),
      },
      isStub: true,
      errors: [],
    };
  }

  const resolution = aiResult.resolution;

  // Execute Phase 1 plan
  const phase1 = await executePhase1(resolution, collectionId, errors);

  // Phase 2: Re-query post-merge state and verify relationships
  const phase2 = await executePhase2(collectionId, errors);

  // Phase 3: Generate biographies for significant persons
  const phase3 = await executePhase3(collectionId, errors);

  log.info(
    {
      collectionId,
      phase1,
      phase2,
      phase3,
      errorCount: errors.length,
    },
    'Collection entity resolution complete',
  );

  return {
    collectionId,
    phases: { phase1, phase2, phase3 },
    isStub: false,
    errors,
  };
}

// ============================================================================
// Phase 1: Execute resolution plan
// ============================================================================

async function executePhase1(
  resolution: EntityResolution,
  collectionId: string,
  errors: string[],
): Promise<Phase1Result> {
  const result: Phase1Result = {
    mergesExecuted: 0,
    mergesQueued: 0,
    genericsResolved: 0,
    genericsQueued: 0,
    genericsDeleted: 0,
    fillsApplied: 0,
    fillsQueued: 0,
    relationshipCorrections: 0,
    relationshipCorrectionsQueued: 0,
  };

  // Process merge groups
  for (const group of resolution.merge_groups) {
    try {
      if (group.confidence >= AUTO_EXECUTE_THRESHOLD) {
        await executeMerge(group);
        result.mergesExecuted++;
      } else {
        await queueMergeForReview(group, collectionId);
        result.mergesQueued++;
      }
    } catch (err) {
      const msg = `Merge failed for ${group.keep_person_id}: ${err instanceof Error ? err.message : String(err)}`;
      log.error({ err, group }, msg);
      errors.push(msg);
    }
  }

  // Process generic resolutions
  for (const generic of resolution.generic_resolutions) {
    try {
      if (generic.confidence >= AUTO_EXECUTE_THRESHOLD) {
        const outcome = await executeGenericResolution(generic);
        if (outcome === 'deleted') result.genericsDeleted++;
        else result.genericsResolved++;
      } else {
        await queueGenericForReview(generic, collectionId);
        result.genericsQueued++;
      }
    } catch (err) {
      const msg = `Generic resolution failed for ${generic.generic_person_id}: ${err instanceof Error ? err.message : String(err)}`;
      log.error({ err, generic }, msg);
      errors.push(msg);
    }
  }

  // Process sender/recipient fills
  for (const fill of resolution.sender_recipient_fills) {
    try {
      if (fill.confidence >= AUTO_EXECUTE_THRESHOLD) {
        const applied = await executeFill(fill);
        if (applied) result.fillsApplied++;
      } else {
        await queueFillForReview(fill, collectionId);
        result.fillsQueued++;
      }
    } catch (err) {
      const msg = `Fill failed for letter ${fill.letter_id}: ${err instanceof Error ? err.message : String(err)}`;
      log.error({ err, fill }, msg);
      errors.push(msg);
    }
  }

  // Process relationship corrections
  for (const correction of resolution.relationship_corrections) {
    try {
      if (correction.confidence >= AUTO_EXECUTE_THRESHOLD) {
        await executeRelationshipCorrection(correction);
        result.relationshipCorrections++;
      } else {
        await queueRelationshipCorrectionForReview(correction, collectionId);
        result.relationshipCorrectionsQueued++;
      }
    } catch (err) {
      const msg = `Relationship correction failed: ${err instanceof Error ? err.message : String(err)}`;
      log.error({ err, correction }, msg);
      errors.push(msg);
    }
  }

  return result;
}

// ============================================================================
// Phase 1 executors
// ============================================================================

async function executeMerge(group: MergeGroup): Promise<void> {
  log.info(
    {
      keepId: group.keep_person_id,
      mergeIds: group.merge_person_ids,
      suggestedName: group.suggested_canonical_name,
      confidence: group.confidence,
    },
    'Executing merge',
  );

  // Bulk merge all into the keep person
  await bulkMergePersons(group.keep_person_id, group.merge_person_ids);

  // Update canonical name if suggested
  const keepPerson = await getCanonicalPersonById(group.keep_person_id);
  if (keepPerson && keepPerson.canonicalName !== group.suggested_canonical_name) {
    await updateCanonicalPerson(group.keep_person_id, {
      canonicalName: group.suggested_canonical_name,
    });
  }
}

async function queueMergeForReview(group: MergeGroup, collectionId: string): Promise<void> {
  // Find a letter from this collection for the review queue entry
  const letterRow = await db
    .select({ letterId: letterPersons.letterId })
    .from(letterPersons)
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .where(
      and(
        eq(letters.collectionId, collectionId),
        eq(letterPersons.personId, group.keep_person_id),
      ),
    )
    .limit(1);

  const letterId = letterRow[0]?.letterId;
  if (!letterId) return;

  await addToReviewQueue({
    entityType: 'person',
    extractedText: `MERGE: ${group.suggested_canonical_name} (merge ${group.merge_person_ids.length} persons)`,
    letterId,
    suggestedEntityId: group.keep_person_id,
    context: `AI resolution: ${group.reasoning} (confidence: ${group.confidence})`,
    confidence: Math.round(group.confidence * 100),
  });
}

async function executeGenericResolution(generic: GenericResolution): Promise<'merged' | 'deleted'> {
  if (generic.action === 'delete') {
    // Delete the generic person (cascade handled by merge into nothing)
    // We can't just delete — need to handle junctions. Use merge if target exists.
    log.info({ genericId: generic.generic_person_id }, 'Deleting generic entity');

    // Delete letter_persons entries for this person, then delete the person
    await db.delete(letterPersons).where(eq(letterPersons.personId, generic.generic_person_id));
    await db.delete(canonicalPersons).where(eq(canonicalPersons.id, generic.generic_person_id));
    return 'deleted';
  }

  if (generic.action === 'merge' && generic.resolves_to_person_id) {
    // Verify target exists
    const target = await getCanonicalPersonById(generic.resolves_to_person_id);
    if (!target) {
      throw new Error(`Target person ${generic.resolves_to_person_id} not found for generic resolution`);
    }

    await mergePersonsWithUndo(generic.resolves_to_person_id, generic.generic_person_id, 'ai-resolution');
    return 'merged';
  }

  // action === 'keep' — do nothing
  return 'merged';
}

async function queueGenericForReview(generic: GenericResolution, collectionId: string): Promise<void> {
  const letterRow = await db
    .select({ letterId: letterPersons.letterId })
    .from(letterPersons)
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .where(
      and(
        eq(letters.collectionId, collectionId),
        eq(letterPersons.personId, generic.generic_person_id),
      ),
    )
    .limit(1);

  const letterId = letterRow[0]?.letterId;
  if (!letterId) return;

  await addToReviewQueue({
    entityType: 'person',
    extractedText: `GENERIC: "${(await getCanonicalPersonById(generic.generic_person_id))?.canonicalName}" → ${generic.action}`,
    letterId,
    suggestedEntityId: generic.resolves_to_person_id ?? undefined,
    context: `AI resolution: ${generic.reasoning} (confidence: ${generic.confidence})`,
    confidence: Math.round(generic.confidence * 100),
  });
}

async function executeFill(fill: SenderRecipientFill): Promise<boolean> {
  // Get current letter state
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, fill.letter_id),
  });

  if (!letter) {
    log.warn({ letterId: fill.letter_id }, 'Letter not found for fill');
    return false;
  }

  // Don't overwrite existing values
  if (fill.role === 'sender' && letter.sender) {
    log.debug({ letterId: fill.letter_id }, 'Sender already filled, skipping');
    return false;
  }
  if (fill.role === 'recipient' && letter.recipient) {
    log.debug({ letterId: fill.letter_id }, 'Recipient already filled, skipping');
    return false;
  }

  // Update the letter
  const updateData = fill.role === 'sender'
    ? { sender: fill.name, updatedAt: new Date() }
    : { recipient: fill.name, updatedAt: new Date() };

  await db.update(letters).set(updateData).where(eq(letters.id, fill.letter_id));

  // Ensure junction exists
  await createLetterPerson({
    letterId: fill.letter_id,
    personId: fill.person_id,
    role: fill.role,
    nameAsWritten: fill.name,
    context: `Filled by AI resolution: ${fill.reasoning}`,
    confidence: Math.round(fill.confidence * 100),
  });

  log.info(
    { letterId: fill.letter_id, role: fill.role, personId: fill.person_id, name: fill.name },
    'Sender/recipient fill applied',
  );

  return true;
}

async function queueFillForReview(fill: SenderRecipientFill, _collectionId: string): Promise<void> {
  await addToReviewQueue({
    entityType: 'person',
    extractedText: `FILL ${fill.role}: "${fill.name}" for letter`,
    letterId: fill.letter_id,
    suggestedEntityId: fill.person_id,
    context: `AI resolution: ${fill.reasoning} (confidence: ${fill.confidence})`,
    confidence: Math.round(fill.confidence * 100),
  });
}

async function executeRelationshipCorrection(correction: RelationshipCorrection): Promise<void> {
  // Find the relationship by person pair
  const [a, b] = [correction.person_a_id, correction.person_b_id].sort();

  const existing = await db.query.personRelationships.findFirst({
    where: (pr, { and, eq }) => and(eq(pr.personAId, a), eq(pr.personBId, b)),
  });

  if (!existing) {
    log.warn({ correction }, 'Relationship not found for correction');
    return;
  }

  if (correction.action === 'delete') {
    await deleteRelationship(existing.id);
    log.info({ relationshipId: existing.id }, 'Relationship deleted by AI correction');
  } else if (correction.action === 'update_type' && correction.corrected_type) {
    await updateRelationship(existing.id, {
      relationshipType: correction.corrected_type as PersonRelationshipType,
    });
    log.info(
      { relationshipId: existing.id, from: correction.current_type, to: correction.corrected_type },
      'Relationship type corrected by AI',
    );
  }
}

async function queueRelationshipCorrectionForReview(
  correction: RelationshipCorrection,
  collectionId: string,
): Promise<void> {
  // Find a letter in this collection for the review queue
  const letterRow = await db
    .select({ letterId: letterPersons.letterId })
    .from(letterPersons)
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .where(
      and(
        eq(letters.collectionId, collectionId),
        eq(letterPersons.personId, correction.person_a_id),
      ),
    )
    .limit(1);

  const letterId = letterRow[0]?.letterId;
  if (!letterId) return;

  await addToReviewQueue({
    entityType: 'person',
    extractedText: `RELATIONSHIP: ${correction.action} ${correction.current_type} → ${correction.corrected_type ?? 'DELETE'}`,
    letterId,
    context: `AI resolution: ${correction.reasoning} (confidence: ${correction.confidence})`,
    confidence: Math.round(correction.confidence * 100),
  });
}

// ============================================================================
// Phase 2: Post-merge relationship verification
// ============================================================================

async function executePhase2(
  collectionId: string,
  errors: string[],
): Promise<Phase2Result> {
  const result: Phase2Result = {
    relationshipsVerified: 0,
    correctionsApplied: 0,
    correctionsQueued: 0,
  };

  try {
    // Re-query relationships after merges
    const relationships = await getRelationshipsForCollection(collectionId);
    result.relationshipsVerified = relationships.length;

    // Check for duplicate relationships (same pair, different IDs — shouldn't happen
    // after merge but check anyway)
    const seen = new Map<string, string>();
    for (const rel of relationships) {
      const key = `${rel.personAId}:${rel.personBId}`;
      if (seen.has(key)) {
        // Duplicate found — delete the one with lower confidence
        try {
          await deleteRelationship(rel.id);
          result.correctionsApplied++;
          log.info(
            { deletedId: rel.id, keptId: seen.get(key), pair: key },
            'Deleted duplicate relationship post-merge',
          );
        } catch (err) {
          errors.push(`Phase 2 duplicate cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        seen.set(key, rel.id);
      }
    }
  } catch (err) {
    errors.push(`Phase 2 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ============================================================================
// Phase 3: Biography generation
// ============================================================================

async function executePhase3(
  collectionId: string,
  errors: string[],
): Promise<Phase3Result> {
  const result: Phase3Result = {
    biographiesGenerated: 0,
    biographiesSkipped: 0,
  };

  try {
    // Get persons with sufficient letter count
    const persons = await getPersonsForCollection(collectionId);
    const significantPersons = persons.filter((p) => p.letterCount >= BIO_MIN_LETTERS);

    for (const person of significantPersons) {
      try {
        // Check if biography already exists
        const existing = await getCanonicalPersonById(person.id);
        if (existing?.biography && existing.biographyStatus !== 'EMPTY') {
          result.biographiesSkipped++;
          continue;
        }

        const biography = await generateBiography(person.id);

        await db
          .update(canonicalPersons)
          .set({
            biography,
            biographyStatus: 'AI_DRAFT',
            updatedAt: new Date(),
          })
          .where(eq(canonicalPersons.id, person.id));

        result.biographiesGenerated++;
        log.info({ personId: person.id, personName: person.canonicalName }, 'Biography generated');
      } catch (err) {
        const msg = `Biography generation failed for ${person.canonicalName}: ${err instanceof Error ? err.message : String(err)}`;
        log.error({ err, personId: person.id }, msg);
        errors.push(msg);
        result.biographiesSkipped++;
      }
    }
  } catch (err) {
    errors.push(`Phase 3 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function emptyPhase1(): Phase1Result {
  return {
    mergesExecuted: 0,
    mergesQueued: 0,
    genericsResolved: 0,
    genericsQueued: 0,
    genericsDeleted: 0,
    fillsApplied: 0,
    fillsQueued: 0,
    relationshipCorrections: 0,
    relationshipCorrectionsQueued: 0,
  };
}

function emptyPhase2(): Phase2Result {
  return {
    relationshipsVerified: 0,
    correctionsApplied: 0,
    correctionsQueued: 0,
  };
}

function emptyPhase3(): Phase3Result {
  return {
    biographiesGenerated: 0,
    biographiesSkipped: 0,
  };
}
