import { runTranscription } from './transcription.js';
import { runMetadataExtraction } from './metadata.js';
import { getLetterById } from '../services/letters.js';

/**
 * Processes a letter through the full pipeline:
 * 1. Transcription (if pending)
 * 2. Metadata extraction (if transcribed)
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

    // Refresh letter state
    const updated = await getLetterById(letterId);
    if (!updated || updated.transcriptionStatus !== 'SUCCESS') {
      return; // Stop if transcription failed
    }
  }

  // Phase 2: Metadata extraction
  const currentLetter = await getLetterById(letterId);
  if (
    currentLetter &&
    currentLetter.workflow === 'TRANSCRIBED' &&
    currentLetter.metadataStatus === 'PENDING'
  ) {
    await runMetadataExtraction(letterId);
  }
}

export { runTranscription } from './transcription.js';
export { runMetadataExtraction } from './metadata.js';
