import { apiGet, apiPost } from "../client";

export type ProcessingJobType =
  | "transcription"
  | "metadata"
  | "entity_extraction"
  | "extra_content";

export interface ProcessingJobSnapshot {
  letterId: string;
  primarySourceRevision: number;
  jobStateToken: string;
}

export interface ProcessingQueueItem extends ProcessingJobSnapshot {
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  queuedAt: string | null;
}

export interface ProcessingActiveJob extends ProcessingJobSnapshot {
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  type: ProcessingJobType;
  startedAt: string;
}

export interface ProcessingRecentJob extends ProcessingJobSnapshot {
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

export type ProcessingQueueClearSkipCode =
  | "NOT_FOUND"
  | "SOURCE_REVISION_CHANGED"
  | "PROCESSING_JOB_CHANGED";

export interface ProcessingQueueClearResult {
  message: string;
  requested: number;
  cleared: number;
  skipped: number;
  skipReasons: Array<{
    letterId: string;
    code: ProcessingQueueClearSkipCode;
  }>;
}

export type ProcessingWorkerWakeResult =
  | { requested: true }
  | {
      requested: false;
      reason: "queue_empty" | "worker_not_configured";
    };

function processingActionBody(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
) {
  return {
    type,
    letterId: snapshot.letterId,
    primarySourceRevision: snapshot.primarySourceRevision,
    jobStateToken: snapshot.jobStateToken,
  };
}

export async function getProcessingQueueStatus(): Promise<ProcessingQueueStatus> {
  return apiGet<ProcessingQueueStatus>("/admin/processing/queue");
}

export async function wakeProcessingWorker(): Promise<ProcessingWorkerWakeResult> {
  return apiPost<ProcessingWorkerWakeResult>("/admin/processing/wake");
}

export async function cancelProcessingJob(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
): Promise<{ message: string }> {
  return apiPost(
    "/admin/processing/cancel",
    processingActionBody(type, snapshot),
  );
}

export async function removeProcessingQueueItem(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
): Promise<{ message: string }> {
  return apiPost(
    "/admin/processing/queue/remove",
    processingActionBody(type, snapshot),
  );
}

export async function clearProcessingQueue(
  type: ProcessingJobType,
  items: ProcessingJobSnapshot[],
): Promise<ProcessingQueueClearResult> {
  return apiPost("/admin/processing/queue/clear", {
    type,
    items: items.map(({ letterId, primarySourceRevision, jobStateToken }) => ({
      letterId,
      primarySourceRevision,
      jobStateToken,
    })),
  });
}

export async function retryProcessingJob(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
): Promise<{ message: string }> {
  return apiPost(
    "/admin/processing/queue/retry",
    processingActionBody(type, snapshot),
  );
}
