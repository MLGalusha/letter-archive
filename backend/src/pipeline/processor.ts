import { runTranscription, type TranscriptionRunOutcome } from './transcription.js';
import {
  runMetadataExtractionV2,
  type MetadataRunOutcome,
} from './metadataV2.js';
import { getLetterById } from '../services/letters.js';
import { isTranscribableType } from '../services/letter/shared.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'processor' });

export type SkippedTranscriptionReason = Exclude<
  TranscriptionRunOutcome,
  { kind: 'completed' }
>['kind'];
export type ProcessLetterOutcome =
  | void
  | { kind: 'skipped'; reason: SkippedTranscriptionReason };
export type SkippedMetadataReason = Exclude<
  MetadataRunOutcome,
  { kind: 'completed' }
>['kind'];
export type ProcessMetadataOutcome =
  | void
  | { kind: 'skipped'; reason: SkippedMetadataReason };

/**
 * Processes a letter through the transcription phase only.
 * Metadata extraction is triggered separately after transcript confirmation.
 *
 * Supports all transcribable types (L, T, C, E, N, A, D). Excludes P (Photo) and V (Voice).
 */
export async function processLetter(letterId: string): Promise<ProcessLetterOutcome> {
  const letter = await getLetterById(letterId);

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  if (!isTranscribableType(letter.type)) {
    log.debug({ letterId, letterType: letter.type }, 'Skipping non-transcribable type');
    return { kind: 'skipped', reason: 'ineligible' };
  }

  log.info({ letterId, workflow: letter.workflow }, 'Processing letter');

  // Phase 1: Transcription
  if (letter.workflow === 'UPLOADED' && letter.transcriptionStatus === 'PENDING') {
    const outcome = await runTranscription(letterId);
    if (outcome.kind !== 'completed') {
      return { kind: 'skipped', reason: outcome.kind };
    }
    // After transcription, letter stays in TRANSCRIBED state
    // Metadata extraction requires transcript confirmation first
    return;
  }

  return { kind: 'skipped', reason: 'ineligible' };
}

/**
 * Processes metadata extraction for a letter that has confirmed transcript.
 * Called by worker after transcript is confirmed.
 */
export async function processMetadata(letterId: string): Promise<ProcessMetadataOutcome> {
  const letter = await getLetterById(letterId);

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  if (!isTranscribableType(letter.type)) {
    log.debug({ letterId, letterType: letter.type }, 'Skipping metadata for non-transcribable type');
    return { kind: 'skipped', reason: 'ineligible' };
  }

  // Only process if workflow is TRANSCRIBED and metadata is pending
  // Note: transcriptConfirmedAt check is handled by the calling endpoint,
  // which may allow bypassing confirmation with user approval
  if (
    letter.workflow === 'TRANSCRIBED' &&
    letter.metadataStatus === 'PENDING' &&
    letter.transcriptionStatus !== 'RUNNING'
  ) {
    log.info({ letterId }, 'Processing metadata');
    // The producer derives any pre-filled names from its post-claim reload so
    // this preflight snapshot cannot become stale before ownership is won.
    const outcome = await runMetadataExtractionV2(letterId);
    if (outcome.kind !== 'completed') {
      return { kind: 'skipped', reason: outcome.kind };
    }
    return;
  }

  return { kind: 'skipped', reason: 'ineligible' };
}

export { runTranscription } from './transcription.js';
export { runMetadataExtractionV2 } from './metadataV2.js';
