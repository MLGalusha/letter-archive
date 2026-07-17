import { eq, ne, type SQL } from 'drizzle-orm';
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

const spec = letterProcessSpecs.entity_extraction;

const baseQueueConditions: SQL[] = [
  eq(letters.type, 'L'),
  eq(letters.metadataStatus, 'SUCCESS'),
  eq(letters.entityExtractionStatus, 'PENDING'),
  ne(letters.transcriptionStatus, 'RUNNING'),
];

export const entityExtractionProcess: ProcessConfig<ProcessingFilterOptions> = {
  key: 'entity_extraction',
  label: 'Entity extraction',
  description: 'Resolve persons and places mentioned in each letter.',
  order: 3,
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
    const prog = getJobProgress(active.letterId, 'entity_extraction');
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
