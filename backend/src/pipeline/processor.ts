import { runTranscription } from './transcription.js';
import { runMetadataExtraction } from './metadata.js';
import { getLetterById } from '../services/letters.js';

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
    console.log(`Skipping processing for non-letter type: ${letter.type}`);
    return;
  }

  console.log(`Processing letter ${letterId} (workflow: ${letter.workflow})`);

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
    console.log(`Skipping metadata for non-letter type: ${letter.type}`);
    return;
  }

  // Only process if transcript is confirmed and metadata is pending
  if (
    letter.workflow === 'TRANSCRIBED' &&
    letter.metadataStatus === 'PENDING' &&
    letter.transcriptConfirmedAt !== null
  ) {
    console.log(`Processing metadata for letter ${letterId}`);
    await runMetadataExtraction(letterId);
  }
}

export { runTranscription } from './transcription.js';
export { runMetadataExtraction } from './metadata.js';
