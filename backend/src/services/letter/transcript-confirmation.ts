import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import {
  collections,
  db,
  letters,
  type Database,
  type JobStatus,
  type LetterType,
} from '../../db/index.js';
import {
  buildMetadataConfirmationGuidanceEnvelope,
  confirmationIntentIdentity,
  metadataInputIdentity,
  normalizeConfirmationGuidance,
  transcriptDigest,
  type NormalizedConfirmationGuidance,
} from './metadata-input-identity.js';
import {
  sourceRevisionChanged,
} from './source-revision.js';
import { clearedEntityExtractionOwnership } from './entity-extraction-job.js';
import { lockCorrespondenceGroupByLetterId } from './correspondence-group.js';
import {
  AppError,
  BadRequestError,
  NotFoundError,
} from '../../utils/response-helpers.js';

export const TRANSCRIPT_DIGEST_CHANGED_ERROR_CODE =
  'TRANSCRIPT_DIGEST_CHANGED';
export const TRANSCRIPT_CONFIRMATION_INTENT_CHANGED_ERROR_CODE =
  'TRANSCRIPT_CONFIRMATION_INTENT_CHANGED';
export const LEGACY_TRANSCRIPT_CONFIRMATION_ERROR_CODE =
  'LEGACY_TRANSCRIPT_CONFIRMATION';
export const TRANSCRIPT_CONFIRMATION_EXTRA_CONTENT_PENDING_ERROR_CODE =
  'TRANSCRIPT_CONFIRMATION_EXTRA_CONTENT_PENDING';

export type MetadataDisposition =
  | 'queued'
  | 'already_running'
  | 'already_available'
  | 'failed'
  | 'not_applicable';

export interface TranscriptConfirmationReceipt {
  confirmationId: string;
  confirmedAt: string;
  confirmedBy: string | null;
  transcriptSource: {
    primarySourceRevision: number;
    transcriptDigest: string;
  };
  metadataInputIdentity: string | null;
  intentIdentity: string;
  metadataDisposition: MetadataDisposition;
}

export interface ConfirmTranscriptIntentInput {
  letterId: string;
  expectedPrimarySourceRevision: number;
  expectedTranscriptDigest: string;
  confirmedBy: string;
  guidance?: unknown;
}

export interface ConfirmTranscriptIntentResult {
  receipt: TranscriptConfirmationReceipt;
  newlyQueued: boolean;
}

type TranscriptConfirmationDatabase = Pick<Database, 'transaction'>;

function dispositionFor(
  type: LetterType,
  metadataStatus: JobStatus,
): MetadataDisposition {
  if (type !== 'L') return 'not_applicable';
  switch (metadataStatus) {
    case 'PENDING':
      return 'queued';
    case 'RUNNING':
      return 'already_running';
    case 'SUCCESS':
      return 'already_available';
    case 'FAILED':
      return 'failed';
  }
}

/**
 * Commits one exact transcript-confirmation intent without invoking a provider.
 *
 * The correspondence lock makes same/different-intent concurrency and related
 * supplementary membership explicit. Everything after this function—including
 * the worker wake and optional DTO hydration—is advisory and cannot
 * retroactively turn the receipt into a failed write.
 */
