import { eq, and, sql } from 'drizzle-orm';
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
import type { MetadataV2, StructuredNote, AiNoteOutput } from '../ai/schemas/metadataV2.js';
import type { EntityExtraction } from '../ai/schemas/entityExtraction.js';
import { notify } from './notifications.js';
import { MAX_JOB_ATTEMPTS } from '../config/constants.js';
import { isPlaceholderValue } from '../utils/placeholders.js';

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
    where: eq(letters.id, letterId),
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
    where: eq(letters.id, letterId),
  });
}

/**
 * Resolve any letter id in a grouped correspondence unit to its representative
 * record, preferring the primary L-type row when present.
 */
export async function resolveRepresentativeLetterId(
  letterId: string,
  options: { publishedOnly?: boolean } = {},
): Promise<string | null> {
  const target = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    columns: {
      id: true,
      collectionId: true,
      dateRaw: true,
      typeSequence: true,
    },
  });

  if (!target) return null;

  const conditions = [
    eq(letters.collectionId, target.collectionId),
    eq(letters.dateRaw, target.dateRaw),
    eq(letters.typeSequence, target.typeSequence),
  ];

  if (options.publishedOnly) {
    conditions.push(eq(letters.visibility, 'PUBLISHED'));
  }

  const groupedLetters = await db.query.letters.findMany({
    where: and(...conditions),
    columns: {
      id: true,
      type: true,
    },
  });

  if (groupedLetters.length === 0) return null;

  const [representative] = [...groupedLetters].sort((a, b) => {
    const aRank = a.type === 'L' ? 0 : 1;
    const bRank = b.type === 'L' ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return a.type.localeCompare(b.type);
  });

  return representative?.id ?? null;
}

/**
 * Atomically claim a job by transitioning its status from expectedStatus to RUNNING.
 * Returns true if the claim succeeded (status was expectedStatus), false if someone else got it first.
 * This prevents the worker and on-demand processing from double-processing the same item.
 */
