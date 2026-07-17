import type { z } from 'zod';

// ============================================================================
// Process Registry — shared types
// ============================================================================
//
// The admin Processing page is a control center for every background/async
// pipeline in the app. Each pipeline is modeled as a `ProcessConfig` in the
// registry (see `registry.ts`). The page (and all its routes) is driven
// entirely by what the registry exposes, so adding a new process is a single
// registry entry — no per-process endpoints, no per-process UI branches.

export type ProcessKey =
  | 'transcription'
  | 'metadata'
  | 'entity_extraction'
  | 'extra_content'
  | 'background_worker';

export type ProcessGroup = 'batch' | 'autonomous';

export interface ProcessCapabilities {
  /** Admin can start a batch of this process from the UI. */
  start: boolean;
  /** Batches can be paused and resumed mid-flight. */
  pauseResume: boolean;
  /** Batches can be aborted. */
  abort: boolean;
  /** An active (RUNNING) job can be cancelled. */
  perItemCancel: boolean;
  /** A PENDING item can be removed from the queue. */
  perItemRemove: boolean;
  /** A FAILED item can be retried (reset to PENDING). */
  perItemRetry: boolean;
  /** All PENDING items can be cleared at once. */
  clearQueue: boolean;
  /** All FAILED items matching the filters can be retried at once. */
  bulkRetryFailed: boolean;
  /** This process is observation-only (no admin controls). */
  readOnly: boolean;
}

export interface QueuedItem {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  queuedAt: string;
}

export interface ActiveJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  startedAt: string;
  progress: { step: number; totalSteps: number; stepLabel: string } | null;
}

export interface RecentJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  status: 'SUCCESS' | 'FAILED' | 'CLEARED';
  error?: string;
  completedAt: string;
}

export interface ObservedWorkerState {
  lastTickAt: string | null;
  isPolling: boolean;
  lastError: string | null;
  currentBatchSize: number | null;
}

/**
 * A snapshot of one process as the Processing page sees it. The frontend
 * renders each process card, queue drawer, and recent-activity filter
 * entirely from this shape.
 */
export interface ProcessStatus {
  key: ProcessKey;
  label: string;
  description: string;
  order: number;
  group: ProcessGroup;
  capabilities: ProcessCapabilities;
  /** Count of letters/items that match the eligibility query right now. */
  eligibleCount: number;
  /** Current queue (PENDING). */
  queued: QueuedItem[];
  /** Currently-running job for this process, if any. */
  active: ActiveJob | null;
  /** Recent completions/failures for this process. */
  recent: RecentJob[];
  /** Observation-only state (only populated for observation processes). */
  observed?: ObservedWorkerState;
}

export interface ActiveBatchState {
  processKey: ProcessKey;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  isPaused: boolean;
  shouldAbort: boolean;
  startedAt: string;
  lastProgressAt: string | null;
  currentJob: { letterId: string } | null;
}

export interface AllProcessesStatus {
  processes: ProcessStatus[];
  activeBatch: ActiveBatchState | null;
}

// ============================================================================
// Batch execution context — passed to each process's runBatch
// ============================================================================

export interface BatchContext {
  /** Updates progress for the currently-running job. */
  onProgress(step: number, totalSteps: number, stepLabel: string): void;
  /** True if the admin has requested an abort. Runners should respect this. */
  shouldAbort(): boolean;
  /** Await until unpaused. No-op if not paused. */
  waitWhilePaused(): Promise<void>;
  /** Emit an arbitrary processing event to connected SSE clients. */
  emit(event: ProcessingEvent): void;
}

export interface BatchResult {
  completed: number;
  failed: number;
  skipped: number;
}

// ============================================================================
// Process configuration
// ============================================================================

export interface ProcessConfig<Filters extends object = Record<string, unknown>> {
  key: ProcessKey;
  label: string;
  description: string;
  order: number;
  group: ProcessGroup;
  capabilities: ProcessCapabilities;

  /** Zod schema used to parse the body of POST /start. */
  filterSchema: z.ZodType<Filters>;

  /** Count of letters/items that match right now. */
  getEligibleCount(filters: Filters): Promise<number>;

  /** Letter IDs to process if a batch is started with these filters. */
  resolveEligibleLetterIds(filters: Filters): Promise<string[]>;

  /** The current PENDING queue snapshot. */
  getQueue(): Promise<QueuedItem[]>;

  /** Recent completions/failures for this process. */
  getRecent(limit: number): Promise<RecentJob[]>;

  /** The currently-running job for this process, if any (derived from DB). */
  getActiveJob(): Promise<ActiveJob | null>;

  /** Run the batch. Called by the runner. */
  runBatch(letterIds: string[], ctx: BatchContext): Promise<BatchResult>;

  // Per-item operations. All optional; gated by capabilities.
  cancelActive?(letterId: string): Promise<void>;
  removeFromQueue?(letterId: string): Promise<void>;
  retry?(letterId: string): Promise<void>;
  clearQueue?(): Promise<{ cleared: number }>;

  /** Read-only observation hook (e.g. background_worker → worker_state table). */
  getObservedState?(): Promise<ObservedWorkerState>;
}

// ============================================================================
// SSE events
// ============================================================================

export type ProcessingEvent =
  | { type: 'status-updated' }
  | { type: 'batch-started'; processKey: ProcessKey; total: number; startedAt: string }
  | {
      type: 'batch-progress';
      processKey: ProcessKey;
      completed: number;
      failed: number;
      skipped: number;
      total: number;
      currentLetterId: string | null;
      stepLabel: string | null;
    }
  | {
      type: 'batch-completed';
      processKey: ProcessKey;
      completed: number;
      failed: number;
      skipped: number;
      durationMs: number;
    }
  | { type: 'batch-paused'; processKey: ProcessKey }
  | { type: 'batch-resumed'; processKey: ProcessKey }
  | { type: 'batch-aborted'; processKey: ProcessKey }
  | { type: 'job-started'; processKey: ProcessKey; letterId: string }
  | { type: 'job-completed'; processKey: ProcessKey; letterId: string; durationMs: number }
  | { type: 'job-failed'; processKey: ProcessKey; letterId: string; error: string }
  | { type: 'queue-changed'; processKey: ProcessKey }
  | { type: 'worker-state'; state: ObservedWorkerState };

// ============================================================================
// Error class for capability/404/409 control flow in the routes.
// ============================================================================

export class ProcessingError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ProcessingError';
    this.statusCode = statusCode;
  }
}
