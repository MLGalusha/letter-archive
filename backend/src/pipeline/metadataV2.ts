import { extractMetadataV2, extractEntities } from '../ai/openai.js';
import type { ExtractionCorrections } from '../ai/openai.js';
import {
  getLetterWithPages,
} from '../services/letters.js';
import {
  claimQueuedEntityExtraction,
  claimRequestedEntityExtraction,
  failEntityExtraction,
  observeEntityExtractionState,
  withEntityExtractionHeartbeat,
  type EntityExtractionClaim,
  type EntityExtractionHeartbeat,
} from '../services/letter/entity-extraction-job.js';
import {
  claimQueuedMetadata,
  completeMetadata,
  failMetadata,
  observeMetadataState,
  withMetadataHeartbeat,
  type MetadataClaim,
  type MetadataHeartbeat,
} from '../services/letter/metadata-job.js';
import {
  EntityExtractionClaimLostError,
  processEntityExtraction,
} from '../services/entities.js';
import { isEntityExtractionStateEligible } from '../services/processing-eligibility.js';
import { createLogger } from '../utils/logger.js';
import { notify } from '../services/notifications.js';

const log = createLogger({ module: 'metadata-v2-pipeline' });
export interface ExtractionOptions {
  confirmedSender?: string;
  confirmedRecipient?: string;
  previousAiSender?: string;
  previousAiRecipient?: string;
  /** Defaults to automatic. Workers may defer this follow-on to the durable queue. */
  entityExtraction?: 'automatic' | 'deferred';
  /** Worker-only admission token; direct request claims intentionally omit it. */
  workerExecutionToken?: string;
}

export interface EntityExtractionRunOptions {
  claimKind: 'QUEUED' | 'REQUESTED';
  confirmedSender?: string;
  confirmedRecipient?: string;
  previousAiSender?: string;
  previousAiRecipient?: string;
  /** Present only for the automatic worker's QUEUED claim. */
  workerExecutionToken?: string;
}

export type MetadataRunOutcome =
  | { kind: 'completed' }
  | { kind: 'claim_lost' }
  | { kind: 'superseded' }
  | { kind: 'ineligible' };

export type EntityExtractionRunOutcome =
  | { kind: 'completed' }
  | { kind: 'claim_lost' }
  | { kind: 'superseded' }
  | { kind: 'ineligible' };

interface ClaimedEntityExtractionResult {
  entityResult: Awaited<ReturnType<typeof extractEntities>>;
  processingResult: Awaited<ReturnType<typeof processEntityExtraction>>;
}

function correctionsMatchingClaimedIdentity(
  letter: Awaited<ReturnType<typeof getLetterWithPages>>,
  corrections: ExtractionCorrections | undefined,
): ExtractionCorrections | undefined {
  if (!letter || !corrections) return undefined;

  const confirmedSender = corrections.confirmedSender !== undefined
    && corrections.confirmedSender === letter.sender
    ? corrections.confirmedSender
    : undefined;
  const confirmedRecipient = corrections.confirmedRecipient !== undefined
    && corrections.confirmedRecipient === letter.recipient
    ? corrections.confirmedRecipient
    : undefined;
  if (confirmedSender === undefined && confirmedRecipient === undefined) {
    return undefined;
  }

  return {
    confirmedSender,
    confirmedRecipient,
    previousAiSender: confirmedSender === undefined
      ? undefined
      : corrections.previousAiSender,
    previousAiRecipient: confirmedRecipient === undefined
      ? undefined
      : corrections.previousAiRecipient,
  };
}

/**
 * The two public entity entry paths share one post-claim input reload and
 * transactional producer. Their failure/reporting contracts remain separate.
 */
