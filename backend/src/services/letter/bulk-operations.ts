import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import {
  db,
  letters,
  letterPersons,
  letterPlaces,
  personRelationships,
} from '../../db/index.js';
import {
  getProcessingStatus,
  processLettersAsync,
  requestBackgroundWorkerRun,
  resetProcessingState,
} from '../processing-queue.js';
import { shouldUseCloudRunWorkerJob } from '../cloud-run-job.js';
import { syncLetterParticipantsFromMetadata } from '../entities/participant-sync.js';
import {
  commitDirectIdentityField,
  isIdentityRevisionConflict,
  observeIdentityField,
  propagateName,
  propagatePlaceholderReplacement,
  type IdentityField,
  type IdentityState,
} from '../name-propagation.js';
import { isPlaceholderValue } from '../../utils/placeholders.js';
import {
  observeTranscriptionState,
  observedTranscriptionStateConditions,
} from './transcription-job.js';
import {
  observedMetadataRevisionConditions,
} from './metadata-job.js';
import {
  isTranscribableType,
  log,
  type BulkClearResult,
  type BulkResult,
  type BulkUpdateFieldEntry,
  type BulkUpdateFieldsResult,
} from './shared.js';

export async function bulkTranscribe(letterIds: string[], overwrite = false): Promise<BulkResult> {
  log.info({ requestedCount: letterIds.length }, 'Bulk transcribe request received');

  const allRequested = await db.query.letters.findMany({
    where: and(
      inArray(letters.id, letterIds)
    ),
    with: { pages: true },
  });

  const foundIds = new Set(allRequested.map(l => l.id));
  const eligible: typeof allRequested = [];
  const skipReasons: Array<{ letterId: string; reason: string }> = [];

  for (const id of letterIds) {
    if (!foundIds.has(id)) {
      skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
    }
  }

  for (const letter of allRequested) {
    if (!isTranscribableType(letter.type)) {
      skipReasons.push({ letterId: letter.id, reason: `Type '${letter.type}' is not transcribable` });
    } else if (letter.workflow !== 'UPLOADED' && !overwrite) {
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

  const needsResetLetters = overwrite
    ? eligible.filter(letter => letter.workflow !== 'UPLOADED')
    : [];
  const needsReset = new Set(needsResetLetters.map(letter => letter.id));
  const queueOnlyLetters = eligible.filter(letter => !needsReset.has(letter.id));

  const observedQueueState = (letter: (typeof eligible)[number]) => and(
    eq(letters.id, letter.id),
    ...observedTranscriptionStateConditions(observeTranscriptionState(letter)),
  );

  const queueLetters = async (
    candidates: typeof eligible,
    resetWorkflow: boolean,
  ) => {
    if (candidates.length === 0) return [];
    return db.update(letters).set({
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      deadLetter: false,
      ...(resetWorkflow ? {
        workflow: 'UPLOADED' as const,
      } : {}),
      updatedAt: new Date(),
    }).where(or(...candidates.map(observedQueueState))).returning({ id: letters.id });
  };

  const queued = [
    ...await queueLetters(needsResetLetters, true),
    ...await queueLetters(queueOnlyLetters, false),
  ];
  const queuedIds = queued.map(letter => letter.id);
  const queuedIdSet = new Set(queuedIds);
  for (const letter of eligible) {
    if (!queuedIdSet.has(letter.id)) {
      skipReasons.push({
        letterId: letter.id,
        reason: 'Transcription changed before it could be queued',
      });
    }
  }

  if (queuedIds.length === 0) {
    log.info({ skipped: skipReasons.length }, 'Bulk transcribe: no letters remained eligible');
    return { queued: 0, skipped: skipReasons.length, skipReasons, processing: false };
  }

  if (!shouldUseCloudRunWorkerJob() && getProcessingStatus().isRunning) {
    log.info(
      { queued: queuedIds.length, skipped: skipReasons.length },
      'Bulk transcribe queued (another batch running)',
    );
    return { queued: queuedIds.length, skipped: skipReasons.length, skipReasons, processing: false };
  }

  if (shouldUseCloudRunWorkerJob()) {
    await requestBackgroundWorkerRun('bulk:transcription');
  } else {
    resetProcessingState(queuedIds.length);
    void processLettersAsync(queuedIds, 'transcription');
  }

  log.info(
    { queued: queuedIds.length, skipped: skipReasons.length },
    'Bulk transcribe started immediately',
  );
  return { queued: queuedIds.length, skipped: skipReasons.length, skipReasons, processing: true };
}

export async function bulkExtractMetadata(
  letterIds: string[],
  skipConfirmationCheck = false,
): Promise<BulkResult> {
  const allRequested = await db.query.letters.findMany({
    where: and(
      inArray(letters.id, letterIds)
    ),
  });

  const foundIds = new Set(allRequested.map(l => l.id));
  const eligible: typeof allRequested = [];
  const skipReasons: Array<{ letterId: string; reason: string }> = [];
  let unconfirmedCount = 0;

  for (const id of letterIds) {
    if (!foundIds.has(id)) {
      skipReasons.push({ letterId: id, reason: 'Letter not found or deleted' });
    }
  }

  for (const letter of allRequested) {
    if (letter.type !== 'L') {
      skipReasons.push({ letterId: letter.id, reason: `Type '${letter.type}' does not support metadata extraction (only letters)` });
    } else if (!isTranscribableType(letter.type)) {
      skipReasons.push({ letterId: letter.id, reason: `Type '${letter.type}' is not transcribable` });
    } else if (letter.transcriptionStatus === 'RUNNING') {
      skipReasons.push({ letterId: letter.id, reason: 'Transcription already running' });
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

  const queuedRows = await db.update(letters).set({
    metadataStatus: 'PENDING',
    metadataRunId: null,
    metadataRunRevision: null,
    metadataLeaseExpiresAt: null,
    metadataLeaseRunId: null,
    metadataClaimKind: null,
    metadataRevision: sql`${letters.metadataRevision} + 1`,
    metadataError: null,
    updatedAt: new Date(),
  }).where(or(...eligible.map(letter => and(
    ...observedMetadataRevisionConditions(letter.id, letter),
    eq(letters.metadataStatus, letter.metadataStatus),
    ne(letters.transcriptionStatus, 'RUNNING'),
  )))).returning({ id: letters.id });

  const queuedIds = queuedRows.map(row => row.id);
  const queuedIdSet = new Set(queuedIds);
  for (const letter of eligible) {
    if (!queuedIdSet.has(letter.id)) {
      skipReasons.push({
        letterId: letter.id,
        reason: 'Letter processing state changed before metadata could be queued',
      });
    }
  }

  if (queuedIds.length === 0) {
    return {
      queued: 0,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  if (!shouldUseCloudRunWorkerJob() && getProcessingStatus().isRunning) {
    return {
      queued: queuedIds.length,
      skipped: skipReasons.length,
      skipReasons,
      processing: false,
      unconfirmedCount,
    };
  }

  if (shouldUseCloudRunWorkerJob()) {
    await requestBackgroundWorkerRun('bulk:metadata');
  } else {
    resetProcessingState(queuedIds.length);
    void processLettersAsync(queuedIds, 'metadata');
  }

  return {
    queued: queuedIds.length,
    skipped: skipReasons.length,
    skipReasons,
    processing: true,
    unconfirmedCount,
  };
}

export async function bulkClearTranscriptions(letterIds: string[]): Promise<BulkClearResult> {
  log.info({ count: letterIds.length }, 'Bulk clear transcriptions requested');

  const clearedIds = await db.transaction(async (tx) => {
    const cleared = await tx.update(letters).set({
      workflow: 'UPLOADED',
      transcriptionText: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptionStatus: 'FAILED',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: 'Cleared by admin',
      transcriptionAttemptCount: 0,
      deadLetter: false,
      extraContentTranscript: null,
      extraContentStatus: 'EMPTY',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      extraContentJobStatus: 'FAILED' as const,
      extraContentJobError: 'Cleared by admin',
      extraContentJobRunId: null,
      extraContentJobLeaseExpiresAt: null,
      extraContentJobLeaseRunId: null,
      extraContentJobClaimKind: null,
      extraContentJobDirty: false,
      metadataStatus: 'FAILED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      metadataError: 'Cleared by admin',
      metadataAttemptCount: 0,
      sender: null,
      recipient: null,
      locationWritten: null,
      hook: null,
      summary: null,
      extractedDate: null,
      tags: null,
      metadataJson: null,
      metadataV2Json: null,
      emotionalTone: null,
      senderRecipientRelationship: null,
      primaryTopics: null,
      aiNotes: null,
      entityExtractionJson: null,
      entityExtractionStatus: 'FAILED',
      entityExtractionError: 'Cleared by admin',
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptPublished: false,
      metadataContentStatus: 'EMPTY',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      metadataPublished: false,
      updatedAt: new Date(),
    }).where(
      and(
        inArray(letters.id, letterIds),
        ne(letters.transcriptionStatus, 'RUNNING'),
        ne(letters.metadataStatus, 'RUNNING'),
        ne(letters.entityExtractionStatus, 'RUNNING'),
        ne(letters.extraContentJobStatus, 'RUNNING'),
      ),
    ).returning({ id: letters.id });

    const ids = cleared.map(row => row.id);
    if (ids.length > 0) {
      await tx.delete(letterPersons).where(inArray(letterPersons.letterId, ids));
      await tx.delete(letterPlaces).where(inArray(letterPlaces.letterId, ids));
      await tx.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, ids));
    }
    return ids;
  });

  log.info(
    { updated: clearedIds.length, skippedActive: letterIds.length - clearedIds.length },
    'Bulk clear transcriptions completed',
  );

  return {
    message: 'Transcriptions cleared',
    updated: clearedIds.length,
  };
}

async function updateBulkIdentityField(
  letter: IdentityState,
  field: IdentityField,
  value: string | null,
): Promise<{ letter: IdentityState; changed: boolean }> {
  if (letter[field] === value) return { letter, changed: false };

  const observed = observeIdentityField(letter, field);
  let committed: IdentityState;

  if (value === null) {
    committed = await commitDirectIdentityField({ letter, field, value });
  } else {
    try {
      const result = isPlaceholderValue(letter[field]) || !letter[field]
        ? await propagatePlaceholderReplacement({
            letterId: letter.id,
            field,
            newName: value,
            observed,
          })
        : await propagateName({
            letterId: letter.id,
            field,
            oldName: letter[field],
            newName: value,
            observed,
          });
      committed = result.letter;
    } catch (error) {
      if (isIdentityRevisionConflict(error)) throw error;

      log.warn(
        { letterId: letter.id, field, error },
        'Bulk identity propagation failed, using guarded direct update',
      );
      committed = await commitDirectIdentityField({ letter, field, value });
    }
  }

  await syncLetterParticipantsFromMetadata({
    letterId: letter.id,
    [field]: value,
  });

  return { letter: committed, changed: true };
}

export async function bulkUpdateFields(updates: BulkUpdateFieldEntry[]): Promise<BulkUpdateFieldsResult> {
  log.info({ updateCount: updates.length }, 'Bulk update fields request received');

  let successCount = 0;
  for (const update of updates) {
    const sender = update.sender !== undefined ? (update.sender || null) : undefined;
    const recipient = update.recipient !== undefined ? (update.recipient || null) : undefined;

    if (sender === undefined && recipient === undefined) continue;

    const letter = await db.query.letters.findFirst({
      where: eq(letters.id, update.letterId),
    });
    if (!letter) continue;

    let current: IdentityState = letter;
    let changed = false;

    if (sender !== undefined) {
      const result = await updateBulkIdentityField(current, 'sender', sender);
      current = result.letter;
      changed ||= result.changed;
    }
    if (recipient !== undefined) {
      const result = await updateBulkIdentityField(current, 'recipient', recipient);
      current = result.letter;
      changed ||= result.changed;
    }

    if (changed) successCount++;
  }

  log.info({ updated: successCount }, 'Bulk update fields completed');

  return {
    message: 'Fields updated',
    updated: successCount,
  };
}

export async function bulkClearMetadata(letterIds: string[]): Promise<BulkClearResult> {
  const metadataFields = {
    sender: null,
    recipient: null,
    locationWritten: null,
    hook: null,
    summary: null,
    extractedDate: null,
    tags: null,
    metadataStatus: 'FAILED' as const,
    metadataRunId: null,
    metadataRunRevision: null,
    metadataLeaseExpiresAt: null,
    metadataLeaseRunId: null,
    metadataClaimKind: null,
    metadataRevision: sql`${letters.metadataRevision} + 1`,
    metadataError: 'Cleared by admin',
    metadataAttemptCount: 0,
    deadLetter: false,
    metadataJson: null,
    metadataV2Json: null,
    emotionalTone: null,
    senderRecipientRelationship: null,
    primaryTopics: null,
    aiNotes: null,
    entityExtractionJson: null,
    entityExtractionStatus: 'FAILED' as const,
    entityExtractionError: 'Cleared by admin',
    metadataContentStatus: 'EMPTY' as const,
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    metadataPublished: false,
    updatedAt: new Date(),
  };

  const clearedIds = await db.transaction(async (tx) => {
    const cleared = await tx.update(letters).set({
      ...metadataFields,
      workflow: sql`CASE
        WHEN ${letters.transcriptionText} IS NULL THEN 'UPLOADED'
        ELSE 'TRANSCRIBED'
      END`,
    }).where(and(
      inArray(letters.id, letterIds),
      ne(letters.transcriptionStatus, 'RUNNING'),
      ne(letters.metadataStatus, 'RUNNING'),
      ne(letters.entityExtractionStatus, 'RUNNING'),
    )).returning({ id: letters.id });

    const ids = cleared.map(row => row.id);
    if (ids.length > 0) {
      await tx.delete(letterPersons).where(inArray(letterPersons.letterId, ids));
      await tx.delete(letterPlaces).where(inArray(letterPlaces.letterId, ids));
      await tx.delete(personRelationships).where(inArray(personRelationships.discoveredInLetterId, ids));
    }
    return ids;
  });

  return {
    message: 'Metadata cleared',
    updated: clearedIds.length,
  };
}
