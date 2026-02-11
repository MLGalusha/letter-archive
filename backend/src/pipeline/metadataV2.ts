import { extractMetadataV2, extractEntities } from '../ai/openai.js';
import {
  getLetterWithPages,
  updateMetadataV2,
  updateEntityExtraction,
  updateLetterWorkflow,
  incrementMetadataAttempts,
} from '../services/letters.js';
import { processEntityExtraction } from '../services/entities.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'metadata-v2-pipeline' });
const MAX_ATTEMPTS = 3;

/**
 * Runs the two-phase metadata + entity extraction pipeline for a letter.
 *
 * Phase 1 (Basic Metadata): sender, recipient, date, hook, summary, topics, etc.
 * Phase 2 (Entity Extraction): rich people/place profiles, relationships, connections.
 *
 * Phase 2 failure is non-fatal — metadata from Phase 1 is always preserved.
 * Only processes type='L' letters that have been transcribed.
 */
export async function runMetadataExtractionV2(letterId: string): Promise<void> {
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

  // Check attempt count
  if (letter.metadataAttemptCount >= MAX_ATTEMPTS) {
    letterLog.warn(
      { attemptCount: letter.metadataAttemptCount, maxAttempts: MAX_ATTEMPTS },
      'Max metadata extraction attempts reached'
    );
    await updateMetadataV2(letterId, 'FAILED', undefined, 'Max attempts exceeded');
    return;
  }

  // Increment attempt count
  const attemptNumber = letter.metadataAttemptCount + 1;
  await incrementMetadataAttempts(letterId);
  letterLog.info(
    { attemptNumber, maxAttempts: MAX_ATTEMPTS, transcriptLength: letter.transcriptionText.length },
    'Starting metadata extraction attempt'
  );

  // Update status to running
  await updateLetterWorkflow(letterId, 'METADATA_EXTRACTING');
  await updateMetadataV2(letterId, 'RUNNING');

  const extractionContext = {
    collectionCode: letter.collection.collectionCode,
    dateRaw: letter.dateRaw,
    dateFromFilename: letter.letterDate,
    extraContentTranscript: letter.extraContentTranscript,
  };

  // ========================================================================
  // PHASE 1: Basic Metadata Extraction
  // ========================================================================

  let metadataResult;
  try {
    metadataResult = await extractMetadataV2({
      transcriptionText: letter.transcriptionText,
      context: extractionContext,
    });

    // Store basic metadata
    await updateMetadataV2(letterId, 'SUCCESS', metadataResult.metadata, null);
    await updateLetterWorkflow(letterId, 'METADATA_DRAFTED');

    const phase1Duration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration: phase1Duration,
        attemptNumber,
        isStub: metadataResult.isStub,
        emotionalTone: metadataResult.metadata.emotional_tone,
        relationship: metadataResult.metadata.sender_recipient_relationship,
        topicsCount: metadataResult.metadata.primary_topics.length,
        quotesCount: metadataResult.metadata.notable_quotes.length,
        hasSender: !!metadataResult.metadata.sender.name,
        hasRecipient: !!metadataResult.metadata.recipient.name,
        usage: metadataResult.usage,
      },
      'Phase 1 (basic metadata) completed successfully'
    );
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : 'Unknown error';

    letterLog.error(
      {
        ...context,
        duration,
        attemptNumber,
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

  try {
    await updateEntityExtraction(letterId, 'RUNNING');

    const entityResult = await extractEntities({
      transcriptionText: letter.transcriptionText,
      basicMetadata: {
        sender: metadataResult.metadata.sender.name,
        recipient: metadataResult.metadata.recipient.name,
        senderRecipientRelationship: metadataResult.metadata.sender_recipient_relationship,
        summary: metadataResult.metadata.summary,
      },
      context: extractionContext,
    });

    // Store entity extraction JSON
    await updateEntityExtraction(letterId, 'SUCCESS', entityResult.entities, null);

    // Process entities: auto-populate canonical entities, link to letter, create relationships
    const processingResult = await processEntityExtraction(entityResult.entities, letterId);

    const totalDuration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration: totalDuration,
        attemptNumber,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    letterLog.warn(
      {
        ...context,
        attemptNumber,
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
export async function runEntityExtractionOnly(letterId: string): Promise<void> {
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

  await updateEntityExtraction(letterId, 'RUNNING');

  try {
    const entityResult = await extractEntities({
      transcriptionText: letter.transcriptionText,
      basicMetadata,
      context: {
        collectionCode: letter.collection.collectionCode,
        dateRaw: letter.dateRaw,
        dateFromFilename: letter.letterDate,
        extraContentTranscript: letter.extraContentTranscript,
      },
    });

    await updateEntityExtraction(letterId, 'SUCCESS', entityResult.entities, null);

    const processingResult = await processEntityExtraction(entityResult.entities, letterId);

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    letterLog.error({ letterId, err: error }, 'Entity-only extraction failed');
    await updateEntityExtraction(letterId, 'FAILED', undefined, message);
    throw error;
  }
}