async function executeClaimedEntityExtraction(
  letterId: string,
  claim: EntityExtractionClaim,
  heartbeat: EntityExtractionHeartbeat,
  corrections?: ExtractionCorrections,
  requireCurrentIdentityMatch = false,
): Promise<ClaimedEntityExtractionResult | null> {
  if (!heartbeat.hasOwnership()) return null;

  const letter = await getLetterWithPages(letterId);
  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }
  if (
    letter.entityExtractionStatus !== 'RUNNING'
    || letter.entityExtractionRunId !== claim.runId
    || letter.entityExtractionRunRevision !== claim.revision
    || letter.entityExtractionRevision !== claim.revision - 1
    || letter.entityExtractionLeaseRunId !== claim.runId
    || letter.entityExtractionLeaseExpiresAt === null
    || letter.entityExtractionClaimKind === null
    || letter.extraContentJobStatus === 'RUNNING'
  ) {
    return null;
  }
  if (!letter.transcriptionText) {
    throw new Error(`Letter ${letterId} has no transcription text`);
  }

  const entityResult = await extractEntities({
    transcriptionText: letter.transcriptionText,
    letterId,
    basicMetadata: {
      sender: letter.sender,
      recipient: letter.recipient,
      senderRecipientRelationship: letter.senderRecipientRelationship,
      summary: letter.summary,
    },
    context: {
      collectionCode: letter.collection.collectionCode,
      dateRaw: letter.dateRaw,
      dateFromFilename: letter.letterDate,
      extraContentTranscript: letter.extraContentTranscript,
    },
    corrections: requireCurrentIdentityMatch
      ? correctionsMatchingClaimedIdentity(letter, corrections)
      : corrections,
  });

  if (!heartbeat.hasOwnership()) return null;

  const processingResult = await processEntityExtraction(
    entityResult.entities,
    letterId,
    claim,
  );

  return { entityResult, processingResult };
}

/**
 * Runs the two-phase metadata + entity extraction pipeline for a letter.
 *
 * Phase 1 (Basic Metadata): sender, recipient, date, hook, summary, topics, etc.
 * Phase 2 (Entity Extraction): rich people/place profiles, relationships, connections.
 *
 * Phase 2 failure is non-fatal — metadata from Phase 1 is always preserved.
 * Only processes type='L' letters that have been transcribed.
 */
export async function runMetadataExtractionV2(
  letterId: string,
  options?: ExtractionOptions,
  existingClaim?: MetadataClaim,
): Promise<MetadataRunOutcome> {
  const start = Date.now();
  const letterLog = log.child({ letterId });

  letterLog.debug('Starting two-phase metadata extraction pipeline');

  let claim = existingClaim;
  if (!claim) {
    const observedLetter = await getLetterWithPages(letterId);

    if (!observedLetter) {
      letterLog.error('Letter not found');
      throw new Error(`Letter not found: ${letterId}`);
    }

    if (observedLetter.type !== 'L' || !observedLetter.transcriptionText?.trim()) {
      letterLog.debug(
        { type: observedLetter.type },
        'Skipping metadata extraction for an ineligible source',
      );
      return { kind: 'ineligible' };
    }

    const queuedClaim = await claimQueuedMetadata(
      letterId,
      observeMetadataState(observedLetter),
      options?.workerExecutionToken,
    );
    if (!queuedClaim) {
      letterLog.info('Metadata source changed or another process won the claim');
      return { kind: 'claim_lost' };
    }
    claim = queuedClaim;
  }

  return withMetadataHeartbeat(letterId, claim, async (heartbeat) =>
    executeClaimedMetadataExtractionV2(
      letterId,
      options,
      claim,
      heartbeat,
      start,
    ));
}

