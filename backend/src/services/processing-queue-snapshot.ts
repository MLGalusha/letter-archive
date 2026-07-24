import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PAGINATION } from '../constants/pagination.js';

export const queueJobTypeSchema = z.enum([
  'transcription',
  'metadata',
  'entity_extraction',
  'extra_content',
]);
export type QueueJobType = z.infer<typeof queueJobTypeSchema>;

export const processingJobSnapshotSchema = z.object({
  letterId: z.string().trim().min(1),
  primarySourceRevision: z.number().int().nonnegative(),
  jobStateToken: z.string().trim().min(1).max(128),
});
export type ProcessingJobSnapshot = z.infer<
  typeof processingJobSnapshotSchema
>;

export const processingJobActionSchema = processingJobSnapshotSchema.extend({
  type: queueJobTypeSchema,
});

export const clearProcessingQueueSnapshotSchema = z.object({
  type: queueJobTypeSchema,
  items: z
    .array(processingJobSnapshotSchema)
    .max(PAGINATION.QUEUE_BATCH_SIZE)
    .superRefine((items, context) => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (seen.has(item.letterId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicate letterId in displayed queue snapshot',
            path: [index, 'letterId'],
          });
        }
        seen.add(item.letterId);
      }
    }),
});

export type ProcessingJobPhase = 'queued' | 'active' | 'recent';

/**
 * The queue read model needs a durable, stage-scoped identity without exposing
 * internal run IDs or making the browser reconstruct lifecycle state.
 *
 * `updatedAt` is included as the incarnation fence for stages that do not yet
 * have a dedicated monotonic revision. Lease deadlines are deliberately
 * excluded so a heartbeat does not invalidate an otherwise-current action.
 */
export interface ProcessingJobStateSource {
  updatedAt?: Date | null;
  deadLetter?: boolean | null;

  transcriptionStatus?: string | null;
  transcriptionRunId?: string | null;
  transcriptionLeaseRunId?: string | null;
  transcriptionClaimKind?: string | null;
  transcriptionAttemptCount?: number | null;
  transcriptionError?: string | null;
  transcribedAt?: Date | null;

  metadataStatus?: string | null;
  metadataRevision?: number | null;
  metadataRunId?: string | null;
  metadataRunRevision?: number | null;
  metadataLeaseRunId?: string | null;
  metadataClaimKind?: string | null;
  metadataAttemptCount?: number | null;
  metadataError?: string | null;

  entityExtractionStatus?: string | null;
  entityExtractionRevision?: number | null;
  entityExtractionRunId?: string | null;
  entityExtractionRunRevision?: number | null;
  entityExtractionLeaseRunId?: string | null;
  entityExtractionClaimKind?: string | null;
  entityExtractionError?: string | null;

  extraContentJobStatus?: string | null;
  extraContentJobRunId?: string | null;
  extraContentJobLeaseRunId?: string | null;
  extraContentJobClaimKind?: string | null;
  extraContentJobDirty?: boolean | null;
  extraContentJobError?: string | null;
}

function tokenValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function stageState(
  source: ProcessingJobStateSource,
  type: QueueJobType,
): unknown[] {
  switch (type) {
    case 'transcription':
      return [
        source.transcriptionStatus,
        source.transcriptionRunId,
        source.transcriptionLeaseRunId,
        source.transcriptionClaimKind,
        source.transcriptionAttemptCount,
        source.transcriptionError,
        source.transcribedAt,
        source.deadLetter,
      ];
    case 'metadata':
      return [
        source.metadataStatus,
        source.metadataRevision,
        source.metadataRunId,
        source.metadataRunRevision,
        source.metadataLeaseRunId,
        source.metadataClaimKind,
        source.metadataAttemptCount,
        source.metadataError,
        source.deadLetter,
      ];
    case 'entity_extraction':
      return [
        source.entityExtractionStatus,
        source.entityExtractionRevision,
        source.entityExtractionRunId,
        source.entityExtractionRunRevision,
        source.entityExtractionLeaseRunId,
        source.entityExtractionClaimKind,
        source.entityExtractionError,
        source.deadLetter,
      ];
    case 'extra_content':
      return [
        source.extraContentJobStatus,
        source.extraContentJobRunId,
        source.extraContentJobLeaseRunId,
        source.extraContentJobClaimKind,
        source.extraContentJobDirty,
        source.extraContentJobError,
      ];
  }
}

export function processingJobStateToken(
  source: ProcessingJobStateSource,
  type: QueueJobType,
  phase: ProcessingJobPhase,
): string {
  const state = [
    'processing-job-state-v1',
    type,
    phase,
    source.updatedAt,
    ...stageState(source, type),
  ].map(tokenValue);

  return `v1.${createHash('sha256')
    .update(JSON.stringify(state))
    .digest('base64url')}`;
}
