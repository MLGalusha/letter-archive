/**
 * Letter Operations Service
 *
 * Extracted business logic from admin letters route handlers.
 * Covers: bulk operations, single letter updates, version history,
 * two-track verification, transcription, extra content, linked entities,
 * and metadata resync.
 */

import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  db,
  letters,
  letterVersions,
  letterPersons,
  letterPlaces,
  canonicalPersons,
  canonicalPlaces,
  personRelationships,
  type RelationshipType as DBRelationshipType,
} from '../db/index.js';
import { getLetterById } from '../services/letters.js';
import { runTranscription } from '../pipeline/processor.js';
import { runMetadataExtractionV2, runEntityExtractionOnly } from '../pipeline/metadataV2.js';
import { resyncMetadata, auditMetadata, type MetadataAuditContext, type LinkedPersonInfo } from '../ai/resync.js';
import { checkExtraContentForText, transcribeExtraContent, transcribeImage } from '../ai/openai.js';
import { getAbsoluteStoragePath } from '../services/storage.js';
import { createLogger } from '../utils/logger.js';
import {
  getProcessingStatus,
  resetProcessingState,
  processLettersAsync,
} from './processing-queue.js';
import { syncLetterParticipantsFromMetadata } from './entities/participant-sync.js';

const log = createLogger({ module: 'letter-operations' });

// ============================================================================
// ENUM VALIDATION HELPERS
// ============================================================================

/** Content status enum values for validation */
export const contentStatusValues = ['EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED'] as const;

/** Valid relationship types for the database enum */
export const VALID_RELATIONSHIP_TYPES = [
  'spouse', 'fiancé/fiancée', 'romantic-partner', 'parent', 'child', 'sibling',
  'grandparent', 'grandchild', 'aunt/uncle', 'nephew/niece', 'cousin', 'in-law',
  'friend', 'acquaintance', 'business-associate', 'employer', 'employee', 'unknown',
] as const;

export type RelationshipType = typeof VALID_RELATIONSHIP_TYPES[number];

/**
 * Normalize and validate AI-generated relationship type to match database enum.
 * Returns null if the value cannot be mapped to a valid enum.
 */
export function normalizeRelationshipType(value: string | null | undefined): RelationshipType | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();

  // Direct match
  if (VALID_RELATIONSHIP_TYPES.includes(normalized as RelationshipType)) {
    return normalized as RelationshipType;
  }

  // Common AI variations that need mapping
  const mappings: Record<string, RelationshipType> = {
    'romantic partners': 'romantic-partner',
    'romantic partner': 'romantic-partner',
    'partners': 'romantic-partner',
    'partner': 'romantic-partner',
    'fiance': 'fiancé/fiancée',
    'fiancee': 'fiancé/fiancée',
    'fianc': 'fiancé/fiancée',
    'engaged': 'fiancé/fiancée',
    'married': 'spouse',
    'husband': 'spouse',
    'wife': 'spouse',
    'mom': 'parent',
    'dad': 'parent',
    'mother': 'parent',
    'father': 'parent',
    'son': 'child',
    'daughter': 'child',
    'brother': 'sibling',
    'sister': 'sibling',
    'grandmother': 'grandparent',
    'grandfather': 'grandparent',
    'grandson': 'grandchild',
    'granddaughter': 'grandchild',
    'aunt': 'aunt/uncle',
    'uncle': 'aunt/uncle',
    'niece': 'nephew/niece',
    'nephew': 'nephew/niece',
    'business associate': 'business-associate',
    'colleague': 'business-associate',
    'coworker': 'business-associate',
    'co-worker': 'business-associate',
    'boss': 'employer',
    'manager': 'employer',
  };

  if (mappings[normalized]) {
    return mappings[normalized];
  }

  // If we can't map it, return unknown rather than failing
  log.warn({ original: value, normalized }, 'Unknown relationship type from AI, defaulting to unknown');
  return 'unknown';
}

/** Map letter type codes to human-readable document types */
export function getDocumentTypeFromCode(type: string): string {
  switch (type) {
    case 'T':
      return 'telegram';
    case 'C':
      return 'cover/envelope';
    case 'E':
      return 'ephemera';
    case 'N':
      return 'card';
    case 'P':
      return 'photo';
    default:
      return 'document';
  }
}

// ============================================================================
// SHARED TYPES
// ============================================================================

export interface BulkResult {
  queued: number;
  skipped: number;
  skipReasons: Array<{ letterId: string; reason: string }>;
  processing: boolean;
  unconfirmedCount?: number;
}

export interface BulkClearResult {
  message: string;
  updated: number;
}

export interface BulkUpdateFieldEntry {
  letterId: string;
  sender?: string;
  recipient?: string;
}

export interface BulkUpdateFieldsResult {
  message: string;
  updated: number;
}