export async function confirmTranscriptIntent(
  input: ConfirmTranscriptIntentInput,
  database: TranscriptConfirmationDatabase = db,
): Promise<ConfirmTranscriptIntentResult> {
  let guidance: NormalizedConfirmationGuidance;
  try {
    guidance = normalizeConfirmationGuidance(input.guidance);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestError(
        'Invalid transcript confirmation guidance',
        error.issues,
      );
    }
    throw error;
  }

  return database.transaction(async (tx) => {
    const group = await lockCorrespondenceGroupByLetterId(input.letterId, tx);
    if (!group) {
      throw new NotFoundError('Letter not found');
    }

    const rows = await tx
      .select({
        id: letters.id,
        type: letters.type,
        collectionCode: collections.collectionCode,
        dateRaw: letters.dateRaw,
        letterDate: letters.letterDate,
        workflow: letters.workflow,
        primarySourceRevision: letters.primarySourceRevision,
        transcriptionStatus: letters.transcriptionStatus,
        transcriptionText: letters.transcriptionText,
        transcriptConfirmedAt: letters.transcriptConfirmedAt,
        transcriptConfirmedBy: letters.transcriptConfirmedBy,
        transcriptConfirmationId: letters.transcriptConfirmationId,
        transcriptConfirmationIntentHash:
          letters.transcriptConfirmationIntentHash,
        transcriptConfirmationSourceRevision:
          letters.transcriptConfirmationSourceRevision,
        transcriptConfirmationTranscriptDigest:
          letters.transcriptConfirmationTranscriptDigest,
        extraContentTranscript: letters.extraContentTranscript,
        extraContentStatus: letters.extraContentStatus,
        extraContentJobStatus: letters.extraContentJobStatus,
        metadataStatus: letters.metadataStatus,
        entityExtractionStatus: letters.entityExtractionStatus,
      })
      .from(letters)
      .innerJoin(collections, eq(collections.id, letters.collectionId))
      .where(eq(letters.id, input.letterId))
      .for('update');
    const letter = rows[0];

    if (!letter) {
      throw new NotFoundError('Letter not found');
    }
    if (
      letter.primarySourceRevision
      !== input.expectedPrimarySourceRevision
    ) {
      throw sourceRevisionChanged(
        'Letter source changed; reload before confirming its transcript',
      );
    }

    const currentTranscriptDigest = transcriptDigest(
      letter.transcriptionText ?? '',
    );
    if (currentTranscriptDigest !== input.expectedTranscriptDigest) {
      throw new AppError(
        409,
        'Transcript changed; reload before confirming it',
        undefined,
        TRANSCRIPT_DIGEST_CHANGED_ERROR_CODE,
      );
    }

    const intentIdentity = confirmationIntentIdentity({
      letterId: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
      transcriptDigest: currentTranscriptDigest,
      guidance,
    });
    const currentMetadataInputIdentity = letter.type === 'L'
      ? metadataInputIdentity({
          letterId: letter.id,
          transcriptionText: letter.transcriptionText ?? '',
          collectionCode: letter.collectionCode,
          dateRaw: letter.dateRaw,
          letterDate: letter.letterDate,
          extraContentTranscript: letter.extraContentTranscript,
          extraContentStatus: letter.extraContentStatus,
          extraContentJobStatus: letter.extraContentJobStatus,
        })
      : null;

    if (letter.transcriptConfirmationId) {
      if (
        !letter.transcriptConfirmedAt
        || !letter.transcriptConfirmationIntentHash
        || letter.transcriptConfirmationSourceRevision
          !== letter.primarySourceRevision
        || letter.transcriptConfirmationTranscriptDigest
          !== currentTranscriptDigest
      ) {
        throw new AppError(
          409,
          'Stored transcript confirmation is inconsistent; reload before continuing',
          undefined,
          TRANSCRIPT_CONFIRMATION_INTENT_CHANGED_ERROR_CODE,
        );
      }
      if (letter.transcriptConfirmationIntentHash !== intentIdentity) {
        throw new AppError(
          409,
          'This transcript was already confirmed with different reviewer guidance',
          undefined,
          TRANSCRIPT_CONFIRMATION_INTENT_CHANGED_ERROR_CODE,
        );
      }

      return {
        newlyQueued: false,
        receipt: {
          confirmationId: letter.transcriptConfirmationId,
          confirmedAt: letter.transcriptConfirmedAt.toISOString(),
          confirmedBy: letter.transcriptConfirmedBy,
          transcriptSource: {
            primarySourceRevision: letter.primarySourceRevision,
            transcriptDigest: currentTranscriptDigest,
          },
          metadataInputIdentity: currentMetadataInputIdentity,
          intentIdentity,
          metadataDisposition: dispositionFor(
            letter.type,
            letter.metadataStatus,
          ),
        },
      };
    }

    if (letter.transcriptConfirmedAt) {
      throw new AppError(
        409,
        'This legacy transcript confirmation has no replay-safe intent; reload and use the current processing action',
        undefined,
        LEGACY_TRANSCRIPT_CONFIRMATION_ERROR_CODE,
      );
    }
    if (letter.workflow !== 'TRANSCRIBED') {
      throw new BadRequestError(
        'Letter must be in TRANSCRIBED state',
        { currentState: letter.workflow },
      );
    }
    if (letter.transcriptionStatus === 'RUNNING') {
      throw new BadRequestError('Transcription is already in progress');
    }
    if (letter.type === 'L' && !letter.transcriptionText?.trim()) {
      throw new BadRequestError(
        'Letter must have a transcription before extracting metadata',
      );
    }

    const newlyQueued = letter.type === 'L'
      && (
        letter.metadataStatus === 'PENDING'
        || letter.metadataStatus === 'FAILED'
      );
    const hasRelatedExtraContent = group.members.some(member =>
      member.id !== letter.id
      && (
        member.type === 'T'
        || member.type === 'C'
        || member.type === 'E'
      ));
    const extraContentBlocksConfirmation = hasRelatedExtraContent
      && (
        letter.extraContentJobStatus === 'PENDING'
        || letter.extraContentJobStatus === 'RUNNING'
      );
    if (newlyQueued && letter.entityExtractionStatus === 'RUNNING') {
      throw new BadRequestError(
        'Related processing must finish before confirming this transcript',
      );
    }
    if (newlyQueued && extraContentBlocksConfirmation) {
      throw new AppError(
        409,
        'Supplementary-content transcription must finish before confirming this transcript',
        { extraContentJobStatus: letter.extraContentJobStatus },
        TRANSCRIPT_CONFIRMATION_EXTRA_CONTENT_PENDING_ERROR_CODE,
      );
    }

    const confirmationId = randomUUID();
    const confirmedAt = new Date();
    const metadataDisposition: MetadataDisposition = newlyQueued
      ? 'queued'
      : dispositionFor(letter.type, letter.metadataStatus);
    const metadataConfirmationGuidance = newlyQueued
      ? buildMetadataConfirmationGuidanceEnvelope({
          confirmationId,
          metadataInputIdentity: currentMetadataInputIdentity!,
          guidance,
        })
      : null;

    await tx
      .update(letters)
      .set({
        transcriptConfirmedAt: confirmedAt,
        transcriptConfirmedBy: input.confirmedBy,
        transcriptConfirmationId: confirmationId,
        transcriptConfirmationIntentHash: intentIdentity,
        transcriptConfirmationSourceRevision: letter.primarySourceRevision,
        transcriptConfirmationTranscriptDigest: currentTranscriptDigest,
        metadataConfirmationGuidance,
        metadataGuidanceRunId: null,
        ...(newlyQueued
          ? {
              metadataStatus: 'PENDING' as const,
              metadataRevision: sql`${letters.metadataRevision} + 1`,
              metadataRunId: null,
              metadataRunRevision: null,
              metadataLeaseExpiresAt: null,
              metadataLeaseRunId: null,
              metadataClaimKind: null,
              metadataError: null,
              metadataAttemptCount: 0,
              deadLetter: false,
              entityExtractionStatus: 'PENDING' as const,
              ...clearedEntityExtractionOwnership(),
              entityExtractionError: null,
              workflow: 'TRANSCRIBED' as const,
            }
          : {}),
        updatedAt: confirmedAt,
      })
      .where(eq(letters.id, letter.id));

    return {
      newlyQueued,
      receipt: {
        confirmationId,
        confirmedAt: confirmedAt.toISOString(),
        confirmedBy: input.confirmedBy,
        transcriptSource: {
          primarySourceRevision: letter.primarySourceRevision,
          transcriptDigest: currentTranscriptDigest,
        },
        metadataInputIdentity: currentMetadataInputIdentity,
        intentIdentity,
        metadataDisposition,
      },
    };
  });
}
