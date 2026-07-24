import { transcribeExtraContent, transcribeImage } from '../ai/openai.js';
import { getLetterWithPages } from '../services/letters.js';
import {
  claimQueuedTranscription,
  claimRequestedTranscription,
  completeTranscription,
  failTranscription,
  observeTranscriptionState,
  withTranscriptionHeartbeat,
  type TranscriptionHeartbeat,
} from '../services/letter/transcription-job.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { createLogger } from '../utils/logger.js';
import {
  clearJobProgress,
  shouldAbortProcessing,
  updateJobProgress,
} from '../services/processes/runner.js';
import { getDocumentTypeFromCode, isTranscribableType } from '../services/letter/shared.js';
import { runAutomaticExtraContent } from '../services/letter/extra-content.js';

const log = createLogger({ module: 'transcription-pipeline' });

/** Max concurrent page transcriptions per letter. */
const PAGE_CONCURRENCY = 3;

export interface TranscriptionOptions {
  extraContent?: 'automatic' | 'skip';
}

type ClaimedTranscriptionOutcome =
  | { kind: 'completed'; pageCount: number; textLength: number }
  | { kind: 'superseded' };

export type TranscriptionRunOutcome =
  | ClaimedTranscriptionOutcome
  | { kind: 'claim_lost' }
  | { kind: 'ineligible' };

export type RequestedTranscriptionOutcome =
  | Exclude<TranscriptionRunOutcome, { kind: 'ineligible' }>
  | { kind: 'not_found' }
  | { kind: 'not_transcribable'; type: string }
  | { kind: 'no_pages' };

type TranscriptionLetter = NonNullable<Awaited<ReturnType<typeof getLetterWithPages>>>;

/**
 * Runs the one canonical transcription producer after its caller has acquired the
 * run-ID claim. Publication and failure are conditional on that exact attempt still
 * owning the row; a lost terminal compare-and-swap is reported as superseded.
 */
