import { extractMetadata } from '../ai/openai.js';
import {
  getLetterWithPages,
  updateMetadataStatus,
  updateLetterWorkflow,
  incrementMetadataAttempts,
} from '../services/letters.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'metadata-pipeline' });
const MAX_ATTEMPTS = 3;

/**
 * Runs metadata extraction for a letter.
 * - Only processes type='L' letters that have been transcribed
 * - Extracts sender, recipient, location, summary, tags, date
 */
export async function runMetadataExtraction(letterId: string): Promise<void> {
  const start = Date.now();
  const letterLog = log.child({ letterId });

  letterLog.debug('Starting metadata extraction pipeline');

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
    await updateMetadataStatus(letterId, 'FAILED', undefined, 'Max attempts exceeded');
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
  await updateMetadataStatus(letterId, 'RUNNING');

  try {
    const result = await extractMetadata({
      transcriptionText: letter.transcriptionText,
      context: {
        collectionCode: letter.collection.collectionCode,
        dateRaw: letter.dateRaw,
        dateFromFilename: letter.letterDate,
      },
    });

    // Update letter with metadata
    await updateMetadataStatus(
      letterId,
      'SUCCESS',
      {
        sender: result.sender,
        recipient: result.recipient,
        locationWritten: result.locationWritten,
        hook: result.hook,
        summary: result.summary,
        tags: result.tags,
        extractedDate: result.extractedDate,
        extractedDateConfidence: result.extractedDateConfidence,
        metadataJson: result,
      },
      null
    );

    await updateLetterWorkflow(letterId, 'METADATA_DRAFTED');

    const duration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration,
        attemptNumber,
        hasSender: !!result.sender,
        hasRecipient: !!result.recipient,
        hasHook: !!result.hook,
        hasSummary: !!result.summary,
        tagCount: result.tags.length,
        hasExtractedDate: !!result.extractedDate,
        dateConfidence: result.extractedDateConfidence,
      },
      'Metadata extraction pipeline completed successfully'
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
      'Metadata extraction pipeline failed'
    );

    await updateMetadataStatus(letterId, 'FAILED', undefined, message);
    throw error;
  }
}
