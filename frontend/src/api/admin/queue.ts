import { apiGet, apiPost } from "../client";
import type { ProcessingStatus } from "./processing";

export type QueueJobType = "transcription" | "metadata" | "entity_extraction";

export interface JobProgress {
  step: number;
  totalSteps: number;
  stepLabel: string;
}

export interface QueueActiveJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  type: QueueJobType;
  startedAt: string;
  progress: JobProgress | null;
}

export interface QueuedItem {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  queuedAt: string;
}

export interface QueueRecentJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  type: QueueJobType;
  status: "SUCCESS" | "FAILED" | "CLEARED";
  error?: string;
  completedAt: string;
}

export interface EntityResolutionPhases {
  phase1: {
    mergesExecuted: number;
    mergesQueued: number;
    genericsResolved: number;
    genericsQueued: number;
    genericsDeleted: number;
    fillsApplied: number;
    fillsQueued: number;
    relationshipCorrections: number;
    relationshipCorrectionsQueued: number;
  };
  phase2: {
    relationshipsVerified: number;
    correctionsApplied: number;
    correctionsQueued: number;
  };
  phase3: {
    biographiesGenerated: number;
    biographiesSkipped: number;
  };
}

export interface EntityResolutionStatus {
  isRunning: boolean;
  collectionCode: string | null;
  startedAt: number | null;
  completedAt: number | null;
  result: {
    collectionId: string;
    phases: EntityResolutionPhases;
    isStub: boolean;
    errors: string[];
  } | null;
  error: string | null;
}

export interface QueueStatus {
  active: QueueActiveJob[];
  queued: {
    transcription: QueuedItem[];
    metadata: QueuedItem[];
    entityExtraction: QueuedItem[];
  };
  recent: QueueRecentJob[];
  counts: {
    activeCount: number;
    queuedTranscription: number;
    queuedMetadata: number;
    queuedEntityExtraction: number;
    recentSuccessCount: number;
    recentFailedCount: number;
    recentClearedCount: number;
  };
  onDemandProcessing: ProcessingStatus;
  entityResolution: EntityResolutionStatus;
}

export async function getProcessingQueue(): Promise<QueueStatus> {
  return apiGet<QueueStatus>("/admin/processing/queue");
}

export async function removeFromQueue(
  letterId: string,
  type: QueueJobType,
): Promise<{ message: string }> {
  return apiPost<{ message: string }>("/admin/processing/queue/remove", { letterId, type });
}

export async function clearQueue(type: QueueJobType): Promise<{ message: string; cleared: number }> {
  return apiPost<{ message: string; cleared: number }>("/admin/processing/queue/clear", { type });
}

export async function retryFailed(
  letterId: string,
  type: QueueJobType,
): Promise<{ message: string }> {
  return apiPost<{ message: string }>("/admin/processing/queue/retry", { letterId, type });
}

export async function cancelActiveJob(
  letterId: string,
  type: QueueJobType,
): Promise<{ message: string }> {
  return apiPost<{ message: string }>("/admin/processing/cancel", { letterId, type });
}
