/**
 * Letter Operations Service
 *
 * Keeps the existing public import path while delegating most implementation
 * to smaller modules under `services/letter/`.
 */

import { and, eq } from 'drizzle-orm';
import { db, letters } from '../db/index.js';
import { syncLetterParticipantsFromMetadata } from './entities/participant-sync.js';
import { getLetterById } from './letters.js';
import { resolveAiNotesForChangedFields } from './letter/ai-notes.js';
import { log, type UpdateLetterInput } from './letter/shared.js';
import {
  buildHumanMetadataJobPatch,
  buildMetadataSourceInvalidationPatch,
  clearedTranscriptConfirmationIntent,
  observedMetadataRevisionConditions,
} from './letter/metadata-job.js';
import {
  buildMetadataDocumentProjectionPatch,
} from './letter/metadata-projection.js';
import {
  canPublishMetadata,
  canPublishTranscript,
} from './letter/publication.js';
import { applyPublicationMutation } from './letter/publication-mutations.js';
import {
  assertCurrentPrimarySourceRevision,
} from './letter/source-revision.js';

export * from './letter/index.js';

function sameNullableStringArray(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export async function updateLetter(
  letterId: string,
  updates: UpdateLetterInput,
  userId: string = 'admin',
): Promise<boolean> {
  const existingLetter = await getLetterById(letterId);
  if (!existingLetter) return false;
  const currentSourceRevision = existingLetter.primarySourceRevision ?? 0;
  assertCurrentPrimarySourceRevision(
    currentSourceRevision,
    updates.primarySourceRevision,
    'Letter source changed before this update could be saved; reload and try again',
  );

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
    Object.assign(dbUpdates, clearedTranscriptConfirmationIntent());
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
  const emotionalToneChanged = updates.emotionalTone !== undefined
    && updates.emotionalTone !== existingLetter.emotionalTone;
  const relationshipChanged = updates.senderRecipientRelationship !== undefined
    && updates.senderRecipientRelationship !== existingLetter.senderRecipientRelationship;
  const requestedPrimaryTopics = updates.primaryTopics !== undefined
    ? updates.primaryTopics
    : updates.tags;
  const primaryTopicsChanged = requestedPrimaryTopics !== undefined
    && (
      !sameNullableStringArray(requestedPrimaryTopics, existingLetter.primaryTopics)
      || !sameNullableStringArray(requestedPrimaryTopics, existingLetter.tags)
    );
  const hasMetadataUpdate = senderChanged
    || recipientChanged
    || locationChanged
    || summaryChanged
    || hookChanged
    || extractedDateChanged
    || emotionalToneChanged
    || relationshipChanged
    || primaryTopicsChanged;

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
  if (emotionalToneChanged) {
    dbUpdates.emotionalTone = updates.emotionalTone;
  }
  if (relationshipChanged) {
    dbUpdates.senderRecipientRelationship = updates.senderRecipientRelationship;
  }
  if (updates.notes !== undefined && updates.notes !== existingLetter.notes) {
    dbUpdates.notes = updates.notes;
  }
  if (primaryTopicsChanged) {
    dbUpdates.tags = requestedPrimaryTopics;
    dbUpdates.primaryTopics = requestedPrimaryTopics;
  }
  if (updates.readingText !== undefined && updates.readingText !== existingLetter.readingText) {
    dbUpdates.readingText = updates.readingText;
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
      ...(emotionalToneChanged ? { emotionalTone: updates.emotionalTone } : {}),
      ...(relationshipChanged
        ? { senderRecipientRelationship: updates.senderRecipientRelationship }
        : {}),
      ...(primaryTopicsChanged ? { primaryTopics: requestedPrimaryTopics } : {}),
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

  const noteAutoResolution = resolveAiNotesForChangedFields(
    existingLetter.aiNotes,
    [
      ...(senderChanged && updates.sender ? ['sender'] : []),
      ...(recipientChanged && updates.recipient ? ['recipient'] : []),
      ...(locationChanged && updates.locationWritten ? ['locationWritten'] : []),
      ...(extractedDateChanged && normalizedExtractedDate ? ['extractedDate'] : []),
      ...(relationshipChanged && updates.senderRecipientRelationship
        ? ['senderRecipientRelationship']
        : []),
      ...(transcriptChanged ? ['transcriptionText'] : []),
    ],
  );
  if (noteAutoResolution) {
    dbUpdates.aiNotes = noteAutoResolution.notes;
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

  const hasPublicationIntent = updates.visibility !== undefined
    || updates.transcriptPublished !== undefined
    || updates.metadataPublished !== undefined;
  const hasPublicationBearingPatch = Object.hasOwn(
    dbUpdates,
    'transcriptPublished',
  ) || Object.hasOwn(dbUpdates, 'metadataPublished');
  const hasRootContentPatch = Object.keys(dbUpdates).length > 0;
  if (!hasRootContentPatch && !hasPublicationIntent) {
    return true;
  }
  if (hasRootContentPatch) {
    dbUpdates.updatedAt = new Date();
  }

  if (hasPublicationIntent || hasPublicationBearingPatch) {
    const publicationOutcome = await applyPublicationMutation({
      source: {
        letterId,
        primarySourceRevision: updates.primarySourceRevision,
      },
      intent: {
        visibility: updates.visibility,
        transcriptPublished: updates.transcriptPublished,
        metadataPublished: updates.metadataPublished,
        autoPublishVerifiedContentOnVisibilityTransition: true,
      },
      userId,
      requireCurrentSourceRevision: true,
      rootPatch: hasRootContentPatch ? dbUpdates : undefined,
      rootConditions: hasRootContentPatch
        ? [
            ...observedMetadataRevisionConditions(letterId, existingLetter),
            eq(letters.primarySourceRevision, updates.primarySourceRevision),
          ]
        : undefined,
      afterRootMutation: hasRootContentPatch
        && (senderChanged || recipientChanged || relationshipChanged)
        ? async (database) => {
            await syncLetterParticipantsFromMetadata({
              letterId,
              sender: senderChanged ? updates.sender : undefined,
              recipient: recipientChanged ? updates.recipient : undefined,
              relationshipType: relationshipChanged
                ? updates.senderRecipientRelationship
                : undefined,
              actor: userId,
              database,
            });
          }
        : undefined,
      blocksTranscriptGrant: transcriptChanged,
      blocksMetadataGrant: transcriptChanged || hasMetadataUpdate,
    });

    if (publicationOutcome.kind === 'not_found') return false;
    if (publicationOutcome.kind === 'source_changed_or_ineligible') {
      const latest = await getLetterById(letterId);
      if (latest) {
        assertCurrentPrimarySourceRevision(
          latest.primarySourceRevision ?? 0,
          updates.primarySourceRevision,
          'Letter source changed before this update could be saved; reload and try again',
        );
      }
      const error = new Error(
        'Letter publication eligibility or source changed before this update could be saved; reload and try again',
      ) as Error & { status: number };
      error.status = 409;
      throw error;
    }
    if (publicationOutcome.kind === 'root_conflict') {
      const latest = await getLetterById(letterId);
      if (latest) {
        assertCurrentPrimarySourceRevision(
          latest.primarySourceRevision ?? 0,
          updates.primarySourceRevision,
          'Letter source changed before this update could be saved; reload and try again',
        );
      }
      const error = new Error(
        'Letter content changed before this update could be saved; reload and try again',
      ) as Error & { status: number };
      error.status = 409;
      throw error;
    }
  } else {
    const updated = await db
      .update(letters)
      .set(dbUpdates)
      .where(and(
        ...observedMetadataRevisionConditions(letterId, existingLetter),
        eq(letters.primarySourceRevision, updates.primarySourceRevision),
      ))
      .returning({ id: letters.id });
    if (updated.length === 0) {
      const latest = await getLetterById(letterId);
      if (latest) {
        assertCurrentPrimarySourceRevision(
          latest.primarySourceRevision ?? 0,
          updates.primarySourceRevision,
          'Letter source changed before this update could be saved; reload and try again',
        );
      }
      const error = new Error(
        'Letter content changed before this update could be saved; reload and try again',
      ) as Error & { status: number };
      error.status = 409;
      throw error;
    }
  }

  const workflowChange = typeof dbUpdates.workflow === 'string'
    ? `${currentWorkflow} -> ${dbUpdates.workflow}`
    : undefined;

  log.info(
    {
      letterId,
      workflowChange,
      visibilityChange: updates.visibility,
      notesAutoResolved: noteAutoResolution?.resolvedCount ?? 0,
    },
    'Letter updated',
  );

  return true;
}
