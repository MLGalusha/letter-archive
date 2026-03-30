import { extractMetadataV2, extractEntities } from '../ai/openai.js';
import type { ExtractionCorrections } from '../ai/openai.js';
import {
  getLetterWithPages,
  updateMetadataV2,
  updateEntityExtraction,
  updateLetterWorkflow,
  incrementMetadataAttempts,
  claimJob,
} from '../services/letters.js';
import { processEntityExtraction } from '../services/entities.js';
import { updateJobProgress, clearJobProgress } from '../services/processing-queue.js';
import { createLogger } from '../utils/logger.js';
import { createNotification } from '../services/notifications.js';
import { db, letters } from '../db/index.js';
import { eq } from 'drizzle-orm';

const log = createLogger({ module: 'metadata-v2-pipeline' });
export interface ExtractionOptions {
  confirmedSender?: string;
  confirmedRecipient?: string;
  previousAiSender?: string;
  previousAiRecipient?: string;
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
export async function runMetadataExtractionV2(letterId: string, options?: ExtractionOptions): Promise<void> {
  const start = Date.now();
  const letterLog = log.child({ letterId });

  letterLog.debug('Starting two-phase metadata extraction pipeline');

  const letter = await getLetterWithPages(letterId);

  if (!letter) {
    letterLog.error('Letter not found');
    throw new Error(`Letter not found: ${letterId}`);
  }

  const context = {
    letterId,
    collectionCode: letter.collection.collectionCode,
    dateRaw: letter.dateRaw,
    type: letter.type,
  };

  // Only extract metadata for type='L' letters
  if (letter.type !== 'L') {
    letterLog.debug({ type: letter.type }, 'Skipping metadata extraction for non-letter type');
    return;
  }

  // Must have transcription
  if (!letter.transcriptionText) {
    letterLog.error('Letter has no transcription text');
    throw new Error(`Letter ${letterId} has no transcription text`);
  }

  letterLog.info(
    { transcriptLength: letter.transcriptionText.length },
    'Starting metadata extraction'
  );

  // Atomically claim the job — prevents worker and on-demand processing from double-running
  const claimed = await claimJob(letterId, 'metadataStatus', 'PENDING');
  if (!claimed) {
    letterLog.info('Metadata job already claimed by another process — skipping');
    return;
  }
  await updateLetterWorkflow(letterId, 'METADATA_EXTRACTING');

  const extractionContext = {
    collectionCode: letter.collection.collectionCode,
    dateRaw: letter.dateRaw,
    dateFromFilename: letter.letterDate,
    extraContentTranscript: letter.extraContentTranscript,
  };

  // ========================================================================
  // PHASE 1: Basic Metadata Extraction
  // ========================================================================

  updateJobProgress(letterId, 'metadata', 0, 2, 'Extracting metadata');

  let metadataResult;
  try {
    const corrections: ExtractionCorrections | undefined = options
      ? {
          confirmedSender: options.confirmedSender,
          confirmedRecipient: options.confirmedRecipient,
          previousAiSender: options.previousAiSender,
          previousAiRecipient: options.previousAiRecipient,
        }
      : undefined;

    metadataResult = await extractMetadataV2({
      transcriptionText: letter.transcriptionText,
      letterId,
      context: extractionContext,
      corrections,
    });

    // Check if the job was cancelled while we were processing
    const currentState = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      columns: { metadataStatus: true },
    });
    if (currentState?.metadataStatus === 'FAILED') {
      letterLog.info('Metadata extraction was cancelled during processing — discarding result');
      clearJobProgress(letterId, 'metadata');
      return;
    }