async function executeClaimedMetadataExtractionV2(
  letterId: string,
  options: ExtractionOptions | undefined,
  claim: MetadataClaim,
  heartbeat: MetadataHeartbeat,
  start: number,
): Promise<MetadataRunOutcome> {
  const letterLog = log.child({ letterId });
  if (!heartbeat.hasOwnership()) return { kind: 'superseded' };

  // Every producer reloads its source after ownership is established. This
  // keeps AI input aligned with the exact revision that the claim fenced.
  let letter;
  try {
    letter = await getLetterWithPages(letterId);
    if (
      !letter
      || letter.metadataStatus !== 'RUNNING'
      || letter.metadataRunId !== claim.runId
      || letter.metadataRunRevision !== claim.revision
      || letter.metadataRevision !== claim.revision
      || letter.metadataLeaseRunId !== claim.runId
      || letter.metadataLeaseExpiresAt === null
      || letter.metadataClaimKind === null
    ) {
      // If only this run's fenced state drifted, revoke the exact token so a
      // producer cannot leave its own row permanently RUNNING. This is a no-op
      // when another writer already replaced or cleared ownership.
      await failMetadata(
        letterId,
        claim,
        'Metadata source changed immediately after claim',
      );
      return { kind: 'superseded' };
    }
    if (letter.type !== 'L') {
      throw new Error(`Letter ${letterId} is not eligible for metadata extraction`);
    }
    if (!letter.transcriptionText?.trim()) {
      throw new Error(`Letter ${letterId} has no transcription text`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const failed = await failMetadata(letterId, claim, message);
    if (!failed) return { kind: 'superseded' };
    throw error;
  }

  const context = {
    letterId,
    collectionCode: letter.collection.collectionCode,
    dateRaw: letter.dateRaw,
    type: letter.type,
  };

  letterLog.info(
    { transcriptLength: letter.transcriptionText.length },
    'Starting metadata extraction'
  );

  const extractionContext = {
    collectionCode: letter.collection.collectionCode,
    dateRaw: letter.dateRaw,
    dateFromFilename: letter.letterDate,
    extraContentTranscript: letter.extraContentTranscript,
  };

  // Queue preflight data is intentionally not passed into this function. When
  // no explicit admin corrections were bound to the claim, derive prefills
  // from the authoritative post-claim reload instead of an earlier snapshot.
  const effectiveCorrections: ExtractionCorrections | undefined = options && (
    options.confirmedSender !== undefined
      || options.confirmedRecipient !== undefined
      || options.previousAiSender !== undefined
      || options.previousAiRecipient !== undefined
  )
    ? {
        confirmedSender: options.confirmedSender,
        confirmedRecipient: options.confirmedRecipient,
        previousAiSender: options.previousAiSender,
        previousAiRecipient: options.previousAiRecipient,
      }
    : letter.sender || letter.recipient
      ? {
          confirmedSender: letter.sender ?? undefined,
          confirmedRecipient: letter.recipient ?? undefined,
        }
      : undefined;
  const embeddedEntityCorrections: ExtractionCorrections | undefined = options && (
    options.confirmedSender !== undefined
    || options.confirmedRecipient !== undefined
  )
    ? {
        confirmedSender: options.confirmedSender,
        confirmedRecipient: options.confirmedRecipient,
        previousAiSender: options.previousAiSender,
        previousAiRecipient: options.previousAiRecipient,
      }
    : undefined;

  // ========================================================================
  // PHASE 1: Basic Metadata Extraction
  // ========================================================================

  let metadataResult;
  try {
    metadataResult = await extractMetadataV2({
      transcriptionText: letter.transcriptionText,
      letterId,
      context: extractionContext,
      corrections: effectiveCorrections,
    });

    if (!heartbeat.hasOwnership()) {
      letterLog.info('Metadata lease was lost; discarding unfinished result');
      return { kind: 'superseded' };
    }

    const published = await completeMetadata(
      letterId,
      claim,
      metadataResult.metadata,
    );
    if (!published) {
      letterLog.info('Metadata ownership changed during processing — discarding result');
      return { kind: 'superseded' };
    }

    const phase1Duration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration: phase1Duration,

        isStub: metadataResult.isStub,
        emotionalTone: metadataResult.metadata.emotional_tone,
        relationship: metadataResult.metadata.sender_recipient_relationship,
        topicsCount: metadataResult.metadata.primary_topics.length,
        quotesCount: metadataResult.metadata.notable_quotes.length,
        hasSender: !!metadataResult.metadata.sender,
        hasRecipient: !!metadataResult.metadata.recipient,
        usage: metadataResult.usage,
      },
      'Phase 1 (basic metadata) completed successfully'
    );

    // Notification: metadata extracted
    const senderName = metadataResult.metadata.sender || 'Unknown';
    const recipientName = metadataResult.metadata.recipient || 'Unknown';
    void notify({
      type: 'metadata_success',
      title: 'Metadata extracted',
      message: `Sender: ${senderName}, Recipient: ${recipientName}`,
      link: `/admin/letters/${letterId}`,
      sourceType: 'letter',
      sourceId: letterId,
      metadata: { sender: senderName, recipient: recipientName },
    });

    const highPriorityNotes = Array.isArray(metadataResult.metadata.ai_notes)
      ? metadataResult.metadata.ai_notes.filter(note => note.priority === 'high')
      : [];
    if (highPriorityNotes.length > 0) {
      void notify({
        type: 'ai_notes_high_priority',
        title: `${highPriorityNotes.length} note${highPriorityNotes.length > 1 ? 's' : ''} need attention`,
        message: highPriorityNotes.map(note => note.content).join('; '),
        link: `/admin/letters/${letterId}`,
        sourceType: 'letter',
        sourceId: letterId,
        metadata: { noteCount: highPriorityNotes.length },
        dedupeKey: `ai_notes_high_priority:${letterId}`,
      });
    }
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : 'Unknown error';

    letterLog.error(
      {
        ...context,
        duration,

        err: error,
      },
      'Phase 1 (basic metadata) failed'
    );

    const failed = await failMetadata(letterId, claim, message);
    if (!failed) return { kind: 'superseded' };
    throw error;
  }

  if (options?.entityExtraction === 'deferred') {
    letterLog.info('Entity extraction deferred to the durable queue');
    return { kind: 'completed' };
  }

  // ========================================================================
  // PHASE 2: Entity Extraction (non-fatal)
  // ========================================================================

  let entityClaim: EntityExtractionClaim | null = null;
  try {
    const entitySource = await getLetterWithPages(letterId);
    if (!entitySource) {
      letterLog.info('Letter disappeared before entity extraction could be claimed');
      return { kind: 'completed' };
    }

    // Metadata publication creates required derived work. Even when an API
    // performs it inline, expiry returns it to the durable queue.
    entityClaim = await claimQueuedEntityExtraction(
      letterId,
      observeEntityExtractionState(entitySource),
      options?.workerExecutionToken,
    );
    if (!entityClaim) {
      letterLog.info('Entity extraction already claimed — skipping Phase 2');
      return { kind: 'completed' };
    }
    const claimedEntity = entityClaim;

    const claimedResult = await withEntityExtractionHeartbeat(
      letterId,
      claimedEntity,
      heartbeat => executeClaimedEntityExtraction(
        letterId,
        claimedEntity,
        heartbeat,
        embeddedEntityCorrections,
        true,
      ),
    );
    if (!claimedResult) {
      letterLog.info('Entity extraction lease was lost before commit');
      return { kind: 'completed' };
    }
    const { entityResult, processingResult } = claimedResult;

    const totalDuration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration: totalDuration,

        isStub: entityResult.isStub,
        peopleCount: entityResult.entities.people.length,
        placesCount: entityResult.entities.places.length,
        relationshipsCount: entityResult.entities.relationships.length,
        connectionsCount: entityResult.entities.person_place_connections.length,
        peopleProcessed: processingResult.peopleProcessed,
        placesProcessed: processingResult.placesProcessed,
        relationshipsCreated: processingResult.relationshipsCreated,
        processingErrors: processingResult.errors.length,
        usage: entityResult.usage,
      },
      'Phase 2 (entity extraction) completed successfully'
    );

    // Notification: entities extracted
    void notify({
      type: 'entity_success',
      title: 'Entities extracted',
      message: `${entityResult.entities.people.length} people, ${entityResult.entities.places.length} places found`,
      link: `/admin/letters/${letterId}`,
      sourceType: 'letter',
      sourceId: letterId,
      metadata: {
        peopleCount: entityResult.entities.people.length,
        placesCount: entityResult.entities.places.length,
        relationshipsCount: entityResult.entities.relationships.length,
      },
    });
  } catch (error) {
    if (error instanceof EntityExtractionClaimLostError) {
      letterLog.info('Entity extraction run was superseded before commit');
      return { kind: 'completed' };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';

    letterLog.warn(
      {
        ...context,

        err: error,
      },
      'Phase 2 (entity extraction) failed — basic metadata preserved'
    );

    const failed = entityClaim
      ? await failEntityExtraction(letterId, entityClaim, message)
      : false;
    if (entityClaim && !failed) {
      letterLog.info('Entity extraction failure belonged to a superseded run');
      return { kind: 'completed' };
    }

    // Surface the failure to the admin — basic metadata still saved, but entity work is missing
    void notify({
      type: 'entity_failed',
      title: 'Entity extraction failed',
      message: `${message} — basic metadata preserved`,
      link: `/admin/letters/${letterId}`,
      sourceType: 'letter',
      sourceId: letterId,
      metadata: { error: message, fatal: false },
      dedupeKey: `entity_failed:${letterId}`,
    });
    // Do NOT throw — Phase 1 metadata is already saved
  }

  return { kind: 'completed' };
}

