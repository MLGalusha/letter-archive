import { apiGet, apiPost } from "../client";

export type ProcessingJobType =
  | "transcription"
  | "metadata"
  | "entity_extraction"
  | "extra_content";

export interface ProcessingQueueItem {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  queuedAt: string | null;
}

export interface ProcessingActiveJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  type: ProcessingJobType;
  startedAt: string;
}

export interface ProcessingRecentJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  type: ProcessingJobType;
  status: "SUCCESS" | "FAILED" | "CLEARED";
  error?: string;
  completedAt: string;
}

export interface ProcessingWorkerState {
  lastTickAt: string | null;
  isPolling: boolean;
  lastError: string | null;
  currentBatchSize: number | null;
  updatedAt: string | null;
}

export interface ProcessingQueueStatus {
  active: ProcessingActiveJob[];
  queued: {
    transcription: ProcessingQueueItem[];
    metadata: ProcessingQueueItem[];
    entityExtraction: ProcessingQueueItem[];
    extraContent: ProcessingQueueItem[];
  };
  recent: ProcessingRecentJob[];
  worker: ProcessingWorkerState;
  counts: {
    activeCount: number;
    queuedTranscription: number;
    queuedMetadata: number;
    queuedEntityExtraction: number;
    queuedExtraContent: number;
    recentSuccessCount: number;
    recentFailedCount: number;
    recentClearedCount: number;
  };
}

export type ProcessingWorkerWakeResult =
  | { requested: true }
  | {
      requested: false;
      reason: "queue_empty" | "worker_not_configured";
    };

export async function getProcessingQueueStatus(): Promise<ProcessingQueueStatus> {
  return apiGet<ProcessingQueueStatus>("/admin/processing/queue");
}

export async function wakeProcessingWorker(): Promise<ProcessingWorkerWakeResult> {
  return apiPost<ProcessingWorkerWakeResult>("/admin/processing/wake");
}

export async function cancelProcessingJob(
  type: ProcessingJobType,
  letterId: string,
): Promise<{ message: string }> {
  return apiPost("/admin/processing/cancel", { letterId, type });
}

export async function removeProcessingQueueItem(
  type: ProcessingJobType,
  letterId: string,
): Promise<{ message: string }> {
  return apiPost("/admin/processing/queue/remove", { letterId, type });
}

export async function clearProcessingQueue(
  type: ProcessingJobType,
): Promise<{ message: string; cleared: number }> {
  return apiPost("/admin/processing/queue/clear", { type });
}

export async function retryProcessingJob(
  type: ProcessingJobType,
  letterId: string,
): Promise<{ message: string }> {
  return apiPost("/admin/processing/queue/retry", { letterId, type });
}
