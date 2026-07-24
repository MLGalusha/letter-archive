import { apiPatch, apiPost } from "../client";

export interface BulkProcessResponse {
  queued: number;
  skipped: number;
  skipReasons?: Array<{ letterId: string; reason: string }>;
  unconfirmedCount?: number;
}

export interface BulkUpdateResponse {
  message: string;
  updated: number;
}

export interface BulkFieldUpdate {
  letterId: string;
  sender?: string;
  recipient?: string;
}

export async function bulkTranscribe(letterIds: string[], overwrite = false): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>("/admin/letters/bulk/transcribe", { letterIds, overwrite });
}

export async function bulkExtractMetadata(
  letterIds: string[],
): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>("/admin/letters/bulk/extract-metadata", { letterIds });
}

export async function bulkClearTranscriptions(letterIds: string[]): Promise<BulkUpdateResponse> {
  return apiPost<BulkUpdateResponse>("/admin/letters/bulk/clear-transcriptions", { letterIds });
}

export async function bulkClearMetadata(letterIds: string[]): Promise<BulkUpdateResponse> {
  return apiPost<BulkUpdateResponse>("/admin/letters/bulk/clear-metadata", { letterIds });
}

export async function bulkUpdateFields(updates: BulkFieldUpdate[]): Promise<BulkUpdateResponse> {
  return apiPatch<BulkUpdateResponse>("/admin/letters/bulk/update-fields", { updates });
}

export async function bulkUpdateContentVisibility(
  letterIds: string[],
  updates: { visibility?: 'PUBLISHED' | 'HIDDEN'; transcriptPublished?: boolean; metadataPublished?: boolean },
): Promise<{ updated: number }> {
  return apiPatch<{ updated: number }>("/admin/letters/bulk/content-visibility", {
    letterIds,
    ...updates,
  });
}