export async function claimJob(
  letterId: string,
  field: 'transcriptionStatus' | 'metadataStatus' | 'entityExtractionStatus',
  expectedStatus: JobStatus = 'PENDING',
): Promise<boolean> {
  const result = await db
    .update(letters)
    .set({
      [field]: 'RUNNING' as JobStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(letters.id, letterId), eq(letters[field], expectedStatus)))
    .returning({ id: letters.id });

  return result.length > 0;
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
 * Increments transcription attempt count. If the new count reaches
 * MAX_JOB_ATTEMPTS, marks the letter dead_letter and fires a critical
 * notification so an admin investigates.
 */
export async function incrementTranscriptionAttempts(letterId: string): Promise<void> {
  const [updated] = await db
    .update(letters)
    .set({
      transcriptionAttemptCount: sql`${letters.transcriptionAttemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(letters.id, letterId))
    .returning({
      attempts: letters.transcriptionAttemptCount,
      deadLetter: letters.deadLetter,
      dateRaw: letters.dateRaw,
    });

  if (updated && !updated.deadLetter && updated.attempts >= MAX_JOB_ATTEMPTS) {
    await markDeadLetter(letterId, 'transcription', updated.attempts, updated.dateRaw);
  }
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
 * Increments metadata attempt count. Same dead-letter behavior as the
 * transcription counter — see incrementTranscriptionAttempts.
 */
export async function incrementMetadataAttempts(letterId: string): Promise<void> {
  const [updated] = await db
    .update(letters)
    .set({
      metadataAttemptCount: sql`${letters.metadataAttemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(letters.id, letterId))
    .returning({
      attempts: letters.metadataAttemptCount,
      deadLetter: letters.deadLetter,
      dateRaw: letters.dateRaw,
    });

  if (updated && !updated.deadLetter && updated.attempts >= MAX_JOB_ATTEMPTS) {
    await markDeadLetter(letterId, 'metadata', updated.attempts, updated.dateRaw);
  }
}

/**
 * Marks a letter dead_letter and fires a critical notification.
 * The worker job picker excludes dead_letter rows; manual retry clears it.
 */
async function markDeadLetter(
  letterId: string,
  jobType: 'transcription' | 'metadata' | 'entity',
  attempts: number,
  dateRaw: string | null,
): Promise<void> {
  await db
    .update(letters)
    .set({ deadLetter: true, updatedAt: new Date() })
    .where(eq(letters.id, letterId));

  void notify({
    type: 'job_max_retries',
    title: `${jobType} job exceeded max retries`,
    message: `Letter ${dateRaw ?? letterId.slice(0, 8)} failed ${jobType} ${attempts} times. Auto-retry stopped — investigate before manually retrying.`,
    link: `/admin/letters/${letterId}`,
    sourceType: 'letter',
    sourceId: letterId,
    metadata: { jobType, attempts, maxAttempts: MAX_JOB_ATTEMPTS },
    dedupeKey: `job_max_retries:${letterId}:${jobType}`,
    dedupeWindowMinutes: 1440, // 24h — don't spam if admin doesn't act immediately
  });
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
      entityExtractionJson: null,
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
      // Reset two-track content status to EMPTY
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      deadLetter: false,
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
    updates.sender = metadata.sender;
    updates.recipient = metadata.recipient;
    updates.locationWritten = metadata.location_written;
    updates.hook = metadata.hook;
    updates.summary = metadata.summary;
    updates.extractedDate = metadata.extracted_date;
    // Generate tags from topics for V1 compatibility
    updates.tags = metadata.primary_topics;

    // Strip «SENDER:...» and «RECIPIENT:...» tags, keeping the inner text
    // The raw tagged text is preserved in metadataV2Json for future re-processing
    const stripTags = (text: string) =>
      text.replace(/«(?:SENDER|RECIPIENT):([^»]*)»/g, '$1');
    if (updates.hook) {
      updates.hook = stripTags(updates.hook);
    }
    if (updates.summary) {
      updates.summary = stripTags(updates.summary);
    }

    // V2 specific fields
    updates.emotionalTone = metadata.emotional_tone as EmotionalTone | null;
    updates.senderRecipientRelationship = metadata.sender_recipient_relationship as RelationshipType | null;
    updates.primaryTopics = metadata.primary_topics;

    // AI notes: enrich AI output with backend fields before storing
    if (metadata.ai_notes && Array.isArray(metadata.ai_notes) && metadata.ai_notes.length > 0) {
      const structuredNotes: StructuredNote[] = metadata.ai_notes.map((note: AiNoteOutput) => ({
        id: crypto.randomUUID(),
        content: note.content,
        category: note.category,
        priority: note.priority,
        status: 'open' as const,
        resolves_when: note.resolves_when,
        resolved_at: null,
        resolved_by: null,
        source: 'ai' as const,
      }));
      updates.aiNotes = structuredNotes;

      // Create notification for high-priority notes
      const highPriorityNotes = structuredNotes.filter(n => n.priority === 'high');
      if (highPriorityNotes.length > 0) {
        void notify({
          type: 'ai_notes_high_priority',
          title: `${highPriorityNotes.length} note${highPriorityNotes.length > 1 ? 's' : ''} need attention`,
          message: highPriorityNotes.map(n => n.content).join('; '),
          link: `/admin/letters/${letterId}`,
          sourceType: 'letter',
          sourceId: letterId,
          metadata: { noteCount: highPriorityNotes.length },
          dedupeKey: `ai_notes_high_priority:${letterId}`,
        });
      }
    } else {
      updates.aiNotes = [];
    }

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

/**
 * Updates entity extraction results (Prompt 2) for a letter.
 * Tracked separately from basic metadata to allow independent retry.
 */
export async function updateEntityExtraction(
  letterId: string,
  status: JobStatus,
  entityData?: EntityExtraction,
  error?: string | null
): Promise<void> {
  const updates: Partial<Letter> = {
    entityExtractionStatus: status,
    updatedAt: new Date(),
  };

  if (entityData) {
    updates.entityExtractionJson = entityData;
  }

  if (error !== undefined) {
    updates.entityExtractionError = error;
  }

  await db.update(letters).set(updates).where(eq(letters.id, letterId));
}
