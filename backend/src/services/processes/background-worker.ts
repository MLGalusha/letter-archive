import { z } from 'zod';
import { getWorkerState } from '../worker-state.js';
import type { ProcessConfig } from './types.js';

/**
 * Observation-only entry for the autonomous background worker that runs in a
 * separate process (possibly a separate Cloud Run service). The API can't
 * directly inspect the worker's in-memory state, so the worker writes to the
 * `worker_state` singleton table each tick and we read it on demand.
 */
export const backgroundWorkerProcess: ProcessConfig<Record<string, never>> = {
  key: 'background_worker',
  label: 'Background worker',
  description: 'Autonomous polling worker that auto-transcribes new uploads.',
  order: 100,
  group: 'autonomous',
  capabilities: {
    start: false,
    pauseResume: false,
    abort: false,
    perItemCancel: false,
    perItemRemove: false,
    perItemRetry: false,
    clearQueue: false,
    bulkRetryFailed: false,
    readOnly: true,
  },
  filterSchema: z.object({}).strict(),

  async getEligibleCount() {
    return 0;
  },

  async resolveEligibleLetterIds() {
    return [];
  },

  async getQueue() {
    return [];
  },

  async getRecent() {
    return [];
  },

  async getActiveJob() {
    return null;
  },

  async runBatch() {
    throw new Error('background_worker is observation-only');
  },

  async getObservedState() {
    const snapshot = await getWorkerState();
    return {
      lastTickAt: snapshot.lastTickAt,
      isPolling: snapshot.isPolling,
      lastError: snapshot.lastError,
      currentBatchSize: snapshot.currentBatchSize,
    };
  },
};
