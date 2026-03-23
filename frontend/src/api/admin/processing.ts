import { apiGet, apiPost } from "../client";

export interface ProcessingStatus {
  isRunning: boolean;
  isPaused: boolean;
  shouldAbort: boolean;
  currentJob: { letterId: string; type: "transcription" | "metadata" | "entity_extraction" | "entity_resolution" } | null;
  completed: number;
  failed: number;
  total: number;
  errors: string[];
  lastCompletedAt: number | null;
}

export interface StartProcessingOptions {
  collectionCode?: string;
  visibility?: "PUBLISHED" | "HIDDEN";
  search?: string;
  year?: number;
  month?: number;
  day?: number;
  dateFrom?: string;
  dateTo?: string;
}

export async function getProcessingStatus(): Promise<ProcessingStatus> {
  return apiGet<ProcessingStatus>("/admin/processing/status");
}

export async function startTranscription(
  options?: StartProcessingOptions,
): Promise<{ message: string; total: number }> {
  return apiPost<{ message: string; total: number }>(
    "/admin/processing/start-transcription",
    options || {},
  );
}

export async function startMetadataExtraction(
  options?: StartProcessingOptions,
): Promise<{ message: string; total: number }> {
  return apiPost<{ message: string; total: number }>("/admin/processing/start-metadata", options || {});
}

export async function startEntityExtraction(
  options?: StartProcessingOptions,
): Promise<{ message: string; total: number }> {
  return apiPost<{ message: string; total: number }>("/admin/processing/start-entities", options || {});
}

export async function startEntityResolution(
  collectionCode: string,
): Promise<{ message: string; total: number }> {
  return apiPost<{ message: string; total: number }>("/admin/processing/start-entity-resolution", { collectionCode });
}

export async function pauseProcessing(): Promise<{ message: string }> {
  return apiPost<{ message: string }>("/admin/processing/pause");
}

export async function resumeProcessing(): Promise<{ message: string }> {
  return apiPost<{ message: string }>("/admin/processing/resume");
}

export async function abortProcessing(): Promise<{ message: string }> {
  return apiPost<{ message: string }>("/admin/processing/abort");
}