async function executeClaimedTranscription(
  letter: TranscriptionLetter,
  runId: string,
  options: TranscriptionOptions,
  heartbeat: TranscriptionHeartbeat,
): Promise<ClaimedTranscriptionOutcome> {
  const start = Date.now();
  const { id: letterId } = letter;
  const letterLog = log.child({ letterId });
  const context = {
    letterId,
    collectionCode: letter.collection.collectionCode,
    dateRaw: letter.dateRaw,
    type: letter.type,
  };

  letterLog.info({ type: letter.type }, 'Starting transcription');

  try {
    const pages = letter.pages;

    if (pages.length === 0) {
      letterLog.error('Letter has no pages to transcribe');
      throw new Error('Letter has no pages to transcribe');
    }

    letterLog.debug({ pageCount: pages.length }, 'Processing pages');

    const pageTranscriptions: string[] = [];
    let stubMode = false;

    const stopIfLeaseLost = (): ClaimedTranscriptionOutcome | null => {
      if (heartbeat.hasOwnership()) return null;
      letterLog.info('Transcription lease was lost; discarding unfinished result');
      clearJobProgress(letterId, 'transcription');
      return { kind: 'superseded' };
    };

    const initialLeaseLoss = stopIfLeaseLost();
    if (initialLeaseLoss) return initialLeaseLoss;

    if (letter.type === 'L') {
      const results: Array<{ text: string } | null> = new Array(pages.length).fill(null);
      let completedCount = 0;

      for (let batchStart = 0; batchStart < pages.length; batchStart += PAGE_CONCURRENCY) {
        const leaseLoss = stopIfLeaseLost();
        if (leaseLoss) return leaseLoss;

        if (shouldAbortProcessing()) {
          letterLog.info('Transcription aborted between page batches');
          throw new Error('Processing aborted');
        }

        const batch = pages.slice(batchStart, batchStart + PAGE_CONCURRENCY);

        await Promise.all(batch.map(async (page, batchOffset) => {
          const pageStart = Date.now();
          letterLog.debug(
            { pageNumber: page.pageNumber, totalPages: pages.length },
            'Transcribing page',
          );

          const result = await transcribeImage({
            filePath: getAbsoluteStoragePath(page.storagePath),
            letterId,
            context: {
              collectionCode: letter.collection.collectionCode,
              dateRaw: letter.dateRaw,
              pageNumber: page.pageNumber,
              totalPages: pages.length,
            },
          });

          results[batchStart + batchOffset] = { text: result.text };
          stubMode = result.isStub;
          completedCount += 1;

          updateJobProgress(
            letterId,
            'transcription',
            completedCount,
            pages.length,
            `${completedCount} of ${pages.length} pages`,
          );

          letterLog.debug(
            {
              pageNumber: page.pageNumber,
              textLength: result.text.length,
              duration: Date.now() - pageStart,
              isStub: result.isStub,
            },
            'Page transcription completed',
          );
        }));

        const postBatchLeaseLoss = stopIfLeaseLost();
        if (postBatchLeaseLoss) return postBatchLeaseLoss;
      }

      for (const result of results) {
        if (result !== null) pageTranscriptions.push(result.text);
      }
    } else {
      const documentType = getDocumentTypeFromCode(letter.type);

      for (const page of pages) {
        const leaseLoss = stopIfLeaseLost();
        if (leaseLoss) return leaseLoss;

        if (shouldAbortProcessing()) {
          letterLog.info('Extra content transcription aborted');
          throw new Error('Processing aborted');
        }

        const pageStart = Date.now();
        updateJobProgress(
          letterId,
          'transcription',
          page.pageNumber - 1,
          pages.length,
          `Page ${page.pageNumber} of ${pages.length}`,
        );

        const result = await transcribeExtraContent({
          filePath: getAbsoluteStoragePath(page.storagePath),
          letterId,
          documentType,
          context: {
            collectionCode: letter.collection.collectionCode,
            dateRaw: letter.dateRaw,
          },
        });

        if (result.text.trim()) {
          pageTranscriptions.push(result.text.replace(/^\n+|\n+$/g, ''));
        }
        stubMode = result.isStub;

        updateJobProgress(
          letterId,
          'transcription',
          page.pageNumber,
          pages.length,
          `Page ${page.pageNumber} of ${pages.length}`,
        );

        letterLog.debug(
          {
            pageNumber: page.pageNumber,
            textLength: result.text.length,
            duration: Date.now() - pageStart,
            isStub: result.isStub,
          },
          'Page transcription completed',
        );

        const postPageLeaseLoss = stopIfLeaseLost();
        if (postPageLeaseLoss) return postPageLeaseLoss;
      }
    }

    const combinedTranscription = pageTranscriptions.length === 0
      ? null
      : pageTranscriptions.length === 1
        ? pageTranscriptions[0]
        : pageTranscriptions
          .map((text, index) => `--- Page ${index + 1} ---\n\n${text}`)
          .join('\n\n');

    if (combinedTranscription === null) {
      letterLog.warn('No transcribable text found in any page');
    }

    const terminalLeaseLoss = stopIfLeaseLost();
    if (terminalLeaseLoss) return terminalLeaseLoss;

    const published = await completeTranscription(letterId, runId, combinedTranscription);
    if (!published) {
      letterLog.info('Transcription was cancelled or superseded; discarding result');
      clearJobProgress(letterId, 'transcription');
      return { kind: 'superseded' };
    }

    let extrasTranscribed = 0;
    if (letter.type === 'L' && options.extraContent !== 'skip') {
      try {
        const extraJob = await runAutomaticExtraContent(letterId);
        if (extraJob.kind === 'completed') {
          extrasTranscribed = extraJob.value;
          letterLog.info({ extrasTranscribed }, 'Extra content transcription completed');
        } else if (extraJob.kind === 'claim_lost' || extraJob.kind === 'superseded') {
          letterLog.info(
            { outcome: extraJob.kind },
            'Extra content job not owned; skipping automatic transcription',
          );
        }
      } catch (extrasError) {
        letterLog.warn({ err: extrasError }, 'Failed to transcribe extra content - continuing');
      }
    }

    clearJobProgress(letterId, 'transcription');

    const textLength = combinedTranscription?.length ?? 0;
    letterLog.info(
      {
        ...context,
        duration: Date.now() - start,
        pageCount: pages.length,
        totalTextLength: textLength,
        stubMode,
        extrasTranscribed,
      },
      'Transcription pipeline completed successfully',
    );

    return {
      kind: 'completed',
      pageCount: pages.length,
      textLength,
    };
  } catch (error) {
    clearJobProgress(letterId, 'transcription');
    const message = error instanceof Error ? error.message : 'Unknown error';

    letterLog.error(
      {
        ...context,
        duration: Date.now() - start,
        err: error,
      },
      'Transcription pipeline failed',
    );

    const failed = await failTranscription(letterId, runId, message);
    if (!failed) {
      letterLog.info('Transcription failure was superseded; preserving newer state');
      return { kind: 'superseded' };
    }
    throw error;
  }
}

