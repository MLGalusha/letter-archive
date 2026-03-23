import { runTranscription } from './transcription.js';
import { runMetadataExtraction } from './metadata.js';
import { runMetadataExtractionV2 } from './metadataV2.js';
import { getLetterById } from '../services/letters.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'processor' });

/**
 * Processes a letter through the transcription phase only.
 * Metadata extraction is triggered separately after transcript confirmation.
 *
 * Only processes type='L' letters.
 */
export async function processLetter(letterId: string): Promise<void> {
  const letter = await getLetterById(letterId);

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  // Only process type='L' letters
  if (letter.type !== 'L') {
    log.debug({ letterId, letterType: letter.type }, 'Skipping non-letter type');
    return;
  }

  log.info({ letterId, workflow: letter.workflow }, 'Processing letter');

  // Phase 1: Transcription
  if (letter.workflow === 'UPLOADED' && letter.transcriptionStatus === 'PENDING') {
    await runTranscription(letterId);
    // After transcription, letter stays in TRANSCRIBED state
    // Metadata extraction requires transcript confirmation first
  }
}

/**
 * Processes metadata extraction for a letter that has confirmed transcript.
 * Called by worker after transcript is confirmed.
 */
export async function processMetadata(letterId: string): Promise<void> {
  const letter = await getLetterById(letterId);

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  if (letter.type !== 'L') {
    log.debug({ letterId, letterType: letter.type }, 'Skipping metadata for non-letter type');
    return;
  }

  // Only process if workflow is TRANSCRIBED and metadata is pending
  // Note: transcriptConfirmedAt check is handled by the calling endpoint,
  // which may allow bypassing confirmation with user approval
  if (
    letter.workflow === 'TRANSCRIBED' &&
    letter.metadataStatus === 'PENDING'
  ) {
    log.info({ letterId }, 'Processing metadata');
    // Use V2 extraction (Responses API with structured outputs)
    await runMetadataExtractionV2(letterId);
  }
}

export { runTranscription } from './transcription.js';
export { runMetadataExtraction } from './metadata.js';
export { runMetadataExtractionV2 } from './metadataV2.js';
