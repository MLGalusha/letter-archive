import { transcribeImage } from '../ai/openai.js';
import { getLetterWithPages, updateTranscriptionStatus, updateLetterWorkflow, incrementTranscriptionAttempts } from '../services/letters.js';
import { getAbsoluteStoragePath } from '../services/storage.js';

const MAX_ATTEMPTS = 3;

/**
 * Runs transcription for a letter.
 * - Only processes type='L' letters
 * - Transcribes each page in order
 * - Combines into a single transcription
 */
export async function runTranscription(letterId: string): Promise<void> {
  const letter = await getLetterWithPages(letterId);

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  // Only transcribe type='L' letters
  if (letter.type !== 'L') {
    console.log(`Skipping transcription for non-letter type: ${letter.type}`);
    return;
  }

  // Check attempt count
  if (letter.transcriptionAttemptCount >= MAX_ATTEMPTS) {
    console.log(`Max attempts (${MAX_ATTEMPTS}) reached for letter ${letterId}`);
    await updateTranscriptionStatus(letterId, 'FAILED', null, 'Max attempts exceeded');
    return;
  }

  // Increment attempt count
  await incrementTranscriptionAttempts(letterId);

  // Update status to running
  await updateLetterWorkflow(letterId, 'TRANSCRIBING');
  await updateTranscriptionStatus(letterId, 'RUNNING');

  try {
    const pages = letter.pages;

    if (pages.length === 0) {
      throw new Error('Letter has no pages to transcribe');
    }

    const pageTranscriptions: string[] = [];

    // Transcribe each page
    for (const page of pages) {
      console.log(`Transcribing page ${page.pageNumber} of letter ${letterId}`);

      const absolutePath = getAbsoluteStoragePath(page.storagePath);

      const result = await transcribeImage({
        filePath: absolutePath,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
          pageNumber: page.pageNumber,
          totalPages: pages.length,
        },
      });

      pageTranscriptions.push(result.text);

      if (result.isStub) {
        console.log(`  (Using stub transcription - no API key)`);
      }
    }

    // Combine transcriptions with page separators
    let combinedTranscription: string;
    if (pageTranscriptions.length === 1) {
      combinedTranscription = pageTranscriptions[0];
    } else {
      combinedTranscription = pageTranscriptions
        .map((text, i) => `--- Page ${i + 1} ---\n\n${text}`)
        .join('\n\n');
    }

    // Update letter with transcription
    await updateTranscriptionStatus(letterId, 'SUCCESS', combinedTranscription, null);
    await updateLetterWorkflow(letterId, 'TRANSCRIBED');

    console.log(`Transcription complete for letter ${letterId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Transcription failed for letter ${letterId}: ${message}`);

    await updateTranscriptionStatus(letterId, 'FAILED', null, message);
    // Don't update workflow to FAILED here - let it stay at TRANSCRIBING so retries can work
    throw error;
  }
}
