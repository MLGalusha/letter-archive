import { apiGet, apiPost } from '../client';

// ============================================================================
// Types — mirror backend/src/services/processes/types.ts.
// ============================================================================

export type ProcessKey =
  | 'transcription'
  | 'metadata'
  | 'entity_extraction'
  | 'extra_content'
  | 'background_worker';

export type ProcessGroup = 'batch' | 'autonomous';

export interface ProcessCapabilities {
  start: boolean;
  pauseResume: boolean;
  abort: boolean;
  perItemCancel: boolean;
  perItemRemove: boolean;
  perItemRetry: boolean;
  clearQueue: boolean;
  bulkRetryFailed: boolean;
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

export interface ProcessStatus {
  key: ProcessKey;
  label: string;
  description: string;
  order: number;
  group: ProcessGroup;
  capabilities: ProcessCapabilities;
  eligibleCount: number;
  queued: QueuedItem[];
  active: ActiveJob | null;
  recent: RecentJob[];
  observed?: ObservedWorkerState;
}

export interface ActiveBatchState {
  processKey: ProcessKey;
  total: number;
  completed: number;
  failed: number;
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

export interface ProcessFilters {
  collectionCode?: string;
  visibility?: 'PUBLISHED' | 'HIDDEN';
  search?: string;
  year?: number;
  month?: number;
  day?: number;
  dateFrom?: string;
  dateTo?: string;
}

export type ProcessingEvent =
  | { type: 'status-updated' }
  | { type: 'batch-started'; processKey: ProcessKey; total: number; startedAt: string }
  | {
      type: 'batch-progress';
      processKey: ProcessKey;
      completed: number;
      failed: number;
      total: number;
      currentLetterId: string | null;
      stepLabel: string | null;
    }
  | {
      type: 'batch-completed';
      processKey: ProcessKey;
      completed: number;
      failed: number;
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
// API calls
// ============================================================================

/** Full snapshot across every registered process. */
export async function getAllProcessesStatus(): Promise<AllProcessesStatus> {
  return apiGet<AllProcessesStatus>('/admin/processing/snapshot');
}

export async function getProcessEligibility(
  key: ProcessKey,
  filters: ProcessFilters = {}
): Promise<{ count: number }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return apiGet<{ count: number }>(
    `/admin/processing/processes/${key}/eligibility${qs ? `?${qs}` : ''}`
  );
}

export async function getProcessQueue(key: ProcessKey): Promise<{ queue: QueuedItem[] }> {
  return apiGet(`/admin/processing/processes/${key}/queue`);
}

export async function getProcessRecent(
  key: ProcessKey,
  limit = 50
): Promise<{ recent: RecentJob[] }> {
  return apiGet(`/admin/processing/processes/${key}/recent?limit=${limit}`);
}

export async function startProcess(
  key: ProcessKey,
  filters: ProcessFilters = {}
): Promise<{ message: string; total: number }> {
  return apiPost(`/admin/processing/processes/${key}/start`, filters);
}

export async function pauseBatch(): Promise<{ message: string }> {
  return apiPost('/admin/processing/batch/pause');
}

export async function resumeBatch(): Promise<{ message: string }> {
  return apiPost('/admin/processing/batch/resume');
}

export async function abortBatch(): Promise<{ message: string }> {
  return apiPost('/admin/processing/batch/abort');
}

export async function removeFromProcessQueue(
  key: ProcessKey,
  letterId: string
): Promise<{ message: string }> {
  return apiPost(`/admin/processing/processes/${key}/queue/remove`, { letterId });
}

export async function clearProcessQueue(
  key: ProcessKey
): Promise<{ message: string; cleared: number }> {
  return apiPost(`/admin/processing/processes/${key}/queue/clear`);
}

export async function retryProcessJob(
  key: ProcessKey,
  letterId: string
): Promise<{ message: string }> {
  return apiPost(`/admin/processing/processes/${key}/queue/retry`, { letterId });
}

export async function cancelActiveJob(
  key: ProcessKey,
  letterId: string
): Promise<{ message: string }> {
  return apiPost(`/admin/processing/processes/${key}/cancel`, { letterId });
}

export async function getProcessingStreamToken(): Promise<{ token: string; expiresAt: number }> {
  return apiPost('/admin/processing/stream-token');
}
