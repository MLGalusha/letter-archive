/**
 * Admin API service
 */

import { apiPost, apiPut, apiDelete } from './client';
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
  visibility?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
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

/**
 * Save as draft (set visibility to DRAFT)
 */
export async function saveDraft(letterId: string, data: UpdateLetterData): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, { ...data, visibility: 'DRAFT' });
}

/**
 * Delete a letter (soft delete)
 */
export async function deleteLetter(letterId: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/admin/letters/${letterId}`);
}

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
