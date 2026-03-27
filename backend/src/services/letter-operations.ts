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
import { log, type UpdateLetterInput, type UpdateLetterResult } from './letter/shared.js';

export * from './letter/index.js';

export async function buildLetterUpdates(
  letterId: string,
  updates: UpdateLetterInput,
  userId: string = 'admin',
): Promise<UpdateLetterResult | null> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return null;

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
    if (updates.extractedDate === null || updates.extractedDate === '') {
      dbUpdates.extractedDate = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(updates.extractedDate)) {
      dbUpdates.extractedDate = updates.extractedDate;
    }
  }
  if (updates.notes !== undefined) {
    dbUpdates.notes = updates.notes;
  }
  if (updates.tags !== undefined) {
    dbUpdates.tags = updates.tags;
  }
  if (updates.visibility !== undefined) {
    dbUpdates.visibility = updates.visibility;
    if (updates.visibility === 'PUBLISHED') {
      dbUpdates.reviewedAt = new Date();
      dbUpdates.reviewedBy = userId;
    }
  }

  if (updates.transcriptionText !== undefined) {
    const currentTranscriptStatus = existingLetter.transcriptStatus;
    if (currentTranscriptStatus === 'AI_DRAFT' || currentTranscriptStatus === 'VERIFIED') {
      dbUpdates.transcriptStatus = 'EDITED';
      if (currentTranscriptStatus === 'VERIFIED') {
        dbUpdates.transcriptVerifiedAt = null;
        dbUpdates.transcriptVerifiedBy = null;
      }
      log.debug({ letterId, previousStatus: currentTranscriptStatus }, 'Transcript status -> EDITED');
    }
  }

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
    if (currentMetadataStatus === 'AI_DRAFT' || currentMetadataStatus === 'VERIFIED') {
      dbUpdates.metadataContentStatus = 'EDITED';
      if (currentMetadataStatus === 'VERIFIED') {
        dbUpdates.metadataVerifiedAt = null;
        dbUpdates.metadataVerifiedBy = null;
      }
      log.debug({ letterId, previousStatus: currentMetadataStatus }, 'Metadata status -> EDITED');
    }
  }

  const currentWorkflow = existingLetter.workflow;

  if (updates.transcriptionText !== undefined) {
    const hasTranscription = updates.transcriptionText && updates.transcriptionText.trim().length > 0;
    if (hasTranscription && currentWorkflow === 'UPLOADED') {
      dbUpdates.workflow = 'TRANSCRIBED';
    } else if (!hasTranscription && ['TRANSCRIBED', 'METADATA_DRAFTED', 'METADATA_EXTRACTING'].includes(currentWorkflow)) {
      dbUpdates.workflow = 'UPLOADED';
    }
  }

  if (hasMetadataUpdate) {
    const workflowToCheck = (dbUpdates.workflow as string) || currentWorkflow;
    if (workflowToCheck === 'TRANSCRIBED') {
      dbUpdates.workflow = 'METADATA_DRAFTED';
    }
  }

  await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

  // When publishing or hiding, sync companion types (C, T, etc.) on the same date
  // so covers and telegrams are always visible alongside their letter
  if (updates.visibility) {
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
