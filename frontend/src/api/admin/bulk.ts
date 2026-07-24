import { apiPatch, apiPost } from "../client";

export interface BulkSource {
  letterId: string;
  primarySourceRevision: number;
}

export type BulkSourceSkipCode =
  | "NOT_FOUND"
  | "SOURCE_CHANGED"
  | "INELIGIBLE"
  | "SOURCE_CHANGED_OR_INELIGIBLE"
  | "MUTATION_FAILED"
  | "SOURCE_NOT_OBSERVED";

export interface BulkSourceSkip {
  letterId: string;
  code: BulkSourceSkipCode;
  reason: string;
}

export interface BulkProcessResponse {
  requested: number;
  queued: number;
  skipped: number;
  skipReasons: BulkSourceSkip[];
  unconfirmedCount?: number;
}

export interface BulkClearResponse {
  requested: number;
  applied: number;
  skipped: number;
  skipReasons: BulkSourceSkip[];
}

export interface BulkUpdateResponse {
  requested: number;
  applied: number;
  skipped: number;
  updated: number;
  skipReasons: Array<{
    letterId: string;
    code: "NOT_FOUND" | "SOURCE_CHANGED" | "WRITE_CONFLICT" | "MUTATION_FAILED";
  }>;
}

export interface BulkFieldUpdate {
  letterId: string;
  primarySourceRevision: number;
  sender?: string;
  recipient?: string;
}

export type BulkContentVisibilityAction =
  | "PUBLISH_LETTER"
  | "HIDE_LETTER"
  | "PUBLISH_TRANSCRIPT"
  | "HIDE_TRANSCRIPT"
  | "PUBLISH_METADATA"
  | "HIDE_METADATA";

export interface BulkContentVisibilityResponse {
  requested: number;
  applied: number;
  skipped: number;
  skipReasons: Array<{
    letterId: string;
    code:
      | "SOURCE_CHANGED_OR_INELIGIBLE"
      | "SOURCE_NOT_OBSERVED"
      | "NOT_FOUND"
      | "MUTATION_FAILED";
  }>;
}

export type BulkPublicationSource = BulkSource;

export async function bulkTranscribe(
  sources: BulkSource[],
  overwrite = false,
): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>("/admin/letters/bulk/transcribe", {
    sources,
    overwrite,
  });
}

export async function bulkExtractMetadata(
  sources: BulkSource[],
): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>("/admin/letters/bulk/extract-metadata", {
    sources,
  });
}

export async function bulkClearTranscriptions(
  sources: BulkSource[],
): Promise<BulkClearResponse> {
  return apiPost<BulkClearResponse>("/admin/letters/bulk/clear-transcriptions", {
    sources,
  });
}

export async function bulkClearMetadata(
  sources: BulkSource[],
): Promise<BulkClearResponse> {
  return apiPost<BulkClearResponse>("/admin/letters/bulk/clear-metadata", {
    sources,
  });
}

export async function bulkUpdateFields(updates: BulkFieldUpdate[]): Promise<BulkUpdateResponse> {
  return apiPatch<BulkUpdateResponse>("/admin/letters/bulk/update-fields", { updates });
}

export async function bulkUpdateContentVisibility(
  sources: BulkPublicationSource[],
  action: BulkContentVisibilityAction,
): Promise<BulkContentVisibilityResponse> {
  return apiPatch<BulkContentVisibilityResponse>("/admin/letters/bulk/content-visibility", {
    sources,
    action,
  });
}
