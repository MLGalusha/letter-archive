import { extractMetadataV2 } from '../ai/openai.js';
import {
  getLetterWithPages,
  updateMetadataV2,
  updateLetterWorkflow,
  incrementMetadataAttempts,
} from '../services/letters.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'metadata-v2-pipeline' });
const MAX_ATTEMPTS = 3;

/**
 * Runs V2 metadata extraction for a letter.
 *
 * V2 extraction uses:
 * - OpenAI Responses API with structured outputs
 * - Temperature 0 for deterministic extraction
 * - Richer metadata: emotional tone, relationships, topics, quotes, entities
 *
 * Only processes type='L' letters that have been transcribed.
 */
export async function runMetadataExtractionV2(letterId: string): Promise<void> {
  const start = Date.now();
  const letterLog = log.child({ letterId });

  letterLog.debug('Starting V2 metadata extraction pipeline');

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
    letterLog.debug({ type: letter.type }, 'Skipping V2 metadata extraction for non-letter type');
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
      'Max V2 metadata extraction attempts reached'
    );
    await updateMetadataV2(letterId, 'FAILED', undefined, 'Max attempts exceeded');
    return;
  }

  // Increment attempt count
  const attemptNumber = letter.metadataAttemptCount + 1;
  await incrementMetadataAttempts(letterId);
  letterLog.info(
    { attemptNumber, maxAttempts: MAX_ATTEMPTS, transcriptLength: letter.transcriptionText.length },
    'Starting V2 metadata extraction attempt'
  );

  // Update status to running
  await updateLetterWorkflow(letterId, 'METADATA_EXTRACTING');
  await updateMetadataV2(letterId, 'RUNNING');

  try {
    const result = await extractMetadataV2({
      transcriptionText: letter.transcriptionText,
      context: {
        collectionCode: letter.collection.collectionCode,
        dateRaw: letter.dateRaw,
        dateFromFilename: letter.letterDate,
        extraContentTranscript: letter.extraContentTranscript,
      },
    });

    // Update letter with V2 metadata
    await updateMetadataV2(letterId, 'SUCCESS', result.metadata, null);
    await updateLetterWorkflow(letterId, 'METADATA_DRAFTED');

    const duration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration,
        attemptNumber,
        isStub: result.isStub,
        emotionalTone: result.metadata.emotional_tone,
        relationship: result.metadata.sender_recipient_relationship,
        topicsCount: result.metadata.primary_topics.length,
        quotesCount: result.metadata.notable_quotes.length,
        entitiesCount: result.metadata.entities.length,
        hasSender: !!result.metadata.sender.name,
        hasRecipient: !!result.metadata.recipient.name,
        usage: result.usage,
      },
      'V2 metadata extraction pipeline completed successfully'
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
      'V2 metadata extraction pipeline failed'
    );

    await updateMetadataV2(letterId, 'FAILED', undefined, message);
    throw error;
  }
}
