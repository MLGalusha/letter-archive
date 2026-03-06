import { transcribeImage, checkExtraContentForText, transcribeExtraContent } from '../ai/openai.js';
import { getLetterWithPages, updateTranscriptionStatus, updateLetterWorkflow, incrementTranscriptionAttempts } from '../services/letters.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { detectAndStoreLinesForPages } from '../services/line-finder.js';
import { createLogger } from '../utils/logger.js';
import { updateJobProgress, clearJobProgress } from '../services/processing-queue.js';
import { db, letters } from '../db/index.js';
import { eq, and, inArray } from 'drizzle-orm';

const log = createLogger({ module: 'transcription-pipeline' });
const MAX_ATTEMPTS = 3;

/**
 * Map letter type codes to human-readable document types for transcription
 */
function getDocumentTypeFromCode(type: string): string {
  switch (type) {
    case 'T':
      return 'telegram';
    case 'C':
      return 'cover/envelope';
    case 'E':
      return 'ephemera';
    default:
      return 'document';
  }
}

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
      updateJobProgress(letterId, 'transcription', page.pageNumber - 1, pages.length, `Page ${page.pageNumber} of ${pages.length}`);
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

      updateJobProgress(letterId, 'transcription', page.pageNumber, pages.length, `Page ${page.pageNumber} of ${pages.length}`);

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

    // Update letter with transcription - all status updates in one operation
    // to avoid inconsistent state if the process crashes between updates
    await db.update(letters).set({
      transcriptionText: combinedTranscription,
      transcriptionStatus: 'SUCCESS',
      transcriptionError: null,
      transcribedAt: new Date(),
      workflow: 'TRANSCRIBED',
      transcriptStatus: 'AI_DRAFT',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    try {
      await detectAndStoreLinesForPages(pages, getAbsoluteStoragePath);
    } catch (lineError) {
      letterLog.warn({ err: lineError }, 'Failed to store line detection results - continuing');
    }

    // === Automatically transcribe extra content (T, C, E types) ===
    let extrasTranscribed = 0;
    try {
      const relatedItems = await db.query.letters.findMany({
        where: and(
          eq(letters.collectionId, letter.collectionId),
          eq(letters.dateRaw, letter.dateRaw),
          eq(letters.typeSequence, letter.typeSequence),
          inArray(letters.type, ['T', 'C', 'E'])
        ),
        with: {
          pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
        },
        orderBy: (l, { asc }) => [asc(l.type)],
      });

      if (relatedItems.length > 0) {
        letterLog.debug({ relatedCount: relatedItems.length }, 'Found related extra content items');

        const typeCounters: Record<string, number> = {};
        const transcriptions: { type: string; index: number; text: string }[] = [];

        for (const item of relatedItems) {
          const docType = getDocumentTypeFromCode(item.type);
          typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
          const typeIndex = typeCounters[item.type];

          for (const page of item.pages) {
            const filePath = getAbsoluteStoragePath(page.storagePath);

            const checkResult = await checkExtraContentForText({
              filePath,
              documentType: docType,
            });

            if (!checkResult.hasTranscribableText) {
              letterLog.debug({ docType, reason: checkResult.reason }, 'Skipping extra - no transcribable text');
              continue;
            }

            const transcription = await transcribeExtraContent({
              filePath,
              documentType: docType,
              context: {
                collectionCode: letter.collection.collectionCode,
                dateRaw: letter.dateRaw,
              },
            });

            if (transcription.text.trim()) {
              transcriptions.push({
                type: docType,
                index: typeIndex,
                text: transcription.text.trim(),
              });
              extrasTranscribed++;
            }
          }
        }

        // Combine transcriptions with headers
        let combinedExtraContent = '';
        if (transcriptions.length > 0) {
          combinedExtraContent = transcriptions
            .map((t) => {
              const header = `--- ${t.type.charAt(0).toUpperCase() + t.type.slice(1)} ${t.index} ---`;
              return `${header}\n\n${t.text}`;
            })
            .join('\n\n');
        }

        // Update letter with extra content
        await db.update(letters).set({
          extraContentTranscript: combinedExtraContent || null,
          extraContentStatus: combinedExtraContent ? 'AI_DRAFT' : 'EMPTY',
          extraContentVerifiedAt: null,
          extraContentVerifiedBy: null,
          updatedAt: new Date(),
        }).where(eq(letters.id, letterId));

        letterLog.info({ extrasTranscribed }, 'Extra content transcription completed');
      }
    } catch (extrasError) {
      // Log but don't fail the whole transcription if extras fail
      letterLog.warn({ err: extrasError }, 'Failed to transcribe extra content - continuing');
    }

    clearJobProgress(letterId, 'transcription');

    const duration = Date.now() - start;
    letterLog.info(
      {
        ...context,
        duration,
        pageCount: pages.length,
        totalTextLength: combinedTranscription.length,
        stubMode,
        attemptNumber,
        extrasTranscribed,
      },
      'Transcription pipeline completed successfully'
    );
  } catch (error) {
    clearJobProgress(letterId, 'transcription');
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
