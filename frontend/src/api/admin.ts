/**
 * Admin API service
 */

import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client';
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
 * Regenerate metadata for a letter
 * Queues the letter for fresh AI metadata extraction
 */
export async function regenerateMetadata(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-metadata`);
}

/**
 * Regenerate entity extraction for a letter
 * Runs only the entity extraction (Prompt 2) without re-running basic metadata
 */
export async function regenerateEntities(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-entities`);
}

// ============================================================================
// TWO-TRACK VERIFICATION
// ============================================================================

/**
 * Verify transcript - explicit user action to mark transcript as complete
 */
export async function verifyTranscript(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-transcript`);
}

/**
 * Unverify transcript - reset verification to allow re-verification
 */
export async function unverifyTranscript(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-transcript`);
}

/**
 * Verify metadata - explicit user action to mark metadata as complete
 */
export async function verifyMetadata(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-metadata`);
}

/**
 * Unverify metadata - reset verification to allow re-verification
 */
export async function unverifyMetadata(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-metadata`);
}

// ============================================================================
// VERSION HISTORY
// ============================================================================

export interface LetterVersion {
  versionNumber: number;
  content: Record<string, unknown>;
  source: 'ai' | 'human';
  createdAt: string;
}

export interface VersionHistoryResponse {
  versions: LetterVersion[];
}

/**
 * Get version history for a letter
 */
export async function getVersionHistory(
  letterId: string,
  fieldType: 'transcript' | 'metadata'
): Promise<VersionHistoryResponse> {
  return apiGet<VersionHistoryResponse>(`/admin/letters/${letterId}/versions`, { fieldType });
}

/**
 * Create a new version snapshot (for auto-save)
 */
export async function createVersion(
  letterId: string,
  fieldType: 'transcript' | 'metadata',
  content: string | Record<string, unknown>,
  source: 'ai' | 'human' = 'human'
): Promise<{ versionNumber: number; createdAt: string }> {
  return apiPost<{ versionNumber: number; createdAt: string }>(
    `/admin/letters/${letterId}/versions`,
    { fieldType, content, source }
  );
}

/**
 * Restore a previous version
 */
