/**
 * Admin API service
 */

import { apiGet, apiPost, apiPut } from './client';
import type { Letter } from '../types/Letter';

// ============================================================================
// UPLOAD
// ============================================================================

export interface UploadResult {
  filename: string;
  letterId: string;
  pageId: string;
  collectionCode: string;
  storagePath: string;
  alreadyExists: boolean;
}

export interface UploadError {
  filename: string;
  error: string;
}

export interface UploadResponse {
  success: number;
  failed: number;
  results: UploadResult[];
  errors?: UploadError[];
}

/**
 * Upload files to create letters/pages
 * @param force - If true, overwrites existing files instead of skipping
 */
export async function uploadFiles(files: File[], force = false): Promise<UploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const url = force ? '/admin/uploads?force=true' : '/admin/uploads';
  return apiPost<UploadResponse>(url, formData);
}

// ============================================================================
// LETTER MANAGEMENT
// ============================================================================

export interface UpdateLetterData {
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  extractedDate?: string | null;
  extractedDateConfidence?: 'exact' | 'unknown' | 'inferred' | null;
  tags?: string[] | null;
  visibility?: 'PUBLISHED' | 'HIDDEN';
  notes?: string | null;
}

/**
 * Update letter fields
 */
export async function updateLetter(letterId: string, data: UpdateLetterData): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, data);
}

/**
 * Publish a letter (set visibility to PUBLISHED)
 */
export async function publishLetter(letterId: string): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, { visibility: 'PUBLISHED' });
}

/**
 * Hide a letter (set visibility to HIDDEN)
 */
export async function hideLetter(letterId: string): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, { visibility: 'HIDDEN' });
}

// Note: deleteLetter is exported from letters.ts to avoid duplicate exports

/**
 * Re-enqueue a letter for processing
 */
export async function processLetter(letterId: string): Promise<{ message: string; letterId: string }> {
  return apiPost<{ message: string; letterId: string }>(`/admin/letters/${letterId}/process`);
}

/**
 * Confirm transcript is correct (triggers metadata extraction)
 */
export async function confirmTranscript(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/confirm-transcript`);
}

/**
 * Mark a letter as reviewed (admin sign-off)
 */
export async function markAsReviewed(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/review`);
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

export interface BulkProcessResponse {
  queued: number;
  skipped: number;
}

/**
 * Queue multiple letters for transcription
 */
export async function bulkTranscribe(letterIds: string[]): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>('/admin/letters/bulk/transcribe', { letterIds });
}

/**
 * Queue multiple letters for metadata extraction
 */
export async function bulkExtractMetadata(letterIds: string[]): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>('/admin/letters/bulk/extract-metadata', { letterIds });
}

export interface BulkUpdateResponse {
  message: string;
  updated: number;
}

/**
 * Reset transcriptions for selected letters (back to UPLOADED state)
 */
export async function bulkResetTranscriptions(letterIds: string[]): Promise<BulkUpdateResponse> {
  return apiPost<BulkUpdateResponse>('/admin/letters/bulk/reset-transcriptions', { letterIds });
}

/**
 * Clear metadata for selected letters (keeps transcript, resets to TRANSCRIBED)
 */
export async function bulkClearMetadata(letterIds: string[]): Promise<BulkUpdateResponse> {
  return apiPost<BulkUpdateResponse>('/admin/letters/bulk/clear-metadata', { letterIds });
}

// ============================================================================
// ON-DEMAND PROCESSING
// ============================================================================

export interface ProcessingStatus {
  isRunning: boolean;
  isPaused: boolean;
  shouldAbort: boolean;
  currentJob: { letterId: string; type: 'transcription' | 'metadata' } | null;
  completed: number;
  failed: number;
  total: number;
  errors: string[];
  lastCompletedAt: number | null;  // timestamp for live updates
}

export interface StartProcessingOptions {
  collectionCode?: string;
}

/**
 * Get current processing status
 */
export async function getProcessingStatus(): Promise<ProcessingStatus> {
  return apiGet<ProcessingStatus>('/admin/processing/status');
}

/**
 * Start transcription processing for eligible letters
 * @param options.collectionCode - Optional collection code to filter by
 */
export async function startTranscription(options?: StartProcessingOptions): Promise<{ message: string; total: number }> {
  return apiPost<{ message: string; total: number }>('/admin/processing/start-transcription', options || {});
}

/**
 * Start metadata extraction for eligible letters
 * @param options.collectionCode - Optional collection code to filter by
 */
export async function startMetadataExtraction(options?: StartProcessingOptions): Promise<{ message: string; total: number }> {
  return apiPost<{ message: string; total: number }>('/admin/processing/start-metadata', options || {});
}

/**
 * Pause processing
 */
export async function pauseProcessing(): Promise<{ message: string }> {
  return apiPost<{ message: string }>('/admin/processing/pause');
}

/**
 * Resume processing
 */
export async function resumeProcessing(): Promise<{ message: string }> {
  return apiPost<{ message: string }>('/admin/processing/resume');
}

/**
 * Abort processing
 */
export async function abortProcessing(): Promise<{ message: string }> {
  return apiPost<{ message: string }>('/admin/processing/abort');
}