export interface UpdateLetterInput {
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

export interface UpdateLetterResult {
  dbUpdates: Record<string, unknown>;
  workflowChange?: string;
}

export interface VersionInput {
  fieldType: 'transcript' | 'metadata';
  content: string | Record<string, unknown>;
  source: 'ai' | 'human';
}

export interface VersionResult {
  versionNumber: number;
  createdAt: string;
}

export interface ResyncInput {
  oldSender: string | null;
  newSender: string | null;
  oldRecipient: string | null;
  newRecipient: string | null;
}

export interface ResyncCheckResult {
  needsResync: boolean;
  decision: Awaited<ReturnType<typeof auditMetadata>>;
}

export interface ResyncResult {
  wasUpdated: boolean;
  updatedFields: {
    summary: boolean;
    hook: boolean;
    senderPerson: boolean;
    recipientPerson: boolean;
    relationshipType: boolean;
    quoteContexts: boolean;
  };
  decision: unknown;
}

export interface TranscriptionRegenerateResult {
  mainTranscript: boolean;
  extras: boolean;
  extrasCount: number;
}

export interface TranscribeLetterOnlyResult {
  pageCount: number;
  textLength: number;
}

export interface TranscribeExtrasResult {
  transcribedCount: number;
  extraContentStatus: string;
  message?: string;
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Queue multiple letters for transcription.
 *
 * Only processes L-type letters with workflow='UPLOADED' and at least one page.
 * Returns detailed skip reasons for any letters that cannot be processed.
 */
export async function bulkTranscribe(letterIds: string[]): Promise<BulkResult> {
  log.info({ requestedCount: letterIds.length }, 'Bulk transcribe request received');

  // Fetch ALL requested letters with pages so we can report skip reasons
  const allRequested = await db.query.letters.findMany({
    where: and(
      inArray(letters.id, letterIds)
    ),
    with: { pages: true },
  });

  const foundIds = new Set(allRequested.map(l => l.id));
  const eligible: typeof allRequested = [];
  const skipReasons: Array<{ letterId: string; reason: string }> = [];

  // Report letters not found
  for (const id of letterIds) {
    if (!foundIds.has(id)) {
      skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
    }
  }

  // Check each letter individually for eligibility
  for (const letter of allRequested) {
    if (letter.type !== 'L') {
      skipReasons.push({ letterId: letter.id, reason: `Type is '${letter.type}' (only type 'L' supported)` });
    } else if (letter.workflow !== 'UPLOADED') {
      skipReasons.push({ letterId: letter.id, reason: `Already past upload stage (workflow: ${letter.workflow})` });
    } else if (letter.pages.length === 0) {
      skipReasons.push({ letterId: letter.id, reason: 'No page images uploaded' });
    } else if (letter.transcriptionStatus === 'RUNNING') {
      skipReasons.push({ letterId: letter.id, reason: 'Transcription already running' });
    } else {
      eligible.push(letter);
    }
  }

  if (eligible.length === 0) {
    log.info({ skipped: skipReasons.length }, 'Bulk transcribe: no eligible letters');
    return { queued: 0, skipped: skipReasons.length, skipReasons, processing: false };
  }

  // Set status to PENDING before processing
  for (const letter of eligible) {
    await db.update(letters).set({
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letter.id));
  }

  if (getProcessingStatus().isRunning) {
    // Another batch is already running -- letters are queued as PENDING
    log.info(
      { queued: eligible.length, skipped: skipReasons.length },
      'Bulk transcribe queued (another batch running)',
    );
    return { queued: eligible.length, skipped: skipReasons.length, skipReasons, processing: false };
  }

  // Start processing immediately
  resetProcessingState(eligible.length);
  processLettersAsync(eligible.map(l => l.id), 'transcription');

  log.info(
    { queued: eligible.length, skipped: skipReasons.length },
    'Bulk transcribe started immediately',
  );
  return { queued: eligible.length, skipped: skipReasons.length, skipReasons, processing: true };
}

/**
 * Queue multiple letters for metadata extraction.
 *
 * Only processes L-type letters with workflow='TRANSCRIBED' and confirmed transcript.
 * Returns detailed skip reasons for any letters that cannot be processed.
 */
export async function bulkExtractMetadata(
  letterIds: string[],
  skipConfirmationCheck = false,
): Promise<BulkResult> {
  // Fetch ALL requested letters so we can report skip reasons
  const allRequested = await db.query.letters.findMany({
    where: and(
      inArray(letters.id, letterIds)
    ),
  });

  const foundIds = new Set(allRequested.map(l => l.id));
  const eligible: typeof allRequested = [];
  const skipReasons: Array<{ letterId: string; reason: string }> = [];
  let unconfirmedCount = 0;

  // Report letters not found
  for (const id of letterIds) {
    if (!foundIds.has(id)) {
      skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
    }
  }

  // Check each letter individually for eligibility
  for (const letter of allRequested) {
    if (letter.type !== 'L') {
      skipReasons.push({ letterId: letter.id, reason: `Type is '${letter.type}' (only type 'L' supported)` });
    } else if (letter.workflow === 'UPLOADED') {
      skipReasons.push({ letterId: letter.id, reason: 'Needs transcription first (workflow: UPLOADED)' });
    } else if (letter.workflow !== 'TRANSCRIBED') {
      skipReasons.push({ letterId: letter.id, reason: `Already processed (workflow: ${letter.workflow})` });
    } else if (!letter.transcriptConfirmedAt && !skipConfirmationCheck) {
      unconfirmedCount++;
      skipReasons.push({ letterId: letter.id, reason: 'Transcript not yet confirmed' });
    } else if (letter.metadataStatus === 'RUNNING') {
      skipReasons.push({ letterId: letter.id, reason: 'Metadata extraction already running' });
    } else {
      eligible.push(letter);
    }
  }

  // If there are unconfirmed letters and user hasn't confirmed, return early
  if (unconfirmedCount > 0 && !skipConfirmationCheck && eligible.length === 0) {
    return {
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  if (eligible.length === 0) {
    return {
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  // Set status to PENDING before processing
  for (const letter of eligible) {
    await db.update(letters).set({
      metadataStatus: 'PENDING',
      metadataError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letter.id));
  }

  if (getProcessingStatus().isRunning) {
    // Another batch is already running -- letters are queued as PENDING
    return {
      queued: eligible.length,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  // Start processing immediately
  resetProcessingState(eligible.length);
  processLettersAsync(eligible.map(l => l.id), 'metadata');

  return {
    queued: eligible.length,
    skipped: skipReasons.length,
    skipReasons,
    processing: true,
    unconfirmedCount,
  };
}

/**
 * Clear transcriptions for selected letters.
 *
 * Sets workflow back to UPLOADED, clears all transcription text (including extra content),
 * clears all metadata and entity links since they depend on transcription.
 */
export async function bulkClearTranscriptions(letterIds: string[]): Promise<BulkClearResult> {
  log.info({ count: letterIds.length }, 'Bulk clear transcriptions requested');

  // Delete entity links for these letters
  await db.delete(letterPersons).where(inArray(letterPersons.letterId, letterIds));
  await db.delete(letterPlaces).where(inArray(letterPlaces.letterId, letterIds));
  await db.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, letterIds));

  // Update all selected letters - clear everything
  await db.update(letters).set({
    workflow: 'UPLOADED',
    // Clear transcription
    transcriptionText: null,
    transcriptConfirmedAt: null,
    transcriptConfirmedBy: null,
    transcriptionStatus: 'PENDING',
    transcriptionError: null,
    // Clear extra content transcription
    extraContentTranscript: null,
    extraContentStatus: 'EMPTY',
    extraContentVerifiedAt: null,
    extraContentVerifiedBy: null,
    // Clear metadata (depends on transcription)
    metadataStatus: 'PENDING',
    metadataError: null,
    sender: null,
    recipient: null,
    locationWritten: null,
    hook: null,
    summary: null,
    extractedDate: null,
    extractedDateConfidence: null,
    tags: null,
    // Clear V2 metadata fields
    emotionalTone: null,
    senderRecipientRelationship: null,
    primaryTopics: null,
    aiNotes: null,
    // Clear entity extraction
    entityExtractionJson: null,
    entityExtractionStatus: 'PENDING',
    entityExtractionError: null,
    // Reset two-track content status
    transcriptStatus: 'EMPTY',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    metadataContentStatus: 'EMPTY',
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    updatedAt: new Date(),
  }).where(
    and(
      inArray(letters.id, letterIds)
    ),
  );

  log.info({ updated: letterIds.length }, 'Bulk clear transcriptions completed');

  return {
    message: 'Transcriptions cleared',
    updated: letterIds.length,
  };
}

/**
 * Bulk update sender/recipient fields.
 *
 * Used by the copy-paste edit mode in the admin dashboard.
 */
export async function bulkUpdateFields(updates: BulkUpdateFieldEntry[]): Promise<BulkUpdateFieldsResult> {
  log.info({ updateCount: updates.length }, 'Bulk update fields request received');

  let successCount = 0;
  for (const update of updates) {
    const dbUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    const sender = update.sender !== undefined ? (update.sender || null) : undefined;
    const recipient = update.recipient !== undefined ? (update.recipient || null) : undefined;

    if (sender !== undefined) {
      dbUpdates.sender = sender;
    }
    if (recipient !== undefined) {
      dbUpdates.recipient = recipient;
    }

    // Only update if there are actual field changes
    if (Object.keys(dbUpdates).length > 1) {
      await db.update(letters).set(dbUpdates).where(
        and(
          eq(letters.id, update.letterId)
        ),
      );

      if (sender !== undefined || recipient !== undefined) {
        await syncLetterParticipantsFromMetadata({
          letterId: update.letterId,
          sender,
          recipient,
        });
      }

      successCount++;
    }
  }

  log.info({ updated: successCount }, 'Bulk update fields completed');

  return {
    message: 'Fields updated',
    updated: successCount,
  };
}

/**
 * Clear metadata for selected letters.
 *
 * Clears all metadata fields (including V2 fields and entity links) but keeps
 * the transcription intact. Resets workflow to TRANSCRIBED.
 */
export async function bulkClearMetadata(letterIds: string[]): Promise<BulkClearResult> {
  // Delete entity links for these letters
  await db.delete(letterPersons).where(inArray(letterPersons.letterId, letterIds));
  await db.delete(letterPlaces).where(inArray(letterPlaces.letterId, letterIds));
  await db.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, letterIds));

  // Update all selected letters - clear all metadata but keep transcription
  await db.update(letters).set({
    sender: null,
    recipient: null,
    locationWritten: null,
    hook: null,
    summary: null,
    extractedDate: null,
    extractedDateConfidence: null,
    tags: null,
    metadataStatus: 'PENDING',
    metadataError: null,
    // Clear V2 metadata fields
    emotionalTone: null,
    senderRecipientRelationship: null,
    primaryTopics: null,
    aiNotes: null,
    // Clear entity extraction
    entityExtractionJson: null,
    entityExtractionStatus: 'PENDING',
    entityExtractionError: null,
    // Reset metadata two-track status (keep transcript status intact)
    metadataContentStatus: 'EMPTY',
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    // Set workflow to TRANSCRIBED if it was past that
    workflow: 'TRANSCRIBED',
    updatedAt: new Date(),
  }).where(
    and(
      inArray(letters.id, letterIds)
    ),
  );

  return {
    message: 'Metadata cleared',
    updated: letterIds.length,
  };
}

// ============================================================================
// SINGLE LETTER UPDATE
// ============================================================================

/**
 * Update a letter's fields and handle workflow/status transitions.
 *
 * Returns the computed database updates object so the route handler
 * can apply them and log the workflow change. Returns null if the letter
 * does not exist.
 */
export async function buildLetterUpdates(
  letterId: string,
  updates: UpdateLetterInput,
): Promise<UpdateLetterResult | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  // Build update object
  const dbUpdates: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.transcriptionText !== undefined) {
    dbUpdates.transcriptionText = updates.transcriptionText;
  }
  if (updates.sender !== undefined) {
    dbUpdates.sender = updates.sender;
  }
  if (updates.recipient !== undefined) {
    dbUpdates.recipient = updates.recipient;
  }
  if (updates.locationWritten !== undefined) {
    dbUpdates.locationWritten = updates.locationWritten;
  }
  if (updates.hook !== undefined) {
    dbUpdates.hook = updates.hook;
  }
  if (updates.summary !== undefined) {
    dbUpdates.summary = updates.summary;
  }
  if (updates.extractedDate !== undefined) {
    // Only set extractedDate if it's a valid YYYY-MM-DD format or null
    if (updates.extractedDate === null || updates.extractedDate === '') {
      dbUpdates.extractedDate = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(updates.extractedDate)) {
      dbUpdates.extractedDate = updates.extractedDate;
    }
    // Otherwise, skip updating extractedDate (it's a display format we can't use)
  }
  if (updates.notes !== undefined) {
    dbUpdates.notes = updates.notes;
  }
  if (updates.extractedDateConfidence !== undefined) {
    dbUpdates.extractedDateConfidence = updates.extractedDateConfidence;
  }
  if (updates.tags !== undefined) {
    dbUpdates.tags = updates.tags;
  }
  if (updates.visibility !== undefined) {
    dbUpdates.visibility = updates.visibility;
    // If publishing, mark as reviewed
    if (updates.visibility === 'PUBLISHED') {
      dbUpdates.reviewedAt = new Date();
      dbUpdates.reviewedBy = 'admin'; // TODO: Use actual user when auth is implemented
    }
  }

  // =========================================================================
  // TWO-TRACK STATUS TRANSITIONS (new system)
  // =========================================================================

  // Transcript edit: AI_DRAFT -> EDITED (but not VERIFIED -> EDITED)
  if (updates.transcriptionText !== undefined) {
    const currentTranscriptStatus = existingLetter.transcriptStatus;
    if (currentTranscriptStatus === 'AI_DRAFT') {
      dbUpdates.transcriptStatus = 'EDITED';
      log.debug({ letterId }, 'Transcript status: AI_DRAFT -> EDITED');
    }
  }

  // Metadata edit: AI_DRAFT -> EDITED
  const hasMetadataUpdate = [
    updates.sender,
    updates.recipient,
    updates.locationWritten,
    updates.summary,
    updates.hook,
    updates.extractedDate,
  ].some((field) => field !== undefined);

  if (hasMetadataUpdate) {
    const currentMetadataStatus = existingLetter.metadataContentStatus;
    if (currentMetadataStatus === 'AI_DRAFT') {
      dbUpdates.metadataContentStatus = 'EDITED';
      log.debug({ letterId }, 'Metadata status: AI_DRAFT -> EDITED');
    }
  }

  // =========================================================================
  // LEGACY WORKFLOW TRANSITIONS (kept for backward compatibility)
  // =========================================================================
  const currentWorkflow = existingLetter.workflow;

  // If admin adds transcription to an UPLOADED letter -> TRANSCRIBED
  if (updates.transcriptionText !== undefined) {
    const hasTranscription = updates.transcriptionText && updates.transcriptionText.trim().length > 0;
    if (hasTranscription && currentWorkflow === 'UPLOADED') {
      dbUpdates.workflow = 'TRANSCRIBED';
    } else if (!hasTranscription && ['TRANSCRIBED', 'METADATA_DRAFTED', 'METADATA_EXTRACTING'].includes(currentWorkflow)) {
      // Admin cleared transcription -> revert to UPLOADED
      dbUpdates.workflow = 'UPLOADED';
    }
  }

  // If admin adds any metadata to a TRANSCRIBED letter -> METADATA_DRAFTED
  if (hasMetadataUpdate) {
    const workflowToCheck = (dbUpdates.workflow as string) || currentWorkflow;
    if (workflowToCheck === 'TRANSCRIBED') {
      dbUpdates.workflow = 'METADATA_DRAFTED';
    }
  }

  // Apply updates
  await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

  if (updates.sender !== undefined || updates.recipient !== undefined) {
    await syncLetterParticipantsFromMetadata({
      letterId,
      sender: updates.sender ?? null,
      recipient: updates.recipient ?? null,
    });
  }

  const workflowChange = dbUpdates.workflow
    ? `${currentWorkflow} -> ${dbUpdates.workflow}`
    : undefined;

  log.info(
    { letterId, workflowChange, visibilityChange: updates.visibility },
    'Letter updated',
  );

  return { dbUpdates, workflowChange };
}

// ============================================================================
// VERSION HISTORY
// ============================================================================

/**
 * Get version history for a letter field (transcript or metadata).
 */
export async function getVersions(
  letterId: string,
  fieldType: 'transcript' | 'metadata',
): Promise<Array<{ versionNumber: number; content: unknown; source: string; createdAt: string }> | null> {
  // Verify letter exists
  const letter = await getLetterById(letterId);
  if (!letter) return null;

  const versions = await db.query.letterVersions.findMany({
    where: and(
      eq(letterVersions.letterId, letterId),
      eq(letterVersions.fieldType, fieldType),
    ),
    orderBy: (v, { desc }) => [desc(v.versionNumber)],
  });

  return versions.map(v => ({
    versionNumber: v.versionNumber,
    content: v.content,
    source: v.source,
    createdAt: v.createdAt.toISOString(),
  }));
}

/**
 * Create a new version snapshot for auto-save.
 * Cleans up old versions (keeps last 48 hours, always keeps version 1).
 */
export async function createVersion(
  letterId: string,
  input: VersionInput,
): Promise<VersionResult | null> {
  // Verify letter exists
  const letter = await getLetterById(letterId);
  if (!letter) return null;

  const { fieldType, content, source } = input;

  // Get the next version number
  const existingVersions = await db.query.letterVersions.findMany({
    where: and(
      eq(letterVersions.letterId, letterId),
      eq(letterVersions.fieldType, fieldType),
    ),
    orderBy: (v, { desc }) => [desc(v.versionNumber)],
    limit: 1,
  });

  const nextVersionNumber = existingVersions.length > 0
    ? existingVersions[0].versionNumber + 1
    : 1;

  // Create the version
  const [newVersion] = await db.insert(letterVersions).values({
    letterId,
    fieldType,
    versionNumber: nextVersionNumber,
    content: typeof content === 'string' ? { text: content } : content,
    source,
  }).returning();

  log.debug({ letterId, fieldType, versionNumber: nextVersionNumber }, 'Version created');

  // Cleanup old versions (keep last 48 hours)
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await db.delete(letterVersions).where(
    and(
      eq(letterVersions.letterId, letterId),
      eq(letterVersions.fieldType, fieldType),
      sql`${letterVersions.createdAt} < ${cutoff}`,
      // Always keep at least version 1 (AI original)
      sql`${letterVersions.versionNumber} > 1`,
    ),
  );

  return {
    versionNumber: newVersion.versionNumber,
    createdAt: newVersion.createdAt.toISOString(),
  };
}

/**
 * Restore a previous version by copying its content back to the letter.
 *
 * Returns true if the restore succeeded, null if letter not found, false if version not found.
 */
export async function restoreVersion(
  letterId: string,
  versionNumber: number,
  fieldType: 'transcript' | 'metadata',
): Promise<boolean | null> {
  // Verify letter exists
  const letter = await getLetterById(letterId);
  if (!letter) return null;

  // Find the version to restore
  const version = await db.query.letterVersions.findFirst({
    where: and(
      eq(letterVersions.letterId, letterId),
      eq(letterVersions.fieldType, fieldType),
      eq(letterVersions.versionNumber, versionNumber),
    ),
  });

  if (!version) return false;

  // Restore the content
  const content = version.content as Record<string, unknown>;

  if (fieldType === 'transcript') {
    await db.update(letters).set({
      transcriptionText: (content.text as string) || '',
      transcriptStatus: 'EDITED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));
  } else {
    await db.update(letters).set({
      sender: (content.sender as string) || null,
      recipient: (content.recipient as string) || null,
      locationWritten: (content.locationWritten as string) || null,
      hook: (content.hook as string) || null,
      summary: (content.summary as string) || null,
      metadataContentStatus: 'EDITED',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    await syncLetterParticipantsFromMetadata({
      letterId,
      sender: (content.sender as string) || null,
      recipient: (content.recipient as string) || null,
    });
  }

  log.info({ letterId, fieldType, restoredVersion: versionNumber }, 'Version restored');
  return true;
}

// ============================================================================
// TWO-TRACK VERIFICATION
// ============================================================================

/**
 * Mark transcript as verified.
 * Returns null if the letter does not exist.
 */
export async function verifyTranscript(letterId: string): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    transcriptStatus: 'VERIFIED',
    transcriptVerifiedAt: new Date(),
    transcriptVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, previousStatus: existingLetter.transcriptStatus }, 'Transcript verified');
  return { previousStatus: existingLetter.transcriptStatus };
}

/**
 * Reset transcript verification (VERIFIED -> EDITED).
 * Returns null if letter not found, throws if not in VERIFIED state.
 */
export async function unverifyTranscript(letterId: string): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  if (existingLetter.transcriptStatus !== 'VERIFIED') {
    const err = new Error('Transcript is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.transcriptStatus;
    throw err;
  }

  await db.update(letters).set({
    transcriptStatus: 'EDITED',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId }, 'Transcript verification removed');
  return true;
}

/**
 * Mark metadata as verified.
 * Returns null if the letter does not exist.
 */
export async function verifyMetadata(letterId: string): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    metadataContentStatus: 'VERIFIED',
    metadataVerifiedAt: new Date(),
    metadataVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
    // Also mark as reviewed for legacy compatibility
    reviewedAt: new Date(),
    reviewedBy: 'admin',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, previousStatus: existingLetter.metadataContentStatus }, 'Metadata verified');
  return { previousStatus: existingLetter.metadataContentStatus };
}

