import { eq, sql, type SQL } from 'drizzle-orm';
import { letters } from '../../db/index.js';
import {
  processingFilterSchema,
  buildProcessingConditions,
  type ProcessingFilterOptions,
} from './filter-helpers.js';
import {
  letterProcessSpecs,
  queueSnapshot,
  activeJobSnapshot,
  recentJobsSnapshot,
  removeFromQueue,
  clearQueue,
  retryJob,
  cancelActive,
  runLetterBatch,
  countEligible,
  resolveEligibleLetterIds,
} from './letter-process-helpers.js';
import { getJobProgress } from './runner.js';
import type { ProcessConfig } from './types.js';

const spec = letterProcessSpecs.extra_content;

/**
 * Only letters (type='L') that are PENDING and have related supplementary
 * items (telegrams T, covers C, ephemera E) with the same date/sequence.
 */
const hasRelatedItems: SQL = sql`EXISTS (
  SELECT 1 FROM letters AS rel
  WHERE rel.collection_id = ${letters.collectionId}
    AND rel.date_raw = ${letters.dateRaw}
    AND rel.type_sequence = ${letters.typeSequence}
    AND rel.type IN ('T', 'C', 'E')
    AND rel.id != ${letters.id}
)`;

const baseQueueConditions: SQL[] = [
  eq(letters.type, 'L'),
  eq(letters.extraContentJobStatus, 'PENDING'),
  hasRelatedItems,
];

export const extraContentProcess: ProcessConfig<ProcessingFilterOptions> = {
  key: 'extra_content',
  label: 'Extra content transcription',
  description: 'Transcribe supplementary items (telegrams, covers, ephemera) related to each letter.',
  order: 4,
  group: 'batch',
  capabilities: {
    start: true,
    pauseResume: true,
    abort: true,
    perItemCancel: true,
    perItemRemove: true,
    perItemRetry: true,
    clearQueue: true,
    bulkRetryFailed: false,
    readOnly: false,
  },
  filterSchema: processingFilterSchema,

  async getEligibleCount(filters) {
    const { conditions, collectionNotFound } = await buildProcessingConditions(
      filters,
      baseQueueConditions
    );
    if (collectionNotFound) return 0;
    return countEligible(conditions);
  },

  async resolveEligibleLetterIds(filters) {
    const { conditions, collectionNotFound } = await buildProcessingConditions(
      filters,
      baseQueueConditions
    );
    if (collectionNotFound) return [];
    return resolveEligibleLetterIds(conditions);
  },

  async getQueue() {
    return queueSnapshot(spec, baseQueueConditions, 'createdAt');
  },

  async getRecent(limit) {
    return recentJobsSnapshot(spec, limit);
  },

  async getActiveJob() {
    const active = await activeJobSnapshot(spec);
    if (!active) return null;
    const prog = getJobProgress(active.letterId, 'extra_content');
    if (prog) {
      active.progress = {
        step: prog.step,
        totalSteps: prog.totalSteps,
        stepLabel: prog.stepLabel,
      };
    }
    return active;
  },

  async runBatch(letterIds, ctx) {
    return runLetterBatch(spec, letterIds, ctx);
  },

  async cancelActive(letterId) {
    await cancelActive(spec, letterId);
  },

  async removeFromQueue(letterId) {
    await removeFromQueue(spec, letterId);
  },

  async retry(letterId) {
    await retryJob(spec, letterId);
  },

  async clearQueue() {
    return clearQueue(spec, baseQueueConditions);
  },
};
