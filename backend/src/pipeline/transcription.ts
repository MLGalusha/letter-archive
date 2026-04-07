import { transcribeImage, transcribeExtraContent } from '../ai/openai.js';
import { getLetterWithPages, updateTranscriptionStatus, updateLetterWorkflow, incrementTranscriptionAttempts, claimJob } from '../services/letters.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { detectAndStoreLinesForPages } from '../services/line-finder.js';
import { createLogger } from '../utils/logger.js';
import { updateJobProgress, clearJobProgress, shouldAbortProcessing } from '../services/processing-queue.js';
import { isTranscribableType, getDocumentTypeFromCode } from '../services/letter/shared.js';
import { db, letters } from '../db/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import type { TranscriptLine, SpecialArea, StructuredTranscript } from '../ai/schemas/structuredTranscript.js';
import { generateReadingText } from '../utils/readingTextGenerator.js';

const log = createLogger({ module: 'transcription-pipeline' });

/** Max concurrent page transcriptions per letter */
const PAGE_CONCURRENCY = 3;

/**
 * Runs transcription for a letter or other transcribable document type.
 * - Supports all transcribable types (L, T, C, E, N, A, D)
 * - Excludes P (Photo) and V (Voice)
 * - For type 'L': uses standard letter transcription prompt, then auto-transcribes related extras
 * - For non-L types: uses specialized extra content prompt, stores in transcriptionText
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

  if (!isTranscribableType(letter.type)) {
    letterLog.debug({ type: letter.type }, 'Skipping transcription for non-transcribable type');
    return;
  }

  letterLog.info({ type: letter.type }, 'Starting transcription');

  // Atomically claim the job — prevents worker and on-demand processing from double-running
  const claimed = await claimJob(letterId, 'transcriptionStatus', 'PENDING');
  if (!claimed) {
    letterLog.info('Transcription job already claimed by another process — skipping');
    return;
  }
  await updateLetterWorkflow(letterId, 'TRANSCRIBING');

  try {
    const pages = letter.pages;

    if (pages.length === 0) {
      letterLog.error('Letter has no pages to transcribe');
      throw new Error('Letter has no pages to transcribe');
    }

    letterLog.debug({ pageCount: pages.length }, 'Processing pages');

    const pageTranscriptions: string[] = [];
    const pageStructuredLines: (TranscriptLine[] | null)[] = [];
    const pageSpecialAreas: (SpecialArea[] | undefined)[] = [];
    let stubMode = false;

    if (letter.type === 'L') {
      // === LETTER TYPE: use standard transcription prompt ===
      // Process pages in parallel batches for speed, with abort checks between batches
      const results: { text: string; structured: TranscriptLine[] | null; specialAreas?: SpecialArea[] }[] = new Array(pages.length).fill(null);
      let completedCount = 0;

      for (let batchStart = 0; batchStart < pages.length; batchStart += PAGE_CONCURRENCY) {
        // Check for abort between batches
        if (shouldAbortProcessing()) {
          letterLog.info('Transcription aborted between page batches');
          throw new Error('Processing aborted');
        }

        const batch = pages.slice(batchStart, batchStart + PAGE_CONCURRENCY);

        await Promise.all(batch.map(async (page) => {
          const pageStart = Date.now();
          letterLog.debug(
            { pageNumber: page.pageNumber, totalPages: pages.length },
            'Transcribing page'
          );

          const absolutePath = getAbsoluteStoragePath(page.storagePath);

          const result = await transcribeImage({
            filePath: absolutePath,
            letterId,
            context: {
              collectionCode: letter.collection.collectionCode,
              dateRaw: letter.dateRaw,
              pageNumber: page.pageNumber,
              totalPages: pages.length,
            },
          });

          // Store at correct index to preserve page order
          results[page.pageNumber - 1] = { text: result.text, structured: result.structured, specialAreas: result.specialAreas };
          stubMode = result.isStub;
          completedCount++;

          updateJobProgress(letterId, 'transcription', completedCount, pages.length, `${completedCount} of ${pages.length} pages`);

          const pageDuration = Date.now() - pageStart;
          letterLog.debug(
            {
              pageNumber: page.pageNumber,
              textLength: result.text.length,
              hasStructured: result.structured !== null,
              duration: pageDuration,
              isStub: result.isStub,
            },
            'Page transcription completed'
          );
        }));
      }

      for (const r of results) {
        if (r !== null) {
          pageTranscriptions.push(r.text);
          pageStructuredLines.push(r.structured);
          pageSpecialAreas.push(r.specialAreas);
        }
      }
    } else {
      // === NON-LETTER TYPE: use extra content transcription prompt ===
      // Extra content processed sequentially (usually 1-2 pages, needs text-check first)
      const docType = getDocumentTypeFromCode(letter.type);

      for (const page of pages) {
        if (shouldAbortProcessing()) {
          letterLog.info('Extra content transcription aborted');
          throw new Error('Processing aborted');
        }

        const pageStart = Date.now();
        updateJobProgress(letterId, 'transcription', page.pageNumber - 1, pages.length, `Page ${page.pageNumber} of ${pages.length}`);

        const absolutePath = getAbsoluteStoragePath(page.storagePath);

        const result = await transcribeExtraContent({
          filePath: absolutePath,
          letterId,
          documentType: docType,
          context: {
            collectionCode: letter.collection.collectionCode,
            dateRaw: letter.dateRaw,
          },
        });

        if (result.text.trim()) {
          pageTranscriptions.push(result.text.replace(/^\n+|\n+$/g, ''));
        }
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
    }

    if (pageTranscriptions.length === 0) {
      letterLog.warn('No transcribable text found in any page');
      await db.update(letters).set({
        transcriptionText: null,
        transcriptionStatus: 'SUCCESS',
        transcriptionError: null,
        transcribedAt: new Date(),
        workflow: 'TRANSCRIBED',
        transcriptStatus: 'EMPTY',
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

      clearJobProgress(letterId, 'transcription');
      return;
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

    // Check if the job was cancelled while we were processing
    const currentState = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      columns: { transcriptionStatus: true },
    });
    if (currentState?.transcriptionStatus === 'FAILED') {
      letterLog.info('Transcription was cancelled during processing — discarding result');
      clearJobProgress(letterId, 'transcription');
      return;
    }

    // Build structured transcript if all pages have structured data
    let structuredTranscript: StructuredTranscript | null = null;
    if (letter.type === 'L' && pageStructuredLines.every((s) => s !== null)) {
      structuredTranscript = {
        pages: pageStructuredLines.map((lines, i) => ({
          pageNumber: i + 1,
          lines: lines!,
          specialAreas: pageSpecialAreas[i] ?? [],
        })),
      };
      letterLog.info(
        { pageCount: structuredTranscript.pages.length, totalLines: pageStructuredLines.reduce((sum, l) => sum + (l?.length ?? 0), 0) },
        'Built structured transcript',
      );
    } else if (letter.type === 'L' && pageStructuredLines.some((s) => s !== null)) {
      letterLog.warn('Some pages have structured data but not all — skipping structured transcript');
    }

    // Auto-generate reading text from structured data
    let readingText: string | null = null;
    if (structuredTranscript) {
      readingText = generateReadingText(structuredTranscript);
      letterLog.debug({ readingTextLength: readingText.length }, 'Auto-generated reading text from structured data');
    }

    // Update letter with transcription - all status updates in one operation
    // to avoid inconsistent state if the process crashes between updates
    await db.update(letters).set({
      transcriptionText: combinedTranscription,
      transcriptionJson: structuredTranscript,
      ...(readingText ? { readingText } : {}),
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

    // === Automatically transcribe extra content (T, C, E types) — only for type 'L' ===
    let extrasTranscribed = 0;
    if (letter.type === 'L') {
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

          // Process in image order: supplementary items first, covers (C) last
          const orderedItems = [
            ...relatedItems.filter((i) => i.type !== 'C'),
            ...relatedItems.filter((i) => i.type === 'C'),
          ];

          for (const item of orderedItems) {
            const docType = getDocumentTypeFromCode(item.type);
            typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
            const typeIndex = typeCounters[item.type];

            for (const page of item.pages) {
              const filePath = getAbsoluteStoragePath(page.storagePath);

              const transcription = await transcribeExtraContent({
                filePath,
                letterId,
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
                  text: transcription.text.replace(/^\n+|\n+$/g, ''),
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

        err: error,
      },
      'Transcription pipeline failed'
    );

    await updateTranscriptionStatus(letterId, 'FAILED', null, message);
    // Don't update workflow to FAILED here - let it stay at TRANSCRIBING so retries can work
    throw error;
  }
}
