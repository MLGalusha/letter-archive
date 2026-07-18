/**
 * Letter Operations Service
 *
 * Keeps the existing public import path while delegating most implementation
 * to smaller modules under `services/letter/`.
 */

import { and, eq, ne } from 'drizzle-orm';
import { db, letters } from '../db/index.js';
import { syncLetterParticipantsFromMetadata } from './entities/participant-sync.js';
import { getLetterById } from './letters.js';
import { log, type UpdateLetterInput } from './letter/shared.js';
import {
  buildHumanMetadataJobPatch,
  buildMetadataSourceInvalidationPatch,
  observedMetadataRevisionConditions,
} from './letter/metadata-job.js';
import {
  buildMetadataDocumentProjectionPatch,
} from './letter/metadata-projection.js';
import {
  canPublishMetadata,
  canPublishTranscript,
} from './letter/publication.js';

export * from './letter/index.js';

function sameNullableStringArray(
  left: string[] | null,
  right: string[] | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export async function updateLetter(
  letterId: string,
  updates: UpdateLetterInput,
  userId: string = 'admin',
): Promise<boolean> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return false;

  const dbUpdates: Record<string, unknown> = {};
  const transcriptChanged = updates.transcriptionText !== undefined
    && updates.transcriptionText !== existingLetter.transcriptionText;

  if (transcriptChanged) {
    const transcriptionText = updates.transcriptionText!;
    const hasTranscription = transcriptionText.trim().length > 0;
    dbUpdates.transcriptionText = transcriptionText;
    dbUpdates.transcriptionStatus = 'SUCCESS';
    dbUpdates.transcriptionRunId = null;
    dbUpdates.transcriptionLeaseExpiresAt = null;
    dbUpdates.transcriptionLeaseRunId = null;
    dbUpdates.transcriptionClaimKind = null;
    dbUpdates.transcriptionError = null;
    dbUpdates.transcriptStatus = hasTranscription ? 'EDITED' : 'EMPTY';
    dbUpdates.transcriptVerifiedAt = null;
    dbUpdates.transcriptVerifiedBy = null;
    dbUpdates.transcriptConfirmedAt = null;
    dbUpdates.transcriptConfirmedBy = null;
    dbUpdates.workflow = hasTranscription ? 'TRANSCRIBED' : 'UPLOADED';

    log.debug(
      { letterId, previousStatus: existingLetter.transcriptStatus },
      `Transcript status -> ${hasTranscription ? 'EDITED' : 'EMPTY'}`,
    );
  }
  const senderChanged = updates.sender !== undefined
    && updates.sender !== existingLetter.sender;
  const recipientChanged = updates.recipient !== undefined
    && updates.recipient !== existingLetter.recipient;
  const locationChanged = updates.locationWritten !== undefined
    && updates.locationWritten !== existingLetter.locationWritten;
  const hookChanged = updates.hook !== undefined
    && updates.hook !== existingLetter.hook;
  const summaryChanged = updates.summary !== undefined
    && updates.summary !== existingLetter.summary;
  const normalizedExtractedDate = updates.extractedDate === undefined
    ? undefined
    : updates.extractedDate === null || updates.extractedDate === ''
      ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(updates.extractedDate)
        ? updates.extractedDate
        : undefined;
  const extractedDateChanged = normalizedExtractedDate !== undefined
    && normalizedExtractedDate !== existingLetter.extractedDate;
  const tagsChanged = updates.tags !== undefined
    && !sameNullableStringArray(updates.tags, existingLetter.tags);
  const hasMetadataUpdate = senderChanged
    || recipientChanged
    || locationChanged
    || summaryChanged
    || hookChanged
    || extractedDateChanged
    || tagsChanged;

  if (senderChanged) {
    dbUpdates.sender = updates.sender;
  }
  if (recipientChanged) {
    dbUpdates.recipient = updates.recipient;
  }
  if (locationChanged) {
    dbUpdates.locationWritten = updates.locationWritten;
  }
  if (hookChanged) {
    dbUpdates.hook = updates.hook;
  }
  if (summaryChanged) {
    dbUpdates.summary = updates.summary;
  }
  if (extractedDateChanged) {
    dbUpdates.extractedDate = normalizedExtractedDate;
  }
  if (updates.notes !== undefined && updates.notes !== existingLetter.notes) {
    dbUpdates.notes = updates.notes;
  }
  if (tagsChanged) {
    dbUpdates.tags = updates.tags;
    dbUpdates.primaryTopics = updates.tags;
  }
  if (updates.readingText !== undefined && updates.readingText !== existingLetter.readingText) {
    dbUpdates.readingText = updates.readingText;
  }
  if (updates.visibility !== undefined && updates.visibility !== existingLetter.visibility) {
    dbUpdates.visibility = updates.visibility;
    if (updates.visibility === 'PUBLISHED') {
      dbUpdates.reviewedAt = new Date();
      dbUpdates.reviewedBy = userId;
      // Auto-set content publish flags based on verification status
      dbUpdates.transcriptPublished = !transcriptChanged
        && canPublishTranscript(existingLetter);
      dbUpdates.metadataPublished = !transcriptChanged
        && !hasMetadataUpdate
        && canPublishMetadata(existingLetter);
    }
  }
  if (updates.transcriptPublished !== undefined) {
    if (
      updates.transcriptPublished
      && (
        transcriptChanged
        || !canPublishTranscript(existingLetter)
      )
    ) {
      const error = new Error(
        'Only verified transcript content can be published',
      ) as Error & { status: number };
      error.status = 400;
      throw error;
    }
    if (updates.transcriptPublished !== existingLetter.transcriptPublished) {
      dbUpdates.transcriptPublished = updates.transcriptPublished;
    }
  }
  if (updates.metadataPublished !== undefined) {
    if (
      updates.metadataPublished
      && (
        transcriptChanged
        || hasMetadataUpdate
        || !canPublishMetadata(existingLetter)
      )
    ) {
      const error = new Error(
        'Only verified metadata content can be published',
      ) as Error & { status: number };
      error.status = 400;
      throw error;
    }
    if (updates.metadataPublished !== existingLetter.metadataPublished) {
      dbUpdates.metadataPublished = updates.metadataPublished;
    }
  }

  if (hasMetadataUpdate) {
    Object.assign(dbUpdates, buildHumanMetadataJobPatch());

    // The structured document and flattened columns are projections of the
    // same metadata. Keep human edits coherent so a later deterministic/AI
    // retag cannot resurrect stale JSON values over newer reviewer work.
    const projectionUpdates = {
      ...(senderChanged ? { sender: updates.sender } : {}),
      ...(recipientChanged ? { recipient: updates.recipient } : {}),
      ...(locationChanged ? { locationWritten: updates.locationWritten } : {}),
      ...(hookChanged ? { hook: updates.hook } : {}),
      ...(summaryChanged ? { summary: updates.summary } : {}),
      ...(extractedDateChanged ? { extractedDate: normalizedExtractedDate } : {}),
      ...(tagsChanged ? { tags: updates.tags } : {}),
    };
    Object.assign(
      dbUpdates,
      buildMetadataDocumentProjectionPatch(existingLetter, projectionUpdates),
    );
    log.debug(
      { letterId, previousStatus: existingLetter.metadataContentStatus },
      'Authoritative metadata fields updated',
    );
  }

  const currentWorkflow = existingLetter.workflow;

  // A transcript is the primary metadata source. When one request also edits
  // metadata fields, source invalidation has final lifecycle precedence so the
  // combined save cannot certify metadata derived from the previous transcript.
  if (transcriptChanged) {
    Object.assign(dbUpdates, buildMetadataSourceInvalidationPatch());
    dbUpdates.workflow = updates.transcriptionText!.trim().length > 0
      ? 'TRANSCRIBED'
      : 'UPLOADED';
    if (hasMetadataUpdate && existingLetter.metadataContentStatus !== 'EMPTY') {
      dbUpdates.metadataContentStatus = 'EDITED';
    }
  }

  if (Object.keys(dbUpdates).length === 0) return true;
  dbUpdates.updatedAt = new Date();

  const updated = await db
    .update(letters)
    .set(dbUpdates)
    .where(and(...observedMetadataRevisionConditions(letterId, existingLetter)))
    .returning({ id: letters.id });
  if (updated.length === 0) {
    const error = new Error(
      'Letter content changed before this update could be saved; reload and try again',
    ) as Error & { status: number };
    error.status = 409;
    throw error;
  }

  // When publishing or hiding, sync companion types (C, T, etc.) on the same date
  // so covers and telegrams are always visible alongside their letter
  if (dbUpdates.visibility) {
    const companionUpdated = await db.update(letters).set({
      visibility: updates.visibility,
      ...(updates.visibility === 'PUBLISHED' ? { reviewedAt: new Date(), reviewedBy: userId } : {}),
    }).where(and(
      eq(letters.collectionId, existingLetter.collectionId),
      eq(letters.dateRaw, existingLetter.dateRaw),
      eq(letters.typeSequence, existingLetter.typeSequence),
      ne(letters.id, letterId),
    ));

    if (companionUpdated.length > 0) {
      log.info(
        { letterId, companions: companionUpdated.length, visibility: updates.visibility },
        'Companion types visibility synced',
      );
    }
  }

  if (senderChanged || recipientChanged) {
    await syncLetterParticipantsFromMetadata({
      letterId,
      sender: senderChanged ? updates.sender : undefined,
      recipient: recipientChanged ? updates.recipient : undefined,
    });
  }

  const workflowChange = typeof dbUpdates.workflow === 'string'
    ? `${currentWorkflow} -> ${dbUpdates.workflow}`
    : undefined;

  log.info(
    { letterId, workflowChange, visibilityChange: updates.visibility },
    'Letter updated',
  );

  return true;
}