async function runClaimedTranscription(
  letterId: string,
  runId: string,
  options: TranscriptionOptions,
): Promise<ClaimedTranscriptionOutcome> {
  return withTranscriptionHeartbeat(letterId, runId, async (heartbeat) => {
    const claimedLetter = await reloadClaimedTranscription(letterId, runId);
    if ('kind' in claimedLetter) return claimedLetter;
    if (!heartbeat.hasOwnership()) return { kind: 'superseded' };
    return executeClaimedTranscription(claimedLetter, runId, options, heartbeat);
  });
}

async function reloadClaimedTranscription(
  letterId: string,
  runId: string,
): Promise<TranscriptionLetter | { kind: 'superseded' }> {
  const claimedLetter = await getLetterWithPages(letterId);
  if (claimedLetter) return claimedLetter;

  const error = new Error(`Letter disappeared after transcription claim: ${letterId}`);
  const failed = await failTranscription(letterId, runId, error.message);
  if (!failed) return { kind: 'superseded' };
  throw error;
}

/** Claims and runs normal PENDING queue work. */
export async function runTranscription(
  letterId: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionRunOutcome> {
  const letterLog = log.child({ letterId });
  letterLog.debug('Starting transcription pipeline');

  const letter = await getLetterWithPages(letterId);
  if (!letter) {
    letterLog.error('Letter not found');
    throw new Error(`Letter not found: ${letterId}`);
  }

  if (!isTranscribableType(letter.type)) {
    letterLog.debug({ type: letter.type }, 'Skipping transcription for non-transcribable type');
    return { kind: 'ineligible' };
  }

  const claim = await claimQueuedTranscription(letterId, observeTranscriptionState(letter));
  if (!claim) {
    letterLog.info('Transcription job already claimed by another process — skipping');
    return { kind: 'claim_lost' };
  }

  return runClaimedTranscription(letterId, claim.runId, options);
}

/**
 * Validates, atomically claims, and runs synchronous admin-requested transcription.
 * The default explicitly excludes automatic extras; regeneration owns that optional
 * follow-up as a separate claimed job.
 */
export async function runRequestedTranscription(
  letterId: string,
): Promise<RequestedTranscriptionOutcome> {
  const letter = await getLetterWithPages(letterId);
  if (!letter) return { kind: 'not_found' };
  if (!isTranscribableType(letter.type)) {
    return { kind: 'not_transcribable', type: letter.type };
  }
  if (letter.pages.length === 0) return { kind: 'no_pages' };

  const claim = await claimRequestedTranscription(letterId, observeTranscriptionState(letter));
  if (!claim) return { kind: 'claim_lost' };

  return runClaimedTranscription(letterId, claim.runId, { extraContent: 'skip' });
}