/**
 * Reset metadata verification (VERIFIED -> EDITED).
 * Returns null if letter not found, throws if not in VERIFIED state.
 */
export async function unverifyMetadata(letterId: string): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  if (existingLetter.metadataContentStatus !== 'VERIFIED') {
    const err = new Error('Metadata is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.metadataContentStatus;
    throw err;
  }

  await db.update(letters).set({
    metadataContentStatus: 'EDITED',
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId }, 'Metadata verification removed');
  return true;
}

// ============================================================================
// TRANSCRIPTION
// ============================================================================

/**
 * Regenerate transcription for a letter, optionally including extra content.
 *
 * Resets transcription fields, runs the pipeline synchronously, and optionally
 * re-transcribes related T/C/E items.
 *
 * Returns null if letter not found.
 * Throws if letter type is not 'L'.
 */
export async function regenerateTranscription(
  letterId: string,
  includeExtras: boolean,
): Promise<TranscriptionRegenerateResult | null> {
  // Fetch the letter
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
  });

  if (!letter) return null;

  if (letter.type !== 'L') {
    const err = new Error('Can only regenerate transcription for letter type (L)') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  log.info({ letterId, includeExtras }, 'Starting transcription regeneration');

  // Reset transcription-related fields
  await db.update(letters).set({
    workflow: 'UPLOADED',
    transcriptionStatus: 'PENDING',
    transcriptionError: null,
    transcriptionAttemptCount: 0,
    transcriptStatus: 'EMPTY',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  // Run the transcription pipeline synchronously
  await runTranscription(letterId);

  // After transcription, update status to AI_DRAFT
  await db.update(letters).set({
    transcriptStatus: 'AI_DRAFT',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  let extrasTranscribed = 0;

  // Optionally re-transcribe extra content
  if (includeExtras) {
    // Fetch related items (T, C, E types with same date/sequence)
    const relatedItems = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
        inArray(letters.type, ['T', 'C', 'E'])
      ),
      with: {
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
      orderBy: (l, { asc }) => [asc(l.type)],
    });

    if (relatedItems.length > 0) {
      const typeCounters: Record<string, number> = {};
      const transcriptions: { type: string; index: number; text: string }[] = [];

      for (const item of relatedItems) {
        const docType = getDocumentTypeFromCode(item.type);
        typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
        const typeIndex = typeCounters[item.type];

        for (const page of item.pages) {
          const filePath = getAbsoluteStoragePath(page.storagePath);

          const checkResult = await checkExtraContentForText({
            filePath,
            documentType: docType,
          });

          if (!checkResult.hasTranscribableText) continue;

          const transcription = await transcribeExtraContent({
            filePath,
            documentType: docType,
            context: {
              collectionCode: letter.collection.collectionCode,
              dateRaw: letter.dateRaw,
            },
          });

          if (transcription.text.trim()) {
            transcriptions.push({
              type: docType,
              index: typeIndex,
              text: transcription.text.trim(),
            });
            extrasTranscribed++;
          }
        }
      }

      // Combine transcriptions with headers
      let combinedExtraContent = '';
      if (transcriptions.length > 0) {
        combinedExtraContent = transcriptions
          .map((t) => {
            const header = `--- ${t.type.charAt(0).toUpperCase() + t.type.slice(1)} ${t.index} ---`;
            return `${header}\n\n${t.text}`;
          })
          .join('\n\n');
      }

      // Update letter with extra content
      await db.update(letters).set({
        extraContentTranscript: combinedExtraContent || null,
        extraContentStatus: combinedExtraContent ? 'AI_DRAFT' : 'EMPTY',
        extraContentVerifiedAt: null,
        extraContentVerifiedBy: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    }
  }

  log.info({ letterId, includeExtras, extrasTranscribed }, 'Transcription regeneration completed');

  return {
    mainTranscript: true,
    extras: includeExtras,
    extrasCount: extrasTranscribed,
  };
}

/**
 * Transcribe only the letter pages (type='L'), not extra content.
 *
 * Returns null if letter not found.
 * Throws if letter type is not 'L' or has no pages.
 */
export async function transcribeLetterOnly(
  letterId: string,
): Promise<TranscribeLetterOnlyResult | null> {
  // Fetch the letter
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
  });

  if (!letter) return null;

  if (letter.type !== 'L') {
    const err = new Error('Can only transcribe letter type (L)') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  log.info({ letterId }, 'Starting letter-only transcription');

  // Reset transcription-related fields
  await db.update(letters).set({
    workflow: 'UPLOADED',
    transcriptionStatus: 'PENDING',
    transcriptionError: null,
    transcriptionAttemptCount: 0,
    transcriptStatus: 'EMPTY',
    transcriptVerifiedAt: null,
    transcriptVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  const pages = letter.pages;
  if (pages.length === 0) {
    const err = new Error('Letter has no pages to transcribe') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  const pageTranscriptions: string[] = [];

  for (const page of pages) {
    const absolutePath = getAbsoluteStoragePath(page.storagePath);

    const result = await transcribeImage({
      filePath: absolutePath,
      context: {
        collectionCode: letter.collection.collectionCode,
        dateRaw: letter.dateRaw,
        pageNumber: page.pageNumber,
        totalPages: pages.length,
      },
    });

    pageTranscriptions.push(result.text);
  }

  // Combine transcriptions with page separators
  let combinedTranscription: string;
  if (pageTranscriptions.length === 1) {
    combinedTranscription = pageTranscriptions[0];
  } else {
    combinedTranscription = pageTranscriptions
      .map((text, i) => `--- Page ${i + 1} ---\n\n${text}`)
      .join('\n\n');
  }

  // Update letter with transcription
  await db.update(letters).set({
    transcriptionText: combinedTranscription,
    transcriptionStatus: 'SUCCESS',
    transcriptionError: null,
    workflow: 'TRANSCRIBED',
    transcriptStatus: 'AI_DRAFT',
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, pageCount: pages.length }, 'Letter-only transcription completed');

  return {
    pageCount: pages.length,
    textLength: combinedTranscription.length,
  };
}

// ============================================================================
// EXTRA CONTENT
// ============================================================================

/**
 * Transcribe extra content (T, C, E types) for a letter.
 *
 * Finds all related items and transcribes them using GPT-4o-mini check + transcription.
 * Combines all transcriptions into a single block with separators.
 *
 * Returns null if letter not found.
 */
export async function transcribeExtras(letterId: string): Promise<TranscribeExtrasResult | null> {
  // Fetch the letter
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
  });

  if (!letter) return null;

  // Fetch related items (T, C, E types with same date/sequence)
  const relatedItems = await db.query.letters.findMany({
    where: and(
      eq(letters.collectionId, letter.collectionId),
      eq(letters.dateRaw, letter.dateRaw),
      eq(letters.typeSequence, letter.typeSequence),
      inArray(letters.type, ['T', 'C', 'E'])
    ),
    with: {
      pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
    },
    orderBy: (l, { asc }) => [asc(l.type)],
  });

  if (relatedItems.length === 0) {
    // No extra content to transcribe
    await db.update(letters).set({
      extraContentStatus: 'EMPTY',
      extraContentTranscript: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    return {
      transcribedCount: 0,
      extraContentStatus: 'EMPTY',
      message: 'No extra content found to transcribe',
    };
  }

  log.info(
    { letterId, relatedCount: relatedItems.length, types: relatedItems.map(r => r.type) },
    'Starting extra content transcription',
  );

  // Group items by type and count them for numbering
  const typeCounters: Record<string, number> = {};
  const transcriptions: { type: string; index: number; text: string }[] = [];

  for (const item of relatedItems) {
    const docType = getDocumentTypeFromCode(item.type);

    typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
    const typeIndex = typeCounters[item.type];

    for (const page of item.pages) {
      const filePath = getAbsoluteStoragePath(page.storagePath);

      const checkResult = await checkExtraContentForText({
        filePath,
        documentType: docType,
      });

      if (!checkResult.hasTranscribableText) {
        log.debug(
          { pageId: page.id, type: item.type, reason: checkResult.reason },
          'Skipping page - no transcribable text',
        );
        continue;
      }

      const transcription = await transcribeExtraContent({
        filePath,
        documentType: docType,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
        },
      });

      if (transcription.text && transcription.text.trim()) {
        transcriptions.push({
          type: item.type,
          index: typeIndex,
          text: transcription.text.trim(),
        });
      }
    }
  }

  // Combine transcriptions with separators
  let combinedTranscript = '';
  if (transcriptions.length > 0) {
    // Count total items per type to determine if we need numbering
    const typeTotals: Record<string, number> = {};
    for (const item of relatedItems) {
      typeTotals[item.type] = (typeTotals[item.type] || 0) + 1;
    }

    const parts: string[] = [];
    for (const t of transcriptions) {
      const docTypeName = getDocumentTypeFromCode(t.type);
      const displayName = docTypeName.charAt(0).toUpperCase() + docTypeName.slice(1);

      const label = typeTotals[t.type] > 1
        ? `--- ${displayName} ${t.index} ---`
        : `--- ${displayName} ---`;

      parts.push(`${label}\n\n${t.text}`);
    }

    combinedTranscript = parts.join('\n\n');
  }

  // Update the letter with the combined transcript
  const newStatus = combinedTranscript ? 'AI_DRAFT' : 'EMPTY';
  await db.update(letters).set({
    extraContentTranscript: combinedTranscript || null,
    extraContentStatus: newStatus,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info(
    { letterId, transcribedCount: transcriptions.length, status: newStatus },
    'Extra content transcription completed',
  );

  return {
    transcribedCount: transcriptions.length,
    extraContentStatus: newStatus,
  };
}

/**
 * Update extra content transcription text.
 * Handles AI_DRAFT -> EDITED status transition.
 *
 * Returns null if letter not found.
 */
export async function updateExtraContent(
  letterId: string,
  extraContentTranscript: string | null,
): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  // Determine new status based on edit
  let newStatus = existingLetter.extraContentStatus;
  if (existingLetter.extraContentStatus === 'AI_DRAFT') {
    newStatus = 'EDITED';
  }

  await db.update(letters).set({
    extraContentTranscript: extraContentTranscript || null,
    extraContentStatus: newStatus,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.debug({ letterId, previousStatus: existingLetter.extraContentStatus, newStatus }, 'Extra content updated');
  return true;
}

/**
 * Mark extra content as verified.
 * Returns null if letter not found.
 */
export async function verifyExtraContent(letterId: string): Promise<{ previousStatus: string } | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    extraContentStatus: 'VERIFIED',
    extraContentVerifiedAt: new Date(),
    extraContentVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId, previousStatus: existingLetter.extraContentStatus }, 'Extra content verified');
  return { previousStatus: existingLetter.extraContentStatus };
}

/**
 * Reset extra content verification (VERIFIED -> EDITED).
 * Returns null if letter not found, throws if not in VERIFIED state.
 */
export async function unverifyExtraContent(letterId: string): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  if (existingLetter.extraContentStatus !== 'VERIFIED') {
    const err = new Error('Extra content is not verified') as Error & { status: number; currentStatus: string };
    err.status = 400;
    err.currentStatus = existingLetter.extraContentStatus;
    throw err;
  }

  await db.update(letters).set({
    extraContentStatus: 'EDITED',
    extraContentVerifiedAt: null,
    extraContentVerifiedBy: null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.info({ letterId }, 'Extra content verification removed');
  return true;
}

/**
 * Update AI notes for a letter.
 * Returns null if letter not found.
 */
export async function updateAiNotes(letterId: string, aiNotes: string | null): Promise<true | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

  await db.update(letters).set({
    aiNotes: aiNotes || null,
    updatedAt: new Date(),
  }).where(eq(letters.id, letterId));

  log.debug({ letterId }, 'AI notes updated');
  return true;
}

// ============================================================================
// LINKED ENTITIES
// ============================================================================

/**
 * Update a linked person's canonical name.
 * Returns null if the link is not found, true on success.
 */
export async function updateLinkedPerson(
  letterId: string,
  linkId: string,
  canonicalName: string,
): Promise<true | null> {
  // Verify the link exists and belongs to this letter
  const link = await db.query.letterPersons.findFirst({
    where: and(
      eq(letterPersons.id, linkId),
      eq(letterPersons.letterId, letterId),
    ),
    with: { person: true },
  });

  if (!link) return null;

  // Update the canonical person's name
  await db.update(canonicalPersons).set({
    canonicalName,
    updatedAt: new Date(),
  }).where(eq(canonicalPersons.id, link.personId));

  log.info({ letterId, linkId, personId: link.personId, newName: canonicalName }, 'Linked person name updated');
  return true;
}

/**
 * Update a linked place's canonical name.
 * Returns null if the link is not found, true on success.
 */
export async function updateLinkedPlace(
  letterId: string,
  linkId: string,
  canonicalName: string,
): Promise<true | null> {
  // Verify the link exists and belongs to this letter
  const link = await db.query.letterPlaces.findFirst({
    where: and(
      eq(letterPlaces.id, linkId),
      eq(letterPlaces.letterId, letterId),
    ),
    with: { place: true },
  });

  if (!link) return null;

  // Update the canonical place's name
  await db.update(canonicalPlaces).set({
    canonicalName,
    updatedAt: new Date(),
  }).where(eq(canonicalPlaces.id, link.placeId));

  log.info({ letterId, linkId, placeId: link.placeId, newName: canonicalName }, 'Linked place name updated');
  return true;
}

/**
 * Add a linked person to a letter.
 * Creates or finds a canonical person and links them.
 *
 * Returns null if letter not found, throws with status 400 if already linked.
 */
export async function addLinkedPerson(
  letterId: string,
  name: string,
  role: 'sender' | 'recipient' | 'mentioned',
): Promise<true | null> {
  // Verify letter exists
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) return null;

  // Check if a canonical person with this exact name already exists
  let person = await db.query.canonicalPersons.findFirst({
    where: eq(canonicalPersons.canonicalName, name),
  });

  // If not found, create a new canonical person
  if (!person) {
    const [newPerson] = await db.insert(canonicalPersons).values({
      canonicalName: name,
    }).returning();
    if (!newPerson) {
      throw new Error('Failed to create canonical person');
    }
    person = newPerson;
    log.info({ letterId, personId: person.id, name }, 'Created new canonical person');
  }

  // Check if this person is already linked to this letter with this role
  const existingLink = await db.query.letterPersons.findFirst({
    where: and(
      eq(letterPersons.letterId, letterId),
      eq(letterPersons.personId, person.id),
      eq(letterPersons.role, role),
    ),
  });

  if (existingLink) {
    const err = new Error('Person already linked with this role') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  // Create the link
  await db.insert(letterPersons).values({
    letterId,
    personId: person.id,
    role,
    nameAsWritten: name,
    confidence: 100, // Manual link = high confidence
  });

  log.info({ letterId, personId: person.id, name, role }, 'Linked person to letter');
  return true;
}

/**
 * Add a linked place to a letter.
 * Creates or finds a canonical place and links them.
 *
 * Returns null if letter not found, throws with status 400 if already linked.
 */
export async function addLinkedPlace(
  letterId: string,
  name: string,
  role: 'written_from' | 'mentioned' | 'destination',
): Promise<true | null> {
  // Verify letter exists
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) return null;

  // Check if a canonical place with this exact name already exists
  let place = await db.query.canonicalPlaces.findFirst({
    where: eq(canonicalPlaces.canonicalName, name),
  });

  // If not found, create a new canonical place
  if (!place) {
    const [newPlace] = await db.insert(canonicalPlaces).values({
      canonicalName: name,
      placeType: 'other', // Default type
    }).returning();
    if (!newPlace) {
      throw new Error('Failed to create canonical place');
    }
    place = newPlace;
    log.info({ letterId, placeId: place.id, name }, 'Created new canonical place');
  }

  // Check if this place is already linked to this letter with this role
  const existingLink = await db.query.letterPlaces.findFirst({
    where: and(
      eq(letterPlaces.letterId, letterId),
      eq(letterPlaces.placeId, place.id),
      eq(letterPlaces.role, role),
    ),
  });

  if (existingLink) {
    const err = new Error('Place already linked with this role') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  // Create the link
  await db.insert(letterPlaces).values({
    letterId,
    placeId: place.id,
    role,
    nameAsWritten: name,
    confidence: 100, // Manual link = high confidence
  });

  log.info({ letterId, placeId: place.id, name, role }, 'Linked place to letter');
  return true;
}

/**
 * Remove a linked person from a letter.
 * Returns null if the link is not found, true on success.
 */
export async function removeLinkedPerson(letterId: string, linkId: string): Promise<true | null> {
  const link = await db.query.letterPersons.findFirst({
    where: and(
      eq(letterPersons.id, linkId),
      eq(letterPersons.letterId, letterId),
    ),
  });

  if (!link) return null;

  await db.delete(letterPersons).where(eq(letterPersons.id, linkId));

  log.info({ letterId, linkId }, 'Removed linked person from letter');
  return true;
}

/**
 * Remove a linked place from a letter.
 * Returns null if the link is not found, true on success.
 */
export async function removeLinkedPlace(letterId: string, linkId: string): Promise<true | null> {
  const link = await db.query.letterPlaces.findFirst({
    where: and(
      eq(letterPlaces.id, linkId),
      eq(letterPlaces.letterId, letterId),
    ),
  });

  if (!link) return null;

  await db.delete(letterPlaces).where(eq(letterPlaces.id, linkId));

  log.info({ letterId, linkId }, 'Removed linked place from letter');
  return true;
}

// ============================================================================
// METADATA RESYNC
// ============================================================================

/**
 * Audit all metadata for consistency issues (decision only, no updates).
 *
 * Checks: summary/hook use actual names, sender/recipient are linked,
 * relationship type is set.
 *
 * Returns null if letter not found.
 */
export async function resyncCheck(letterId: string, body: ResyncInput): Promise<ResyncCheckResult | null> {
  // Fetch letter with linked persons
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc: asc2 }) => [asc2(p.pageNumber)] },
      persons: {
        with: {
          person: true,
        },
      },
    },
  });

  if (!letter) return null;

  const { oldSender, newSender, oldRecipient, newRecipient } = body;

  log.debug(
    {
      letterId,
      sender: newSender || letter.sender,
      recipient: newRecipient || letter.recipient,
    },
    'Metadata audit requested',
  );

  // Build linked persons info
  const linkedPersons: LinkedPersonInfo[] = (letter.persons || []).map(lp => ({
    canonicalName: lp.person?.canonicalName || '',
    role: lp.role as 'sender' | 'recipient' | 'mentioned',
  }));

  // Extract quote contexts from metadataV2Json
  const metadataV2 = letter.metadataV2Json as {
    notable_quotes?: Array<{ text: string; context: string; position: 'opening' | 'middle' | 'closing' }>;
  } | null;
  const quoteContexts = metadataV2?.notable_quotes || [];

  // Build full audit context
  const auditContext: MetadataAuditContext = {
    sender: newSender || letter.sender || null,
    recipient: newRecipient || letter.recipient || null,
    date: letter.extractedDate || null,
    summary: letter.summary || null,
    hook: letter.hook || null,
    relationshipType: letter.senderRecipientRelationship || null,
    linkedPersons,
    quoteContexts,
  };

  // Build change info if there was a change
  const change = (oldSender !== newSender || oldRecipient !== newRecipient)
    ? { oldSender, newSender, oldRecipient, newRecipient }
    : undefined;

  // Call the audit function (fast model)
  const decision = await auditMetadata(auditContext, change);

  const needsResync =
    decision.shouldUpdateSummary ||
    decision.shouldUpdateHook ||
    decision.shouldCreateSenderPerson ||
    decision.shouldCreateRecipientPerson ||
    decision.shouldUpdateRelationship ||
    decision.shouldUpdateQuoteContexts;

  log.debug(
    {
      letterId,
      needsResync,
      issueCount: decision.issues.length,
      reason: decision.reason,
    },
    'Metadata audit completed',
  );

  return { needsResync, decision };
}

