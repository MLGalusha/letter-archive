import { eq, and, isNull } from 'drizzle-orm';
import {
  db,
  letters,
  type Letter,
  type LetterType,
  type DateConfidence,
  type WorkflowState,
  type JobStatus,
  type EmotionalTone,
  type RelationshipType,
} from '../db/index.js';
import type { MetadataV2 } from '../ai/schemas/metadataV2.js';

export interface LetterIdentity {
  collectionId: string;
  dateRaw: string;
  type: LetterType;
  typeSequence: number;
}

export interface CreateLetterParams extends LetterIdentity {
  letterDate: string | null;
  dateConfidence: DateConfidence;
}

/**
 * Finds an existing letter by its identity, or creates a new one.
 */
export async function findOrCreateLetter(params: CreateLetterParams): Promise<Letter> {
  const existing = await db.query.letters.findFirst({
    where: and(
      eq(letters.collectionId, params.collectionId),
      eq(letters.dateRaw, params.dateRaw),
      eq(letters.type, params.type),
      eq(letters.typeSequence, params.typeSequence),
      isNull(letters.deletedAt)
    ),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(letters)
    .values({
      collectionId: params.collectionId,
      dateRaw: params.dateRaw,
      type: params.type,
      typeSequence: params.typeSequence,
      letterDate: params.letterDate,
      dateConfidence: params.dateConfidence,
    })
    .returning();

  return created;
}

/**
 * Gets a letter by ID with its pages.
 */
export async function getLetterWithPages(letterId: string) {
  return db.query.letters.findFirst({
    where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
    with: {
      collection: true,
      pages: {
        orderBy: (pages, { asc }) => [asc(pages.pageNumber)],
      },
    },
  });
}

/**
 * Gets a letter by ID.
 */
export async function getLetterById(letterId: string): Promise<Letter | undefined> {
  return db.query.letters.findFirst({
    where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
  });
}

/**
 * Updates letter workflow state.
 */
export async function updateLetterWorkflow(
  letterId: string,
  workflow: WorkflowState
): Promise<void> {
  await db
    .update(letters)
    .set({
      workflow,
      updatedAt: new Date(),
    })
    .where(eq(letters.id, letterId));
}

/**
 * Updates letter transcription status.
 */
export async function updateTranscriptionStatus(
  letterId: string,
  status: JobStatus,
  text?: string | null,
  error?: string | null
): Promise<void> {
  const updates: Partial<Letter> = {
    transcriptionStatus: status,
    updatedAt: new Date(),
  };

  if (text !== undefined) {
    updates.transcriptionText = text;
  }

  if (error !== undefined) {
    updates.transcriptionError = error;
  }

  if (status === 'SUCCESS') {
    updates.transcribedAt = new Date();
    // Set two-track content status to AI_DRAFT when AI completes
    updates.transcriptStatus = 'AI_DRAFT';
  }

  await db.update(letters).set(updates).where(eq(letters.id, letterId));
}

/**
 * Increments transcription attempt count.
 */
export async function incrementTranscriptionAttempts(letterId: string): Promise<void> {
  const letter = await getLetterById(letterId);
  if (!letter) return;

  await db
    .update(letters)
    .set({
      transcriptionAttemptCount: letter.transcriptionAttemptCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(letters.id, letterId));
}

/**
 * Updates letter metadata status and fields.
 */
export async function updateMetadataStatus(
  letterId: string,
  status: JobStatus,
  metadata?: {
    sender?: string | null;
    recipient?: string | null;
    locationWritten?: string | null;
    hook?: string | null;
    summary?: string | null;
    tags?: string[] | null;
    extractedDate?: string | null;
    extractedDateConfidence?: DateConfidence | null;
    metadataJson?: unknown;
  },
  error?: string | null
): Promise<void> {
  const updates: Partial<Letter> = {
    metadataStatus: status,
    updatedAt: new Date(),
  };

  if (metadata) {
    if (metadata.sender !== undefined) updates.sender = metadata.sender;
    if (metadata.recipient !== undefined) updates.recipient = metadata.recipient;
    if (metadata.locationWritten !== undefined) updates.locationWritten = metadata.locationWritten;
    if (metadata.hook !== undefined) updates.hook = metadata.hook;
    if (metadata.summary !== undefined) updates.summary = metadata.summary;
    if (metadata.tags !== undefined) updates.tags = metadata.tags;
    if (metadata.extractedDate !== undefined) updates.extractedDate = metadata.extractedDate;
    if (metadata.extractedDateConfidence !== undefined)
      updates.extractedDateConfidence = metadata.extractedDateConfidence;
    if (metadata.metadataJson !== undefined) updates.metadataJson = metadata.metadataJson;
  }

  if (error !== undefined) {
    updates.metadataError = error;
  }

  // Set two-track content status to AI_DRAFT when AI completes
  if (status === 'SUCCESS') {
    updates.metadataContentStatus = 'AI_DRAFT';
  }

  await db.update(letters).set(updates).where(eq(letters.id, letterId));
}

/**
 * Increments metadata attempt count.
 */
export async function incrementMetadataAttempts(letterId: string): Promise<void> {
  const letter = await getLetterById(letterId);
  if (!letter) return;

  await db
    .update(letters)
    .set({
      metadataAttemptCount: letter.metadataAttemptCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(letters.id, letterId));
}

/**
 * Resets a letter for re-processing.
 */
export async function resetLetterForProcessing(letterId: string): Promise<void> {
  await db
    .update(letters)
    .set({
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      metadataStatus: 'PENDING',
      metadataError: null,
      metadataAttemptCount: 0,
      // Reset two-track content status to EMPTY
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(letters.id, letterId));
}

/**
 * Updates letter with V2 metadata extraction results.
 * Stores both the flattened fields and the full JSON for entity processing.
 */
export async function updateMetadataV2(
  letterId: string,
  status: JobStatus,
  metadata?: MetadataV2,
  error?: string | null
): Promise<void> {
  const updates: Partial<Letter> = {
    metadataStatus: status,
    updatedAt: new Date(),
  };

  if (metadata) {
    // V1 compatible fields (for existing queries/UI)
    updates.sender = metadata.sender.name;
    updates.recipient = metadata.recipient.name;
    updates.locationWritten = metadata.location_written.name;
    updates.hook = metadata.hook;
    updates.summary = metadata.summary;
    updates.extractedDate = metadata.extracted_date;
    updates.extractedDateConfidence = metadata.extracted_date_confidence;
    // Generate tags from topics for V1 compatibility
    updates.tags = metadata.primary_topics;

    // V2 specific fields
    updates.emotionalTone = metadata.emotional_tone as EmotionalTone | null;
    updates.senderRecipientRelationship = metadata.sender_recipient_relationship as RelationshipType | null;
    updates.primaryTopics = metadata.primary_topics;

    // Store full V2 JSON for entity processing and future features
    updates.metadataV2Json = metadata;

    // Also store in legacy metadataJson for backwards compatibility
    updates.metadataJson = metadata;
  }

  if (error !== undefined) {
    updates.metadataError = error;
  }

  // Set two-track content status to AI_DRAFT when AI completes
  if (status === 'SUCCESS') {
    updates.metadataContentStatus = 'AI_DRAFT';
  }

  await db.update(letters).set(updates).where(eq(letters.id, letterId));
}
