import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, letters } from '../../db/index.js';
import { processLetter, processMetadata } from '../../pipeline/processor.js';
import { runEntityExtractionOnly } from '../../pipeline/metadataV2.js';
import { tryTranscribeExtras } from '../letter/extra-content.js';
import { createLogger } from '../../utils/logger.js';
import { notify } from '../notifications.js';
import { allOf } from './filter-helpers.js';
import {
  clearJobProgress,
  recordJobCompleted,
  recordJobFailed,
  recordJobSkipped,
  recordJobStart,
} from './runner.js';
import type { BatchContext, BatchResult, QueuedItem, RecentJob, ActiveJob } from './types.js';
import { ProcessingError } from './types.js';

const log = createLogger({ module: 'letter-process-helpers' });

/**
 * Shared scaffolding for the three letter-based batch processes. Each one
 * differs only in which DB column it reads/writes and which pipeline call it
 * makes — everything else (remove from queue, clear, retry, cancel active,
 * runBatch loop wrapping onto the runner state, notifications) is identical.
 */

export type LetterStatusColumn =
  | 'transcriptionStatus'
  | 'metadataStatus'
  | 'entityExtractionStatus'
  | 'extraContentJobStatus';

export type LetterErrorColumn =
  | 'transcriptionError'
  | 'metadataError'
  | 'entityExtractionError'
  | 'extraContentJobError';

export type PipelineKind = 'transcription' | 'metadata' | 'entity_extraction' | 'extra_content';

type SkippedJobReason = 'claim_lost' | 'superseded' | 'ineligible' | 'missing';
type LetterRunResult = void | { kind: 'skipped'; reason: SkippedJobReason };

export interface LetterProcessSpec {
  processKey: PipelineKind;
  label: string;
  statusColumn: LetterStatusColumn;
  errorColumn: LetterErrorColumn;
  /** Workflow value to reset to when retry/cancel; undefined = don't touch workflow. */
  retryWorkflow?: 'UPLOADED' | 'TRANSCRIBED';
  /** Pipeline function to invoke per letter. */
  runOne(letterId: string): Promise<LetterRunResult>;
  /** Notification type emitted on per-job failure. */
  failedNotificationType: 'transcription_failed' | 'metadata_failed' | 'entity_failed' | 'extra_content_failed';
}

export const letterProcessSpecs: Record<PipelineKind, LetterProcessSpec> = {
  transcription: {
    processKey: 'transcription',
    label: 'Transcription',
    statusColumn: 'transcriptionStatus',
    errorColumn: 'transcriptionError',
    retryWorkflow: 'UPLOADED',
    runOne: (id) => processLetter(id),
    failedNotificationType: 'transcription_failed',
  },
  metadata: {
    processKey: 'metadata',
    label: 'Metadata extraction',
    statusColumn: 'metadataStatus',
    errorColumn: 'metadataError',
    retryWorkflow: 'TRANSCRIBED',
    runOne: (id) => processMetadata(id),
    failedNotificationType: 'metadata_failed',
  },
  entity_extraction: {
    processKey: 'entity_extraction',
    label: 'Entity extraction',
    statusColumn: 'entityExtractionStatus',
    errorColumn: 'entityExtractionError',
    retryWorkflow: undefined,
    runOne: (id) => runEntityExtractionOnly(id),
    failedNotificationType: 'entity_failed',
  },
  extra_content: {
    processKey: 'extra_content',
    label: 'Extra content transcription',
    statusColumn: 'extraContentJobStatus',
    errorColumn: 'extraContentJobError',
    retryWorkflow: undefined,
    runOne: async (id) => {
      const result = await tryTranscribeExtras(id, { expectedStatus: 'PENDING' });
      if (result.kind === 'completed') return;
      return { kind: 'skipped', reason: result.kind };
    },
    failedNotificationType: 'extra_content_failed',
  },
};

// ============================================================================
// Eligibility / resolve IDs
// ============================================================================

export async function resolveEligibleLetterIds(
  baseConditions: SQL[],
  extraConditions: SQL[] = []
): Promise<string[]> {
  const conditions = [...baseConditions, ...extraConditions];
  const rows = await db.query.letters.findMany({
    where: allOf(conditions),
    columns: { id: true },
  });
  return rows.map(r => r.id);
}

export async function countEligible(baseConditions: SQL[]): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(letters)
    .where(allOf(baseConditions));
  return Number(rows[0]?.c ?? 0);
}

// ============================================================================
// Queue / active / recent query helpers
// ============================================================================

export async function queueSnapshot(
  spec: LetterProcessSpec,
  queueConditions: SQL[],
  orderField: 'createdAt' | 'transcriptConfirmedAt' = 'createdAt'
): Promise<QueuedItem[]> {
  const rows = await db.query.letters.findMany({
    where: allOf(queueConditions),
    with: { collection: true },
    orderBy: (l, { asc }) =>
      orderField === 'transcriptConfirmedAt' ? [asc(l.transcriptConfirmedAt)] : [asc(l.createdAt)],
    limit: 500,
  });
  return rows.map(l => ({
    letterId: l.id,
    letterTitle: l.dateRaw,
    collectionCode: l.collection.collectionCode,
    sender: l.sender,
    recipient: l.recipient,
    queuedAt:
      orderField === 'transcriptConfirmedAt' && l.transcriptConfirmedAt
        ? l.transcriptConfirmedAt.toISOString()
        : l.createdAt.toISOString(),
  }));
}

