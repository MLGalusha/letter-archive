import { apiGet, apiPost } from "../client";
import type {
  ProcessingActionResult,
  ProcessingActiveJob,
  ProcessingJobActionRequest,
  ProcessingJobSnapshot,
  ProcessingJobType,
  ProcessingQueueClearRequest,
  ProcessingQueueClearResult,
  ProcessingQueueClearSkipCode,
  ProcessingQueueItem,
  ProcessingQueueStatus,
  ProcessingRecentJob,
  ProcessingWorkerState,
  ProcessingWorkerWakeResult,
} from "../../contracts/admin-wire-contracts.generated";

export type {
  ProcessingActionResult,
  ProcessingActiveJob,
  ProcessingJobActionRequest,
  ProcessingJobSnapshot,
  ProcessingJobType,
  ProcessingQueueClearRequest,
  ProcessingQueueClearResult,
  ProcessingQueueClearSkipCode,
  ProcessingQueueItem,
  ProcessingQueueStatus,
  ProcessingRecentJob,
  ProcessingWorkerState,
  ProcessingWorkerWakeResult,
};

function processingActionBody(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
): ProcessingJobActionRequest {
  return {
    type,
    letterId: snapshot.letterId,
    primarySourceRevision: snapshot.primarySourceRevision,
    jobStateToken: snapshot.jobStateToken,
  };
}

export async function getProcessingQueueStatus(signal?: AbortSignal): Promise<ProcessingQueueStatus> {
  return apiGet<ProcessingQueueStatus>("/admin/processing/queue", undefined, signal);
}

export async function wakeProcessingWorker(): Promise<ProcessingWorkerWakeResult> {
  return apiPost<ProcessingWorkerWakeResult>("/admin/processing/wake");
}

export async function cancelProcessingJob(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
): Promise<ProcessingActionResult> {
  return apiPost(
    "/admin/processing/cancel",
    processingActionBody(type, snapshot),
  );
}

export async function removeProcessingQueueItem(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
): Promise<ProcessingActionResult> {
  return apiPost(
    "/admin/processing/queue/remove",
    processingActionBody(type, snapshot),
  );
}

export async function clearProcessingQueue(
  type: ProcessingJobType,
  items: ProcessingJobSnapshot[],
): Promise<ProcessingQueueClearResult> {
  const body: ProcessingQueueClearRequest = {
    type,
    items: items.map(({ letterId, primarySourceRevision, jobStateToken }) => ({
      letterId,
      primarySourceRevision,
      jobStateToken,
    })),
  };
  return apiPost("/admin/processing/queue/clear", body);
}

export async function retryProcessingJob(
  type: ProcessingJobType,
  snapshot: ProcessingJobSnapshot,
): Promise<ProcessingActionResult> {
  return apiPost(
    "/admin/processing/queue/retry",
    processingActionBody(type, snapshot),
  );
}
