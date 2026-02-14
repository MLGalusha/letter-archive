import { apiPatch, apiPost } from "../client";

export interface BulkProcessResponse {
  queued: number;
  skipped: number;
  skipReasons?: Array<{ letterId: string; reason: string }>;
  processing?: boolean;
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

export async function bulkTranscribe(letterIds: string[]): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>("/admin/letters/bulk/transcribe", { letterIds });
}

export async function bulkExtractMetadata(
  letterIds: string[],
  skipConfirmationCheck = false,
): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>("/admin/letters/bulk/extract-metadata", {
    letterIds,
    skipConfirmationCheck,
  });
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