/**
 * Runs only the entity extraction (Phase 2) for a letter.
 * Used for re-extraction without re-running basic metadata.
 */
export async function runEntityExtractionOnly(
  letterId: string,
  options: EntityExtractionRunOptions,
): Promise<EntityExtractionRunOutcome> {
  const start = Date.now();
  const letterLog = log.child({ letterId });

  letterLog.debug('Starting entity-only extraction');

  const source = await getLetterWithPages(letterId);
  if (!source || !isEntityExtractionStateEligible(source)) {
    letterLog.info('Entity extraction source is not eligible');
    return { kind: 'ineligible' };
  }

  const observed = observeEntityExtractionState(source);
  const claim = options.claimKind === 'QUEUED'
    ? await claimQueuedEntityExtraction(
      letterId,
      observed,
      options.workerExecutionToken,
    )
    : await claimRequestedEntityExtraction(letterId, observed);
  if (!claim) {
    letterLog.info('Entity extraction job already claimed by another process — skipping');
    return { kind: 'claim_lost' };
  }

  const hasExplicitCorrections = (
    options.confirmedSender !== undefined
    || options.confirmedRecipient !== undefined
    || options.previousAiSender !== undefined
    || options.previousAiRecipient !== undefined
  );
  const corrections: ExtractionCorrections | undefined = hasExplicitCorrections
    ? {
        confirmedSender: options.confirmedSender,
        confirmedRecipient: options.confirmedRecipient,
        previousAiSender: options.previousAiSender,
        previousAiRecipient: options.previousAiRecipient,
      }
    : undefined;

  try {
    const claimedResult = await withEntityExtractionHeartbeat(
      letterId,
      claim,
      heartbeat => executeClaimedEntityExtraction(
        letterId,
        claim,
        heartbeat,
        corrections,
      ),
    );
    if (!claimedResult) {
      letterLog.info('Entity extraction lease was lost before commit');
      return { kind: 'superseded' };
    }
    const { entityResult, processingResult } = claimedResult;

    const duration = Date.now() - start;
    letterLog.info(
      {
        letterId,
        duration,
        peopleCount: entityResult.entities.people.length,
        placesCount: entityResult.entities.places.length,
        relationshipsCount: entityResult.entities.relationships.length,
        peopleProcessed: processingResult.peopleProcessed,
        placesProcessed: processingResult.placesProcessed,
        relationshipsCreated: processingResult.relationshipsCreated,
        processingErrors: processingResult.errors.length,
      },
      'Entity-only extraction completed'
    );

    // Notification: entities extracted (standalone)
    void notify({
      type: 'entity_success',
      title: 'Entities extracted',
      message: `${entityResult.entities.people.length} people, ${entityResult.entities.places.length} places found`,
      link: `/admin/letters/${letterId}`,
      sourceType: 'letter',
      sourceId: letterId,
      metadata: {
        peopleCount: entityResult.entities.people.length,
        placesCount: entityResult.entities.places.length,
        relationshipsCount: entityResult.entities.relationships.length,
        standalone: true,
      },
    });
    return { kind: 'completed' };
  } catch (error) {
    if (error instanceof EntityExtractionClaimLostError) {
      letterLog.info('Entity extraction run was superseded before commit');
      return { kind: 'superseded' };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    letterLog.error({ letterId, err: error }, 'Entity-only extraction failed');
    if (!await failEntityExtraction(letterId, claim, message)) {
      letterLog.info('Entity extraction failure belonged to a superseded run');
      return { kind: 'superseded' };
    }
    throw error;
  }
}
