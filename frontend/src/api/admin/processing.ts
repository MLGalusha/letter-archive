import { apiPost } from "../client";

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