export async function activeJobSnapshot(spec: LetterProcessSpec): Promise<ActiveJob | null> {
  const row = await db.query.letters.findFirst({
    where: eq(letters[spec.statusColumn], 'RUNNING'),
    with: { collection: true },
  });
  if (!row) return null;
  // Progress is tracked in-memory by the runner; caller merges it in.
  return {
    letterId: row.id,
    letterTitle: row.dateRaw,
    collectionCode: row.collection.collectionCode,
    sender: row.sender,
    recipient: row.recipient,
    startedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    progress: null,
  };
}

export async function recentJobsSnapshot(
  spec: LetterProcessSpec,
  limit: number
): Promise<RecentJob[]> {
  const rows = await db.query.letters.findMany({
    where: and(
      sql`${letters[spec.statusColumn]} IN ('SUCCESS', 'FAILED')`
    ),
    with: { collection: true },
    orderBy: (l, { desc }) => [desc(l.updatedAt)],
    limit,
  });

  const isAdminAction = (err: string | null): boolean =>
    !!err &&
    (err.includes('from queue by admin') ||
      err === 'Cancelled by admin' ||
      err === 'Aborted by admin');
  const isBulkCleared = (err: string | null): boolean => err === 'Cleared by admin';

  const recent: RecentJob[] = [];
  for (const l of rows) {
    const status = l[spec.statusColumn] as 'SUCCESS' | 'FAILED';
    const error = l[spec.errorColumn] as string | null;
    if (status === 'FAILED' && isAdminAction(error)) continue;
    recent.push({
      letterId: l.id,
      letterTitle: l.dateRaw,
      collectionCode: l.collection.collectionCode,
      status: isBulkCleared(error) ? 'CLEARED' : status,
      error:
        status === 'FAILED' && !isBulkCleared(error) ? (error ?? undefined) : undefined,
      completedAt: l.updatedAt?.toISOString() ?? new Date().toISOString(),
    });
  }
  return recent;
}

// ============================================================================
// Per-item mutations: remove / clear / retry / cancel
// ============================================================================

async function findLetterOrThrow(letterId: string) {
  const letter = await db.query.letters.findFirst({ where: eq(letters.id, letterId) });
  if (!letter) throw new ProcessingError('Letter not found', 404);
  return letter;
}

export async function removeFromQueue(
  spec: LetterProcessSpec,
  letterId: string
): Promise<void> {
  const letter = await findLetterOrThrow(letterId);
  const status = (letter as Record<string, unknown>)[spec.statusColumn] as string;
  if (status !== 'PENDING') {
    throw new ProcessingError(`Cannot remove: ${spec.processKey} status is ${status}`, 400);
  }
  const updates: Record<string, unknown> = {
    [spec.statusColumn]: 'FAILED',
    [spec.errorColumn]: 'Removed from queue by admin',
    updatedAt: new Date(),
  };
  if (spec.processKey === 'extra_content') {
    updates.extraContentJobRunId = null;
    updates.extraContentJobDirty = false;
  }

  const removed = await db
    .update(letters)
    .set(updates)
    .where(and(
      eq(letters.id, letterId),
      eq(letters[spec.statusColumn], 'PENDING'),
    ))
    .returning({ id: letters.id });
  if (removed.length === 0) {
    throw new ProcessingError(`Cannot remove: ${spec.processKey} is no longer pending`, 409);
  }
}

export async function clearQueue(
  spec: LetterProcessSpec,
  queueConditions: SQL[]
): Promise<{ cleared: number }> {
  const queued = await db.query.letters.findMany({
    where: allOf(queueConditions),
    columns: { id: true },
  });
  if (queued.length === 0) return { cleared: 0 };
  const updates: Record<string, unknown> = {
    [spec.statusColumn]: 'FAILED',
    [spec.errorColumn]: 'Cleared from queue by admin',
    updatedAt: new Date(),
  };
  if (spec.processKey === 'extra_content') {
    updates.extraContentJobRunId = null;
    updates.extraContentJobDirty = false;
  }

  const cleared = await db
    .update(letters)
    .set(updates)
    .where(and(
      inArray(
        letters.id,
        queued.map(q => q.id)
      ),
      eq(letters[spec.statusColumn], 'PENDING'),
    ))
    .returning({ id: letters.id });
  return { cleared: cleared.length };
}