export async function restoreVersion(
  letterId: string,
  versionNumber: number,
  fieldType: 'transcript' | 'metadata'
): Promise<Letter> {
  return apiPost<Letter>(
    `/admin/letters/${letterId}/versions/${versionNumber}/restore?fieldType=${fieldType}`
  );
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

export interface BulkProcessResponse {
  queued: number;
  skipped: number;
  skipReasons?: Array<{ letterId: string; reason: string }>;
  processing?: boolean;
  unconfirmedCount?: number;
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
export async function bulkExtractMetadata(letterIds: string[], skipConfirmationCheck = false): Promise<BulkProcessResponse> {
  return apiPost<BulkProcessResponse>('/admin/letters/bulk/extract-metadata', { letterIds, skipConfirmationCheck });
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

export interface BulkFieldUpdate {
  letterId: string;
  sender?: string;
  recipient?: string;
}

/**
 * Bulk update sender/recipient fields for multiple letters
 */
export async function bulkUpdateFields(updates: BulkFieldUpdate[]): Promise<BulkUpdateResponse> {
  return apiPatch<BulkUpdateResponse>('/admin/letters/bulk/update-fields', { updates });
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
  visibility?: 'PUBLISHED' | 'HIDDEN';
  search?: string;
  year?: number;
  month?: number;
  day?: number;
  dateFrom?: string;
  dateTo?: string;
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

// ============================================================================
// PROCESSING QUEUE
// ============================================================================

export type QueueJobType = 'transcription' | 'metadata' | 'entity_extraction';

export interface QueueActiveJob {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
  type: QueueJobType;
  startedAt: string;
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
  status: 'SUCCESS' | 'FAILED';
  error?: string;
  completedAt: string;
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
  };
  onDemandProcessing: ProcessingStatus;
}

/**
 * Get full queue status with active, queued, and recent jobs
 */
export async function getProcessingQueue(): Promise<QueueStatus> {
  return apiGet<QueueStatus>('/admin/processing/queue');
}

/**
 * Remove a letter from the processing queue (only PENDING items)
 */
export async function removeFromQueue(letterId: string, type: QueueJobType): Promise<{ message: string }> {
  return apiPost<{ message: string }>('/admin/processing/queue/remove', { letterId, type });
}

/**
 * Clear all queued items of a given type
 */
export async function clearQueue(type: QueueJobType): Promise<{ message: string; cleared: number }> {
  return apiPost<{ message: string; cleared: number }>('/admin/processing/queue/clear', { type });
}

/**
 * Retry a failed job (resets status to PENDING)
 */
export async function retryFailed(letterId: string, type: QueueJobType): Promise<{ message: string }> {
  return apiPost<{ message: string }>('/admin/processing/queue/retry', { letterId, type });
}

// ============================================================================
// METADATA RE-SYNC
// ============================================================================

export interface ResyncRequest {
  oldSender: string | null;
  newSender: string | null;
  oldRecipient: string | null;
  newRecipient: string | null;
}

export interface ResyncDecision {
  shouldUpdateSummary: boolean;
  shouldUpdateHook: boolean;
  shouldCreateSenderPerson: boolean;
  shouldCreateRecipientPerson: boolean;
  shouldUpdateRelationship: boolean;
  shouldUpdateQuoteContexts: boolean;
  issues: string[];
  reason: string;
}

export interface ResyncResponse {
  letter: Letter;
  resync: {
    wasUpdated: boolean;
    updatedFields: {
      summary: boolean;
      hook: boolean;
      senderPerson: boolean;
      recipientPerson: boolean;
      relationshipType: boolean;
      quoteContexts: boolean;
    };
    decision: ResyncDecision;
  };
}

/**
 * Re-sync derived fields (summary/hook) after identity changes
 *
 * Uses a two-model approach:
 * 1. GPT-4o-mini decides what needs updating
 * 2. GPT-5.2 regenerates affected fields
 */
export async function resyncMetadata(
  letterId: string,
  change: ResyncRequest
): Promise<ResyncResponse> {
  return apiPost<ResyncResponse>(`/admin/letters/${letterId}/resync`, change);
}

export interface ResyncCheckResponse {
  needsResync: boolean;
  decision: ResyncDecision;
}

/**
 * Check if derived fields need updating (decision only, no changes)
 *
 * Uses GPT-4o-mini to make a quick decision. Call this in the background
 * when identity/date fields change to pre-check if resync is needed.
 */
export async function checkResyncNeeded(
  letterId: string,
  change: ResyncRequest
): Promise<ResyncCheckResponse> {
  return apiPost<ResyncCheckResponse>(`/admin/letters/${letterId}/resync-check`, change);
}

// ============================================================================
// EXTRA CONTENT TRANSCRIPTION
// ============================================================================

export interface TranscribeExtrasResponse {
  letter: Letter;
  transcribedCount: number;
  extraContentStatus: 'EMPTY' | 'AI_DRAFT';
}

/**
 * Transcribe extra content (telegrams, covers, ephemera) for a letter
 */
export async function transcribeExtras(letterId: string): Promise<TranscribeExtrasResponse> {
  return apiPost<TranscribeExtrasResponse>(`/admin/letters/${letterId}/transcribe-extras`);
}

/**
 * Update extra content transcription
 */
export async function updateExtraContent(
  letterId: string,
  extraContentTranscript: string
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/extra-content`, { extraContentTranscript });
}

/**
 * Verify extra content transcription
 */
export async function verifyExtraContent(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-extra-content`);
}

/**
 * Unverify extra content transcription
 */
export async function unverifyExtraContent(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-extra-content`);
}

/**
 * Update AI notes for a letter
 */
export async function updateAiNotes(letterId: string, aiNotes: string): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/ai-notes`, { aiNotes });
}

// ============================================================================
// TRANSCRIPTION
// ============================================================================

export interface TranscribeLetterResponse {
  letter: Letter;
  transcribed: {
    pageCount: number;
    textLength: number;
  };
}

/**
 * Transcribe only the letter content (no extras)
 *
 * This is for manual transcription of just the letter pages (type='L').
 * Does NOT transcribe extra content (T, C, E types).
 */
export async function transcribeLetter(letterId: string): Promise<TranscribeLetterResponse> {
  return apiPost<TranscribeLetterResponse>(`/admin/letters/${letterId}/transcribe-letter`);
}

export interface RegenerateTranscriptionResponse {
  letter: Letter;
  regenerated: {
    mainTranscript: boolean;
    extras: boolean;
    extrasCount: number;
  };
}

/**
 * Regenerate transcription for a letter (includes extras)
 *
 * Re-runs the AI transcription on the letter images, overwriting any existing transcription.
 * Also re-transcribes extra content (telegrams, covers, ephemera).
 * This is called during automatic upload processing.
 */
export async function regenerateTranscription(
  letterId: string,
  includeExtras = true
): Promise<RegenerateTranscriptionResponse> {
  const url = includeExtras
    ? `/admin/letters/${letterId}/regenerate-transcription?includeExtras=true`
    : `/admin/letters/${letterId}/regenerate-transcription`;
  return apiPost<RegenerateTranscriptionResponse>(url);
}

// ============================================================================
// LINKED ENTITY EDITING
// ============================================================================

/**
 * Update a linked person's canonical name
 */
export async function updateLinkedPerson(
  letterId: string,
  linkId: string,
  canonicalName: string
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/linked-persons/${linkId}`, { canonicalName });
}

/**
 * Update a linked place's canonical name
 */
export async function updateLinkedPlace(
  letterId: string,
  linkId: string,
  canonicalName: string
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/linked-places/${linkId}`, { canonicalName });
}

/**
 * Add a linked person to a letter
 */
export async function addLinkedPerson(
  letterId: string,
  name: string,
  role: 'sender' | 'recipient' | 'mentioned'
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/linked-persons`, { name, role });
}

/**
 * Add a linked place to a letter
 */
export async function addLinkedPlace(
  letterId: string,
  name: string,
  role: 'written_from' | 'mentioned' | 'destination'
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/linked-places`, { name, role });
}

/**
 * Remove a linked person from a letter
 */
export async function removeLinkedPerson(
  letterId: string,
  linkId: string
): Promise<Letter> {
  return apiDelete<Letter>(`/admin/letters/${letterId}/linked-persons/${linkId}`);
}

/**
 * Remove a linked place from a letter
 */
export async function removeLinkedPlace(
  letterId: string,
  linkId: string
): Promise<Letter> {
  return apiDelete<Letter>(`/admin/letters/${letterId}/linked-places/${linkId}`);
}
