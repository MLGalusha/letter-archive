import { transcribeImage } from '../ai/openai.js';
import { getLetterWithPages, updateTranscriptionStatus, updateLetterWorkflow, incrementTranscriptionAttempts } from '../services/letters.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'transcription-pipeline' });
const MAX_ATTEMPTS = 3;

/**
 * Runs transcription for a letter.
 * - Only processes type='L' letters
 * - Transcribes each page in order
 * - Combines into a single transcription
 */
export async function runTranscription(letterId: string): Promise<void> {
  const start = Date.now();
  const letterLog = log.child({ letterId });

  letterLog.debug('Starting transcription pipeline');

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

  // Only transcribe type='L' letters
  if (letter.type !== 'L') {
    letterLog.debug({ type: letter.type }, 'Skipping transcription for non-letter type');
    return;
  }

  // Check attempt count
  if (letter.transcriptionAttemptCount >= MAX_ATTEMPTS) {
    letterLog.warn(
      { attemptCount: letter.transcriptionAttemptCount, maxAttempts: MAX_ATTEMPTS },
      'Max transcription attempts reached'
    );
    await updateTranscriptionStatus(letterId, 'FAILED', null, 'Max attempts exceeded');
    return;
  }

  // Increment attempt count
  const attemptNumber = letter.transcriptionAttemptCount + 1;
  await incrementTranscriptionAttempts(letterId);
  letterLog.info({ attemptNumber, maxAttempts: MAX_ATTEMPTS }, 'Starting transcription attempt');

  // Update status to running
  await updateLetterWorkflow(letterId, 'TRANSCRIBING');
  await updateTranscriptionStatus(letterId, 'RUNNING');

  try {
    const pages = letter.pages;

    if (pages.length === 0) {
      letterLog.error('Letter has no pages to transcribe');
      throw new Error('Letter has no pages to transcribe');
    }

    letterLog.debug({ pageCount: pages.length }, 'Processing pages');

    const pageTranscriptions: string[] = [];
    let stubMode = false;

    // Transcribe each page
    for (const page of pages) {
      const pageStart = Date.now();
      letterLog.debug(
        { pageNumber: page.pageNumber, totalPages: pages.length },
        'Transcribing page'
      );

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
      stubMode = result.isStub;

      const pageDuration = Date.now() - pageStart;
      letterLog.debug(
        {
          pageNumber: page.pageNumber,
          textLength: result.text.length,
          duration: pageDuration,
          isStub: result.isStub,
        },
        'Page transcription completed'
      );
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

    const duration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration,
        pageCount: pages.length,
        totalTextLength: combinedTranscription.length,
        stubMode,
        attemptNumber,
      },
      'Transcription pipeline completed successfully'
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
      'Transcription pipeline failed'
    );

    await updateTranscriptionStatus(letterId, 'FAILED', null, message);
    // Don't update workflow to FAILED here - let it stay at TRANSCRIBING so retries can work
    throw error;
  }
}