export async function retryJob(
  spec: LetterProcessSpec,
  letterId: string
): Promise<void> {
  const letter = await findLetterOrThrow(letterId);
  const status = (letter as Record<string, unknown>)[spec.statusColumn] as string;
  if (status !== 'FAILED') {
    throw new ProcessingError(`Cannot retry: ${spec.processKey} status is ${status}`, 400);
  }
  const updates: Record<string, unknown> = {
    [spec.statusColumn]: 'PENDING',
    [spec.errorColumn]: null,
    updatedAt: new Date(),
  };
  if (spec.retryWorkflow) updates.workflow = spec.retryWorkflow;
  if (spec.processKey === 'transcription') {
    updates.transcriptionAttemptCount = 0;
    updates.deadLetter = false;
  } else if (spec.processKey === 'metadata') {
    updates.metadataAttemptCount = 0;
    updates.deadLetter = false;
  } else if (spec.processKey === 'extra_content') {
    updates.extraContentJobRunId = null;
    updates.extraContentJobDirty = false;
  }
  const retried = await db
    .update(letters)
    .set(updates)
    .where(and(
      eq(letters.id, letterId),
      eq(letters[spec.statusColumn], 'FAILED'),
      eq(letters.updatedAt, letter.updatedAt),
    ))
    .returning({ id: letters.id });
  if (retried.length === 0) {
    throw new ProcessingError(`Cannot retry: ${spec.processKey} changed since it was loaded`, 409);
  }
}

export async function cancelActive(
  spec: LetterProcessSpec,
  letterId: string
): Promise<void> {
  const letter = await findLetterOrThrow(letterId);
  const status = (letter as Record<string, unknown>)[spec.statusColumn] as string;
  if (status !== 'RUNNING') {
    throw new ProcessingError(`Cannot cancel: ${spec.processKey} status is ${status}`, 400);
  }
  let cancelled: Array<{ id: string }>;

  if (spec.processKey === 'extra_content') {
    const observedRunId = letter.extraContentJobRunId;
    const observedDirty = letter.extraContentJobDirty;
    const runIdCondition = observedRunId === null
      ? isNull(letters.extraContentJobRunId)
      : eq(letters.extraContentJobRunId, observedRunId);
    const cancelAttempt = async (dirty: boolean) => db
      .update(letters)
      .set({
        extraContentJobStatus: dirty ? 'PENDING' : 'FAILED',
        extraContentJobError: dirty ? null : 'Cancelled by admin',
        extraContentJobRunId: null,
        extraContentJobDirty: false,
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.extraContentJobStatus, 'RUNNING'),
        runIdCondition,
        eq(letters.extraContentJobDirty, dirty),
      ))
      .returning({ id: letters.id });

    cancelled = await cancelAttempt(observedDirty);
    // Source invalidation may race a clean cancellation. Preserve it by
    // requeuing only the same observed attempt if it became dirty.
    if (cancelled.length === 0 && !observedDirty) {
      cancelled = await cancelAttempt(true);
    }
  } else {
    const updates: Record<string, unknown> = {
      [spec.statusColumn]: 'FAILED',
      [spec.errorColumn]: 'Cancelled by admin',
      updatedAt: new Date(),
    };
    if (spec.retryWorkflow) updates.workflow = spec.retryWorkflow;
    cancelled = await db
      .update(letters)
      .set(updates)
      .where(and(
        eq(letters.id, letterId),
        eq(letters[spec.statusColumn], 'RUNNING'),
      ))
      .returning({ id: letters.id });
  }

  if (cancelled.length === 0) {
    throw new ProcessingError(`Cannot cancel: ${spec.processKey} is no longer running`, 409);
  }
  clearJobProgress(letterId, spec.processKey);
  log.info({ letterId, processKey: spec.processKey }, 'Active job cancelled by admin');
}

// ============================================================================
// runBatch — the shared loop that each process config plugs into.
// ============================================================================

export async function runLetterBatch(
  spec: LetterProcessSpec,
  letterIds: string[],
  ctx: BatchContext
): Promise<BatchResult> {
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const letterId of letterIds) {
    if (ctx.shouldAbort()) break;
    await ctx.waitWhilePaused();
    if (ctx.shouldAbort()) break;

    recordJobStart(letterId);
    const jobStart = Date.now();

    try {
      const result = await spec.runOne(letterId);
      if (result?.kind === 'skipped') {
        skipped += 1;
        recordJobSkipped(letterId, result.reason);
        log.info(
          { letterId, processKey: spec.processKey, reason: result.reason },
          'Job skipped because this runner did not own it',
        );
        continue;
      }
      completed += 1;
      recordJobCompleted(letterId, Date.now() - jobStart);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      failed += 1;
      recordJobFailed(letterId, errorMessage);
      log.error({ letterId, processKey: spec.processKey, err: error }, 'Job failed');

      void notify({
        type: spec.failedNotificationType,
        title: `${spec.label} failed`,
        message: errorMessage,
        link: `/admin/letters/${letterId}`,
        sourceType: 'letter',
        sourceId: letterId,
        metadata: { error: errorMessage, jobType: spec.processKey },
        dedupeKey: `${spec.failedNotificationType}:${letterId}`,
      });
    } finally {
      clearJobProgress(letterId, spec.processKey);
    }
  }

  return { completed, failed, skipped };
}