/**
 * Full metadata sync using a two-model approach.
 *
 * 1. GPT-5-mini audits all metadata for issues
 * 2. Main model regenerates/fixes the affected fields
 *
 * Can fix: summary, hook, quote contexts using generic terms,
 * missing linked persons, missing relationship type.
 *
 * Returns null if letter not found.
 */
export async function resyncLetterMetadata(letterId: string, body: ResyncInput): Promise<ResyncResult | null> {
  // Fetch letter with linked persons
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: { orderBy: (p, { asc: asc2 }) => [asc2(p.pageNumber)] },
      persons: {
        with: {
          person: true,
        },
      },
    },
  });

  if (!letter) return null;

  const { oldSender, newSender, oldRecipient, newRecipient } = body;

  log.info(
    {
      letterId,
      sender: newSender || letter.sender,
      recipient: newRecipient || letter.recipient,
    },
    'Metadata sync requested',
  );

  // Build linked persons info
  const linkedPersons: LinkedPersonInfo[] = (letter.persons || []).map(lp => ({
    canonicalName: lp.person?.canonicalName || '',
    role: lp.role as 'sender' | 'recipient' | 'mentioned',
  }));

  // Extract quote contexts from metadataV2Json
  const existingMetadataV2 = letter.metadataV2Json as Record<string, unknown> | null;
  const quoteContexts = (existingMetadataV2?.notable_quotes || []) as Array<{
    text: string;
    context: string;
    position: 'opening' | 'middle' | 'closing';
  }>;

  // Build full audit context
  const auditContext: MetadataAuditContext = {
    sender: newSender || letter.sender || null,
    recipient: newRecipient || letter.recipient || null,
    date: letter.extractedDate || null,
    summary: letter.summary || null,
    hook: letter.hook || null,
    relationshipType: letter.senderRecipientRelationship || null,
    linkedPersons,
    quoteContexts,
  };

  // Build change info if there was a change
  const change = (oldSender !== newSender || oldRecipient !== newRecipient)
    ? { oldSender, newSender, oldRecipient, newRecipient }
    : undefined;

  // Get transcript
  const transcript = letter.transcriptionText || '';

  // Perform full resync using AI
  const result = await resyncMetadata({
    transcript,
    context: auditContext,
    change,
  });

  // If something was updated, save it
  if (result.wasUpdated) {
    const dbUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (result.summary) {
      dbUpdates.summary = result.summary;
    }
    if (result.hook) {
      dbUpdates.hook = result.hook;
    }
    if (result.relationshipType) {
      const normalizedRelationship = normalizeRelationshipType(result.relationshipType);
      if (normalizedRelationship) {
        dbUpdates.senderRecipientRelationship = normalizedRelationship;
      }
    }
    if (result.updatedQuoteContexts) {
      dbUpdates.metadataV2Json = {
        ...(existingMetadataV2 || {}),
        notable_quotes: result.updatedQuoteContexts,
      };
    }

    await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

    if (result.senderPerson || result.recipientPerson || change) {
      await syncLetterParticipantsFromMetadata({
        letterId,
        sender: newSender || letter.sender,
        recipient: newRecipient || letter.recipient,
        relationshipType: (dbUpdates.senderRecipientRelationship as DBRelationshipType | null | undefined)
          ?? letter.senderRecipientRelationship,
      });
    }

    log.info(
      {
        letterId,
        updatedSummary: Boolean(result.summary),
        updatedHook: Boolean(result.hook),
        createdSenderPerson: Boolean(result.senderPerson),
        createdRecipientPerson: Boolean(result.recipientPerson),
        updatedRelationship: Boolean(result.relationshipType),
        updatedQuoteContexts: Boolean(result.updatedQuoteContexts),
        decision: result.decision.reason,
      },
      'Metadata sync completed',
    );
  } else {
    log.info({ letterId, reason: result.decision.reason }, 'Metadata sync: no updates needed');
  }

  return {
    wasUpdated: result.wasUpdated,
    updatedFields: {
      summary: Boolean(result.summary),
      hook: Boolean(result.hook),
      senderPerson: Boolean(result.senderPerson),
      recipientPerson: Boolean(result.recipientPerson),
      relationshipType: Boolean(result.relationshipType),
      quoteContexts: Boolean(result.updatedQuoteContexts),
    },
    decision: result.decision,
  };
}
