import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import {
  db,
  letters,
  type ContentStatus,
  type JobStatus,
  type WorkflowState,
} from '../../db/index.js';

export interface ObservedTranscriptionState {
  status: JobStatus;
  workflow: WorkflowState;
  transcriptionText: string | null;
  transcriptionError: string | null;
  transcriptionAttemptCount: number;
  deadLetter: boolean;
  transcriptStatus: ContentStatus;
}

export interface TranscriptionStateSource {
  transcriptionStatus: JobStatus;
  workflow: WorkflowState;
  transcriptionText: string | null;
  transcriptionError: string | null;
  transcriptionAttemptCount: number;
  deadLetter: boolean;
  transcriptStatus: ContentStatus;
}

export interface TranscriptionClaim {
  runId: string;
}

export function observeTranscriptionState(
  source: TranscriptionStateSource,
): ObservedTranscriptionState {
  return {
    status: source.transcriptionStatus,
    workflow: source.workflow,
    transcriptionText: source.transcriptionText,
    transcriptionError: source.transcriptionError,
    transcriptionAttemptCount: source.transcriptionAttemptCount,
    deadLetter: source.deadLetter,
    transcriptStatus: source.transcriptStatus,
  };
}

export function observedTranscriptionStateConditions(observed: ObservedTranscriptionState) {
  return [
    eq(letters.transcriptionStatus, observed.status),
    eq(letters.workflow, observed.workflow),
    observed.transcriptionText === null
      ? isNull(letters.transcriptionText)
      : eq(letters.transcriptionText, observed.transcriptionText),
    observed.transcriptionError === null
      ? isNull(letters.transcriptionError)
      : eq(letters.transcriptionError, observed.transcriptionError),
    eq(letters.transcriptionAttemptCount, observed.transcriptionAttemptCount),
    isNull(letters.transcriptionRunId),
    eq(letters.deadLetter, observed.deadLetter),
    eq(letters.transcriptStatus, observed.transcriptStatus),
  ];
}

async function updateOwnedTranscription(
  letterId: string,
  runId: string,
  updates: Record<string, unknown>,
): Promise<boolean> {
  const updated = await db
    .update(letters)
    .set({
      ...updates,
      transcriptionRunId: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.transcriptionRunId, runId),
    ))
    .returning({ id: letters.id });

  return updated.length > 0;
}

/**
 * Claims a queued transcription only from the exact eligible state that the
 * caller inspected. The run ID owns all later terminal writes for this attempt.
 */
export async function claimQueuedTranscription(
  letterId: string,
  observed: ObservedTranscriptionState,
): Promise<TranscriptionClaim | null> {
  if (
    observed.status !== 'PENDING'
    || observed.workflow !== 'UPLOADED'
    || observed.deadLetter
  ) {
    return null;
  }

  const runId = randomUUID();
  const claimed = await db
    .update(letters)
    .set({
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: runId,
      workflow: 'TRANSCRIBING',
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      ...observedTranscriptionStateConditions(observed),
    ))
    .returning({ id: letters.id });

  return claimed.length > 0 ? { runId } : null;
}

/**
 * Claims synchronous admin work from the exact idle state that was validated.
 * Existing reviewed content remains visible until replacement succeeds.
 */
export async function claimRequestedTranscription(
  letterId: string,
  observed: ObservedTranscriptionState,
): Promise<TranscriptionClaim | null> {
  if (observed.status === 'RUNNING') return null;

  const runId = randomUUID();
  const claimed = await db
    .update(letters)
    .set({
      workflow: 'TRANSCRIBING',
      transcriptionStatus: 'RUNNING',
      transcriptionRunId: runId,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      ...observedTranscriptionStateConditions(observed),
    ))
    .returning({ id: letters.id });

  return claimed.length > 0 ? { runId } : null;
}

/** Publishes a completed result only for the attempt that owns the run ID. */
export async function completeTranscription(
  letterId: string,
  runId: string,
  transcriptionText: string | null,
): Promise<boolean> {
  return updateOwnedTranscription(letterId, runId, {
    transcriptionText,
    transcriptionStatus: 'SUCCESS',
    transcriptionError: null,
    transcribedAt: new Date(),
    workflow: 'TRANSCRIBED',
    transcriptStatus: transcriptionText === null ? 'EMPTY' : 'AI_DRAFT',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
  });
}

/** Records producer failure only for the attempt that owns the run ID. */
export async function failTranscription(
  letterId: string,
  runId: string,
  error: string,
): Promise<boolean> {
  return updateOwnedTranscription(letterId, runId, {
    transcriptionStatus: 'FAILED',
    transcriptionError: error,
  });
}