    // Store basic metadata
    await updateMetadataV2(letterId, 'SUCCESS', metadataResult.metadata, null);
    await updateLetterWorkflow(letterId, 'METADATA_DRAFTED');

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
    createNotification({
      type: 'metadata',
      title: 'Metadata extracted',
      message: `Sender: ${senderName}, Recipient: ${recipientName}`,
      link: `/admin/letters/${letterId}`,
    });
  } catch (error) {
    clearJobProgress(letterId, 'metadata');

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

    await updateMetadataV2(letterId, 'FAILED', undefined, message);
    throw error;
  }

  // ========================================================================
  // PHASE 2: Entity Extraction (non-fatal)
  // ========================================================================

  updateJobProgress(letterId, 'metadata', 1, 2, 'Extracting entities');

  try {
    // Claim entity extraction atomically (within same pipeline, but still safe)
    const entityClaimed = await claimJob(letterId, 'entityExtractionStatus', 'PENDING');
    if (!entityClaimed) {
      letterLog.info('Entity extraction already claimed — skipping Phase 2');
      clearJobProgress(letterId, 'metadata');
      return;
    }

    const entityCorrections: ExtractionCorrections | undefined = options
      ? {
          confirmedSender: options.confirmedSender,
          confirmedRecipient: options.confirmedRecipient,
          previousAiSender: options.previousAiSender,
          previousAiRecipient: options.previousAiRecipient,
        }
      : undefined;

    const entityResult = await extractEntities({
      transcriptionText: letter.transcriptionText,
      letterId,
      basicMetadata: {
        sender: metadataResult.metadata.sender,
        recipient: metadataResult.metadata.recipient,
        senderRecipientRelationship: metadataResult.metadata.sender_recipient_relationship,
        summary: metadataResult.metadata.summary,
      },
      context: extractionContext,
      corrections: entityCorrections,
    });

    // Store entity extraction JSON
    await updateEntityExtraction(letterId, 'SUCCESS', entityResult.entities, null);

    // Process entities: auto-populate canonical entities, link to letter, create relationships
    const processingResult = await processEntityExtraction(entityResult.entities, letterId);

    clearJobProgress(letterId, 'metadata');

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
    createNotification({
      type: 'entity',
      title: 'Entities extracted',
      message: `${entityResult.entities.people.length} people, ${entityResult.entities.places.length} places found`,
      link: `/admin/letters/${letterId}`,
    });
  } catch (error) {
    clearJobProgress(letterId, 'metadata');

    const message = error instanceof Error ? error.message : 'Unknown error';

    letterLog.warn(
      {
        ...context,

        err: error,
      },
      'Phase 2 (entity extraction) failed — basic metadata preserved'
    );

    await updateEntityExtraction(letterId, 'FAILED', undefined, message);
    // Do NOT throw — Phase 1 metadata is already saved
  }
}

/**
 * Runs only the entity extraction (Phase 2) for a letter.
 * Used for re-extraction without re-running basic metadata.
 */
export async function runEntityExtractionOnly(letterId: string, options?: ExtractionOptions): Promise<void> {
  const start = Date.now();
  const letterLog = log.child({ letterId });

  letterLog.debug('Starting entity-only extraction');

  const letter = await getLetterWithPages(letterId);

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  if (!letter.transcriptionText) {
    throw new Error(`Letter ${letterId} has no transcription text`);
  }

  // Read existing basic metadata for context
  const basicMetadata = {
    sender: letter.sender,
    recipient: letter.recipient,
    senderRecipientRelationship: letter.senderRecipientRelationship,
    summary: letter.summary,
  };

  // Atomically claim the entity extraction job
  const claimed = await claimJob(letterId, 'entityExtractionStatus', 'PENDING');
  if (!claimed) {
    letterLog.info('Entity extraction job already claimed by another process — skipping');
    return;
  }
  updateJobProgress(letterId, 'entity_extraction', 0, 1, 'Extracting entities');

  const corrections: ExtractionCorrections | undefined = options
    ? {
        confirmedSender: options.confirmedSender,
        confirmedRecipient: options.confirmedRecipient,
        previousAiSender: options.previousAiSender,
        previousAiRecipient: options.previousAiRecipient,
      }
    : undefined;

  try {
    const entityResult = await extractEntities({
      transcriptionText: letter.transcriptionText,
      letterId,
      basicMetadata,
      context: {
        collectionCode: letter.collection.collectionCode,
        dateRaw: letter.dateRaw,
        dateFromFilename: letter.letterDate,
        extraContentTranscript: letter.extraContentTranscript,
      },
      corrections,
    });

    // Check if the job was cancelled while we were processing
    const entityState = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      columns: { entityExtractionStatus: true },
    });
    if (entityState?.entityExtractionStatus === 'FAILED') {
      letterLog.info('Entity extraction was cancelled during processing — discarding result');
      clearJobProgress(letterId, 'entity_extraction');
      return;
    }

    await updateEntityExtraction(letterId, 'SUCCESS', entityResult.entities, null);

    const processingResult = await processEntityExtraction(entityResult.entities, letterId);

    clearJobProgress(letterId, 'entity_extraction');

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
    createNotification({
      type: 'entity',
      title: 'Entities extracted',
      message: `${entityResult.entities.people.length} people, ${entityResult.entities.places.length} places found`,
      link: `/admin/letters/${letterId}`,
    });
  } catch (error) {
    clearJobProgress(letterId, 'entity_extraction');

    const message = error instanceof Error ? error.message : 'Unknown error';
    letterLog.error({ letterId, err: error }, 'Entity-only extraction failed');
    await updateEntityExtraction(letterId, 'FAILED', undefined, message);
    throw error;
  }
}
