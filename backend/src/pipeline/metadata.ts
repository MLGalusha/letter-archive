import { extractMetadata } from '../ai/openai.js';
import {
  getLetterWithPages,
  updateMetadataStatus,
  updateLetterWorkflow,
  incrementMetadataAttempts,
} from '../services/letters.js';

const MAX_ATTEMPTS = 3;

/**
 * Runs metadata extraction for a letter.
 * - Only processes type='L' letters that have been transcribed
 * - Extracts sender, recipient, location, summary, tags, date
 */
export async function runMetadataExtraction(letterId: string): Promise<void> {
  const letter = await getLetterWithPages(letterId);

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  // Only extract metadata for type='L' letters
  if (letter.type !== 'L') {
    console.log(`Skipping metadata extraction for non-letter type: ${letter.type}`);
    return;
  }

  // Must have transcription
  if (!letter.transcriptionText) {
    throw new Error(`Letter ${letterId} has no transcription text`);
  }

  // Check attempt count
  if (letter.metadataAttemptCount >= MAX_ATTEMPTS) {
    console.log(`Max attempts (${MAX_ATTEMPTS}) reached for metadata extraction on letter ${letterId}`);
    await updateMetadataStatus(letterId, 'FAILED', undefined, 'Max attempts exceeded');
    return;
  }

  // Increment attempt count
  await incrementMetadataAttempts(letterId);

  // Update status to running
  await updateLetterWorkflow(letterId, 'METADATA_EXTRACTING');
  await updateMetadataStatus(letterId, 'RUNNING');

  try {
    console.log(`Extracting metadata for letter ${letterId}`);

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

    console.log(`Metadata extraction complete for letter ${letterId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Metadata extraction failed for letter ${letterId}: ${message}`);

    await updateMetadataStatus(letterId, 'FAILED', undefined, message);
    throw error;
  }
}
