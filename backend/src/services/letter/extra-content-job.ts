import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  db,
  letters,
  type ContentStatus,
  type JobStatus,
} from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'extra-content-job' });

type ClaimableJobStatus = Exclude<JobStatus, 'RUNNING'>;

export interface ExtraContentPatch {
  extraContentTranscript: string | null;
  extraContentStatus: ContentStatus;
  extraContentVerifiedAt: null;
  extraContentVerifiedBy: null;
}

export type ExtraContentJobResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'claim_lost' }
  | { kind: 'superseded' };

interface ExtraContentJobOptions<T> {
  letterId: string;
  expectedStatus: ClaimableJobStatus;
  expectedUpdatedAt: Date;
  produce: () => Promise<{ value: T; patch: ExtraContentPatch }>;
}

/**
 * Human changes are authoritative over in-flight extra-content generation.
 *
 * Spread this patch into the same database update as the human mutation. The
 * status/run-ID transition then revokes the active producer's publish fence,
 * while SUCCESS prevents a later queue pass from replacing the human result.
 * Clearing dirty is intentional: it describes stale AI work, not the human
 * content that superseded that work.
 */
export function buildHumanExtraContentJobPatch() {
  return {
    extraContentJobStatus: 'SUCCESS' as const,
    extraContentJobError: null,
    extraContentJobRunId: null,
    extraContentJobDirty: false,
  };
}

async function requeueDirtyAttempt(letterId: string, runId: string): Promise<boolean> {
  const rows = await db
    .update(letters)
    .set({
      extraContentJobStatus: 'PENDING',
      extraContentJobError: null,
      extraContentJobRunId: null,
      extraContentJobDirty: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.extraContentJobStatus, 'RUNNING'),
      eq(letters.extraContentJobRunId, runId),
      eq(letters.extraContentJobDirty, true),
    ))
    .returning({ id: letters.id });

  return rows.length > 0;
}

/**
 * Own one extra-content attempt from claim through atomic content publication.
 *
 * The run ID fences late attempts after cancellation/retry. Producers return a
 * patch instead of writing it, so a cancelled or invalidated attempt cannot
 * publish stale AI output before discovering that it lost ownership.
 */
export async function runExtraContentJob<T>({
  letterId,
  expectedStatus,
  expectedUpdatedAt,
  produce,
}: ExtraContentJobOptions<T>): Promise<ExtraContentJobResult<T>> {
  const runId = randomUUID();
  const claimConditions = [
    eq(letters.id, letterId),
    eq(letters.extraContentJobStatus, expectedStatus),
  ];
  claimConditions.push(eq(letters.updatedAt, expectedUpdatedAt));
  const claimed = await db
    .update(letters)
    .set({
      extraContentJobStatus: 'RUNNING',
      extraContentJobError: null,
      extraContentJobRunId: runId,
      extraContentJobDirty: false,
      updatedAt: new Date(),
    })
    .where(and(...claimConditions))
    .returning({ id: letters.id });

  if (claimed.length === 0) {
    return { kind: 'claim_lost' };
  }

  try {
    const { value, patch } = await produce();
    const completed = await db
      .update(letters)
      .set({
        ...patch,
        extraContentJobStatus: 'SUCCESS',
        extraContentJobError: null,
        extraContentJobRunId: null,
        extraContentJobDirty: false,
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.extraContentJobStatus, 'RUNNING'),
        eq(letters.extraContentJobRunId, runId),
        eq(letters.extraContentJobDirty, false),
      ))
      .returning({ id: letters.id });

    if (completed.length > 0) {
      return { kind: 'completed', value };
    }

    await requeueDirtyAttempt(letterId, runId);
    return { kind: 'superseded' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    try {
      const failed = await db
        .update(letters)
        .set({
          extraContentJobStatus: 'FAILED',
          extraContentJobError: message,
          extraContentJobRunId: null,
          extraContentJobDirty: false,
          updatedAt: new Date(),
        })
        .where(and(
          eq(letters.id, letterId),
          eq(letters.extraContentJobStatus, 'RUNNING'),
          eq(letters.extraContentJobRunId, runId),
          eq(letters.extraContentJobDirty, false),
        ))
        .returning({ id: letters.id });

      if (failed.length === 0) {
        await requeueDirtyAttempt(letterId, runId);
        return { kind: 'superseded' };
      }
    } catch (statusError) {
      log.error(
        { letterId, runId, err: statusError, originalError: error },
        'Failed to persist extra-content job failure',
      );
    }
    throw error;
  }
}
